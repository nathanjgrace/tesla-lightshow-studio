import { encodeWav, showFileName, TESLA_SAMPLE_RATE, trimShow, usbPackage } from '../core/export';
import { writeFseq, type FseqFile } from '../core/fseq';
import type { Range } from './Composer';

/** Decodes audio resampled to 44.1 kHz and returns the selected part as a WAV. */
async function wavForRange(audio: Blob, range: Range): Promise<Uint8Array> {
  // decodeAudioData resamples to the context's rate, which gives us 44.1 kHz.
  const context = new OfflineAudioContext(2, 1, TESLA_SAMPLE_RATE);
  const buffer = await context.decodeAudioData(await audio.arrayBuffer());
  const first = Math.round((range.startMs / 1000) * buffer.sampleRate);
  const last = Math.min(buffer.length, Math.round((range.endMs / 1000) * buffer.sampleRate));
  const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) =>
    buffer.getChannelData(c).slice(first, last),
  );
  return encodeWav(channels, buffer.sampleRate);
}

function download(bytes: Uint8Array, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function exportUsbZip(title: string, show: FseqFile, audio: Blob | undefined, range: Range): Promise<void> {
  const name = showFileName(title);
  const trimmed = trimShow(show, range.startMs, range.endMs, `${name}.wav`, BigInt(Date.now()) * 1000n);
  const wav = audio ? await wavForRange(audio, range) : undefined;
  download(usbPackage(name, trimmed, wav), `${name}_LightShow.zip`, 'application/zip');
}

export function exportFseq(title: string, show: FseqFile, range: Range): void {
  const name = showFileName(title);
  const trimmed = trimShow(show, range.startMs, range.endMs, `${name}.wav`, BigInt(Date.now()) * 1000n);
  download(writeFseq(trimmed), `${name}.fseq`, 'application/octet-stream');
}
