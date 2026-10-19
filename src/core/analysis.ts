// Music analysis for auto-generated shows: tempo and beats, bar starts,
// drum-like hits by frequency band, the melody's notes (melody.ts), a
// loudness curve, and sections (intro, verse, build, chorus, drop, break,
// outro).
//
// Methods are standard and small enough to read: spectral-flux onsets,
// tempo by autocorrelation with a preference for ~120 BPM, and dynamic-
// programming beat tracking (D. Ellis, "Beat Tracking by Dynamic
// Programming", 2007). Bars assume 4/4, which covers almost all pop and EDM.

import { fft, hann } from './fft';
import { melody, type Note } from './melody';

export type { Note };

export type Band = 'low' | 'mid' | 'high';

/** A hit: kick-like (low), snare/clap-like (mid) or hi-hat-like (high). */
export interface Onset {
  timeMs: number;
  /** 0..1, relative to the song's strongest hits in that band. */
  strength: number;
  band: Band;
}

export type SectionKind = 'intro' | 'verse' | 'build' | 'chorus' | 'drop' | 'break' | 'outro';

export interface Section {
  startMs: number;
  endMs: number;
  kind: SectionKind;
  /** Average loudness, 0..1. */
  energy: number;
}

export interface Analysis {
  durationMs: number;
  bpm: number;
  /** Beat times, ms. */
  beats: number[];
  /** Bar starts (every fourth beat), ms. */
  downbeats: number[];
  onsets: Onset[];
  /** The lead line (voice or lead instrument), note by note. */
  notes: Note[];
  /** Loudness, 0..1, one value per `hopMs`. */
  energy: { hopMs: number; values: number[] };
  sections: Section[];
}

const TARGET_RATE = 22050;
const FRAME = 1024;
const HOP = 256;
const BANDS: Record<Band, [number, number]> = { low: [30, 150], mid: [150, 2500], high: [4000, 11000] };
const MIN_BPM = 60;
const MAX_BPM = 190;

/** Analyzes mono samples. Takes a few seconds for a four-minute song. */
export function analyze(input: Float32Array, inputRate: number): Analysis {
  const { samples, rate } = downsample(input, inputRate);
  const durationMs = (input.length / inputRate) * 1000;
  const frames = Math.max(1, Math.floor((samples.length - FRAME) / HOP) + 1);
  const hopMs = (HOP / rate) * 1000;
  /** Time of a frame's center, ms. */
  const frameMs = (t: number) => ((t * HOP + FRAME / 2) / rate) * 1000;

  const features = spectralFeatures(samples, rate, frames);
  const envelope = normalizedEnvelope(features.flux, Math.round(400 / hopMs));
  const period = tempoPeriod(envelope, hopMs);
  const loud = features.loudness;
  const beatFrames = trimQuiet(trackBeats(envelope, period), loud);
  const beats = beatFrames.map(frameMs);
  const downbeats = barStarts(beatFrames, features.lowPower).map(frameMs);
  const energy = loudnessCurve(loud, Math.round(1000 / hopMs));
  const onsets = bandOnsets(features.bandFlux, features.lowPower, hopMs).map(([t, strength, band]) => ({ timeMs: frameMs(t), strength, band }));
  onsets.sort((a, b) => a.timeMs - b.timeMs);
  const sections = findSections(energy, hopMs, downbeats, durationMs);
  return {
    durationMs,
    bpm: beats.length > 1 ? 60000 / (period * hopMs) : 0,
    beats,
    downbeats,
    onsets,
    notes: melody(input, inputRate),
    energy: { hopMs, values: Array.from(energy) },
    sections,
  };
}

/** Averages groups of samples down to about 22 kHz and peak-normalizes. */
function downsample(input: Float32Array, rate: number): { samples: Float32Array; rate: number } {
  const factor = Math.max(1, Math.floor(rate / TARGET_RATE + 1e-6));
  const out = new Float32Array(Math.max(FRAME, Math.floor(input.length / factor)));
  let peak = 0;
  for (let i = 0; i * factor + factor <= input.length; i++) {
    let sum = 0;
    for (let j = 0; j < factor; j++) sum += input[i * factor + j]!;
    out[i] = sum / factor;
    peak = Math.max(peak, Math.abs(out[i]!));
  }
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i]! /= peak;
  return { samples: out, rate: rate / factor };
}

interface Features {
  /** Spectral flux over the whole useful range, per frame. */
  flux: Float32Array;
  bandFlux: Record<Band, Float32Array>;
  /** Power below 150 Hz, linear. */
  lowPower: Float32Array;
  /** Frame loudness in dB (RMS). */
  loudness: Float32Array;
}

