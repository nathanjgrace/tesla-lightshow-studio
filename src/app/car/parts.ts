// Parts shared by the Model S, 3, X and Y bodies, positioned per model.
// Light layouts follow Tesla's channel diagrams (images/*_headlights.png).

import * as THREE from 'three';
import type { Builder } from './CarScene';
import { COLORS as L, SIDES, sideSign, type BodyKit, type Side } from './kit';

const deg = THREE.MathUtils.degToRad;

export function wheels(b: Builder, axles: { front: number; rear: number }, radius: number, track: number, width = 0.27): void {
  const tire = new THREE.MeshStandardMaterial({ color: '#0b0b0c', roughness: 0.85 });
  const rim = new THREE.MeshStandardMaterial({ color: '#50545a', roughness: 0.3, metalness: 0.8 });
  for (const x of [axles.front, axles.rear]) {
    for (const side of SIDES) {
      const wheel = new THREE.Group();
      wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 40), tire));
      wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.7, radius * 0.7, width + 0.01, 10), rim));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, radius, sideSign(side) * track);
      b.car.add(wheel);
    }
  }
}

export interface ClusterSpec {
  /** Center of the cluster on the body surface. */
  x: number;
  y: number;
  /** Tilt of the surface (radians, positive = facing up). */
  tilt: number;
  /** Inner and outer edge, as distance from the center line. */
  zIn: number;
  zOut: number;
  /** Height multiplier; refreshed designs use slim lamps. */
  slim?: boolean;
}

/**
 * Headlight cluster per Tesla's diagram: outer/inner main beams, the
 * signature strip, and channels 4-6 along the top.
 */
export function headlights(b: Builder, spec: ClusterSpec): void {
  const w = spec.zOut - spec.zIn;
  const hs = spec.slim ? 0.55 : 1;
  for (const side of SIDES) {
    const id = (base: string) => `${side}${base}`;
    const g = new THREE.Group();
    g.position.set(spec.x, spec.y, 0);
    g.rotation.z = spec.tilt;
    if (side === 'left') g.scale.z = -1;
    b.car.add(g);
    // u: 0 = inner edge, 1 = outer edge. [ids, u center, u width, y, height]
    const parts: [string, number, number, number, number][] = [
      ['Signature', 0.5, 1, -0.035 * hs, 0.012],
      ['OuterMainBeam', 0.7, 0.4, 0, 0.04 * hs],
      ['InnerMainBeam', 0.24, 0.4, -0.005 * hs, 0.035 * hs],
      ['Channel4', 0.79, 0.24, 0.035 * hs, 0.016 * hs],
      ['Channel5', 0.5, 0.26, 0.037 * hs, 0.016 * hs],
      ['Channel6', 0.21, 0.24, 0.033 * hs, 0.016 * hs],
    ];
    for (const [base, u, uw, y, h] of parts) {
      b.light(g, [id(base)], L.white, L.lensFront, [0.012, h, uw * w], [0.018, y, spec.zIn + u * w]);
    }
    if (!spec.slim) b.light(g, [id('Signature')], L.white, L.lensFront, [0.012, 0.07, 0.012], [0.02, 0, spec.zOut - 0.01]);
  }
}

/** Main beam and fog light spotlights that light the ground. */
export function headBeams(b: Builder, at: { x: number; y: number; z: number }, fog?: { x: number; y: number; z: number }): void {
  for (const side of SIDES) {
    const s = sideSign(side);
    const beam = new THREE.SpotLight('#fff3dc', 0, 28, 0.42, 0.65, 1.3);
    beam.position.set(at.x, at.y, s * at.z);
    beam.target.position.set(at.x + 12, 0, s * (at.z + 0.9));
    b.car.add(beam, beam.target);
    b.beam([`${side}OuterMainBeam`, `${side}InnerMainBeam`], beam, 160);
    if (fog) {
      const f = new THREE.SpotLight('#fff3dc', 0, 12, 0.85, 0.8, 1.6);
      f.position.set(fog.x, fog.y, s * fog.z);
      f.target.position.set(fog.x + 5, 0, s * (fog.z + 1.6));
      b.car.add(f, f.target);
      b.beam([`${side}FrontFog`], f, 40);
    }
  }
}

