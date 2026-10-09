/**
 * The 3D system: scene, planets, camera, interaction, overlay labels and the
 * HUD wiring. Ported from reference/ORBIT_prototype.html. The planets come
 * from a DataSource (orbit/data.ts): the server API with Realtime once the
 * coin is live, the prototype's demo generator before that.
 */
import {
  clamp,
  DAY_MS,
  DEMO,
  ease,
  esc,
  fmt,
  KIND,
  money,
  mulberry32,
  orbitOf,
  orbitSpeed,
  rngFor,
  sizeOf,
  splitNews,
  STAR_TIERS,
  TAG,
  TAU,
  type NewsItem,
  type PlanetCard,
  type ScenePlanet,
} from "@orbit/core";
import * as THREE from "three";
import { mountAccount } from "./account";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { PublicToken } from "@/lib/token";
import { copy as t, LOCALE } from "./copy";
import {
  pickSource,
  type CardResult,
  type Debris,
  type FeedItem,
  type SceneData,
  type StarInfo,
} from "./data";
import { agoText, deadPanelHTML, planetPanelHTML, starPanelHTML, type SystemInfo } from "./panel";
import { pickBody, type ScreenBody } from "./pick";
import {
  FpsGovernor,
  guessQuality,
  loadPref,
  PREF_ORDER,
  QUALITY,
  QUALITY_ORDER,
  savePref,
  type Quality,
  type QualityPref,
  type QualitySpec,
} from "./quality";
import { createSanitizePass } from "./sanitize";
import * as SH from "./shaders";

