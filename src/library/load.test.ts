import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { audioType, fromZip, isAudioFile } from './load';

describe('audio formats', () => {
  it('recognizes common music files', () => {
    for (const name of ['a.mp3', 'b.WAV', 'c.m4a', 'd.flac', 'e.ogg', 'f.opus']) expect(isAudioFile(name)).toBe(true);
    expect(isAudioFile('show.fseq')).toBe(false);
    expect(audioType('song.m4a')).toBe('audio/mp4');
  });

  it('finds the show and its music in a zip, skipping macOS metadata', () => {
    const zip = zipSync({
      'LightShow/my.fseq': new Uint8Array([1, 2, 3]),
      'LightShow/my.m4a': new Uint8Array([4, 5]),
      '__MACOSX/LightShow/._my.fseq': new Uint8Array([9]),
    });
    const files = fromZip(zip);
    expect(Array.from(files.fseq)).toEqual([1, 2, 3]);
    expect(files.audio?.type).toBe('audio/mp4');
  });
});
