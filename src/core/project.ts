// The editable show: effects placed on channels over time, compiled to the
// frame-by-frame bytes the car plays. Imported shows are converted into
// effects wherever their bytes are standard commands, so they can be edited;
// anything else (light bar pixels, RGB, unusual values) stays as a fixed base.

import { CHANNEL_COUNT, CHANNELS, CHANNELS_BY_ID } from './channels';
import { CLOSURE_BYTES, LIGHT_BYTES, type ClosureCommand, type LightCommand } from './encoding';
import type { FseqFile } from './fseq';

/** Light effects: Tesla's on/ramp commands, plus strobe (alternating on/off). */
export type LightEffectKind = Exclude<LightCommand, 'off'> | 'strobe';
export type ClosureEffectKind = Exclude<ClosureCommand, 'idle'>;
export type EffectKind = LightEffectKind | ClosureEffectKind;

export interface Effect {
  id: string;
  channel: string;
  startMs: number;
  endMs: number;
  kind: EffectKind;
  /** Strobe: one on/off cycle, in ms. */
  periodMs?: number;
}

export interface Project {
  stepTimeMs: number;
  frameCount: number;
  channelCount: number;
  /** Frame data not represented by effects (frame-major, one byte per channel). */
  base: Uint8Array;
  effects: readonly Effect[];
}

export const LIGHT_KINDS: readonly LightEffectKind[] = ['on', 'on500', 'on1000', 'on2000', 'off500', 'off1000', 'off2000', 'strobe'];
export const CLOSURE_KINDS: readonly ClosureEffectKind[] = ['open', 'dance', 'close', 'stop'];
export const DEFAULT_STROBE_MS = 200;

export function isClosureKind(kind: EffectKind): kind is ClosureEffectKind {
  return (CLOSURE_KINDS as readonly string[]).includes(kind);
}

/** Which kinds of effect a channel accepts, or undefined if it isn't editable as effects. */
export function effectFamily(channelId: string): 'light' | 'closure' | undefined {
  const def = CHANNELS_BY_ID.get(channelId);
  if (!def) return undefined;
  if (def.kind === 'closure') return 'closure';
  if (def.kind === 'boolean' || def.kind === 'ramping') return 'light';
  return undefined;
}

let nextId = 1;
export function newEffectId(): string {
  return `e${(nextId++).toString(36)}`;
}

export function blankProject(durationMs: number, stepTimeMs = 20): Project {
  const frameCount = Math.max(1, Math.round(durationMs / stepTimeMs));
  return { stepTimeMs, frameCount, channelCount: CHANNEL_COUNT, base: new Uint8Array(frameCount * CHANNEL_COUNT), effects: [] };
}

const LIGHT_BY_BYTE = new Map<number, LightEffectKind>(
  (Object.entries(LIGHT_BYTES) as [LightCommand, number][]).filter(([k]) => k !== 'off').map(([k, v]) => [v, k as LightEffectKind]),
);
const CLOSURE_BY_BYTE = new Map<number, ClosureEffectKind>(
  (Object.entries(CLOSURE_BYTES) as [ClosureCommand, number][]).filter(([k]) => k !== 'idle').map(([k, v]) => [v, k as ClosureEffectKind]),
);

/** Converts a show's standard commands into effects; compiling the result gives back the same bytes. */
export function projectFromShow(show: FseqFile): Project {
  const { frameCount, channelCount, stepTimeMs } = show;
  const base = show.data.slice();
  const effects: Effect[] = [];
  for (const def of CHANNELS) {
    const family = effectFamily(def.id);
    if (!family || def.index >= channelCount) continue;
    const lookup: Map<number, EffectKind> = family === 'closure' ? CLOSURE_BY_BYTE : LIGHT_BY_BYTE;
    let runStart = 0;
    let runKind: EffectKind | undefined;
    const flush = (end: number) => {
      if (!runKind) return;
      effects.push({ id: newEffectId(), channel: def.id, startMs: runStart * stepTimeMs, endMs: end * stepTimeMs, kind: runKind });
      for (let f = runStart; f < end; f++) base[f * channelCount + def.index] = 0;
    };
    for (let f = 0; f < frameCount; f++) {
      const kind = lookup.get(base[f * channelCount + def.index]!);
      if (kind === runKind) continue;
      flush(f);
      runStart = f;
      runKind = kind;
    }
    flush(frameCount);
  }
  return { stepTimeMs, frameCount, channelCount, base, effects };
}

