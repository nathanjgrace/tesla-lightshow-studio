// Builds the playable car from a rigged model file (see glbAssets.ts and
// scripts/models): paint and glass get the app's own materials, each lamp
// mesh is wired to its channels, and moving parts get their hinges.

import * as THREE from 'three';
import type { Builder, BuiltBody } from './CarScene';
import type { GlbAsset, PartRig } from './glbAssets';
import { COLORS } from './kit';
import { insideFaces } from './meshBody';
import { headBeams } from './parts';

const LAMP_COLORS: Record<string, THREE.Color> = { white: COLORS.white, amber: COLORS.amber, red: COLORS.red };

export function buildGlbBody(b: Builder, asset: GlbAsset): BuiltBody {
  const root = new THREE.Group();
  root.name = asset.file;
  b.car.add(root);

  // Clear covers over the lamps: you see the housings through them, and the
  // lamps' own glow is added on top. Almost no highlights: a lot lamp mirrored
  // in a lamp cover looks exactly like that lamp being on.
  const lens = new THREE.MeshPhysicalMaterial({ color: '#c9ced6', roughness: 0.3, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, envMapIntensity: 0.3, specularIntensity: 0.05 });
  const redLens = new THREE.MeshPhysicalMaterial({ color: '#7a0a0c', roughness: 0.3, metalness: 0, transparent: true, opacity: 0.55, depthWrite: false, envMapIntensity: 0.3, specularIntensity: 0.05 });
  const swaps: Record<string, THREE.Material> = { paint: insideFaces(b.m.paint), glass: b.m.sideGlass, lens, redlens: redLens };

  // Moving parts: a group at each pivot, nested where one rides on another.
  const groups = new Map<string, THREE.Group>();
  const partGroup = (id: string): THREE.Group => {
    let g = groups.get(id);
    if (g) return g;
    const rig = asset.parts[id]!;
    g = new THREE.Group();
    g.name = id;
    const pivot = new THREE.Vector3(...(rig.pivot ?? [0, 0, 0]));
    if (rig.parent && asset.parts[rig.parent]) {
      const parent = partGroup(rig.parent);
      g.position.copy(pivot).sub(new THREE.Vector3(...(asset.parts[rig.parent]!.pivot ?? [0, 0, 0])));
      parent.add(g);
    } else {
      g.position.copy(pivot);
      root.add(g);
    }
    groups.set(id, g);
    return g;
  };

  const bounds = new THREE.Box3();
  asset.scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const data = o.userData as { part?: string; lights?: string[]; color?: string; gain?: number };
    const source = o.material as THREE.MeshStandardMaterial;
    let material: THREE.Material = swaps[source.name] ?? source;
    if (data.lights) {
      // Lamps add their light over whatever is behind them, and show nothing when off.
      material = new THREE.MeshStandardMaterial({
        color: '#000',
        roughness: 1,
        metalness: 0,
        envMapIntensity: 0,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
    }
    if (material === source && source instanceof THREE.MeshStandardMaterial) b.finish(source);
    const mesh = new THREE.Mesh(o.geometry, material);
    mesh.name = o.name;
    mesh.applyMatrix4(o.matrixWorld);
    if (data.lights) mesh.renderOrder = 2;
    else if (material === lens || material === redLens) mesh.renderOrder = 1;
    const part = data.part && asset.parts[data.part] ? data.part : undefined;
    if (part) {
      const pivot = asset.parts[part]!.pivot ?? [0, 0, 0];
      mesh.applyMatrix4(new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]));
      partGroup(part).add(mesh);
    } else {
      root.add(mesh);
    }
    if (data.lights) b.lightMesh(mesh, data.lights, LAMP_COLORS[data.color ?? 'white'] ?? COLORS.white, data.gain ?? 3);
    else bounds.expandByObject(o);
  });

  for (const [id, rig] of Object.entries(asset.parts)) {
    const g = partGroup(id);
    b.closure(id, mover(g, rig), g);
  }

  // Light on the ground: head and fog beams, the red glow of the tails, the reverse lights.
  const head = asset.beams?.head;
  const fog = asset.beams?.fog;
  if (head) headBeams(b, { x: head[0] + 0.15, y: head[1], z: head[2] }, fog && { x: fog[0] + 0.15, y: fog[1], z: fog[2] });
  const glow = new THREE.PointLight('#ff2020', 0, 6, 1.6);
  glow.position.set(bounds.min.x - 0.35, 0.7, 0);
  b.car.add(glow);
  b.beam(['brakeLights', 'leftTail', 'rightTail'], glow, 5);
  const reverse = new THREE.SpotLight('#ffffff', 0, 10, 0.9, 0.8, 1.5);
  reverse.position.set(bounds.min.x - 0.1, 0.9, 0);
  reverse.target.position.set(bounds.min.x - 4.5, 0, 0);
  b.car.add(reverse, reverse.target);
  b.beam(['reverseLights'], reverse, 30);
  const cabin = asset.cabin ?? [0.4, 0.95, 0];
  b.cabinLight.position.set(...cabin);
  b.car.add(b.cabinLight);

  return {
    halfLength: Math.max(-bounds.min.x, bounds.max.x),
    height: bounds.max.y,
    halfWidth: Math.max(-bounds.min.z, bounds.max.z),
    cabinGain: 2.5,
  };
}

function mover(g: THREE.Group, rig: PartRig): (position: number) => void {
  const base = g.position.clone();
  if (rig.type === 'hinge') {
    const axis = new THREE.Vector3(...rig.axis).normalize();
    const angle = THREE.MathUtils.degToRad(rig.deg);
    return (p) => g.quaternion.setFromAxisAngle(axis, (rig.invert ? 1 - p : p) * angle);
  }
  const vector = new THREE.Vector3(...rig.vector);
  return (p) => g.position.copy(base).addScaledVector(vector, rig.invert ? 1 - p : p);
}
