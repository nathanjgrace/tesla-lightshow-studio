// Shared helpers for the car model pipeline: reading a GLB, flattening it into
// car coordinates (x forward, y up, z right; meters; centered; wheels on the
// ground), splitting meshes into connected pieces, and selecting or clipping
// triangles by region.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

export async function createIO() {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });
}

/** Maps source world coordinates to car axes, given which source axis the car's nose points along. */
const ORIENT = {
  '+x': (p) => [p[0], p[1], p[2]],
  '-x': (p) => [-p[0], p[1], -p[2]],
  '+z': (p) => [p[2], p[1], -p[0]],
  '-z': (p) => [-p[2], p[1], p[0]],
};

const mulPoint = (m, v) => [
  m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
  m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
  m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
];

/** Cofactor matrix of the upper 3x3 (the inverse transpose times the determinant), and the determinant. */
function normalMatrix(m) {
  const [a, b, c, d, e, f, g, h, i] = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
  const co = [e * i - f * h, f * g - d * i, d * h - e * g, c * h - b * i, a * i - c * g, b * g - a * h, b * f - c * e, c * d - a * f, a * e - b * d];
  const det = a * co[0] + b * co[1] + c * co[2];
  return { co, det };
}

/**
 * Every primitive of the scene with its vertices in car coordinates.
 * `lengthM` rescales the model to a known overall length; without it the
 * source units are taken as meters.
 */
export function flatten(doc, front, lengthM) {
  const orient = ORIENT[front];
  if (!orient) throw new Error(`front must be one of ${Object.keys(ORIENT).join(' ')}`);
  const prims = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    const { co, det } = normalMatrix(m);
    const sign = det < 0 ? -1 : 1;
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      const pos = prim.getAttribute('POSITION');
      const nrm = prim.getAttribute('NORMAL');
      const uv = prim.getAttribute('TEXCOORD_0');
      const n = pos.getCount();
      const positions = new Float32Array(n * 3);
      const normals = new Float32Array(n * 3);
      const uvs = uv ? new Float32Array(n * 2) : undefined;
      const v = [0, 0, 0];
      for (let i = 0; i < n; i++) {
        pos.getElement(i, v);
        positions.set(orient(mulPoint(m, v)), i * 3);
        if (nrm) {
          nrm.getElement(i, v);
          const w = orient([
            sign * (co[0] * v[0] + co[1] * v[1] + co[2] * v[2]),
            sign * (co[3] * v[0] + co[4] * v[1] + co[5] * v[2]),
            sign * (co[6] * v[0] + co[7] * v[1] + co[8] * v[2]),
          ]);
          const len = Math.hypot(...w) || 1;
          normals.set([w[0] / len, w[1] / len, w[2] / len], i * 3);
        }
        if (uvs) {
          uv.getElement(i, v);
          uvs.set([v[0], v[1]], i * 2);
        }
      }
      const src = prim.getIndices()?.getArray();
      const indices = src ? Uint32Array.from(src) : Uint32Array.from({ length: n }, (_, i) => i);
      // A mirrored node turns triangles inside out; put them back.
      if (det < 0) for (let t = 0; t + 2 < indices.length; t += 3) [indices[t + 1], indices[t + 2]] = [indices[t + 2], indices[t + 1]];
      const material = prim.getMaterial();
      prims.push({ node, material, name: `${node.getName()} | ${material?.getName() ?? ''}`, positions, normals, uvs, indices, hasNormals: !!nrm });
    }
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of prims) {
    for (let i = 0; i < p.positions.length; i++) {
      const a = i % 3;
      if (p.positions[i] < min[a]) min[a] = p.positions[i];
      if (p.positions[i] > max[a]) max[a] = p.positions[i];
    }
  }
  const scale = lengthM ? lengthM / (max[0] - min[0]) : 1;
  const off = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
  for (const p of prims) for (let i = 0; i < p.positions.length; i++) p.positions[i] = (p.positions[i] - off[i % 3]) * scale;
  prims.forEach((p, i) => (p.index = i));
  return { prims, scale, size: max.map((v, i) => (v - min[i]) * scale) };
}

export function bboxOf(arrays) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const positions of arrays) {
    for (let i = 0; i < positions.length; i++) {
      const a = i % 3;
      if (positions[i] < min[a]) min[a] = positions[i];
      if (positions[i] > max[a]) max[a] = positions[i];
    }
  }
  return { min, max };
}

/**
 * Tags each triangle of a primitive with the connected piece it belongs to
 * (vertices closer than `weld` count as one): `p.comp[tri]`, and each
 * piece's bounds in `p.compBox`, largest piece first.
 */
