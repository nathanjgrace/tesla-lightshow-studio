// A stylized Model X built from code, with every light channel and closure
// wired to the simulation. Tesla only publishes 3D models of the Model S and
// Cybertruck, so this stands in until we license a detailed Model X model.
//
// Coordinates: meters, x = forward, y = up, z = right (so left is -z).
// Light positions follow Tesla's channel diagram (images/x_headlights.png).

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Simulation } from '../../core/simulate';

type Side = 'left' | 'right';
const SIDES: readonly Side[] = ['left', 'right'];
const sideSign = (s: Side) => (s === 'right' ? 1 : -1);

const HALF_WIDTH = 1.0;
const FRONT_AXLE = 1.48;
const REAR_AXLE = -1.49;
const WHEEL_RADIUS = 0.37;
const ARCH_RADIUS = 0.47;
const ROCKER_Y = 0.22;
const BELT_Y = 1.0;
/** Body edges are rounded by extruding with a bevel, which grows the outline. */
const BODY_BEVEL = 0.11;
const BODY_GROWTH = BODY_BEVEL * 0.8;
/** Door openings in the body side. */
const FRONT_DOOR = { x0: 0.24, x1: 1.1 };
const FALCON_DOOR = { x0: -1.05, x1: 0.13 };
const DOOR_BOTTOM = 0.44;
const LIFTGATE_HINGE = new THREE.Vector3(-1.62, 1.66, 0);
/** Top of the rear body (tail lights); the liftgate covers everything above. */
const TAIL_TOP = 1.06;

const COLORS = {
  white: new THREE.Color('#fff4e0'),
  amber: new THREE.Color('#ffa21a'),
  red: new THREE.Color('#ff1a1a'),
  lensFront: new THREE.Color('#25282d'),
  lensRear: new THREE.Color('#3a0a0a'),
  lensAmber: new THREE.Color('#3a2408'),
};

/**
 * How much narrower the car is at a point than at its widest: it narrows
 * toward the roof (tumblehome) and, in plan view, at the nose and tail.
 */
function widthFactor(x: number, y: number, ends = true): number {
  let f = y > 0.95 ? 1 - (y - 0.95) * 0.3 : 1;
  const ax = Math.abs(x);
  if (ends && ax > 2.0) f *= 1 - ((ax - 2.0) / 0.6) ** 2 * 0.14;
  return f;
}

function taper(geometry: THREE.BufferGeometry, ends = true): void {
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setZ(i, pos.getZ(i) * widthFactor(pos.getX(i), pos.getY(i), ends));
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

/** Half-width of the car's side surface at a given length and height. */
function surfaceZ(x: number, y: number): number {
  return HALF_WIDTH * widthFactor(x, y);
}

/**
 * Splits a geometry's triangles into material groups chosen per triangle
 * from its center and face normal (e.g. glass on the roof, paint elsewhere).
 */
function assignMaterials(
  source: THREE.BufferGeometry,
  pick: (center: THREE.Vector3, normal: THREE.Vector3) => number,
): THREE.BufferGeometry {
  const g = source.index ? source.toNonIndexed() : source;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const triCount = pos.count / 3;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const center = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const byMaterial: number[][] = [];
  for (let t = 0; t < triCount; t++) {
    a.fromBufferAttribute(pos, t * 3);
    b.fromBufferAttribute(pos, t * 3 + 1);
    c.fromBufferAttribute(pos, t * 3 + 2);
    center.copy(a).add(b).add(c).divideScalar(3);
    normal.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
    (byMaterial[pick(center, normal)] ??= []).push(t);
  }
  const out = new THREE.BufferGeometry();
  const attrs = Object.entries(g.attributes) as [string, THREE.BufferAttribute][];
  const arrays = attrs.map(([, attr]) => new Float32Array(attr.count * attr.itemSize));
  let written = 0;
  byMaterial.forEach((tris, materialIndex) => {
    if (!tris) return;
    out.addGroup(written * 3, tris.length * 3, materialIndex);
    for (const t of tris) {
      attrs.forEach(([, attr], i) => {
        const size = attr.itemSize;
        arrays[i]!.set((attr.array as Float32Array).subarray(t * 3 * size, (t + 1) * 3 * size), written * 3 * size);
      });
      written++;
    }
  });
  attrs.forEach(([name, attr], i) => out.setAttribute(name, new THREE.BufferAttribute(arrays[i]!, attr.itemSize)));
  out.computeVertexNormals();
  return out;
}

function roundedRect(x0: number, y0: number, x1: number, y1: number, r: number): THREE.Shape {
  const p = new THREE.Shape();
  p.moveTo(x0 + r, y0);
  p.lineTo(x1 - r, y0);
  p.quadraticCurveTo(x1, y0, x1, y0 + r);
  p.lineTo(x1, y1 - r);
  p.quadraticCurveTo(x1, y1, x1 - r, y1);
  p.lineTo(x0 + r, y1);
  p.quadraticCurveTo(x0, y1, x0, y1 - r);
  p.lineTo(x0, y0 + r);
  p.quadraticCurveTo(x0, y0, x0 + r, y0);
  return p;
}

function polygon(points: [number, number][]): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(...points[0]!);
  for (const p of points.slice(1)) shape.lineTo(...p);
  shape.closePath();
  return shape;
}

