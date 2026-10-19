// Auto-generated shows: choreography from the music analysis (analysis.ts)
// for one vehicle's lights and closures.
//
// Each section of the song gets a treatment that matches its energy: quiet
// intros and breaks breathe with slow ramps, verses follow the drums, builds
// chase faster and faster, and drops and choruses use everything. Hits are
// mapped by sound: kicks to the main beams and fogs, snares to the turn
// signals, hi-hats to quick chases. A closure planner times the big moves
// (falcon wings, windows, mirrors, liftgate, charge port) to the song's
// structure while staying inside Tesla's command limits and never moving
// windows while doors move.
//
// Layers are painted frame by frame (later layers win), then turned back into
// effects, so the result is ordinary editable effects.

import type { Analysis, Onset, Section, SectionKind } from './analysis';
import { CHANNELS_BY_ID } from './channels';
import { newEffectId, type Effect, type EffectKind } from './project';
import type { VehicleProfile } from './vehicles';

export type StyleId = 'balanced' | 'party' | 'smooth';

export const STYLES: Record<StyleId, { label: string; hint: string }> = {
  balanced: { label: 'Balanced', hint: 'Follows the beat, builds to the big moments' },
  party: { label: 'Party', hint: 'Every hit, chases and strobes, lots of door action' },
  smooth: { label: 'Smooth', hint: 'Fades and sweeps; fewer flashes' },
};

export interface GenerateOptions {
  style: StyleId;
  /** 0..1: how busy the lights are. */
  intensity: number;
  /** Plan doors, windows, mirrors, liftgate and charge port moves. */
  closures: boolean;
  /** Variations: the same seed gives the same show. */
  seed: number;
  /** Only generate in this time range (the export range). */
  startMs?: number;
  endMs?: number;
}

export const DEFAULT_OPTIONS: GenerateOptions = { style: 'balanced', intensity: 0.6, closures: true, seed: 1 };

/** Separate hits on one channel are at least this far apart. */
const MIN_FLASH_PERIOD_MS = 250;
/**
 * Strobes flash no faster than about three times a second, the usual
 * photosensitivity guidance; with a hit just before, that still stays
 * under four flashes in any second.
 */
const MIN_STROBE_PERIOD_MS = 320;

export function generateShow(
  analysis: Analysis,
  profile: VehicleProfile,
  frames: { stepTimeMs: number; frameCount: number },
  options: GenerateOptions = DEFAULT_OPTIONS,
): Effect[] {
  const startMs = Math.max(0, options.startMs ?? 0);
  const endMs = Math.min(frames.frameCount * frames.stepTimeMs, options.endMs ?? Infinity, analysis.durationMs);
  const ctx = new Choreographer(analysis, profile, frames.stepTimeMs, startMs, endMs, options);
  ctx.lights();
  if (options.closures) ctx.closures();
  return ctx.painter.toEffects();
}

// --- Painting ---------------------------------------------------------------

/** Per-channel frame timelines; later paint wins. */
class Painter {
  private readonly tracks = new Map<string, Int32Array>();
  private readonly codes: { kind: EffectKind; periodMs?: number }[] = [{ kind: 'on' }];
  private readonly codeIndex = new Map<string, number>();

  constructor(
    private readonly stepTimeMs: number,
    private readonly startFrame: number,
    private readonly endFrame: number,
  ) {}

  paint(channel: string, startMs: number, endMs: number, kind: EffectKind | 'off', periodMs?: number): void {
    const a = Math.max(this.startFrame, Math.round(startMs / this.stepTimeMs));
    const b = Math.min(this.endFrame, Math.round(endMs / this.stepTimeMs));
    if (b <= a) return;
    let track = this.tracks.get(channel);
    if (!track) this.tracks.set(channel, (track = new Int32Array(this.endFrame - this.startFrame)));
    const code = kind === 'off' ? 0 : this.code(kind, periodMs);
    track.fill(code, a - this.startFrame, b - this.startFrame);
  }

