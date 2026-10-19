// Stylized 3D bodies for each Tesla model, built from code. Proportions come
// from published dimensions (length, height, width, wheelbase); details are
// simplified. Lighting hardware that differs by version and trim (refreshed
// slim headlights, Model Y light bars, fog lamps) follows the BodyStyle.
//
// Tesla only publishes 3D models of the Model S and Cybertruck (in its xLights
// project), so these stand in until we license high-quality models.

import * as THREE from 'three';
import type { BodyStyle } from '../../core/vehicles';
import type { Builder, BuiltBody } from './CarScene';
import { assignMaterials, BodyKit, COLORS, polygon, rockerWithArches, roundedRect, SIDES, sideSign, type TaperSpec } from './kit';
import {
  bumperLamps,
  chargePort,
  doorHandles,
  headBeams,
  headlights,
  highBrake,
  hingedDoor,
  interior,
  lightBar,
  mirrors,
  rearLowLights,
  sideRepeaters,
  tailLights,
  wheels,
  windowPane,
} from './parts';

const deg = THREE.MathUtils.degToRad;
const BEVEL = 0.11;
/** How far the rounded edges push surfaces outside the profile outline. */
const GROWTH = BEVEL * 0.8;

type Pt = [number, number];

export function buildBody(b: Builder, style: BodyStyle): BuiltBody {
  switch (style.model) {
    case 'modelS':
      return buildFamily(b, style, MODEL_S);
    case 'model3':
      return buildFamily(b, style, MODEL_3);
    case 'modelX':
      return buildFamily(b, style, MODEL_X);
    case 'modelY':
      return buildFamily(b, style, MODEL_Y);
    case 'cybertruck':
      return buildCybertruck(b);
  }
}

// --- Model S, 3, X, Y: one builder, per-model dimensions ---------------------

interface FamilySpec {
  halfWidth: number;
  taper: TaperSpec;
  height: number;
  frontX: number;
  rearX: number;
  rockerY: number;
  axles: { front: number; rear: number };
  wheelRadius: number;
  archRadius: number;
  beltY: number;
  /** Continues the side profile from the front of the rocker around to its rear. */
  outline: (s: THREE.Shape) => void;
  /** Top surfaces between these x positions are glass (windshield, roof, rear glass). */
  glassFrom: number;
  glassTo: number;
  /** Side surfaces above the belt are body color forward of this, black trim behind. */
  aPillarX: number;
  frontDoor: { x0: number; x1: number };
  rearDoor: { x0: number; x1: number };
  doorBottom: number;
  frontWindow: Pt[];
  rearWindow: THREE.Shape;
  quarterWindow?: THREE.Shape;
  falconDoors?: boolean;
  rearClosure: { hinge: Pt; outline: Pt[]; curve?: { control: Pt; to: Pt }; openDeg: number; glassAboveY: number; brake: Pt };
  headlights: { x: number; y: number; tilt: number; zIn: number; zOut: number; refreshY?: number };
  bumper: { x: number; y: number; zIn: number; zOut: number };
  /** Front light bar: a point on the profile outline, and the surface normal's angle there. */
  frontBar?: { x: number; y: number; tilt: number; halfLength: number };
  rearBar?: { y: number; halfLength: number };
  tail: { x: number; y: number; zIn: number; zOut: number };
  rearLow: { x: number; plateY: number; fogY: number; fogZ: number };
  repeater: Pt;
  mirror: Pt;
  chargePort: Pt;
  doorHandles?: boolean;
  cabin: { x0: number; x1: number; y0: number; y1: number; halfWidth: number; display: Pt };
}