type Body = ScenePlanet & {
  incl: number;
  node: number;
  ang0: number;
  q: THREE.Quaternion;
  pos: THREE.Vector3;
  speed: number;
  /** Current drawn size; eases towards sizeOf(rank) when the rank changes. */
  size: number;
  group?: THREE.Group;
  mesh?: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  atmo?: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  atmoMat?: THREE.ShaderMaterial;
  ringMat?: THREE.ShaderMaterial;
  orbitLine?: THREE.LineLoop;
  sats?: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  spin: number;
  astRot?: THREE.Euler;
  astShape?: THREE.Vector3;
  astSpin?: number;
  idx?: number;
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const vec3 = (a: readonly number[]) => new THREE.Vector3(a[0], a[1], a[2]);

let started = false;

export interface StartOptions {
  /** Wallet from /planet/<wallet>; the camera flies to it after load. */
  initialWallet?: string | null;
  debug?: boolean;
  /** Public token facts (ticker, contract, links) read on the server. */
  token: PublicToken;
  /** Page URL parameters: ?preview=<key>, and render overrides with ?debug. */
  overrides?: URLSearchParams;
}

export async function start(opts: StartOptions) {
  if (started) return;
  started = true;
  const brand = opts.token;

  const loading = $("loading");
  const fail = (msg: string) => {
    if (loading.classList.contains("gone")) return;
    loading.classList.add("err");
    loading.querySelector(".ld")!.textContent = msg;
  };
  addEventListener("error", (e) => fail(t.sceneError(e.message || "WebGL")));
  const slowTimer = setTimeout(() => {
    if (!loading.classList.contains("gone") && !loading.classList.contains("err")) fail(t.slowLoad);
  }, 25000);

  /* ================= data ================= */
  const supabase =
    process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
      ? { url: process.env.SUPABASE_URL, anonKey: process.env.SUPABASE_ANON_KEY }
      : null;
  const { source, data: first } = await pickSource({
    preview: opts.overrides?.get("preview") ?? null,
    supabase,
  });
  let star: StarInfo = first.star;
  // The visitor’s wallet: "Connect wallet", "My planet" and the owner forms.
  const account = mountAccount($("acct"), {
    onMyPlanet: () => {
      const w = account.me.wallet;
      const h = w ? byWallet.get(w) : undefined;
      if (h) focus(h);
      else account.toast(t.noPlanetYet(brand.ticker, fmt(brand.minHolding)));
    },
  });
  // Set once the 3D view is built; the text view (no WebGL) never sets it.
  let engineReady = false;
  account.onChange(() => {
    if (!engineReady) return;
    editing = reporting = false;
    if (!panel.hidden && !starPanel && selected) renderPanel();
  });
  const info = (): SystemInfo => ({
    ticker: brand.ticker,
    contract: brand.contract,
    mcap: star.mcap,
    count: bodies.length,
    tierIndex: star.tier,
    ...(source.live ? {} : { supply: DEMO.supply, launch: DEMO.launch }),
  });
  // The demo badge goes away with live data.
  if (source.live) document.querySelector(".top .demo")?.remove();
  /** Shared clock: orbital angles depend on wall time so every visitor sees the same sky. */
  const missionSeconds = () => (Date.now() - DEMO.launch) / 1000;
  /** Mission time in the header counts from the launch (the demo date before it). */
  const missionStart = brand.launchedAt ?? DEMO.launch;

  /* ================= quality ================= */
  let pref: QualityPref = loadPref();
  const auto = () =>
    guessQuality({
      width: innerWidth,
      coarsePointer: matchMedia("(pointer: coarse)").matches,
      cores: navigator.hardwareConcurrency || 4,
      memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    });
  let quality: Quality = pref === "auto" ? auto() : pref;
  // Debug overrides (only with ?debug): bloom=0|1, dpr=<max>, sky=<res>,
  // stars=<count>, detail=hi|mid, san=0|1. Used to track down rendering issues.
  const ov0 = opts.debug ? opts.overrides : undefined;
  const num = (k: string) => (ov0?.has(k) ? Number(ov0.get(k)) : undefined);
  const spec = (q: Quality): QualitySpec => {
    const base = QUALITY[q];
    return {
      maxDpr: num("dpr") ?? base.maxDpr,
      skyRes: num("sky") ?? base.skyRes,
      nearStars: num("stars") ?? base.nearStars,
      bloom: ov0?.has("bloom") ? ov0.get("bloom") === "1" : base.bloom,
      maxDetail: (ov0?.get("detail") as QualitySpec["maxDetail"] | null) ?? base.maxDetail,
    };
  };
  let Q = spec(quality);

  /* ================= renderer / scene ================= */
  const glc = $<HTMLCanvasElement>("gl");
  let renderer: THREE.WebGLRenderer;
  try {
    if (opts.overrides?.get("text") === "1") throw new Error("text view requested");
    renderer = new THREE.WebGLRenderer({
      canvas: glc,
      antialias: true,
      powerPreference: "high-performance",
    });
  } catch {
    // No WebGL: the same data as a list, the same mission pages.
    clearTimeout(slowTimer);
    const { startTextView } = await import("./textview");
    startTextView({
      source,
      data: first,
      ticker: brand.ticker,
      account,
      initialWallet: opts.initialWallet,
    });
    return;
  }
  const dpr = () => Math.min(devicePixelRatio, Q.maxDpr);
  renderer.setPixelRatio(dpr());
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.02, 30000);
  camera.position.set(0, 1500, 3200);
  const controls = new OrbitControls(camera, glc);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = 8;
  controls.maxDistance = 2600;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 1.1;
  controls.panSpeed = 0.8;
  scene.add(new THREE.AmbientLight(0x8090b0, 0.06));
  const sunLight = new THREE.PointLight(0xfff1dc, 3.2, 0, 0);
  scene.add(sunLight);

  /* ================= sky: procedural Milky Way baked once into a cube map ================= */
  const gn = new THREE.Vector3(0.35, 0.86, -0.37).normalize();
  const gc = new THREE.Vector3(0.9, -0.2, 0.4);
  gc.sub(gn.clone().multiplyScalar(gc.dot(gn))).normalize();
  const skyScene = new THREE.Scene();
  skyScene.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(5, 64, 32),
      new THREE.ShaderMaterial({
        vertexShader: SH.SKY_VS,
        fragmentShader: SH.SKY_FS,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { uGN: { value: gn }, uGC: { value: gc } },
      }),
    ),
  );
  let cubeRT: THREE.WebGLCubeRenderTarget | null = null;
  function bakeSky(res: number) {
    if (cubeRT && cubeRT.width === res) return;
    const next = new THREE.WebGLCubeRenderTarget(res, {
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
    });
    new THREE.CubeCamera(0.1, 10, next).update(renderer, skyScene);
    scene.background = next.texture;
    scene.backgroundIntensity = 1.0;
    cubeRT?.dispose();
    cubeRT = next;
  }
  bakeSky(Q.skyRes);

  /* near stars with real-looking colours, so rotating the camera feels deep */
  const nearStarsMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uDpr: { value: renderer.getPixelRatio() } },
    vertexShader: SH.NEAR_STARS_VS,
    fragmentShader: SH.NEAR_STARS_FS,
  });
  let nearStars: THREE.Points | null = null;
  function buildNearStars(n: number) {
    if (nearStars && nearStars.geometry.getAttribute("position").count === n) return;
    const pos = new Float32Array(n * 3),
      col = new Float32Array(n * 3),
      sz = new Float32Array(n),
      ph = new Float32Array(n);
    const r = mulberry32(99);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize();
      if (r() < 0.55) {
        const sb = v.dot(gn);
        v.sub(gn.clone().multiplyScalar(sb * (0.8 + r() * 0.18))).normalize();
      }
      v.multiplyScalar(3500 + r() * 7000);
      pos.set([v.x, v.y, v.z], i * 3);
      const tt = r();
      const c =
        tt < 0.12
          ? [1, 0.6, 0.42]
          : tt < 0.35
            ? [1, 0.85, 0.65]
            : tt < 0.8
              ? [0.95, 0.96, 1]
              : [0.65, 0.78, 1];
      col.set(c, i * 3);
      sz[i] = 0.7 + Math.pow(r(), 6) * 3.4;
      ph[i] = r() * TAU;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("size", new THREE.BufferAttribute(sz, 1));
    g.setAttribute("phase", new THREE.BufferAttribute(ph, 1));
    const pts = new THREE.Points(g, nearStarsMat);
    pts.frustumCulled = false;
    if (nearStars) {
      scene.remove(nearStars);
      nearStars.geometry.dispose();
    }
    scene.add(pts);
    nearStars = pts;
  }
  buildNearStars(Q.nearStars);

  /* ================= star ================= */
  const STAR_R = 12;
  const tier0 = STAR_TIERS[star.tier]!;
  const starMat = new THREE.ShaderMaterial({
    vertexShader: SH.PLANET_VS,
    fragmentShader: SH.STAR_FS,
    uniforms: {
      uTime: { value: 0 },
      uCore: { value: vec3(tier0.core) },
      uEdge: { value: vec3(tier0.edge) },
    },
  });
  const starMesh = new THREE.Mesh(new THREE.SphereGeometry(STAR_R, 96, 64), starMat);
  scene.add(starMesh);
  function glowTex(stops: [number, string][]) {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    for (const [o, s] of stops) gr.addColorStop(o, s);
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
    const tx = new THREE.CanvasTexture(c);
    tx.colorSpace = THREE.SRGBColorSpace;
    return tx;
  }
  const corona = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex([
        [0, "rgba(255,255,255,1)"],
        [0.12, "rgba(255,255,255,.55)"],
        [0.3, "rgba(255,255,255,.14)"],
        [0.6, "rgba(255,255,255,.03)"],
        [1, "rgba(255,255,255,0)"],
      ]),
      color: tier0.glow,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  );
  corona.scale.setScalar(STAR_R * 6.5);
  corona.material.opacity = 0.85;
  scene.add(corona);
  /** The star's class follows the market cap. */
  function applyStar() {
    const tier = STAR_TIERS[star.tier] ?? tier0;
    starMat.uniforms.uCore!.value = vec3(tier.core);
    starMat.uniforms.uEdge!.value = vec3(tier.edge);
    corona.material.color.set(tier.glow);
    sunLight.color.set(tier.glow).lerp(new THREE.Color(0xffffff), 0.6);
    $("sMcap").textContent = money(star.mcap);
    $("sHolders").textContent = fmt(bodies.length);
    $("sClass").textContent = `${tier.cls} · ${tier.name}`;
  }

  /* ================= planets ================= */
  const GAS = [
    [
      [0.86, 0.74, 0.58],
      [0.62, 0.42, 0.28],
      [0.95, 0.9, 0.8],
    ],
    [
      [0.88, 0.8, 0.6],
      [0.72, 0.6, 0.4],
      [0.96, 0.92, 0.78],
    ],
    [
      [0.78, 0.6, 0.62],
      [0.46, 0.3, 0.42],
      [0.94, 0.84, 0.84],
    ],
    [
      [0.6, 0.76, 0.78],
      [0.3, 0.46, 0.56],
      [0.88, 0.94, 0.94],
    ],
    [
      [0.92, 0.66, 0.42],
      [0.6, 0.32, 0.18],
      [0.98, 0.86, 0.66],
    ],
  ];
  const ICE = [
    [
      [0.24, 0.4, 0.82],
      [0.16, 0.28, 0.66],
      [0.6, 0.72, 0.95],
    ],
    [
      [0.58, 0.84, 0.88],
      [0.46, 0.72, 0.8],
      [0.82, 0.95, 0.96],
    ],
    [
      [0.36, 0.6, 0.78],
      [0.24, 0.44, 0.64],
      [0.72, 0.86, 0.94],
    ],
  ];
  const ATMO_COL: Record<string, number[]> = {
    gas: [1, 0.86, 0.66],
    ice: [0.55, 0.8, 1],
    rocky: [0.42, 0.66, 1],
    super: [1, 0.84, 0.6],
  };
  const geoHi = new THREE.SphereGeometry(1, 96, 64),
    geoMid = new THREE.SphereGeometry(1, 48, 32),
    geoLo = new THREE.SphereGeometry(1, 24, 16);
  const orbitGeo = (() => {
    const pts: number[] = [];
    for (let i = 0; i <= 256; i++) {
      const a = (i / 256) * TAU;
      pts.push(Math.cos(a), 0, Math.sin(a));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  })();
  const lineMat = (color: number, opacity: number) =>
    new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const orbitMat = lineMat(0xffffff, 0.055);
  const orbitMatHi = lineMat(0xfc3d21, 0.7);
  const orbitMatHov = lineMat(0xffffff, 0.3);
  const tmpV = new THREE.Vector3();
  const astGeo = (() => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position!;
    const r = mulberry32(7);
    for (let i = 0; i < p.count; i++) {
      tmpV.fromBufferAttribute(p, i);
      tmpV.multiplyScalar(0.75 + r() * 0.45);
      p.setXYZ(i, tmpV.x, tmpV.y, tmpV.z);
    }
    g.computeVertexNormals();
    return g;
  })();
  const astMat = new THREE.MeshStandardMaterial({
    color: 0x8a8178,
    roughness: 1,
    metalness: 0,
    flatShading: true,
  });
  const astDummy = new THREE.Object3D();
  const dotTex = glowTex([
    [0, "rgba(255,255,255,1)"],
    [0.35, "rgba(255,255,255,.8)"],
    [1, "rgba(255,255,255,0)"],
  ]);
  const dotMat = new THREE.PointsMaterial({
    size: 4,
    map: dotTex,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  const debrisMat = new THREE.PointsMaterial({
    color: 0x9aa9b8,
    size: 0.35,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  });

  let bodies: Body[] = [];
  let planets: Body[] = [];
  let asteroids: Body[] = [];
  let astMesh: THREE.InstancedMesh | null = null;
  let dots: THREE.Points | null = null;
  let debris: { d: Debris; pts: THREE.Points; q: THREE.Quaternion; ang0: number; speed: number }[] =
    [];
  const byWallet = new Map<string, Body>();

  function syncVisual(h: Body) {
    const u = h.mesh?.material.uniforms;
    if (!u) return;
    const v = h.visual;
    u.uLava!.value = v.lava;
    u.uWater!.value = v.water;
    u.uBio!.value = v.bio;
    u.uCity!.value = v.city;
    u.uIce!.value = v.ice;
    u.uAsh!.value = v.ash;
    u.uDim!.value = v.dim;
    if (h.atmoMat && v.atmo !== null) h.atmoMat.uniforms.uStrength!.value = v.atmo;
  }

  /** Meshes are built at unit size and the group is scaled, so sizes can ease. */
  function buildPlanet(h: Body) {
    const r = rngFor(h.wallet + "v");
    const group = new THREE.Group();
    const type = h.nature === "gas" || h.nature === "super" ? 0 : h.nature === "ice" ? 1 : 2;
    const pal =
      type === 0
        ? GAS[Math.floor(r() * GAS.length)]!
        : type === 1
          ? ICE[Math.floor(r() * ICE.length)]!
          : [
              [0, 0, 0],
              [0, 0, 0],
              [0, 0, 0],
            ];
    const tint = [0.85 + r() * 0.3, 0.8 + r() * 0.25, 0.75 + r() * 0.3];
    const storm = new THREE.Vector3(r() - 0.5, (r() - 0.5) * 0.8, r() - 0.5).normalize();
    const mat = new THREE.ShaderMaterial({
      vertexShader: SH.PLANET_VS,
      fragmentShader: SH.PLANET_FS,
      uniforms: {
        uType: { value: type },
        uSeed: { value: new THREE.Vector3(r() * 50, r() * 50, r() * 50) },
        uC1: { value: vec3(pal[0]!) },
        uC2: { value: vec3(pal[1]!) },
        uC3: { value: vec3(pal[2]!) },
        uBands: { value: type === 0 ? 14 + r() * 12 : 6 + r() * 5 },
        uCrater: {
          value: type === 2 ? (h.craters ? clamp(0.2 + h.craters * 0.15, 0, 0.7) : 0.06) : 0,
        },
        uTime: { value: 0 },
        uStorm: { value: storm },
        uStormOn: { value: type === 0 && r() > 0.35 ? 1 : 0 },
        uTint: { value: vec3(tint) },
        uHi: { value: h.rank <= 120 ? 1 : 0 },
        uSize: { value: h.size },
        uPx: { value: 10 },
        uLava: { value: 0 },
        uWater: { value: 0 },
        uBio: { value: 0 },
        uCity: { value: 0 },
        uIce: { value: 0 },
        uAsh: { value: 0 },
        uDim: { value: 0 },
      },
    });
    const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>(geoLo, mat);
    const tilt = new THREE.Group();
    tilt.rotation.z = (r() - 0.5) * 0.6;
    tilt.add(mesh);
    group.add(tilt);
    const am = new THREE.ShaderMaterial({
      vertexShader: SH.ATMO_VS,
      fragmentShader: SH.ATMO_FS,
      uniforms: {
        uColor: { value: vec3(ATMO_COL[h.nature] ?? ATMO_COL.rocky!) },
        uPower: { value: type === 2 ? 3.4 : 3.6 },
        uStrength: { value: type === 2 ? 0 : 0.8 },
        uFade: { value: 1 },
      },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const atmo = new THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>(geoLo, am);
    atmo.scale.setScalar(type === 2 ? 1.035 : 1.025);
    tilt.add(atmo);
    h.atmoMat = am;
    h.atmo = atmo;
    if (h.rings) {
      const inR = 1.45,
        outR = type === 2 ? 2.0 : 2.5;
      const rg = new THREE.RingGeometry(inR, outR, 160, 1);
      const rc =
        type === 0 ? [0.88, 0.8, 0.66] : type === 1 ? [0.7, 0.8, 0.86] : [0.75, 0.72, 0.68];
      const rm = new THREE.ShaderMaterial({
        vertexShader: SH.RING_VS,
        fragmentShader: SH.RING_FS,
        uniforms: {
          uIn: { value: inR },
          uOut: { value: outR },
          uColor: { value: vec3(rc) },
          uCenter: { value: h.pos },
          uR: { value: h.size },
          uSeedF: { value: r() * 10 },
        },
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      });
      const ring = new THREE.Mesh(rg, rm);
      ring.rotation.x = -Math.PI / 2 + 0.08;
      tilt.add(ring);
      h.ringMat = rm;
    }
    if (h.era >= 5) {
      const n = h.era === 5 ? 8 : h.era === 6 ? 20 : 34;
      const pts: number[] = [];
      for (let i = 0; i < n; i++) {
        const a = r() * TAU,
          inc = (r() - 0.5) * 1.2,
          d = 1.35 + r() * 0.9;
        pts.push(Math.cos(a) * d, Math.sin(inc) * d * 0.5, Math.sin(a) * d);
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      const sats = new THREE.Points(
        sg,
        new THREE.PointsMaterial({
          color: 0xfff3e0,
          size: Math.max(0.03, h.size * 0.022),
          sizeAttenuation: true,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      sats.userData.spin = 0.15 + r() * 0.2;
      tilt.add(sats);
      h.sats = sats;
    }
    if (h.era >= 7) {
      const ringWorld = new THREE.Mesh(
        new THREE.TorusGeometry(1.9, 0.018, 8, 200),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.3, 0.95) }),
      );
      ringWorld.rotation.x = Math.PI / 2 + 0.25;
      tilt.add(ringWorld);
    }
    group.scale.setScalar(h.size);
    scene.add(group);
    const orbit = new THREE.LineLoop(orbitGeo, orbitMat);
    orbit.scale.setScalar(h.orbit);
    orbit.quaternion.copy(h.q);
    orbit.visible = h.rank <= 50;
    scene.add(orbit);
    h.group = group;
    h.mesh = mesh;
    h.orbitLine = orbit;
    h.spin = (0.05 + r() * 0.12) * (r() < 0.1 ? -1 : 1);
    syncVisual(h);
  }

  function disposeGroup(o: THREE.Object3D) {
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.geometry && ![geoHi, geoMid, geoLo, orbitGeo, astGeo].includes(m.geometry))
        m.geometry.dispose();
      const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
      for (const mat of mats)
        if (![orbitMat, orbitMatHi, orbitMatHov, astMat, dotMat, debrisMat].includes(mat as never))
          (mat as THREE.Material).dispose();
    });
    scene.remove(o);
  }

  /** What forces a planet to be rebuilt (anything else is updated in place). */
  const shapeKey = (p: ScenePlanet) =>
    `${p.nature}|${p.rings ? 1 : 0}|${p.era >= 7 ? 2 : p.era >= 5 ? (p.era === 5 ? 1 : 3) : 0}|${p.craters}`;

  function makeBody(p: ScenePlanet, old?: Body): Body {
    const o = orbitOf(p.wallet, 1, 2); // inclination, node and phase depend only on the wallet
    return {
      ...p,
      incl: o.incl,
      node: o.node,
      ang0: o.ang0,
      q: new THREE.Quaternion().setFromEuler(new THREE.Euler(o.incl, o.node, 0, "YXZ")),
      pos: old?.pos ?? new THREE.Vector3(),
      speed: orbitSpeed(p.orbit),
      size: old?.size ?? sizeOf(p.rank),
      spin: 0,
    };
  }

  /** Build or update the world from scene data. Unchanged planets keep their meshes. */
  function setWorld(data: SceneData) {
    const prev = new Map(bodies.map((b) => [b.wallet, b]));
    const next: Body[] = [];
    for (const p of data.planets) {
      const old = prev.get(p.wallet);
      if (old && shapeKey(old) === shapeKey(p) && old.orbit === p.orbit) {
        Object.assign(old, p);
        syncVisual(old);
        if (old.orbitLine)
          old.orbitLine.visible = old === selected || old === hovered || old.rank <= 50;
        next.push(old);
        prev.delete(p.wallet);
      } else {
        if (old) {
          if (old.group) disposeGroup(old.group);
          if (old.orbitLine) scene.remove(old.orbitLine);
          prev.delete(p.wallet);
        }
        const b = makeBody(p, old);
        if (b.nature !== "asteroid") buildPlanet(b);
        next.push(b);
      }
    }
    // Planets that are gone (sold out): remove their meshes.
    for (const gone of prev.values()) {
      if (gone.group) disposeGroup(gone.group);
      if (gone.orbitLine) scene.remove(gone.orbitLine);
      if (selected === gone) selected = null;
      if (hovered === gone) hovered = null;
    }
    // Keep selection objects pointing at the live bodies.
    if (selected) selected = next.find((b) => b.wallet === selected!.wallet) ?? null;
    if (hovered) hovered = next.find((b) => b.wallet === hovered!.wallet) ?? null;
    if (follow) follow = selected;
    bodies = next;
    byWallet.clear();
    for (const b of bodies) byWallet.set(b.wallet, b);
    planets = bodies.filter((b) => b.nature !== "asteroid");
    asteroids = bodies.filter((b) => b.nature === "asteroid");
    // Asteroids: one instanced mesh.
    if (astMesh) {
      scene.remove(astMesh);
      astMesh.dispose();
    }
    astMesh = new THREE.InstancedMesh(astGeo, astMat, Math.max(1, asteroids.length));
    astMesh.count = asteroids.length;
    astMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(astMesh);
    asteroids.forEach((h, i) => {
      const r = rngFor(h.wallet + "a");
      h.astRot = h.astRot ?? new THREE.Euler(r() * TAU, r() * TAU, r() * TAU);
      if (!h.astShape) {
        h.astShape = new THREE.Vector3(0.8 + r() * 0.5, 0.6 + r() * 0.4, 0.7 + r() * 0.5);
        h.astSpin = (r() - 0.5) * 1.5;
      }
      h.idx = i;
    });
    // Far-away dots for every body.
    if (dots) {
      scene.remove(dots);
      dots.geometry.dispose();
    }
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(new Float32Array(bodies.length * 3), 3),
    );
    const dotCol = new Float32Array(bodies.length * 3);
    bodies.forEach((h, i) => {
      const c =
        h.nature === "asteroid"
          ? [0.45, 0.43, 0.42]
          : h.nature === "rocky"
            ? [0.6, 0.7, 0.8]
            : h.nature === "ice"
              ? [0.55, 0.75, 1]
              : [1, 0.85, 0.6];
      dotCol.set(c, i * 3);
    });
    dotGeo.setAttribute("color", new THREE.Float32BufferAttribute(dotCol, 3));
    dots = new THREE.Points(dotGeo, dotMat);
    scene.add(dots);
    setDebris(data.debris);
  }

  /** Debris of planets destroyed in the last 24 hours, on their old orbits. */
  function setDebris(list: Debris[]) {
    for (const d of debris) {
      scene.remove(d.pts);
      d.pts.geometry.dispose();
    }
    debris = list.map((d) => {
      const r = rngFor(d.wallet + "debris");
      const pts: number[] = [];
      for (let i = 0; i < 60; i++) {
        const a = r() * TAU,
          rad = 0.4 + r() * 2.2;
        pts.push(Math.cos(a) * rad, (r() - 0.5) * 0.8, Math.sin(a) * rad);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      const p = new THREE.Points(g, debrisMat.clone());
      scene.add(p);
      const o = orbitOf(d.wallet, 1, 2);
      return {
        d,
        pts: p,
        q: new THREE.Quaternion().setFromEuler(new THREE.Euler(o.incl, o.node, 0, "YXZ")),
        ang0: o.ang0,
        speed: orbitSpeed(d.orbit),
      };
    });
  }

  /* ================= post ================= */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const sanitizePass = createSanitizePass();
  sanitizePass.enabled = ov0?.get("san") !== "0";
  composer.addPass(sanitizePass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.7, 0.5, 0.9);
  bloom.enabled = Q.bloom;
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /* ================= overlay + interaction ================= */
  const ov = $<HTMLCanvasElement>("ov"),
    octx = ov.getContext("2d")!;
  const monoFont =
    getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() ||
    "'IBM Plex Mono', monospace";
  let OW = 0,
    OH = 0,
    ODPR = 1;
  const panel = $("panel"),
    pBody = $("pBody");
  function applyOffset() {
    const open = !panel.hidden;
    if (open && innerWidth > 760) {
      const w = panel.getBoundingClientRect().width || Math.min(660, innerWidth * 0.5);
      camera.setViewOffset(innerWidth, innerHeight, w / 2, 0, innerWidth, innerHeight);
    } else if (open)
      camera.setViewOffset(innerWidth, innerHeight, 0, innerHeight * 0.29, innerWidth, innerHeight);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  function resize() {
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    applyOffset();
    camera.updateProjectionMatrix();
    ODPR = Math.min(devicePixelRatio, 2);
    OW = innerWidth;
    OH = innerHeight;
    ov.width = OW * ODPR;
    ov.height = OH * ODPR;
  }
  addEventListener("resize", resize);
  resize();

  let selected: Body | null = null,
    hovered: Body | null = null,
    starPanel = false;
  const fly = {
    active: false,
    t: 0,
    dur: 1,
    from: new THREE.Vector3(),
    fromT: new THREE.Vector3(),
    targetFn: (): THREE.Vector3 => new THREE.Vector3(),
    dist: 1,
    dir: new THREE.Vector3(),
    overview: false,
    follow: null as Body | null,
  };
  let follow: Body | null = null;
  const lastFollow = new THREE.Vector3();
  function project(v: THREE.Vector3) {
    tmpV.copy(v).project(camera);
    return { x: (tmpV.x * 0.5 + 0.5) * OW, y: (-tmpV.y * 0.5 + 0.5) * OH, z: tmpV.z };
  }
  function screenR(pos: THREE.Vector3, r: number) {
    const d = camera.position.distanceTo(pos);
    return ((r / d) * (OH / 2)) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  }
  function* screenBodies(): Generator<ScreenBody<Body | "star">> {
    for (const h of bodies) {
      const s = project(h.pos);
      const disk = screenR(h.pos, h.size);
      yield {
        item: h,
        x: s.x,
        y: s.y,
        z: s.z,
        disk,
        touch: Math.max(disk * 1.2, h.nature === "asteroid" ? 6 : 9),
        camDist: camera.position.distanceTo(h.pos),
      };
    }
    const s = project(starMesh.position);
    const disk = screenR(starMesh.position, STAR_R);
    yield {
      item: "star",
      x: s.x,
      y: s.y,
      z: s.z,
      disk,
      touch: Math.max(disk, 14),
      camDist: camera.position.distanceTo(starMesh.position),
    };
  }
  const pickAt = (x: number, y: number) => pickBody(x, y, screenBodies());
  const tip = $("tip");
  let down: { x: number; y: number } | null = null;
  glc.addEventListener("pointerdown", (e) => {
    down = { x: e.clientX, y: e.clientY };
  });
  glc.addEventListener("pointerup", (e) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) {
      const p = pickAt(e.clientX, e.clientY);
      if (p === "star") openStar();
      else if (p) focus(p);
    }
    down = null;
  });
  let lastMove = 0;
  // The label shows only after the cursor rests on a body for a moment, so
  // sweeping the mouse across a crowded sky does not flash labels.
  let tipTarget: Body | "star" | null = null;
  let tipTimer = 0;
  let tipXY = { x: 0, y: 0 };
  function tipHTML(p: Body | "star") {
    const tier = STAR_TIERS[star.tier] ?? tier0;
    return p === "star"
      ? `<b>$${esc(brand.ticker)}</b><small>${tier.name} · ${money(star.mcap)}</small>`
      : `<b>${esc(p.name)}</b><small>#${p.rank} · ${t.cls[p.cls]} · ${esc(p.eraLabel)}</small>`;
  }
  function hideTip() {
    clearTimeout(tipTimer);
    tipTarget = null;
    tip.hidden = true;
  }
  glc.addEventListener("pointermove", (e) => {
    if (e.buttons) {
      hideTip();
      return;
    }
    const now = performance.now();
    if (now - lastMove < 40) return;
    lastMove = now;
    let p = pickAt(e.clientX, e.clientY);
    // Hysteresis: keep the current hover until the cursor is clearly away,
    // so the label does not blink on and off at the edge of a planet.
    if (!p && hovered) {
      const s = project(hovered.pos);
      const rr = Math.max(
        screenR(hovered.pos, hovered.size) * 1.2,
        hovered.nature === "asteroid" ? 6 : 9,
      );
      if (s.z <= 1 && Math.hypot(s.x - e.clientX, s.y - e.clientY) < rr * 1.5) p = hovered;
    }
    setHover(p && p !== "star" ? p : null);
    glc.classList.toggle("hover", !!p);
    tipXY = { x: e.clientX, y: e.clientY };
    // The selected planet is already described in the mission page: no label over it.
    const want = p && p !== selected && e.pointerType === "mouse" ? p : null;
    if (want === tipTarget) {
      if (!tip.hidden) {
        tip.style.left = tipXY.x + "px";
        tip.style.top = tipXY.y + "px";
      }
      return;
    }
    hideTip();
    if (!want) return;
    tipTarget = want;
    tipTimer = window.setTimeout(() => {
      if (tipTarget !== want) return;
      tip.innerHTML = tipHTML(want);
      tip.style.left = tipXY.x + "px";
      tip.style.top = tipXY.y + "px";
      tip.hidden = false;
    }, 150);
  });
  glc.addEventListener("pointerleave", () => {
    hideTip();
    setHover(null);
  });
  function lineState(h: Body | null) {
    if (!h || !h.orbitLine) return;
    const on = h === selected || h === hovered;
    h.orbitLine.material = h === selected ? orbitMatHi : h === hovered ? orbitMatHov : orbitMat;
    h.orbitLine.visible = on || h.rank <= 50;
  }
  function setHover(h: Body | null) {
    if (hovered === h) return;
    const old = hovered;
    hovered = h;
    lineState(old);
    lineState(h);
  }
  function setSelected(h: Body | null) {
    const old = selected;
    selected = h;
    lineState(old);
    lineState(h);
  }
  controls.addEventListener("start", () => {
    if (fly.active) fly.active = false;
  });
  function flyTo(targetFn: () => THREE.Vector3, dist: number, dur = 1.8) {
    const from = camera.position.clone(),
      fromT = controls.target.clone();
    const dir = from.clone().sub(fromT).normalize();
    if (dir.y < 0.15) {
      dir.y = 0.25;
      dir.normalize();
    }
    Object.assign(fly, {
      active: true,
      t: 0,
      dur,
      from,
      fromT,
      targetFn,
      dist,
      dir,
      overview: false,
      follow: null,
    });
    follow = null;
  }
  function setUrl(path: string) {
    if (location.pathname !== path) history.replaceState(history.state, "", path + location.search);
  }

  /* ================= mission page ================= */
  /** Mission page of the selected planet: server card plus news pages loaded so far. */
  let card: PlanetCard | null = null;
  let news: NewsItem[] = [];
  let nextNews: string | null = null;
  let cardRequest = 0;
  // Owner form and "Report name" form on the open mission page.
  let editing = false;
  let editErr = "";
  let reporting = false;
  engineReady = true;

  async function loadCard(h: Body, keepScroll: boolean, fresh = false) {
    const req = ++cardRequest;
    let r: CardResult;
    try {
      r = await source.card(h.wallet, fresh);
    } catch {
      return;
    }
    if (req !== cardRequest || selected?.wallet !== h.wallet) return;
    if (r.status === "alive") {
      const fresh = card?.wallet !== h.wallet;
      card = r.card;
      // Keep pages the visitor already opened; put the newest first.
      const seen = new Set(r.card.news.map((n) => n.id));
      news = fresh ? r.card.news : [...r.card.news, ...news.filter((n) => !seen.has(n.id))];
      if (fresh)
        nextNews = r.card.news.length < r.card.newsTotal ? (r.card.news.at(-1)?.id ?? null) : null;
      // A live refresh must not wipe what the owner is typing.
      if (!editing && !reporting) renderPanel(!keepScroll);
    } else if (r.status === "dead") {
      pBody.innerHTML = deadPanelHTML(r);
      bindPanel();
    }
  }

  function focus(h: Body, close = false) {
    hideTip();
    if (selected?.wallet !== h.wallet) {
      card = null;
      news = [];
      nextNews = null;
      editing = reporting = false;
      editErr = "";
    }
    setSelected(h);
    starPanel = false;
    renderPanel(true);
    void loadCard(h, false);
    setUrl(`/planet/${h.wallet}`);
    controls.minDistance = h.size * 1.6;
    const k = innerWidth < 760 ? 1.8 : 1;
    flyTo(() => h.pos, h.size * (close ? 2.8 : 7) * k, close ? 1.2 : 1.9);
    fly.follow = h;
  }
  function openStar() {
    setSelected(null);
    starPanel = true;
    renderPanel(true);
    setUrl("/");
    controls.minDistance = STAR_R * 1.5;
    flyTo(() => starMesh.position, STAR_R * 7, 1.6);
    fly.follow = null;
  }
  function overview() {
    closePanel();
    controls.minDistance = 8;
    flyTo(() => new THREE.Vector3(), 1, 2.2);
    fly.overview = true;
  }
  $("zIn").onclick = () => {
    fly.active = false;
    const d = camera.position.clone().sub(controls.target);
    camera.position.copy(controls.target).add(d.multiplyScalar(0.65));
  };
  $("zOut").onclick = () => {
    fly.active = false;
    const d = camera.position.clone().sub(controls.target);
    if (d.length() < 2200) camera.position.copy(controls.target).add(d.multiplyScalar(1.5));
  };
  $("zFit").onclick = overview;

  function closePanel() {
    panel.hidden = true;
    applyOffset();
    document.body.classList.remove("panel-open");
    setSelected(null);
    starPanel = false;
    follow = null;
    fly.follow = null;
    controls.minDistance = 8;
    card = null;
    setUrl("/");
  }
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) closePanel();
  });
  function bindPanel() {
    $("pBack").onclick = closePanel;
    pBody.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach(
      (b) =>
        (b.onclick = async () => {
          const label = b.textContent;
          try {
            await navigator.clipboard.writeText(b.dataset.copy!);
            b.textContent = t.copied;
          } catch {
            const s = getSelection()!,
              rg = document.createRange();
            rg.selectNodeContents(b.previousElementSibling!);
            s.removeAllRanges();
            s.addRange(rg);
            b.textContent = t.selectedT;
          }
          setTimeout(() => (b.textContent = label), 1500);
        }),
    );
  }
  /* ================= wallet: customisation and reports ================= */
  async function send(method: string, path: string, body?: unknown) {
    const res = await fetch(path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
    const j = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; retryAt?: number };
    };
    if (!res.ok) {
      const e = j.error;
      const when = e?.retryAt ? ` (${new Date(e.retryAt).toLocaleString(LOCALE)})` : "";
      throw new Error((e?.message ?? "Something went wrong, try again") + when);
    }
  }

  /** After a change of names: the card, the labels and the feed show them at once. */
  function refreshNames(h: Body) {
    void loadCard(h, true, true);
    void source
      .load()
      .then((d) => setWorld(d))
      .catch(() => undefined);
  }

  function bindOwnerForms(h: Body, c: PlanetCard) {
    const val = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
    const customize = document.getElementById("customize");
    if (customize)
      customize.onclick = () => {
        editing = true;
        editErr = "";
        renderPanel();
        (document.getElementById("fName") as HTMLInputElement | null)?.focus();
      };
    const form = document.getElementById("editForm") as HTMLFormElement | null;
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        form.querySelectorAll("button").forEach((b) => b.setAttribute("disabled", ""));
        try {
          await send("PUT", `/api/planet/${c.wallet}/custom`, {
            name: val("fName"),
            species: val("fSpecies"),
            capital: val("fCapital"),
            motto: val("fMotto"),
          });
          editing = false;
          account.toast(t.saved);
          refreshNames(h);
        } catch (err) {
          editErr = err instanceof Error ? err.message : String(err);
          // Keep what was typed.
          const typed = ["fName", "fSpecies", "fCapital", "fMotto"].map(val);
          renderPanel();
          ["fName", "fSpecies", "fCapital", "fMotto"].forEach(
            (id, i) => ((document.getElementById(id) as HTMLInputElement).value = typed[i]!),
          );
        }
      };
      $("editCancel").onclick = () => {
        editing = false;
        editErr = "";
        renderPanel();
      };
      const reset = document.getElementById("editReset");
      if (reset)
        reset.onclick = async () => {
          try {
            await send("DELETE", `/api/planet/${c.wallet}/custom`);
            editing = false;
            account.toast(t.restored);
            refreshNames(h);
          } catch (err) {
            editErr = err instanceof Error ? err.message : String(err);
            renderPanel();
          }
        };
    }
    const report = document.getElementById("reportName");
    if (report)
      report.onclick = () => {
        reporting = true;
        renderPanel();
        (document.getElementById("rReason") as HTMLInputElement | null)?.focus();
      };
    const rForm = document.getElementById("reportForm") as HTMLFormElement | null;
    if (rForm) {
      rForm.onsubmit = async (e) => {
        e.preventDefault();
        try {
          await send("POST", `/api/planet/${c.wallet}/report`, { reason: val("rReason") });
          account.toast(t.reported);
        } catch (err) {
          account.toast(err instanceof Error ? err.message : String(err));
        }
        reporting = false;
        renderPanel();
      };
      $("reportCancel").onclick = () => {
        reporting = false;
        renderPanel();
      };
    }
  }

  function renderPanel(reset = false) {
    const keep = pBody.scrollTop;
    const wasHidden = panel.hidden;
    panel.hidden = false;
    document.body.classList.add("panel-open");
    if (wasHidden) requestAnimationFrame(applyOffset);
    applyOffset();
    if (starPanel) pBody.innerHTML = starPanelHTML(info());
    else if (selected) {
      const h = selected;
      if (card && card.wallet === h.wallet) {
        pBody.innerHTML = planetPanelHTML(
          card,
          news,
          !!nextNews,
          { ticker: brand.ticker },
          { live: source.live, me: account.me.wallet, editing, editErr, reporting },
        );
        bindOwnerForms(h, card);
        const closeUp = document.getElementById("closeUp");
        if (closeUp) closeUp.onclick = () => focus(h, true);
        const mn = document.getElementById("moreNews");
        if (mn)
          mn.onclick = async () => {
            if (!nextNews) return;
            mn.setAttribute("disabled", "");
            const page = await source.moreNews(h.wallet, nextNews);
            news = [...news, ...page.items];
            nextNews = page.next;
            renderPanel();
          };
      } else {
        // While the card loads: name and position are known already.
        pBody.innerHTML = `<button class="back" id="pBack">← ${t.back}</button><header class="m-head"><div class="crumbs">${t.system} / ${t.clsPl[h.cls]} / #${h.rank}</div><h2>${esc(h.name)}</h2><div class="status"><span class="live"></span>${esc(h.eraLabel)}</div></header>`;
      }
    }
    bindPanel();
    pBody.scrollTop = reset ? 0 : keep;
    if (reset) $("pBack").focus({ preventScroll: true });
  }

  /* ================= global feed ================= */
  const gfeedEl = $("gfeed");
  let gitems: FeedItem[] = [];
  function gfeedRender() {
    const now = Date.now();
    gfeedEl.innerHTML = gitems
      .slice(0, 4)
      .map((g, i) => {
        const k = KIND[g.kind];
        const [hd] = splitNews(g.text);
        const p = byWallet.get(g.wallet);
        const where = p
          ? `${esc(p.name)} · #${p.rank} · ${t.cls[p.cls]}`
          : `${esc(g.planet.name)}${g.planet.rank ? ` · #${g.planet.rank}` : ""}`;
        return `<li><button data-i="${i}"><span class="meta"><span class="tag t-${k}">${TAG[k]}</span><time>${agoText(g.at, now)}</time></span><span class="hl">${esc(hd)}</span><span class="pl">${where}</span></button></li>`;
      })
      .join("");
    gfeedEl.querySelectorAll<HTMLButtonElement>("button").forEach(
      (b) =>
        (b.onclick = () => {
          const h = byWallet.get(gitems[+b.dataset.i!]!.wallet);
          if (h) focus(h);
        }),
    );
  }
  setInterval(() => {
    if (gitems.length) gfeedRender();
  }, 60000);

  /* ================= search ================= */
  const help = $("searchHelp");
  const searchInput = $<HTMLInputElement>("search");
  function helpDefault(err = "") {
    help.innerHTML = `${err ? `<span class="err">${esc(err)}</span>` : ""}<button type="button" class="rnd">${t.random}</button><button type="button" id="topBtn">${t.top1}</button>`;
    help.querySelector<HTMLButtonElement>(".rnd")!.onclick = () => {
      const pool = planets.filter((h) => h.era >= 2 || h.rank <= 200);
      const h = pool[Math.floor(Math.random() * pool.length)];
      if (!h) return;
      searchInput.value = h.wallet;
      focus(h);
    };
    $("topBtn").onclick = () => {
      const h = bodies.find((x) => x.rank === 1);
      if (!h) return;
      searchInput.value = h.wallet;
      focus(h);
    };
  }
  function findBody(q: string): Body | undefined {
    const ql = q.toLowerCase();
    let h = byWallet.get(q) || bodies.find((x) => x.name.toLowerCase() === ql);
    if (!h && q.length >= 4)
      h = bodies.find(
        (x) => x.wallet.toLowerCase().includes(ql) || x.name.toLowerCase().includes(ql),
      );
    return h;
  }
  $("searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = searchInput.value.trim();
    if (!q) {
      helpDefault();
      return;
    }
    const h = findBody(q);
    if (h) {
      helpDefault();
      focus(h);
    } else helpDefault(t.notFound);
  });

  /* ================= HUD ================= */
  const pad2 = (n: number) => String(n).padStart(2, "0");
  function tele() {
    const n = new Date();
    $("tUtc").textContent = n.toISOString().slice(11, 19);
    const ms = Math.max(0, n.getTime() - missionStart);
    const d = Math.floor(ms / DAY_MS),
      hh = Math.floor((ms % DAY_MS) / 3600000),
      mm = Math.floor((ms % 3600000) / 60000),
      ss = Math.floor((ms % 60000) / 1000);
    $("tMet").textContent = `T+${d}d ${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
  }
  tele();
  setInterval(tele, 1000);
  $("brandLink").onclick = (e) => {
    e.preventDefault();
    overview();
  };

  /* ================= world + live updates ================= */
  setWorld(first);
  applyStar();
  helpDefault();
  void source.feed().then((items) => {
    gitems = items;
    gfeedRender();
  });
  let refreshTimer = 0;
  source.start({
    onNews(item) {
      gitems = [item, ...gitems.filter((g) => g.id !== item.id)].slice(0, 12);
      gfeedRender();
    },
    onPlanetEvent(wallet) {
      // The open mission page refreshes shortly after its planet changes.
      if (selected?.wallet !== wallet || refreshTimer) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = 0;
        if (selected?.wallet === wallet) void loadCard(selected, true, true);
      }, 1500);
    },
    onNewsText(id, text) {
      let feed = false;
      gitems = gitems.map((g) => (g.id === id ? ((feed = true), { ...g, text }) : g));
      if (feed) gfeedRender();
      // The open mission page picks it up on its refresh (onPlanetEvent).
      news = news.map((n) => (n.id === id ? { ...n, text } : n));
    },
    onScene(data) {
      star = data.star;
      setWorld(data);
      applyStar();
    },
    onStar(s) {
      star = { ...star, ...s };
      applyStar();
    },
  });

  /* ================= quality switch ================= */
  const qBtn = $<HTMLButtonElement>("qBtn");
  function qLabel() {
    const name = pref === "auto" ? `${t.qualityNames.auto}` : t.qualityNames[pref];
    qBtn.textContent = pref === "auto" ? `AUTO` : name.slice(0, 3).toUpperCase();
    qBtn.title = `${t.quality}: ${name}${pref === "auto" ? ` (${t.qualityNames[quality]})` : ""}`;
    qBtn.setAttribute("aria-label", qBtn.title);
  }
  function setQuality(q: Quality) {
    quality = q;
    Q = spec(q);
    renderer.setPixelRatio(dpr());
    composer.setPixelRatio(dpr());
    nearStarsMat.uniforms.uDpr!.value = renderer.getPixelRatio();
    bloom.enabled = Q.bloom;
    bakeSky(Q.skyRes);
    buildNearStars(Q.nearStars);
    resize();
    qLabel();
  }
  qBtn.onclick = () => {
    pref = PREF_ORDER[(PREF_ORDER.indexOf(pref) + 1) % PREF_ORDER.length]!;
    savePref(pref);
    setQuality(pref === "auto" ? auto() : pref);
  };
  qLabel();
  const governor = new FpsGovernor(() => {
    if (pref !== "auto") return false;
    const i = QUALITY_ORDER.indexOf(quality);
    if (i >= QUALITY_ORDER.length - 1) return false;
    setQuality(QUALITY_ORDER[i + 1]!);
    return true;
  });

  /* ================= debug ================= */
  const meter = opts.debug ? $("fpsMeter") : null;
  if (meter) meter.hidden = false;
  let meterFrames = 0,
    meterTime = 0;
  if (opts.debug)
    (window as unknown as { __orbit: unknown }).__orbit = {
      focus,
      openStar,
      get bodies() {
        return bodies;
      },
      get planets() {
        return planets;
      },
      live: source.live,
      camera,
      renderer,
      scene,
      controls,
      THREE,
      composer,
    };

  /* ================= loop ================= */
  const clock = new THREE.Clock();
  let T = 0;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const OVERVIEW_POS = new THREE.Vector3(0, 270, 620);
  const intro = { t: 0, from: camera.position.clone(), to: OVERVIEW_POS.clone() };
  let introDone = false,
    frames = 0;
  let raf = 0;

  if (opts.initialWallet) {
    const h = byWallet.get(opts.initialWallet);
    if (h) {
      introDone = true;
      camera.position.copy(OVERVIEW_POS);
      focus(h);
    } else {
      // Maybe a planet that was destroyed: the server still knows its story.
      const r = await source.card(opts.initialWallet).catch(() => ({ status: "none" }) as const);
      if (r.status === "dead") {
        panel.hidden = false;
        document.body.classList.add("panel-open");
        pBody.innerHTML = deadPanelHTML(r);
        bindPanel();
        applyOffset();
      } else {
        searchInput.value = opts.initialWallet;
        helpDefault(t.notFound);
        setUrl("/");
      }
    }
  }

  function animate() {
    const realDt = clock.getDelta();
    const dt = Math.min(realDt, 0.05);
    T += dt;
    const sp = reduce ? 0.3 : 1;
    starMat.uniforms.uTime!.value = T;
    nearStarsMat.uniforms.uTime!.value = T;
    const tSec = missionSeconds() * sp;
    const pos = dots!.geometry.attributes.position!.array as Float32Array;
    bodies.forEach((h, i) => {
      const ang = h.ang0 + h.speed * tSec;
      h.pos.set(Math.cos(ang) * h.orbit, 0, Math.sin(ang) * h.orbit).applyQuaternion(h.q);
      pos[i * 3] = h.pos.x;
      pos[i * 3 + 1] = h.pos.y;
      pos[i * 3 + 2] = h.pos.z;
      // Size follows the rank smoothly.
      const target = sizeOf(h.rank);
      if (Math.abs(target - h.size) > 1e-4) h.size += (target - h.size) * Math.min(1, dt * 1.5);
    });
    dots!.geometry.attributes.position!.needsUpdate = true;
    const hiAllowed = Q.maxDetail === "hi";
    for (const h of planets) {
      h.group!.position.copy(h.pos);
      h.group!.scale.setScalar(h.size);
      const px = screenR(h.pos, h.size);
      const u = h.mesh!.material.uniforms;
      u.uPx!.value = px;
      u.uTime!.value = T;
      u.uSize!.value = h.size;
      if (h.ringMat) h.ringMat.uniforms.uR!.value = h.size;
      const g = px > 70 && hiAllowed ? geoHi : px > 14 ? geoMid : geoLo;
      if (h.mesh!.geometry !== g) {
        h.mesh!.geometry = g;
        h.atmo!.geometry = g;
      }
      h.atmoMat!.uniforms.uFade!.value = clamp((px - 3) / 14, 0, 1);
      if (h.sats) {
        const o = clamp((px - 8) / 30, 0, 1);
        h.sats.visible = o > 0;
        h.sats.material.opacity = 0.95 * o;
        h.sats.material.size = Math.max(0.03, h.size * 0.022);
        h.sats.rotation.y += h.sats.userData.spin * dt * sp;
      }
      h.mesh!.rotation.y += h.spin * dt * sp;
    }
    for (const h of asteroids) {
      h.astRot!.x += h.astSpin! * dt * 0.3 * sp;
      h.astRot!.y += h.astSpin! * dt * 0.2 * sp;
      astDummy.position.copy(h.pos);
      astDummy.rotation.copy(h.astRot!);
      astDummy.scale.copy(h.astShape!).multiplyScalar(h.size);
      astDummy.updateMatrix();
      astMesh!.setMatrixAt(h.idx!, astDummy.matrix);
    }
    astMesh!.instanceMatrix.needsUpdate = true;
    const now = Date.now();
    for (const d of debris) {
      const ang = d.ang0 + d.speed * tSec;
      d.pts.position
        .set(Math.cos(ang) * d.d.orbit, 0, Math.sin(ang) * d.d.orbit)
        .applyQuaternion(d.q);
      d.pts.rotation.y += dt * 0.05 * sp;
      // Fades out over 24 hours.
      (d.pts.material as THREE.PointsMaterial).opacity =
        0.8 * clamp(1 - (now - d.d.endedAt) / DAY_MS, 0, 1);
    }
    if (!introDone) {
      intro.t = Math.min(1, intro.t + dt / 3.2);
      camera.position.lerpVectors(intro.from, intro.to, ease(intro.t));
      controls.target.set(0, 0, 0);
      if (intro.t >= 1) introDone = true;
    }
    if (fly.active) {
      fly.t = Math.min(1, fly.t + dt / fly.dur);
      const e = ease(fly.t);
      const tgt = fly.targetFn();
      const endPos = fly.overview
        ? OVERVIEW_POS.clone()
        : tgt.clone().add(fly.dir.clone().multiplyScalar(fly.dist));
      controls.target.lerpVectors(fly.fromT, tgt, e);
      camera.position.lerpVectors(fly.from, endPos, e);
      if (fly.t >= 1) {
        fly.active = false;
        fly.overview = false;
        if (fly.follow) {
          follow = fly.follow;
          lastFollow.copy(follow.pos);
        }
      }
    } else if (follow) {
      const d = follow.pos.clone().sub(lastFollow);
      camera.position.add(d);
      controls.target.add(d);
      lastFollow.copy(follow.pos);
    }
    controls.enablePan = !follow && !fly.active;
    controls.update();
    composer.render();
    drawOverlay();
    if (++frames === 3) {
      loading.classList.add("gone");
      clearTimeout(slowTimer);
    }
    if (pref === "auto") governor.tick(realDt);
    if (meter) {
      meterFrames++;
      meterTime += realDt;
      if (meterTime >= 0.5) {
        meter.textContent = `${Math.round(meterFrames / meterTime)} FPS · ${quality.toUpperCase()} · DPR ${renderer.getPixelRatio()} · BLOOM ${bloom.enabled ? "ON" : "OFF"} · SKY ${Q.skyRes} · FILTER ${sanitizePass.enabled ? "ON" : "OFF"} · ${source.live ? "LIVE" : "DEMO"}`;
        meterFrames = 0;
        meterTime = 0;
      }
    }
    raf = requestAnimationFrame(animate);
  }
  function drawOverlay() {
    octx.setTransform(ODPR, 0, 0, ODPR, 0, 0);
    octx.clearRect(0, 0, OW, OH);
    octx.textAlign = "left";
    octx.textBaseline = "middle";
    const list: [Body, { x: number; y: number; z: number }][] = [];
    for (const h of planets) {
      if (h.rank > 10 && h !== selected && h !== hovered) continue;
      const s = project(h.pos);
      if (s.z > 1 || s.x < -40 || s.x > OW + 40 || s.y < -40 || s.y > OH + 40) continue;
      list.push([h, s]);
    }
    for (const h of [selected, hovered]) {
      if (h && h.nature === "asteroid") {
        const s = project(h.pos);
        if (s.z < 1) list.push([h, s]);
      }
    }
    for (const [h, s] of list) {
      const R = Math.max(screenR(h.pos, h.size), 2.5),
        sel = h === selected,
        hov = h === hovered;
      if (sel || hov) {
        const b = R * 1.2 + 9,
          l = Math.max(5, Math.min(14, b * 0.4));
        octx.strokeStyle = sel ? "#fc3d21" : "rgba(255,255,255,.85)";
        octx.lineWidth = 1.3;
        octx.beginPath();
        for (const [sx, sy] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ] as const) {
          const cx = s.x + sx * b,
            cy = s.y + sy * b;
          octx.moveTo(cx, cy - sy * l);
          octx.lineTo(cx, cy);
          octx.lineTo(cx - sx * l, cy);
        }
        octx.stroke();
      }
      if (R > 60 && sel) continue;
      const x0 = s.x + R * 0.72 + 2,
        y0 = s.y - R * 0.72 - 2,
        x1 = x0 + 14,
        y1 = y0 - 14;
      octx.strokeStyle = sel ? "rgba(252,61,33,.9)" : "rgba(255,255,255,.38)";
      octx.lineWidth = 1;
      octx.beginPath();
      octx.moveTo(x0, y0);
      octx.lineTo(x1, y1);
      octx.lineTo(x1 + 8, y1);
      octx.stroke();
      octx.font = `600 10.5px ${monoFont}`;
      octx.fillStyle = sel ? "#fff" : "rgba(255,255,255,.82)";
      octx.fillText(h.name.toUpperCase(), x1 + 12, y1);
      octx.font = `400 9.5px ${monoFont}`;
      octx.fillStyle = sel ? "rgba(252,61,33,.95)" : "rgba(160,166,178,.75)";
      octx.fillText(`#${h.rank} · ${t.cls[h.cls].toUpperCase()}`, x1 + 12, y1 + 13);
    }
  }

  // Do not render while the tab is hidden.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (!raf) {
      clock.getDelta();
      raf = requestAnimationFrame(animate);
    }
  });
  raf = requestAnimationFrame(animate);
}
