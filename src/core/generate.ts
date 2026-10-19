// Auto-generated shows: choreography from the music analysis (analysis.ts)
// for one vehicle's lights and closures.
//
// The aim is a show where you can see the music. So the car stays dark
// between sounds, and each part of the music has its own lights for the
// whole show (see `instruments`): the kick drum flashes the main beams and
// tails, snares alternate the turn signals left and right, hi-hats tick the
// small lights in choruses, and the melody climbs a ladder of headlight
// segments (or the Cybertruck's light bar), each light held as long as its
// note. Sections change how much plays, not what plays what: intros and
// breaks carry the tune alone, builds chase up the ladder faster and faster,
// and a drop lands with every light at once after a moment of darkness.
// Each kind of section is choreographed the same way every time, so the
// second chorus looks like the first. A closure planner times the big moves
// (falcon wings, windows, mirrors, liftgate, charge port) to the song's
// structure while staying inside Tesla's command limits and never moving
// windows while doors move.
//
// Layers are painted frame by frame (later layers win), then turned back into
// effects, so the result is ordinary editable effects.

import type { Analysis, Note, Onset, Section, SectionKind } from './analysis';
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

const hashKind = (kind: SectionKind) => [...kind].reduce((h, c) => h + c.charCodeAt(0), 0);

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

/** Lights start a frame early: a light that's on as the sound lands reads as on the beat. */
const LEAD_MS = 20;

/**
 * Which lights play which part of the music on a car. Each sound keeps its
 * lights for the whole show, so a viewer learns within a few bars that
 * "those lights are the kick drum".
 */
interface Instruments {
  /** Kick drum: these flash together, front and back. */
  kick: string[];
  /** Added on kicks in choruses and drops. */
  bigKick: string[];
  /** Snares and claps: left, then right, in turn. */
  snare: [string[], string[]];
  /** Hi-hats, in choruses and drops: left and right in turn. */
  hat?: [string[], string[]];
  /** Melody, lowest to highest: each rung is a set lit together. */
  melody: string[][];
  /** Light bar LED ids, left end to right end, when the car has them. */
  frontBar?: string[];
  rearBar?: string[];
}

const LADDER = ['Channel6', 'Channel5', 'Channel4', 'Signature'];
const HAT_CHOICES = ['AuxPark', 'FrontFog', 'SideMarker'];

function instruments(profile: VehicleProfile): Instruments {
  const ids = new Set(profile.channels.map((c) => c.id));
  const pair = (base: string) => [`left${base}`, `right${base}`].filter((id) => ids.has(id));
  const only = (...list: string[]) => list.filter((id) => ids.has(id));
  const grouped = (a: string, b: string) => profile.orGroups.some((g) => g.inputs.includes(a) && g.inputs.includes(b));
  const bar = (base: string, count: number) => (ids.has(`${base}1`) ? Array.from({ length: count }, (_, i) => `${base}${i + 1}`) : undefined);
  const frontBar = bar('frontLightBar', 60);
  const rearBar = bar('rearLightBar', 52);
  const cybertruck = profile.model === 'cybertruck';

  // Rungs that light separately: Model 3/Y wire channels 4-6 as one light.
  const melody: string[][] = [];
  for (const base of LADDER) {
    const rung = pair(base);
    if (!rung.length) continue;
    if (melody.some((r) => grouped(r[0]!, rung[0]!))) continue;
    melody.push(rung);
  }
  const hatBase = HAT_CHOICES.find((base) => {
    const [l, r] = [`left${base}`, `right${base}`];
    return ids.has(l) && ids.has(r) && !grouped(l, r);
  });
  return {
    kick: [...pair('InnerMainBeam'), ...(cybertruck ? [] : pair('Tail'))],
    bigKick: [...pair('OuterMainBeam'), ...only('brakeLights')],
    snare: [only('leftFrontTurn', 'leftRearTurn', 'leftSideRepeater'), only('rightFrontTurn', 'rightRearTurn', 'rightSideRepeater')],
    ...(hatBase ? { hat: [[`left${hatBase}`], [`right${hatBase}`]] as [string[], string[]] } : {}),
    melody: frontBar ? [] : melody,
    ...(frontBar ? { frontBar } : {}),
    ...(rearBar ? { rearBar } : {}),
  };
}

