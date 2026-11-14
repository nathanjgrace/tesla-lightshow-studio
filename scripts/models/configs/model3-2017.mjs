// 2017–2023 Model 3 (before the "Highland" refresh): separate headlights and
// fog/park lamps in the bumper, C-shaped tail lamps split between the body and
// the trunk lid.
// Coordinates: x forward, y up, z right (left is -z), meters, origin under the car's middle.

import { mirrorBox } from '../lib.mjs';

const sides = (fn) => [fn('left', -1), fn('right', 1)];
/** A box given for the right side (z > 0), on the chosen side. */
const on = (s, box) => (s > 0 ? box : mirrorBox(box));

/**
 * Boxes (for `mode: 'tri'`) covering everything forward of a slanted line,
 * given as [y, x] points from bottom to top, in thin horizontal bands.
 */
function forwardOf(line, xMax, [zMin, zMax], step = 0.004) {
  const boxes = [];
  for (let y = line[0][0]; y < line[line.length - 1][0]; y += step) {
    const mid = y + step / 2;
    const i = Math.max(1, line.findIndex(([ly]) => ly >= mid));
    const [y0, x0] = line[i - 1];
    const [y1, x1] = line[i];
    const x = x0 + ((x1 - x0) * (mid - y0)) / (y1 - y0);
    boxes.push([[x, y, zMin], [xMax, y + step, zMax]]);
  }
  return boxes;
}

/** A box in meters, in the source file's units (the build's scale is 0.31755). */
const unscaled = (box) => box.map((corner) => corner.map((v) => v / 0.31755));

// The charge port door is the front section of the left tail lamp. The model
// has it in one piece with the lamp, so it is cut out: the lens along its
// crease, the housing behind it along the edge of the C-shaped tail lamp.
const PORT_Z = [-0.82, -0.58];
const portLens = forwardOf([[0.76, -2.0], [0.8, -2.007], [0.83, -2.015], [0.86, -2.022], [0.885, -2.03], [0.9, -2.04], [0.905, -2.045], [0.94, -2.045]], -1.74, PORT_Z);
const portHousing = forwardOf([[0.76, -1.955], [0.795, -1.955], [0.81, -1.962], [0.84, -1.972], [0.87, -1.98], [0.9, -1.987], [0.94, -1.99]], -1.74, PORT_Z);

// The trunk lid: the deck behind the rear window (with its two arms along the
// glass), the panel around the plate, the badge, and the inner halves of the
// tail lamps. The paint around it is in many small fragments, so the lid's own
// pieces are picked by where their middle is: on the car's centerline.
const LID = [[-2.3, 0.6, -0.02], [-1.8, 1.1, 0.02]];
const LID_LAMPS = [[-2.3, 0.75, -0.62], [-2.0, 0.95, 0.62]];

