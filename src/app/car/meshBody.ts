// Builds a playable car from Tesla's own 3D model (see teslaAssets.ts).
//
// Tesla's OBJ files keep all the lights in one group, so we split them into
// per-channel parts using Tesla's xLights layout, which places every channel
// on the mesh (src/core/xlightsLayout.ts). Moving parts come from the OBJ's
// groups where Tesla modeled them separately (Model S windows, mirrors,
// liftgate, charge port) and otherwise from regions around the layout's
// closure positions (Cybertruck windows, mirrors, frunk, charge port).

import * as THREE from 'three';
import { CHANNELS_BY_INDEX } from '../../core/channels';
import type { BodyStyle } from '../../core/vehicles';
import { nearestNodes, nodesOnMesh, pixelIndex, type PlacedNode, type Vec3 } from '../../core/xlightsLayout';
import type { Builder, BuiltBody } from './CarScene';
import type { Warp } from './derive';
import { COLORS } from './kit';
import { headBeams } from './parts';
import type { MaterialRole, TeslaAsset } from './teslaAssets';

const deg = THREE.MathUtils.degToRad;

/** A triangle of the source mesh, with what we decided it is. */
interface Tri {
  geometry: THREE.BufferGeometry;
  /** The source geometry's positions, reshaped when deriving another model. */
  positions: ArrayLike<number>;
  /** First vertex in the (non-indexed) source geometry. */
  start: number;
  group: string;
  role: MaterialRole;
  /** Centroid as Tesla modeled it, in mesh units. */
  source: THREE.Vector3;
  /** Centroid after reshaping. */
  centroid: THREE.Vector3;
  normal: THREE.Vector3;
  /** Closure part it moves with, if any. */
  part?: string;
  /** Channels that light it, if it's a lamp. */
  lights?: string[];
  /** The LED bar it belongs to, drawn LED by LED rather than by triangle. */
  bar?: string;
}

interface PartRig {
  /** Pivot, in mesh units. */
  pivot: THREE.Vector3;
  /** A part this one moves with (a window in a door). */
  parent?: string;
  apply: (group: THREE.Group, position: number, extent: THREE.Box3) => void;
}

const sideOf = (z: number) => (z < 0 ? 'left' : 'right');

/**
 * `warp` reshapes the mesh into another model (see derive.ts); the layout's
 * positions are reshaped with it, so every lamp keeps its channel.
 */
