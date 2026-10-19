import { describe, expect, it } from 'vitest';
import type { Analysis, Onset, SectionKind } from './analysis';
import { CHANNELS_BY_ID } from './channels';
import { generateShow, musicMap, planSections, type GenerateOptions } from './generate';
import { blankProject, compileProject, effectFamily } from './project';
import { validate } from './validate';
import { VEHICLES, VEHICLES_BY_ID } from './vehicles';

const TUNE = [60, 64, 67, 72, 67, 64];

/** An 80-second song at 120 BPM: intro, build, drop, verse, outro, with a tune from the drop on. */
function song(): Analysis {
  const beatMs = 500;
  const durationMs = 80000;
  const beats = Array.from({ length: durationMs / beatMs }, (_, i) => i * beatMs);
  const onsets: Onset[] = beats.flatMap((t, i): Onset[] => [
    ...(i % 2 === 0 ? [{ timeMs: t, strength: 0.9, band: 'low' as const }] : [{ timeMs: t, strength: 0.8, band: 'mid' as const }]),
    { timeMs: t, strength: 0.6, band: 'high' },
    { timeMs: t + 250, strength: 0.5, band: 'high' },
  ]);
  const sec = (startMs: number, endMs: number, kind: SectionKind, energy: number) => ({ startMs, endMs, kind, energy });
  return {
    durationMs,
    bpm: 120,
    beats,
    downbeats: beats.filter((_, i) => i % 4 === 0),
    onsets,
    notes: beats.filter((t) => t >= 24000 && t < 72000).map((t, i) => ({ startMs: t, endMs: t + 400, pitch: TUNE[i % TUNE.length]!, strength: 0.8 })),
    energy: { hopMs: 100, values: [] },
    sections: [sec(0, 16000, 'intro', 0.2), sec(16000, 24000, 'build', 0.55), sec(24000, 56000, 'drop', 0.95), sec(56000, 72000, 'verse', 0.6), sec(72000, 80000, 'outro', 0.2)],
  };
}

const opts = (o: Partial<GenerateOptions> = {}): GenerateOptions => ({ style: 'balanced', intensity: 0.6, closures: true, seed: 1, ...o });
const FRAMES = { stepTimeMs: 20, frameCount: 4000 };

function compile(effects: ReturnType<typeof generateShow>) {
  return compileProject({ ...blankProject(80000), effects });
}