/** Bumper lamp: turn signal, aux park, side marker, and optional fog light. */
export function bumperLamps(b: Builder, spec: { x: number; y: number; zIn: number; zOut: number; fog: boolean }): void {
  const w = spec.zOut - spec.zIn;
  for (const side of SIDES) {
    const s = sideSign(side);
    const id = (base: string) => `${side}${base}`;
    const z = (u: number) => s * (spec.zIn + u * w);
    b.light(b.car, [id('FrontTurn')], L.amber, L.lensAmber, [0.02, 0.014, 0.68 * w], [spec.x, spec.y + 0.025, z(0.45)]);
    b.light(b.car, [id('AuxPark')], L.white, L.lensFront, [0.02, 0.012, 0.72 * w], [spec.x, spec.y, z(0.45)]);
    b.light(b.car, [id('SideMarker')], L.amber, L.lensAmber, [0.02, 0.02, 0.04], [spec.x, spec.y, z(0.02)]);
    if (spec.fog) b.light(b.car, [id('FrontFog')], L.white, L.lensFront, [0.02, 0.045, 0.06], [spec.x - 0.01, spec.y + 0.02, z(0.95)]);
  }
}

export function sideRepeaters(b: Builder, kit: BodyKit, x: number, y: number): void {
  for (const side of SIDES) {
    b.light(b.car, [`${side}SideRepeater`], L.amber, L.lensAmber, [0.07, 0.02, 0.02], [x, y, sideSign(side) * (kit.surfaceZ(x, y) + 0.005)]);
  }
}

/**
 * Tail light clusters across the rear corners: tail, brake, turn and reverse.
 * `origin` is subtracted when mounting on a moving part (a liftgate).
 */
export function tailLights(
  b: Builder,
  parent: THREE.Object3D,
  spec: { x: number; y: number; zIn: number; zOut: number },
  origin = new THREE.Vector3(),
): void {
  const w = spec.zOut - spec.zIn;
  for (const side of SIDES) {
    const s = sideSign(side);
    const id = (base: string) => `${side}${base}`;
    const z = (u: number) => s * (spec.zIn + u * w);
    const at = (u: number, dy: number): [number, number, number] => [spec.x - origin.x, spec.y + dy - origin.y, z(u)];
    b.light(parent, [id('Tail')], L.red, L.lensRear, [0.02, 0.026, w], at(0.5, 0), 2.2);
    b.light(parent, ['brakeLights'], L.red, L.lensRear, [0.02, 0.026, 0.45 * w], at(0.72, -0.03), 5);
    b.light(parent, [id('RearTurn')], L.amber, L.lensAmber, [0.02, 0.022, 0.35 * w], at(0.78, -0.06));
    b.light(parent, ['reverseLights'], L.white, L.lensFront, [0.02, 0.022, 0.35 * w], at(0.25, -0.06));
  }
}

/** Rear fog lamps, license plate, and the glow the rear lights cast on the ground. */
export function rearLowLights(b: Builder, spec: { x: number; plateY: number; fogY: number; fogZ: number }): void {
  for (const side of SIDES) {
    b.light(b.car, ['rearFog'], L.red, L.lensRear, [0.02, 0.03, 0.1], [spec.x, spec.fogY, sideSign(side) * spec.fogZ], 4);
  }
  b.light(b.car, ['licensePlate'], L.white, new THREE.Color('#9a9a9a'), [0.01, 0.15, 0.31], [spec.x - 0.012, spec.plateY, 0], 0.6);
  const glow = new THREE.PointLight('#ff2020', 0, 6, 1.6);
  glow.position.set(spec.x - 0.35, 0.7, 0);
  b.car.add(glow);
  b.beam(['brakeLights', 'leftTail', 'rightTail'], glow, 5);
  const reverse = new THREE.SpotLight('#ffffff', 0, 10, 0.9, 0.8, 1.5);
  reverse.position.set(spec.x - 0.1, 0.9, 0);
  reverse.target.position.set(spec.x - 4.5, 0, 0);
  b.car.add(reverse, reverse.target);
  b.beam(['reverseLights'], reverse, 30);
}

/**
 * A full-width light bar split into a left and right half, each driven by its
 * own channel. `tilt` is the surface normal's angle above horizontal.
 */
export function lightBar(
  b: Builder,
  spec: { x: number; y: number; tilt?: number; halfLength: number; leftIds: string[]; rightIds: string[]; color: THREE.Color; lens: THREE.Color },
): void {
  for (const [ids, z] of [[spec.leftIds, -spec.halfLength / 2], [spec.rightIds, spec.halfLength / 2]] as const) {
    const mesh = b.light(b.car, [...ids], spec.color, spec.lens, [0.02, 0.016, spec.halfLength], [spec.x, spec.y, z], 4);
    mesh.rotation.z = spec.tilt ?? 0;
  }
}

/**
 * A door panel covering an opening in the body side, hinged at its front
 * edge. Pass a closure id when the show can open it (Model X front doors).
 */
