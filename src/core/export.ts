// Builds what goes on the USB drive: the show trimmed to the chosen part of
// the song, the matching audio as a 44.1 kHz WAV, and both packaged in a
// LightShow folder with matching names (research §2).

import { zipSync } from 'fflate';
import { stringHeader, writeFseq, type FseqFile } from './fseq';

/** Tesla requires 44.1 kHz audio; 48 kHz drifts out of sync with the lights. */
export const TESLA_SAMPLE_RATE = 44100;
const PRODUCER = 'Tesla Lightshow Studio';

/**
 * File-safe show name. The car matches the .fseq to its audio by name, and
 * several shows can share a drive, so names must be distinct and portable.
 */
export function showFileName(title: string): string {
  const name = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 _-]+/g, ' ')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 60);
  return name || 'lightshow';
}

/** The frames from startMs (inclusive) to endMs (exclusive), as a new show. */
export function trimShow(show: FseqFile, startMs: number, endMs: number, audioFileName: string, uniqueId: bigint): FseqFile {
  const first = Math.max(0, Math.round(startMs / show.stepTimeMs));
  const last = Math.min(show.frameCount, Math.round(endMs / show.stepTimeMs));
  if (last <= first) throw new Error('The selected part of the song is empty');
  return {
    channelCount: show.channelCount,
    frameCount: last - first,
    stepTimeMs: show.stepTimeMs,
    minorVersion: 0,
    uniqueId,
    variableHeaders: [stringHeader('mf', audioFileName), stringHeader('sp', PRODUCER)],
    data: show.data.slice(first * show.channelCount, last * show.channelCount),
  };
}

/** 16-bit PCM WAV from per-channel samples in -1..1. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const channelCount = channels.length;
  const length = channels[0]?.length ?? 0;
  const dataBytes = length * channelCount * 2;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * 2, true); // byte rate
  view.setUint16(32, channelCount * 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < channelCount; c++) {
      const s = Math.max(-1, Math.min(1, channels[c]![i]!));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return out;
}

/** A zip with LightShow/<name>.fseq and LightShow/<name>.wav, ready to unzip onto a drive. */
export function usbPackage(name: string, fseq: FseqFile, wav: Uint8Array | undefined): Uint8Array {
  const files: Record<string, [Uint8Array, { level: 0 }]> = {
    [`LightShow/${name}.fseq`]: [writeFseq(fseq), { level: 0 }],
  };
  if (wav) files[`LightShow/${name}.wav`] = [wav, { level: 0 }];
  return zipSync(files);
}
