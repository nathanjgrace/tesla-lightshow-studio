// Tesla's own 3D models of the Model S and Cybertruck, from its xLights project
// (xlights/tesla_xlights_show_folder.zip in teslamotors/light-show). Like the
// example shows, they're fetched from Tesla's repo at a pinned commit rather
// than re-hosted, and kept in the browser's cache after the first download.

import { unzipSync } from 'fflate';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { parseXlightsLayout, type LayoutMesh, type XlightsLayout } from '../../core/xlightsLayout';
import { TESLA_REPO_BASE, TESLA_REPO_COMMIT } from '../../library/catalog';
import { fetchBytes, type ProgressFn } from '../../library/load';
import type { BodyStyle } from '../../core/vehicles';
import { usesModelS } from './derive';

export type TeslaMeshModel = 'modelS' | 'cybertruck';

/** What each material in Tesla's OBJ files is, from its .mtl (which texture it uses). */
export type MaterialRole = 'paint' | 'trim' | 'black' | 'glass' | 'lens' | 'redLens' | 'wheel' | 'tire';

interface Source {
  folder: string;
  obj: string;
  roles: Record<string, MaterialRole>;
  /** Texture per material, from the .mtl's map_Kd. */
  maps: Record<string, string>;
}

const SOURCES: Record<TeslaMeshModel, Source> = {
  modelS: {
    folder: 'Model_S',
    obj: 'ModelS.obj',
    roles: {
      BodySG: 'paint',
      BodySG1: 'paint',
      BodySG2: 'trim',
      BodySG3: 'black',
      BodySG4: 'redLens',
      LightsSG: 'lens',
      Windows_TopSG: 'glass',
      Arachnid21_Wheel_LFSG: 'wheel',
      Arachnid21_Wheel_LFSG1: 'tire',
    },
    maps: {
      BodySG: 'Exterior_AO.png',
      BodySG1: 'Exterior_AO.png',
      BodySG2: 'Exterior_AO_Dark.png',
      BodySG4: 'Lights_Red_AO.png',
      LightsSG: 'Lights_AO.png',
      Arachnid21_Wheel_LFSG: 'Arachnid_Wheel_AO.png',
    },
  },
  cybertruck: {
    folder: 'Cybertruck',
    obj: 'Cybertruck.obj',
    roles: {
      blinn3SG: 'paint',
      lambert2SG: 'trim',
      lambert3SG: 'black',
      blinn5SG: 'lens',
      blinn6SG: 'redLens',
      phong1SG: 'glass',
      blinn4SG: 'wheel',
      lambert4SG: 'wheel',
    },
    maps: {
      blinn3SG: 'Paint_Red_AO.png',
      lambert2SG: 'Exterior_AO_Dark.png',
      blinn5SG: 'Lights_AO.png',
      blinn6SG: 'Lights_AO_Red.png',
      blinn4SG: 'Cybertruck_Premium_Wheel_AO_Dark.png',
      lambert4SG: 'Cybertruck_Premium_Wheel_AO_Dark.png',
    },
  },
};

export interface TeslaAsset {
  model: TeslaMeshModel;
  /** The OBJ's meshes, one per group (Body, Lights, Door_LF, ...), in the file's units. */
  meshes: THREE.Mesh[];
  roles: Record<string, MaterialRole>;
  textures: Map<string, THREE.Texture>;
  /** For paint textures: 1 / the brightest paint value, so the bake reads as ambient occlusion. */
  paintScale: number;
  layout: XlightsLayout;
  layoutMesh: LayoutMesh;
}

const ROOT = 'tesla_xlights_show_folder/';
const ZIP_URL = `${TESLA_REPO_BASE}xlights/tesla_xlights_show_folder.zip`;
const CACHE = `tesla-xlights-${TESLA_REPO_COMMIT.slice(0, 8)}`;

/**
 * Which of Tesla's models a vehicle is built from: its own, or the Model S
 * reshaped (see derive.ts).
 */
