// 2020–2024 Model Y: reflector headlights, C-shaped tail lamps split between body and liftgate.
// Coordinates: x forward, y up, z right (left is -z), meters, origin under the car's middle.

import { NodeIO } from '@gltf-transform/core';
import { mirrorBox, splitComponents } from '../lib.mjs';

const UID = '59e2ead369984b1a85c800ff6cf6789d';
const sides = (fn) => [fn('left', -1), fn('right', 1)];
/** A box given for the right side (z > 0), on the chosen side. */
const on = (s, box) => (s > 0 ? box : mirrorBox(box));

// --- Source fix-up -----------------------------------------------------------
// The source puts the window glass and the clear lamp covers in the same
// primitives (material Carro_Vidros2), and the pipeline assigns materials per
// primitive. Windows must become `glass` (dark, writes depth) and covers
// `lens` (clear, lamps glow through), so the covers are moved to primitives of
// their own ("<node>_lens | Carro_Lente") as the source is read. Windows all
// reach above 1.4 m; lamp covers stay below 1.15 m.
function splitLampCovers(doc) {
  const root = doc.getRoot();
  const buffer = root.listBuffers()[0];
  const glass = root.listMaterials().find((m) => m.getName() === 'Carro_Vidros2');
  if (!glass) return;
  const lens = glass.clone().setName('Carro_Lente');
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMaterial() !== glass || prim.getMode() !== 4) continue;
      const m = node.getWorldMatrix();
      const pos = prim.getAttribute('POSITION');
      const positions = new Float32Array(pos.getCount() * 3);
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        positions.set([m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]], i * 3);
      }
      const src = prim.getIndices()?.getArray();
      const p = { positions, indices: src ? Uint32Array.from(src) : Uint32Array.from({ length: pos.getCount() }, (_, i) => i) };
      splitComponents(p);
      const keep = [];
      const cover = [];
      for (let t = 0; t < p.indices.length / 3; t++) {
        (p.compBox[p.comp[t]].max[1] < 1.25 ? cover : keep).push(p.indices[t * 3], p.indices[t * 3 + 1], p.indices[t * 3 + 2]);
      }
      if (!cover.length) continue;
      const accessor = (list) => doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(list)).setBuffer(buffer);
      const coverPrim = prim.clone().setIndices(accessor(cover)).setMaterial(lens);
      prim.setIndices(accessor(keep));
      const coverNode = doc.createNode(`${node.getName()}_lens`).setMatrix(node.getMatrix()).setMesh(doc.createMesh(`${node.getName()}_lens`).addPrimitive(coverPrim));
      (node.getParentNode() ?? root.listScenes()[0]).addChild(coverNode);
    }
  }
}
if (!NodeIO.prototype.__modelY2020) {
  const read = NodeIO.prototype.read;
  NodeIO.prototype.__modelY2020 = true;
  NodeIO.prototype.read = async function (uri, ...rest) {
    const doc = await read.call(this, uri, ...rest);
    if (String(uri).includes(UID)) splitLampCovers(doc);
    return doc;
  };
}