  /** Whether a channel has anything painted in a range. */
  busy(channel: string, startMs: number, endMs: number): boolean {
    const track = this.tracks.get(channel);
    if (!track) return false;
    const a = Math.max(0, Math.round(startMs / this.stepTimeMs) - this.startFrame);
    const b = Math.min(track.length, Math.round(endMs / this.stepTimeMs) - this.startFrame);
    for (let i = a; i < b; i++) if (track[i]) return true;
    return false;
  }

  private code(kind: EffectKind, periodMs?: number): number {
    const key = `${kind}|${periodMs ?? ''}`;
    let c = this.codeIndex.get(key);
    if (c === undefined) {
      c = this.codes.length;
      this.codes.push({ kind, ...(periodMs ? { periodMs } : {}) });
      this.codeIndex.set(key, c);
    }
    return c;
  }

  toEffects(): Effect[] {
    const out: Effect[] = [];
    for (const [channel, track] of this.tracks) {
      let runStart = 0;
      for (let i = 1; i <= track.length; i++) {
        if (i < track.length && track[i] === track[runStart]) continue;
        const code = track[runStart]!;
        if (code) {
          const { kind, periodMs } = this.codes[code]!;
          out.push({
            id: newEffectId(),
            channel,
            startMs: (this.startFrame + runStart) * this.stepTimeMs,
            endMs: (this.startFrame + i) * this.stepTimeMs,
            kind,
            ...(periodMs ? { periodMs } : {}),
          });
        }
        runStart = i;
      }
    }
    return out.sort((a, b) => a.startMs - b.startMs || a.channel.localeCompare(b.channel));
  }
}

/** Deterministic random numbers (mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The sections a show is built on, clipped to a range. A song whose loudness
 * barely changes comes back from the analysis as one long section; then its
 * loudest stretch becomes the peak (so the big moves still happen), with a
 * short intro and outro around it.
 */
export function planSections(a: Analysis, startMs = 0, endMs = a.durationMs): Section[] {
  let list = a.sections.map((s) => ({ ...s, startMs: Math.max(s.startMs, startMs), endMs: Math.min(s.endMs, endMs) }));
  list = list.filter((s) => s.endMs - s.startMs > 200);
  if (list.some((s) => LEVELS[s.kind] === 'high')) return list;
  const length = endMs - startMs;
  if (length < 8000) return list.length ? list : [{ startMs, endMs, kind: 'verse', energy: 0.5 }];
  const { hopMs, values } = a.energy;
  const windowMs = Math.min(30000, length * 0.4);
  // The loudest window, searched in one-second steps.
  let best = startMs + (length - windowMs) / 2;
  let top = -1;
  for (let t = startMs + length * 0.15; t + windowMs <= endMs - length * 0.1; t += 1000) {
    let sum = 0;
    const i0 = Math.floor(t / hopMs);
    const i1 = Math.floor((t + windowMs) / hopMs);
    for (let i = i0; i < i1 && i < values.length; i++) sum += values[i]!;
    if (sum > top) {
      top = sum;
      best = t;
    }
  }
  const snap = (t: number) => a.downbeats.find((d) => d >= t) ?? t;
  const peakStart = snap(best);
  const peakEnd = Math.min(endMs, snap(best + windowMs));
  const introEnd = Math.min(peakStart, snap(startMs + Math.min(8000, length * 0.12)));
  const outroStart = Math.max(peakEnd, endMs - Math.min(8000, length * 0.12));
  const sec = (s: number, e: number, kind: SectionKind, energy: number): Section[] => (e - s > 200 ? [{ startMs: s, endMs: e, kind, energy }] : []);
  return [
    ...sec(startMs, introEnd, 'intro', 0.3),
    ...sec(introEnd, peakStart, 'verse', 0.6),
    ...sec(peakStart, peakEnd, 'chorus', 0.9),
    ...sec(peakEnd, outroStart, 'verse', 0.6),
    ...sec(outroStart, endMs, 'outro', 0.3),
  ];
}

