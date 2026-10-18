// Byte values the car understands. xLights stores an effect's brightness
// percentage as floor(pct * 2.55), and Tesla assigns meanings to specific
// percentages. All values below were confirmed by decoding Tesla's example
// shows (see docs/research/01-tesla-lightshow-format.md, section 4).

export type LightCommand =
  | 'off'
  | 'off500'
  | 'off1000'
  | 'off2000'
  | 'on500'
  | 'on1000'
  | 'on2000'
  | 'on';

export const LIGHT_BYTES: Readonly<Record<LightCommand, number>> = {
  off: 0, // 0%
  off500: 25, // 10%
  off1000: 51, // 20%
  off2000: 76, // 30%
  on500: 178, // 70%
  on1000: 204, // 80%
  on2000: 229, // 90%
  on: 255, // 100%
};

/** Ramp duration in ms for each light command (0 = instant). */
export const RAMP_MS: Readonly<Record<LightCommand, number>> = {
  off: 0,
  off500: 500,
  off1000: 1000,
  off2000: 2000,
  on500: 500,
  on1000: 1000,
  on2000: 2000,
  on: 0,
};

export type ClosureCommand = 'idle' | 'open' | 'dance' | 'close' | 'stop';

export const CLOSURE_BYTES: Readonly<Record<ClosureCommand, number>> = {
  idle: 0, // empty timeline
  open: 63, // 25%, xLights hotkey Q
  dance: 127, // 50%, hotkey A
  close: 191, // 75%, hotkey Z
  stop: 255, // 100%, hotkey F
};

/**
 * Reads a closure byte back as a command. Shows made in xLights only ever
 * contain the exact values above; for anything else we pick the nearest
 * value. How the car itself treats in-between values is undocumented.
 */
export function decodeClosure(byte: number): ClosureCommand {
  if (byte < 32) return 'idle';
  if (byte < 96) return 'open';
  if (byte < 160) return 'dance';
  if (byte < 224) return 'close';
  return 'stop';
}

/** Lights without brightness control are on when brightness is above 50%. */
export function isOn(byte: number): boolean {
  return byte > 127;
}