/** Extrudes a side-profile shape across the car's width, centered on z = 0. */
function extrudeAcross(shape: THREE.Shape, width: number, bevel: number): THREE.BufferGeometry {
  const depth = width - 2 * bevel;
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 6,
    curveSegments: 28,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** A thin panel on one side of the car, its outer face just outside the side surface. */
function sidePanel(shape: THREE.Shape, side: Side, thickness: number, outset: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.006,
    bevelSize: 0.006,
    bevelSegments: 2,
    curveSegments: 12,
  });
  g.translate(0, 0, HALF_WIDTH + outset - thickness);
  if (side === 'left') g.scale(1, 1, -1);
  taper(g, false);
  return g;
}

/** Height of the roof line in the side profile (before bevel growth). */
const ROOF_Y = 1.66;

interface LightPart {
  ids: string[];
  material: THREE.MeshStandardMaterial;
  color: THREE.Color;
  gain: number;
}

interface Closure {
  id: string;
  apply: (position: number, dancing: boolean, timeS: number) => void;
}

export interface CameraPreset {
  name: string;
  /** Direction from the car's center toward the camera. */
  direction: [number, number, number];
}

export const CAMERA_PRESETS: CameraPreset[] = [
  { name: '3/4', direction: [0.75, 0.3, 0.6] },
  { name: 'Front', direction: [1, 0.22, 0.12] },
  { name: 'Side', direction: [0.02, 0.18, 1] },
  { name: 'Rear', direction: [-0.8, 0.3, -0.55] },
  { name: 'Top', direction: [0.001, 1, 0.001] },
];

const TARGET = new THREE.Vector3(0, 0.8, 0);