export default {
  id: 'model3-2017',
  source: {
    uid: 'bcecd9bf5ffe43d7bac744332fc12d82',
    title: 'Tesla Model 3',
    author: 'David_Holiday',
    authorUrl: 'https://sketchfab.com/David_Holiday',
    url: 'https://sketchfab.com/3d-models/tesla-model-3-bcecd9bf5ffe43d7bac744332fc12d82',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  front: '+z',
  lengthM: 4.694,
  textureSize: 256,
  // The inner frames of the four doors, hidden between the door skins and the door cards.
  // (Drop rules run before the model is scaled, so these boxes are in source units.)
  drop: [
    ...sides((side, s) => ({ mat: /Object_2 \| Body$/, box: on(s, unscaled([[-0.1, 0.28, 0.78], [1.02, 0.91, 0.925]])) })),
    ...sides((side, s) => ({ mat: /Object_2 \| Body$/, box: on(s, unscaled([[-1.205, 0.25, 0.715], [-0.14, 0.997, 0.93]])) })),
  ],
  materials: [
    [/\| Body$/, 'paint'],
    [/Body_noir/, 'gloss'],
    [/\| Vitre$|Vitre_toit/, 'glass'],
    [/Phare_vitre/, 'lens'],
    [/Feux_glass/, 'redlens'],
    // Headlights and bumper lamps.
    [/\| Phare$/, { preset: 'reflector', name: 'headreflector', color: [0.32, 0.32, 0.34], metal: 0.6, rough: 0.45 }],
    [/Phare_alu/, { preset: 'reflector', name: 'headtrim', color: [0.45, 0.45, 0.47], metal: 0.5, rough: 0.45 }],
    [/Phare_blanc|Phare_feux_b/, { preset: 'reflector', name: 'lightguide', color: [0.36, 0.37, 0.39], metal: 0, rough: 0.5 }],
    [/Phare_orange/, 'amberinner'],
    // Tail lamps.
    [/Feux_blanc/, { preset: 'reflector', name: 'taillightguide', color: [0.4, 0.4, 0.41], metal: 0, rough: 0.5 }],
    [/Feux_chrome/, { preset: 'redinner', name: 'tailreflector', color: [0.3, 0.04, 0.04], metal: 0.4, rough: 0.5 }],
    [/Feux_noir/, { preset: 'black', name: 'lamphousing', rough: 0.5 }],
    [/Feux_rouge|Feux_stop/, 'redinner'],
    // Wheels and brakes.
    [/Pneu_text/, 'rubber'],
    [/\| Jante$/, { preset: 'alloy', name: 'rim', color: [0.3, 0.305, 0.32], metal: 0.85, rough: 0.34 }],
    [/Jante_noir/, { preset: 'darkalloy', name: 'rimdark' }],
    [/Disk/, 'disc'],
    [/Frein/, { preset: 'caliper', color: [0.4, 0.02, 0.02] }],
    [/Metal_noir/, { preset: 'darkalloy', name: 'hub', rough: 0.45 }],
    [/Mecanique|Dessous/, { preset: 'black', name: 'underbody', rough: 0.75 }],
    // Trim.
    [/\| Chrome$/, { preset: 'chrome', rough: 0.16 }],
    [/Miroir/, 'mirror'],
    [/Partie_noir|Plastique_noir/, 'black'],
    // Cabin. The center screen's texture is a screenshot of Tesla's software; it is left dark instead.
    [/Interieur_display/, 'screen'],
    [/Interieur_gris/, { preset: 'lightinterior', name: 'headliner' }],
    [/Interieur_light/, { preset: 'lightinterior', name: 'domelight', rough: 0.5 }],
    [/Interieur_noir_b/, { preset: 'gloss', name: 'console', rough: 0.15 }],
    [/Interieur_bois/, { preset: 'keep', name: 'wood', rough: 0.6, keepTexture: true, color: [1, 1, 1] }],
    [/Siege/, { preset: 'interior', name: 'seat', color: [0.04, 0.04, 0.045], rough: 0.7 }],
    [/Interieur_porte/, { preset: 'interior', name: 'doorcard', rough: 0.8 }],
    [/Metal_alu/, { preset: 'alloy', name: 'cabinmetal', rough: 0.4 }],
    [/Plastique_rouge/, { preset: 'caliper', name: 'buckle', rough: 0.6 }],
    [/Interieur/, 'interior'],
  ],
  parts: {
    liftgate: {
      select: [
        { mat: /\| Body$|\| Chrome$/, box: LID, mode: 'center' },
        { mat: /Feux_|\| Chrome$|Partie_noir/, box: LID_LAMPS },
      ],
      rig: { type: 'hinge', pivot: [-1.52, 1.18, 0], axis: [0, 0, 1], deg: -72 },
    },
    ...Object.fromEntries(
      sides((side, s) => [
        `${side}Mirror`,
        {
          select: [
            { mat: /\| Body$|Miroir/, box: on(s, [[0.58, 0.85, 0.84], [0.85, 1.03, 1.08]]) },
            // The chrome underside and stalk, without the strip that runs on along the door.
            { mat: /\| Chrome$/, box: on(s, [[0.58, 0.84, 0.8], [0.92, 0.93, 1.08]]), mode: 'tri' },
          ],
          rig: { type: 'hinge', pivot: [0.8, 0.9, s * 0.83], axis: [0, 1, 0], deg: s * -55, invert: true },
        },
      ]),
    ),
    ...Object.fromEntries(
      sides((side, s) => [
        `${side}FrontWindow`,
        { select: [{ mat: /\| Vitre$/, box: on(s, [[-0.25, 0.84, 0.6], [1.0, 1.32, 0.83]]) }], rig: { type: 'slide', vector: [0, -0.45, s * 0.07] } },
      ]),
    ),
    ...Object.fromEntries(
      sides((side, s) => [
        `${side}RearWindow`,
        { select: [{ mat: /\| Vitre$/, box: on(s, [[-1.13, 0.9, 0.58], [-0.22, 1.33, 0.83]]) }], rig: { type: 'slide', vector: [0, -0.42, s * 0.07] } },
      ]),
    ),
    chargePort: {
      select: [
        ...portLens.map((box) => ({ mat: /Feux_glass/, box, mode: 'tri' })),
        ...portHousing.map((box) => ({ mat: /Feux_noir/, prim: undefined, box, mode: 'tri' })),
        // The side marker reflector.
        { mat: /Feux_chrome|Feux_rouge/, box: [[-1.98, 0.84, -0.8], [-1.84, 0.89, -0.76]] },
      ],
      rig: { type: 'hinge', pivot: [-1.87, 0.932, -0.765], axis: [0.96, 0, -0.28], deg: 112 },
    },
  },
  lamps: [
    // Headlights, after Tesla's diagram: 1 outer and 2 inner main beam (the row of
    // reflector cells), 3 the strip arching over them, 4-6 the top outer corner,
    // 7 the strip along the bottom edge.
    ...sides((side, s) => ({ ids: [`${side}OuterMainBeam`], select: [{ mat: /\| Phare$/, clip: on(s, [[1.8, 0.6, 0.648], [2.06, 0.73, 0.82]]) }] })),
    ...sides((side, s) => ({ ids: [`${side}InnerMainBeam`], select: [{ mat: /\| Phare$/, clip: on(s, [[1.8, 0.6, 0.46], [2.06, 0.73, 0.648]]) }] })),
    ...sides((side, s) => ({ ids: [`${side}Signature`], select: [{ mat: /Phare_alu/, box: on(s, [[1.7, 0.65, 0.5], [2.1, 0.79, 0.8]]) }] })),
    ...sides((side, s) => ({
      ids: [`${side}Channel4`, `${side}Channel5`, `${side}Channel6`],
      select: [{ mat: /Phare_blanc/, box: on(s, [[1.7, 0.68, 0.6], [2.0, 0.79, 0.79]]) }],
    })),
    ...sides((side, s) => ({ ids: [`${side}FrontTurn`], color: 'amber', select: [{ mat: /Phare_alu/, box: on(s, [[1.9, 0.59, 0.46], [2.17, 0.655, 0.81]]) }] })),
    // Bumper lamps: 8 fog (outboard), 9 the long park strip, 10 the side marker at the inboard tip.
    ...sides((side, s) => ({ ids: [`${side}FrontFog`], select: [{ mat: /\| Phare$/, box: on(s, [[2.04, 0.38, 0.77], [2.1, 0.43, 0.82]]) }] })),
    ...sides((side, s) => ({ ids: [`${side}AuxPark`], select: [{ mat: /Phare_feux_b/, box: on(s, [[2.06, 0.37, 0.57], [2.22, 0.42, 0.79]]) }] })),
    ...sides((side, s) => ({ ids: [`${side}SideMarker`], color: 'amber', select: [{ mat: /Phare_orange/, box: on(s, [[2.18, 0.37, 0.56], [2.24, 0.42, 0.63]]) }] })),
    // Turn repeaters: the rear half of the camera housings on the front fenders.
    ...sides((side, s) => ({ ids: [`${side}SideRepeater`], color: 'amber', select: [{ mat: /\| Chrome$/, clip: on(s, [[1.08, 0.65, 0.86], [1.165, 0.715, 0.91]]) }] })),
    // Tail lamps: the red C on the body and its continuation on the trunk lid, plus the side marker on the fender.
    ...sides((side, s) => ({ ids: [`${side}Tail`], color: 'red', select: [{ mat: /Feux_rouge$/, box: on(s, [[-2.24, 0.76, 0.38], [-1.84, 0.93, 0.8]]) }] })),
    // Brake: the pods inside the C, and the strip at the bottom of the rear window.
    {
      ids: ['brakeLights'],
      color: 'red',
      select: [
        { mat: /\| Chrome$/, box: [[-2.22, 0.82, -0.74], [-2.02, 0.9, 0.74]] },
        { mat: /Feux_stop/ },
        // The strip sits under the rear glass, which hides it: light the glass over it too.
        { mat: /\| Vitre$/, clip: [[-1.962, 1.09, -0.32], [-1.885, 1.15, 0.32]] },
      ],
    },
    // The bar inside each pod: turn signal on the body, reverse on the trunk lid.
    ...sides((side, s) => ({ ids: [`${side}RearTurn`], color: 'amber', select: [{ mat: /Feux_blanc/, box: on(s, [[-2.14, 0.84, 0.6], [-2.05, 0.87, 0.72]]) }] })),
    { ids: ['reverseLights'], select: [{ mat: /Feux_blanc/, box: [[-2.21, 0.84, -0.6], [-2.12, 0.87, 0.6]], mode: 'center' }] },
    { ids: ['rearFog'], color: 'red', select: [{ mat: /Feux_rouge_b/ }] },
    // No plate lamps in the model: two small ones under the lip above the plate.
    { ids: ['licensePlate'], part: 'liftgate', gain: 1.5, add: [[[-2.276, 0.81, 0.1], [-2.25, 0.82, 0.14]], [[-2.276, 0.81, -0.14], [-2.25, 0.82, -0.1]]] },
  ],
  beams: { head: [2.0, 0.66, 0.64], fog: [2.07, 0.4, 0.79] },
  cabin: [0.55, 0.95, 0],
  simplify: [
    [/body\/seat/, 0.14, 0.002],
    [/body\/interior/, 0.15, 0.002],
    [/body\/(doorcard|console|headliner)/, 0.3, 0.002],
    [/body\/caliper/, 0.1, 0.003],
    [/body\/(hub|underbody|disc)/, 0.3, 0.003],
    [/body\/rim$/, 0.2, 0.001],
    [/body\/rimdark/, 0.5, 0.001],
    [/body\/rubber/, 0.45, 0.001],
    [/\/chrome$/, 0.26, 0.0005],
    [/body\/black$/, 0.25, 0.001],
    [/lamp\/(brakeLights|.*FrontTurn)/, 0.5, 0.0005],
  ],
};