export function buildTeslaBody(b: Builder, asset: TeslaAsset, style: BodyStyle, warp?: Warp): BuiltBody {
  const tris = collectTriangles(asset, warp);
  const bounds = new THREE.Box3();
  const sourceBounds = new THREE.Box3();
  for (const t of tris) {
    bounds.expandByPoint(t.centroid);
    sourceBounds.expandByPoint(t.source);
  }
  const box = { min: sourceBounds.min.toArray() as Vec3, max: sourceBounds.max.toArray() as Vec3 };
  const nodes = nodesOnMesh(asset.layout, asset.layoutMesh, box).map((n) => (warp ? { ...n, position: warp.apply(n.position, '') } : n));
  const channelOf = (n: PlacedNode) => CHANNELS_BY_INDEX.get(n.channel - 1);
  const lampNodes = nodes.filter((n) => {
    const kind = channelOf(n)?.kind;
    return kind === 'ramping' || kind === 'boolean';
  });
  const at = (name: string) => nodes.find((n) => n.name === name)?.position;

  // Layout units are half-centimeters; the mesh may be scaled into them.
  const k = asset.layoutMesh.scale[0] / 200;
  const isCybertruck = asset.model === 'cybertruck';
  const rigs = new Map<string, PartRig>();

  if (isCybertruck) cybertruckParts(tris, nodes, at, rigs);
  else if (style.model === 'modelX') modelXParts(tris, rigs);
  else modelSParts(tris, at, rigs, style.model === 'model3');

  // Lamps: Cybertruck light bars by position along the bar, everything else
  // by the nearest channel in Tesla's layout.
  const lensTris = tris.filter((t) => t.role === 'lens' || t.role === 'redLens');
  const bars = isCybertruck ? cybertruckBars(lensTris, lampNodes, channelOf) : [];
  const unassigned = lensTris.filter((t) => !t.lights);
  const nearest = nearestNodes(
    unassigned.flatMap((t) => t.centroid.toArray()),
    lampNodes,
    isCybertruck ? 26 : 45,
  );
  unassigned.forEach((t, i) => {
    const n = nearest[i]!;
    if (n >= 0) t.lights = [channelOf(lampNodes[n]!)!.id];
  });

  // Assemble: one mesh per (part, material, light) bucket.
  const rig = new THREE.Group();
  rig.scale.setScalar(k);
  b.car.add(rig);
  const materials = meshMaterials(b, asset);
  const buckets = new Map<string, Tri[]>();
  for (const t of tris) {
    if (t.bar) continue;
    const key = `${t.part ?? ''}|${t.role}|${t.lights?.join('+') ?? ''}`;
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(t);
  }
  const partGroups = new Map<string, { group: THREE.Group; extent: THREE.Box3 }>();
  const partGroup = (part: string): { group: THREE.Group; extent: THREE.Box3 } => {
    let g = partGroups.get(part);
    if (!g) {
      const rigSpec = rigs.get(part)!;
      const group = new THREE.Group();
      group.position.copy(rigSpec.pivot);
      if (rigSpec.parent && rigs.has(rigSpec.parent)) {
        group.position.sub(rigs.get(rigSpec.parent)!.pivot);
        partGroup(rigSpec.parent).group.add(group);
      } else {
        rig.add(group);
      }
      group.userData.baseY = group.position.y;
      g = { group, extent: new THREE.Box3() };
      partGroups.set(part, g);
    }
    return g;
  };
  for (const [key, list] of buckets) {
    const [part, role, lightKey] = key.split('|') as [string, MaterialRole, string];
    const ids = lightKey ? lightKey.split('+') : [];
    let material = materials[role === 'glass' && part ? 'sideGlass' : role];
    if (ids.length) material = material.clone();
    if (role === 'paint' || role === 'trim' || role === 'black') insideFaces(material);
    const mesh = new THREE.Mesh(mergeTriangles(list), material);
    if (part) {
      const g = partGroup(part);
      mesh.position.copy(rigs.get(part)!.pivot).negate();
      g.group.add(mesh);
      for (const t of list) g.extent.expandByPoint(t.centroid);
    } else {
      rig.add(mesh);
    }
    if (ids.length) b.lightMesh(mesh, ids, lampColor(ids, role), 4);
  }
  for (const bar of bars) {
    const mesh = new THREE.Mesh(mergeTriangles(bar.tris), materials[bar.tris[0]!.role].clone());
    rig.add(mesh);
    b.lightBar(mesh, bar.pixels, bar.from, bar.to, lampColor(bar.pixels[0]!, bar.tris[0]!.role));
  }
  // Lamps Tesla's mesh doesn't model (Model S side repeaters, license plate
  // and rear fogs): a small lens on the body near the layout's position,
  // moving with the panel it sits on (the plate lights ride on the liftgate).
  // Tesla's layout puts the rear fogs beside the plate, where nothing is on
  // the real cars; they go low in the rear bumper instead.
  const lit = new Set(tris.flatMap((t) => t.lights ?? []));
  const solid = tris.filter((t) => t.role !== 'glass' && t.role !== 'lens' && t.role !== 'redLens');
  const surfaceNear = (p: THREE.Vector3, facing?: (n: THREE.Vector3) => boolean) => {
    let best: Tri | undefined;
    let d = Infinity;
    for (const t of solid) {
      if (facing && !facing(t.normal)) continue;
      const e = t.centroid.distanceToSquared(p);
      if (e < d) [d, best] = [e, t];
    }
    return best;
  };
  for (const n of lampNodes) {
    const id = channelOf(n)!.id;
    if (lit.has(id) || /Bar\d/.test(id)) continue;
    const red = /Tail|brake|rearFog/i.test(id);
    const color = lampColor([id], red ? 'redLens' : 'lens');
    const lens = id === 'licensePlate' ? new THREE.Color('#9a9a9a') : red ? new THREE.Color('#2a0c0d') : COLORS.lensFront;
    const size: [number, number, number] = id === 'licensePlate' ? [1.5, 3, 12] : id === 'rearFog' ? [2, 3, 14] : [6, 2.5, 2.5];
    let at = new THREE.Vector3(...n.position);
    if (id === 'rearFog' && !isCybertruck) {
      const target = new THREE.Vector3(at.x, 0.36 / k, Math.sign(at.z || 1) * 0.42 / k);
      const t = surfaceNear(target, (nrm) => nrm.x < -0.5);
      if (t) at = t.centroid.clone().add(t.normal.clone().multiplyScalar(0.4));
    }
    const host = surfaceNear(at);
    const parent = host?.part ? partGroup(host.part).group : rig;
    const local = host?.part ? at.clone().sub(rigs.get(host.part)!.pivot) : at;
    b.light(parent, [id], color, lens, size, local.toArray() as Vec3, id === 'licensePlate' ? 0.6 : 4);
  }
  for (const [part, { group, extent }] of partGroups) {
    const spec = rigs.get(part)!;
    b.closure(part, (p) => spec.apply(group, p, extent));
  }

  // Light the street: headlight and fog beams, the red glow of the tail
  // lights, and the reverse lights.
  const m = (v: Vec3 | undefined): Vec3 | undefined => v && [v[0] * k, v[1] * k, v[2] * k];
  const prefix = isCybertruck ? 'CT ' : '';
  const beam = m(at(`${prefix}Right Outer Main Beam`));
  const fog = m(at('Right Front Fog'));
  // The beams start a little ahead of the lamps, so they light the ground, not the lamp housings.
  if (beam) headBeams(b, { x: beam[0] + 0.15, y: beam[1], z: beam[2] }, fog && { x: fog[0] + 0.15, y: fog[1], z: fog[2] });
  const halfLength = Math.max(-bounds.min.x, bounds.max.x) * k;
  const glow = new THREE.PointLight('#ff2020', 0, 6, 1.6);
  glow.position.set(bounds.min.x * k - 0.35, 0.7, 0);
  b.car.add(glow);
  b.beam(['brakeLights', 'leftTail', 'rightTail'], glow, 5);
  const reverse = new THREE.SpotLight('#ffffff', 0, 10, 0.9, 0.8, 1.5);
  reverse.position.set(bounds.min.x * k - 0.1, 0.9, 0);
  reverse.target.position.set(bounds.min.x * k - 4.5, 0, 0);
  b.car.add(reverse, reverse.target);
  b.beam(['reverseLights'], reverse, 30);
  const display = m(at(`${prefix}Center Front Display`));
  // Tesla's meshes have no interior to catch the display's glow, so keep it
  // low and soft or it lights the roof glass from inside.
  if (display) b.cabinLight.position.set(display[0] - 0.3, display[1] * 0.7, 0);
  b.car.add(b.cabinLight);

  return {
    halfLength,
    height: bounds.max.y * k,
    halfWidth: Math.max(-bounds.min.z, bounds.max.z) * k,
    paint: isCybertruck ? '#b9bcc0' : undefined,
    cabinGain: 1.5,
  };
}

