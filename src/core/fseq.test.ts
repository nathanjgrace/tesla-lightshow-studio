import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FseqFormatError, readFseq, stringHeader, writeFseq } from './fseq';
import { blankShow, fill } from './testing';

const FIXTURES = ['arrival-car1.fseq', 'cyber-symphony-car1.fseq', 'ready-for-assault-car1.fseq'];

describe('writeFseq / readFseq', () => {
  it('round-trips a show', () => {
    const show = blankShow(2);
    show.uniqueId = 1234567890123n;
    show.variableHeaders = [stringHeader('mf', 'lightshow.wav'), stringHeader('sp', 'Tesla Lightshow Studio')];
    fill(show, 'leftFrontFog', 0.5, 1, 255);

    const bytes = writeFseq(show);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('PSEQ');
    const dataOffset = bytes[4]! | (bytes[5]! << 8);
    expect(dataOffset % 4).toBe(0);
    expect(bytes.length).toBe(dataOffset + 200 * show.frameCount);

    expect(readFseq(bytes)).toEqual(show);
  });

  it('rejects files that are not FSEQ', () => {
    expect(() => readFseq(new TextEncoder().encode('this is not a light show at all'.padEnd(40)))).toThrow(FseqFormatError);
  });

  it('rejects compressed files', () => {
    const bytes = writeFseq(blankShow(1));
    bytes[20] = 1; // zstd
    expect(() => readFseq(bytes)).toThrow(/uncompressed/);
  });

  it('rejects truncated files', () => {
    const bytes = writeFseq(blankShow(1));
    expect(() => readFseq(bytes.subarray(0, bytes.length - 1))).toThrow(/truncated/);
  });

  it('rejects data that does not match the frame count', () => {
    const show = blankShow(1);
    show.frameCount += 1;
    expect(() => writeFseq(show)).toThrow(/does not match/);
  });
});

describe.each(FIXTURES)("Tesla's example %s", (name) => {
  const path = `fixtures/${name}`;
  it.skipIf(!existsSync(path))('rewrites byte-for-byte identical (run `npm run fixtures` first)', () => {
    const original = new Uint8Array(readFileSync(path));
    const parsed = readFseq(original);
    expect(parsed.channelCount).toBe(200);
    // Buffer.equals is far faster than toEqual on ~1 MB of bytes.
    expect(Buffer.from(writeFseq(parsed)).equals(original)).toBe(true);
  });
});
