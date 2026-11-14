// Community-made 3D models (Creative Commons), rigged for the app by
// scripts/models and served from public/models. Each file carries how its
// moving parts move, which meshes are which lamps, and who made it.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { fetchBytes, type ProgressFn } from '../../library/load';

export interface ModelCredit {
  title: string;
  author: string;
  authorUrl: string;
  url: string;
  license: string;
  licenseUrl: string;
}

/** How a moving part moves as it goes from closed (0) to open (1). */
export type PartRig = (
  | { type: 'hinge'; pivot: [number, number, number]; axis: [number, number, number]; deg: number }
  | { type: 'slide'; pivot?: [number, number, number]; vector: [number, number, number] }
) & {
  /** A part this one rides on (a window in a door). */
  parent?: string;
  /** Rest position is "open" (mirrors start unfolded). */
  invert?: boolean;
};

export interface GlbAsset {
  kind: 'glb';
  file: string;
  scene: THREE.Group;
  parts: Record<string, PartRig>;
  /** Where the head and fog beams start, on the right side. */
  beams?: { head?: [number, number, number]; fog?: [number, number, number] };
  cabin?: [number, number, number];
  credit: ModelCredit;
}

/** Which model file each vehicle uses. Vehicles not listed use Tesla's own models. */
const FILES: Record<string, string> = {
  'model3-2017': 'model3-2017',
  'model3-2020': 'model3-2017',
  'model3-2024': 'model3-2024',
  'model3-2026-standard': 'model3-2024',
  'modelX-2021': 'modelX-2021',
  'modelX-2025': 'modelX-2021',
  'modelY-2020': 'modelY-2020',
  'modelY-2025': 'modelY-2025',
  'modelY-2026-standard': 'modelY-2025',
};

export function glbFileFor(vehicleId: string): string | undefined {
  return FILES[vehicleId];
}

const loaded = new Map<string, Promise<GlbAsset>>();

/** Downloads (once) and parses a model file. */
export function loadGlbAsset(file: string, onProgress?: ProgressFn): Promise<GlbAsset> {
  let p = loaded.get(file);
  if (!p) {
    p = load(file, onProgress);
    loaded.set(file, p);
    p.catch(() => loaded.delete(file));
  }
  return p;
}

async function load(file: string, onProgress?: ProgressFn): Promise<GlbAsset> {
  const bytes = await fetchBytes(`${import.meta.env.BASE_URL}models/${file}.glb`, onProgress);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const extras = scene.userData as Partial<Pick<GlbAsset, 'parts' | 'beams' | 'cabin' | 'credit'>>;
  return {
    kind: 'glb',
    file,
    scene,
    parts: extras.parts ?? {},
    ...(extras.beams ? { beams: extras.beams } : {}),
    ...(extras.cabin ? { cabin: extras.cabin } : {}),
    credit: extras.credit!,
  };
}
