// 2024+ Model 3 ("Highland"): slim one-piece headlights, C-shaped tail lamps on the trunk lid.
// Coordinates: x forward, y up, z right (left is -z), meters, origin under the car's middle.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { centroid, createIO, mirrorBox, prepare } from '../lib.mjs';

const sides = (fn) => [fn('left', -1), fn('right', 1)];
/** A box given for the right side (z > 0), on the chosen side. */
const on = (s, box) => (s > 0 ? box : mirrorBox(box));

const source = {
  uid: '61ddcbdbd3854c239e0c95bf60b00022',
  title: '2024 Tesla Model 3 + Interior',
  author: 'tonielpro520',
  authorUrl: 'https://sketchfab.com/tonielpro520',
  url: 'https://sketchfab.com/3d-models/2024-tesla-model-3-interior-61ddcbdbd3854c239e0c95bf60b00022',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
};
const base = {
  source,
  front: '+z',
  lengthM: 4.72,
  // Game-style extras: a cracked-glass overlay on every pane and motion-blur discs in the wheels.
  drop: [{ mat: /DAMAGE_GLASS|Rim_Blur/ }],
};

// --- The trunk lid's paint ---------------------------------------------------
// The source has the rear bumper, rear fenders' ends and trunk lid as one welded mesh, so the lid
// can't be picked as a connected piece, and its seam to the bumper is curved, so boxes can't
// follow it either. The panel gaps are sharp creases, though: the mesh is split into smooth
// regions at its creases, the regions are sorted into lid and body, and the lid's triangles are
// turned into 'tri' rules (a handful of boxes that hold lid triangles only).

/** Splits a primitive into regions of triangles joined by edges that bend less than `deg`. */
function smoothRegions(p, deg) {
  const limit = Math.cos((deg * Math.PI) / 180);
  const count = p.indices.length / 3;
  const ids = new Map();
  const corners = [];
  const normals = [];
  for (let t = 0; t < count; t++) {
    const pts = [0, 1, 2].map((k) => [0, 1, 2].map((a) => p.positions[p.indices[t * 3 + k] * 3 + a]));
    corners.push(
      pts.map((q) => {
        const key = q.map((x) => Math.round(x / 2e-4)).join(',');
        if (!ids.has(key)) ids.set(key, ids.size);
        return ids.get(key);
      }),
    );
    const [u, v] = [1, 2].map((k) => pts[k].map((x, a) => x - pts[0][a]));
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...n) || 1;
    normals.push(n.map((x) => x / len));
  }
  const parent = Int32Array.from({ length: count }, (_, i) => i);
  const find = (a) => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  const byEdge = new Map();
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 3; k++) {
      const [a, b] = [corners[t][k], corners[t][(k + 1) % 3]].sort((x, y) => x - y);
      const other = byEdge.get(`${a}_${b}`);
      if (other === undefined) byEdge.set(`${a}_${b}`, t);
      else if (normals[t].reduce((sum, x, i) => sum + x * normals[other][i], 0) > limit) parent[find(t)] = find(other);
    }
  }
  const regions = new Map();
  for (let t = 0; t < count; t++) {
    let r = regions.get(find(t));
    if (!r) regions.set(find(t), (r = { tris: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }));
    r.tris.push(t);
    for (let k = 0; k < 3; k++) {
      for (let a = 0; a < 3; a++) {
        const x = p.positions[p.indices[t * 3 + k] * 3 + a];
        r.min[a] = Math.min(r.min[a], x);
        r.max[a] = Math.max(r.max[a], x);
      }
    }
  }
  return [...regions.values()];
}

