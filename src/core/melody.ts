// The lead line of a song (voice or lead instrument) as notes, so a show can
// tie lights to the melody: hold a light for as long as a note lasts, and
// place higher notes further out.
//
// A small predominant-melody tracker in the spirit of Melodia (Salamon and
// Gómez, 2012), without its refinements:
// 1. Spectrum every 23 ms, whitened so peaks stand out from the noise floor
//    and weighted toward the range where voices and leads sit.
// 2. Pitch salience by harmonic summation: each candidate pitch scores the
//    spectral peaks at its harmonics, weighted down for higher harmonics.
// 3. A smooth path through the most salient pitches (dynamic programming that
//    penalizes jumps), kept only where one pitch clearly stands out:
//    drums and noise score every pitch about the same.
// 4. Notes: runs of steady pitch, split where the pitch moves by more than a
//    semitone or where the same note is struck again.

import { fft, hann } from './fft';

export interface Note {
  startMs: number;
  endMs: number;
  /** MIDI note number (60 = middle C), fractional. */
  pitch: number;
  /** 0..1, relative to the song's clearest notes. */
  strength: number;
}

const RATE = 11025;
const WINDOW = 1024;
const FFT_SIZE = 2048;
const HOP = 256;
const MIN_MIDI = 48;
const MAX_MIDI = 86;
/** Candidates per semitone. */
const STEPS = 3;
const MAX_HZ = 5000;
const HARMONICS = 10;
const HARMONIC_WEIGHT = 0.84;
const MIN_NOTE_MS = 90;

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Notes of the lead line in mono samples at any rate. */
export function melody(input: Float32Array, inputRate: number): Note[] {
  const samples = resample(input, inputRate);
  const frames = Math.max(0, Math.floor((samples.length - WINDOW) / HOP) + 1);
  if (!frames) return [];
  const hopMs = (HOP / RATE) * 1000;
  const sal = salience(samples, frames);
  const path = track(sal, frames);
  return notes(sal, path, frames, hopMs);
}

/** Averages down to about 11 kHz, peak-normalized. */
function resample(input: Float32Array, rate: number): Float32Array {
  const factor = Math.max(1, Math.round(rate / RATE));
  const out = new Float32Array(Math.floor(input.length / factor));
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let j = 0; j < factor; j++) sum += input[i * factor + j]!;
    out[i] = sum / factor;
    peak = Math.max(peak, Math.abs(out[i]!));
  }
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i]! /= peak;
  return out;
}

const CANDIDATES = (MAX_MIDI - MIN_MIDI) * STEPS + 1;
const candidateMidi = (c: number) => MIN_MIDI + c / STEPS;

/** Salience per frame and candidate pitch (frame-major). */
function salience(samples: Float32Array, frames: number): Float32Array {
  const window = hann(WINDOW);
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const binHz = RATE / FFT_SIZE;
  const maxBin = Math.min(FFT_SIZE / 2 - 2, Math.ceil(MAX_HZ / binHz));
  const mag = new Float32Array(maxBin + 2);
  const white = new Float32Array(maxBin + 2);
  // Voices and leads: little below 150 Hz (bass, kick), full from 250 Hz.
  const weight = Float32Array.from({ length: maxBin + 2 }, (_, k) => {
    const f = k * binHz;
    return f < 120 ? 0 : f < 250 ? (f - 120) / 130 : f > 3500 ? Math.max(0.3, 1 - (f - 3500) / 3000) : 1;
  });
  // Harmonic bins per candidate.
  const harmonics: { bin: number; w: number }[][] = [];
  for (let c = 0; c < CANDIDATES; c++) {
    const f0 = hz(candidateMidi(c));
    const list: { bin: number; w: number }[] = [];
    for (let h = 1; h <= HARMONICS && h * f0 < MAX_HZ; h++) list.push({ bin: (h * f0) / binHz, w: HARMONIC_WEIGHT ** (h - 1) });
    harmonics.push(list);
  }
  const out = new Float32Array(frames * CANDIDATES);
  const radius = Math.round(100 / binHz);
  for (let t = 0; t < frames; t++) {
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < WINDOW; i++) re[i] = samples[t * HOP + i]! * window[i]!;
    fft(re, im);
    for (let k = 0; k <= maxBin + 1; k++) mag[k] = Math.sqrt(Math.hypot(re[k]!, im[k]!));
    // Whiten: what rises above the local average, so peaks count and the noise floor doesn't.
    let sum = 0;
    let lo = 0;
    let hi = -1;
    for (let k = 0; k <= maxBin + 1; k++) {
      while (hi < Math.min(maxBin + 1, k + radius)) sum += mag[++hi]!;
      while (lo < k - radius) sum -= mag[lo++]!;
      white[k] = Math.max(0, mag[k]! - (sum / (hi - lo + 1)) * 1.2) * weight[k]!;
    }
    const row = t * CANDIDATES;
    for (let c = 0; c < CANDIDATES; c++) {
      let s = 0;
      for (const { bin, w } of harmonics[c]!) {
        const b = Math.round(bin);
        s += w * Math.max(white[b - 1]!, white[b]!, white[b + 1]!);
      }
      out[row + c] = s;
    }
  }
  return out;
}

