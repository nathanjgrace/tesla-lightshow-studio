// Helpers for building small shows in tests.

import { CHANNEL_COUNT, channel } from './channels';
import type { FseqFile } from './fseq';

export function blankShow(seconds: number, stepTimeMs = 20): FseqFile {
  const frameCount = Math.round((seconds * 1000) / stepTimeMs);
  return {
    channelCount: CHANNEL_COUNT,
    frameCount,
    stepTimeMs,
    minorVersion: 0,
    uniqueId: 0n,
    variableHeaders: [],
    data: new Uint8Array(frameCount * CHANNEL_COUNT),
  };
}

/** Sets a channel to `value` from fromSec up to (not including) toSec. */
export function fill(show: FseqFile, channelId: string, fromSec: number, toSec: number, value: number): void {
  const { index } = channel(channelId);
  const from = Math.round((fromSec * 1000) / show.stepTimeMs);
  const to = Math.min(show.frameCount, Math.round((toSec * 1000) / show.stepTimeMs));
  for (let f = from; f < to; f++) show.data[f * show.channelCount + index] = value;
}

/** Reads a 16-bit PCM WAV as mono samples, for tests on real songs. */
export function readWavMono(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  for (let o = 12; o + 8 <= bytes.length; ) {
    const id = String.fromCharCode(...bytes.subarray(o, o + 4));
    const size = view.getUint32(o + 4, true);
    if (id === 'fmt ') {
      channels = view.getUint16(o + 10, true);
      sampleRate = view.getUint32(o + 12, true);
      bits = view.getUint16(o + 22, true);
    } else if (id === 'data') {
      if (bits !== 16) throw new Error(`Only 16-bit WAV is supported, not ${bits}-bit`);
      const frames = Math.floor(Math.min(size, bytes.length - o - 8) / (2 * channels));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) sum += view.getInt16(o + 8 + (i * channels + c) * 2, true);
        samples[i] = sum / channels / 32768;
      }
      return { samples, sampleRate };
    }
    o += 8 + size + (size & 1);
  }
  throw new Error('No audio data in WAV');
}