// --- Choreography -----------------------------------------------------------

type Level = 'low' | 'mid' | 'high';

const LEVELS: Record<SectionKind, Level> = {
  intro: 'low',
  outro: 'low',
  break: 'low',
  verse: 'mid',
  build: 'mid',
  chorus: 'high',
  drop: 'high',
};

class Choreographer {
  readonly painter: Painter;
  private readonly rnd: () => number;
  private readonly has: (id: string) => boolean;
  private readonly ramps: (id: string) => boolean;
  private readonly beatMs: number;
  private readonly busyness: number;

  constructor(
    private readonly a: Analysis,
    profile: VehicleProfile,
    stepTimeMs: number,
    private readonly startMs: number,
    private readonly endMs: number,
    private readonly opts: GenerateOptions,
  ) {
    this.painter = new Painter(stepTimeMs, Math.round(startMs / stepTimeMs), Math.round(endMs / stepTimeMs));
    this.rnd = random(opts.seed);
    const ids = new Map(profile.channels.map((c) => [c.id, c]));
    this.has = (id) => ids.has(id);
    this.ramps = (id) => ids.get(id)?.kind === 'ramping';
    this.beatMs = a.bpm > 0 ? 60000 / a.bpm : 500;
    const styleBoost = opts.style === 'party' ? 0.25 : opts.style === 'smooth' ? -0.25 : 0;
    this.busyness = Math.min(1, Math.max(0, opts.intensity + styleBoost));
  }

  /** Left/right channels for a base name, those this car has. */
  private pair(base: string): string[] {
    return [`left${base}`, `right${base}`].filter(this.has);
  }

  private only(...ids: string[]): string[] {
    return ids.filter(this.has);
  }

  /** Light flash: on, then a quick fade where the channel can ramp. */
  private flash(ids: string[], t: number, lengthMs: number, fade = true): void {
    for (const id of ids) {
      this.painter.paint(id, t, t + lengthMs, 'on');
      if (fade && this.ramps(id)) this.painter.paint(id, t + lengthMs, t + lengthMs + 500, 'off500');
      else this.painter.paint(id, t + lengthMs, t + lengthMs + 20, 'off');
    }
  }

  /** Steady light with slow ramps in and out where the channel can ramp. */
  private hold(ids: string[], start: number, end: number, rampMs: 0 | 500 | 1000 | 2000 = 1000): void {
    for (const id of ids) {
      if (rampMs && this.ramps(id) && end - start > rampMs * 1.5) {
        this.painter.paint(id, start, start + rampMs, `on${rampMs}` as EffectKind);
        this.painter.paint(id, start + rampMs, end - rampMs, 'on');
        this.painter.paint(id, end - rampMs, end, `off${rampMs}` as EffectKind);
      } else {
        this.painter.paint(id, start, end, 'on');
      }
    }
  }

  private beatsIn(s: { startMs: number; endMs: number }): number[] {
    return this.a.beats.filter((b) => b >= s.startMs && b < s.endMs && b >= this.startMs && b < this.endMs);
  }

  private barsIn(s: { startMs: number; endMs: number }): number[] {
    return this.a.downbeats.filter((b) => b >= s.startMs && b < s.endMs && b >= this.startMs && b < this.endMs);
  }

  private hitsIn(s: { startMs: number; endMs: number }, band: Onset['band'], minStrength: number): Onset[] {
    const out: Onset[] = [];
    let last = -Infinity;
    for (const o of this.a.onsets) {
      if (o.band !== band || o.timeMs < s.startMs || o.timeMs >= s.endMs || o.timeMs < this.startMs || o.timeMs >= this.endMs) continue;
      if (o.strength < minStrength || o.timeMs - last < MIN_FLASH_PERIOD_MS) continue;
      out.push(o);
      last = o.timeMs;
    }
    return out;
  }

