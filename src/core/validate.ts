// Checks a show against the car's rules. The header checks mirror Tesla's own
// validator.py; the closure checks go further and catch problems Tesla's tool
// doesn't (command limits, Dance before Open, thermal limits, Model X pinch
// detection). Rules come from Tesla's README; see
// docs/research/01-tesla-lightshow-format.md, sections 3 and 6.

import { CHANNEL_COUNT, CHANNELS, LEGACY_CHANNEL_COUNT, type ChannelDef } from './channels';
import { decodeClosure, type ClosureCommand } from './encoding';
import type { FseqFile } from './fseq';

export type Severity = 'error' | 'warning';

export interface Issue {
  severity: Severity;
  code: string;
  message: string;
  channelId?: string;
  /** Where in the show the problem starts, in ms. */
  timeMs?: number;
}

const MIN_STEP_MS = 15;
const MAX_STEP_MS = 100;
const MAX_DURATION_MS = 4 * 60 * 60 * 1000;
const RECOMMENDED_MAX_DANCE_MS = 30_000;
const CHARGE_PORT_AUTO_CLOSE_MS = 120_000;
const COUNTED_COMMANDS: ReadonlySet<ClosureCommand> = new Set(['open', 'close', 'dance']);

export function validate(file: FseqFile): Issue[] {
  const issues = validateHeader(file);
  if (issues.some((i) => i.severity === 'error')) return issues;
  return issues.concat(validateClosures(file));
}

export function validateHeader(file: FseqFile): Issue[] {
  const issues: Issue[] = [];
  const error = (code: string, message: string) => issues.push({ severity: 'error', code, message });

  if (file.channelCount !== CHANNEL_COUNT && file.channelCount !== LEGACY_CHANNEL_COUNT) {
    error('channel-count', `Expected ${CHANNEL_COUNT} or ${LEGACY_CHANNEL_COUNT} channels, got ${file.channelCount}`);
  }
  if (file.frameCount < 1) error('no-frames', 'The show has no frames');
  if (file.stepTimeMs < MIN_STEP_MS || file.stepTimeMs > MAX_STEP_MS) {
    error('step-time', `Frame interval must be ${MIN_STEP_MS}-${MAX_STEP_MS} ms, got ${file.stepTimeMs} ms`);
  }
  const durationMs = file.frameCount * file.stepTimeMs;
  if (durationMs > MAX_DURATION_MS) {
    error('too-long', `Shows can be at most 4 hours long; this one is ${formatTime(durationMs)}`);
  }
  if (file.minorVersion !== 0 && file.minorVersion !== 2) {
    issues.push({
      severity: 'warning',
      code: 'fseq-version',
      message: `FSEQ version 2.${file.minorVersion} hasn't been tested by Tesla; only 2.0 and 2.2 are known to work`,
    });
  }
  return issues;
}

/** A closure command held from startFrame up to (not including) endFrame. */
interface Segment {
  command: ClosureCommand;
  startFrame: number;
  endFrame: number;
}

function closureSegments(file: FseqFile, def: ChannelDef): Segment[] {
  const segments: Segment[] = [];
  let current: Segment | undefined;
  for (let f = 0; f < file.frameCount; f++) {
    const command = decodeClosure(file.data[f * file.channelCount + def.index]!);
    if (current?.command === command) continue;
    if (current) current.endFrame = f;
    current = { command, startFrame: f, endFrame: file.frameCount };
    segments.push(current);
  }
  return segments;
}

/** Time spans (ms) during which a closure is physically moving. */
type Span = [startMs: number, endMs: number];