function collectTriangles(asset: TeslaAsset, warp?: Warp): Tri[] {
  const out: Tri[] = [];
  const a = new THREE.Vector3();
  const b2 = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (const mesh of asset.meshes) {
    const geometry = mesh.geometry;
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    // Reshape a copy; the cached asset stays as Tesla made it.
    let positions: ArrayLike<number> = pos.array;
    if (warp) {
      const w = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) w.set(warp.apply([pos.getX(i), pos.getY(i), pos.getZ(i)], mesh.name), i * 3);
      positions = w;
    }
    const at = (v: THREE.Vector3, i: number) => v.set(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!);
    const materials = [mesh.material].flat() as THREE.Material[];
    const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: pos.count, materialIndex: 0 }];
    for (const g of groups) {
      const role = asset.roles[materials[g.materialIndex ?? 0]?.name ?? ''] ?? 'black';
      for (let i = g.start; i + 2 < g.start + g.count; i += 3) {
        a.fromBufferAttribute(pos, i);
        b2.fromBufferAttribute(pos, i + 1);
        c.fromBufferAttribute(pos, i + 2);
        const source = new THREE.Vector3().add(a).add(b2).add(c).divideScalar(3);
        at(a, i);
        at(b2, i + 1);
        at(c, i + 2);
        const centroid = new THREE.Vector3().add(a).add(b2).add(c).divideScalar(3);
        const normal = new THREE.Vector3().subVectors(c, b2).cross(new THREE.Vector3().subVectors(a, b2)).normalize();
        out.push({ geometry, positions, start: i, group: mesh.name, role, source, centroid, normal });
      }
    }
  }
  return out;
}