function buildFamily(b: Builder, style: BodyStyle, spec: FamilySpec): BuiltBody {
  const kit = new BodyKit(spec.halfWidth, spec.taper);

  // Body: side profile with door and window openings, extruded and tapered.
  const s = new THREE.Shape();
  rockerWithArches(s, spec.rearX, spec.frontX, spec.rockerY, spec.axles, spec.archRadius, spec.wheelRadius + 0.01);
  spec.outline(s);
  const doorTop = spec.beltY - 0.03;
  s.holes.push(
    roundedRect(spec.frontDoor.x0, spec.doorBottom, spec.frontDoor.x1, doorTop, 0.06),
    roundedRect(spec.rearDoor.x0, spec.doorBottom, spec.rearDoor.x1, doorTop, 0.06),
    polygon(spec.frontWindow),
    spec.rearWindow,
    ...(spec.quarterWindow ? [spec.quarterWindow] : []),
  );
  const extruded = kit.extrudeAcross(s, spec.halfWidth * 2, BEVEL);
  kit.taper(extruded);
  // Materials: 0 = paint, 1 = glass, 2 = black trim.
  const body = assignMaterials(extruded, (c, n) => {
    if (c.y < spec.beltY + 0.03) return 0;
    if (Math.abs(n.z) > 0.75) return c.x > spec.aPillarX ? 0 : 2;
    return c.x > spec.glassTo && c.x < spec.glassFrom ? 1 : 0;
  });
  b.car.add(new THREE.Mesh(body, [b.m.paint, b.m.glass, b.m.trim]));

  wheels(b, spec.axles, spec.wheelRadius, spec.halfWidth - 0.14);
  interior(b, { ...spec.cabin, displayX: spec.cabin.display[0], displayY: spec.cabin.display[1] });

  // Doors and windows.
  const frontDoorShape = roundedRect(spec.frontDoor.x0 - 0.005, spec.doorBottom - 0.005, spec.frontDoor.x1 + 0.005, doorTop + 0.005, 0.06);
  for (const side of SIDES) {
    if (spec.falconDoors) {
      // Model X: front doors and their windows open in shows.
      const hinge = hingedDoor(b, kit, side, frontDoorShape, spec.frontDoor.x1, `${side}FrontDoor`);
      windowPane(b, kit, side, polygon(spec.frontWindow), `${side}FrontWindow`, hinge, new THREE.Vector3(-spec.frontDoor.x1, 0, -sideSign(side) * kit.halfWidth));
    } else {
      hingedDoor(b, kit, side, frontDoorShape, spec.frontDoor.x1);
      hingedDoor(
        b,
        kit,
        side,
        roundedRect(spec.rearDoor.x0 - 0.005, spec.doorBottom - 0.005, spec.rearDoor.x1 + 0.005, doorTop + 0.005, 0.06),
        spec.rearDoor.x1,
      );
      windowPane(b, kit, side, polygon(spec.frontWindow), `${side}FrontWindow`);
      windowPane(b, kit, side, spec.rearWindow, `${side}RearWindow`, b.car, new THREE.Vector3(), 0.26);
    }
    if (spec.quarterWindow) b.car.add(new THREE.Mesh(kit.sidePanel(spec.quarterWindow, side, 0.01, -0.03), b.m.sideGlass));
  }
  if (spec.falconDoors) falconDoors(b, kit, spec);
  if (spec.doorHandles) {
    const y = spec.doorBottom + (doorTop - spec.doorBottom) * 0.72;
    doorHandles(
      b,
      kit,
      SIDES.flatMap((side) => [
        { id: `${side}FrontDoorHandle`, side, x: spec.frontDoor.x0 + 0.3, y },
        { id: `${side}RearDoorHandle`, side, x: spec.rearDoor.x0 + 0.3, y },
      ]),
    );
  }
  mirrors(b, kit, spec.mirror[0], spec.mirror[1]);
  rearClosure(b, kit, spec);

  // Front lighting.
  const h = spec.headlights;
  const slim = !!style.refresh;
  const hy = slim && h.refreshY !== undefined ? h.refreshY : h.y;
  headlights(b, {
    x: h.x + GROWTH * Math.sin(Math.PI / 2 - h.tilt),
    y: hy + GROWTH * Math.cos(Math.PI / 2 - h.tilt),
    tilt: h.tilt,
    zIn: h.zIn,
    zOut: h.zOut,
    slim,
  });
  const fx = spec.bumper.x + GROWTH;
  bumperLamps(b, { x: fx, y: spec.bumper.y, zIn: spec.bumper.zIn, zOut: spec.bumper.zOut, fog: !!style.fogLamps });
  headBeams(b, { x: h.x + 0.2, y: hy, z: (h.zIn + h.zOut) / 2 }, style.fogLamps ? { x: fx, y: spec.bumper.y, z: spec.bumper.zOut } : undefined);
  sideRepeaters(b, kit, spec.repeater[0], spec.repeater[1]);
  if (style.frontLightBar && spec.frontBar) {
    // Which channel drives this bar isn't documented; we assume the signature lights.
    const fb = spec.frontBar;
    lightBar(b, {
      x: fb.x + (GROWTH + 0.01) * Math.cos(fb.tilt),
      y: fb.y + (GROWTH + 0.01) * Math.sin(fb.tilt),
      tilt: fb.tilt,
      halfLength: fb.halfLength,
      leftIds: ['leftSignature'],
      rightIds: ['rightSignature'],
      color: COLORS.white,
      lens: COLORS.lensFront,
    });
  }

  // Rear lighting.
  tailLights(b, b.car, { ...spec.tail, x: spec.tail.x - GROWTH - 0.012 });
  rearLowLights(b, { ...spec.rearLow, x: spec.rearLow.x - GROWTH });
  if (style.rearLightBar && spec.rearBar) {
    // Assumed to follow the tail lights (undocumented).
    lightBar(b, {
      x: spec.tail.x - GROWTH - 0.014,
      y: spec.rearBar.y,
      halfLength: spec.rearBar.halfLength,
      leftIds: ['leftTail'],
      rightIds: ['rightTail'],
      color: COLORS.red,
      lens: COLORS.lensRear,
    });
  }
  chargePort(b, kit, spec.chargePort[0], spec.chargePort[1]);

  return { halfLength: spec.frontX + 0.2, height: spec.height, halfWidth: spec.halfWidth + 0.1 };
}

