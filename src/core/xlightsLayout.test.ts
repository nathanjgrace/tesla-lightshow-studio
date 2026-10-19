import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHANNELS_BY_INDEX } from './channels';
import { nearestNodes, nodesOnMesh, parseXlightsLayout, pixelIndex, toMeshSpace, type LayoutMesh } from './xlightsLayout';

const SAMPLE = `<?xml version="1.0"?>
<xrgb><models>
<model DisplayAs="Single Line" parm1="1" parm2="1" StringType="Single Color White" name="Left Outer Main Beam" LayoutGroup="Default" WorldPosX="429.8" WorldPosY="130.8" WorldPosZ="-147.7" X2="10" StartChannel="!Model S:1">
</model>
<model DisplayAs="Single Line" parm2="30" StringType="Node Single Color" name="Left Front Light Bar" LayoutGroup="hidden" WorldPosX="-57.3" WorldPosY="217" WorldPosZ="61.7" StartChannel="!Model S:47"/>
<model DisplayAs="Custom" parm1="10" parm2="15" name="Left Tail" LayoutGroup="Default" WorldPosX="-439.7" WorldPosY="160.6" WorldPosZ="-145.2" StartChannel="!Model S:26"/>
<model DisplayAs="Single Line" parm2="2" StringType="Single Color White" name="Reverse Lights" LayoutGroup="Default" WorldPosX="-455" WorldPosY="172" WorldPosZ="-100" Z2="200" StartChannel="!Model S:28"/>
<model DisplayAs="Single Line" parm2="1" name="CT Brake Light" LayoutGroup="Default" WorldPosX="-560" WorldPosY="252.7" WorldPosZ="-1000" StartChannel="!Model S:25"/>
<model DisplayAs="Single Line" name="No channel" WorldPosX="0" WorldPosY="0" WorldPosZ="0"/>
</models>
<view_objects>
<view_object DisplayAs="Mesh" name="Cybertruck" ObjFile="C:\\Users\\Someone\\Cybertruck\\Cybertruck.obj" WorldPosX="0" WorldPosY="0" WorldPosZ="-1000" ScaleX="2" ScaleY="2" ScaleZ="2" RotateX="0" RotateY="0" RotateZ="0"/>
<view_object DisplayAs="Mesh" name="Tesla Model S" ObjFile="C:\\x\\Model_S\\ModelS.obj" WorldPosX="0" WorldPosY="0" WorldPosZ="0" ScaleX="1" ScaleY="1" ScaleZ="1"/>
<view_object DisplayAs="Gridlines" name="Grid"/>
</view_objects></xrgb>`;

describe('parseXlightsLayout', () => {
  const layout = parseXlightsLayout(SAMPLE);

  it('reads models with their first channel, node count and position', () => {
    expect(layout.models.map((m) => [m.name, m.channel, m.nodes])).toEqual([
      ['Left Outer Main Beam', 1, 1],
      ['Left Front Light Bar', 47, 30],
      ['Left Tail', 26, 1],
      ['Reverse Lights', 28, 2],
      ['CT Brake Light', 25, 1],
    ]);
    expect(layout.models[0]!.position).toEqual([429.8, 130.8, -147.7]);
  });

  it('reads meshes, keeping only the OBJ file name', () => {
    expect(layout.meshes.map((m) => [m.name, m.objFile])).toEqual([
      ['Cybertruck', 'Cybertruck.obj'],
      ['Tesla Model S', 'ModelS.obj'],
    ]);
    expect(layout.meshes[0]!.scale).toEqual([2, 2, 2]);
  });

  it('maps layout positions into mesh coordinates', () => {
    const ct = layout.meshes[0]!;
    expect(toMeshSpace([-560, 252.7, -1000], ct)).toEqual([-280, 126.35, 0]);
  });

  it('refuses rotated meshes rather than misplacing lights', () => {
    const rotated: LayoutMesh = { ...layout.meshes[0]!, rotation: [0, 90, 0] };
    expect(() => toMeshSpace([0, 0, 0], rotated)).toThrow(/Rotated/);
  });

  it('keeps single-node models that sit on the mesh', () => {
    const ct = layout.meshes[0]!;
    const nodes = nodesOnMesh(layout, ct, { min: [-284, 0, -122], max: [284, 180, 122] });
    expect(nodes.map((n) => n.name)).toEqual(['CT Brake Light']);
    const s = layout.meshes[1]!;
    const sNodes = nodesOnMesh(layout, s, { min: [-491, -2, -219], max: [513, 287, 219] });
    // The hidden 30-node light bar strip and the Cybertruck's lights are left
    // out; the two reverse lamps share one channel.
    expect(sNodes.map((n) => [n.name, n.channel])).toEqual([
      ['Left Outer Main Beam', 1],
      ['Left Tail', 26],
      ['Reverse Lights', 28],
      ['Reverse Lights', 28],
    ]);
    // Lamps sit along the model's line: a single node in its middle, two at the quarter points.
    expect(sNodes[0]!.position).toEqual([434.8, 130.8, -147.7]);
    expect(sNodes.slice(2).map((n) => n.position[2])).toEqual([-50, 50]);
  });
});