/** Boxes that together hold every `wanted` point and no `other` point. */
function boxesAround(wanted, others, out = []) {
  if (!wanted.length) return out;
  const min = [0, 1, 2].map((a) => Math.min(...wanted.map((c) => c[a])) - 1e-5);
  const max = [0, 1, 2].map((a) => Math.max(...wanted.map((c) => c[a])) + 1e-5);
  const inside = others.filter((c) => c.every((x, a) => x >= min[a] && x <= max[a]));
  if (!inside.length) return out.push([min, max]), out;
  const axis = [0, 1, 2].reduce((best, a) => (max[a] - min[a] > max[best] - min[best] ? a : best), 0);
  const sorted = [...wanted].sort((p, q) => p[axis] - q[axis]);
  boxesAround(sorted.slice(0, sorted.length >> 1), inside, out);
  boxesAround(sorted.slice(sorted.length >> 1), inside, out);
  return out;
}

const REAR_PAINT = 'Object_33 | ext_carpaint';
async function lidPaintRules() {
  const file = fileURLToPath(new URL(`../.cache/${source.uid}.glb`, import.meta.url));
  // Not downloaded yet (fetch.mjs reads this config for the source id): nothing to trace.
  if (!existsSync(file)) return [];
  const { prims } = prepare(await (await createIO()).read(file), base);
  const p = prims.find((q) => q.name === REAR_PAINT);
  // Body: the bumper and fender ends (they reach the wheel arches and the car's sides) and the
  // small ledges under the lamps. Everything else is the lid, up to the tips beside the rear glass.
  const isBody = (r) => r.max[1] < 0.83 && (r.min[1] < 0.5 || Math.max(-r.min[2], r.max[2]) > 0.75 || r.min[2] > 0.3 || r.max[2] < -0.3);
  const lid = [];
  const body = [];
  for (const r of smoothRegions(p, 30)) for (const t of r.tris) (isBody(r) ? body : lid).push(centroid(p, t));
  return boxesAround(lid, body).map((box) => ({ mat: { test: (name) => name === REAR_PAINT }, box, mode: 'tri' }));
}

// --- Headlight: the inner block has an upper and a lower row, split by a sloping shelf --------
// Cut in thin slices across the car so the split follows the shelf, and so the slices stop short
// of the daytime strip, which runs past in front of the block (the lamp is swept back).
const innerBlock = (s, row) =>
  Array.from({ length: 10 }, (_, i) => {
    const [z0, z1] = [0.5 + i * 0.0215, 0.5 + (i + 1) * 0.0215];
    const shelf = 0.665 + ((z0 + z1) / 2 - 0.518) * 0.125;
    const front = 2.118 - (z0 - 0.506) * 0.688;
    return { mat: /Lights_Glo|Lights_Ref/, clip: on(s, row === 'lower' ? [[1.9, 0.64, z0], [front, shelf, z1]] : [[1.9, shelf, z0], [front, 0.73, z1]]) };
  });

const TAIL = /Taillight_Detail/;

