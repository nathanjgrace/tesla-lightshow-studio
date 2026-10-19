import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyze } from './analysis';
import { CHANNELS } from './channels';
import { readFseq } from './fseq';
import { readWavMono } from './testing';

const RATE = 44100;

/** Deterministic noise. */
function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 31 - 1;
  };
}

interface Pattern {
  bpm: number;
  bars: number;
  /** Loudness per bar (default 1). */
  gain?: (bar: number) => number;
  offsetMs?: number;
}

/** A drum loop: kick on beat 1 (and 3), snare on 2 and 4, hi-hats on eighths. */
function drums({ bpm, bars, gain = () => 1, offsetMs = 0 }: Pattern): { samples: Float32Array; beatsMs: number[]; barsMs: number[] } {
  const beatMs = 60000 / bpm;
  const total = Math.ceil(((offsetMs + bars * 4 * beatMs) / 1000 + 1) * RATE);
  const out = new Float32Array(total);
  const rnd = noise(7);
  const beatsMs: number[] = [];
  const barsMs: number[] = [];
  const add = (startMs: number, length: number, g: number, fn: (i: number) => number) => {
    const start = Math.round((startMs / 1000) * RATE);
    for (let i = 0; i < length && start + i < total; i++) out[start + i]! += g * fn(i);
  };
  let hp = 0;
  for (let bar = 0; bar < bars; bar++) {
    const g = gain(bar);
    for (let beat = 0; beat < 4; beat++) {
      const t = offsetMs + (bar * 4 + beat) * beatMs;
      beatsMs.push(t);
      if (beat === 0) barsMs.push(t);
      if (beat === 0 || beat === 2) {
        // Kick: a falling 55 Hz thump, stronger on beat 1.
        const k = beat === 0 ? 0.9 : 0.55;
        add(t, 0.18 * RATE, g * k, (i) => Math.sin(2 * Math.PI * 55 * (i / RATE)) * Math.exp(-i / (0.05 * RATE)));
      }
      if (beat === 1 || beat === 3) {
        add(t, 0.08 * RATE, g * 0.4, (i) => (rnd() * 0.7 + Math.sin(2 * Math.PI * 900 * (i / RATE)) * 0.3) * Math.exp(-i / (0.02 * RATE)));
      }
      for (const eighth of [0, 0.5]) {
        // Hi-hat: high-passed noise.
        add(t + eighth * beatMs, 0.03 * RATE, g * 0.12, () => {
          const v = rnd();
          const h = v - hp;
          hp = v;
          return h;
        });
      }
    }
  }
  return { samples: out, beatsMs, barsMs };
}

const nearest = (xs: number[], t: number) => xs.reduce((best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best), Infinity);

describe('analyze: tempo and beats', () => {
  for (const bpm of [90, 120, 140]) {
    it(`finds ${bpm} BPM and lands on the beats`, () => {
      const song = drums({ bpm, bars: 16, offsetMs: 300 });
      const a = analyze(song.samples, RATE);
      expect(a.bpm).toBeGreaterThan(bpm * 0.98);
      expect(a.bpm).toBeLessThan(bpm * 1.02);
      // Nearly every real beat has a detected beat within 30 ms.
      const hits = song.beatsMs.filter((t) => Math.abs(nearest(a.beats, t) - t) < 30).length;
      expect(hits / song.beatsMs.length).toBeGreaterThan(0.9);
    });
  }

  it('puts bar starts on the strong kicks', () => {
    const song = drums({ bpm: 120, bars: 16 });
    const a = analyze(song.samples, RATE);
    const onBar = a.downbeats.filter((t) => Math.abs(nearest(song.barsMs, t) - t) < 30).length;
    expect(onBar / a.downbeats.length).toBeGreaterThan(0.85);
  });

  it('labels kicks, snares and hi-hats by band', () => {
    const song = drums({ bpm: 120, bars: 8 });
    const a = analyze(song.samples, RATE);
    const near = (band: string, times: number[]) =>
      times.filter((t) => a.onsets.some((o) => o.band === band && Math.abs(o.timeMs - t) < 30)).length / times.length;
    const kicks = song.beatsMs.filter((_, i) => i % 2 === 0);
    const snares = song.beatsMs.filter((_, i) => i % 2 === 1);
    expect(near('low', kicks)).toBeGreaterThan(0.85);
    expect(near('mid', snares)).toBeGreaterThan(0.85);
    expect(near('high', snares)).toBeGreaterThan(0.5);
    // Kicks aren't reported as low hits on the snare beats.
    expect(near('low', snares)).toBeLessThan(0.3);
  });

  it('copes with silence', () => {
    const a = analyze(new Float32Array(RATE * 5), RATE);
    expect(a.beats).toEqual([]);
    expect(a.bpm).toBe(0);
    expect(a.onsets).toEqual([]);
    expect(a.sections.length).toBeGreaterThan(0);
  });
});

describe('analyze: loudness and sections', () => {
  it('finds a quiet intro, a loud drop and a quiet outro', () => {
    // 8 quiet bars, 16 loud bars, 8 quiet bars at 120 BPM (2 s per bar).
    const song = drums({ bpm: 120, bars: 32, gain: (bar) => (bar >= 8 && bar < 24 ? 1 : 0.06) });
    const a = analyze(song.samples, RATE);
    expect(a.sections.map((s) => s.kind)).toEqual(['intro', 'drop', 'outro']);
    const drop = a.sections[1]!;
    expect(Math.abs(drop.startMs - 16000)).toBeLessThan(600);
    expect(Math.abs(drop.endMs - 48000)).toBeLessThan(600);
    expect(drop.energy).toBeGreaterThan(a.sections[0]!.energy + 0.3);
  });

  it('scales loudness to 0..1', () => {
    const song = drums({ bpm: 120, bars: 8, gain: (bar) => (bar < 4 ? 0.1 : 1) });
    const { values } = analyze(song.samples, RATE).energy;
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThanOrEqual(1);
    expect(values[Math.floor(values.length * 0.8)]!).toBeGreaterThan(values[Math.floor(values.length * 0.2)]! + 0.3);
  });
});

describe("analyze: Tesla's Elevator Music", () => {
  const wav = 'fixtures/elevator.wav';
  const fseq = 'fixtures/elevator.fseq';
  it.skipIf(!existsSync(wav) || !existsSync(fseq))('beats line up with the lights Tesla choreographed (run `npm run fixtures` first)', () => {
    const { samples, sampleRate } = readWavMono(new Uint8Array(readFileSync(wav)));
    const a = analyze(samples, sampleRate);
    // A bossa at 88 BPM: its dotted rhythm makes 117 BPM (4/3) look plausible.
    expect(a.bpm).toBeGreaterThan(86);
    expect(a.bpm).toBeLessThan(90);
    // Where Tesla turned lights on, compared with our beats and half-beats.
    const show = readFseq(new Uint8Array(readFileSync(fseq)));
    const lights = CHANNELS.filter((c) => c.kind === 'ramping' || c.kind === 'boolean').map((c) => c.index);
    const ons: number[] = [];
    for (let f = 1; f < show.frameCount; f++) {
      const on = (frame: number, i: number) => show.data[frame * show.channelCount + i]! >= 128;
      if (lights.some((i) => on(f, i) && !on(f - 1, i))) ons.push(f * show.stepTimeMs);
    }
    const half = 30000 / a.bpm;
    const grid = a.beats.flatMap((b) => [b, b + half]);
    const onGrid = ons.filter((t) => Math.abs(nearest(grid, t) - t) <= 50).length / ons.length;
    expect(onGrid).toBeGreaterThan(0.8);
  });
});
