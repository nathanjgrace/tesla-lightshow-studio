// Model X. The source is the pre-2021 body (fog lamp pockets in the bumper);
// the 2021+ refresh differs mainly in the front bumper.
// Coordinates: x forward, y up, z right (left is -z), meters, origin under the car's middle.
// The body is one welded shell, so the doors are cut out of it along their shut lines.

import { mirrorBox } from '../lib.mjs';

const sides = (fn) => [fn('left', -1), fn('right', 1)];
/** A box given for the right side (z > 0), on the chosen side. */
const on = (s, box) => (s > 0 ? box : mirrorBox(box));
/** A z range given for the right side, on the chosen side. */
const zr = (s, [a, b]) => (s > 0 ? [a, b] : [-b, -a]);
const parts = (fn) => Object.fromEntries(sides(fn).flat());

// Door outlines in side view [x, y], traced from the model's shut lines.
const B_PILLAR = [[-0.186, 0.365], [-0.262, 1.135]];
const FRONT_DOOR = [B_PILLAR[0], B_PILLAR[1], [0.979, 1.068], [1.027, 0.467], [0.992, 0.345]];
const FALCON_LOWER = [B_PILLAR[0], B_PILLAR[1], [-1.49, 1.21], [-1.43, 0.36]];
const FALCON_WINDOW = [B_PILLAR[1], [-0.345, 1.45], [-1.43, 1.45], [-1.49, 1.21]];
const FALCON_ROOF = [[-0.345, 1.45], [-0.4, 1.76], [-1.33, 1.76], [-1.43, 1.45]];
// The rear wheel arch stays on the body: a disc around the wheel.
const ARCH = Array.from({ length: 16 }, (_, i) => [-1.44 + 0.49 * Math.cos((i * Math.PI) / 8), 0.396 + 0.49 * Math.sin((i * Math.PI) / 8)]);
// The liftgate: a band along the rear glass and one down the tail.
const GATE_GLASS = [[-1.46, 1.72], [-2.6, 1.4], [-2.6, 1.12], [-2.3, 1.12], [-1.46, 1.52]];
const GATE_TAIL = [[-2.6, 1.12], [-2.6, 0.72], [-2.38, 0.72], [-2.3, 1.12]];

const HEAD_LENS = /Index_0_2/;
// The lamp covers are several stacked layers and each adds its glow.
const LENS_GAIN = 1.3;

const GLASS = [
  { mat: /Index_0_2/, box: [[-1.9, 0.97, -0.9], [1.45, 1.7, 0.9]] },
  { mat: /Index_0_2/, box: [[-2.495, 1.2, -0.62], [-1.4, 1.62, 0.62]] },
];

