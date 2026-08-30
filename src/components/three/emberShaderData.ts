// GLSL source for WebglEmberGallery.tsx's 6 shader-based ember-border
// candidates (2026-08-30) -- kept in its own .ts file (not .tsx) since a
// file mixing plain string exports and a component export would otherwise
// be fine, but this one's already sizeable and the gallery file is easier
// to read without a wall of template-literal shader strings inline.

export const GLSL_UTILS = `
  float sdRoundRect(vec2 p, vec2 halfSize, float radius) {
    vec2 q = abs(p) - halfSize + radius;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  }
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }
`

export const PLANE_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// 1. Plasma Energy Border -- flowing noise energy running around a rounded-
// rect SDF border band, angle-driven so the flow visibly circulates rather
// than just flickering in place.
export const FRAG_PLASMA = `
  ${GLSL_UTILS}
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float d = sdRoundRect(p, vec2(0.78), 0.24);
    float band = smoothstep(0.16, 0.0, abs(d + 0.03));
    float angle = atan(p.y, p.x);
    float flow = noise(vec2(angle * 2.5 - uTime * 1.4, uTime * 0.5));
    float energy = smoothstep(0.3, 0.95, flow);
    float alpha = band * (0.25 + energy * 1.1);
    vec3 col = uColor * (0.7 + energy * 1.3);
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`

// 2. Aurora Sweep -- soft color bands sweeping through the border ring.
export const FRAG_AURORA = `
  ${GLSL_UTILS}
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float d = sdRoundRect(p, vec2(0.78), 0.24);
    float band = smoothstep(0.2, 0.0, abs(d + 0.02));
    float wave = sin(vUv.x * 6.0 + uTime * 1.8) * 0.5 + 0.5;
    vec3 col = mix(uColor * 0.6, uColor * 1.6 + vec3(0.15), wave);
    float alpha = band * (0.5 + wave * 0.5);
    gl_FragColor = vec4(col, alpha);
  }
`

// 3. Fresnel Glass Rim -- brighter at the edges, fading toward the center,
// like light catching the rim of a polished glass button.
export const FRAG_FRESNEL = `
  ${GLSL_UTILS}
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float d = sdRoundRect(p, vec2(0.72), 0.26);
    float rim = 1.0 - smoothstep(0.0, 0.55, abs(d));
    float pulse = 0.65 + 0.35 * sin(uTime * 1.6);
    gl_FragColor = vec4(uColor * 1.3, rim * pulse);
  }
`

// 4. Radial Pulse Wave -- concentric rings emanating outward, fading near
// the tile's edge.
export const FRAG_PULSE = `
  ${GLSL_UTILS}
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float dist = length(p);
    float ring = fract(dist * 2.5 - uTime * 0.7);
    float band = smoothstep(0.0, 0.06, ring) - smoothstep(0.35, 0.45, ring);
    float fade = smoothstep(1.15, 0.35, dist);
    gl_FragColor = vec4(uColor * 1.2, band * fade);
  }
`

// 5. Chromatic Rim -- RGB-channel-offset border sampling for a subtle
// sci-fi chromatic-aberration edge.
export const FRAG_CHROMA = `
  ${GLSL_UTILS}
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    // Offset large enough (0.05 of the -1..1 span) to actually read as
    // color-fringed at a ~96px tile -- an earlier 0.014 offset was
    // sub-pixel at this resolution and just looked like a plain white ring.
    float dR = sdRoundRect(p - vec2(0.05, 0.0), vec2(0.78), 0.24);
    float dG = sdRoundRect(p, vec2(0.78), 0.24);
    float dB = sdRoundRect(p + vec2(0.05, 0.0), vec2(0.78), 0.24);
    float bandR = smoothstep(0.1, 0.0, abs(dR + 0.02));
    float bandG = smoothstep(0.1, 0.0, abs(dG + 0.02));
    float bandB = smoothstep(0.1, 0.0, abs(dB + 0.02));
    float pulse = 0.7 + 0.3 * sin(uTime * 2.0);
    float coverage = clamp(bandR + bandG + bandB, 0.0, 1.0);
    // Tint the split channels toward uColor rather than raw RGB primaries,
    // so it reads as "this event's color with a chromatic edge" instead of
    // a color-neutral rainbow fringe.
    vec3 rgbSplit = mix(vec3(bandR, bandG, bandB), uColor, 0.5) * pulse;
    vec3 col = rgbSplit + uColor * 0.25 * coverage;
    gl_FragColor = vec4(col, coverage * 0.85);
  }
`

// 6. Particle Halo -- real GPU point sprites orbiting the border (as
// opposed to the CSS gallery's DOM-span "Comet Orbit Dot", this one gets
// true additive blending + bloom instead of a stacked box-shadow).
export const POINT_VERTEX = `
  attribute float aSize;
  varying float vSize;
  void main() {
    vSize = aSize;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * 260.0 / max(0.001, -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`

export const POINT_FRAGMENT = `
  uniform vec3 uColor;
  varying float vSize;
  void main() {
    vec2 c = gl_PointCoord - vec2(0.5);
    float d = length(c);
    float alpha = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(uColor * 1.4, alpha);
  }
`
