// Turns raw show bytes into what a specific car will physically do, frame by
// frame: how bright each light is (following Tesla's ramp rules) and where
// each closure is (following approximate travel times). The 3D preview and
// the composer both draw from this.

import { channel, CHANNELS_BY_ID } from './channels';
import { decodeClosure, LIGHT_BYTES, RAMP_MS, type LightCommand } from './encoding';
import type { FseqFile } from './fseq';
import type { VehicleProfile } from './vehicles';

export interface ClosureTrack {
  /** 0 = closed, 1 = fully open. Includes the dance motion. */
  position: Float32Array;
  /** 1 while the closure is dancing. */
  dancing: Uint8Array;
}

export interface Simulation {
  frameCount: number;
  stepTimeMs: number;
  /** Light brightness 0-1 per frame, keyed by channel id. */
  levels: Map<string, Float32Array>;
  closures: Map<string, ClosureTrack>;
}

const LIGHT_COMMANDS = Object.entries(LIGHT_BYTES) as [LightCommand, number][];

/** Nearest ramp command for a byte. xLights only writes the exact values. */
export function decodeLight(byte: number): LightCommand {
  let best: LightCommand = 'off';
  let bestDistance = Infinity;
  for (const [command, value] of LIGHT_COMMANDS) {
    const distance = Math.abs(value - byte);
    if (distance < bestDistance) {
      best = command;
      bestDistance = distance;
    }
  }
  return best;
}

/** Seconds per full dance cycle; Tesla doesn't document the real speed. */
const DANCE_PERIOD_S = { window: 2, other: 4 };
/** How far a dancing closure swings away from fully open (or down, for windows). */
const DANCE_DEPTH = 0.35;

export function simulate(show: FseqFile, vehicle: VehicleProfile): Simulation {
  const { frameCount, channelCount, data, stepTimeMs } = show;
  const byteAt = (frame: number, index: number) =>
    index < channelCount ? data[frame * channelCount + index]! : 0;

  const levels = new Map<string, Float32Array>();
  const closures = new Map<string, ClosureTrack>();

  for (const pc of vehicle.channels) {
    const def = CHANNELS_BY_ID.get(pc.id)!;

    if (pc.kind === 'closure') {
      closures.set(pc.id, simulateClosure(show, pc.id, byteAt));
      continue;
    }

    const out = new Float32Array(frameCount);
    if (pc.kind === 'boolean') {
      for (let f = 0; f < frameCount; f++) out[f] = byteAt(f, def.index) > 127 ? 1 : 0;
    } else if (pc.kind === 'dimmable' || pc.kind === 'rgb') {
      for (let f = 0; f < frameCount; f++) out[f] = byteAt(f, def.index) / 255;
    } else {
      const leader = vehicle.channel4LeadsRamps ? channel4Leader(pc.id) : undefined;
      const leaderIndex = leader ? channel(leader).index : undefined;
      let level = 0;
      for (let f = 0; f < frameCount; f++) {
        const command = decodeLight(byteAt(f, def.index));
        const turningOn = command.startsWith('on');
        // Channels 5/6 take their on/off state from their own byte but their
        // ramp time from channel 4 on the same side.
        const rampMs =
          leaderIndex === undefined ? RAMP_MS[command] : RAMP_MS[decodeLight(byteAt(f, leaderIndex))];
        const stepAmount = rampMs === 0 ? 1 : stepTimeMs / rampMs;
        level = turningOn ? Math.min(1, level + stepAmount) : Math.max(0, level - stepAmount);
        out[f] = level;
      }
    }
    levels.set(pc.id, out);
  }

  // Lights driven by several channels show the combined (OR) state.
  for (const group of vehicle.orGroups) {
    const inputs = group.inputs.map((id) => levels.get(id)).filter((l): l is Float32Array => !!l);
    const combined = new Float32Array(frameCount);
    for (const input of inputs) {
      for (let f = 0; f < frameCount; f++) if (input[f]! > combined[f]!) combined[f] = input[f]!;
    }
    for (const id of group.outputs) levels.set(id, combined);
  }

  return { frameCount, stepTimeMs, levels, closures };
}

function channel4Leader(id: string): string | undefined {
  const match = /^(left|right)Channel[56]$/.exec(id);
  return match ? `${match[1]}Channel4` : undefined;
}

function simulateClosure(
  show: FseqFile,
  id: string,
  byteAt: (frame: number, index: number) => number,
): ClosureTrack {
  const { frameCount, stepTimeMs } = show;
  const def = channel(id);
  const info = def.closure!;
  const position = new Float32Array(frameCount);
  const dancing = new Uint8Array(frameCount);
  const isWindow = id.endsWith('Window');
  // The charge port's "dance" flashes its LED instead of moving the door.
  const danceMoves = id !== 'chargePort';
  const periodS = isWindow ? DANCE_PERIOD_S.window : DANCE_PERIOD_S.other;

  const openRate = stepTimeMs / (info.openSeconds * 1000);
  const closeRate = stepTimeMs / (info.closeSeconds * 1000);
  // The closure's rest position, before dance motion is added on top.
  // Mirrors start unfolded (Tesla's examples begin by folding them); the rest start closed.
  let base = id.endsWith('Mirror') ? 1 : 0;
  let motion: 'opening' | 'closing' | 'none' = 'none';
  let danceStartFrame = -1;

  for (let f = 0; f < frameCount; f++) {
    const byte = byteAt(f, def.index);
    const command = decodeClosure(byte);
    if (command === 'open') motion = 'opening';
    else if (command === 'close') motion = 'closing';
    else if (command === 'stop') motion = 'none';
    // 'idle' lets any movement in progress finish; 'dance' is handled below.

    if (motion === 'opening') {
      base = Math.min(1, base + openRate);
      if (base === 1) motion = 'none';
    } else if (motion === 'closing') {
      base = Math.max(0, base - closeRate);
      if (base === 0) motion = 'none';
    }

    // Windows can dance from closed; everything else only once fully open.
    const canDance = info.supportsDance && command === 'dance' && (isWindow || base >= 0.999);
    if (canDance) {
      if (danceStartFrame < 0) danceStartFrame = f;
      const t = ((f - danceStartFrame) * stepTimeMs) / 1000;
      const swing = danceMoves ? DANCE_DEPTH * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / periodS)) : 0;
      position[f] = isWindow ? base + swing * (1 - base) : base - swing;
      dancing[f] = 1;
    } else {
      danceStartFrame = -1;
      position[f] = base;
    }
  }
  return { position, dancing };
}
