// Runs the music analysis off the main thread, so the editor stays responsive.

import { analyze } from '../core/analysis';

self.onmessage = (e: MessageEvent<{ samples: Float32Array; sampleRate: number }>) => {
  try {
    self.postMessage({ ok: true, analysis: analyze(e.data.samples, e.data.sampleRate) });
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