export function validateClosures(file: FseqFile): Issue[] {
  const issues: Issue[] = [];
  const step = file.stepTimeMs;
  const windowMotion: { def: ChannelDef; spans: Span[] }[] = [];
  const doorMotion: { def: ChannelDef; spans: Span[] }[] = [];

  for (const def of CHANNELS) {
    const info = def.closure;
    if (!info || def.index >= file.channelCount) continue;
    const segments = closureSegments(file, def);
    const isWindow = def.id.endsWith('Window');
    const spans: Span[] = [];

    let commandCount = 0;
    let limitReported = false;
    let danceMs = 0;
    // Simulated position: 0 = closed, 1 = open. We track when the closure
    // finishes its current movement so we can tell if Dance will be honored.
    let isOpen = false;
    let openSinceMs: number | undefined;
    let chargePortReported = false;

    for (const seg of segments) {
      const startMs = seg.startFrame * step;
      const endMs = seg.endFrame * step;
      const at = { channelId: def.id, timeMs: startMs };

      if (COUNTED_COMMANDS.has(seg.command)) {
        commandCount++;
        // A warning, not an error: Tesla's README lists these limits but also
        // says command limits were removed, and Tesla's own Cyber Symphony
        // example goes over the charge port limit.
        if (commandCount > info.commandLimit && !limitReported) {
          limitReported = true;
          issues.push({
            severity: 'warning',
            code: 'closure-limit',
            message: `${def.name} gets more than ${info.commandLimit} Open/Close/Dance commands, Tesla's documented limit; the car may ignore the extras`,
            ...at,
          });
        }
      }

      switch (seg.command) {
        case 'open': {
          const doneMs = startMs + info.openSeconds * 1000;
          spans.push([startMs, Math.min(doneMs, nextStopMs(segments, seg, step))]);
          isOpen = true;
          openSinceMs = doneMs;
          break;
        }
        case 'close': {
          spans.push([startMs, Math.min(startMs + info.closeSeconds * 1000, nextStopMs(segments, seg, step))]);
          isOpen = false;
          openSinceMs = undefined;
          break;
        }
        case 'dance': {
          spans.push([startMs, endMs]);
          danceMs += endMs - startMs;
          if (!info.supportsDance) {
            issues.push({
              severity: 'warning',
              code: 'dance-unsupported',
              message: `${def.name} can't dance; use Open and Close to move it instead`,
              ...at,
            });
          } else if (!isWindow && (!isOpen || openSinceMs === undefined || startMs < openSinceMs)) {
            issues.push({
              severity: 'warning',
              code: 'dance-before-open',
              message: `${def.name} only dances once it's fully open, so it may not dance yet (opening takes about ${info.openSeconds} s)`,
              ...at,
            });
          }
          break;
        }
        case 'idle':
        case 'stop':
          break;
      }

      if (def.id === 'chargePort' && isOpen && openSinceMs !== undefined && !chargePortReported) {
        const closesAtMs = openSinceMs + CHARGE_PORT_AUTO_CLOSE_MS;
        const nextClose = segments.find((s) => s.startFrame > seg.startFrame && s.command === 'close');
        const showEndMs = file.frameCount * step;
        if (closesAtMs < (nextClose ? nextClose.startFrame * step : showEndMs)) {
          chargePortReported = true;
          issues.push({
            severity: 'warning',
            code: 'charge-port-auto-close',
            message: 'The charge port closes by itself 2 minutes after opening',
            channelId: def.id,
            timeMs: closesAtMs,
          });
        }
      }
    }

    if (danceMs > RECOMMENDED_MAX_DANCE_MS) {
      issues.push({
        severity: 'warning',
        code: 'dance-thermal',
        message: `${def.name} dances for ${Math.round(danceMs / 1000)} s; past about 30 s it may overheat and stop moving`,
        channelId: def.id,
      });
    }

    if (isWindow) windowMotion.push({ def, spans });
    else if (def.id.endsWith('FalconDoor') || def.id.endsWith('FrontDoor')) doorMotion.push({ def, spans });
  }

  for (const w of windowMotion) {
    for (const d of doorMotion) {
      const overlap = firstOverlap(w.spans, d.spans);
      if (overlap !== undefined) {
        issues.push({
          severity: 'warning',
          code: 'model-x-pinch',
          message: `On a Model X, moving the ${w.def.name.toLowerCase()} while the ${d.def.name.toLowerCase()} moves can trigger pinch protection and stop the show`,
          channelId: w.def.id,
          timeMs: overlap,
        });
      }
    }
  }

  return issues.sort((a, b) => (a.timeMs ?? -1) - (b.timeMs ?? -1));
}

/** When a movement started by `seg` gets cut short by a later Stop command. */
function nextStopMs(segments: Segment[], seg: Segment, step: number): number {
  const stop = segments.find((s) => s.startFrame > seg.startFrame && s.command === 'stop');
  return stop ? stop.startFrame * step : Infinity;
}

function firstOverlap(a: Span[], b: Span[]): number | undefined {
  let first: number | undefined;
  for (const [aStart, aEnd] of a) {
    for (const [bStart, bEnd] of b) {
      const start = Math.max(aStart, bStart);
      if (start < Math.min(aEnd, bEnd) && (first === undefined || start < first)) first = start;
    }
  }
  return first;
}

export function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const tenths = Math.floor((ms % 1000) / 100);
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}.${tenths}`;
}
