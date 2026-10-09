/**
 * Share images (spec: "Sharing"): 1200x630, black space, one accent colour.
 * Rendered on the server with next/og; English only.
 */
import { eraName, planetName, type PlanetClass } from "@orbit/core";
import { ImageResponse } from "next/og";
import { loadPlanet } from "./api";
import { launched } from "./db";
import { getPublicToken } from "./token";
import { copy as t } from "@/orbit/copy";

export const OG_SIZE = { width: 1200, height: 630 };

const SIGNAL = "#fc3d21";
const MUTE = "#8a8f99";

/** Planet colours by nature: lit side, shadow side. */
const PALETTE: Record<PlanetClass, [string, string, string]> = {
  rocky: ["#7fb8d8", "#2f6b4f", "#0b1a24"],
  super: ["#e0b98a", "#9a5a3a", "#1d0f0a"],
  gas: ["#f2c58c", "#c46a35", "#24120a"],
  ice: ["#c9f0ff", "#4f9fc4", "#071c26"],
  asteroid: ["#b9b2a8", "#6b645c", "#141210"],
};

/** Stars as tiny dots, the same on every image (seeded). */
function stars() {
  let x = 7;
  const r = () => (x = (x * 9301 + 49297) % 233280) / 233280;
  return Array.from({ length: 70 }, (_, i) => ({
    key: i,
    left: Math.round(r() * 1200),
    top: Math.round(r() * 630),
    size: r() < 0.15 ? 3 : 2,
    opacity: 0.25 + r() * 0.6,
  }));
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        background: "radial-gradient(circle at 78% 50%, #10141c 0%, #000 60%)",
        color: "#fff",
        fontFamily: "sans-serif",
      }}
    >
      {stars().map((s) => (
        <div
          key={s.key}
          style={{
            position: "absolute",
            left: s.left,
            top: s.top,
            width: s.size,
            height: s.size,
            borderRadius: 2,
            background: "#fff",
            opacity: s.opacity,
          }}
        />
      ))}
      {children}
    </div>
  );
}

function Planet({ nature, size }: { nature: PlanetClass; size: number }) {
  const [lit, mid, dark] = PALETTE[nature];
  return (
    <div
      style={{
        position: "absolute",
        right: 120,
        top: 315 - size / 2,
        width: size,
        height: size,
        display: "flex",
      }}
    >
      {/* orbit */}
      <div
        style={{
          position: "absolute",
          left: -size * 0.35,
          top: size * 0.32,
          width: size * 1.7,
          height: size * 0.36,
          borderRadius: "50%",
          border: `2px solid ${SIGNAL}`,
          opacity: 0.85,
        }}
      />
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: `radial-gradient(circle at 32% 30%, ${lit} 0%, ${mid} 45%, ${dark} 80%)`,
          boxShadow: `0 0 80px ${mid}55`,
        }}
      />
    </div>
  );
}

function Brand() {
  return (
    <div
      style={{
        position: "absolute",
        left: 72,
        top: 64,
        display: "flex",
        alignItems: "center",
        gap: 14,
        fontSize: 22,
        letterSpacing: 6,
      }}
    >
      <div style={{ width: 12, height: 12, borderRadius: 6, background: SIGNAL }} />
      <b>ORBIT</b>
      <span style={{ color: MUTE, fontSize: 18, letterSpacing: 4 }}>{t.agency.toUpperCase()}</span>
    </div>
  );
}

export interface OgPlanet {
  name: string;
  nature: PlanetClass;
  cls: PlanetClass;
  era: string | null;
  rank: number | null;
  of: number | null;
  days: number | null;
}

/** Facts for a planet's image: live data after launch, the stock name before. */
export async function ogPlanet(wallet: string): Promise<OgPlanet> {
  const base: OgPlanet = {
    name: planetName(wallet),
    nature: "rocky",
    cls: "rocky",
    era: null,
    rank: null,
    of: null,
    days: null,
  };
  try {
    if (!(await launched())) return base;
    const r = await loadPlanet(wallet);
    if (r.status === "dead") return { ...base, name: r.name, era: "Destroyed" };
    if (r.status !== "alive") return base;
    const c = r.card;
    return {
      name: c.name,
      nature: c.nature,
      cls: c.cls,
      era: eraName(c.state.era, { cls: c.nature, waterMax: c.state.waterMax }),
      rank: c.rank,
      of: c.holdersCount,
      days: Math.floor(c.days),
    };
  } catch {
    return base;
  }
}

export async function planetImage(p: OgPlanet) {
  const token = await getPublicToken();
  const facts = [
    t.cls[p.cls],
    p.era,
    p.rank ? `#${p.rank}${p.of ? ` of ${p.of.toLocaleString("en-US")}` : ""}` : null,
    p.days !== null ? `Day ${p.days}` : null,
  ].filter(Boolean) as string[];
  return new ImageResponse(
    <Frame>
      <Brand />
      <Planet nature={p.nature} size={300} />
      <div
        style={{
          position: "absolute",
          left: 72,
          top: 200,
          width: 620,
          display: "flex",
          flexDirection: "column",
          gap: 22,
        }}
      >
        <span style={{ color: SIGNAL, fontSize: 22, letterSpacing: 6 }}>MISSION PAGE</span>
        <b style={{ fontSize: p.name.length > 16 ? 72 : 92, lineHeight: 1, letterSpacing: -2 }}>
          {p.name}
        </b>
        <span style={{ fontSize: 30, color: "#d6d9df" }}>{facts.join("  ·  ")}</span>
      </div>
      <span
        style={{
          position: "absolute",
          left: 72,
          bottom: 56,
          fontSize: 22,
          color: MUTE,
          letterSpacing: 2,
        }}
      >
        {`Every holder of $${token.ticker} is a world  ·  Powered by Claude`}
      </span>
    </Frame>,
    OG_SIZE,
  );
}

export async function siteImage() {
  const token = await getPublicToken();
  return new ImageResponse(
    <Frame>
      <Brand />
      <Planet nature="gas" size={280} />
      <div
        style={{
          position: "absolute",
          left: 72,
          top: 200,
          width: 640,
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        <span style={{ color: SIGNAL, fontSize: 22, letterSpacing: 6 }}>
          HOLDER EXPLORATION PROGRAM
        </span>
        <b style={{ fontSize: 78, lineHeight: 1.02, letterSpacing: -2 }}>
          Every holder is a world.
        </b>
        <span style={{ fontSize: 28, color: "#d6d9df" }}>
          {`A live star system built from $${token.ticker}`}
        </span>
        <span style={{ marginTop: 18, fontSize: 20, color: "#f2b33d", letterSpacing: 5 }}>
          POWERED BY CLAUDE
        </span>
      </div>
    </Frame>,
    OG_SIZE,
  );
}
