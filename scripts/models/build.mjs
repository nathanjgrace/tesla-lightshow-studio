// Builds a rigged car model for the app from a downloaded source model and a
// config (configs/<id>.mjs) that says what each piece is:
//
//   node build.mjs modelY-2025
//
// The output (public/models/<id>.glb) is in car coordinates (x forward, y up,
// z right, meters, wheels on the ground) with:
// - one mesh per (moving part, material), named "<part>/<material>", with
//   node extras { part, role };
// - one mesh per lamp, with node extras { lights: [channel ids], color };
// - scene extras { parts: how each moving part moves, beams, cabin, credit }.
// Materials named "paint", "glass", "lens" and "redlens" are placeholders the
// app replaces with its own.

import { mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedup, meshopt, prune, simplifyPrimitive, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { boxTriangles, clipToBox, createIO, inRegion, matches, prepare, regionOf, splitByRegion, triVerts } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** Looks for the materials a source file names; the app swaps the first four for its own. */
const PRESETS = {
  paint: { color: [0.8, 0.8, 0.82], metal: 0.3, rough: 0.4, swap: true },
  glass: { color: [0.02, 0.025, 0.03], metal: 0, rough: 0.1, swap: true },
  lens: { color: [0.5, 0.5, 0.5], metal: 0, rough: 0.1, swap: true },
  redlens: { color: [0.5, 0.02, 0.02], metal: 0, rough: 0.1, swap: true },
  black: { color: [0.015, 0.015, 0.017], metal: 0, rough: 0.55 },
  gloss: { color: [0.008, 0.008, 0.01], metal: 0, rough: 0.12 },
  chrome: { color: [0.85, 0.85, 0.86], metal: 1, rough: 0.1 },
  rubber: { color: [0.018, 0.018, 0.018], metal: 0, rough: 0.92 },
  alloy: { color: [0.52, 0.53, 0.55], metal: 0.85, rough: 0.3 },
  darkalloy: { color: [0.07, 0.07, 0.08], metal: 0.8, rough: 0.38 },
  disc: { color: [0.3, 0.3, 0.32], metal: 0.9, rough: 0.45 },
  caliper: { color: [0.55, 0.02, 0.02], metal: 0.2, rough: 0.4 },
  interior: { color: [0.03, 0.03, 0.035], metal: 0, rough: 0.85 },
  lightinterior: { color: [0.55, 0.55, 0.53], metal: 0, rough: 0.8 },
  reflector: { color: [0.55, 0.55, 0.57], metal: 0.9, rough: 0.25 },
  redinner: { color: [0.3, 0.01, 0.01], metal: 0.3, rough: 0.3 },
  amberinner: { color: [0.45, 0.2, 0.02], metal: 0.3, rough: 0.3 },
  mirror: { color: [0.62, 0.64, 0.67], metal: 1, rough: 0.04 },
  plate: { color: [0.6, 0.6, 0.6], metal: 0, rough: 0.6 },
  screen: { color: [0.01, 0.01, 0.012], metal: 0, rough: 0.2 },
};

const id = process.argv[2];
if (!id) throw new Error('Usage: node build.mjs <config id>');
const config = (await import(resolve(here, 'configs', `${id}.mjs`))).default;
const io = await createIO();
const doc = await io.read(resolve(here, '.cache', `${config.source.uid}.glb`));
const root = doc.getRoot();
const buffer = root.listBuffers()[0];

const { prims, scale, size } = prepare(doc, config);
console.log(`size (L H W): ${size.map((v) => v.toFixed(3)).join(' ')} m, scale ${scale.toFixed(5)}`);

// --- Materials -------------------------------------------------------------

const shared = new Map();
function outputMaterial(p, t) {
  // A material rule is a regex over "node | material", or a selection rule (to tell lamp covers from windows by where they are).
  const entry = (config.materials ?? []).find(([rule]) => (rule instanceof RegExp ? rule.test(p.name) : matches(rule, p, t)));
  const spec = entry ? (typeof entry[1] === 'string' ? { preset: entry[1] } : entry[1]) : { preset: 'keep' };
  if (spec.preset === 'hide') return undefined;
  if (spec.preset === 'keep' && !spec.color && spec.rough === undefined && spec.metal === undefined) return p.material;
  const base = PRESETS[spec.preset] ?? {};
  const keepTexture = spec.keepTexture ?? false;
  const key = keepTexture ? `${p.material?.getName()}:${JSON.stringify(spec)}` : JSON.stringify({ ...spec, name: base.swap ? spec.preset : undefined });
  let m = shared.get(key);
  if (!m) {
    m = keepTexture && p.material ? p.material.clone() : doc.createMaterial();
    m.setName(base.swap ? spec.preset : (spec.name ?? spec.preset ?? 'material'));
    m.setBaseColorFactor([...(spec.color ?? base.color ?? [0.5, 0.5, 0.5]), 1]);
    m.setMetallicFactor(spec.metal ?? base.metal ?? 0);
    m.setRoughnessFactor(spec.rough ?? base.rough ?? 0.6);
    m.setAlphaMode('OPAQUE');
    m.setDoubleSided(spec.doubleSided ?? true);
    if (spec.emissive) m.setEmissiveFactor(spec.emissive);
    shared.set(key, m);
  }
  return m;
}

// --- Parts and buckets -------------------------------------------------------

const partIds = Object.keys(config.parts ?? {});
const cutRegions = new Map();
const regionFor = (rule) => {
  let r = cutRegions.get(rule);
  if (!r) cutRegions.set(rule, (r = regionOf(rule)));
  return r;
};
/** Rule without its region, for the material and name tests of a cutting rule. */
const nameOnly = (rule) => ({ mat: rule.mat, not: rule.not, prim: rule.prim });

/** Which part a point of a triangle belongs to. */
function partAt(p, t, point) {
  for (const partId of partIds) {
    for (const rule of config.parts[partId].select) {
      if (rule.mode === 'cut' ? matches(nameOnly(rule), p, t) && inRegion(regionFor(rule), point) : matches(rule, p, t)) return partId;
    }
  }
  return '';
}

/**
 * A triangle shared out among the parts: [[part, polygon], ...]. Rules with
 * mode 'cut' slice it along their region (for doors that are welded into the
 * body); the others take it whole.
 */
function shareOut(p, t) {
  let rest = [triVerts(p, t)];
  const out = [];
  for (const partId of partIds) {
    for (const rule of config.parts[partId].select) {
      if (!rest.length) return out;
      if (rule.mode !== 'cut') {
        if (!matches(rule, p, t)) continue;
        for (const poly of rest) out.push([partId, poly]);
        return out;
      }
      if (!matches(nameOnly(rule), p, t)) continue;
      const next = [];
      for (const poly of rest) {
        const { inside, outside } = splitByRegion(poly, regionFor(rule));
        if (inside) out.push([partId, inside]);
        next.push(...outside);
      }
      rest = next;
    }
  }
  for (const poly of rest) out.push(['', poly]);
  return out;
}
/** Part ids starting with "_" aren't parts: they keep a region on the body, out of reach of the cuts after them (a wheel arch out of a door). */
const realPart = (id) => (id.startsWith('_') ? '' : id);

/** Vertex soups by "part|material". */
const buckets = new Map();
const materialIds = new Map();
function bucket(part, material) {
  if (!materialIds.has(material)) materialIds.set(material, materialIds.size);
  const key = `${part}|${materialIds.get(material)}`;
  let b = buckets.get(key);
  if (!b) buckets.set(key, (b = { part, material, pos: [], nrm: [], uv: [] }));
  return b;
}
function push(b, verts) {
  for (const v of verts) {
    b.pos.push(...v.p);
    b.nrm.push(...v.n);
    b.uv.push(...v.uv);
  }
}

const partTris = new Map();
for (const p of prims) {
  for (let t = 0; t < p.indices.length / 3; t++) {
    const material = outputMaterial(p, t);
    if (!material) continue;
    for (const [rawPart, poly] of shareOut(p, t)) {
      const part = realPart(rawPart);
      partTris.set(part, (partTris.get(part) ?? 0) + poly.length - 2);
      const b = bucket(part, material);
      for (let k = 1; k + 1 < poly.length; k++) push(b, [poly[0], poly[k], poly[k + 1]]);
    }
  }
}

// --- Lamps -------------------------------------------------------------------

const lampMaterial = doc.createMaterial('lamp').setBaseColorFactor([0, 0, 0, 1]).setRoughnessFactor(1).setMetallicFactor(0).setDoubleSided(true);
let lampIndex = 0;
for (const lamp of config.lamps ?? []) {
  // A lamp that spans a moving part and the body (a light bar across a liftgate) becomes one mesh on each.
  const byPart = new Map();
  const lampBucket = (part) => {
    let b = byPart.get(part);
    if (!b) {
      b = { part, material: lampMaterial, extras: { lights: lamp.ids, color: lamp.color ?? 'white', ...(lamp.gain ? { gain: lamp.gain } : {}) }, pos: [], nrm: [], uv: [] };
      byPart.set(part, b);
    }
    return b;
  };
  for (const rule of lamp.select ?? []) {
    for (const p of prims) {
      if (rule.mat && !rule.mat.test(p.name)) continue;
      for (let t = 0; t < p.indices.length / 3; t++) {
        // In clip mode the box cuts triangles; otherwise it only selects them.
        if (!matches(rule.clip ? { ...rule, box: undefined } : rule, p, t)) continue;
        const verts = rule.clip ? clipToBox(triVerts(p, t), rule.clip) : triVerts(p, t);
        if (verts.length < 3) continue;
        const middle = [0, 1, 2].map((a) => verts.reduce((sum, v) => sum + v.p[a], 0) / verts.length);
        const b = lampBucket(lamp.part ?? realPart(partAt(p, t, middle)));
        for (let k = 1; k + 1 < verts.length; k++) push(b, [verts[0], verts[k], verts[k + 1]]);
      }
    }
  }
  for (const box of lamp.add ?? []) for (const tri of boxTriangles(box)) push(lampBucket(lamp.part ?? ''), tri);
  if (!byPart.size) console.warn(`! lamp ${lamp.ids.join('+')} matched nothing`);
  for (const b of byPart.values()) buckets.set(`lamp${lampIndex++}`, b);
}

// --- New scene ---------------------------------------------------------------

const scene = root.listScenes()[0];
for (const s of root.listScenes()) for (const c of s.listChildren()) s.removeChild(c);
for (const a of root.listAnimations()) a.dispose();
for (const s of root.listSkins()) s.dispose();
for (const n of root.listNodes()) n.dispose();
for (const m of root.listMeshes()) m.dispose();
for (const m of root.listMaterials()) {
  for (const ext of ['KHR_materials_transmission', 'KHR_materials_volume', 'KHR_materials_clearcoat', 'KHR_materials_ior', 'KHR_materials_specular', 'KHR_materials_sheen', 'KHR_materials_emissive_strength']) {
    m.setExtension(ext, null);
  }
}

let total = 0;
for (const b of buckets.values()) {
  const n = b.pos.length / 3;
  if (!n) continue;
  total += n / 3;
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(Float32Array.from(b.pos)).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(Float32Array.from(b.nrm)).setBuffer(buffer))
    .setMaterial(b.material);
  if (b.material.getBaseColorTexture() || b.material.getNormalTexture() || b.material.getEmissiveTexture() || b.material.getMetallicRoughnessTexture()) {
    prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(Float32Array.from(b.uv)).setBuffer(buffer));
  }
  const name = b.extras?.lights ? `lamp/${b.extras.lights.join('+')}` : `${b.part || 'body'}/${b.material.getName()}`;
  const node = doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim));
  node.setExtras({ part: b.part, ...(b.extras ?? {}) });
  scene.addChild(node);
}
scene.setName(config.id);
scene.setExtras({
  model: config.id,
  parts: Object.fromEntries(partIds.filter((p) => !p.startsWith('_')).map((p) => [p, config.parts[p].rig])),
  ...(config.beams ? { beams: config.beams } : {}),
  ...(config.cabin ? { cabin: config.cabin } : {}),
  credit: config.source,
});

await doc.transform(prune(), dedup(), weld());
for (const [re, ratio, error = 0.0005] of config.simplify ?? []) {
  for (const mesh of root.listMeshes()) {
    if (!re.test(mesh.getName())) continue;
    for (const prim of mesh.listPrimitives()) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error });
  }
}
for (const ext of root.listExtensionsUsed()) if (ext.listProperties().length === 0) ext.dispose();
await doc.transform(
  prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [config.textureSize ?? 1024, config.textureSize ?? 1024] }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);

const outDir = resolve(here, '../../public/models');
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, `${config.id}.glb`);
await io.write(out, doc);

let after = 0;
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) after += (prim.getIndices()?.getCount() ?? 0) / 3;
console.log(`parts: ${[...partTris].map(([k, v]) => `${k || 'body'} ${v}`).join(', ')}`);
console.log(`${root.listMeshes().length} meshes, ${Math.round(total)} → ${Math.round(after)} triangles, ${root.listMaterials().length} materials, ${root.listTextures().length} textures`);
console.log(`${out}: ${(statSync(out).size / 1e6).toFixed(2)} MB`);