export default {
  id: 'model3-2024',
  ...base,
  materials: [
    [/ext_carpaint$|int_carpaint/, 'paint'],
    [/EXT_Window/, 'glass'],
    [/INT_Window/, 'hide'],
    [/EXT_Headlight_Glass/, 'lens'],
    [/EXT_Taillight_Glass/, 'redlens'],
    [/Black_Glass|ext_carpaint_black/, 'gloss'],
    [/ext_plastic|Body_Black/, 'black'],
    [/\| Lights$/, { preset: 'black', name: 'lamphousing', rough: 0.4 }],
    [/Lights_Glo/, { preset: 'reflector', name: 'lightguide', color: [0.6, 0.6, 0.62], metal: 0.2, rough: 0.35 }],
    [/Lights_Ref/, 'reflector'],
    [TAIL, 'redinner'],
    [/\| Mirror$/, 'mirror'],
    [/EXT_PLATE/, { preset: 'plate', color: [0.8, 0.8, 0.8], keepTexture: true }],
    [/EXT_Chrome_Badge|int_chrome/, 'chrome'],
    [/Tyre/, 'rubber'],
    [/Brake_Disc/, 'disc'],
    [/Caliper/, { preset: 'caliper', color: [0.1, 0.1, 0.11] }],
    [/\| material$/, { preset: 'alloy', color: [0.3, 0.31, 0.33] }],
    [/RIM_2/, 'darkalloy'],
    [/INT_Screen/, 'screen'],
    [/INT_LED/, { preset: 'interior', name: 'ambient', color: [0.2, 0.2, 0.22] }],
  ],
  parts: {
    // The trunk lid: hinged at the tips that run up beside the rear glass, which stays put.
    liftgate: {
      select: [
        ...(await lidPaintRules()),
        // The lamps (all of each C is on the lid), badges, plate and its holder.
        ...sides((side, s) => ({ mat: /Black_Glass|EXT_Taillight_Glass|\| Lights$|Taillight_Detail/, box: on(s, [[-2.26, 0.8, 0.36], [-2.0, 0.98, 0.8]]) })),
        { mat: /EXT_Chrome_Badge/, box: [[-2.4, 0.6, -0.6], [-2.1, 1.0, 0.6]] },
        { mat: /EXT_PLATE|ext_plastic/, box: [[-2.3, 0.7, -0.27], [-2.2, 0.86, 0.27]] },
        // Inside: the lid's inner skin and liner, its lower edge with the latch, and the hinge arms.
        { mat: /Object_37 \| int_carpaint/, box: [[-2.4, 0.6, -0.8], [-1.5, 1.25, 0.8]] },
        { mat: /Object_48 \| int_plastic/, box: [[-2.3, 0.6, -0.55], [-1.9, 1.12, 0.55]] },
        { mat: /Object_36 \| int_carpaint/, box: [[-2.3, 0.63, -0.57], [-2.08, 0.82, 0.57]] },
        { mat: /int_chrome/, box: [[-2.26, 0.6, -0.02], [-2.17, 0.69, 0.02]] },
        ...sides((side, s) => ({ mat: /Object_36 \| int_carpaint/, box: on(s, [[-1.92, 1.0, 0.46], [-1.68, 1.13, 0.58]]) })),
      ],
      rig: { type: 'hinge', pivot: [-1.57, 1.2, 0], axis: [0, 0, 1], deg: -70 },
    },
    ...Object.fromEntries(
      sides((side, s) => [
        `${side}Mirror`,
        {
          // The head (cap, lower shell, glass); the stalk stays on the door.
          select: [{ mat: /ext_carpaint$|ext_carpaint_black|\| Mirror$/, box: on(s, [[0.53, 0.9, 0.845], [0.78, 1.06, 1.06]]) }],
          rig: { type: 'hinge', pivot: [0.68, 0.95, s * 0.88], axis: [0, 1, 0], deg: s * -60, invert: true },
        },
      ]),
    ),
    ...Object.fromEntries(
      sides((side, s) => [
        `${side}FrontWindow`,
        { select: [{ mat: /EXT_Window/, box: on(s, [[-0.32, 0.9, 0.6], [0.73, 1.36, 0.82]]) }], rig: { type: 'slide', vector: [0, -0.44, s * 0.08] } },
      ]),
    ),
    ...Object.fromEntries(
      sides((side, s) => [
        `${side}RearWindow`,
        { select: [{ mat: /EXT_Window/, box: on(s, [[-1.2, 0.95, 0.6], [-0.32, 1.36, 0.8]]) }], rig: { type: 'slide', vector: [0, -0.4, s * 0.075] } },
      ]),
    ),
    // The black triangle with the reflector, ahead of the left tail lamp; it swings up on its top edge.
    chargePort: {
      select: [{ mat: /Black_Glass|EXT_Taillight_Glass/, box: [[-2.05, 0.82, -0.8], [-1.8, 0.975, -0.71]] }],
      rig: { type: 'hinge', pivot: [-1.92, 0.966, -0.751], axis: [0.96, 0, 0.28], deg: 95 },
    },
  },
  lamps: [
    // Headlight. The daytime strip runs along the bottom and up the outer end.
    ...sides((side, s) => ({ ids: [`${side}Signature`], select: [{ mat: /Lights_Glo/, box: on(s, [[1.97, 0.68, 0.65], [2.0, 0.7, 0.67]]), mode: 'center' }] })),
    ...sides((side, s) => ({ ids: [`${side}OuterMainBeam`], select: [{ mat: /Lights_Glo|Lights_Ref/, box: on(s, [[1.85, 0.69, 0.75], [1.89, 0.71, 0.77]]), mode: 'center' }] })),
    ...sides((side, s) => ({ ids: [`${side}InnerMainBeam`], select: innerBlock(s, 'lower') })),
    ...sides((side, s) => ({ ids: [`${side}Channel4`, `${side}Channel5`, `${side}Channel6`], select: innerBlock(s, 'upper') })),
    // The slim strip under the daytime strip.
    ...sides((side, s) => ({ ids: [`${side}FrontTurn`], color: 'amber', select: [{ mat: /\| Lights$/, box: on(s, [[2.13, 0.63, 0.57], [2.15, 0.65, 0.6]]), mode: 'center' }] })),
    ...sides((side, s) => ({ ids: [`${side}SideRepeater`], color: 'amber', select: [{ mat: /\| Lights$/, box: on(s, [[1.0, 0.72, 0.88], [1.1, 0.76, 0.92]]) }] })),
    // Tail lamp: the red C is the tail light, except the middle of its spine, which is the brake light.
    ...sides((side, s) => ({
      ids: [`${side}Tail`],
      color: 'red',
      select: [
        { mat: TAIL, clip: on(s, [[-2.25, 0.82, 0.4], [-2.0, 0.96, 0.7]]) },
        { mat: TAIL, clip: on(s, [[-2.25, 0.82, 0.745], [-2.0, 0.96, 0.78]]) },
        { mat: TAIL, clip: on(s, [[-2.25, 0.925, 0.7], [-2.0, 0.96, 0.745]]) },
        { mat: TAIL, clip: on(s, [[-2.25, 0.82, 0.7], [-2.0, 0.85, 0.745]]) },
      ],
    })),
    {
      ids: ['brakeLights'],
      color: 'red',
      select: [
        ...sides((side, s) => ({ mat: TAIL, clip: on(s, [[-2.25, 0.85, 0.7], [-2.0, 0.925, 0.745]]) })),
        // The high-mounted strip behind the rear glass.
        { mat: TAIL, box: [[-1.94, 1.13, -0.05], [-1.9, 1.16, 0.05]], mode: 'center' },
      ],
    },
    // The thin band inside the C, along its top and down its spine.
    ...sides((side, s) => ({ ids: [`${side}RearTurn`], color: 'amber', select: [{ mat: /\| Lights$/, box: on(s, [[-2.16, 0.88, 0.55], [-2.14, 0.9, 0.58]]), mode: 'center' }] })),
    // The red strips on the fenders ahead of the tail lamps (the left one is on the charge port door).
    ...sides((side, s) => ({ ids: [`${side}SideMarker`], color: 'red', select: [{ mat: /EXT_Taillight_Glass/, box: on(s, [[-2.05, 0.86, 0.75], [-1.87, 0.94, 0.8]]) }] })),
    // Low in the bumper: a white strip under a red one, on each side.
    { ids: ['reverseLights'], select: sides((side, s) => ({ mat: /\| Lights$/, box: on(s, [[-2.33, 0.36, 0.32], [-2.2, 0.4, 0.6]]) })) },
    { ids: ['rearFog'], color: 'red', select: sides((side, s) => ({ mat: TAIL, clip: on(s, [[-2.4, 0.3895, 0.28], [-2.2, 0.42, 0.6]]) })) },
    // Not modeled: two small lamps under the ledge above the plate.
    { ids: ['licensePlate'], part: 'liftgate', add: sides((side, s) => on(s, [[-2.285, 0.848, 0.07], [-2.265, 0.856, 0.13]])) },
  ],
  beams: { head: [1.9, 0.7, 0.76] },
  cabin: [0.45, 0.95, 0],
};
