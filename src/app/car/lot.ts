// The set the car sits on: an empty parking lot at night, after rain. The
// ground is lit asphalt with a mirror (Reflector) laid just above it; the
// mirror's shader blurs, streaks and fades the reflection by a procedural
// puddle mask, so the car's lights smear across the wet ground the way they
// do in real life.
//
// Layout (meters, x = forward, z = right): the car is backed into a stall,
// facing +x toward the driving aisle, with a planted island just behind it.
// The lot repeats every MODULE meters along x: island, a row of stalls, a
// driving aisle, and a row backing onto the next island. Our row starts at
// the island edge x = -HEAD_X.

import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

const HEAD_X = 2.9;
const ISLAND = 2;
const STALL_LENGTH = 5.8;
const STALL_WIDTH = 2.7;
const AISLE = 7;
const MODULE = ISLAND + 2 * STALL_LENGTH + AISLE;
const CURB_HEIGHT = 0.15;
// Poles stand in the islands, clear of the side and front camera views.
const POLE_Z = [-13.5, 13.5, -40.5, 40.5];
const LAMP_HEIGHT = 8;
const LAMP_COLOR = new THREE.Color('#ffe0b5');
const f = (n: number) => n.toFixed(3);

// Value noise and fbm shared by the asphalt and the mirror, so puddles line
// up in both.
const NOISE_GLSL = /* glsl */ `
  float st_hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float st_noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(st_hash(i), st_hash(i + vec2(1.0, 0.0)), u.x),
               mix(st_hash(i + vec2(0.0, 1.0)), st_hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float st_fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * st_noise(p);
      p = p * 2.03 + 17.1;
      a *= 0.5;
    }
    return v;
  }
  /** 1 in standing water, 0 on merely damp asphalt. */
  float st_puddle(vec2 p) {
    return smoothstep(0.5, 0.62, st_fbm(p * 0.32 + vec2(3.7, 1.3)));
  }
  /** Stall lines: 1 on a line. They run along x, between stalls, in both rows of each module. */
  vec3 st_paint(vec2 p) {
    float u = mod(-p.x - ${f(HEAD_X)}, ${f(MODULE)});
    float inRow = step(${f(ISLAND)}, u) * step(u, ${f(ISLAND + STALL_LENGTH)}) + step(${f(ISLAND + STALL_LENGTH + AISLE)}, u);
    float w = (p.y - ${f(STALL_WIDTH / 2)}) / ${f(STALL_WIDTH)};
    float d = abs(w - floor(w + 0.5)) * ${f(STALL_WIDTH)};
    float line = (1.0 - smoothstep(0.05, 0.07, d)) * inRow;
    // Worn paint: break it up a little.
    float wear = 0.55 + 0.45 * smoothstep(0.2, 0.6, st_noise(p * 7.0));
    return vec3(line, 0.0, 0.0) * wear;
  }
`;