function mergeTriangles(list: Tri[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const source = list[0]!.geometry;
  for (const name of ['position', 'normal', 'uv'] as const) {
    if (!source.attributes[name]) continue;
    const size = source.attributes[name].itemSize;
    const data = new Float32Array(list.length * 3 * size);
    let o = 0;
    for (const t of list) {
      const array = name === 'position' ? t.positions : (t.geometry.attributes[name] as THREE.BufferAttribute).array;
      for (let v = 0; v < 3; v++) for (let s = 0; s < size; s++) data[o++] = array[(t.start + v) * size + s]!;
    }
    if (name === 'normal') {
      // Tesla's Cybertruck file has a few zero-length normals; one NaN pixel
      // is enough for the bloom pass to black out the whole frame.
      list.forEach((t, i) => {
        for (let v = 0; v < 3; v++) {
          const o3 = (i * 3 + v) * 3;
          if (!(Math.hypot(data[o3]!, data[o3 + 1]!, data[o3 + 2]!) > 1e-6)) t.normal.toArray(data, o3);
        }
      });
    }
    out.setAttribute(name, new THREE.BufferAttribute(data, size));
  }
  out.computeBoundingSphere();
  return out;
}

function lampColor(ids: string[], role: MaterialRole): THREE.Color {
  const id = ids[0]!;
  if (/Tail|brake|rearFog|rearLightBar/i.test(id)) return COLORS.red;
  if (role === 'redLens') return COLORS.red;
  if (/Turn|SideMarker|SideRepeater/.test(id)) return COLORS.amber;
  return COLORS.white;
}

type Materials = Record<MaterialRole | 'sideGlass', THREE.Material>;

/**
 * Tesla's meshes are a shell of single-sided panels with no interior, so
 * from inside (through an open liftgate, say) the doors and roof vanish.
 * This draws the panels' back faces too, as dark unpainted lining.
 */
function insideFaces(material: THREE.Material): void {
  if (material.userData.insideFaces) return;
  material.userData.insideFaces = true;
  material.side = THREE.DoubleSide;
  const before = material.onBeforeCompile.bind(material);
  const key = material.customProgramCacheKey();
  material.customProgramCacheKey = () => `inside:${key}`;
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\nif ( !gl_FrontFacing ) diffuseColor.rgb = vec3( 0.03 );')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nif ( !gl_FrontFacing ) roughnessFactor = 0.9;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nif ( !gl_FrontFacing ) metalnessFactor = 0.0;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nif ( !gl_FrontFacing ) totalEmissiveRadiance = vec3( 0.0 );')
      .replace(
        '#include <lights_physical_fragment>',
        '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nif ( !gl_FrontFacing ) material.clearcoat = 0.0;\n#endif',
      );
  };
  material.needsUpdate = true;
}

function meshMaterials(b: Builder, asset: TeslaAsset): Materials {
  const tex = (name: string) => asset.textures.get(name) ?? null;
  const ct = asset.model === 'cybertruck';
  b.m.meshPaint.map = tex(ct ? 'Paint_Red_AO.png' : 'Exterior_AO.png');
  b.m.meshPaint.userData.paintScale = asset.paintScale;
  b.m.meshPaint.needsUpdate = true;
  return {
    paint: b.m.meshPaint,
    trim: new THREE.MeshStandardMaterial({ map: tex('Exterior_AO_Dark.png'), roughness: 0.5, metalness: 0.2 }),
    black: new THREE.MeshStandardMaterial({ color: '#060607', roughness: 0.6 }),
    glass: b.m.glass,
    sideGlass: b.m.sideGlass,
    // Lamp housings: not mirror-glossy, or every lot light, the moon and the
    // car's own beams show up as pinpoint glints of color inside the lamps.
    lens: new THREE.MeshStandardMaterial({ map: tex('Lights_AO.png'), roughness: 0.45, metalness: 0, envMapIntensity: 0.4 }),
    redLens: new THREE.MeshStandardMaterial({ map: tex(ct ? 'Lights_AO_Red.png' : 'Lights_Red_AO.png'), roughness: 0.45, metalness: 0, envMapIntensity: 0.4 }),
    wheel: new THREE.MeshStandardMaterial({
      map: tex(ct ? 'Cybertruck_Premium_Wheel_AO_Dark.png' : 'Arachnid_Wheel_AO.png'),
      roughness: 0.35,
      metalness: 0.5,
    }),
    tire: new THREE.MeshStandardMaterial({ color: '#0b0b0c', roughness: 0.85 }),
  };
}