export default {
  id: 'modelY-2020',
  source: {
    uid: UID,
    title: '2021 Tesla Model Y',
    author: 'tonielpro520',
    authorUrl: 'https://sketchfab.com/tonielpro520',
    url: 'https://sketchfab.com/3d-models/2021-tesla-model-y-59e2ead369984b1a85c800ff6cf6789d',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  front: '+z',
  lengthM: 4.751,
  materials: [
    [/Carro_Pintura/, 'paint'],
    [/Carro_Lente/, 'lens'],
    [/Carro_Vidros2/, 'glass'],
    [/Carro_Vidro_Vermelho2/, 'redlens'],
    [/Object_78 \| Carro_Plastico_Brilho_1/, 'glass'],
    // Lamp internals: satin rather than mirror-bright, so the lot's lamps don't glint off them.
    [/Carro_Metal_Farol|Carro_Metal_Lanterna_Traseira/, { preset: 'reflector', color: [0.5, 0.5, 0.52], metal: 0.7, rough: 0.45 }],
    [/Carro_Metal_Vermelho_3/, { preset: 'redinner', name: 'redhousing', color: [0.12, 0.005, 0.005] }],
    [/Carro_Metal_Vermelho/, 'redinner'],
    [/Carro_Espelhos/, 'mirror'],
    [/Carro_Cromado/, 'chrome'],
    [/Carro_Pneu/, 'rubber'],
    [/Object_(13|21|23|25) \| Carro_Metal_Preto/, 'darkalloy'],
    [/Carro_Metal_Preto/, 'black'],
    [/Carro_Freio_Disco/, 'disc'],
    [/Carro_Freio/, { preset: 'disc', name: 'caliper', color: [0.16, 0.16, 0.17], rough: 0.5 }],
    [/Carro_Plastico_Brilho/, 'gloss'],
    [/Carro_Plastico/, 'black'],
    [/Carro_Interno/, 'interior'],
  ],
  parts: {
    // The left lamp section on the rear fender is the charge port door; its dark housing stays behind.
    chargePort: {
      select: [
        { mat: /Carro_Metal_Vermelho_1|Carro_Vidro_Vermelho2|Carro_Lente/, box: [[-2.085, 1.0, -0.77], [-1.83, 1.14, -0.65]] },
        { mat: /Object_82_lens/, box: [[-2.078, 0.9, -0.8], [-1.8, 1.2, -0.6]], mode: 'tri' },
      ],
      rig: { type: 'hinge', pivot: [-1.96, 1.128, -0.705], axis: [1, 0, 0], deg: 95 },
    },
    liftgate: {
      select: [
        { mat: /Object_(40|48) \| Carro_Pintura/ },
        { mat: /Object_84 \| Carro_Vidros2/, box: [[-2.3, 1.2, -0.6], [-1.3, 1.6, 0.6]] },
        // Rear window surround and the housings of the inner lamps.
        { mat: /Object_(50|60) \| Carro_Plastico/, box: [[-2.4, 0.9, -0.57], [-1.3, 1.6, 0.57]] },
        { mat: /Carro_Metal_Vermelho|Carro_Metal_Lanterna|Carro_Vidro_Vermelho2|Carro_Lente/, box: [[-2.4, 0.9, -0.57], [-2.1, 1.2, 0.57]] },
        // On the left the outer covers of the body and liftgate lamps are one piece; the seam leans outward toward the top.
        { mat: /Object_82_lens/, box: [[-2.4, 0.9, -0.542], [-2.1, 1.02, 0]], mode: 'tri' },
        { mat: /Object_82_lens/, box: [[-2.4, 1.02, -0.552], [-2.1, 1.07, 0]], mode: 'tri' },
        { mat: /Object_82_lens/, box: [[-2.4, 1.07, -0.561], [-2.1, 1.2, 0]], mode: 'tri' },
        { mat: /Carro_Cromado/, box: [[-2.4, 1.0, -0.1], [-2.2, 1.2, 0.1]] },
        { mat: /Object_79 \|/, box: [[-2.4, 0.95, -0.4], [-2.1, 1.1, 0.4]] },
      ],
      rig: { type: 'hinge', pivot: [-1.36, 1.5, 0], axis: [0, 0, 1], deg: -78 },
    },
    ...Object.fromEntries(
      sides((side, s) => [
        `${side}Mirror`,
        {
          select: [
            { mat: /Object_(38|45) \| Carro_Pintura|Carro_Espelhos/, box: on(s, [[0.5, 1.0, 0.78], [0.8, 1.3, 1.05]]) },
            // The gloss shell is one piece with the arm on the door; the head starts where it thickens.
            { mat: /Object_(63|71) \|/, box: on(s, [[0.5, 1.0, 0.795], [0.8, 1.3, 1.05]]), mode: 'tri' },
          ],
          rig: { type: 'hinge', pivot: [0.655, 1.15, s * 0.825], axis: [0, 1, 0], deg: -s * 58, invert: true },
        },
      ]),
    ),
    ...Object.fromEntries(
      sides((side, s) => [
        `${side}FrontWindow`,
        { select: [{ mat: /Carro_Vidros2/, box: on(s, [[-0.4, 1.05, 0.5], [0.75, 1.6, 0.8]]) }], rig: { type: 'slide', vector: [0, -0.44, s * 0.135] } },
      ]),
    ),
    ...Object.fromEntries(
      sides((side, s) => [
        `${side}RearWindow`,
        { select: [{ mat: /Carro_Vidros2/, box: on(s, [[-1.25, 1.1, 0.5], [-0.35, 1.6, 0.78]]) }], rig: { type: 'slide', vector: [0, -0.4, s * 0.12] } },
      ]),
    ),
  },
  lamps: [
    // Headlight, after Tesla's diagram (light-show/images/3_headlights_reflector.png).
    // Lower block, split in two: outer and inner main beams.
    ...sides((side, s) => ({ ids: [`${side}OuterMainBeam`], select: [{ mat: /Object_8 \|/, clip: on(s, [[1.7, 0.78, 0.668], [2.1, 0.95, 0.82]]) }] })),
    ...sides((side, s) => ({ ids: [`${side}InnerMainBeam`], select: [{ mat: /Object_8 \|/, clip: on(s, [[1.7, 0.78, 0.5], [2.1, 0.95, 0.662]]) }] })),
    // The strip arching over the main beams.
    ...sides((side, s) => ({ ids: [`${side}Signature`], select: [{ mat: /Object_9 \|/, box: on(s, [[1.88, 0.9, 0.64], [1.91, 0.915, 0.68]]), mode: 'center' }] })),
    // The panel in the top outer corner: channels 4-6 are one light on Model 3 and Y.
    ...sides((side, s) => ({
      ids: [`${side}Channel4`, `${side}Channel5`, `${side}Channel6`],
      select: [{ mat: /Object_(9|10) \|/, box: on(s, [[1.85, 0.915, 0.68], [1.87, 0.925, 0.71]]), mode: 'center' }],
    })),
    // The strip along the bottom edge.
    ...sides((side, s) => ({ ids: [`${side}FrontTurn`], color: 'amber', select: [{ mat: /Object_9 \|/, box: on(s, [[2.02, 0.785, 0.63], [2.05, 0.8, 0.65]]), mode: 'center' }] })),
    // Lower bumper lamp: round fog lamp outboard, park strip, and the side marker at the inboard tip of the cover.
    ...sides((side, s) => ({ ids: [`${side}FrontFog`], select: [{ mat: /Object_9 \||Carro_Lente/, box: on(s, [[2.03, 0.49, 0.8], [2.05, 0.51, 0.82]]), mode: 'center' }] })),
    ...sides((side, s) => ({ ids: [`${side}AuxPark`], select: [{ mat: /Object_9 \|/, box: on(s, [[2.16, 0.485, 0.67], [2.19, 0.5, 0.69]]), mode: 'center' }] })),
    ...sides((side, s) => ({
      ids: [`${side}SideMarker`],
      color: 'amber',
      select: [
        { mat: /Carro_Lente/, clip: on(s, [[2.0, 0.46, 0.55], [2.3, 0.55, 0.612]]) },
        { mat: /Carro_Lente/, clip: on(s, [[2.0, 0.46, 0.612], [2.3, 0.4865, 0.66]]) },
      ],
    })),
    // Camera housings on the front fenders: the rear half, around the camera.
    ...sides((side, s) => ({ ids: [`${side}SideRepeater`], color: 'amber', select: [{ mat: /Object_(67|75) \|/, clip: on(s, [[0.99, 0.83, 0.84], [1.058, 0.91, 0.9]]) }] })),
    // Tail: the red C on the body and liftgate, and the red marker on the fender (the charge port door on the left).
    ...sides((side, s) => ({
      ids: [`${side}Tail`],
      color: 'red',
      select: [
        { mat: /Carro_Metal_Vermelho$/, clip: on(s, [[-2.4, 0.9, 0], [-2.0, 1.2, 0.8]]) },
        { mat: /Carro_Metal_Vermelho_1$/, clip: on(s, [[-2.1, 1.0, 0.6], [-1.85, 1.15, 0.8]]) },
      ],
    })),
    // Body lamps: the bowl inside the C is the brake light above its light strip and the turn signal from the strip down.
    {
      ids: ['brakeLights'],
      color: 'red',
      select: [
        ...sides((side, s) => ({ mat: /Carro_Metal_Lanterna/, clip: on(s, [[-2.21, 1.0545, 0.548], [-2.1, 1.08, 0.68]]) })),
        // High-mounted brake light: a strip of the rear window's top edge (the model has no lamp there).
        { mat: /Object_84 \| Carro_Vidros2/, clip: [[-1.45, 1.4, -0.24], [-1.415, 1.6, 0.24]] },
      ],
    },
    ...sides((side, s) => ({ ids: [`${side}RearTurn`], color: 'amber', select: [{ mat: /Carro_Metal_Lanterna/, clip: on(s, [[-2.21, 1.0, 0.548], [-2.1, 1.0545, 0.68]]) }] })),
    // Liftgate lamps: the light strip and the bowl under it.
    { ids: ['reverseLights'], select: sides((side, s) => ({ mat: /Carro_Metal_Lanterna/, clip: on(s, [[-2.3, 1.0, 0.3], [-2.15, 1.0545, 0.548]]) })) },
    { ids: ['rearFog'], color: 'red', select: [{ mat: /Carro_Metal_Vermelho_2/ }] },
    // Plate lamps: the underside of the lip above the plate recess, and the top of the recess they shine on.
    {
      ids: ['licensePlate'],
      gain: 1.5,
      select: sides((side, s) => [
        { mat: /Object_79 \|/, clip: on(s, [[-2.33, 1.0, 0.09], [-2.23, 1.012, 0.15]]) },
        { mat: /Object_48 \|/, clip: on(s, [[-2.31, 0.975, 0.09], [-2.26, 1.002, 0.15]]) },
      ]).flat(),
    },
  ],
  beams: { head: [2.0, 0.84, 0.66], fog: [2.04, 0.5, 0.81] },
  cabin: [0.5, 1.0, 0],
};
