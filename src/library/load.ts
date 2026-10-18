import { unzipSync } from 'fflate';
import { LIBRARY_BASE, type LibraryShow } from './catalog';

export interface LoadedFiles {
  fseq: Uint8Array;
  audio?: Blob;
}

export type ProgressFn = (fraction: number) => void;

export async function loadLibraryShow(show: LibraryShow, car: number, onProgress?: ProgressFn): Promise<LoadedFiles> {
  const { source } = show;
  if (source.kind === 'zip') {
    const zip = await fetchBytes(LIBRARY_BASE + encodePath(source.path), onProgress);
    return fromZip(zip);
  }
  const dir = `${source.folder}/Car #${car}/LightShow/`;
  const [fseq, audio] = await Promise.all([
    fetchBytes(LIBRARY_BASE + encodePath(dir + 'lightshow.fseq')),
    fetchBytes(LIBRARY_BASE + encodePath(dir + source.audioFile), onProgress),
  ]);
  return { fseq, audio: new Blob([audio as Uint8Array<ArrayBuffer>], { type: audioType(source.audioFile) }) };
}

/** Picks the .fseq and audio out of a zip, ignoring macOS metadata folders. */
export function fromZip(zip: Uint8Array): LoadedFiles {
  const files = unzipSync(zip, {
    filter: (f) => !f.name.includes('__MACOSX') && (/\.fseq$/i.test(f.name) || isAudioFile(f.name)),
  });
  let fseq: Uint8Array | undefined;
  let audio: Blob | undefined;
  for (const [name, bytes] of Object.entries(files)) {
    if (/\.fseq$/i.test(name)) fseq = bytes;
    else audio = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: audioType(name) });
  }
  if (!fseq) throw new Error('This zip has no .fseq light show file');
  return { fseq, ...(audio ? { audio } : {}) };
}

/** Audio formats browsers can decode; exports are always converted to 44.1 kHz WAV for the car. */
const AUDIO_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  webm: 'audio/webm',
};

/** For file pickers. */
export const AUDIO_ACCEPT = Object.keys(AUDIO_TYPES)
  .map((ext) => `.${ext}`)
  .join(',');

export function isAudioFile(name: string): boolean {
  return (name.split('.').pop()?.toLowerCase() ?? '') in AUDIO_TYPES;
}

export function audioType(name: string): string {
  return AUDIO_TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'audio/wav';
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function fetchBytes(url: string, onProgress?: ProgressFn): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body || !total || !onProgress) return new Uint8Array(await response.arrayBuffer());

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(1, received / total));
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
