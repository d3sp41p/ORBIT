/**
 * Post-processing guard between the scene render and bloom. Some GPUs return
 * NaN or overflow (Inf in half-float targets) for a few pixels, e.g. pow() of
 * a tiny negative base in the atmosphere shader. Bloom blurs that single pixel
 * across every mip level and the whole frame turns black for a moment.
 * This pass replaces such pixels with black so one bad pixel stays one pixel.
 * The prototype shaders stay unchanged.
 */
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

export const SanitizeShader = {
  name: "SanitizeShader",
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // NaN fails every comparison, Inf fails the bound: both count as bad.
      bool ok = all(lessThan(abs(c), vec4(60000.0))) && !any(isnan(c));
      gl_FragColor = ok ? c : vec4(0.0, 0.0, 0.0, 1.0);
    }`,
};

export const createSanitizePass = () => new ShaderPass(SanitizeShader);