// --- Model S: Tesla modeled the moving parts as their own groups ------------

/** `trunk`: the Model 3's trunk lid hinges below the rear glass, which stays put. */
function modelSParts(tris: Tri[], at: (name: string) => Vec3 | undefined, rigs: Map<string, PartRig>, trunk = false): void {
  const groups: Record<string, string> = {
    Window_LF: 'leftFrontWindow',
    Window_LR: 'leftRearWindow',
    Window_RF: 'rightFrontWindow',
    Window_RR: 'rightRearWindow',
    Door_LF_Mirror: 'leftMirror',
    Door_RF_Mirror: 'rightMirror',
    Trunk: 'liftgate',
    Charge_Cap: 'chargePort',
  };
  const handles: [string, string][] = [
    ['leftFrontDoorHandle', 'Left Front Door Handle'],
    ['rightFrontDoorHandle', 'Right Front Door Handle'],
    ['leftRearDoorHandle', 'Left Rear Door Handle'],
    // Tesla's layout spells this one "Right Rear Door Handle" but its channel
    // list says "Rear Rear"; the position is what matters.
    ['rightRearDoorHandle', 'Right Rear Door Handle'],
  ];
  for (const t of tris) {
    t.part = groups[t.group];
    if (trunk && t.part === 'liftgate' && t.role === 'glass') t.part = undefined;
    if (!t.group.startsWith('Door_') || t.part) continue;
    for (const [part, name] of handles) {
      const p = at(name);
      if (p && t.centroid.distanceTo(new THREE.Vector3(...p)) < 16 && Math.abs(t.centroid.z) > 178) t.part = part;
    }
  }
  const extentOf = (part: string) => {
    const box = new THREE.Box3();
    for (const t of tris) if (t.part === part) box.expandByPoint(t.centroid);
    return box;
  };
  for (const part of new Set(tris.map((t) => t.part).filter((p): p is string => !!p))) {
    const e = extentOf(part);
    const side = sideOf(e.getCenter(new THREE.Vector3()).z);
    const s = side === 'right' ? 1 : -1;
    if (part.endsWith('Window')) {
      const drop = (e.max.y - e.min.y) * 0.95;
      rigs.set(part, { pivot: new THREE.Vector3(), apply: (g, p) => (g.position.y = -p * drop) });
    } else if (part.endsWith('Mirror')) {
      // Folds back about its inner edge.
      const pivot = new THREE.Vector3(e.max.x - 8, e.min.y, s > 0 ? e.min.z : e.max.z);
      rigs.set(part, { pivot, apply: (g, p) => (g.rotation.y = -s * (1 - p) * deg(62)) });
    } else if (part === 'liftgate') {
      const pivot = new THREE.Vector3(e.max.x, e.max.y, 0);
      const angle = deg(trunk ? 62 : 78);
      rigs.set(part, { pivot, apply: (g, p) => (g.rotation.z = -p * angle) });
    } else if (part === 'chargePort') {
      const pivot = new THREE.Vector3(e.max.x, (e.min.y + e.max.y) / 2, s > 0 ? e.max.z : e.min.z);
      rigs.set(part, { pivot, apply: (g, p) => (g.rotation.y = s * p * deg(-80)) });
    } else if (part.endsWith('DoorHandle')) {
      const pivot = new THREE.Vector3();
      rigs.set(part, { pivot, apply: (g, p) => (g.position.z = s * p * 4) });
    }
  }
}

// --- Model X, derived from the Model S ---------------------------------------

/**
 * The S's front doors become the X's powered front doors (with their window
 * and mirror), and its rear doors plus the roof above them become the falcon
 * wings (with the rear windows). Selection uses Tesla's original
 * coordinates; pivots use the reshaped ones.
 */
