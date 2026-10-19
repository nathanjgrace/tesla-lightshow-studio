// Analyzes a show's song in a Web Worker, once per audio file.

import type { Analysis } from '../core/analysis';
import { monoSamples } from './audio';

const cache = new WeakMap<Blob, Promise<Analysis>>();

export function analyzeSong(audio: Blob): Promise<Analysis> {
  let p = cache.get(audio);
  if (!p) {
    p = run(audio);
    cache.set(audio, p);
    p.catch(() => cache.delete(audio));
  }
  return p;
}

async function run(audio: Blob): Promise<Analysis> {
  const { samples, sampleRate } = await monoSamples(audio);
  const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise<Analysis>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<{ ok: true; analysis: Analysis } | { ok: false; error: string }>) =>
        e.data.ok ? resolve(e.data.analysis) : reject(new Error(e.data.error));
      worker.onerror = (e) => reject(new Error(e.message || 'Music analysis failed'));
      worker.postMessage({ samples, sampleRate }, [samples.buffer]);
    });
  } finally {
    worker.terminate();
  }
}
