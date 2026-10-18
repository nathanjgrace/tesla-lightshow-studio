// The 3D preview: renderer, studio, camera and the light/closure wiring that
// plays a simulation. The car itself comes from a body builder (bodies.ts) and
// can be swapped when the vehicle changes.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Simulation } from '../../core/simulate';
import type { BodyStyle } from '../../core/vehicles';
import { buildBody } from './bodies';
import { shadowTexture } from './kit';

export interface Materials {
  paint: THREE.MeshPhysicalMaterial;
  glass: THREE.MeshPhysicalMaterial;
  sideGlass: THREE.MeshPhysicalMaterial;
  /** Matte paint for small parts that would flare under bloom. */
  smallPaint: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  cabin: THREE.MeshStandardMaterial;
  display: THREE.MeshStandardMaterial;
}

/** What a body builder uses to add parts that the show drives. */
export interface Builder {
  car: THREE.Group;
  m: Materials;
  cabinLight: THREE.PointLight;
  light(
    parent: THREE.Object3D,
    ids: string[],
    color: THREE.Color,
    lens: THREE.Color,
    size: [number, number, number],
    position: [number, number, number],
    gain?: number,
  ): THREE.Mesh;
  closure(id: string, apply: (position: number, dancing: boolean, timeS: number) => void): void;
  beam(ids: string[], light: THREE.Light, max: number): void;
}

export interface BuiltBody {
  /** Half-extents of the car, for framing the camera. */
  halfLength: number;
  height: number;
  halfWidth: number;
  /** Paint color for this model's default look. */
  paint?: string;
}

/**
 * Matte keeps the body from mirroring the virtual studio lights, which can be
 * mistaken for light show effects; glossy looks closer to real paint.
 */
export type Finish = 'matte' | 'glossy';

type FinishSpec = {
  environment: number;
  paint: Partial<THREE.MeshPhysicalMaterialParameters>;
  glass: Partial<THREE.MeshPhysicalMaterialParameters>;
  trim: Partial<THREE.MeshStandardMaterialParameters>;
};

const FINISHES: Record<Finish, FinishSpec> = {
  matte: {
    environment: 0.06,
    paint: { metalness: 0.02, roughness: 0.68, clearcoat: 0 },
    glass: { metalness: 0, roughness: 0.5, clearcoat: 0 },
    trim: { metalness: 0.05, roughness: 0.7 },
  },
  glossy: {
    environment: 0.3,
    paint: { metalness: 0.15, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 },
    glass: { metalness: 0.4, roughness: 0.04, clearcoat: 1 },
    trim: { metalness: 0.5, roughness: 0.25 },
  },
};

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

interface LightPart {
  ids: string[];
  material: THREE.MeshStandardMaterial;
  color: THREE.Color;
  gain: number;
}

const DEFAULT_PAINT = '#e9eaec';