const NAMES: Record<string, string> = {
  InnerMainBeam: 'inner main beams',
  OuterMainBeam: 'outer main beams',
  Tail: 'tail lights',
  brakeLights: 'brake lights',
  FrontTurn: 'turn signals',
  AuxPark: 'aux park lights',
  FrontFog: 'fog lights',
  SideMarker: 'side markers',
  Signature: 'signature lights',
};

/** In words: which lights follow which part of the music on this car, for the generate panel. */
export function musicMap(profile: VehicleProfile): { sound: string; lights: string }[] {
  const ins = instruments(profile);
  const name = (id: string) => NAMES[id.replace(/^(left|right)/, '')] ?? CHANNELS_BY_ID.get(id)?.name.replace(/^(Left|Right) /, '').toLowerCase() ?? id;
  const list = (ids: string[]) => {
    const names = [...new Set(ids.map(name))];
    const text = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? '');
    return text.replace(/^./, (c) => c.toUpperCase());
  };
  const rows: { sound: string; lights: string }[] = [];
  rows.push({ sound: 'Kick drum', lights: ins.rearBar ? `${list(ins.kick)}, and the rear light bar (wider for harder hits)` : list(ins.kick) });
  rows.push({ sound: 'Snare and claps', lights: `${list(ins.snare[0])}, left and right in turn` });
  if (ins.hat) rows.push({ sound: 'Hi-hats', lights: `${list(ins.hat[0])}, in choruses` });
  if (ins.frontBar) rows.push({ sound: 'Melody', lights: 'Front light bar: higher notes reach further out, held as long as each note' });
  else if (ins.melody.length > 1) rows.push({ sound: 'Melody', lights: `${list(ins.melody.flat())}: higher notes climb the ladder, held as long as each note` });
  else if (ins.melody.length) rows.push({ sound: 'Melody', lights: `${list(ins.melody[0]!)}, held as long as each note` });
  rows.push({ sound: 'Drops', lights: 'Everything at once, after a moment of darkness' });
  return rows;
}

class Choreographer {
  readonly painter: Painter;
  private readonly rnd: () => number;
  private readonly has: (id: string) => boolean;
  private readonly ramps: (id: string) => boolean;
  private readonly beatMs: number;
  private readonly busyness: number;
  private readonly ins: Instruments;
  /** When each light last switched on, to keep flashes apart. */
  private readonly lastOn = new Map<string, number>();

  constructor(
    private readonly a: Analysis,
    private readonly profile: VehicleProfile,
    stepTimeMs: number,
    private readonly startMs: number,
    private readonly endMs: number,
    private readonly opts: GenerateOptions,
  ) {
    this.painter = new Painter(stepTimeMs, Math.round(startMs / stepTimeMs), Math.round(endMs / stepTimeMs));
    this.rnd = random(opts.seed);
    const ids = new Map(profile.channels.map((c) => [c.id, c]));
    this.has = (id) => ids.has(id);
    // Channels 5 and 6 can take their ramps from channel 4; keep them on/off there.
    const leads = profile.channel4LeadsRamps;
    this.ramps = (id) => ids.get(id)?.kind === 'ramping' && !(leads && /Channel[56]$/.test(id));
    this.beatMs = a.bpm > 0 ? 60000 / a.bpm : 500;
    const styleBoost = opts.style === 'party' ? 0.25 : opts.style === 'smooth' ? -0.25 : 0;
    this.busyness = Math.min(1, Math.max(0, opts.intensity + styleBoost));
    // Variations: the ladder can run either way, the bar can grow inward.
    const ins = instruments(profile);
    if (this.rnd() < 0.5) ins.melody.reverse();
    this.barOutward = this.rnd() < 0.7;
    this.ins = ins;
  }

  /** Light bar melody: higher notes further out (or, in some variations, further in). */
  private readonly barOutward: boolean;