export default {
  id: 'modelX-2021',
  source: {
    uid: 'c61839793eab4f31a26e261a2de750b5',
    title: 'Tesla Model X 2020',
    author: 'ItsDiyor',
    authorUrl: 'https://sketchfab.com/ItsDiyor',
    url: 'https://sketchfab.com/3d-models/tesla-model-x-2020-c61839793eab4f31a26e261a2de750b5',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  front: '+z',
  lengthM: 5.057,
  // The front plate carries the author's name.
  drop: [{ mat: /metal_white/ }],
  materials: [
    [/Paint_Color/, 'paint'],
    ...GLASS.map((rule) => [rule, 'glass']),
  ],
  parts: {
    ...parts((side, s) => [
      [`_${side}RearArch`, { select: [{ mat: /./, poly: ARCH, z: zr(s, [0.8, 1.3]), mode: 'cut' }] }],
      [
        `${side}Mirror`,
        {
          select: [{ mat: /./, box: on(s, [[0.6, 1.05, 0.89], [0.95, 1.27, 1.16]]) }],
          rig: { type: 'hinge', pivot: [0.7, 1.13, s * 0.93], axis: [0, 1, 0], deg: s * 60, invert: true, parent: `${side}FrontDoor` },
        },
      ],
      [
        `${side}FrontWindow`,
        {
          select: [{ mat: /Index_0_2/, box: on(s, [[-0.3, 1.05, 0.66], [0.95, 1.6, 0.87]]) }],
          rig: { type: 'slide', vector: [0, -0.42, s * 0.05], parent: `${side}FrontDoor` },
        },
      ],
      [
        `${side}RearWindow`,
        {
          select: [{ mat: /Index_0_2/, box: on(s, [[-1.25, 1.1, 0.62], [-0.38, 1.6, 0.86]]) }],
          rig: { type: 'slide', vector: [0, -0.4, s * 0.06], parent: `${side}FalconDoor` },
        },
      ],
      [
        `${side}FrontDoor`,
        {
          select: [{ mat: /./, poly: FRONT_DOOR, z: zr(s, [0.8, 1.3]), mode: 'cut' }],
          rig: { type: 'hinge', pivot: [1.0, 0.7, s * 0.93], axis: [0, 1, 0], deg: s * 62 },
        },
      ],
      [
        `${side}FalconDoor`,
        {
          select: [
            { mat: /./, poly: FALCON_LOWER, z: zr(s, [0.8, 1.3]), mode: 'cut' },
            { mat: /./, poly: FALCON_WINDOW, z: zr(s, [0.6, 1.3]), mode: 'cut' },
            { mat: /./, poly: FALCON_ROOF, z: zr(s, [0.17, 1.3]), mode: 'cut' },
          ],
          rig: { type: 'hinge', pivot: [-0.85, 1.66, s * 0.19], axis: [1, 0, 0], deg: -s * 82 },
        },
      ],
    ]),
    // The charge port door is the forward tip of the left tail lamp.
    chargePort: {
      select: [{ mat: /Index_0_2/, box: [[-2.13, 0.94, -0.92], [-1.99, 1.15, -0.6]], mode: 'cut' }],
      rig: { type: 'hinge', pivot: [-2.13, 1.04, -0.875], axis: [0, 1, 0], deg: 100 },
    },
    liftgate: {
      select: [
        { mat: /./, poly: GATE_GLASS, z: [-0.64, 0.64], mode: 'cut' },
        { mat: /./, poly: GATE_TAIL, z: [-0.655, 0.655], mode: 'cut' },
      ],
      rig: { type: 'hinge', pivot: [-1.5, 1.63, 0], axis: [0, 0, 1], deg: -80 },
    },
  },
  lamps: [
    // Headlight, after Tesla's Model X diagram: main beams low (inner, outer), the
    // signature strip along the bottom and up the outer edge, channels 6-5-4 across the top.
    ...sides((side, s) => ({ ids: [`${side}Signature`], gain: LENS_GAIN, select: [{ mat: HEAD_LENS, clip: on(s, [[1.8, 0.74, 0.47], [2.4, 0.793, 0.92]]) }, { mat: HEAD_LENS, clip: on(s, [[1.8, 0.793, 0.865], [2.4, 0.93, 0.92]]) }] })),
    ...sides((side, s) => ({ ids: [`${side}InnerMainBeam`], gain: LENS_GAIN, select: [{ mat: HEAD_LENS, clip: on(s, [[1.8, 0.797, 0.47], [2.4, 0.853, 0.675]]) }] })),
    ...sides((side, s) => ({ ids: [`${side}OuterMainBeam`], gain: LENS_GAIN, select: [{ mat: HEAD_LENS, clip: on(s, [[1.8, 0.797, 0.68], [2.4, 0.853, 0.86]]) }] })),
    ...sides((side, s) => ({ ids: [`${side}Channel6`], gain: LENS_GAIN, select: [{ mat: HEAD_LENS, clip: on(s, [[1.8, 0.857, 0.47], [2.4, 0.93, 0.625]]) }] })),
    ...sides((side, s) => ({ ids: [`${side}Channel5`], gain: LENS_GAIN, select: [{ mat: HEAD_LENS, clip: on(s, [[1.8, 0.857, 0.63], [2.4, 0.93, 0.74]]) }] })),
    ...sides((side, s) => ({ ids: [`${side}Channel4`], gain: LENS_GAIN, select: [{ mat: HEAD_LENS, clip: on(s, [[1.8, 0.857, 0.745], [2.4, 0.93, 0.86]]) }] })),
    // Bumper lamp: turn signal on top, fog, then aux park; the side marker is the reflector by the wheel arch.
    ...sides((side, s) => ({ ids: [`${side}FrontTurn`], color: 'amber', select: [{ mat: /Index_0_2/, clip: on(s, [[2.1, 0.52, 0.74], [2.3, 0.6, 0.88]]) }] })),
    ...sides((side, s) => ({ ids: [`${side}FrontFog`], select: [{ mat: /Index_0_2/, clip: on(s, [[2.1, 0.445, 0.74], [2.3, 0.515, 0.88]]) }] })),
    ...sides((side, s) => ({ ids: [`${side}AuxPark`], select: [{ mat: /Index_0_2/, clip: on(s, [[2.1, 0.37, 0.74], [2.3, 0.44, 0.88]]) }] })),
    ...sides((side, s) => ({ ids: [`${side}SideMarker`], color: 'amber', select: [{ mat: /Index_0_2/, box: on(s, [[1.3, 0.3, 0.88], [1.45, 0.47, 0.93]]) }] })),
    ...sides((side, s) => ({ ids: [`${side}SideRepeater`], color: 'amber', select: [{ mat: /Index_0_1/, box: on(s, [[1.03, 0.86, 0.9], [1.22, 0.94, 0.96]]) }] })),
    // Tail lamps: the upper half is the tail light, the lower half of the body-side piece the
    // brake light with the turn signal at its forward tip; the liftgate piece carries the reverse light.
    ...sides((side, s) => ({ ids: [`${side}Tail`], color: 'red', gain: LENS_GAIN, select: [{ mat: /Index_0_2/, clip: on(s, [[-2.5, 1.05, 0.38], [-2.0, 1.15, 0.9]]) }] })),
    { ids: ['brakeLights'], color: 'red', gain: LENS_GAIN, select: [...sides((side, s) => ({ mat: /Index_0_2/, clip: on(s, [[-2.5, 0.94, 0.655], [-2.2, 1.045, 0.9]]) })), { mat: /Index_0_2/, box: [[-2.52, 1.3, -0.3], [-2.47, 1.35, 0.3]] }] },
    ...sides((side, s) => ({ ids: [`${side}RearTurn`], color: 'amber', gain: LENS_GAIN, select: [{ mat: /Index_0_2/, clip: on(s, [[-2.195, 0.94, 0.6], [-2.0, 1.045, 0.9]]) }] })),
    { ids: ['reverseLights'], gain: LENS_GAIN, select: sides((side, s) => ({ mat: /Index_0_2/, clip: on(s, [[-2.5, 0.94, 0.38], [-2.3, 1.045, 0.65]]) })) },
    { ids: ['rearFog'], color: 'red', select: [{ mat: /Index_0_2/, box: [[-2.5, 0.49, -0.67], [-2.38, 0.56, 0.67]], mode: 'tri' }] },
    { ids: ['licensePlate'], part: 'liftgate', gain: 1.5, add: [[[-2.5, 1.0, 0.13], [-2.475, 1.007, 0.17]], [[-2.5, 1.0, -0.17], [-2.475, 1.007, -0.13]]] },
  ],
  beams: { head: [2.2, 0.82, 0.7], fog: [2.25, 0.48, 0.8] },
  cabin: [0.55, 1.05, 0],
};