/** Frame range [first, last) an effect covers. */
export function effectFrames(e: Effect, stepTimeMs: number, frameCount: number): [number, number] {
  return [Math.max(0, Math.round(e.startMs / stepTimeMs)), Math.min(frameCount, Math.round(e.endMs / stepTimeMs))];
}

export function compileProject(project: Project): FseqFile {
  const { frameCount, channelCount, stepTimeMs } = project;
  const data = project.base.slice();
  for (const e of project.effects) {
    const def = CHANNELS_BY_ID.get(e.channel);
    if (!def || def.index >= channelCount) continue;
    const [first, last] = effectFrames(e, stepTimeMs, frameCount);
    if (e.kind === 'strobe') {
      const period = Math.max(2, Math.round((e.periodMs ?? DEFAULT_STROBE_MS) / stepTimeMs));
      for (let f = first; f < last; f++) data[f * channelCount + def.index] = (f - first) % period < period / 2 ? LIGHT_BYTES.on : 0;
    } else {
      const byte = isClosureKind(e.kind) ? CLOSURE_BYTES[e.kind] : LIGHT_BYTES[e.kind];
      for (let f = first; f < last; f++) data[f * channelCount + def.index] = byte;
    }
  }
  return { channelCount, frameCount, stepTimeMs, minorVersion: 0, uniqueId: 0n, variableHeaders: [], data };
}

/**
 * Adds or updates effects, trimming or splitting any other effect on the same
 * channel that they overlap. The placed effects win.
 */
export function placeEffects(effects: readonly Effect[], placed: readonly Effect[]): Effect[] {
  const placedIds = new Set(placed.map((p) => p.id));
  let result = effects.filter((e) => !placedIds.has(e.id));
  for (const p of placed) {
    const next: Effect[] = [];
    for (const e of result) {
      if (e.channel !== p.channel || e.endMs <= p.startMs || e.startMs >= p.endMs) {
        next.push(e);
        continue;
      }
      if (e.startMs < p.startMs) next.push({ ...e, endMs: p.startMs });
      if (e.endMs > p.endMs) next.push({ ...e, id: e.startMs < p.startMs ? newEffectId() : e.id, startMs: p.endMs });
    }
    result = next;
  }
  return [...result, ...placed].sort((a, b) => a.startMs - b.startMs);
}

export function removeEffects(effects: readonly Effect[], ids: ReadonlySet<string>): Effect[] {
  return effects.filter((e) => !ids.has(e.id));
}

/** The same channel on the other side of the car, if there is one. */
export function mirrorChannel(id: string): string | undefined {
  const other = id.startsWith('left') ? `right${id.slice(4)}` : id.startsWith('right') ? `left${id.slice(5)}` : undefined;
  return other && CHANNELS_BY_ID.has(other) ? other : undefined;
}

/** Copies of the effects on the opposite side of the car. */
export function mirrored(effects: readonly Effect[]): Effect[] {
  return effects.flatMap((e) => {
    const channel = mirrorChannel(e.channel);
    return channel ? [{ ...e, id: newEffectId(), channel }] : [];
  });
}

export const EFFECT_LABELS: Record<EffectKind, string> = {
  on: 'On',
  on500: 'Fade in 0.5 s',
  on1000: 'Fade in 1 s',
  on2000: 'Fade in 2 s',
  off500: 'Fade out 0.5 s',
  off1000: 'Fade out 1 s',
  off2000: 'Fade out 2 s',
  strobe: 'Strobe',
  open: 'Open',
  dance: 'Dance',
  close: 'Close',
  stop: 'Stop',
};

/** xLights hotkeys from Tesla's project (xlights_keybindings.xml), kept so xLights users feel at home. */
export const EFFECT_HOTKEYS: Partial<Record<string, EffectKind>> = {
  f: 'on',
  e: 'on500',
  d: 'on1000',
  c: 'on2000',
  w: 'off500',
  s: 'off1000',
  x: 'off2000',
  q: 'open',
  a: 'dance',
  z: 'close',
};