/** Liftgate (S, X, Y) or trunk lid (3), hinged at its top/front edge. */
function rearClosure(b: Builder, kit: BodyKit, spec: FamilySpec): void {
  const rc = spec.rearClosure;
  const hinge = new THREE.Group();
  hinge.position.set(rc.hinge[0], rc.hinge[1], 0);
  b.car.add(hinge);
  const shape = new THREE.Shape();
  shape.moveTo(rc.hinge[0], rc.hinge[1] - 0.01);
  if (rc.curve) shape.quadraticCurveTo(...rc.curve.control, ...rc.curve.to);
  for (const p of rc.outline) shape.lineTo(...p);
  shape.closePath();
  const extruded = kit.extrudeAcross(shape, kit.halfWidth * 2, BEVEL);
  kit.taper(extruded);
  const gate = assignMaterials(extruded, (c, n) => {
    if (Math.abs(n.z) > 0.75) return c.y < spec.beltY + 0.08 ? 0 : 2;
    return c.y > rc.glassAboveY && n.y > 0.25 ? 1 : 0;
  });
  gate.translate(-rc.hinge[0], -rc.hinge[1], 0);
  hinge.add(new THREE.Mesh(gate, [b.m.paint, b.m.glass, b.m.trim]));
  highBrake(b, hinge, [rc.brake[0] - rc.hinge[0], rc.brake[1] - rc.hinge[1], 0]);
  b.closure('liftgate', (p) => (hinge.rotation.z = -p * deg(rc.openDeg)), hinge);
}

/** Model X falcon wings: side wall curving into the roof, hinged on the center line. */
function falconDoors(b: Builder, kit: BodyKit, spec: FamilySpec): void {
  const { x0, x1 } = spec.rearDoor;
  const length = x1 - x0 + 0.01;
  const xMid = (x0 + x1) / 2;
  const roofTop = 1.66 + GROWTH + 0.012;
  for (const side of SIDES) {
    const s = sideSign(side);
    const hinge = new THREE.Group();
    hinge.position.set(xMid, roofTop, 0);
    b.car.add(hinge);
    const outer: Pt[] = [];
    for (let y = spec.doorBottom - 0.005; y <= 1.48; y += 0.04) outer.push([kit.surfaceZ(xMid, y) + 0.006, y]);
    const edgeR = 0.16;
    const edgeZ = kit.surfaceZ(xMid, 1.5) + 0.006;
    for (let a = 0; a <= 1.0001; a += 0.125) {
      const t = (a * Math.PI) / 2;
      outer.push([edgeZ - edgeR + edgeR * Math.cos(t), roofTop - edgeR + edgeR * Math.sin(t)]);
    }
    outer.push([0.004, roofTop]);
    // Two pieces: the painted lower door, and the frame curving into the roof.
    const thickness = 0.025;
    const piece = (points: Pt[]) => {
      const contour = [...points, ...points.slice().reverse().map(([zz, yy]): Pt => [zz - thickness, yy - thickness])];
      const g = new THREE.ExtrudeGeometry(polygon(contour), { depth: length, bevelEnabled: false, curveSegments: 4 });
      // Shape x is car z, shape y is car y, extrusion runs along car -x.
      g.rotateY(-Math.PI / 2);
      g.translate(x1 + 0.005, 0, 0);
      if (s < 0) g.scale(1, 1, -1);
      g.translate(-xMid, -roofTop, 0);
      return g;
    };
    const lower = piece(outer.filter(([, yy]) => yy <= 1.05));
    const upper = assignMaterials(piece(outer.filter(([, yy]) => yy >= 1.5)), (c) => (c.y + roofTop < 1.6 ? 0 : 1));
    hinge.add(new THREE.Mesh(lower, b.m.paint), new THREE.Mesh(upper, [b.m.trim, b.m.glass]));
    windowPane(b, kit, side, spec.rearWindow, `${side}RearWindow`, hinge, new THREE.Vector3(-xMid, -roofTop, 0));
    b.closure(`${side}FalconDoor`, (p) => (hinge.rotation.x = -s * p * deg(100)), hinge);
  }
}