const MIRROR_SHADER = {
  name: 'WetLotMirror',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    fadeNear: { value: 14 },
    fadeFar: { value: 42 },
    strength: { value: 1.5 },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    varying float vDepth;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      vec4 mv = viewMatrix * world;
      vDepth = -mv.z;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float fadeNear;
    uniform float fadeFar;
    uniform float strength;
    varying vec4 vUv;
    varying vec3 vWorld;
    varying float vDepth;
    ${NOISE_GLSL}
    void main() {
      vec2 p = vWorld.xz;
      float puddle = st_puddle(p);
      float paint = max(st_paint(p).r, st_paint(p).g);
      // Ripples and grain bend the reflection; less so in standing water.
      vec2 grain = vec2(st_noise(p * 11.0), st_noise(p * 11.0 + 9.1)) - 0.5;
      vec2 uv = vUv.xy / vUv.w + grain * mix(0.018, 0.003, puddle);
      // Wet asphalt smears lights into vertical streaks; puddles keep them sharp.
      float spread = mix(0.016, 0.0025, puddle);
      float lod = mix(4.0, 0.6, puddle);
      vec3 sum = vec3(0.0);
      float total = 0.0;
      for (int i = -2; i <= 4; i++) {
        float w = exp(-float(i * i) * 0.18);
        sum += w * textureLod(tDiffuse, uv + vec2(0.0, float(i) * spread), lod).rgb;
        total += w;
      }
      vec3 reflection = sum / total;
      vec3 v = normalize(cameraPosition - vWorld);
      float fresnel = 0.02 + 0.98 * pow(1.0 - max(v.y, 0.0), 5.0);
      float amount = (0.4 + 0.6 * fresnel) * mix(0.5, 1.0, puddle) * mix(1.0, 0.55, paint);
      float fade = 1.0 - smoothstep(fadeNear, fadeFar, vDepth);
      gl_FragColor = vec4(reflection * amount * fade * strength, 1.0);
    }
  `,
};

export interface Lot {
  /** Matches the mirror's resolution to the canvas. */
  setSize(width: number, height: number): void;
  dispose(): void;
}

export function buildLot(scene: THREE.Scene): Lot {
  const group = new THREE.Group();
  group.name = 'lot';
  scene.add(group);
  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T) => (owned.push(x), x);

  // Lit asphalt underneath the mirror.
  // The mirror supplies the ground's reflections, so the sky map is off here.
  // Its own highlights are kept low too: broad glare from the fill lights
  // washed the whole lot out.
  const asphalt = own(
    new THREE.MeshPhysicalMaterial({ color: '#16181c', roughness: 0.6, metalness: 0, envMapIntensity: 0, specularIntensity: 0.12 }),
  );
  asphalt.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStreetWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvStreetWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vStreetWorld;\n${NOISE_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 sp = vStreetWorld.xz;
        float sPuddle = st_puddle(sp);
        vec3 sPaint = st_paint(sp);
        float sGrain = st_noise(sp * 38.0) * 0.6 + st_noise(sp * 4.0) * 0.4;
        diffuseColor.rgb *= mix(0.55, 1.25, sGrain);
        // Water darkens asphalt.
        diffuseColor.rgb *= mix(1.0, 0.45, sPuddle);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55), sPaint.r * 0.85);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.45, 0.08), sPaint.g * 0.85);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.08, sPuddle);`,
      );
  };
  const groundGeometry = own(new THREE.PlaneGeometry(120, 120));
  const ground = new THREE.Mesh(groundGeometry, asphalt);
  ground.rotation.x = -Math.PI / 2;
  ground.name = 'ground';
  group.add(ground);

  const mirror = new Reflector(groundGeometry, {
    textureWidth: 512,
    textureHeight: 512,
    multisample: 0,
    shader: MIRROR_SHADER,
  });
  mirror.name = 'groundMirror';
  mirror.rotation.x = -Math.PI / 2;
  mirror.position.y = 0.002;
  const mirrorMaterial = mirror.material as THREE.ShaderMaterial;
  mirrorMaterial.transparent = true;
  mirrorMaterial.blending = THREE.AdditiveBlending;
  mirrorMaterial.depthWrite = false;
  const target = mirror.getRenderTarget();
  // Mipmaps give the shader cheap blur levels for damp, rough asphalt.
  target.texture.generateMipmaps = true;
  target.texture.minFilter = THREE.LinearMipmapLinearFilter;
  group.add(mirror);

  // Planted islands at the head of each pair of rows: a concrete curb
  // around dark mulch, with the lot's light poles.
  const curb = own(new THREE.MeshStandardMaterial({ color: '#3a3c40', roughness: 0.6 }));
  const mulch = own(new THREE.MeshStandardMaterial({ color: '#121410', roughness: 0.95, envMapIntensity: 0.2 }));
  const curbGeometry = own(new THREE.BoxGeometry(ISLAND, CURB_HEIGHT, 120));
  const mulchGeometry = own(new THREE.BoxGeometry(ISLAND - 0.3, 0.01, 120));
  const pole = own(new THREE.MeshStandardMaterial({ color: '#2a2c30', roughness: 0.5, metalness: 0.4 }));
  const head = own(new THREE.MeshStandardMaterial({ color: '#000', emissive: LAMP_COLOR, emissiveIntensity: 2.2 }));
  const poleGeometry = own(new THREE.CylinderGeometry(0.07, 0.1, LAMP_HEIGHT, 10));
  const headGeometry = own(new THREE.BoxGeometry(0.7, 0.12, 0.7));
  const baseGeometry = own(new THREE.CylinderGeometry(0.25, 0.25, 0.5, 12));
  for (let k = -2; k <= 2; k++) {
    const x = -(HEAD_X + ISLAND / 2 + k * MODULE);
    const island = new THREE.Mesh(curbGeometry, curb);
    island.position.set(x, CURB_HEIGHT / 2, 0);
    const bed = new THREE.Mesh(mulchGeometry, mulch);
    bed.position.set(x, CURB_HEIGHT + 0.005, 0);
    group.add(island, bed);
    for (const z of POLE_Z) {
      const base = new THREE.Mesh(baseGeometry, curb);
      base.position.set(x, CURB_HEIGHT + 0.25, z);
      const post = new THREE.Mesh(poleGeometry, pole);
      post.position.set(x, CURB_HEIGHT + LAMP_HEIGHT / 2, z);
      const glow = new THREE.Mesh(headGeometry, head);
      glow.position.set(x, CURB_HEIGHT + LAMP_HEIGHT, z);
      group.add(base, post, glow);
      // Only the nearest island's lamps cast light; farther ones just glow.
      if (k === 0 || k === -1) {
        const light = new THREE.PointLight(LAMP_COLOR, 110, 30, 1.5);
        light.position.copy(glow.position).add(new THREE.Vector3(0, -0.3, 0));
        group.add(light);
      }
    }
  }

  return {
    setSize(width, height) {
      // Half resolution is plenty for a blurred reflection.
      target.setSize(Math.max(64, Math.round(width / 2)), Math.max(64, Math.round(height / 2)));
    },
    dispose() {
      mirror.dispose();
      for (const o of owned) o.dispose();
      scene.remove(group);
    },
  };
}

