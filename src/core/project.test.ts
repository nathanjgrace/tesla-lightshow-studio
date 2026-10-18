import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { channel } from './channels';
import { CLOSURE_BYTES, LIGHT_BYTES } from './encoding';
import { readFseq } from './fseq';
import {
  blankProject,
  compileProject,
  effectFamily,
  mirrored,
  newEffectId,
  placeEffects,
  projectFromShow,
  type Effect,
} from './project';
import { blankShow, fill } from './testing';

const fx = (channelId: string, startMs: number, endMs: number, kind: Effect['kind'], extra: Partial<Effect> = {}): Effect => ({
  id: newEffectId(),
  channel: channelId,
  startMs,
  endMs,
  kind,
  ...extra,
});
const byteAt = (data: Uint8Array, frame: number, id: string) => data[frame * 200 + channel(id).index];

describe('compileProject', () => {
  it('writes effects as Tesla command bytes', () => {
    const p = { ...blankProject(2000), effects: [fx('leftFrontFog', 200, 600, 'on'), fx('liftgate', 1000, 1100, 'open')] };
    const show = compileProject(p);
    expect(show.frameCount).toBe(100);
    expect(byteAt(show.data, 9, 'leftFrontFog')).toBe(0);
    expect(byteAt(show.data, 10, 'leftFrontFog')).toBe(LIGHT_BYTES.on);
    expect(byteAt(show.data, 29, 'leftFrontFog')).toBe(LIGHT_BYTES.on);
    expect(byteAt(show.data, 30, 'leftFrontFog')).toBe(0);
    expect(byteAt(show.data, 50, 'liftgate')).toBe(CLOSURE_BYTES.open);
  });

  it('alternates strobes on and off', () => {
    const p = { ...blankProject(1000), effects: [fx('leftFrontFog', 0, 400, 'strobe', { periodMs: 100 })] };
    const data = compileProject(p).data;
    // 100 ms = 5 frames per cycle: on for the first half, then off.
    expect([0, 1, 2, 3, 4, 5].map((f) => byteAt(data, f, 'leftFrontFog'))).toEqual([255, 255, 255, 0, 0, 255]);
  });
});

describe('projectFromShow', () => {
  it('turns standard commands into effects and keeps everything else as base', () => {
    const show = blankShow(4);
    fill(show, 'leftFrontFog', 1, 2, LIGHT_BYTES.on);
    fill(show, 'leftInnerMainBeam', 0, 1, LIGHT_BYTES.on1000);
    fill(show, 'leftInnerMainBeam', 1, 2, LIGHT_BYTES.off500);
    fill(show, 'leftFalconDoor', 0, 0.5, CLOSURE_BYTES.open);
    fill(show, 'leftTail', 2, 3, 123); // not a standard command
    const p = projectFromShow(show);
    expect(p.effects.map((e) => [e.channel, e.kind, e.startMs, e.endMs])).toEqual(
      expect.arrayContaining([
        ['leftFrontFog', 'on', 1000, 2000],
        ['leftInnerMainBeam', 'on1000', 0, 1000],
        ['leftInnerMainBeam', 'off500', 1000, 2000],
        ['leftFalconDoor', 'open', 0, 500],
      ]),
    );
    expect(p.effects.some((e) => e.channel === 'leftTail')).toBe(false);
    expect(compileProject(p).data).toEqual(show.data);
  });

  for (const name of ['arrival-car1.fseq', 'cyber-symphony-car1.fseq', 'ready-for-assault-car1.fseq']) {
    const path = `fixtures/${name}`;
    it.skipIf(!existsSync(path))(`round-trips Tesla's ${name} exactly`, () => {
      const show = readFseq(new Uint8Array(readFileSync(path)));
      const p = projectFromShow(show);
      expect(p.effects.length).toBeGreaterThan(100);
      expect(Buffer.from(compileProject(p).data).equals(Buffer.from(show.data))).toBe(true);
    });
  }
});

describe('placeEffects', () => {
  it('trims an effect the new one overlaps at its end', () => {
    const a = fx('leftFrontFog', 0, 1000, 'on');
    const b = fx('leftFrontFog', 600, 1500, 'strobe');
    const r = placeEffects([a], [b]);
    expect(r.map((e) => [e.id, e.startMs, e.endMs])).toEqual([
      [a.id, 0, 600],
      [b.id, 600, 1500],
    ]);
  });

  it('splits an effect the new one lands inside', () => {
    const a = fx('leftFrontFog', 0, 1000, 'on');
    const b = fx('leftFrontFog', 400, 600, 'off500');
    const r = placeEffects([a], [b]);
    expect(r.map((e) => [e.startMs, e.endMs, e.kind])).toEqual([
      [0, 400, 'on'],
      [400, 600, 'off500'],
      [600, 1000, 'on'],
    ]);
    expect(r[0]!.id).toBe(a.id);
    expect(r[2]!.id).not.toBe(a.id);
  });

  it('removes effects it covers and leaves other channels alone', () => {
    const a = fx('leftFrontFog', 400, 600, 'on');
    const other = fx('rightFrontFog', 0, 1000, 'on');
    const b = fx('leftFrontFog', 0, 1000, 'strobe');
    expect(placeEffects([a, other], [b]).map((e) => e.id).sort()).toEqual([b.id, other.id].sort());
  });

  it('moves an existing effect by id', () => {
    const a = fx('leftFrontFog', 0, 500, 'on');
    const r = placeEffects([a], [{ ...a, startMs: 1000, endMs: 1500 }]);
    expect(r).toHaveLength(1);
    expect(r[0]!.startMs).toBe(1000);
  });
});

describe('mirroring and families', () => {
  it('mirrors left to right and skips center channels', () => {
    const m = mirrored([fx('leftFalconDoor', 0, 100, 'open'), fx('brakeLights', 0, 100, 'on')]);
    expect(m.map((e) => e.channel)).toEqual(['rightFalconDoor']);
  });

  it('knows which channels are editable as effects', () => {
    expect(effectFamily('leftFrontFog')).toBe('light');
    expect(effectFamily('liftgate')).toBe('closure');
    expect(effectFamily('frontLightBar1')).toBeUndefined();
  });
});
