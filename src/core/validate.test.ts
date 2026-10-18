import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLOSURE_BYTES } from './encoding';
import { readFseq } from './fseq';
import { blankShow, fill } from './testing';
import { validate } from './validate';

const { open, dance, close, stop } = CLOSURE_BYTES;
const codes = (show: ReturnType<typeof blankShow>) => validate(show).map((i) => i.code);

describe('header checks', () => {
  it('accepts a plain show', () => {
    expect(validate(blankShow(5))).toEqual([]);
  });

  it('rejects bad channel counts', () => {
    expect(codes({ ...blankShow(1), channelCount: 64, data: new Uint8Array(64 * 50) })).toContain('channel-count');
  });

  it('accepts the legacy 48-channel layout', () => {
    expect(codes({ ...blankShow(1), channelCount: 48, data: new Uint8Array(48 * 50) })).toEqual([]);
  });

  it('rejects frame intervals outside 15-100 ms', () => {
    expect(codes(blankShow(1, 10))).toContain('step-time');
    expect(codes(blankShow(1, 101))).toContain('step-time');
    expect(codes(blankShow(1, 15))).toEqual([]);
  });

  it('rejects shows longer than 4 hours', () => {
    const show = blankShow(1, 100);
    show.frameCount = 4 * 60 * 60 * 10 + 1;
    expect(codes(show)).toContain('too-long');
  });
});

describe('closure checks', () => {
  it('allows dancing falcon doors once they are fully open', () => {
    const show = blankShow(60);
    fill(show, 'leftFalconDoor', 0, 1, open);
    fill(show, 'leftFalconDoor', 21, 40, dance);
    fill(show, 'leftFalconDoor', 40, 41, close);
    expect(codes(show)).toEqual([]);
  });

  it('warns when a falcon door dances before it has finished opening', () => {
    const show = blankShow(30);
    fill(show, 'leftFalconDoor', 0, 1, open);
    fill(show, 'leftFalconDoor', 5, 20, dance);
    const issue = validate(show).find((i) => i.code === 'dance-before-open');
    expect(issue?.timeMs).toBe(5000);
  });

  it('lets windows dance without opening first', () => {
    const show = blankShow(20);
    fill(show, 'leftFrontWindow', 2, 10, dance);
    expect(codes(show)).toEqual([]);
  });

  it('warns about dancing a closure that cannot dance', () => {
    const show = blankShow(20);
    fill(show, 'leftMirror', 1, 5, dance);
    expect(codes(show)).toContain('dance-unsupported');
  });

  it('flags going over the per-closure command limit', () => {
    const show = blankShow(100);
    for (let i = 0; i < 4; i++) {
      fill(show, 'leftFrontWindow', i * 20, i * 20 + 1, open);
      fill(show, 'leftFrontWindow', i * 20 + 10, i * 20 + 11, close);
    }
    // 8 commands against a limit of 6
    expect(codes(show).filter((c) => c === 'closure-limit')).toHaveLength(1);
  });

  it('counts each closure separately', () => {
    const show = blankShow(100);
    for (const id of ['leftFrontWindow', 'rightFrontWindow']) {
      for (let i = 0; i < 3; i++) {
        fill(show, id, i * 30, i * 30 + 1, open);
        fill(show, id, i * 30 + 10, i * 30 + 11, close);
      }
    }
    expect(codes(show)).not.toContain('closure-limit');
  });

  it('warns about long dances', () => {
    const show = blankShow(60);
    fill(show, 'leftFrontWindow', 0, 45, dance);
    expect(codes(show)).toContain('dance-thermal');
  });

  it('warns about moving windows while Model X doors move', () => {
    const show = blankShow(40);
    fill(show, 'rightFalconDoor', 0, 1, open); // moving 0-20 s
    fill(show, 'rightRearWindow', 10, 11, open); // moving 10-14 s
    const issue = validate(show).find((i) => i.code === 'model-x-pinch');
    expect(issue?.timeMs).toBe(10_000);
  });

  it('does not warn when windows move after the doors stop', () => {
    const show = blankShow(40);
    fill(show, 'rightFalconDoor', 0, 1, open);
    fill(show, 'rightFalconDoor', 5, 6, stop); // halted at 5 s
    fill(show, 'rightRearWindow', 10, 11, open);
    expect(codes(show)).not.toContain('model-x-pinch');
  });

  it('warns when the charge port stays open past its 2-minute auto-close', () => {
    const show = blankShow(180);
    fill(show, 'chargePort', 0, 1, open);
    expect(codes(show)).toContain('charge-port-auto-close');
  });
});

describe("Tesla's example shows", () => {
  for (const name of ['arrival-car1.fseq', 'cyber-symphony-car1.fseq', 'ready-for-assault-car1.fseq']) {
    const path = `fixtures/${name}`;
    // Tesla's examples only trip warnings (e.g. Cyber Symphony goes over the
    // documented charge port limit), never errors.
    it.skipIf(!existsSync(path))(`${name} has no errors`, () => {
      const issues = validate(readFseq(new Uint8Array(readFileSync(path))));
      expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    });
  }
});
