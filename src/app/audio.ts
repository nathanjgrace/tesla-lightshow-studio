/** Min/max audio amplitude per 10 ms bucket, for drawing the waveform. */
export interface Peaks {
  bucketMs: number;
  min: Float32Array;
  max: Float32Array;
}

export async function computePeaks(audio: Blob, bucketMs = 10): Promise<Peaks> {
  const context = new OfflineAudioContext(1, 1, 44100);
  const buffer = await context.decodeAudioData(await audio.arrayBuffer());
  const perBucket = Math.max(1, Math.round((buffer.sampleRate * bucketMs) / 1000));
  const buckets = Math.ceil(buffer.length / perBucket);
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  for (let b = 0; b < buckets; b++) {
    let lo = 0;
    let hi = 0;
    const end = Math.min(buffer.length, (b + 1) * perBucket);
    for (let i = b * perBucket; i < end; i++) {
      let v = 0;
      for (const c of channels) v += c[i]!;
      v /= channels.length;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { bucketMs, min, max };
}

/** A song's length, for starting a blank show that matches it. */
export async function audioDurationMs(audio: Blob): Promise<number> {
  const context = new OfflineAudioContext(1, 1, 44100);
  const buffer = await context.decodeAudioData(await audio.arrayBuffer());
  return buffer.duration * 1000;
}
