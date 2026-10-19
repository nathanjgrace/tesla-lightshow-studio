import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { melody } from './melody';
import { readWavMono } from './testing';

const RATE = 22050;

/** A tune of harmonic tones over a drum loop. `tune`: [midi, startS, lengthS]. */
function song(tune: [number, number, number][], seconds: number, drums = true): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  let seed = 7;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (const [midi, start, length] of tune) {
    const f = 440 * 2 ** ((midi - 69) / 12);
    const a = Math.round(start * RATE);
    const n = Math.round(length * RATE);
    for (let i = 0; i < n; i++) {
      const env = Math.min(1, i / 200, (n - i) / 400) * 0.25;
      let v = 0;
      for (let h = 1; h <= 6; h++) v += Math.sin((2 * Math.PI * f * h * i) / RATE) / h;
      out[a + i]! += v * env;
    }
  }
  if (drums) {
    for (let t = 0; t < seconds; t += 0.5) {
      const a = Math.round(t * RATE);
      // Kick on the beat, snare-like noise on the off-beat.
      for (let i = 0; i < 4000 && a + i < out.length; i++) out[a + i]! += Math.sin((2 * Math.PI * 55 * i) / RATE) * Math.exp(-i / 1500) * 0.5;
      const b = a + Math.round(0.25 * RATE);
      for (let i = 0; i < 3000 && b + i < out.length; i++) out[b + i]! += noise() * Math.exp(-i / 700) * 0.35;
    }
  }
  return out;
}

describe('melody', () => {
  const tune: [number, number, number][] = [
    [60, 0.5, 0.4],
    [64, 1.0, 0.4],
    [67, 1.5, 0.4],
    [72, 2.0, 0.9],
    [69, 3.0, 0.3],
    [65, 3.4, 0.3],
    [62, 3.8, 0.6],
  ];

  it('finds the notes of a tune over drums, with their pitch and timing', () => {
    const found = melody(song(tune, 5), RATE);
    for (const [midi, start, length] of tune) {
      const match = found.find((n) => Math.abs(n.pitch - midi) < 0.6 && Math.abs(n.startMs - start * 1000) < 70);
      expect(match, `note ${midi} at ${start}s in ${JSON.stringify(found.map((n) => [n.pitch.toFixed(1), Math.round(n.startMs), Math.round(n.endMs)]))}`).toBeDefined();
      expect(Math.abs(match!.endMs - (start + length) * 1000)).toBeLessThan(120);
    }
  });

  it('finds nothing in drums alone', () => {
    const found = melody(song([], 4), RATE);
    expect(found.reduce((sum, n) => sum + n.endMs - n.startMs, 0), JSON.stringify(found)).toBeLessThan(300);
  });

  it('splits a note struck twice', () => {
    const found = melody(song([[67, 0.5, 0.35], [67, 0.9, 0.35]], 2, false), RATE);
    expect(found.filter((n) => Math.abs(n.pitch - 67) < 0.6)).toHaveLength(2);
  });

  it('copes with silence and very short input', () => {
    expect(melody(new Float32Array(RATE), RATE)).toEqual([]);
    expect(melody(new Float32Array(10), RATE)).toEqual([]);
  });

  const wav = 'fixtures/elevator.wav';
  it.skipIf(!existsSync(wav))('follows the tune of a real song (run `npm run fixtures` first)', () => {
    const { samples, sampleRate } = readWavMono(new Uint8Array(readFileSync(wav)));
    const found = melody(samples, sampleRate);
    const seconds = samples.length / sampleRate;
    // A melodic song: notes most of the time, at a few per second, over a believable range.
    const covered = found.reduce((sum, n) => sum + n.endMs - n.startMs, 0) / 1000;
    expect(covered / seconds).toBeGreaterThan(0.3);
    expect(found.length / seconds).toBeGreaterThan(0.8);
    expect(found.length / seconds).toBeLessThan(8);
    const pitches = found.map((n) => n.pitch).sort((a, b) => a - b);
    const spread = pitches[Math.floor(pitches.length * 0.9)]! - pitches[Math.floor(pitches.length * 0.1)]!;
    expect(spread).toBeGreaterThan(3);
    expect(spread).toBeLessThan(24);
  });
});