describe('generateShow', () => {
  for (const vehicle of VEHICLES) {
    describe(vehicle.name, () => {
      for (const style of ['balanced', 'party', 'smooth'] as const) {
        it(`${style}: uses only this car's channels and keeps Tesla's closure rules`, () => {
          const effects = generateShow(song(), vehicle, FRAMES, opts({ style, intensity: style === 'party' ? 1 : 0.6 }));
          expect(effects.length).toBeGreaterThan(50);
          const own = new Set(vehicle.channels.map((c) => c.id));
          for (const e of effects) expect(own.has(e.channel), `${e.channel} on ${vehicle.id}`).toBe(true);
          const issues = validate(compile(effects));
          const bad = issues.filter(
            (i) => i.severity === 'error' || ['model-x-pinch', 'dance-before-open', 'closure-limit', 'dance-thermal', 'charge-port-auto-close'].includes(i.code),
          );
          expect(bad.map((i) => `${i.code}: ${i.message}`)).toEqual([]);
        });
      }
    });
  }

  it('flashes no channel more than four times a second', () => {
    const show = compile(generateShow(song(), VEHICLES_BY_ID.get('modelX-2021')!, FRAMES, opts({ style: 'party', intensity: 1 })));
    for (const def of CHANNELS_BY_ID.values()) {
      if (effectFamily(def.id) !== 'light' || /Bar\d/.test(def.id)) continue;
      const onFrames: number[] = [];
      for (let f = 1; f < show.frameCount; f++) {
        const on = (x: number) => show.data[x * show.channelCount + def.index]! >= 128;
        if (on(f) && !on(f - 1)) onFrames.push(f);
      }
      // Any one-second window (50 frames).
      for (let i = 0; i + 4 < onFrames.length; i++) expect(onFrames[i + 4]! - onFrames[i]!, def.id).toBeGreaterThanOrEqual(50);
    }
  });

  it('plans the falcon wings: open into the drop, dance, close before the end', () => {
    const effects = generateShow(song(), VEHICLES_BY_ID.get('modelX-2021')!, FRAMES, opts());
    const left = effects.filter((e) => e.channel === 'leftFalconDoor').map((e) => e.kind);
    expect(left).toEqual(['open', 'dance', 'close']);
  });

  it('leaves closures alone when asked', () => {
    const effects = generateShow(song(), VEHICLES_BY_ID.get('modelX-2021')!, FRAMES, opts({ closures: false }));
    expect(effects.filter((e) => effectFamily(e.channel) === 'closure')).toEqual([]);
  });

  it('stays inside the requested range', () => {
    const effects = generateShow(song(), VEHICLES_BY_ID.get('modelS-2021')!, FRAMES, opts({ startMs: 20000, endMs: 50000 }));
    expect(effects.length).toBeGreaterThan(0);
    for (const e of effects) {
      expect(e.startMs).toBeGreaterThanOrEqual(20000);
      expect(e.endMs).toBeLessThanOrEqual(50000);
    }
  });

  it('is repeatable for a seed, and busier at higher intensity', () => {
    const car = VEHICLES_BY_ID.get('modelY-2020')!;
    const strip = (es: ReturnType<typeof generateShow>) => es.map(({ id: _id, ...rest }) => rest);
    expect(strip(generateShow(song(), car, FRAMES, opts()))).toEqual(strip(generateShow(song(), car, FRAMES, opts())));
    const quiet = generateShow(song(), car, FRAMES, opts({ intensity: 0.1, closures: false })).length;
    const busy = generateShow(song(), car, FRAMES, opts({ intensity: 1, closures: false })).length;
    expect(busy).toBeGreaterThan(quiet);
  });

  it('lights the Cybertruck light bars', () => {
    const effects = generateShow(song(), VEHICLES_BY_ID.get('cybertruck-2024')!, FRAMES, opts());
    const bars = new Set(effects.filter((e) => e.channel.startsWith('frontLightBar')).map((e) => e.channel));
    expect(bars.size).toBe(60);
  });

  it('finds a peak in a song whose loudness barely changes', () => {
    // One long verse, a little louder from 40 s to 60 s.
    const values = Array.from({ length: 800 }, (_, i) => (i >= 400 && i < 600 ? 0.7 : 0.6));
    const flat: Analysis = { ...song(), sections: [{ startMs: 0, endMs: 80000, kind: 'verse', energy: 0.6 }], energy: { hopMs: 100, values } };
    const plan = planSections(flat);
    expect(plan.map((p) => p.kind)).toEqual(['intro', 'verse', 'chorus', 'verse', 'outro']);
    const peak = plan.find((p) => p.kind === 'chorus')!;
    expect(peak.startMs).toBeGreaterThanOrEqual(38000);
    expect(peak.startMs).toBeLessThanOrEqual(46000);
    // And the doors get to move.
    const effects = generateShow(flat, VEHICLES_BY_ID.get('modelX-2021')!, FRAMES, opts());
    expect(effects.some((e) => e.channel === 'leftFalconDoor' && e.kind === 'open')).toBe(true);
  });

  it('copes with a song without beats', () => {
    const quiet: Analysis = { ...song(), bpm: 0, beats: [], downbeats: [], onsets: [], notes: [] };
    const effects = generateShow(quiet, VEHICLES_BY_ID.get('model3-2024')!, FRAMES, opts());
    expect(effects.length).toBeGreaterThan(0);
  });

  /** Exterior lights on in each frame of a compiled show. */
  function litPerFrame(vehicleId: string, o: Partial<GenerateOptions> = {}) {
    const car = VEHICLES_BY_ID.get(vehicleId)!;
    const show = compile(generateShow(song(), car, FRAMES, opts({ closures: false, ...o })));
    const lights = car.channels.filter((c) => c.kind !== 'closure' && c.kind !== 'rgb').map((c) => CHANNELS_BY_ID.get(c.id)!);
    const on = (f: number, id: string) => show.data[f * show.channelCount + CHANNELS_BY_ID.get(id)!.index]! >= 128;
    const counts = Array.from({ length: show.frameCount }, (_, f) => lights.filter((d) => show.data[f * show.channelCount + d.index]! >= 128).length);
    return { counts, on, frame: (ms: number) => Math.round(ms / 20) };
  }

  for (const id of ['modelS-2021', 'model3-2024', 'cybertruck-2024']) {
    it(`leaves ${id} dark between hits, with a few lights at a time`, () => {
      const { counts } = litPerFrame(id);
      const dark = counts.filter((c) => c === 0).length / counts.length;
      const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
      expect(dark).toBeGreaterThan(0.25);
      expect(mean).toBeLessThan(id.startsWith('cybertruck') ? 16 : 5);
    });
  }

  it('lights the same lights on every kick of a section', () => {
    const { on, frame } = litPerFrame('modelS-2021');
    // Kicks every other beat through the verse (56-72 s).
    for (let t = 56000; t < 72000; t += 1000) {
      expect(on(frame(t + 40), 'leftInnerMainBeam') && on(frame(t + 40), 'rightInnerMainBeam'), `kick at ${t}`).toBe(true);
    }
  });

  it('alternates the snare between left and right', () => {
    const { on, frame } = litPerFrame('modelS-2021');
    const sides = [];
    for (let t = 56500; t < 60000; t += 1000) sides.push(on(frame(t + 40), 'leftFrontTurn') ? 'L' : on(frame(t + 40), 'rightFrontTurn') ? 'R' : '-');
    expect(sides.join('')).toMatch(/^(LR)+$|^(RL)+$/);
  });

  it('holds a light for each note, and higher notes climb the ladder', () => {
    const car = VEHICLES_BY_ID.get('modelS-2021')!;
    const { on, frame } = litPerFrame('modelS-2021');
    const rungs = ['Channel6', 'Channel5', 'Channel4', 'Signature'];
    const rungAt = (ms: number) => rungs.findIndex((r) => on(frame(ms), `left${r}`) && on(frame(ms), `right${r}`));
    const notes = song().notes.filter((n) => n.startMs >= 56000 && n.startMs < 62000);
    const seen = new Map<number, number>();
    for (const n of notes) {
      const rung = rungAt(n.startMs + 200);
      expect(rung, `note at ${n.startMs}`).toBeGreaterThanOrEqual(0);
      // Held to the end of the note, off as the next one starts.
      expect(on(frame(n.endMs - 40), `left${rungs[rung]}`)).toBe(true);
      expect(on(frame(n.endMs + 90), `left${rungs[rung]}`)).toBe(false);
      seen.set(n.pitch, rung);
    }
    expect(car.channels.some((c) => c.id === 'leftChannel6')).toBe(true);
    // Monotonic either way up (variations can flip the ladder).
    const order = [60, 64, 67, 72].map((p) => seen.get(p)!);
    const up = order.every((r, i) => i === 0 || r >= order[i - 1]!);
    const down = order.every((r, i) => i === 0 || r <= order[i - 1]!);
    expect(up || down).toBe(true);
    expect(order[0]).not.toBe(order[3]);
  });

  it('plays the tune on the Cybertruck front bar, mirrored, further out for higher notes', () => {
    const { on, frame } = litPerFrame('cybertruck-2024', { seed: 3 });
    const lit = (ms: number) => Array.from({ length: 60 }, (_, i) => on(frame(ms), `frontLightBar${i + 1}`));
    const reach = (ms: number) => {
      const l = lit(ms);
      for (let i = 0; i < 30; i++) expect(l[i], `mirrored at ${ms}`).toBe(l[59 - i]);
      return l.findIndex(Boolean);
    };
    const low = song().notes.find((n) => n.startMs >= 56000 && n.pitch === 60)!;
    const high = song().notes.find((n) => n.startMs >= 56000 && n.pitch === 72)!;
    expect(reach(low.startMs + 200)).not.toBe(reach(high.startMs + 200));
  });

  it('choreographs a repeated chorus the same way both times', () => {
    const a: Analysis = {
      ...song(),
      sections: [
        { startMs: 0, endMs: 16000, kind: 'verse', energy: 0.5 },
        { startMs: 16000, endMs: 32000, kind: 'chorus', energy: 0.9 },
        { startMs: 32000, endMs: 48000, kind: 'verse', energy: 0.5 },
        { startMs: 48000, endMs: 64000, kind: 'chorus', energy: 0.9 },
        { startMs: 64000, endMs: 80000, kind: 'outro', energy: 0.2 },
      ],
      // The same tune in both choruses.
      notes: song()
        .beats.filter((t) => (t >= 16000 && t < 32000) || (t >= 48000 && t < 64000))
        .map((t) => ({ startMs: t, endMs: t + 400, pitch: TUNE[((t % 32000) / 500) % TUNE.length]!, strength: 0.8 })),
    };
    const effects = generateShow(a, VEHICLES_BY_ID.get('modelX-2021')!, FRAMES, opts({ closures: false }));
    const within = (from: number, to: number) =>
      effects
        .filter((e) => e.startMs >= from && e.startMs < to)
        .map((e) => `${e.channel} ${e.kind} ${e.startMs - from} ${e.endMs - from}`)
        .sort();
    expect(within(48000, 63000)).toEqual(within(16000, 31000));
  });

  it('says which lights follow which sounds', () => {
    const s = musicMap(VEHICLES_BY_ID.get('modelS-2021')!);
    expect(s.map((r) => r.sound)).toEqual(['Kick drum', 'Snare and claps', 'Hi-hats', 'Melody', 'Drops']);
    expect(s[0]!.lights).toMatch(/inner main beams/i);
    const ct = musicMap(VEHICLES_BY_ID.get('cybertruck-2024')!);
    expect(ct.find((r) => r.sound === 'Melody')!.lights).toMatch(/front light bar/i);
    // Model 3/Y: channels 4-6 are one light, so the ladder has two rungs.
    const m3 = musicMap(VEHICLES_BY_ID.get('model3-2024')!);
    expect(m3.find((r) => r.sound === 'Melody')).toBeDefined();
  });
});
