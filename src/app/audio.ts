/** Min/max audio amplitude per 10 ms bucket, for drawing the waveform. */
export interface Peaks {
  bucketMs: number;
  min: Float32Array;
  max: Float32Array;
}

const decoded = new WeakMap<Blob, Promise<AudioBuffer>>();

/** Decodes a song once; the waveform and the music analysis share it. */
export function decodeAudio(audio: Blob): Promise<AudioBuffer> {
  let p = decoded.get(audio);
  if (!p) {
    p = audio.arrayBuffer().then((bytes) => new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes));
    decoded.set(audio, p);
  }
  return p;
}

/** The song as one channel, for analysis. */
export async function monoSamples(audio: Blob): Promise<{ samples: Float32Array; sampleRate: number }> {
  const buffer = await decodeAudio(audio);
  const samples = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < samples.length; i++) samples[i]! += data[i]! / buffer.numberOfChannels;
  }
  return { samples, sampleRate: buffer.sampleRate };
}

export async function computePeaks(audio: Blob, bucketMs = 10): Promise<Peaks> {
  const buffer = await decodeAudio(audio);
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
export async function audioDurationMs(audio: Blob, name: string): Promise<number> {
  const context = new OfflineAudioContext(1, 1, 44100);
  try {
    const buffer = await context.decodeAudioData(await audio.arrayBuffer());
    return buffer.duration * 1000;
  } catch {
    const ext = name.split('.').pop()?.toUpperCase() ?? 'this';
    throw new Error(
      `This browser can't read ${ext} audio. Try an MP3 or WAV of the song, or open this page in Chrome, Edge or Safari (they read M4A/AAC too).`,
    );
  }
}