/**
 * A dim night sky for paint reflections: a dark gradient with a brighter
 * horizon and a few far-off lamps, so glossy paint reads as glossy without
 * bright studio panels that could be mistaken for the show's lights.
 */
export function lotEnvironment(): THREE.Scene {
  const env = new THREE.Scene();
  const sky = new THREE.SphereGeometry(50, 32, 16);
  const colors: number[] = [];
  const pos = sky.attributes.position as THREE.BufferAttribute;
  const zenith = new THREE.Color('#06080c');
  const horizon = new THREE.Color('#2a3446');
  const ground = new THREE.Color('#0a0b0d');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 50;
    if (y >= 0) c.lerpColors(horizon, zenith, Math.pow(y, 0.6));
    else c.lerpColors(horizon, ground, Math.min(1, -y * 4));
    colors.push(c.r, c.g, c.b);
  }
  sky.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  env.add(new THREE.Mesh(sky, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  // Large and dim: they should read as a soft glow on glossy paint, never
  // as a point of light that looks like part of the show.
  const lamp = new THREE.MeshBasicMaterial({ color: LAMP_COLOR.clone().multiplyScalar(0.5) });
  for (const [x, z, s] of [
    [-20, -8, 1],
    [22, -8, 1],
    [-6, 25, 0.7],
    [30, 18, 0.6],
    [-35, 12, 0.6],
  ] as const) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(6 * s, 1.5 * s, 4 * s), lamp);
    m.position.set(x, 9, z);
    env.add(m);
  }
  // A faint, broad glow overhead: the city beyond the lot.
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: '#1b2230', side: THREE.DoubleSide }));
  glow.rotation.x = Math.PI / 2;
  glow.position.y = 30;
  env.add(glow);
  return env;
}