const MODEL_X: FamilySpec = {
  halfWidth: 1.0,
  taper: { from: 0.95, roof: 0.3, endStart: 2.0, endLength: 0.6, endAmount: 0.14 },
  height: 1.75,
  frontX: 2.42,
  rearX: -2.4,
  rockerY: 0.22,
  axles: { front: 1.48, rear: -1.49 },
  wheelRadius: 0.37,
  archRadius: 0.47,
  beltY: 1.0,
  outline: (s) => {
    s.quadraticCurveTo(2.56, 0.26, 2.56, 0.44);
    s.lineTo(2.54, 0.6);
    s.quadraticCurveTo(2.5, 0.71, 2.3, 0.8);
    s.quadraticCurveTo(1.8, 0.94, 1.22, 0.99); // hood
    s.quadraticCurveTo(0.45, 1.44, -0.1, 1.64); // long windshield
    s.quadraticCurveTo(-0.85, 1.71, -1.62, 1.65); // roof
    s.lineTo(-1.8, 1.5); // opening for the liftgate
    s.lineTo(-1.84, 1.06);
    s.lineTo(-2.44, 1.06);
    s.quadraticCurveTo(-2.53, 1.0, -2.53, 0.8);
    s.quadraticCurveTo(-2.54, 0.52, -2.52, 0.38);
    s.quadraticCurveTo(-2.5, 0.22, -2.4, 0.22);
  },
  glassFrom: 1.25,
  glassTo: -1.9,
  aPillarX: 1.0,
  frontDoor: { x0: 0.24, x1: 1.1 },
  rearDoor: { x0: -1.05, x1: 0.13 },
  doorBottom: 0.44,
  frontWindow: [
    [0.26, 1.06],
    [0.86, 1.06],
    [0.36, 1.36],
    [0.26, 1.36],
  ],
  rearWindow: roundedRect(-1.0, 1.07, 0.1, 1.5, 0.05),
  quarterWindow: roundedRect(-1.58, 1.08, -1.14, 1.46, 0.05),
  falconDoors: true,
  rearClosure: {
    hinge: [-1.62, 1.66],
    curve: { control: [-2.2, 1.52], to: [-2.42, 1.14] },
    outline: [
      [-2.45, 1.065],
      [-1.84, 1.065],
      [-1.8, 1.5],
    ],
    openDeg: 80,
    glassAboveY: 1.15,
    brake: [-2.43 - GROWTH * 0.6, 1.14 + GROWTH * 0.6],
  },
  headlights: { x: 2.39, y: 0.755, tilt: 0.55, zIn: 0.47, zOut: 0.89 },
  bumper: { x: 2.56, y: 0.43, zIn: 0.4, zOut: 0.8 },
  tail: { x: -2.535, y: 0.985, zIn: 0.41, zOut: 0.75 },
  rearLow: { x: -2.52, plateY: 0.6, fogY: 0.38, fogZ: 0.62 },
  repeater: [1.98, 0.86],
  mirror: [0.95, 1.06],
  chargePort: [-2.3, 0.9],
  cabin: { x0: -1.8, x1: 0.55, y0: 0.45, y1: 1.37, halfWidth: 0.85, display: [1.0, 1.08] },
};