function spectralFeatures(samples: Float32Array, rate: number, frames: number): Features {
  const window = hann(FRAME);
  const re = new Float32Array(FRAME);
  const im = new Float32Array(FRAME);
  const bins = FRAME / 2;
  const binHz = rate / FRAME;
  const range = (lo: number, hi: number) => [Math.max(1, Math.floor(lo / binHz)), Math.min(bins - 1, Math.ceil(hi / binHz))] as const;
  const all = range(30, 11000);
  const bandRanges = Object.fromEntries((Object.keys(BANDS) as Band[]).map((b) => [b, range(...BANDS[b])])) as Record<Band, readonly [number, number]>;
  let prev = new Float32Array(bins);
  let cur = new Float32Array(bins);
  const flux = new Float32Array(frames);
  const bandFlux = { low: new Float32Array(frames), mid: new Float32Array(frames), high: new Float32Array(frames) };
  const loudness = new Float32Array(frames);
  const lowPower = new Float32Array(frames);
  for (let t = 0; t < frames; t++) {
    const offset = t * HOP;
    let energy = 0;
    for (let i = 0; i < FRAME; i++) {
      const v = samples[offset + i] ?? 0;
      energy += v * v;
      re[i] = v * window[i]!;
      im[i] = 0;
    }
    loudness[t] = 10 * Math.log10(energy / FRAME + 1e-10);
    fft(re, im);
    for (let k = 0; k < bins; k++) cur[k] = Math.log1p(100 * Math.hypot(re[k]!, im[k]!));
    for (let k = bandRanges.low[0]; k <= bandRanges.low[1]; k++) lowPower[t]! += re[k]! * re[k]! + im[k]! * im[k]!;
    if (t > 0) {
      let f = 0;
      for (let k = all[0]; k <= all[1]; k++) f += Math.max(0, cur[k]! - prev[k]!);
      flux[t] = f;
      for (const band of Object.keys(bandRanges) as Band[]) {
        const [lo, hi] = bandRanges[band];
        let b = 0;
        for (let k = lo; k <= hi; k++) b += Math.max(0, cur[k]! - prev[k]!);
        bandFlux[band][t] = b / (hi - lo + 1);
      }
    }
    [prev, cur] = [cur, prev];
  }
  return { flux, bandFlux, lowPower, loudness };
}

function movingMean(x: ArrayLike<number>, radius: number): Float32Array {
  const out = new Float32Array(x.length);
  let sum = 0;
  let count = 0;
  let lo = 0;
  let hi = -1;
  for (let i = 0; i < x.length; i++) {
    const want = Math.min(x.length - 1, i + radius);
    while (hi < want) sum += x[++hi]!, count++;
    while (lo < i - radius) sum -= x[lo++]!, count--;
    out[i] = sum / count;
  }
  return out;
}

/** The onset strength envelope: flux above its local mean, scaled to unit variance. */
function normalizedEnvelope(flux: Float32Array, radius: number): Float32Array {
  const mean = movingMean(flux, radius);
  const out = new Float32Array(flux.length);
  let sq = 0;
  for (let i = 0; i < flux.length; i++) {
    out[i] = Math.max(0, flux[i]! - mean[i]!);
    sq += out[i]! * out[i]!;
  }
  const std = Math.sqrt(sq / flux.length) || 1;
  for (let i = 0; i < out.length; i++) out[i]! /= std;
  return out;
}

/** Listeners' preference for tempos near 120 BPM: a log-normal weight one octave wide. */
const tempoPrior = (bpm: number) => Math.exp(-0.5 * Math.log2(bpm / 120) ** 2);

/**
 * The beat period in frames (fractional). The envelope's autocorrelation
 * (weighted toward 120 BPM) gives a first guess, but rhythms like a bossa's
 * dotted pattern can make 4/3 of the tempo look as good. So the guess and its
 * relatives (x2, x1/2, x4/3, x3/4) are each beat-tracked, and the one whose
 * beats land on the strongest onsets wins.
 */
function tempoPeriod(env: Float32Array, hopMs: number): number {
  const minLag = Math.floor(60000 / MAX_BPM / hopMs);
  const maxLag = Math.ceil(60000 / MIN_BPM / hopMs);
  const scores = new Float32Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let r = 0;
    for (let t = 0; t + lag < env.length; t++) r += env[t]! * env[t + lag]!;
    r /= env.length - lag || 1;
    scores[lag] = r * tempoPrior(60000 / (lag * hopMs));
  }
  let best = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) if (scores[lag]! > scores[best]!) best = lag;
  // Parabolic refinement between neighboring lags.
  const [a, b, c] = [scores[best - 1]!, scores[best]!, scores[best + 1]!];
  const denom = a - 2 * b + c;
  const guess = denom < 0 ? best + (0.5 * (a - c)) / denom : best;

  const candidates = [1, 2, 0.5, 4 / 3, 3 / 4].map((k) => guess * k).filter((p) => p >= minLag && p <= maxLag);
  let period = guess;
  let top = -Infinity;
  for (const p of candidates) {
    const beats = trackBeats(env, p);
    let salience = 0;
    for (const t of beats) salience += Math.max(env[t - 1] ?? 0, env[t]!, env[t + 1] ?? 0);
    const score = (salience / Math.max(1, beats.length)) * tempoPrior(60000 / (p * hopMs));
    if (score > top) {
      top = score;
      period = p;
    }
  }
  return period;
}