function modelXParts(tris: Tri[], rigs: Map<string, PartRig>): void {
  const groups: Record<string, string> = {
    Door_LF: 'leftFrontDoor',
    Door_RF: 'rightFrontDoor',
    Door_LR: 'leftFalconDoor',
    Door_RR: 'rightFalconDoor',
    Window_LF: 'leftFrontWindow',
    Window_RF: 'rightFrontWindow',
    Window_LR: 'leftRearWindow',
    Window_RR: 'rightRearWindow',
    Door_LF_Mirror: 'leftMirror',
    Door_RF_Mirror: 'rightMirror',
    Trunk: 'liftgate',
    Charge_Cap: 'chargePort',
  };
  const rear = new THREE.Box3();
  for (const t of tris) if (t.group === 'Door_LR' || t.group === 'Door_RR') rear.expandByPoint(t.source);
  for (const t of tris) {
    t.part = groups[t.group];
    const c = t.source;
    // The roof above each rear door (S units: 0.5 cm) lifts with the wing.
    if (
      !t.part &&
      (t.group === 'Body' || t.group === 'Windows_Top') &&
      c.x > rear.min.x + 4 &&
      c.x < rear.max.x - 4 &&
      c.y > 205 &&
      Math.abs(c.z) > 8
    ) {
      t.part = `${sideOf(c.z)}FalconDoor`;
    }
  }
  const extentOf = (part: string) => {
    const box = new THREE.Box3();
    for (const t of tris) if (t.part === part) box.expandByPoint(t.centroid);
    return box;
  };
  for (const part of new Set(tris.map((t) => t.part).filter((p): p is string => !!p))) {
    const e = extentOf(part);
    const side = sideOf(e.getCenter(new THREE.Vector3()).z);
    const s = side === 'right' ? 1 : -1;
    if (part.endsWith('FalconDoor')) {
      // Hinged along the roof's center spine.
      const pivot = new THREE.Vector3((e.min.x + e.max.x) / 2, e.max.y, s * 8);
      rigs.set(part, { pivot, apply: (g, p) => (g.rotation.x = -s * p * deg(100)) });
    } else if (part.endsWith('FrontDoor')) {
      const pivot = new THREE.Vector3(e.max.x, (e.min.y + e.max.y) / 2, s > 0 ? e.max.z : e.min.z);
      rigs.set(part, { pivot, apply: (g, p) => (g.rotation.y = s * p * deg(65)) });
    } else if (part.endsWith('Window')) {
      const drop = (e.max.y - e.min.y) * 0.95;
      const parent = `${side}${part.includes('Front') ? 'FrontDoor' : 'FalconDoor'}`;
      rigs.set(part, { pivot: new THREE.Vector3(), parent, apply: (g, p) => (g.position.y = -p * drop + g.userData.baseY) });
    } else if (part.endsWith('Mirror')) {
      const pivot = new THREE.Vector3(e.max.x - 8, e.min.y, s > 0 ? e.min.z : e.max.z);
      rigs.set(part, { pivot, parent: `${side}FrontDoor`, apply: (g, p) => (g.rotation.y = -s * (1 - p) * deg(62)) });
    } else if (part === 'liftgate') {
      const pivot = new THREE.Vector3(e.max.x, e.max.y, 0);
      rigs.set(part, { pivot, apply: (g, p) => (g.rotation.z = -p * deg(78)) });
    } else if (part === 'chargePort') {
      const pivot = new THREE.Vector3(e.max.x, (e.min.y + e.max.y) / 2, s > 0 ? e.max.z : e.min.z);
      rigs.set(part, { pivot, apply: (g, p) => (g.rotation.y = s * p * deg(-80)) });
    }
  }
}

// --- Cybertruck: one body mesh, so moving parts are cut out by region -------

