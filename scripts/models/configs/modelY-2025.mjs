// 2025+ Model Y ("Juniper"): light bars front and rear.
// Coordinates: x forward, y up, z right (left is -z), meters, origin under the car's middle.

import { mirrorBox } from '../lib.mjs';

const INF = Infinity;
const sides = (fn) => [fn('left', -1), fn('right', 1)];
/** A box given for the right side (z > 0), on the chosen side. */
const on = (s, box) => (s > 0 ? box : mirrorBox(box));

export default {
  id: 'modelY-2025',
  source: {
    uid: '619601e7800d418da5922c4fa7833f74',
    title: '2025 Tesla Model Y',
    author: 'BloxBloger',
    authorUrl: 'https://sketchfab.com/BloxBloger',
    url: 'https://sketchfab.com/3d-models/2025-tesla-model-y-619601e7800d418da5922c4fa7833f74',
    license: 'CC BY-NC 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/',
  },
  front: '+z',
  lengthM: 4.79,
  materials: [
    [/Material_2125765635/, 'paint'],
    [/glass_base|glass_roof/, 'glass'],
    [/glass_headlight/, 'lens'],
    [/front_white_light/, { preset: 'reflector', name: 'lightbar', color: [0.7, 0.7, 0.72], metal: 0.2, rough: 0.35 }],
    [/back_red_Light|\| material$|red_plastic/, 'redinner'],
    [/\| mirror$/, 'mirror'],
    [/04_-_Default/, 'plate'],
    [/Iron_Clean_Distorted/, 'disc'],
    [/Material_111/, 'darkalloy'],
    [/Material_2125767099/, { preset: 'alloy', color: [0.2, 0.205, 0.215] }],
    [/Rubber_Rough/, 'rubber'],
    [/black222/, 'darkalloy'],
    [/black_reflection/, 'gloss'],
    [/Object_25 \| black_base/, 'interior'],
    [/black/, 'black'],
    [/chrome/, 'chrome'],
  ],
  parts: {
    liftgate: {
      select: [
        { mat: /Material_2125765635|glass_base|black_reflection|chrome|Object_14/, box: [[-2.4, 0.6, -0.76], [-1.25, 1.62, 0.76]] },
        { mat: /black_base/, not: /Object_25/, box: [[-2.4, 0.6, -0.76], [-1.25, 1.62, 0.76]] },
        // The light bar is one piece across the car; its middle rides on the liftgate.
        { mat: /glass_headlight|back_red_Light|\| material$/, box: [[-2.4, 0.95, -0.66], [-1.9, 1.2, 0.66]], mode: 'tri' },
      ],
      rig: { type: 'hinge', pivot: [-1.33, 1.53, 0], axis: [0, 0, 1], deg: -78 },
    },
    ...Object.fromEntries(
      sides((side, s) => [
        `${side}Mirror`,
        {
          select: [{ mat: /Material_2125765635|\| mirror$|black/, not: /Object_25/, box: on(s, [[0.5, 1.05, 0.84], [0.86, 1.28, 1.08]]) }],
          rig: { type: 'hinge', pivot: [0.62, 1.13, s * 0.87], axis: [0, 1, 0], deg: s * 62, invert: true },
        },
      ]),
    ),
    ...Object.fromEntries(
      sides((side, s) => [
        `${side}FrontWindow`,
        { select: [{ mat: /glass_base/, box: on(s, [[-0.36, 1.0, 0.6], [0.75, 1.6, 0.82]]) }], rig: { type: 'slide', vector: [0, -0.44, s * 0.126] } },
      ]),
    ),
    ...Object.fromEntries(
      sides((side, s) => [
        `${side}RearWindow`,
        { select: [{ mat: /glass_base/, box: on(s, [[-1.2, 1.0, 0.6], [-0.3, 1.6, 0.82]]), mode: 'tri' }], rig: { type: 'slide', vector: [0, -0.4, s * 0.115] } },
      ]),
    ),
    chargePort: {
      select: [{ mat: /glass_headlight|red_plastic/, box: [[-2.08, 0.97, -0.83], [-1.83, 1.15, -0.73]] }],
      rig: { type: 'hinge', pivot: [-1.955, 1.137, -0.79], axis: [1, 0, 0], deg: 95 },
    },
  },
  lamps: [
    // Front light bar: assumed to follow the signature channels.
    ...sides((side, s) => ({ ids: [`${side}Signature`], select: [{ mat: /front_white_light/, clip: on(s, [[1.8, 0.7, 0], [2.4, 0.9, 0.9]]) }] })),
    // Headlight pockets below the bar: an upper strip (channels 4-6, one light on Model 3 and Y),
    // inner and outer main beams, and the turn signal at the outer end.
    ...sides((side, s) => ({
      ids: [`${side}Channel4`, `${side}Channel5`, `${side}Channel6`],
      select: [{ mat: /glass_headlight/, clip: on(s, [[1.95, 0.655, 0.6], [2.3, 0.7, 0.84]]) }],
    })),
    ...sides((side, s) => ({ ids: [`${side}InnerMainBeam`], select: [{ mat: /glass_headlight/, clip: on(s, [[1.95, 0.59, 0.6], [2.3, 0.652, 0.72]]) }] })),
    ...sides((side, s) => ({ ids: [`${side}OuterMainBeam`], select: [{ mat: /glass_headlight/, clip: on(s, [[1.95, 0.59, 0.725], [2.3, 0.652, 0.84]]) }] })),
    ...sides((side, s) => ({ ids: [`${side}FrontTurn`], color: 'amber', select: [{ mat: /glass_headlight/, clip: on(s, [[1.95, 0.59, 0.845], [2.3, 0.7, 0.9]]) }] })),
    // Rear light bar: assumed to follow the tail channels.
    ...sides((side, s) => ({
      ids: [`${side}Tail`],
      color: 'red',
      select: [
        { mat: /back_red_Light/, clip: on(s, [[-2.3, 1.0, 0], [-2.0, 1.2, 0.8]]) },
        // The bar glows down onto the panel under it.
        { mat: /glass_headlight/, clip: on(s, [[-2.4, 1.075, 0], [-2.0, 1.125, 0.7]]) },
      ],
    })),
    { ids: ['brakeLights'], color: 'red', select: [{ mat: /\| material$/ }] },
    ...sides((side, s) => ({ ids: [`${side}RearTurn`], color: 'amber', select: [{ mat: /glass_headlight|red_plastic/, box: on(s, [[-2.08, 0.97, 0.73], [-1.83, 1.15, 0.83]]) }] })),
    { ids: ['reverseLights'], select: [{ mat: /red_plastic/, clip: [[-2.3, 0.55, -0.55], [-2.2, 0.63, 0.55]] }] },
    { ids: ['rearFog'], color: 'red', select: [{ mat: /red_plastic/, clip: [[-2.3, 0.55, 0.555], [-2.2, 0.63, 0.7]] }, { mat: /red_plastic/, clip: [[-2.3, 0.55, -0.7], [-2.2, 0.63, -0.555]] }] },
    // The fender camera housings carry the side repeaters.
    ...sides((side, s) => ({ ids: [`${side}SideRepeater`], color: 'amber', select: [{ mat: /black_reflection/, box: on(s, [[1.0, 0.8, 0.9], [1.2, 0.9, 0.96]]) }] })),
    // Nothing is modeled for these: a strip at the top of the rear glass, and two lamps over the plate.
    { ids: ['brakeLights'], color: 'red', part: 'liftgate', add: [[[-1.39, 1.497, -0.2], [-1.375, 1.503, 0.2]]] },
    { ids: ['licensePlate'], gain: 1.5, add: [[[-2.35, 0.612, 0.1], [-2.33, 0.618, 0.14]], [[-2.35, 0.612, -0.14], [-2.33, 0.618, -0.1]]] },
  ],
  beams: { head: [2.2, 0.63, 0.74] },
  cabin: [0.45, 1.0, 0],
};