export class CarScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  private readonly controls: OrbitControls;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly target = new THREE.Vector3(0, 0.8, 0);
  private bounds: BuiltBody = { halfLength: 2.65, height: 1.8, halfWidth: 1.1 };
  private lights: LightPart[] = [];
  private closures: { id: string; apply: (p: number, d: boolean, t: number) => void }[] = [];
  private beams: { ids: string[]; light: THREE.Light; max: number }[] = [];
  private car: THREE.Group | undefined;
  private bodyKey = '';
  private readonly cabinLight = new THREE.PointLight('#fff', 0, 4, 1.5);
  private sim: Simulation | undefined;
  private frame = 0;
  private timeS = 0;
  private raf = 0;
  private userMovedCamera = false;
  private size = { w: 0, h: 0 };
  private cameraTween: { from: THREE.Vector3; to: THREE.Vector3; start: number } | undefined;

  private readonly m: Materials = {
    paint: new THREE.MeshPhysicalMaterial({ color: DEFAULT_PAINT }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#06080b' }),
    sideGlass: new THREE.MeshPhysicalMaterial({ color: '#06080b', transparent: true, opacity: 0.9 }),
    smallPaint: new THREE.MeshStandardMaterial({ color: '#d9dadc', roughness: 0.55 }),
    trim: new THREE.MeshStandardMaterial({ color: '#0a0b0d' }),
    cabin: new THREE.MeshStandardMaterial({ color: '#1b1c20', roughness: 0.9 }),
    display: new THREE.MeshStandardMaterial({ color: '#000', emissive: '#000' }),
  };

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color('#07090c');
    this.scene.fog = new THREE.Fog('#07090c', 20, 50);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(this.target);
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
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 2.5),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.005;
    this.scene.add(shadow);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.8, 0.45, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.setFinish('matte');
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

  /** Builds the car for a vehicle; does nothing if that body is already shown. */
  setBody(style: BodyStyle): void {
    const key = JSON.stringify(style);
    if (key === this.bodyKey) return;
    this.bodyKey = key;
    if (this.car) {
      this.scene.remove(this.car);
      this.car.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          for (const mat of [o.material].flat()) if (!Object.values(this.m).includes(mat)) (mat as THREE.Material).dispose();
        }
      });
    }
    this.lights = [];
    this.closures = [];
    this.beams = [];
    const car = new THREE.Group();
    this.car = car;
    this.scene.add(car);

    const builder: Builder = {
      car,
      m: this.m,
      cabinLight: this.cabinLight,
      light: (parent, ids, color, lens, size, position, gain = 5) => {
        const material = new THREE.MeshStandardMaterial({ color: lens, roughness: 0.2, metalness: 0.1 });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
        mesh.position.set(...position);
        parent.add(mesh);
        this.lights.push({ ids, material, color, gain });
        return mesh;
      },
      closure: (id, apply) => this.closures.push({ id, apply }),
      beam: (ids, light, max) => this.beams.push({ ids, light, max }),
    };
    this.bounds = buildBody(builder, style);
    this.m.paint.color.set(this.bounds.paint ?? DEFAULT_PAINT);
    this.target.set(0, this.bounds.height * 0.46, 0);
    if (!this.userMovedCamera) {
      this.controls.target.copy(this.target);
      this.camera.position.copy(this.presetPosition(CAMERA_PRESETS[0]!));
    }
    this.applyFrame();
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
    this.timeS = timeMs / 1000;
    this.applyFrame();
  }

  setFinish(finish: Finish): void {
    const f = FINISHES[finish];
    this.scene.environmentIntensity = f.environment;
    this.m.paint.setValues(f.paint);
    this.m.glass.setValues(f.glass);
    this.m.sideGlass.setValues({ metalness: f.glass.metalness ?? 0, roughness: f.glass.roughness ?? 0.5 });
    this.m.trim.setValues(f.trim);
    // Turning clearcoat on or off changes the shader.
    for (const mat of [this.m.paint, this.m.glass, this.m.sideGlass, this.m.trim]) mat.needsUpdate = true;
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
    const { halfLength, height, halfWidth } = this.bounds;
    let distance = 10;
    // Measure how much of the screen the car's box fills, then scale the distance.
    for (let i = 0; i < 3; i++) {
      probe.position.copy(dir).multiplyScalar(distance).add(this.target);
      probe.lookAt(this.target);
      probe.updateMatrixWorld();
      let extent = 0;
      for (const x of [-halfLength, halfLength]) {
        for (const y of [0, height]) {
          for (const z of [-halfWidth, halfWidth]) {
            corner.set(x, y, z).project(probe);
            extent = Math.max(extent, Math.abs(corner.x), Math.abs(corner.y));
          }
        }
      }
      distance *= extent / 0.82;
    }
    return dir.multiplyScalar(Math.min(distance, this.controls.maxDistance)).add(this.target);
  }

  private tickCamera(): void {
    if (!this.cameraTween) return;
    const t = Math.min(1, (performance.now() - this.cameraTween.start) / 700);
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    this.camera.position.lerpVectors(this.cameraTween.from, this.cameraTween.to, e);
    this.controls.target.lerp(this.target, e);
    if (t === 1) this.cameraTween = undefined;
  }

  private level(id: string): number {
    return this.sim?.levels.get(id)?.[this.frame] ?? 0;
  }

  private applyFrame(): void {
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
      c.apply(track?.position[this.frame] ?? (c.id.endsWith('Mirror') ? 1 : 0), !!track?.dancing[this.frame], this.timeS);
    }
    const r = this.level('centerFrontDisplayRed');
    const g = this.level('centerFrontDisplayGreen');
    const b = this.level('centerFrontDisplayBlue');
    this.m.display.emissive.setRGB(r, g, b);
    this.m.display.emissiveIntensity = 2.5;
    this.cabinLight.color.setRGB(r, g, b);
    this.cabinLight.intensity = Math.max(r, g, b) * 6;
  }
}