export function hingedDoor(
  b: Builder,
  kit: BodyKit,
  side: Side,
  outline: THREE.Shape,
  hingeX: number,
  closureId?: string,
): THREE.Group {
  const s = sideSign(side);
  const hinge = new THREE.Group();
  hinge.position.set(hingeX, 0, s * kit.halfWidth);
  b.car.add(hinge);
  const door = new THREE.Mesh(kit.sidePanel(outline, side, 0.03, 0.004), b.m.paint);
  door.position.set(-hingeX, 0, -s * kit.halfWidth);
  hinge.add(door);
  if (closureId) b.closure(closureId, (p) => (hinge.rotation.y = s * p * deg(62)));
  return hinge;
}

/** A side window pane that drops into the door as its window channel opens. */
export function windowPane(
  b: Builder,
  kit: BodyKit,
  side: Side,
  outline: THREE.Shape,
  closureId: string,
  parent: THREE.Object3D = b.car,
  offset = new THREE.Vector3(),
  drop = 0.3,
): void {
  const pane = new THREE.Mesh(kit.sidePanel(outline, side, 0.01, -0.03), b.m.sideGlass);
  pane.position.copy(offset);
  parent.add(pane);
  b.closure(closureId, (p) => (pane.position.y = offset.y - p * drop));
}

export function mirrors(b: Builder, kit: BodyKit, x: number, y: number): void {
  for (const side of SIDES) {
    const s = sideSign(side);
    const pivot = new THREE.Group();
    pivot.position.set(x, y, s * (kit.surfaceZ(x, y) - 0.01));
    b.car.add(pivot);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.1), b.m.trim);
    arm.position.set(0, 0, s * 0.05);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.22), b.m.smallPaint);
    housing.position.set(-0.02, 0.02, s * 0.19);
    pivot.add(arm, housing);
    // Open = unfolded (sticking out), closed = folded back along the body.
    b.closure(`${side}Mirror`, (p) => (pivot.rotation.y = s * (1 - p) * deg(-70)));
  }
}

/** Model S door handles: flush with the door, presenting outward when opened. */
export function doorHandles(b: Builder, kit: BodyKit, spots: { id: string; side: Side; x: number; y: number }[]): void {
  for (const h of spots) {
    const s = sideSign(h.side);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.02), b.m.smallPaint);
    const base = s * (kit.surfaceZ(h.x, h.y) + 0.006);
    handle.position.set(h.x, h.y, base);
    b.car.add(handle);
    b.closure(h.id, (p) => (handle.position.z = base + s * p * 0.04));
  }
}

/** Charge port door with its LED (rainbow when dancing), in the left tail light area. */
export function chargePort(b: Builder, kit: BodyKit, x: number, y: number): void {
  const led = new THREE.MeshStandardMaterial({ color: '#111', emissive: '#000' });
  const zSurface = kit.surfaceZ(x, y);
  const socket = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.01), led);
  socket.position.set(x, y, -(zSurface + 0.004));
  b.car.add(socket);
  const hinge = new THREE.Group();
  hinge.position.set(x + 0.07, y, -(zSurface + 0.012));
  b.car.add(hinge);
  const flap = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.012), b.m.paint);
  flap.position.set(-0.07, 0, 0);
  hinge.add(flap);
  b.closure('chargePort', (p, dancing, t) => {
    hinge.rotation.y = p * deg(100);
    if (dancing) led.emissive.setHSL((t * 0.6) % 1, 1, 0.5);
    else led.emissive.set(p > 0.05 ? '#4a7dff' : '#000');
    led.emissiveIntensity = p > 0.05 ? 3 : 0;
  });
}

/** Dark cabin (so open doors show an interior) and the center display that lights it. */
export function interior(
  b: Builder,
  spec: { x0: number; x1: number; y0: number; y1: number; halfWidth: number; displayX: number; displayY: number },
): void {
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(spec.x1 - spec.x0, spec.y1 - spec.y0, spec.halfWidth * 2), b.m.cabin);
  cabin.position.set((spec.x0 + spec.x1) / 2, (spec.y0 + spec.y1) / 2, 0);
  b.car.add(cabin);
  const display = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.26), b.m.display);
  display.position.set(spec.displayX, spec.displayY, 0);
  display.rotation.set(0, -Math.PI / 2, 0);
  b.car.add(display);
  b.cabinLight.position.set((spec.x0 + spec.x1) / 2, spec.y1 - 0.2, 0);
  b.car.add(b.cabinLight);
}

/** Center high-mounted brake light. */
export function highBrake(b: Builder, parent: THREE.Object3D, at: [number, number, number], width = 0.5): void {
  b.light(parent, ['brakeLights'], L.red, L.lensRear, [0.03, 0.02, width], at, 5);
}