const MODEL_Y: FamilySpec = {
  halfWidth: 0.96,
  taper: { from: 0.95, roof: 0.32, endStart: 1.85, endLength: 0.55, endAmount: 0.14 },
  height: 1.64,
  frontX: 2.18,
  rearX: -2.18,
  rockerY: 0.2,
  axles: { front: 1.42, rear: -1.47 },
  wheelRadius: 0.36,
  archRadius: 0.46,
  beltY: 0.98,
  outline: (s) => {
    s.quadraticCurveTo(2.3, 0.24, 2.3, 0.42);
    s.lineTo(2.28, 0.58);
    s.quadraticCurveTo(2.25, 0.68, 2.05, 0.77);
    s.quadraticCurveTo(1.6, 0.9, 1.0, 0.97); // hood
    s.quadraticCurveTo(0.35, 1.32, -0.15, 1.52); // windshield
    s.quadraticCurveTo(-0.8, 1.57, -1.42, 1.5); // roof
    s.lineTo(-1.6, 1.38); // opening for the liftgate
    s.lineTo(-1.7, 1.02);
    s.lineTo(-2.2, 1.02);
    s.quadraticCurveTo(-2.29, 0.97, -2.29, 0.8);
    s.lineTo(-2.3, 0.38);
    s.quadraticCurveTo(-2.27, 0.2, -2.18, 0.2);
  },
  glassFrom: 1.03,
  glassTo: -1.75,
  aPillarX: 0.95,
  frontDoor: { x0: 0.2, x1: 1.0 },
  rearDoor: { x0: -0.92, x1: 0.15 },
  doorBottom: 0.42,
  frontWindow: [
    [0.22, 1.03],
    [0.78, 1.03],
    [0.3, 1.29],
    [0.22, 1.29],
  ],
  rearWindow: polygon([
    [-0.88, 1.04],
    [0.13, 1.04],
    [0.13, 1.4],
    [-0.7, 1.4],
  ]),
  quarterWindow: polygon([
    [-1.42, 1.05],
    [-0.98, 1.05],
    [-0.98, 1.36],
    [-1.25, 1.36],
  ]),
  rearClosure: {
    hinge: [-1.42, 1.51],
    curve: { control: [-1.95, 1.38], to: [-2.2, 1.08] },
    outline: [
      [-2.22, 1.025],
      [-1.7, 1.025],
      [-1.6, 1.38],
    ],
    openDeg: 82,
    glassAboveY: 1.12,
    brake: [-1.5, 1.5 + GROWTH],
  },
  headlights: { x: 2.13, y: 0.735, tilt: 0.5, zIn: 0.43, zOut: 0.83, refreshY: 0.7 },
  bumper: { x: 2.3, y: 0.4, zIn: 0.42, zOut: 0.78 },
  frontBar: { x: 2.12, y: 0.745, tilt: 0.88, halfLength: 0.78 },
  rearBar: { y: 0.99, halfLength: 0.4 },
  tail: { x: -2.29, y: 0.97, zIn: 0.42, zOut: 0.78 },
  rearLow: { x: -2.3, plateY: 0.62, fogY: 0.36, fogZ: 0.55 },
  repeater: [1.75, 0.84],
  mirror: [0.88, 1.03],
  chargePort: [-2.0, 0.93],
  cabin: { x0: -1.6, x1: 0.45, y0: 0.45, y1: 1.36, halfWidth: 0.8, display: [0.75, 1.02] },
};

