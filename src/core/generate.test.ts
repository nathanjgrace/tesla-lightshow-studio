import { describe, expect, it } from 'vitest';
import type { Analysis, Onset, SectionKind } from './analysis';
import { CHANNELS_BY_ID } from './channels';
import { generateShow, planSections, type GenerateOptions } from './generate';
import { blankProject, compileProject, effectFamily } from './project';
import { validate } from './validate';
import { VEHICLES, VEHICLES_BY_ID } from './vehicles';

/** An 80-second song at 120 BPM: intro, build, drop, verse, outro. */
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
    const quiet: Analysis = { ...song(), bpm: 0, beats: [], downbeats: [], onsets: [] };
    const effects = generateShow(quiet, VEHICLES_BY_ID.get('model3-2024')!, FRAMES, opts());
    expect(effects.length).toBeGreaterThan(0);
  });
});