/** Dynamic-programming beat tracking: beats land on strong onsets about one period apart. */
function trackBeats(env: Float32Array, period: number, tightness = 100): number[] {
  const n = env.length;
  const score = new Float32Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2);
  const hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let best = 0;
    let arg = -1;
    for (let tau = t - hi; tau <= t - lo; tau++) {
      if (tau < 0) continue;
      const v = score[tau]! - tightness * Math.log((t - tau) / period) ** 2;
      if (arg < 0 || v > best) {
        best = v;
        arg = tau;
      }
    }
    score[t] = env[t]! + (arg >= 0 ? best : 0);
    back[t] = arg;
  }
  // End on the best-scoring frame within the last period, then walk back.
  let end = Math.max(0, n - Math.ceil(period));
  for (let t = end; t < n; t++) if (score[t]! > score[end]!) end = t;
  const beats: number[] = [];
  for (let t = end; t >= 0; t = back[t]!) beats.push(t);
  return beats.reverse();
}

/** Drops beats in leading and trailing silence. */
function trimQuiet(beats: number[], loudness: Float32Array): number[] {
  let max = -Infinity;
  for (const v of loudness) max = Math.max(max, v);
  if (max < -60) return [];
  const quiet = (t: number) => loudness[t]! < max - 45;
  let a = 0;
  let b = beats.length;
  while (a < b && quiet(beats[a]!)) a++;
  while (b > a && quiet(beats[b - 1]!)) b--;
  return beats.slice(a, b);
}

/**
 * Every fourth beat, starting where the bass is strongest: the kick on
 * beat 1 is usually the loudest of the bar. Linear power, not the log
 * spectrum, so a louder kick clearly wins.
 */
function barStarts(beats: number[], lowPower: Float32Array): number[] {
  if (beats.length < 4) return beats.slice(0, 1);
  const accent = (t: number) => {
    let m = 0;
    for (let d = -2; d <= 3; d++) m = Math.max(m, lowPower[t + d] ?? 0);
    return m;
  };
  const sums = [0, 0, 0, 0];
  beats.forEach((t, i) => (sums[i % 4]! += accent(t)));
  const phase = sums.indexOf(Math.max(...sums));
  return beats.filter((_, i) => i % 4 === phase);
}

/** Loudness smoothed over about a second and scaled to 0..1 between the song's quiet and loud parts. */
function loudnessCurve(loudness: Float32Array, radius: number): Float32Array {
  const smooth = movingMean(loudness, radius);
  const sorted = Float32Array.from(smooth).sort();
  const lo = sorted[Math.floor(sorted.length * 0.05)]!;
  const hi = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))]!;
  const span = Math.max(6, hi - lo);
  return smooth.map((v) => Math.min(1, Math.max(0, (v - lo) / span)));
}

/**
 * Hits per band. A hit counts for a band only if that band dominates the
 * moment (relative to each band's own loudest hits): a snare's noise also
 * reaches into the bass, but it isn't a kick.
 */
function bandOnsets(flux: Record<Band, Float32Array>, lowPower: Float32Array, hopMs: number): [number, number, Band][] {
  const bands = Object.keys(flux) as Band[];
  // A kick is a real jump in bass power; the log spectrum overstates small ones.
  const rise = new Float32Array(lowPower.length);
  for (let t = 0; t < rise.length; t++) {
    let before = Infinity;
    let after = 0;
    for (let d = 1; d <= 3; d++) before = Math.min(before, lowPower[t - d] ?? Infinity);
    for (let d = 0; d <= 3; d++) after = Math.max(after, lowPower[t + d] ?? 0);
    rise[t] = Math.max(0, after - (Number.isFinite(before) ? before : 0));
  }
  const topRise = percentile(rise, 0.99) || 1;
  const top = Object.fromEntries(bands.map((b) => [b, percentile(flux[b], 0.99) || 1])) as Record<Band, number>;
  const level = (b: Band, t: number) => {
    let m = 0;
    for (let d = -1; d <= 1; d++) m = Math.max(m, flux[b][t + d] ?? 0);
    return m / top[b];
  };
  const out: [number, number, Band][] = [];
  for (const band of bands) {
    for (const [t, strength] of pickOnsets(flux[band], hopMs)) {
      const others = Math.max(...bands.filter((b) => b !== band).map((b) => level(b, t)));
      if (level(band, t) < 0.5 * others) continue;
      if (band === 'low' && rise[t]! < 0.2 * topRise) continue;
      out.push([t, strength, band]);
    }
  }
  return out;
}