  private planned: Section[] | undefined;

  private sections(): Section[] {
    return (this.planned ??= planSections(this.a, this.startMs, this.endMs));
  }

  lights(): void {
    const smooth = this.opts.style === 'smooth';
    for (const s of this.sections()) {
      const level = LEVELS[s.kind];
      // Base: the signature lights frame every section, like a car "awake".
      this.hold(this.pair('Signature'), s.startMs, s.endMs, level === 'low' ? 2000 : 1000);
      if (level === 'low') this.calm(s);
      else if (s.kind === 'build') this.build(s);
      else if (level === 'mid') this.groove(s, smooth);
      else this.peak(s, smooth);
      this.cybertruckBars(s, level);
      this.interior(s, level);
    }
  }

  /** Intros, breaks and outros: slow breathing on the tails and park lights, bar by bar. */
  private calm(s: Section): void {
    const bars = this.barsIn(s);
    const barMs = this.beatMs * 4;
    const breathers = [...this.pair('AuxPark'), ...this.pair('Tail'), ...this.pair('Channel4')];
    bars.forEach((t, i) => {
      if (i % 2 === 0) this.hold(breathers, t, Math.min(t + barMs * 2, s.endMs), 2000);
    });
    // A soft accent on the first beat of every other bar.
    if (this.busyness > 0.4) {
      for (const [i, t] of bars.entries()) if (i % 2 === 1) this.flash(this.pair('Channel6'), t, this.beatMs * 0.75);
    }
  }

  /** Verses: lights follow the drums. */
  private groove(s: Section, smooth: boolean): void {
    const pulse = Math.min(220, this.beatMs * 0.45);
    const kicks = this.hitsIn(s, 'low', 0.55 - this.busyness * 0.3);
    let side = this.rnd() < 0.5 ? 0 : 1;
    for (const k of kicks) {
      const beams = this.pair('InnerMainBeam');
      this.flash(smooth ? beams : [beams[side % beams.length]!].filter(Boolean), k.timeMs, pulse, true);
      side++;
    }
    for (const sn of this.hitsIn(s, 'mid', 0.6 - this.busyness * 0.3)) {
      this.flash([...this.pair('FrontTurn'), ...this.pair('RearTurn')], sn.timeMs, pulse * 0.8, false);
    }
    // Tail lights on every beat; brake light on bar starts.
    for (const b of this.beatsIn(s)) this.flash(this.pair('Tail'), b, pulse);
    for (const b of this.barsIn(s)) this.flash(this.only('brakeLights'), b, this.beatMs * 0.9);
    if (this.busyness > 0.5) this.sweep(s, 'up');
  }

  /** Builds: a chase across the headlight segments that speeds up toward the drop. */
  private build(s: Section): void {
    const chain = [...this.pair('Channel6'), ...this.pair('Channel5'), ...this.pair('Channel4'), ...this.pair('OuterMainBeam')];
    const steps = ['Channel6', 'Channel5', 'Channel4', 'OuterMainBeam'].map((b) => this.pair(b)).filter((x) => x.length);
    if (!steps.length) return this.groove(s, false);
    const length = s.endMs - s.startMs;
    let t = s.startMs;
    let i = 0;
    while (t < s.endMs) {
      const progress = (t - s.startMs) / length;
      // Quarter notes, then eighths for the second half.
      const step = Math.max(MIN_FLASH_PERIOD_MS, progress < 0.5 ? this.beatMs : this.beatMs / 2);
      this.flash(steps[i % steps.length]!, t, step * 0.8, false);
      t += step;
      i++;
    }
    // The last bar: everything ramps up for the drop.
    const lastBar = Math.max(s.startMs, s.endMs - this.beatMs * 4);
    this.hold(chain, lastBar, s.endMs, 0);
    for (const id of this.pair('FrontFog')) this.painter.paint(id, lastBar, s.endMs, 'strobe', Math.max(MIN_STROBE_PERIOD_MS, this.beatMs / 2));
    for (const b of this.beatsIn(s)) this.flash(this.pair('Tail'), b, Math.min(200, this.beatMs * 0.4));
  }

