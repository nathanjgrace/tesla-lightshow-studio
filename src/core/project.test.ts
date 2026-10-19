import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { channel, CHANNELS_BY_ID } from './channels';
import { CLOSURE_BYTES, decodeClosure, LIGHT_BYTES } from './encoding';
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
import { simulate } from './simulate';
import { blankShow, fill } from './testing';
import { VEHICLES_BY_ID } from './vehicles';

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

describe('move to a position', () => {
  const at = (show: ReturnType<typeof compileProject>, id: string, ms: number) =>
    simulate(show, VEHICLES_BY_ID.get('modelX-2021')!).closures.get(id)!.position[Math.round(ms / show.stepTimeMs)]!;
  const fx = (startMs: number, endMs: number, targetPct: number, channel = 'leftFrontWindow') => ({ id: `m${startMs}`, channel, startMs, endMs, kind: 'move' as const, targetPct });

  it('opens partway and stops there, then closes partway', () => {
    // Windows take about 4 s each way.
    const show = compileProject({ ...blankProject(20000), effects: [fx(1000, 6000, 50), fx(8000, 12000, 20)] });
    expect(at(show, 'leftFrontWindow', 5500)).toBeCloseTo(0.5, 1);
    expect(at(show, 'leftFrontWindow', 7900)).toBeCloseTo(0.5, 1);
    expect(at(show, 'leftFrontWindow', 15000)).toBeCloseTo(0.2, 1);
    // One open, one close, each followed by a stop.
    const index = CHANNELS_BY_ID.get('leftFrontWindow')!.index;
    const commands = new Set<string>();
    for (let f = 0; f < show.frameCount; f++) commands.add(decodeClosure(show.data[f * show.channelCount + index]!));
    expect([...commands].sort()).toEqual(['close', 'idle', 'open', 'stop']);
  });

  it('needs no stop to go fully open or closed, and does nothing when already there', () => {
    const show = compileProject({ ...blankProject(20000), effects: [fx(1000, 6000, 100), fx(7000, 9000, 100), fx(10000, 16000, 0)] });
    expect(at(show, 'leftFrontWindow', 6500)).toBeCloseTo(1, 2);
    expect(at(show, 'leftFrontWindow', 16000)).toBeCloseTo(0, 2);
    const index = CHANNELS_BY_ID.get('leftFrontWindow')!.index;
    let stops = 0;
    let opens = 0;
    for (let f = 0; f < show.frameCount; f++) {
      const c = decodeClosure(show.data[f * show.channelCount + index]!);
      if (c === 'stop') stops++;
      if (c === 'open' && (f === 0 || decodeClosure(show.data[(f - 1) * show.channelCount + index]!) !== 'open')) opens++;
    }
    expect(stops).toBe(0);
    expect(opens).toBe(1);
  });

  it('stops where it got to when the effect is shorter than the travel', () => {
    const show = compileProject({ ...blankProject(20000), effects: [fx(1000, 2000, 100)] });
    expect(at(show, 'leftFrontWindow', 5000)).toBeCloseTo(0.25, 1);
  });

  it('starts from wherever earlier commands left the closure', () => {
    const show = compileProject({
      ...blankProject(20000),
      effects: [{ id: 'o', channel: 'leftFrontWindow', startMs: 0, endMs: 500, kind: 'open' }, fx(6000, 12000, 25)],
    });
    expect(at(show, 'leftFrontWindow', 5000)).toBeCloseTo(1, 2);
    expect(at(show, 'leftFrontWindow', 11000)).toBeCloseTo(0.25, 1);
  });
});
