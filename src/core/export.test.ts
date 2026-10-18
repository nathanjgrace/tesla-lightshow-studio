import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { encodeWav, showFileName, trimShow, usbPackage } from './export';
import { readFseq } from './fseq';
import { blankShow, fill } from './testing';
import { validate } from './validate';

describe('showFileName', () => {
  it('makes portable names', () => {
    expect(showFileName('Auld Lang Syne in the City · Car 2')).toBe('Auld_Lang_Syne_in_the_City_Car_2');
    expect(showFileName('Café del Mar!')).toBe('Cafe_del_Mar');
    expect(showFileName('???')).toBe('lightshow');
  });
});

describe('trimShow', () => {
  it('keeps only the selected frames and names the audio', () => {
    const show = blankShow(10);
    fill(show, 'leftFrontFog', 4, 5, 255);
    const trimmed = trimShow(show, 3000, 6000, 'song.wav', 7n);
    expect(trimmed.frameCount).toBe(150);
    const fogIndex = 14; // channel 15
    expect(trimmed.data[49 * 200 + fogIndex]).toBe(0); // 3.98 s
    expect(trimmed.data[50 * 200 + fogIndex]).toBe(255); // 4.00 s
    expect(new TextDecoder().decode(trimmed.variableHeaders[0]!.data)).toBe('song.wav\0');
    expect(validate(trimmed).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('refuses an empty selection', () => {
    expect(() => trimShow(blankShow(2), 1000, 1000, 'a.wav', 0n)).toThrow(/empty/);
  });
});

describe('encodeWav', () => {
  it('writes a 16-bit PCM header and samples', () => {
    const wav = encodeWav([new Float32Array([0, 1, -1]), new Float32Array([0.5, 0, 0])], 44100);
    const view = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF');
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(40, true)).toBe(12);
    expect(view.getInt16(44 + 2, true)).toBe(16383); // right channel, 0.5
    expect(view.getInt16(44 + 4, true)).toBe(32767); // left, 1
    expect(view.getInt16(44 + 8, true)).toBe(-32768); // left, -1
  });
});

describe('usbPackage', () => {
  it('puts matching files in a LightShow folder', () => {
    const show = trimShow(blankShow(2), 0, 2000, 'my_show.wav', 1n);
    const files = unzipSync(usbPackage('my_show', show, encodeWav([new Float32Array(10)], 44100)));
    expect(Object.keys(files).sort()).toEqual(['LightShow/my_show.fseq', 'LightShow/my_show.wav']);
    expect(readFseq(files['LightShow/my_show.fseq']!).frameCount).toBe(100);
  });
});