/** The most salient smooth pitch path: a candidate index per frame. */
function track(sal: Float32Array, frames: number): Int16Array {
  const span = 7 * STEPS; // Steps within a fifth are cheap; bigger leaps cost a fixed penalty.
  const stepCost = 0.04;
  const leapCost = 1.2;
  let prev = new Float32Array(CANDIDATES);
  let cur = new Float32Array(CANDIDATES);
  const back = new Int16Array(frames * CANDIDATES);
  for (let t = 0; t < frames; t++) {
    const row = t * CANDIDATES;
    let prevBest = -Infinity;
    let prevArg = 0;
    if (t > 0) for (let c = 0; c < CANDIDATES; c++) if (prev[c]! > prevBest) [prevBest, prevArg] = [prev[c]!, c];
    let frameMax = 0;
    for (let c = 0; c < CANDIDATES; c++) frameMax = Math.max(frameMax, sal[row + c]!);
    for (let c = 0; c < CANDIDATES; c++) {
      const local = Math.log(1e-3 + sal[row + c]! / (frameMax || 1));
      if (t === 0) {
        cur[c] = local;
        continue;
      }
      let best = prevBest - leapCost;
      let arg = prevArg;
      for (let d = Math.max(0, c - span); d <= Math.min(CANDIDATES - 1, c + span); d++) {
        const v = prev[d]! - stepCost * Math.abs(c - d);
        if (v > best) [best, arg] = [v, d];
      }
      cur[c] = local + best;
      back[row + c] = arg;
    }
    // Keep the numbers small; only differences matter.
    const top = Math.max(...cur);
    for (let c = 0; c < CANDIDATES; c++) cur[c]! -= top;
    [prev, cur] = [cur, prev];
  }
  const path = new Int16Array(frames);
  let c = 0;
  for (let k = 1; k < CANDIDATES; k++) if (prev[k]! > prev[c]!) c = k;
  for (let t = frames - 1; t >= 0; t--) {
    path[t] = c;
    c = back[t * CANDIDATES + c]!;
  }
  return path;
}

function notes(sal: Float32Array, path: Int16Array, frames: number, hopMs: number): Note[] {
  const level = new Float32Array(frames);
  const voiced = new Uint8Array(frames);
  const sorted: number[] = [];
  for (let t = 0; t < frames; t++) {
    const row = t * CANDIDATES;
    level[t] = sal[row + path[t]!]!;
    sorted.push(level[t]!);
  }
  sorted.sort((a, b) => a - b);
  const top = sorted[Math.floor(sorted.length * 0.95)] || 1;
  for (let t = 0; t < frames; t++) {
    const row = t * CANDIDATES;
    // A clear pitch stands well above the frame's typical candidate; drums and noise don't.
    let mean = 0;
    for (let c = 0; c < CANDIDATES; c++) mean += sal[row + c]!;
    mean /= CANDIDATES;
    voiced[t] = level[t]! > 0.12 * top && level[t]! > 4 * mean ? 1 : 0;
  }

  const frameMs = (t: number) => ((t * HOP + WINDOW / 2) / RATE) * 1000;
  const out: Note[] = [];
  let start = -1;
  let pitches: number[] = [];
  let levels: number[] = [];
  const close = (end: number) => {
    if (start >= 0 && (end - start) * hopMs >= MIN_NOTE_MS) {
      const p = [...pitches].sort((a, b) => a - b)[Math.floor(pitches.length / 2)]!;
      const strength = Math.min(1, levels.reduce((a, b) => a + b, 0) / levels.length / top);
      out.push({ startMs: frameMs(start) - hopMs / 2, endMs: frameMs(end) - hopMs / 2, pitch: p, strength });
    }
    start = -1;
    pitches = [];
    levels = [];
  };
  for (let t = 0; t < frames; t++) {
    if (!voiced[t]) {
      // One unvoiced frame doesn't end a note.
      if (start >= 0 && !voiced[t + 1]) close(t);
      continue;
    }
    const p = candidateMidi(path[t]!);
    if (start >= 0) {
      const ref = pitches.slice(0, 4).reduce((a, b) => a + b, 0) / Math.min(4, pitches.length);
      const moved = Math.abs(p - ref) > 0.8;
      // The same note struck again: the level dips, then jumps.
      const restruck = t - start >= 4 && level[t]! > 1.8 * Math.min(level[t - 1]!, level[t - 2]!);
      if (moved || restruck) close(t);
    }
    if (start < 0) start = t;
    pitches.push(p);
    levels.push(level[t]!);
  }
  close(frames);
  return out;
}