function cybertruckParts(
  tris: Tri[],
  nodes: PlacedNode[],
  at: (name: string) => Vec3 | undefined,
  rigs: Map<string, PartRig>,
): void {
  const v = (p: Vec3 | undefined) => (p ? new THREE.Vector3(...p) : undefined);
  const windows = nodes.filter((n) => /CT (Left|Right) (Front|Rear) Window/.test(n.name));
  const windowPart = (n: PlacedNode) =>
    n.name.replace(/^CT (Left|Right) (Front|Rear) Window$/, (_, s: string, fr: string) => `${s.toLowerCase()}${fr}Window`);
  const mirrors: [string, THREE.Vector3 | undefined][] = [
    ['leftMirror', v(at('CT Left Mirror'))],
    ['rightMirror', v(at('CT Right Mirror'))],
  ];
  const chargePort = v(at('CT Charge Port'));
  for (const t of tris) {
    const c = t.centroid;
    if (t.role === 'glass' && Math.abs(t.normal.z) > 0.55 && windows.length) {
      let best = windows[0]!;
      for (const n of windows) if (c.distanceToSquared(new THREE.Vector3(...n.position)) < c.distanceToSquared(new THREE.Vector3(...best.position))) best = n;
      if (Math.sign(best.position[2]) === Math.sign(c.z)) t.part = windowPart(best);
      continue;
    }
    if (t.role === 'glass' || t.role === 'lens' || t.role === 'redLens' || t.role === 'wheel') continue;
    for (const [part, p] of mirrors) if (p && Math.abs(c.z) > 93 && c.distanceTo(p) < 24) t.part = part;
    if (chargePort && c.z < -95 && c.distanceTo(chargePort) < 10) t.part = 'chargePort';
    // The frunk lid: the top of the nose, ahead of the windshield.
    if (!t.part && t.role === 'paint' && c.x > 222 && c.y > 95 && t.normal.y > 0.3 && Math.abs(c.z) < 95) t.part = 'liftgate';
  }
  const extentOf = (part: string) => {
    const box = new THREE.Box3();
    for (const t of tris) if (t.part === part) box.expandByPoint(t.centroid);
    return box;
  };
  for (const part of new Set(tris.map((t) => t.part).filter((p): p is string => !!p))) {
    const e = extentOf(part);
    const s = sideOf(e.getCenter(new THREE.Vector3()).z) === 'right' ? 1 : -1;
    if (part.endsWith('Window')) {
      const drop = (e.max.y - e.min.y) * 0.95;
      rigs.set(part, { pivot: new THREE.Vector3(), apply: (g, p) => (g.position.y = -p * drop) });
    } else if (part.endsWith('Mirror')) {
      const pivot = new THREE.Vector3(e.max.x - 4, e.min.y, s > 0 ? e.min.z : e.max.z);
      rigs.set(part, { pivot, apply: (g, p) => (g.rotation.y = -s * (1 - p) * deg(62)) });
    } else if (part === 'liftgate') {
      const pivot = new THREE.Vector3(e.min.x, e.max.y, 0);
      rigs.set(part, { pivot, apply: (g, p) => (g.rotation.z = p * deg(42)) });
    } else if (part === 'chargePort') {
      const pivot = new THREE.Vector3(e.max.x, (e.min.y + e.max.y) / 2, e.min.z);
      rigs.set(part, { pivot, apply: (g, p) => (g.rotation.y = p * deg(-80)) });
    }
  }
}

/**
 * The Cybertruck's front and rear light bars: individually driven LEDs,
 * numbered left to right. Tesla's layout also puts the brake light and rear
 * turn signals on the rear bar, so those channels light the LEDs near them.
 */
interface LedBar {
  tris: Tri[];
  /** Channels lighting each LED: the bar's own pixel, plus any lamp sharing its lens. */
  pixels: string[][];
  from: number;
  to: number;
}

function cybertruckBars(lens: Tri[], lampNodes: PlacedNode[], channelOf: (n: PlacedNode) => { id: string } | undefined): LedBar[] {
  const bars: { base: string; count: number; test: (c: THREE.Vector3) => boolean }[] = [
    { base: 'frontLightBar', count: 60, test: (c) => c.x > 200 && c.y >= 86 && c.y <= 116 },
    { base: 'rearLightBar', count: 52, test: (c) => c.x < -200 && c.y >= 106 },
  ];
  const out: LedBar[] = [];
  for (const bar of bars) {
    const on = lens.filter((t) => bar.test(t.centroid));
    if (!on.length) continue;
    let min = Infinity;
    let max = -Infinity;
    for (const t of on) {
      min = Math.min(min, t.centroid.z);
      max = Math.max(max, t.centroid.z);
    }
    const pixels = Array.from({ length: bar.count }, (_, i) => [`${bar.base}${i + 1}`]);
    for (const t of on) {
      const ids = pixels[pixelIndex(t.centroid.z, min, max, bar.count)]!;
      for (const n of lampNodes) {
        if (t.centroid.distanceTo(new THREE.Vector3(...n.position)) < 14) {
          const id = channelOf(n)?.id;
          if (id && !ids.includes(id)) ids.push(id);
        }
      }
      t.lights = ids;
      t.bar = bar.base;
    }
    out.push({ tris: on, pixels, from: min, to: max });
  }
  return out;
}
