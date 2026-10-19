// Reads Tesla's xLights layout (xlights_rgbeffects.xml in
// teslamotors/light-show, xlights/tesla_xlights_show_folder.zip). Tesla places
// one xLights model per channel on top of its 3D car meshes, so the layout says
// where on the Model S and Cybertruck each light sits. We use those positions
// to split each mesh's lights into per-channel parts.

export type Vec3 = [number, number, number];

/** One xLights model: a channel (or run of channels) placed in the layout. */
export interface LayoutModel {
  name: string;
  /** 1-based first channel, from StartChannel="!Model S:<n>". */
  channel: number;
  /** Number of nodes: lamps drawn along the model's line. */
  nodes: number;
  /**
   * "Node Single Color" models give each node its own channel (light bars);
   * "Single Color" models drive all their nodes from one channel (two
   * reverse lamps, say).
   */
  channelPerNode: boolean;
  /** Start and end of the model's line; nodes are spaced evenly along it. */
  position: Vec3;
  end: Vec3;
  displayAs: string;
  layoutGroup: string;
}

/** A 3D mesh (OBJ) placed in the layout. */
export interface LayoutMesh {
  name: string;
  /** File name of the OBJ, without the author's local folders. */
  objFile: string;
  position: Vec3;
  scale: Vec3;
  rotation: Vec3;
}

export interface XlightsLayout {
  models: LayoutModel[];
  meshes: LayoutMesh[];
}

function attributes(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of tag.matchAll(/([A-Za-z_][\w.-]*)="([^"]*)"/g)) out.set(m[1]!, m[2]!);
  return out;
}

const num = (a: Map<string, string>, key: string, fallback = 0) => {
  const v = Number(a.get(key));
  return Number.isFinite(v) && a.has(key) ? v : fallback;
};

/** Parses the models and meshes out of an xlights_rgbeffects.xml file. */
export function parseXlightsLayout(xml: string): XlightsLayout {
  const models: LayoutModel[] = [];
  const meshes: LayoutMesh[] = [];
  for (const m of xml.matchAll(/<model\b[^>]*>/g)) {
    const a = attributes(m[0]);
    const channel = /:(\d+)$/.exec(a.get('StartChannel') ?? '');
    if (!channel) continue;
    const position: Vec3 = [num(a, 'WorldPosX'), num(a, 'WorldPosY'), num(a, 'WorldPosZ')];
    models.push({
      name: a.get('name') ?? '',
      channel: Number(channel[1]),
      // parm2 is the node count for Single Line and Poly Line models. Custom
      // models are grids we only use the center of.
      nodes: a.get('DisplayAs') === 'Custom' ? 1 : Math.max(1, num(a, 'parm2', 1)),
      channelPerNode: (a.get('StringType') ?? '').startsWith('Node'),
      position,
      end: [position[0] + num(a, 'X2'), position[1] + num(a, 'Y2'), position[2] + num(a, 'Z2')],
      displayAs: a.get('DisplayAs') ?? '',
      layoutGroup: a.get('LayoutGroup') ?? '',
    });
  }
  for (const m of xml.matchAll(/<view_object\b[^>]*>/g)) {
    const a = attributes(m[0]);
    if (a.get('DisplayAs') !== 'Mesh') continue;
    meshes.push({
      name: a.get('name') ?? '',
      objFile: (a.get('ObjFile') ?? '').split(/[\\/]/).pop() ?? '',
      position: [num(a, 'WorldPosX'), num(a, 'WorldPosY'), num(a, 'WorldPosZ')],
      scale: [num(a, 'ScaleX', 1), num(a, 'ScaleY', 1), num(a, 'ScaleZ', 1)],
      rotation: [num(a, 'RotateX'), num(a, 'RotateY'), num(a, 'RotateZ')],
    });
  }
  return { models, meshes };
}

/** Converts a layout position into the mesh's own (OBJ file) coordinates. */
export function toMeshSpace(p: Vec3, mesh: LayoutMesh): Vec3 {
  if (mesh.rotation.some((r) => Math.abs(r) > 1e-6)) throw new Error(`Rotated meshes aren't supported (${mesh.name})`);
  return [
    (p[0] - mesh.position[0]) / mesh.scale[0],
    (p[1] - mesh.position[1]) / mesh.scale[1],
    (p[2] - mesh.position[2]) / mesh.scale[2],
  ];
}

export interface PlacedNode {
  name: string;
  channel: number;
  /** In the mesh's coordinates. */
  position: Vec3;
}

/**
 * The lamps of every one-channel model that sits on a mesh, in the mesh's
 * coordinates. `bounds` is the mesh's bounding box; models outside it (Tesla's
 * layout also has flat, off-car strips for the light bars) are skipped, as are
 * per-node strips, which have no position on the car.
 */
export function nodesOnMesh(layout: XlightsLayout, mesh: LayoutMesh, bounds: { min: Vec3; max: Vec3 }, margin = 0.1): PlacedNode[] {
  const pad = bounds.max.map((v, i) => (v - bounds.min[i]!) * margin);
  const inside = (p: Vec3) => p.every((v, i) => v >= bounds.min[i]! - pad[i]! && v <= bounds.max[i]! + pad[i]!);
  const out: PlacedNode[] = [];
  for (const m of layout.models) {
    if (m.layoutGroup === 'hidden' || (m.channelPerNode && m.nodes > 1)) continue;
    const lamps: PlacedNode[] = [];
    for (let i = 0; i < m.nodes; i++) {
      const t = (i + 0.5) / m.nodes;
      const world = m.position.map((v, k) => v + (m.end[k]! - v) * t) as Vec3;
      lamps.push({ name: m.name, channel: m.channel, position: toMeshSpace(world, mesh) });
    }
    if (lamps.every((l) => inside(l.position))) out.push(...lamps);
  }
  return out;
}

/**
 * For each point (x, y, z triples), the index of the nearest node within
 * `maxDistance`, or -1.
 */
export function nearestNodes(points: ArrayLike<number>, nodes: readonly PlacedNode[], maxDistance: number): Int32Array {
  const count = Math.floor(points.length / 3);
  const out = new Int32Array(count).fill(-1);
  const max2 = maxDistance * maxDistance;
  for (let i = 0; i < count; i++) {
    const x = points[i * 3]!;
    const y = points[i * 3 + 1]!;
    const z = points[i * 3 + 2]!;
    let best = max2;
    for (let n = 0; n < nodes.length; n++) {
      const p = nodes[n]!.position;
      const d = (p[0] - x) ** 2 + (p[1] - y) ** 2 + (p[2] - z) ** 2;
      if (d <= best) {
        best = d;
        out[i] = n;
      }
    }
  }
  return out;
}

/** Index (0-based) of the LED a point falls on, for a bar spanning `from`..`to` with `count` LEDs. */
export function pixelIndex(value: number, from: number, to: number, count: number): number {
  const t = (value - from) / (to - from);
  return Math.min(count - 1, Math.max(0, Math.floor(t * count)));
}