  /** Choruses and drops: full beams on kicks, turn signals on snares, chases on hi-hats, big hits on bar starts. */
  private peak(s: Section, smooth: boolean): void {
    const pulse = Math.min(200, this.beatMs * 0.4);
    const beams = [...this.pair('OuterMainBeam'), ...this.pair('InnerMainBeam')];
    const fogs = this.pair('FrontFog');
    for (const k of this.hitsIn(s, 'low', 0.45 - this.busyness * 0.3)) this.flash([...beams, ...fogs], k.timeMs, pulse);
    for (const sn of this.hitsIn(s, 'mid', 0.5 - this.busyness * 0.3)) {
      this.flash([...this.pair('FrontTurn'), ...this.pair('RearTurn'), ...this.pair('SideRepeater')], sn.timeMs, pulse, false);
    }
    if (!smooth) {
      // Hi-hats chase left/right across the small front segments.
      const chase = [this.pair('Channel6'), this.pair('Channel5'), this.pair('Channel4')].filter((x) => x.length);
      let i = 0;
      for (const h of this.hitsIn(s, 'high', 0.7 - this.busyness * 0.4)) {
        if (chase.length) this.flash(chase[i++ % chase.length]!, h.timeMs, Math.min(150, this.beatMs * 0.3), false);
      }
    } else {
      this.sweep(s, 'out');
    }
    // Bar starts: a hit on everything at the back.
    for (const b of this.barsIn(s)) {
      this.flash([...this.only('brakeLights', 'reverseLights', 'rearFog', 'licensePlate'), ...this.pair('Tail')], b, this.beatMs * 0.5);
    }
    // Side markers and aux park hold on through the section.
    this.hold([...this.pair('SideMarker'), ...this.pair('AuxPark')], s.startMs, s.endMs, 500);
    if (!smooth && this.busyness > 0.75) {
      // At top intensity, the fogs strobe on the last bar of each phrase.
      const bars = this.barsIn(s);
      for (let i = 3; i < bars.length; i += 4) {
        for (const id of fogs) this.painter.paint(id, bars[i]!, bars[i]! + this.beatMs * 4, 'strobe', Math.max(MIN_STROBE_PERIOD_MS, this.beatMs / 2));
      }
    }
  }

  /** A slow sweep across the headlight segments, a bar per pass. */
  private sweep(s: Section, direction: 'up' | 'out'): void {
    const order = direction === 'up' ? ['Channel6', 'Channel5', 'Channel4'] : ['Channel4', 'Channel5', 'Channel6'];
    const steps = order.map((b) => this.pair(b)).filter((x) => x.length);
    if (!steps.length) return;
    for (const bar of this.barsIn(s)) {
      steps.forEach((ids, i) => this.hold(ids, bar + i * this.beatMs, bar + (i + 1) * this.beatMs + this.beatMs * 0.5, 500));
    }
  }

