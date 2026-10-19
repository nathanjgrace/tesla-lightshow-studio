// In-place radix-2 FFT, for audio analysis. Small and dependency-free.

/** Transforms re/im (length a power of two) in place. */
export function fft(re: Float32Array | Float64Array, im: Float32Array | Float64Array): void {
  const n = re.length;
  if (n !== im.length || (n & (n - 1)) !== 0) throw new Error('FFT size must be a power of two');
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const r = re[i]!;
      re[i] = re[j]!;
      re[j] = r;
      const m = im[i]!;
      im[i] = im[j]!;
      im[j] = m;
    }
  }
  const [cos, sin] = twiddles(n);
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const stride = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * stride]!;
        const wi = sin[k * stride]!;
        const a = start + k;
        const b = a + half;
        const tr = re[b]! * wr - im[b]! * wi;
        const ti = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
      }
    }
  }
}

const tables = new Map<number, [Float64Array, Float64Array]>();

/** cos and sin of -2πk/n for k < n/2, computed once per size. */
function twiddles(n: number): [Float64Array, Float64Array] {
  let t = tables.get(n);
  if (!t) {
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let k = 0; k < n / 2; k++) {
      cos[k] = Math.cos((-2 * Math.PI * k) / n);
      sin[k] = Math.sin((-2 * Math.PI * k) / n);
    }
    t = [cos, sin];
    tables.set(n, t);
  }
  return t;
}

/** A Hann window of length n. */
export function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}