export class ModelXScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  private readonly controls: OrbitControls;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly lights: LightPart[] = [];
  private readonly closures: Closure[] = [];
  private readonly beams: { ids: string[]; light: THREE.Light; max: number }[] = [];
  private readonly displayMaterial = new THREE.MeshStandardMaterial({ color: '#000', emissive: '#000' });
  private readonly cabinLight = new THREE.PointLight('#fff', 0, 4, 1.5);
  private sim: Simulation | undefined;
  private frame = 0;
  private raf = 0;
  private userMovedCamera = false;
  private size = { w: 0, h: 0 };
  private cameraTween: { from: THREE.Vector3; to: THREE.Vector3; start: number } | undefined;

  private readonly paint = new THREE.MeshPhysicalMaterial({
    color: '#e9eaec',
    metalness: 0.15,
    roughness: 0.32,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  });
  private readonly glass = new THREE.MeshPhysicalMaterial({
    color: '#06080b',
    metalness: 0.4,
    roughness: 0.04,
    clearcoat: 1,
  });
  private readonly sideGlass = new THREE.MeshPhysicalMaterial({
    color: '#06080b',
    metalness: 0.4,
    roughness: 0.04,
    transparent: true,
    opacity: 0.9,
  });
  /** Matte version of the paint: small shiny boxes flare under bloom. */
  private readonly mirrorPaint = new THREE.MeshStandardMaterial({ color: '#d9dadc', roughness: 0.55 });
  private readonly trim = new THREE.MeshStandardMaterial({ color: '#0a0b0d', roughness: 0.25, metalness: 0.5 });
  private readonly cabin = new THREE.MeshStandardMaterial({ color: '#1b1c20', roughness: 0.9 });

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color('#07090c');
    this.scene.fog = new THREE.Fog('#07090c', 20, 50);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.3;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(TARGET);
    this.controls.enableDamping = true;
    this.controls.minDistance = 3.5;
    this.controls.maxDistance = 30;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.addEventListener('start', () => {
      this.cameraTween = undefined;
      this.userMovedCamera = true;
    });

    this.scene.add(new THREE.HemisphereLight('#8a9ab8', '#121212', 0.55));
    const moon = new THREE.DirectionalLight('#b8c8ff', 0.7);
    moon.position.set(-4, 8, 5);
    this.scene.add(moon);
    const rim = new THREE.DirectionalLight('#9fb4ff', 0.45);
    rim.position.set(-6, 3, -6);
    this.scene.add(rim);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(60, 64),
      new THREE.MeshStandardMaterial({ color: '#1a1d22', roughness: 0.9 }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    // Soft contact shadow under the car.
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(5.6, 2.4),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.005;
    this.scene.add(shadow);

    const car = new THREE.Group();
    this.scene.add(car);
    this.buildBody(car);
    this.buildWheels(car);
    this.buildFrontLights(car);
    this.buildRearLights(car);
    this.buildFrontDoors(car);
    this.buildFalconDoors(car);
    this.buildMirrors(car);
    this.buildLiftgate(car);
    this.buildChargePort(car);
    this.buildInterior(car);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.8, 0.45, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.camera.position.copy(this.presetPosition(CAMERA_PRESETS[0]!));
    this.resize();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      // Cheap per-frame size check; resize observers can miss layout changes.
      if (this.container.clientWidth !== this.size.w || this.container.clientHeight !== this.size.h) this.resize();
      this.tickCamera();
      this.controls.update();
      this.composer.render();
    };
    loop();
  }

  resize(): void {
    this.size = { w: this.container.clientWidth, h: this.container.clientHeight };
    const w = Math.max(1, this.size.w);
    const h = Math.max(1, this.size.h);
    // CSS sizes the canvas; we only set its resolution, so the canvas can
    // never push its container's layout around.
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Until the user takes over, keep the whole car framed.
    if (!this.userMovedCamera && !this.cameraTween) this.camera.position.copy(this.presetPosition(CAMERA_PRESETS[0]!));
  }

  setSimulation(sim: Simulation | undefined): void {
    this.sim = sim;
    this.applyFrame();
  }

  setTime(timeMs: number): void {
    if (!this.sim) return;
    this.frame = Math.min(this.sim.frameCount - 1, Math.max(0, Math.floor(timeMs / this.sim.stepTimeMs)));
    this.applyFrame(timeMs / 1000);
  }

  flyTo(preset: CameraPreset): void {
    this.userMovedCamera = true;
    this.cameraTween = { from: this.camera.position.clone(), to: this.presetPosition(preset), start: performance.now() };
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  /** Camera position looking at the car from a direction, just far enough to fit it. */
  private presetPosition(preset: CameraPreset): THREE.Vector3 {
    const dir = new THREE.Vector3(...preset.direction).normalize();
    const probe = this.camera.clone();
    const corner = new THREE.Vector3();
    let distance = 10;
    // Measure how much of the screen the car's box fills, then scale the distance.
    for (let i = 0; i < 3; i++) {
      probe.position.copy(dir).multiplyScalar(distance).add(TARGET);
      probe.lookAt(TARGET);
      probe.updateMatrixWorld();
      let extent = 0;
      for (const x of [-2.65, 2.65]) {
        for (const y of [0, 1.8]) {
          for (const z of [-1.1, 1.1]) {
            corner.set(x, y, z).project(probe);
            extent = Math.max(extent, Math.abs(corner.x), Math.abs(corner.y));
          }
        }
      }
      distance *= extent / 0.82;
    }
    return dir.multiplyScalar(Math.min(distance, this.controls.maxDistance)).add(TARGET);
  }

  private tickCamera(): void {
    if (!this.cameraTween) return;
    const t = Math.min(1, (performance.now() - this.cameraTween.start) / 700);
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    this.camera.position.lerpVectors(this.cameraTween.from, this.cameraTween.to, e);
    this.controls.target.lerp(TARGET, e);
    if (t === 1) this.cameraTween = undefined;
  }

  private level(id: string): number {
    return this.sim?.levels.get(id)?.[this.frame] ?? 0;
  }

  private applyFrame(timeS = 0): void {
    for (const part of this.lights) {
      let level = 0;
      for (const id of part.ids) level = Math.max(level, this.level(id));
      part.material.emissive.copy(part.color);
      part.material.emissiveIntensity = level * part.gain;
    }
    for (const beam of this.beams) {
      let level = 0;
      for (const id of beam.ids) level = Math.max(level, this.level(id));
      beam.light.intensity = level * beam.max;
    }
    for (const c of this.closures) {
      const track = this.sim?.closures.get(c.id);
      c.apply(track?.position[this.frame] ?? (c.id.endsWith('Mirror') ? 1 : 0), !!track?.dancing[this.frame], timeS);
    }
    const r = this.level('centerFrontDisplayRed');
    const g = this.level('centerFrontDisplayGreen');
    const b = this.level('centerFrontDisplayBlue');
    this.displayMaterial.emissive.setRGB(r, g, b);
    this.displayMaterial.emissiveIntensity = 2.5;
    this.cabinLight.color.setRGB(r, g, b);
    this.cabinLight.intensity = Math.max(r, g, b) * 6;
  }

  private addLight(
    parent: THREE.Object3D,
    ids: string[],
    color: THREE.Color,
    lens: THREE.Color,
    size: [number, number, number],
    position: [number, number, number],
    gain = 5,
  ): THREE.Mesh {
    const material = new THREE.MeshStandardMaterial({ color: lens, roughness: 0.2, metalness: 0.1 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position);
    parent.add(mesh);
    this.lights.push({ ids, material, color, gain });
    return mesh;
  }

  private buildBody(car: THREE.Group): void {
    const archDx = Math.sqrt(ARCH_RADIUS ** 2 - (ROCKER_Y - 0.38) ** 2);
    const archStart = Math.atan2(ROCKER_Y - 0.38, archDx);
    const s = new THREE.Shape();
    s.moveTo(-2.4, ROCKER_Y);
    s.lineTo(REAR_AXLE - archDx, ROCKER_Y);
    s.absarc(REAR_AXLE, 0.38, ARCH_RADIUS, Math.PI - archStart, archStart, true);
    s.lineTo(FRONT_AXLE - archDx, ROCKER_Y);
    s.absarc(FRONT_AXLE, 0.38, ARCH_RADIUS, Math.PI - archStart, archStart, true);
    s.lineTo(2.42, ROCKER_Y);
    s.quadraticCurveTo(2.56, 0.26, 2.56, 0.44);
    s.lineTo(2.54, 0.6);
    s.quadraticCurveTo(2.5, 0.71, 2.3, 0.8);
    s.quadraticCurveTo(1.8, 0.94, 1.22, 0.99); // hood
    s.quadraticCurveTo(0.45, 1.44, -0.1, ROOF_Y - 0.02); // long windshield
    s.quadraticCurveTo(-0.85, ROOF_Y + 0.05, LIFTGATE_HINGE.x, LIFTGATE_HINGE.y - 0.01); // roof
    // Opening for the liftgate (a separate part).
    s.lineTo(-1.8, 1.5);
    s.lineTo(-1.84, TAIL_TOP);
    s.lineTo(-2.44, TAIL_TOP);
    s.quadraticCurveTo(-2.53, 1.0, -2.53, 0.8);
    s.quadraticCurveTo(-2.54, 0.52, -2.52, 0.38);
    s.quadraticCurveTo(-2.5, ROCKER_Y, -2.4, ROCKER_Y);

    // Openings through the side for doors and windows; panels cover them.
    s.holes.push(
      roundedRect(FRONT_DOOR.x0, DOOR_BOTTOM, FRONT_DOOR.x1, 0.96, 0.06),
      roundedRect(FALCON_DOOR.x0, DOOR_BOTTOM, FALCON_DOOR.x1, 0.96, 0.06),
      polygon([
        [0.26, 1.06],
        [0.86, 1.06],
        [0.36, 1.36],
        [0.26, 1.36],
      ]),
      roundedRect(-1.0, 1.07, 0.1, 1.5, 0.05),
      roundedRect(-1.58, 1.08, -1.14, 1.46, 0.05),
    );
    const extruded = extrudeAcross(s, HALF_WIDTH * 2, BODY_BEVEL);
    taper(extruded);
    // Material 0 = paint, 1 = glass (windshield, roof), 2 = black pillars.
    const body = assignMaterials(extruded, (c, n) => {
      const isSide = Math.abs(n.z) > 0.75;
      if (c.y < BELT_Y + 0.03) return 0;
      if (isSide) return c.x > 1.0 ? 0 : 2; // A-pillar base in paint, rest black
      return 1;
    });
    car.add(new THREE.Mesh(body, [this.paint, this.glass, this.trim]));

    // Fixed rear quarter windows.
    for (const side of SIDES) {
      car.add(new THREE.Mesh(sidePanel(roundedRect(-1.58, 1.08, -1.14, 1.46, 0.05), side, 0.01, -0.03), this.sideGlass));
    }
  }

  private buildInterior(car: THREE.Group): void {
    // Dark cabin so open doors and lowered windows show an interior.
    // Kept inside the glass: the cabin stops short of the raked windshield.
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.92, 1.7), this.cabin);
    cabin.position.set(-0.62, 0.91, 0);
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 1.7), this.cabin);
    dash.position.set(0.8, 0.72, 0);
    car.add(cabin, dash);
    // Center display: lights the whole cabin in RGB shows.
    const display = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.26), this.displayMaterial);
    display.position.set(1.0, 1.08, 0);
    display.rotation.set(0, -Math.PI / 2, 0);
    car.add(display);
    this.cabinLight.position.set(0.2, 1.3, 0);
    car.add(this.cabinLight);
  }

  private buildWheels(car: THREE.Group): void {
    const tire = new THREE.MeshStandardMaterial({ color: '#0b0b0c', roughness: 0.85 });
    const rim = new THREE.MeshStandardMaterial({ color: '#50545a', roughness: 0.3, metalness: 0.8 });
    for (const x of [FRONT_AXLE, REAR_AXLE]) {
      for (const side of SIDES) {
        const wheel = new THREE.Group();
        wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.27, 40), tire));
        wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.28, 10), rim));
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(x, WHEEL_RADIUS, sideSign(side) * 0.84);
        car.add(wheel);
      }
    }
  }

  private buildFrontLights(car: THREE.Group): void {
    const L = COLORS;
    for (const side of SIDES) {
      const s = sideSign(side);
      const id = (base: string) => `${side}${base}`;
      // The headlight cluster sits on the sloped nose; tilt elements to match.
      // Outline point (2.39, 0.755), pushed out along the nose's normal.
      const g = new THREE.Group();
      g.position.set(2.39 + BODY_GROWTH * 0.85, 0.755 + BODY_GROWTH * 0.52, 0);
      g.rotation.z = 0.55;
      if (side === 'left') g.scale.z = -1;
      car.add(g);
      // [size (x thickness, y height, z width)], [center (local)]
      this.addLight(g, [id('Signature')], L.white, L.lensFront, [0.012, 0.012, 0.42], [0.02, -0.035, 0.66]);
      this.addLight(g, [id('Signature')], L.white, L.lensFront, [0.012, 0.07, 0.012], [0.02, 0.0, 0.875]);
      this.addLight(g, [id('OuterMainBeam')], L.white, L.lensFront, [0.01, 0.04, 0.17], [0.015, 0.0, 0.77]);
      this.addLight(g, [id('InnerMainBeam')], L.white, L.lensFront, [0.01, 0.035, 0.17], [0.015, -0.005, 0.57]);
      this.addLight(g, [id('Channel4')], L.white, L.lensFront, [0.01, 0.016, 0.1], [0.015, 0.035, 0.8]);
      this.addLight(g, [id('Channel5')], L.white, L.lensFront, [0.01, 0.016, 0.11], [0.015, 0.037, 0.68]);
      this.addLight(g, [id('Channel6')], L.white, L.lensFront, [0.01, 0.016, 0.1], [0.015, 0.033, 0.56]);

      // Lower bumper lamp.
      const z = (v: number) => s * v;
      const fx = 2.56 + BODY_GROWTH;
      this.addLight(car, [id('FrontTurn')], L.amber, L.lensAmber, [0.02, 0.014, 0.28], [fx, 0.455, z(0.6)]);
      this.addLight(car, [id('AuxPark')], L.white, L.lensFront, [0.02, 0.012, 0.3], [fx, 0.43, z(0.6)]);
      this.addLight(car, [id('FrontFog')], L.white, L.lensFront, [0.02, 0.045, 0.06], [fx - 0.01, 0.45, z(0.79)]);
      this.addLight(car, [id('SideMarker')], L.amber, L.lensAmber, [0.02, 0.02, 0.04], [fx, 0.43, z(0.42)]);
      // Side repeater on the front fender.
      this.addLight(car, [id('SideRepeater')], L.amber, L.lensAmber, [0.07, 0.02, 0.02], [1.98, 0.86, z(surfaceZ(1.98, 0.86) + 0.005)]);

      // Headlight beams on the ground, and fog spread.
      const beam = new THREE.SpotLight('#fff3dc', 0, 28, 0.42, 0.65, 1.3);
      beam.position.set(2.6, 0.8, z(0.68));
      beam.target.position.set(14, 0, z(1.6));
      car.add(beam, beam.target);
      this.beams.push({ ids: [id('OuterMainBeam'), id('InnerMainBeam')], light: beam, max: 160 });
      const fog = new THREE.SpotLight('#fff3dc', 0, 12, 0.85, 0.8, 1.6);
      fog.position.set(2.66, 0.45, z(0.79));
      fog.target.position.set(7, 0, z(2.4));
      car.add(fog, fog.target);
      this.beams.push({ ids: [id('FrontFog')], light: fog, max: 40 });
    }
  }

  private buildRearLights(car: THREE.Group): void {
    const L = COLORS;
    const rx = -2.52 - BODY_GROWTH;
    for (const side of SIDES) {
      const z = (v: number) => sideSign(side) * v;
      const id = (base: string) => `${side}${base}`;
      // Tail light cluster across the rear corner.
      const tx = -2.535 - BODY_GROWTH;
      this.addLight(car, [id('Tail')], L.red, L.lensRear, [0.02, 0.026, 0.34], [tx, 0.985, z(0.58)], 2.2);
      this.addLight(car, ['brakeLights'], L.red, L.lensRear, [0.02, 0.026, 0.16], [tx, 0.955, z(0.66)], 5);
      this.addLight(car, [id('RearTurn')], L.amber, L.lensAmber, [0.02, 0.022, 0.12], [tx, 0.925, z(0.68)]);
      this.addLight(car, ['reverseLights'], L.white, L.lensFront, [0.02, 0.022, 0.12], [tx, 0.925, z(0.5)]);
      this.addLight(car, ['rearFog'], L.red, L.lensRear, [0.02, 0.03, 0.1], [rx, 0.38, z(0.62)], 4);
    }
    // License plate, lit by the license plate lights.
    this.addLight(car, ['licensePlate'], L.white, new THREE.Color('#9a9a9a'), [0.01, 0.15, 0.31], [rx - 0.012, 0.6, 0], 0.6);

    const glow = new THREE.PointLight('#ff2020', 0, 6, 1.6);
    glow.position.set(-2.9, 0.7, 0);
    car.add(glow);
    this.beams.push({ ids: ['brakeLights', 'leftTail', 'rightTail'], light: glow, max: 5 });
    const reverse = new THREE.SpotLight('#ffffff', 0, 10, 0.9, 0.8, 1.5);
    reverse.position.set(-2.65, 0.9, 0);
    reverse.target.position.set(-7, 0, 0);
    car.add(reverse, reverse.target);
    this.beams.push({ ids: ['reverseLights'], light: reverse, max: 30 });
  }

  private buildFrontDoors(car: THREE.Group): void {
    for (const side of SIDES) {
      const s = sideSign(side);
      // Hinged at its front edge, swings outward.
      const hinge = new THREE.Group();
      hinge.position.set(FRONT_DOOR.x1, 0, s * HALF_WIDTH);
      car.add(hinge);
      const offset = new THREE.Vector3(-FRONT_DOOR.x1, 0, -s * HALF_WIDTH);
      const door = new THREE.Mesh(
        sidePanel(roundedRect(FRONT_DOOR.x0 - 0.005, DOOR_BOTTOM - 0.005, FRONT_DOOR.x1 + 0.005, 0.965, 0.06), side, 0.03, 0.004),
        this.paint,
      );
      door.position.copy(offset);
      const pane = new THREE.Mesh(
        sidePanel(polygon([[0.26, 1.06], [0.86, 1.06], [0.36, 1.36], [0.26, 1.36]]), side, 0.01, -0.03),
        this.sideGlass,
      );
      pane.position.copy(offset);
      hinge.add(door, pane);
      this.closures.push({ id: `${side}FrontDoor`, apply: (p) => (hinge.rotation.y = s * p * THREE.MathUtils.degToRad(62)) });
      this.closures.push({ id: `${side}FrontWindow`, apply: (p) => (pane.position.y = offset.y - p * 0.32) });
    }
  }

  private buildFalconDoors(car: THREE.Group): void {
    // Each wing is a cross-section (side wall curving into the roof)
    // extruded along the car's length, hinged at the roof's center line.
    const length = FALCON_DOOR.x1 - FALCON_DOOR.x0 + 0.01;
    const xMid = (FALCON_DOOR.x0 + FALCON_DOOR.x1) / 2;
    const roofTop = ROOF_Y + BODY_GROWTH + 0.012;
    const pivotY = roofTop;

    for (const side of SIDES) {
      const s = sideSign(side);
      const hinge = new THREE.Group();
      hinge.position.set(xMid, pivotY, 0);
      car.add(hinge);

      // Outer contour from the door bottom up the side, around the roof edge, to the center line.
      const outer: [number, number][] = [];
      for (let y = DOOR_BOTTOM - 0.005; y <= 1.48; y += 0.04) outer.push([surfaceZ(xMid, y) + 0.006, y]);
      const edgeR = 0.16;
      const edgeZ = surfaceZ(xMid, 1.5) + 0.006;
      for (let a = 0; a <= 1.0001; a += 0.125) {
        const t = (a * Math.PI) / 2;
        outer.push([edgeZ - edgeR + edgeR * Math.cos(t), roofTop - edgeR + edgeR * Math.sin(t)]);
      }
      outer.push([0.004, roofTop]);
      // Two pieces: the painted lower door, and the frame above the window
      // curving into the roof. The window opening between them shows the pane.
      const thickness = 0.025;
      const piece = (points: [number, number][]) => {
        const contour = [...points, ...points.slice().reverse().map(([zz, yy]): [number, number] => [zz - thickness, yy - thickness])];
        const g = new THREE.ExtrudeGeometry(polygon(contour), { depth: length, bevelEnabled: false, curveSegments: 4 });
        // Shape x is car z, shape y is car y, extrusion runs along car -x.
        g.rotateY(-Math.PI / 2);
        g.translate(FALCON_DOOR.x1 + 0.005, 0, 0);
        if (s < 0) g.scale(1, 1, -1);
        g.translate(-xMid, -pivotY, 0);
        return g;
      };
      const lower = piece(outer.filter(([, yy]) => yy <= 1.05));
      const upper = assignMaterials(piece(outer.filter(([, yy]) => yy >= 1.5)), (c) => (c.y + pivotY < 1.6 ? 0 : 1));
      hinge.add(new THREE.Mesh(lower, this.paint), new THREE.Mesh(upper, [this.trim, this.glass]));

      // Rear window pane rides on the wing and can lower.
      const pane = new THREE.Mesh(sidePanel(roundedRect(-1.0, 1.07, 0.1, 1.5, 0.05), side, 0.01, -0.035), this.sideGlass);
      pane.position.set(-xMid, -pivotY, 0);
      hinge.add(pane);
      this.closures.push({ id: `${side}FalconDoor`, apply: (p) => (hinge.rotation.x = -s * p * THREE.MathUtils.degToRad(100)) });
      this.closures.push({ id: `${side}RearWindow`, apply: (p) => (pane.position.y = -pivotY - p * 0.3) });
    }
  }

  private buildMirrors(car: THREE.Group): void {
    for (const side of SIDES) {
      const s = sideSign(side);
      const pivot = new THREE.Group();
      pivot.position.set(0.95, 1.06, s * (surfaceZ(0.95, 1.06) - 0.01));
      car.add(pivot);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.1), this.trim);
      arm.position.set(0, 0, s * 0.05);
      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.22), this.mirrorPaint);
      housing.position.set(-0.02, 0.02, s * 0.19);
      pivot.add(arm, housing);
      this.closures.push({
        id: `${side}Mirror`,
        // Open = unfolded (sticking out), closed = folded back along the body.
        apply: (p) => (pivot.rotation.y = s * (1 - p) * THREE.MathUtils.degToRad(-70)),
      });
    }
  }

  private buildLiftgate(car: THREE.Group): void {
    const h = LIFTGATE_HINGE;
    const hinge = new THREE.Group();
    hinge.position.copy(h);
    car.add(hinge);
    const shape = new THREE.Shape();
    shape.moveTo(h.x, h.y - 0.01);
    shape.quadraticCurveTo(-2.2, 1.52, -2.42, 1.14);
    shape.lineTo(-2.45, TAIL_TOP + 0.005);
    shape.lineTo(-1.84, TAIL_TOP + 0.005);
    shape.lineTo(-1.8, 1.5);
    shape.closePath();
    const extruded = extrudeAcross(shape, HALF_WIDTH * 2, BODY_BEVEL);
    taper(extruded);
    // Rear glass on the upper slope, black trim on the sides above the belt.
    const gate = assignMaterials(extruded, (c, n) => {
      if (Math.abs(n.z) > 0.75) return c.y < BELT_Y + 0.08 ? 0 : 2;
      return c.x < -2.38 ? 0 : 1;
    });
    gate.translate(-h.x, -h.y, 0);
    hinge.add(new THREE.Mesh(gate, [this.paint, this.glass, this.trim]));

    // The high-mounted brake light rides on the liftgate's spoiler.
    const L = COLORS;
    const y = (v: number) => v - h.y;
    this.addLight(hinge, ['brakeLights'], L.red, L.lensRear, [0.03, 0.02, 0.5], [-2.43 - BODY_GROWTH * 0.6 - h.x, y(1.14 + BODY_GROWTH * 0.6), 0], 5);
    this.closures.push({ id: 'liftgate', apply: (p) => (hinge.rotation.z = -p * THREE.MathUtils.degToRad(80)) });
  }

  private buildChargePort(car: THREE.Group): void {
    // Model X charge port: in the left tail light.
    const led = new THREE.MeshStandardMaterial({ color: '#111', emissive: '#000' });
    const x = -2.3;
    const y = 0.9;
    const zSurface = surfaceZ(x, y);
    const socket = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.01), led);
    socket.position.set(x, y, -(zSurface + 0.004));
    car.add(socket);
    const hinge = new THREE.Group();
    hinge.position.set(x + 0.07, y, -(zSurface + 0.012));
    car.add(hinge);
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.012), this.paint);
    flap.position.set(-0.07, 0, 0);
    hinge.add(flap);
    this.closures.push({
      id: 'chargePort',
      apply: (p, dancing, t) => {
        hinge.rotation.y = p * THREE.MathUtils.degToRad(100);
        if (dancing) led.emissive.setHSL((t * 0.6) % 1, 1, 0.5);
        else led.emissive.set(p > 0.05 ? '#4a7dff' : '#000');
        led.emissiveIntensity = p > 0.05 ? 3 : 0;
      },
    });
  }
}

/** A blurry dark ellipse texture for the car's contact shadow. */
function shadowTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(128, 64, 10, 128, 64, 128);
  gradient.addColorStop(0, 'rgba(0,0,0,0.75)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.setTransform(1, 0, 0, 0.5, 0, 32);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