  /** Cybertruck light bars: a scanner in verses, fills from the center on bar starts at the peaks, a glow when calm. */
  private cybertruckBars(s: Section, level: Level): void {
    for (const [base, count] of [
      ['frontLightBar', 60],
      ['rearLightBar', 52],
    ] as const) {
      if (!this.has(`${base}1`)) continue;
      const led = (i: number) => `${base}${i + 1}`;
      if (level === 'low') {
        for (let i = 0; i < count; i += 3) this.hold([led(i)], s.startMs, s.endMs, 0);
      } else if (level === 'mid') {
        // A block of LEDs bouncing end to end, one sweep per beat.
        const width = 6;
        let dir = 1;
        let pos = 0;
        for (const b of this.beatsIn(s)) {
          const steps = 6;
          for (let k = 0; k < steps; k++) {
            const t = b + (k * this.beatMs) / steps;
            const at = Math.round(pos + (dir * k * (count - width)) / steps);
            for (let i = 0; i < width; i++) this.painter.paint(led(Math.min(count - 1, Math.max(0, at + i))), t, t + this.beatMs / steps + 20, 'on');
          }
          pos = dir > 0 ? count - width : 0;
          dir = -dir;
        }
      } else {
        // On each bar start the bar fills outward from the center, then empties.
        for (const bar of this.barsIn(s)) {
          const fill = this.beatMs * 2;
          for (let i = 0; i < count / 2; i++) {
            const t = bar + (i / (count / 2)) * fill * 0.5;
            this.painter.paint(led(count / 2 - 1 - i), t, bar + fill, 'on');
            this.painter.paint(led(count / 2 + i), t, bar + fill, 'on');
          }
        }
        for (const k of this.hitsIn(s, 'low', 0.6)) {
          for (let i = 0; i < count; i++) this.painter.paint(led(i), k.timeMs, k.timeMs + 120, 'on');
        }
      }
    }
  }

  /** The interior light changes color with the song's sections: blue when calm, purple, then red at the peaks. */
  private interior(s: Section, level: Level): void {
    const colors: Record<Level, ('Red' | 'Green' | 'Blue')[]> = { low: ['Blue'], mid: ['Red', 'Blue'], high: ['Red'] };
    for (const base of ['centerFrontDisplay', 'leftFrontAccent', 'rightFrontAccent', 'centerFrontAccent', 'leftRearAccent', 'rightRearAccent']) {
      for (const c of colors[level]) if (this.has(`${base}${c}`)) this.painter.paint(`${base}${c}`, s.startMs, s.endMs, 'on');
    }
  }

  // --- Closures -------------------------------------------------------------