const MODEL_S: FamilySpec = {
  halfWidth: 0.98,
  taper: { from: 0.86, roof: 0.38, endStart: 1.9, endLength: 0.6, endAmount: 0.14 },
  height: 1.46,
  frontX: 2.3,
  rearX: -2.3,
  rockerY: 0.19,
  axles: { front: 1.46, rear: -1.5 },
  wheelRadius: 0.36,
  archRadius: 0.45,
  beltY: 0.9,
  outline: (s) => {
    s.quadraticCurveTo(2.42, 0.22, 2.42, 0.38);
    s.lineTo(2.4, 0.52);
    s.quadraticCurveTo(2.36, 0.6, 2.15, 0.67);
    s.quadraticCurveTo(1.6, 0.79, 1.05, 0.86); // hood
    s.quadraticCurveTo(0.4, 1.2, -0.15, 1.34); // windshield
    s.quadraticCurveTo(-0.7, 1.38, -1.05, 1.32); // roof
    s.lineTo(-1.2, 1.2); // opening for the liftback
    s.lineTo(-1.25, 0.94);
    s.lineTo(-2.3, 0.94);
    s.quadraticCurveTo(-2.4, 0.9, -2.4, 0.7);
    s.lineTo(-2.41, 0.36);
    s.quadraticCurveTo(-2.38, 0.19, -2.3, 0.19);
  },
  glassFrom: 1.08,
  glassTo: -1.1,
  aPillarX: 0.95,
  frontDoor: { x0: 0.18, x1: 1.0 },
  rearDoor: { x0: -0.85, x1: 0.13 },
  doorBottom: 0.4,
  frontWindow: [
    [0.2, 0.95],
    [0.82, 0.95],
    [0.32, 1.17],
    [0.2, 1.17],
  ],
  rearWindow: polygon([
    [-0.8, 0.95],
    [0.1, 0.95],
    [0.1, 1.24],
    [-0.6, 1.24],
  ]),
  quarterWindow: polygon([
    [-1.12, 0.96],
    [-0.88, 0.96],
    [-0.88, 1.16],
    [-1.0, 1.16],
  ]),
  rearClosure: {
    hinge: [-1.05, 1.33],
    curve: { control: [-1.9, 1.1], to: [-2.33, 0.98] },
    outline: [
      [-2.36, 0.945],
      [-1.25, 0.945],
      [-1.2, 1.2],
    ],
    openDeg: 70,
    glassAboveY: 1.0,
    brake: [-1.15, 1.33 + GROWTH * 0.8],
  },
  headlights: { x: 2.2, y: 0.66, tilt: 0.45, zIn: 0.45, zOut: 0.86 },
  bumper: { x: 2.42, y: 0.36, zIn: 0.42, zOut: 0.8 },
  tail: { x: -2.4, y: 0.88, zIn: 0.45, zOut: 0.82 },
  rearLow: { x: -2.4, plateY: 0.55, fogY: 0.32, fogZ: 0.55 },
  repeater: [1.8, 0.75],
  mirror: [0.95, 0.93],
  chargePort: [-2.15, 0.84],
  doorHandles: true,
  cabin: { x0: -1.2, x1: 0.5, y0: 0.42, y1: 1.2, halfWidth: 0.8, display: [0.75, 0.92] },
};

const MODEL_3: FamilySpec = {
  halfWidth: 0.95,
  taper: { from: 0.86, roof: 0.38, endStart: 1.8, endLength: 0.6, endAmount: 0.14 },
  height: 1.45,
  frontX: 2.17,
  rearX: -2.17,
  rockerY: 0.18,
  axles: { front: 1.42, rear: -1.455 },
  wheelRadius: 0.34,
  archRadius: 0.43,
  beltY: 0.9,
  outline: (s) => {
    s.quadraticCurveTo(2.29, 0.21, 2.29, 0.36);
    s.lineTo(2.27, 0.5);
    s.quadraticCurveTo(2.23, 0.58, 2.03, 0.65);
    s.quadraticCurveTo(1.5, 0.78, 0.98, 0.85); // hood
    s.quadraticCurveTo(0.35, 1.2, -0.2, 1.34); // windshield
    s.quadraticCurveTo(-0.8, 1.38, -1.45, 1.12); // roof into the fixed rear glass
    s.lineTo(-1.75, 0.98);
    s.lineTo(-1.8, 0.9); // opening for the trunk lid
    s.lineTo(-2.2, 0.9);
    s.quadraticCurveTo(-2.28, 0.88, -2.28, 0.7);
    s.lineTo(-2.29, 0.34);
    s.quadraticCurveTo(-2.26, 0.18, -2.17, 0.18);
  },
  glassFrom: 1.0,
  glassTo: -1.78,
  aPillarX: 0.92,
  frontDoor: { x0: 0.16, x1: 0.98 },
  rearDoor: { x0: -0.86, x1: 0.12 },
  doorBottom: 0.39,
  frontWindow: [
    [0.18, 0.95],
    [0.8, 0.95],
    [0.3, 1.18],
    [0.18, 1.18],
  ],
  rearWindow: polygon([
    [-0.82, 0.95],
    [0.08, 0.95],
    [0.08, 1.24],
    [-0.6, 1.24],
  ]),
  quarterWindow: polygon([
    [-1.25, 0.96],
    [-0.92, 0.96],
    [-0.92, 1.18],
    [-1.05, 1.18],
  ]),
  rearClosure: {
    hinge: [-1.76, 0.985],
    outline: [
      [-2.2, 0.975],
      [-2.27, 0.92],
      [-2.27, 0.905],
      [-1.8, 0.905],
    ],
    openDeg: 60,
    glassAboveY: 9, // the trunk lid has no glass
    brake: [-2.18, 0.99 + GROWTH * 0.5],
  },
  headlights: { x: 2.08, y: 0.64, tilt: 0.45, zIn: 0.45, zOut: 0.85, refreshY: 0.62 },
  bumper: { x: 2.29, y: 0.34, zIn: 0.42, zOut: 0.78 },
  tail: { x: -2.28, y: 0.86, zIn: 0.4, zOut: 0.8 },
  rearLow: { x: -2.29, plateY: 0.58, fogY: 0.32, fogZ: 0.5 },
  repeater: [1.72, 0.74],
  mirror: [0.9, 0.93],
  chargePort: [-2.05, 0.8],
  cabin: { x0: -1.4, x1: 0.45, y0: 0.4, y1: 1.2, halfWidth: 0.78, display: [0.72, 0.92] },
};

