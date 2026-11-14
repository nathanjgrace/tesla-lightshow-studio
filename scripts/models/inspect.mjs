// Tools for working out what the pieces of a downloaded model are. Both read
// a config (configs/<id>.mjs: at least `source.uid`, `front`, and usually
// `lengthM` and `drop`), so the coordinates they print are the ones the
// config's boxes are written in.
//
//   node inspect.mjs prims <config id> [filter]
//     Lists every primitive in car coordinates: index, triangles, bounds, material.
//
//   node inspect.mjs pieces <config id> <out.glb> <regex> [minTris]
//     Splits the primitives whose "node | material" matches the regex into
//     connected pieces, lists them, and writes a GLB with each piece in its own
//     color (the rest of the car in gray) to look at in any glTF viewer.

import { Document } from '@gltf-transform/core';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bboxOf, createIO, prepare } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const [, , command, id, ...rest] = process.argv;
const config = (await import(resolve(here, 'configs', `${id}.mjs`))).default;
const io = await createIO();
const doc = await io.read(resolve(here, '.cache', `${config.source.uid}.glb`));
const { prims, size } = prepare(doc, config);
const f = (v, w = 7, d = 3) => v.map((x) => x.toFixed(d).padStart(w)).join('');
console.log(`size (L H W): ${f(size)} · extensions: ${doc.getRoot().listExtensionsUsed().map((e) => e.extensionName).join(', ') || 'none'}`);

if (command === 'prims') {
  const filter = rest[0] && new RegExp(rest[0], 'i');
  for (const p of prims) {
    if (filter && !filter.test(p.name)) continue;
    const b = bboxOf([p.positions]);
    const m = p.material;
    const flags = `${m?.getAlphaMode()[0] ?? '-'}${m?.getBaseColorTexture() ? 'T' : ' '}`;
    console.log(
      `${String(p.index).padStart(3)} ${String(p.indices.length / 3).padStart(7)} [${f(b.min, 6, 2)} ][${f(b.max, 6, 2)} ] ${flags} c=${m?.getBaseColorFactor().map((x) => x.toFixed(2)).join(',')} ${p.name}`,
    );
  }
} else if (command === 'pieces') {
  const [out, pattern, minTris = '1'] = rest;
  const re = new RegExp(pattern, 'i');
  const dbg = new Document();
  const buffer = dbg.createBuffer();
  const scene = dbg.createScene();
  const add = (name, pos, idx, color, alpha = 1) => {
    const mat = dbg.createMaterial(name).setBaseColorFactor([...color, alpha]).setRoughnessFactor(0.7).setMetallicFactor(0).setDoubleSided(true);
    if (alpha < 1) mat.setAlphaMode('BLEND');
    const prim = dbg
      .createPrimitive()
      .setAttribute('POSITION', dbg.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
      .setIndices(dbg.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer))
      .setMaterial(mat);
    scene.addChild(dbg.createNode(name).setMesh(dbg.createMesh(name).addPrimitive(prim)));
  };
  const hsl = (h, s, l) => {
    const a = s * Math.min(l, 1 - l);
    const k = (n) => l - a * Math.max(-1, Math.min(((n + h * 12) % 12) - 3, 9 - ((n + h * 12) % 12), 1));
    return [k(0), k(8), k(4)];
  };
  let i = 0;
  for (const p of prims) {
    if (!re.test(p.name)) {
      const blend = p.material?.getAlphaMode() === 'BLEND';
      add(`ctx${p.index}`, p.positions, p.indices, blend ? [0.6, 0.7, 0.8] : [0.55, 0.55, 0.55], blend ? 0.15 : 1);
      continue;
    }
    p.compTris.forEach((tris, ci) => {
      if (tris.length < Number(minTris)) return;
      const used = new Map();
      const pos = [];
      const ind = [];
      for (const t of tris) {
        for (let k = 0; k < 3; k++) {
          const v = p.indices[t * 3 + k];
          let nv = used.get(v);
          if (nv === undefined) {
            nv = pos.length / 3;
            used.set(v, nv);
            pos.push(p.positions[v * 3], p.positions[v * 3 + 1], p.positions[v * 3 + 2]);
          }
          ind.push(nv);
        }
      }
      const color = hsl((i * 0.61803) % 1, 0.85, i % 2 ? 0.45 : 0.6);
      i++;
      add(`piece${p.index}.${ci}`, new Float32Array(pos), new Uint32Array(ind), color);
      const b = p.compBox[ci];
      const hex = '#' + color.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
      console.log(`${`${p.index}.${ci}`.padEnd(8)} ${String(tris.length).padStart(6)} [${f(b.min)} ][${f(b.max)} ] ${hex} ${p.name}`);
    });
  }
  await io.write(out, dbg);
} else {
  console.error('Unknown command; see the top of this file.');
  process.exit(1);
}