  closures(): void {
    const sections = this.sections();
    const peaks = sections.filter((s) => LEVELS[s.kind] === 'high');
    const firstPeak = peaks[0];
    const lastPeak = peaks[peaks.length - 1];
    const party = this.opts.style === 'party';
    const showEnd = this.endMs;
    /** Spans when doors move, so windows can stay out of them. */
    const doorMotion: [number, number][] = [];
    const seconds = (id: string, which: 'openSeconds' | 'closeSeconds') => (CHANNELS_BY_ID.get(id)?.closure?.[which] ?? 5) * 1000;
    const cmd = (id: string, t: number, kind: EffectKind, lengthMs = 500) => this.painter.paint(id, t, Math.min(showEnd, t + lengthMs), kind);
    const snap = (t: number) => this.a.downbeats.find((d) => d >= t) ?? t;

    // Doors: open into the first peak, dance through the biggest one, close for the outro.
    const falcons = this.pair('FalconDoor');
    const fronts = this.pair('FrontDoor');
    for (const doors of [falcons, fronts]) {
      if (!doors.length || !firstPeak) continue;
      const openMs = seconds(doors[0]!, 'openSeconds');
      const closeMs = seconds(doors[0]!, 'closeSeconds');
      const openAt = snap(Math.max(this.startMs, firstPeak.startMs - openMs * 0.5));
      const closeAt = Math.max(openAt + openMs + 2000, Math.min(lastPeak!.endMs, showEnd - closeMs - 1000));
      if (closeAt + closeMs > showEnd || closeAt <= openAt + openMs) continue;
      for (const id of doors) cmd(id, openAt, 'open');
      doorMotion.push([openAt, openAt + openMs]);
      const dances = CHANNELS_BY_ID.get(doors[0]!)?.closure?.supportsDance;
      const biggest = peaks.reduce((a, b) => (b.energy * (b.endMs - b.startMs) > a.energy * (a.endMs - a.startMs) ? b : a), firstPeak);
      const danceStart = snap(Math.max(openAt + openMs + 500, biggest.startMs));
      const danceEnd = Math.min(biggest.endMs, danceStart + (party ? 24000 : 14000), closeAt - 1000);
      if (dances && danceEnd - danceStart > 3000) {
        for (const id of doors) cmd(id, danceStart, 'dance', danceEnd - danceStart);
        doorMotion.push([danceStart, danceEnd]);
      }
      for (const id of doors) cmd(id, closeAt, 'close');
      doorMotion.push([closeAt, closeAt + closeMs]);
    }
    const doorsMoving = (a: number, b: number) => doorMotion.some(([x, y]) => a < y + 1000 && b > x - 1000);

    // Windows: dance in a peak while the doors are still.
    const windows = this.only('leftFrontWindow', 'rightFrontWindow', 'leftRearWindow', 'rightRearWindow');
    if (windows.length) {
      const free = peaks.find((p) => {
        const end = Math.min(p.endMs, p.startMs + 12000);
        return end - p.startMs > 4000 && !doorsMoving(p.startMs, end + seconds(windows[0]!, 'closeSeconds'));
      });
      if (free) {
        const start = snap(free.startMs);
        const end = Math.min(free.endMs, start + (party ? 12000 : 8000));
        for (const id of windows) {
          cmd(id, start, 'dance', end - start);
          cmd(id, end, 'close');
        }
      }
    }

    // Mirrors: fold at the start of each build and unfold for the drop (up to Tesla's 20 moves).
    const mirrors = this.pair('Mirror');
    if (mirrors.length) {
      let moves = 0;
      let lastMove = -Infinity;
      for (const s of sections) {
        if (moves + 2 > 18) break;
        if (s.kind !== 'build') continue;
        const fold = snap(s.startMs);
        const unfold = snap(s.endMs - this.beatMs * 2);
        if (unfold - fold < 3000 || fold - lastMove < 3000) continue;
        lastMove = unfold;
        for (const id of mirrors) {
          cmd(id, fold, 'close');
          cmd(id, unfold, 'open');
        }
        moves += 2;
      }
    }

    // Door handles (Model S): present on bar starts in the peaks, a few times.
    for (const id of this.only('leftFrontDoorHandle', 'rightFrontDoorHandle', 'leftRearDoorHandle', 'rightRearDoorHandle')) {
      let moves = 0;
      for (const p of peaks) {
        for (const bar of this.barsIn(p).filter((_, i) => i % 4 === 0)) {
          if (moves + 2 > 18) break;
          cmd(id, bar, 'open');
          cmd(id, bar + this.beatMs * 4, 'close');
          moves += 2;
        }
      }
    }

    // Liftgate (or frunk): opens for the biggest moment if there's time, with a dance in party style.
    if (this.has('liftgate') && lastPeak && this.busyness > 0.3) {
      const openMs = seconds('liftgate', 'openSeconds');
      const closeMs = seconds('liftgate', 'closeSeconds');
      const openAt = snap(Math.max(this.startMs, lastPeak.startMs - openMs));
      const closeAt = Math.min(showEnd - closeMs - 1000, lastPeak.endMs + 2000);
      if (closeAt - openAt > openMs + 3000) {
        cmd('liftgate', openAt, 'open');
        if (party && closeAt - (openAt + openMs) > 5000) cmd('liftgate', openAt + openMs + 500, 'dance', Math.min(10000, closeAt - openAt - openMs - 1500));
        cmd('liftgate', closeAt, 'close');
      }
    }

    // Charge port: opens on the first drop and closes when it ends (it closes itself after 2 minutes anyway).
    if (this.has('chargePort') && firstPeak) {
      const openAt = snap(firstPeak.startMs);
      const closeAt = Math.min(firstPeak.endMs, openAt + 60000, showEnd - 3000);
      if (closeAt - openAt > 4000) {
        cmd('chargePort', openAt, 'open');
        cmd('chargePort', closeAt, 'close');
      }
    }
  }
}