function percentile(x: Float32Array, f: number): number {
  const sorted = Float32Array.from(x).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))]!;
}

/** Local peaks clearly above their surroundings, at least 60 ms apart: [frame, strength]. */
function pickOnsets(x: Float32Array, hopMs: number): [number, number][] {
  const radius = Math.max(1, Math.round(35 / hopMs));
  const mean = movingMean(x, Math.round(500 / hopMs));
  let sq = 0;
  for (const v of x) sq += v * v;
  const rms = Math.sqrt(sq / x.length) || 1;
  const sorted = Float32Array.from(x).sort();
  const top = sorted[Math.floor(sorted.length * 0.99)] || 1;
  const gap = Math.round(60 / hopMs);
  const out: [number, number][] = [];
  for (let t = radius; t < x.length - radius; t++) {
    const v = x[t]!;
    if (v < mean[t]! + 0.6 * rms || v < 0.15 * top) continue;
    let isPeak = true;
    for (let d = -radius; d <= radius && isPeak; d++) if (x[t + d]! > v) isPeak = false;
    if (!isPeak) continue;
    const last = out[out.length - 1];
    if (last && t - last[0] < gap) {
      if (v > last[1] * top) out[out.length - 1] = [t, Math.min(1, v / top)];
      continue;
    }
    out.push([t, Math.min(1, v / top)]);
  }
  return out;
}

/**
 * Sections from loudness, in four-bar phrases: quiet, medium and loud
 * phrases are grouped, then named by where they sit (an opening quiet
 * phrase is the intro, a loud one after a jump is a drop, and so on).
 */
function findSections(energy: Float32Array, hopMs: number, downbeats: number[], durationMs: number): Section[] {
  // Phrase boundaries every four bars, or every 8 s when there's no beat.
  const bounds: number[] = [0];
  if (downbeats.length >= 8) {
    for (let i = 4; i < downbeats.length; i += 4) bounds.push(downbeats[i]!);
  } else {
    for (let t = 8000; t < durationMs; t += 8000) bounds.push(t);
  }
  if (durationMs - bounds[bounds.length - 1]! < 2000 && bounds.length > 1) bounds.pop();
  bounds.push(durationMs);
  const mean = (a: number, b: number) => {
    const i0 = Math.max(0, Math.floor(a / hopMs));
    const i1 = Math.min(energy.length, Math.max(i0 + 1, Math.floor(b / hopMs)));
    let s = 0;
    for (let i = i0; i < i1; i++) s += energy[i]!;
    return s / (i1 - i0);
  };
  const phrases = bounds.slice(0, -1).map((start, i) => ({ start, end: bounds[i + 1]!, energy: mean(start, bounds[i + 1]!) }));
  const sorted = phrases.map((p) => p.energy).sort((a, b) => a - b);
  const min = sorted[0]!;
  const spread = sorted[sorted.length - 1]! - min;
  // Thirds of the song's own range; a song that barely changes is all one level.
  const [t1, t2] = spread < 0.15 ? [-1, 2] : [min + spread / 3, min + (2 * spread) / 3];
  const levelOf = (e: number) => (e >= t2 ? 2 : e >= t1 ? 1 : 0);

  // Merge neighboring phrases at the same level.
  const groups: { start: number; end: number; level: number; energies: number[] }[] = [];
  for (const p of phrases) {
    const level = levelOf(p.energy);
    const last = groups[groups.length - 1];
    if (last && last.level === level) {
      last.end = p.end;
      last.energies.push(p.energy);
    } else {
      groups.push({ start: p.start, end: p.end, level, energies: [p.energy] });
    }
  }
  return groups.map((g, i) => {
    const prev = groups[i - 1];
    const next = groups[i + 1];
    const energyOf = (x: typeof g) => x.energies.reduce((a, b) => a + b, 0) / x.energies.length;
    const e = energyOf(g);
    let kind: SectionKind;
    if (g.level === 2) kind = prev && energyOf(prev) < e - 0.25 ? 'drop' : 'chorus';
    else if (i === 0 && next && g.level < next.level) kind = 'intro';
    else if (i === groups.length - 1 && prev && g.level < prev.level) kind = 'outro';
    else if (next && next.level > g.level && g.energies[g.energies.length - 1]! >= g.energies[0]!) kind = 'build';
    else kind = g.level === 0 && i > 0 ? 'break' : 'verse';
    return { startMs: g.start, endMs: g.end, kind, energy: e };
  });
}