// --- Cybertruck: flat stainless panels, a single roof peak, light bars --------

function buildCybertruck(b: Builder): BuiltBody {
  const halfWidth = 1.0;
  const kit = new BodyKit(halfWidth, { from: 1.2, roof: 0.12, endStart: 9, endLength: 1, endAmount: 0 });
  const peak: Pt = [0.0, 1.79];
  const front: Pt = [2.84, 1.02];
  const tail: Pt = [-2.84, 1.22];
  const roofAt = (x: number) =>
    x >= 0 ? peak[1] - (x / front[0]) * (peak[1] - front[1]) : peak[1] - (x / tail[0]) * (peak[1] - tail[1]);
  const axles = { front: 1.88, rear: -1.93 };
  const wheelRadius = 0.44;

  const s = new THREE.Shape();
  rockerWithArches(s, -2.7, 2.68, 0.42, axles, 0.55, wheelRadius + 0.02);
  s.lineTo(2.84, 0.48);
  s.lineTo(2.86, 0.92);
  s.lineTo(...front);
  s.lineTo(...peak);
  s.lineTo(...tail);
  s.lineTo(-2.86, 0.6);
  s.lineTo(-2.78, 0.45);
  s.closePath();
  const frontWindow: Pt[] = [
    [0.15, 1.12],
    [1.1, 1.12],
    [1.1, roofAt(1.1) - 0.1],
    [0.15, roofAt(0.15) - 0.1],
  ];
  const rearWindow: Pt[] = [
    [-0.95, 1.12],
    [0.05, 1.12],
    [0.05, roofAt(0.05) - 0.1],
    [-0.95, roofAt(-0.95) - 0.1],
  ];
  s.holes.push(polygon(frontWindow), polygon(rearWindow));
  const extruded = kit.extrudeAcross(s, halfWidth * 2, 0.015, 4);
  kit.taper(extruded, false);
  const body = assignMaterials(extruded, (c, n) => {
    if (Math.abs(n.z) > 0.75) return 0;
    // Windshield up to the peak and the rear window behind it.
    return n.y > 0.5 && c.x < 1.25 && c.x > -0.95 ? 1 : 0;
  });
  b.car.add(new THREE.Mesh(body, [b.m.paint, b.m.glass]));
  // Panel seams for the doors.
  for (const side of SIDES) {
    const z = sideSign(side) * (halfWidth + 0.004);
    for (const x of [1.15, 0.1, -0.95]) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.62, 0.004), b.m.trim);
      seam.position.set(x, 0.92, z);
      b.car.add(seam);
    }
    windowPane(b, kit, side, polygon(frontWindow), `${side}FrontWindow`, b.car, new THREE.Vector3(), 0.4);
    windowPane(b, kit, side, polygon(rearWindow), `${side}RearWindow`, b.car, new THREE.Vector3(), 0.4);
  }

  wheels(b, axles, wheelRadius, halfWidth - 0.12, 0.32);
  interior(b, { x0: -1.0, x1: 1.0, y0: 0.7, y1: 1.5, halfWidth: 0.85, displayX: 1.05, displayY: 1.3 });
  mirrors(b, kit, 1.15, 1.2);

  // Powered frunk (driven by the liftgate channel), with its light under the lid.
  const slope = Math.atan2(front[1] - roofAt(1.3), front[0] - 1.3);
  const frunkHinge = new THREE.Group();
  frunkHinge.position.set(1.3, roofAt(1.3) + 0.012, 0);
  b.car.add(frunkHinge);
  const lidLength = Math.hypot(front[0] - 1.3, front[1] - roofAt(1.3));
  const lid = new THREE.Mesh(new THREE.BoxGeometry(lidLength, 0.02, halfWidth * 2 - 0.04), b.m.paint);
  lid.position.set((lidLength / 2) * Math.cos(slope), (lidLength / 2) * Math.sin(slope), 0);
  lid.rotation.z = slope;
  frunkHinge.add(lid);
  b.closure('liftgate', (p) => (frunkHinge.rotation.z = p * deg(48)), frunkHinge);
  const tub = new THREE.Mesh(new THREE.BoxGeometry(lidLength - 0.1, 0.004, halfWidth * 2 - 0.2), b.m.cabin);
  tub.position.set(1.3 + ((lidLength - 0.1) / 2) * Math.cos(slope), roofAt(1.3) + ((lidLength - 0.1) / 2) * Math.sin(slope) + 0.004, 0);
  tub.rotation.z = slope;
  b.car.add(tub);
  b.light(b.car, ['leftAuxPark'], COLORS.white, COLORS.lensFront, [0.04, 0.01, 0.6], [1.5, roofAt(1.5) + 0.01, 0], 3);

  // Front: 60-LED light bar across the nose, main beams and turn signals below it.
  pixelBar(b, 'frontLightBar', 60, front[0] + 0.012, front[1] - 0.015, halfWidth - 0.04, COLORS.white);
  for (const side of SIDES) {
    const s2 = sideSign(side);
    const id = (base: string) => `${side}${base}`;
    b.light(b.car, [id('OuterMainBeam')], COLORS.white, COLORS.lensFront, [0.02, 0.03, 0.12], [2.865, 0.965, s2 * 0.8], 5);
    b.light(b.car, [id('InnerMainBeam')], COLORS.white, COLORS.lensFront, [0.02, 0.03, 0.12], [2.865, 0.965, s2 * 0.64], 5);
    b.light(b.car, [id('FrontTurn')], COLORS.amber, COLORS.lensAmber, [0.02, 0.03, 0.05], [2.865, 0.965, s2 * 0.93], 5);
    b.light(b.car, [id('SideMarker')], COLORS.amber, COLORS.lensAmber, [0.08, 0.025, 0.01], [2.6, 0.95, s2 * (halfWidth + 0.005)], 5);
    // "Side repeater" channels drive the rear side markers on Cybertruck.
    b.light(b.car, [id('SideRepeater')], COLORS.red, COLORS.lensRear, [0.08, 0.025, 0.01], [-2.6, 1.08, s2 * (halfWidth + 0.005)], 4);
    // "Tail" channels drive the reverse lights.
    b.light(b.car, [id('Tail')], COLORS.white, COLORS.lensFront, [0.02, 0.04, 0.14], [-2.866, 1.0, s2 * 0.75], 5);
    b.light(b.car, ['brakeLights'], COLORS.red, COLORS.lensRear, [0.02, 0.06, 0.06], [-2.866, 1.1, s2 * 0.93], 5);
  }
  // Optional offroad light bar above the windshield.
  pixelBar(b, 'offroadLightBar', 6, 0.18, roofAt(0.18) + 0.03, 0.6, COLORS.white, 0.06);
  // Rear: 52-LED light bar across the tailgate.
  pixelBar(b, 'rearLightBar', 52, tail[0] - 0.012, tail[1] - 0.02, halfWidth - 0.04, COLORS.red);
  b.light(b.car, ['licensePlate'], COLORS.white, new THREE.Color('#9a9a9a'), [0.01, 0.15, 0.31], [-2.87, 0.72, 0], 0.6);
  headBeams(b, { x: 2.9, y: 0.97, z: 0.72 });
  const glow = new THREE.PointLight('#ff2020', 0, 6, 1.6);
  glow.position.set(-3.2, 0.9, 0);
  b.car.add(glow);
  b.beam(['brakeLights', 'rearLightBar26', 'rearLightBar27'], glow, 5);
  chargePort(b, kit, -2.3, 1.0);

  return { halfLength: 2.95, height: 1.85, halfWidth: halfWidth + 0.15, paint: '#a5a9ae' };
}

/** A row of individually driven LEDs (Cybertruck light bars), numbered left to right. */
function pixelBar(
  b: Builder,
  base: string,
  count: number,
  x: number,
  y: number,
  halfLength: number,
  color: THREE.Color,
  height = 0.02,
): void {
  const pitch = (halfLength * 2) / count;
  for (let i = 0; i < count; i++) {
    const z = -halfLength + pitch * (i + 0.5);
    b.light(b.car, [`${base}${i + 1}`], color, COLORS.lensFront, [0.015, height, pitch * 0.85], [x, y, z], 4);
  }
}
