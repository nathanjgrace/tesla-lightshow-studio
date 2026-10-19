import { describe, expect, it } from 'vitest';
import { fft, hann } from './fft';

function dft(re: number[], im: number[]): [number[], number[]] {
  const n = re.length;
  const outRe: number[] = [];
  const outIm: number[] = [];
  for (let k = 0; k < n; k++) {
    let sr = 0;
    let si = 0;
    for (let t = 0; t < n; t++) {
      const a = (-2 * Math.PI * k * t) / n;
      sr += re[t]! * Math.cos(a) - im[t]! * Math.sin(a);
      si += re[t]! * Math.sin(a) + im[t]! * Math.cos(a);
    }
    outRe.push(sr);
    outIm.push(si);
  }
  return [outRe, outIm];
}

describe('fft', () => {
  it('matches a direct DFT', () => {
    const n = 64;
    const re = Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) + (i % 5) * 0.1);
    const im = Array.from({ length: n }, (_, i) => Math.cos(i * 0.3) * 0.5);
    const [er, ei] = dft(re, im);
    const r = Float64Array.from(re);
    const m = Float64Array.from(im);
    fft(r, m);
    for (let k = 0; k < n; k++) {
      expect(r[k]).toBeCloseTo(er[k]!, 8);
      expect(m[k]).toBeCloseTo(ei[k]!, 8);
    }
  });

  it('puts a pure tone in its bin', () => {
    const n = 1024;
    const re = new Float32Array(n).map((_, i) => Math.cos((2 * Math.PI * 37 * i) / n));
    const im = new Float32Array(n);
    fft(re, im);
    const mags = Array.from(re, (v, i) => Math.hypot(v, im[i]!));
    expect(mags.indexOf(Math.max(...mags.slice(0, n / 2)))).toBe(37);
  });

  it('rejects sizes that are not powers of two', () => {
    expect(() => fft(new Float32Array(6), new Float32Array(6))).toThrow();
  });

  it('builds a Hann window', () => {
    const w = hann(5);
    expect(Array.from(w, (v) => +v.toFixed(3))).toEqual([0, 0.5, 1, 0.5, 0]);
  });
});