export function splitComponents(p, weld = 2e-4) {
  if (p.comp) return;
  const n = p.positions.length / 3;
  const seen = new Map();
  const rep = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(p.positions[i * 3] / weld)},${Math.round(p.positions[i * 3 + 1] / weld)},${Math.round(p.positions[i * 3 + 2] / weld)}`;
    let r = seen.get(k);
    if (r === undefined) seen.set(k, (r = i));
    rep[i] = r;
  }
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (a) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const tris = p.indices.length / 3;
  for (let t = 0; t < tris; t++) {
    const a = find(rep[p.indices[t * 3]]);
    parent[find(rep[p.indices[t * 3 + 1]])] = a;
    parent[find(rep[p.indices[t * 3 + 2]])] = a;
  }
  const groups = new Map();
  for (let t = 0; t < tris; t++) {
    const r = find(rep[p.indices[t * 3]]);
    let g = groups.get(r);
    if (!g) groups.set(r, (g = []));
    g.push(t);
  }
  const sorted = [...groups.values()].sort((a, b) => b.length - a.length);
  p.comp = new Int32Array(tris);
  p.compTris = sorted;
  p.compBox = sorted.map((list, ci) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const t of list) {
      p.comp[t] = ci;
      for (let k = 0; k < 3; k++) {
        const v = p.indices[t * 3 + k] * 3;
        for (let a = 0; a < 3; a++) {
          const x = p.positions[v + a];
          if (x < min[a]) min[a] = x;
          if (x > max[a]) max[a] = x;
        }
      }
    }
    return { min, max };
  });
}

const TOL = 1e-3;
const inside = (pt, box) => pt[0] >= box[0][0] && pt[0] <= box[1][0] && pt[1] >= box[0][1] && pt[1] <= box[1][1] && pt[2] >= box[0][2] && pt[2] <= box[1][2];
const within = (b, box) => [0, 1, 2].every((a) => b.min[a] >= box[0][a] - TOL && b.max[a] <= box[1][a] + TOL);

/** The same box on the other side of the car. */
export const mirrorBox = (box) => [
  [box[0][0], box[0][1], -box[1][2]],
  [box[1][0], box[1][1], -box[0][2]],
];

export function centroid(p, t) {
  const c = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const v = p.indices[t * 3 + k] * 3;
    c[0] += p.positions[v] / 3;
    c[1] += p.positions[v + 1] / 3;
    c[2] += p.positions[v + 2] / 3;
  }
  return c;
}

/**
 * Does a selection rule pick this triangle?
 * Rule: { mat?: RegExp over "node | material", prim?: number|number[], box?: [[min],[max]],
 *         mode?: 'component' (the whole piece lies in the box; default) | 'center' (the piece's
 *         middle is in the box) | 'tri' (the triangle's middle is in the box) }
 */
export function matches(rule, p, t) {
  if (rule.mat && !rule.mat.test(p.name)) return false;
  if (rule.not && rule.not.test(p.name)) return false;
  if (rule.prim !== undefined && ![rule.prim].flat().includes(p.index)) return false;
  if (!rule.box) return true;
  const mode = rule.mode ?? 'component';
  if (mode === 'tri') return inside(centroid(p, t), rule.box);
  splitComponents(p);
  const b = p.compBox[p.comp[t]];
  if (mode === 'center') return inside([(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2], rule.box);
  return within(b, rule.box);
}

/** A triangle's three vertices as { p, n, uv } records. */
export function triVerts(p, t) {
  const out = [];
  for (let k = 0; k < 3; k++) {
    const v = p.indices[t * 3 + k];
    out.push({
      p: [p.positions[v * 3], p.positions[v * 3 + 1], p.positions[v * 3 + 2]],
      n: [p.normals[v * 3], p.normals[v * 3 + 1], p.normals[v * 3 + 2]],
      uv: p.uvs ? [p.uvs[v * 2], p.uvs[v * 2 + 1]] : [0, 0],
    });
  }
  return out;
}

const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);

/** Clips a polygon (list of vertex records) to an axis-aligned box. */
export function clipToBox(poly, box) {
  let out = poly;
  for (let a = 0; a < 3 && out.length; a++) {
    for (const [bound, keepAbove] of [
      [box[0][a], true],
      [box[1][a], false],
    ]) {
      if (!Number.isFinite(bound)) continue;
      const input = out;
      out = [];
      const ok = (v) => (keepAbove ? v.p[a] >= bound : v.p[a] <= bound);
      for (let i = 0; i < input.length; i++) {
        const cur = input[i];
        const next = input[(i + 1) % input.length];
        if (ok(cur)) out.push(cur);
        if (ok(cur) !== ok(next)) {
          const t = (bound - cur.p[a]) / (next.p[a] - cur.p[a]);
          out.push({ p: lerp(cur.p, next.p, t), n: lerp(cur.n, next.n, t), uv: lerp(cur.uv, next.uv, t) });
        }
      }
    }
  }
  return out;
}

/**
 * The convex region a rule cuts along, as half-spaces { n, d } with n·p <= d
 * inside: its `box`, or `poly` (a convex outline in side view, [[x, y], ...])
 * between the `z: [min, max]` planes.
 */
export function regionOf(rule) {
  const planes = [];
  if (rule.poly) {
    let area = 0;
    for (let i = 0; i < rule.poly.length; i++) {
      const [x0, y0] = rule.poly[i];
      const [x1, y1] = rule.poly[(i + 1) % rule.poly.length];
      area += x0 * y1 - x1 * y0;
    }
    const s = area > 0 ? 1 : -1;
    for (let i = 0; i < rule.poly.length; i++) {
      const [x0, y0] = rule.poly[i];
      const [x1, y1] = rule.poly[(i + 1) % rule.poly.length];
      const n = [s * (y1 - y0), -s * (x1 - x0), 0];
      planes.push({ n, d: n[0] * x0 + n[1] * y0 });
    }
    const [z0, z1] = rule.z ?? [-Infinity, Infinity];
    if (Number.isFinite(z0)) planes.push({ n: [0, 0, -1], d: -z0 });
    if (Number.isFinite(z1)) planes.push({ n: [0, 0, 1], d: z1 });
  } else if (rule.box) {
    for (let a = 0; a < 3; a++) {
      const n = [0, 0, 0];
      if (Number.isFinite(rule.box[0][a])) {
        n[a] = -1;
        planes.push({ n: [...n], d: -rule.box[0][a] });
      }
      if (Number.isFinite(rule.box[1][a])) {
        n[a] = 1;
        planes.push({ n: [...n], d: rule.box[1][a] });
      }
    }
  }
  return planes;
}

export const inRegion = (planes, pt) => planes.every(({ n, d }) => n[0] * pt[0] + n[1] * pt[1] + n[2] * pt[2] <= d + 1e-9);

/** Splits a convex polygon (vertex records) by a convex region: what's inside, and the pieces left outside. */
export function splitByRegion(poly, planes) {
  const outside = [];
  let rest = poly;
  for (const { n, d } of planes) {
    if (rest.length < 3) break;
    const dist = rest.map((v) => n[0] * v.p[0] + n[1] * v.p[1] + n[2] * v.p[2] - d);
    if (dist.every((x) => x <= 1e-9)) continue;
    if (dist.every((x) => x >= -1e-9)) {
      outside.push(rest);
      rest = [];
      break;
    }
    const inn = [];
    const out = [];
    for (let i = 0; i < rest.length; i++) {
      const j = (i + 1) % rest.length;
      const [a, b] = [rest[i], rest[j]];
      (dist[i] <= 0 ? inn : out).push(a);
      if (dist[i] <= 0 !== dist[j] <= 0) {
        const t = dist[i] / (dist[i] - dist[j]);
        const v = { p: lerp(a.p, b.p, t), n: lerp(a.n, b.n, t), uv: lerp(a.uv, b.uv, t) };
        inn.push(v);
        out.push(v);
      }
    }
    if (out.length >= 3) outside.push(out);
    rest = inn;
  }
  return { inside: rest.length >= 3 ? rest : undefined, outside };
}

/** A closed box as triangles (vertex records), for lamps the model doesn't have. */
export function boxTriangles([min, max]) {
  const c = (x, y, z) => [x ? max[0] : min[0], y ? max[1] : min[1], z ? max[2] : min[2]];
  const faces = [
    [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1], [1, 0, 0]],
    [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0], [-1, 0, 0]],
    [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
    [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1], [0, -1, 0]],
    [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]],
    [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, -1]],
  ];
  const out = [];
  for (const [a, b, cc, d, n] of faces) {
    const q = [a, b, cc, d].map((k) => ({ p: c(...k), n, uv: [0, 0] }));
    out.push([q[0], q[1], q[2]], [q[0], q[2], q[3]]);
  }
  return out;
}

/**
 * A config's source model, ready to work on: flattened, without what the
 * config drops, centered and scaled to the car's real length, and split into
 * connected pieces. Inspecting and building both start here, so coordinates
 * read off one are right for the other.
 */
export function prepare(doc, config) {
  let { prims } = flatten(doc, config.front);
  for (const p of prims) {
    splitComponents(p);
    const idx = [];
    for (let t = 0; t < p.indices.length / 3; t++) {
      if ((config.drop ?? []).some((rule) => matches(rule, p, t))) continue;
      idx.push(p.indices[t * 3], p.indices[t * 3 + 1], p.indices[t * 3 + 2]);
    }
    p.indices = Uint32Array.from(idx);
    p.comp = p.compTris = p.compBox = undefined;
  }
  prims = prims.filter((p) => p.indices.length);
  // Only vertices still in use count toward the bounds.
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of prims) {
    for (const v of p.indices) {
      for (let a = 0; a < 3; a++) {
        const x = p.positions[v * 3 + a];
        if (x < min[a]) min[a] = x;
        if (x > max[a]) max[a] = x;
      }
    }
  }
  const scale = config.lengthM ? config.lengthM / (max[0] - min[0]) : 1;
  const off = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
  for (const p of prims) for (let i = 0; i < p.positions.length; i++) p.positions[i] = (p.positions[i] - off[i % 3]) * scale;
  for (const p of prims) splitComponents(p);
  return { prims, scale, size: max.map((v, a) => (v - min[a]) * scale) };
}