export function teslaMeshFor(style: BodyStyle): TeslaMeshModel | undefined {
  if (style.model === 'cybertruck') return 'cybertruck';
  return usesModelS(style) ? 'modelS' : undefined;
}

let zip: Promise<Uint8Array> | undefined;
const loaded = new Map<TeslaMeshModel, Promise<TeslaAsset>>();

/** Downloads (once) and prepares Tesla's model for a vehicle. */
export function loadTeslaAsset(model: TeslaMeshModel, onProgress?: ProgressFn): Promise<TeslaAsset> {
  let p = loaded.get(model);
  if (!p) {
    p = build(model, onProgress);
    loaded.set(model, p);
    p.catch(() => loaded.delete(model));
  }
  return p;
}

async function build(model: TeslaMeshModel, onProgress?: ProgressFn): Promise<TeslaAsset> {
  const src = SOURCES[model];
  zip ??= cachedZip(onProgress);
  zip.catch(() => (zip = undefined));
  const bytes = await zip;
  const prefix = `${ROOT}${src.folder}/`;
  const files = unzipSync(bytes, { filter: (f) => f.name.startsWith(prefix) || f.name === `${ROOT}xlights_rgbeffects.xml` });
  const file = (name: string) => {
    const f = files[name];
    if (!f) throw new Error(`Tesla's 3D model is missing ${name}`);
    return f;
  };
  const text = (name: string) => new TextDecoder().decode(file(name));

  const layout = parseXlightsLayout(text(`${ROOT}xlights_rgbeffects.xml`));
  const layoutMesh = layout.meshes.find((m) => m.objFile === src.obj);
  if (!layoutMesh) throw new Error(`Tesla's layout doesn't place ${src.obj}`);

  const group = new OBJLoader().parse(text(prefix + src.obj));
  const meshes = group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);

  const textures = new Map<string, THREE.Texture>();
  let paintScale = 1;
  await Promise.all(
    [...new Set(Object.values(src.maps))].map(async (name) => {
      const blob = new Blob([file(prefix + name) as Uint8Array<ArrayBuffer>], { type: 'image/png' });
      const image = await createImageBitmap(blob, { imageOrientation: 'flipY' });
      const texture = new THREE.Texture(image);
      // createImageBitmap already flipped it to match the OBJ's UVs.
      texture.flipY = false;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      // Tesla's UVs use whole-tile offsets (some run -1..0 or 1..2).
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.needsUpdate = true;
      textures.set(name, texture);
      if (src.maps[paintMaterial(src)] === name) paintScale = 1 / brightestPaint(image);
    }),
  );
  return { model, meshes, roles: src.roles, textures, paintScale, layout, layoutMesh };
}

function paintMaterial(src: Source): string {
  return Object.keys(src.roles).find((k) => src.roles[k] === 'paint')!;
}

/**
 * Tesla baked the body texture as red paint with ambient occlusion. Well-lit
 * paint (90th percentile red, linear) becomes the full paint color.
 */
function brightestPaint(image: ImageBitmap): number {
  const size = 128;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  const reds: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    if (r > 40 && r > Math.max(data[i + 1]!, data[i + 2]!) * 1.5) reds.push(r);
  }
  if (!reds.length) return 1;
  reds.sort((a, b) => a - b);
  const srgb = reds[Math.floor(reds.length * 0.9)]! / 255;
  return Math.max(0.05, new THREE.Color().setRGB(srgb, 0, 0, THREE.SRGBColorSpace).r);
}

async function cachedZip(onProgress?: ProgressFn): Promise<Uint8Array> {
  const cache = typeof caches === 'undefined' ? undefined : await caches.open(CACHE).catch(() => undefined);
  const hit = await cache?.match(ZIP_URL);
  if (hit) {
    onProgress?.(1);
    return new Uint8Array(await hit.arrayBuffer());
  }
  const bytes = await fetchBytes(ZIP_URL, onProgress);
  void cache?.put(ZIP_URL, new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { 'content-type': 'application/zip' } })).catch(() => {});
  return bytes;
}