  /** Left/right channels for a base name, those this car has. */
  private pair(base: string): string[] {
    return [`left${base}`, `right${base}`].filter(this.has);
  }

  private only(...ids: string[]): string[] {
    return ids.filter(this.has);
  }

  /**
   * Lights on from `t` to `end`, then off: with a short fade where the channel
   * ramps and `fade` is set. A light that switched on less than
   * MIN_FLASH_PERIOD_MS ago is left alone.
   */
  private light(ids: string[], t: number, end: number, fade = false, rampIn: 0 | 500 | 1000 = 0): void {
    for (const id of ids) {
      if (t - (this.lastOn.get(id) ?? -Infinity) < MIN_FLASH_PERIOD_MS) continue;
      this.lastOn.set(id, t);
      const ramp = this.ramps(id);
      if (ramp && rampIn && end - t > rampIn + 100) {
        this.painter.paint(id, t, t + rampIn, `on${rampIn}` as EffectKind);
        this.painter.paint(id, t + rampIn, end, 'on');
      } else {
        this.painter.paint(id, t, end, 'on');
      }
      if (fade && ramp) this.painter.paint(id, end, end + 500, 'off500');
      else this.painter.paint(id, end, end + 20, 'off');
    }
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

  /** Notes of the tune; with drums to follow too, only the clearer ones. */
  private notesIn(s: { startMs: number; endMs: number }, minStrength = 0.2): Note[] {
    return (this.a.notes ?? []).filter((n) => n.startMs >= s.startMs && n.startMs < s.endMs && n.startMs >= this.startMs && n.startMs < this.endMs && n.strength > minStrength);
  }

  private planned: Section[] | undefined;

  private sections(): Section[] {
    return (this.planned ??= planSections(this.a, this.startMs, this.endMs));
  }

  /**
   * The car stays dark between sounds, so each hit stands out. Every section
   * kind is choreographed the same way each time it comes round, so the
   * second chorus looks like the first.
   */
  lights(): void {
    const sections = this.sections();
    sections.forEach((s, i) => {
      const level = LEVELS[s.kind];
      // Which side the snare starts on, fixed per kind of section.
      const side = (hashKind(s.kind) + this.opts.seed) % 2;
      if (level === 'low') this.calm(s);
      else if (s.kind === 'build') this.build(s, side);
      else this.groove(s, level === 'high', side);
      this.interior(s, level);
      const prev = sections[i - 1];
      if (level === 'high' && prev && LEVELS[prev.kind] !== 'high' && s.startMs > this.startMs) this.drop(s.startMs);
    });
  }

  /** Intros, breaks and outros: the melody alone, softly; strong kicks only. */
  private calm(s: Section): void {
    const notes = this.notesIn(s);
    this.melody(s, notes, true);
    for (const k of this.hitsIn(s, 'low', 0.75)) this.light(this.pair('InnerMainBeam'), k.timeMs - LEAD_MS, k.timeMs + this.kickMs(), true);
    // No tune to follow: a slow breath on the first beat of every other bar.
    if (notes.length < this.barsIn(s).length) {
      const breath = this.ins.melody[this.ins.melody.length - 1] ?? this.pair('InnerMainBeam');
      this.barsIn(s).forEach((t, i) => i % 2 === 0 && this.light(breath, t - 500, t + this.beatMs * 2, true, 500));
    }
  }

  private kickMs(): number {
    return Math.max(100, Math.min(220, this.beatMs * 0.35));
  }

  /** Verses, choruses and drops: kick, snare, melody, and hi-hats in the big sections. */
  private groove(s: Section, big: boolean, side: number): void {
    const smooth = this.opts.style === 'smooth';
    const party = this.opts.style === 'party';
    const kickMs = this.kickMs();
    const downbeats = new Set(this.barsIn(s).map((t) => Math.round(t / 50)));
    const onDownbeat = (t: number) => downbeats.has(Math.round(t / 50)) || downbeats.has(Math.round(t / 50) - 1) || downbeats.has(Math.round(t / 50) + 1);
    for (const k of this.hitsIn(s, 'low', (big ? 0.6 : 0.7) - this.busyness * 0.35)) {
      // Smooth: the kicks on bar starts only, with a longer fade.
      if (smooth && !onDownbeat(k.timeMs)) continue;
      const ids = [...this.ins.kick, ...(big && (onDownbeat(k.timeMs) || k.strength > 0.8) ? this.ins.bigKick : [])];
      this.light(ids, k.timeMs - LEAD_MS, k.timeMs + kickMs * (smooth ? 1.6 : 1), true);
      this.rearBarHit(k.timeMs - LEAD_MS, k.timeMs + kickMs, k.strength);
    }
    let i = side;
    for (const sn of this.hitsIn(s, 'mid', (big ? 0.65 : 0.75) - this.busyness * 0.35)) {
      const ids = smooth || (party && big) ? [...this.ins.snare[0], ...this.ins.snare[1]] : this.ins.snare[i++ % 2]!;
      this.light(ids, sn.timeMs - LEAD_MS, sn.timeMs + Math.max(90, Math.min(200, this.beatMs * 0.3)), smooth);
    }
    if (this.ins.hat && !smooth && (big ? this.busyness > 0.45 : party)) {
      let j = 0;
      for (const h of this.hitsIn(s, 'high', 0.7 - this.busyness * 0.4)) {
        this.light(this.ins.hat[j++ % 2]!, h.timeMs - LEAD_MS, h.timeMs + Math.min(120, this.beatMs * 0.25));
      }
    }
    this.melody(s, this.notesIn(s, 0.45 - this.busyness * 0.2), smooth);
    if (big && party && this.has('leftFrontFog') && !this.ins.hat?.[0].includes('leftFrontFog')) {
      // Party: the fogs strobe through the last bar of each phrase.
      const bars = this.barsIn(s);
      for (let b = 3; b < bars.length; b += 4) {
        for (const id of this.pair('FrontFog')) this.painter.paint(id, bars[b]!, bars[b]! + this.beatMs * 4, 'strobe', Math.max(MIN_STROBE_PERIOD_MS, this.beatMs / 2));
      }
    }
  }

  /**
   * The tune: each note lights a rung (or, on a light bar, a pair of
   * segments mirrored from the center), higher notes higher up, for as long
   * as the note lasts. Pitch range is taken per section, so every section
   * uses the whole ladder.
   */
  private melody(s: Section, notes: Note[], soft: boolean): void {
    if (!notes.length) return;
    const pitches = notes.map((n) => n.pitch).sort((a, b) => a - b);
    const lo = pitches[Math.floor(pitches.length * 0.05)]!;
    const hi = Math.max(lo + 1, pitches[Math.floor(pitches.length * 0.95)]!);
    const zone = (pitch: number, count: number) => Math.min(count - 1, Math.max(0, Math.floor(((pitch - lo) / (hi - lo)) * count)));
    const bar = this.ins.frontBar;
    const zones = bar ? 6 : this.ins.melody.length;
    if (!zones) return;
    // Short notes hold for up to half a beat, but the light goes dark before
    // the next note unless the two touch (legato), so each note reads as its
    // own flash; touching repeats of a zone merge into one hold.
    const spans: { zone: number; start: number; end: number }[] = [];
    for (const [k, n] of notes.entries()) {
      const next = notes[k + 1];
      const hold = Math.max(n.endMs, n.startMs + this.beatMs / 2);
      const end = Math.min(s.endMs, next ? (next.startMs - n.endMs < 80 ? next.startMs - 40 : Math.min(hold, next.startMs - 80)) : hold);
      if (end - n.startMs < 60) continue;
      const z = zone(n.pitch, zones);
      const last = spans[spans.length - 1];
      if (last && last.zone === z && n.startMs - last.end < 80) last.end = end;
      else spans.push({ zone: z, start: n.startMs - LEAD_MS, end });
    }
    for (const { zone: z, start, end } of spans) {
      if (bar) {
        const width = bar.length / 2 / zones;
        const at = this.barOutward ? z : zones - 1 - z;
        for (let i = 0; i < width; i++) {
          this.painter.paint(bar[bar.length / 2 - 1 - at * width - i]!, start, end, 'on');
          this.painter.paint(bar[bar.length / 2 + at * width + i]!, start, end, 'on');
        }
      } else {
        this.light(this.ins.melody[z]!, start, end, true, soft && end - start > 700 ? 500 : 0);
      }
    }
  }

  /** The rear light bar fills out from the center on each kick, wider for harder hits. */
  private rearBarHit(t: number, end: number, strength: number): void {
    const bar = this.ins.rearBar;
    if (!bar) return;
    const half = bar.length / 2;
    const width = Math.max(4, Math.round(half * Math.min(1, strength)));
    for (let i = 0; i < width; i++) {
      this.painter.paint(bar[half - 1 - i]!, t, end, 'on');
      this.painter.paint(bar[half + i]!, t, end, 'on');
    }
  }

  /** Builds: the drums carry on while a chase climbs the ladder, faster toward the drop. */
  private build(s: Section, side: number): void {
    const steps = this.ins.melody.length ? this.ins.melody : [this.pair('OuterMainBeam')].filter((x) => x.length);
    const length = s.endMs - s.startMs;
    let t = this.barsIn(s)[0] ?? s.startMs;
    let i = 0;
    while (t < s.endMs - this.beatMs / 2) {
      const progress = (t - s.startMs) / length;
      // Quarter notes, then eighths for the second half.
      const step = Math.max(MIN_FLASH_PERIOD_MS, progress < 0.5 ? this.beatMs : this.beatMs / 2);
      if (steps.length) this.light(steps[i % steps.length]!, t - LEAD_MS, t + step * 0.7);
      this.barChase(t, step, i, progress);
      t += step;
      i++;
    }
    const kickMs = this.kickMs();
    for (const k of this.hitsIn(s, 'low', 0.5 - this.busyness * 0.3)) {
      this.light(this.ins.kick, k.timeMs - LEAD_MS, k.timeMs + kickMs, true);
      this.rearBarHit(k.timeMs - LEAD_MS, k.timeMs + kickMs, k.strength);
    }
    let j = side;
    for (const sn of this.hitsIn(s, 'mid', 0.6 - this.busyness * 0.3)) this.light(this.ins.snare[j++ % 2]!, sn.timeMs - LEAD_MS, sn.timeMs + Math.min(200, this.beatMs * 0.3));
  }

  /** On a light bar, the build's chase: a block that grows from the center as the build goes on. */
  private barChase(t: number, step: number, i: number, progress: number): void {
    const bar = this.ins.frontBar;
    if (!bar) return;
    const half = bar.length / 2;
    const reach = Math.max(3, Math.round(half * (0.2 + 0.8 * progress)));
    const width = 3;
    const at = (i * width) % reach;
    for (let k = 0; k < width; k++) {
      this.painter.paint(bar[half - 1 - ((at + k) % half)]!, t - LEAD_MS, t + step * 0.7, 'on');
      this.painter.paint(bar[half + ((at + k) % half)]!, t - LEAD_MS, t + step * 0.7, 'on');
    }
  }

  /** Into a drop: half a beat of darkness, then every light at once for a beat. */
  private drop(t: number): void {
    const exterior = this.profile.channels.filter((c) => c.kind !== 'closure' && c.kind !== 'rgb').map((c) => c.id);
    const dark = Math.max(this.startMs, t - this.beatMs / 2);
    for (const id of exterior) this.painter.paint(id, dark, t - LEAD_MS, 'off');
    for (const id of exterior) {
      this.painter.paint(id, t - LEAD_MS, t + this.beatMs, 'on');
      if (this.ramps(id)) this.painter.paint(id, t + this.beatMs, t + this.beatMs + 500, 'off500');
      else this.painter.paint(id, t + this.beatMs, t + this.beatMs + 20, 'off');
      this.lastOn.set(id, t);
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