describe('nearestNodes', () => {
  const nodes = [
    { name: 'a', channel: 1, position: [0, 0, 0] as [number, number, number] },
    { name: 'b', channel: 2, position: [10, 0, 0] as [number, number, number] },
  ];

  it('picks the closest node within range, else -1', () => {
    expect(Array.from(nearestNodes([1, 0, 0, 8, 1, 0, 50, 0, 0], nodes, 5))).toEqual([0, 1, -1]);
  });
});

describe('pixelIndex', () => {
  it('splits a span into equal LEDs and clamps the ends', () => {
    expect(pixelIndex(-1, -1, 1, 60)).toBe(0);
    expect(pixelIndex(0.999, -1, 1, 60)).toBe(59);
    expect(pixelIndex(1, -1, 1, 60)).toBe(59);
    expect(pixelIndex(0, -1, 1, 4)).toBe(2);
    expect(pixelIndex(-5, -1, 1, 4)).toBe(0);
  });
});

describe("Tesla's layout", () => {
  const path = 'fixtures/xlights_rgbeffects.xml';
  it.skipIf(!existsSync(path))('places every Model S light channel on the Model S mesh (run `npm run fixtures` first)', () => {
    const layout = parseXlightsLayout(readFileSync(path, 'utf8'));
    const s = layout.meshes.find((m) => m.objFile === 'ModelS.obj')!;
    const ct = layout.meshes.find((m) => m.objFile === 'Cybertruck.obj')!;
    expect(s.scale).toEqual([1, 1, 1]);
    expect(ct.scale).toEqual([2, 2, 2]);
    const sNodes = nodesOnMesh(layout, s, { min: [-491, -2, -219], max: [513, 287, 219] });
    const lightIds = (nodes: typeof sNodes) =>
      new Set(
        nodes
          .map((n) => CHANNELS_BY_INDEX.get(n.channel - 1))
          .filter((c) => c && (c.kind === 'ramping' || c.kind === 'boolean'))
          .map((c) => c!.id),
      );
    const sLights = lightIds(sNodes);
    for (const id of ['leftOuterMainBeam', 'rightSignature', 'leftChannel4', 'leftFrontTurn', 'leftTail', 'brakeLights', 'licensePlate']) {
      expect(sLights.has(id), id).toBe(true);
    }
    // Every node has a real channel.
    for (const n of sNodes) expect(CHANNELS_BY_INDEX.has(n.channel - 1), n.name).toBe(true);

    const ctNodes = nodesOnMesh(layout, ct, { min: [-284, 0, -122], max: [284, 180, 122] });
    // Only the Cybertruck's own lights, none of the Model S ones.
    expect(ctNodes.some((n) => n.name === 'CT Left Outer Main Beam')).toBe(true);
    expect(ctNodes.some((n) => n.name === 'Left Outer Main Beam')).toBe(false);
    expect(lightIds(ctNodes).has('brakeLights')).toBe(true);
  });
});
