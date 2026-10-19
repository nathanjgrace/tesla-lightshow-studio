// Reshapes Tesla's Model S mesh into the models that share its design.
// Tesla publishes no Model 3, X or Y model, but the 2021+ S shares the X's
// platform and front end, and the original 3 and Y the same design language.
// Moving the axles, changing ride height, width and wheel size, and raising
// the greenhouse along each model's roofline gives recognizable cars with
// Tesla's real surfaces, lamps and wheels. Refreshed versions (2024+ Model 3,
// 2025+ Model Y) have different lamps and light bars, so they keep the
// code-built body (bodies.ts).
//
// All numbers are meters in the S mesh's frame (x forward, y up, z right),
// measured from Tesla's ModelS.obj and published dimensions.

import type { BodyStyle } from '../../core/vehicles';

export interface Warp {
  /** How the result is described in the UI. */
  label: string;
  /** Maps a point (mesh units) of a given OBJ group to the new shape. */
  apply(p: [number, number, number], group: string): [number, number, number];
}

type Table = readonly [number, number][];

const lerpTable = (table: Table, x: number): number => {
  if (x <= table[0]![0]) return table[0]![1];
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i]!;
    if (x <= x1) {
      const [x0, y0] = table[i - 1]!;
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return table[table.length - 1]![1];
};

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const S_UNITS = 200;

/** The Model S mesh: ends, axles, wheel size and roofline (highest body point at each x). */
const S = {
  rearEnd: -2.56,
  rearAxle: -1.357,
  frontAxle: 1.606,
  frontEnd: 2.56,
  wheelRadius: 0.353,
  roof: [
    [-2.5, 0.66],
    [-2.38, 1.04],
    [-2.12, 1.08],
    [-1.88, 1.17],
    [-1.62, 1.25],
    [-1.38, 1.32],
    [-1.12, 1.37],
    [-0.75, 1.42],
    [-0.38, 1.43],
    [0, 1.4],
    [0.25, 1.36],
    [0.5, 1.29],
    [0.75, 1.15],
    [1.0, 1.06],
    [1.25, 0.97],
    [1.62, 0.91],
    [2.5, 0.63],
  ] as Table,
};

/** Below this the body keeps its shape; above it, it rises toward the roof. */
const BELT = 0.86;

interface Shape {
  label: string;
  rearEnd: number;
  rearAxle: number;
  frontAxle: number;
  frontEnd: number;
  wheelRadius: number;
  /** Extra ride height. */
  lift: number;
  width: number;
  /** How much higher the roof is than the S's, by the S's x. */
  roofRaise: Table;
}

function warpTo(shape: Shape): Warp {
  // Lengthwise: the overhangs and wheelbase stretch separately.
  const xMap: Table = [
    [S.rearEnd, shape.rearEnd],
    [S.rearAxle, shape.rearAxle],
    [S.frontAxle, shape.frontAxle],
    [S.frontEnd, shape.frontEnd],
  ];
  const mapX = (x: number) => {
    if (x < S.rearEnd) return shape.rearEnd + (x - S.rearEnd);
    if (x > S.frontEnd) return shape.frontEnd + (x - S.frontEnd);
    return lerpTable(xMap, x);
  };
  const k = shape.wheelRadius / S.wheelRadius;
  return {
    label: shape.label,
    apply([ux, uy, uz], group) {
      const x = ux / S_UNITS;
      const y = uy / S_UNITS;
      const z = uz / S_UNITS;
      if (group === 'Wheels') {
        // Rigid: each wheel scales about its own center and moves to the new axle.
        const [axle, newAxle] = x > 0 ? [S.frontAxle, shape.frontAxle] : [S.rearAxle, shape.rearAxle];
        return [
          (newAxle + (x - axle) * k) * S_UNITS,
          (shape.wheelRadius + (y - S.wheelRadius) * k) * S_UNITS,
          z * shape.width * S_UNITS,
        ];
      }
      const roof = lerpTable(S.roof, x);
      const raise = lerpTable(shape.roofRaise, x) * smoothstep(BELT, Math.max(roof, BELT + 0.05), y);
      return [mapX(x) * S_UNITS, (y + shape.lift + raise) * S_UNITS, z * shape.width * S_UNITS];
    },
  };
}

const LABEL = "Adapted from Tesla's Model S model";

/**
 * Model X (2021+): 5.057 m long, 1.68 m tall, 2.965 m wheelbase (same as S),
 * about 4 cm more ground clearance and 22-inch wheels. Near-flat roof back to
 * an upright liftgate.
 */
export const MODEL_X_FROM_S = warpTo({
  label: LABEL,
  rearEnd: S.rearEnd - 0.07,
  rearAxle: S.rearAxle,
  frontAxle: S.frontAxle,
  frontEnd: S.frontEnd + 0.02,
  wheelRadius: 0.375,
  lift: 0.04,
  width: 1.018,
  roofRaise: [
    [-2.62, 0],
    [-2.45, 0.08],
    [-2.25, 0.3],
    [-1.95, 0.37],
    [-1.5, 0.35],
    [-1.0, 0.31],
    [-0.5, 0.25],
    [0, 0.26],
    [0.3, 0.26],
    [0.6, 0.22],
    [0.9, 0.1],
    [1.15, 0],
  ],
});

/**
 * Model Y (2020 – 2024): 4.751 m long, 1.624 m tall, 2.89 m wheelbase,
 * 1.921 m wide, 19 – 20-inch wheels. A taller fastback over a liftgate.
 */
export const MODEL_Y_FROM_S = warpTo({
  label: LABEL,
  rearEnd: -2.27,
  rearAxle: -1.33,
  frontAxle: 1.56,
  frontEnd: 2.48,
  wheelRadius: 0.362,
  lift: 0.035,
  width: 0.978,
  roofRaise: [
    [-2.62, 0],
    [-2.45, 0.05],
    [-2.25, 0.16],
    [-1.9, 0.2],
    [-1.4, 0.2],
    [-0.8, 0.18],
    [0, 0.16],
    [0.5, 0.13],
    [0.9, 0.06],
    [1.15, 0],
  ],
});

/**
 * Model 3 (2017 – 2023): 4.694 m long, 1.443 m tall (as the S), 2.875 m
 * wheelbase, 1.849 m wide, 18-inch wheels.
 */
export const MODEL_3_FROM_S = warpTo({
  label: LABEL,
  rearEnd: -2.27,
  rearAxle: -1.33,
  frontAxle: 1.545,
  frontEnd: 2.42,
  wheelRadius: 0.335,
  lift: 0,
  width: 0.942,
  roofRaise: [
    [-2.4, 0],
    [-1.6, 0.01],
    [0, 0],
  ],
});

/** The reshaping for a body built from the Model S mesh, if any. */
export function warpFor(style: BodyStyle): Warp | undefined {
  if (style.model === 'modelX') return MODEL_X_FROM_S;
  if (style.refresh) return undefined;
  if (style.model === 'modelY') return MODEL_Y_FROM_S;
  if (style.model === 'model3') return MODEL_3_FROM_S;
  return undefined;
}

/** Whether a body is built from the Model S mesh (itself or reshaped). */
export function usesModelS(style: BodyStyle): boolean {
  return style.model === 'modelS' || warpFor(style) !== undefined;
}
