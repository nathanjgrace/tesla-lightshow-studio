// The Tesla light show channel map. Every show file uses this same 200-channel
// layout regardless of vehicle; each car plays the channels it physically has.
// Source: StartChannel values in Tesla's xLights project
// (teslamotors/light-show, xlights/tesla_xlights_show_folder.zip). See
// docs/research/01-tesla-lightshow-format.md for details.

export const CHANNEL_COUNT = 200;
/** Older shows use a 48-channel layout; the car still accepts these. */
export const LEGACY_CHANNEL_COUNT = 48;

/**
 * How the car interprets a channel's byte value.
 * - boolean: on above 50%, off otherwise
 * - ramping: on/off with optional 500/1000/2000 ms ramps (see encoding.ts)
 * - closure: discrete commands (idle/open/dance/close/stop)
 * - dimmable: any brightness 0-255 (Cybertruck light bars)
 * - rgb: one of three color components of an RGB light
 */
export type ChannelKind = 'boolean' | 'ramping' | 'closure' | 'dimmable' | 'rgb';

export interface ClosureInfo {
  /** Max Open + Close + Dance commands per show, counted per closure. */
  commandLimit: number;
  supportsDance: boolean;
  /** Approximate seconds to fully open / close (from Tesla's README). */
  openSeconds: number;
  closeSeconds: number;
}

export interface ChannelDef {
  /** Stable identifier used throughout the app. */
  id: string;
  /** 0-based index into a frame's channel bytes. */
  index: number;
  name: string;
  kind: ChannelKind;
  closure?: ClosureInfo;
}

const closure = (
  commandLimit: number,
  supportsDance: boolean,
  openSeconds: number,
  closeSeconds: number,
): ClosureInfo => ({ commandLimit, supportsDance, openSeconds, closeSeconds });

const FALCON = closure(6, true, 20, 8);
const FRONT_DOOR = closure(6, false, 22, 3);
const MIRROR = closure(20, false, 2, 2);
const WINDOW = closure(6, true, 4, 4);
const LIFTGATE = closure(6, true, 14, 4);
const DOOR_HANDLE = closure(20, false, 2, 2);
const CHARGE_PORT = closure(3, true, 2, 2);

// [1-based channel number, id, display name, kind, closure info]
type Row = [number, string, string, ChannelKind, ClosureInfo?];

const ROWS: Row[] = [
  [1, 'leftOuterMainBeam', 'Left Outer Main Beam', 'ramping'],
  [2, 'rightOuterMainBeam', 'Right Outer Main Beam', 'ramping'],
  [3, 'leftInnerMainBeam', 'Left Inner Main Beam', 'ramping'],
  [4, 'rightInnerMainBeam', 'Right Inner Main Beam', 'ramping'],
  [5, 'leftSignature', 'Left Signature', 'ramping'],
  [6, 'rightSignature', 'Right Signature', 'ramping'],
  [7, 'leftChannel4', 'Left Channel 4', 'ramping'],
  [8, 'rightChannel4', 'Right Channel 4', 'ramping'],
  [9, 'leftChannel5', 'Left Channel 5', 'ramping'],
  [10, 'rightChannel5', 'Right Channel 5', 'ramping'],
  [11, 'leftChannel6', 'Left Channel 6', 'ramping'],
  [12, 'rightChannel6', 'Right Channel 6', 'ramping'],
  [13, 'leftFrontTurn', 'Left Front Turn', 'ramping'],
  [14, 'rightFrontTurn', 'Right Front Turn', 'ramping'],
  [15, 'leftFrontFog', 'Left Front Fog', 'boolean'],
  [16, 'rightFrontFog', 'Right Front Fog', 'boolean'],
  [17, 'leftAuxPark', 'Left Aux Park', 'boolean'],
  [18, 'rightAuxPark', 'Right Aux Park', 'boolean'],
  [19, 'leftSideMarker', 'Left Side Marker', 'boolean'],
  [20, 'rightSideMarker', 'Right Side Marker', 'boolean'],
  [21, 'leftSideRepeater', 'Left Side Repeater', 'boolean'],
  [22, 'rightSideRepeater', 'Right Side Repeater', 'boolean'],
  [23, 'leftRearTurn', 'Left Rear Turn', 'boolean'],
  [24, 'rightRearTurn', 'Right Rear Turn', 'boolean'],
  [25, 'brakeLights', 'Brake Lights', 'boolean'],
  [26, 'leftTail', 'Left Tail', 'boolean'],
  [27, 'rightTail', 'Right Tail', 'boolean'],
  [28, 'reverseLights', 'Reverse Lights', 'boolean'],
  [29, 'rearFog', 'Rear Fog', 'boolean'],
  [30, 'licensePlate', 'License Plate', 'boolean'],
  [31, 'leftFalconDoor', 'Left Falcon Door', 'closure', FALCON],
  [32, 'rightFalconDoor', 'Right Falcon Door', 'closure', FALCON],
  [33, 'leftFrontDoor', 'Left Front Door', 'closure', FRONT_DOOR],
  [34, 'rightFrontDoor', 'Right Front Door', 'closure', FRONT_DOOR],
  [35, 'leftMirror', 'Left Mirror', 'closure', MIRROR],
  [36, 'rightMirror', 'Right Mirror', 'closure', MIRROR],
  [37, 'leftFrontWindow', 'Left Front Window', 'closure', WINDOW],
  [38, 'leftRearWindow', 'Left Rear Window', 'closure', WINDOW],
  [39, 'rightFrontWindow', 'Right Front Window', 'closure', WINDOW],
  [40, 'rightRearWindow', 'Right Rear Window', 'closure', WINDOW],
  [41, 'liftgate', 'Liftgate', 'closure', LIFTGATE],
  [42, 'leftFrontDoorHandle', 'Left Front Door Handle', 'closure', DOOR_HANDLE],
  [43, 'leftRearDoorHandle', 'Left Rear Door Handle', 'closure', DOOR_HANDLE],
  [44, 'rightFrontDoorHandle', 'Right Front Door Handle', 'closure', DOOR_HANDLE],
  [45, 'rightRearDoorHandle', 'Right Rear Door Handle', 'closure', DOOR_HANDLE],
  [46, 'chargePort', 'Charge Port', 'closure', CHARGE_PORT],
];

function rgbRows(start: number, id: string, name: string): Row[] {
  return (['Red', 'Green', 'Blue'] as const).map(
    (c, i): Row => [start + i, `${id}${c}`, `${name} (${c})`, 'rgb'],
  );
}

function pixelRows(start: number, count: number, id: string, name: string): Row[] {
  return Array.from({ length: count }, (_, i): Row => [
    start + i,
    `${id}${i + 1}`,
    `${name} ${i + 1}`,
    'dimmable',
  ]);
}

ROWS.push(
  ...pixelRows(47, 60, 'frontLightBar', 'Front Light Bar'),
  ...pixelRows(111, 52, 'rearLightBar', 'Rear Light Bar'),
  ...pixelRows(167, 6, 'offroadLightBar', 'Offroad Light Bar'),
  ...rgbRows(176, 'centerFrontDisplay', 'Center Front Display'),
  ...rgbRows(179, 'rightRearAccent', 'Right Rear Accent'),
  ...rgbRows(182, 'rightFrontAccent', 'Right Front Accent'),
  ...rgbRows(185, 'centerFrontAccent', 'Center Front Accent'),
  ...rgbRows(188, 'leftFrontAccent', 'Left Front Accent'),
  ...rgbRows(191, 'leftRearAccent', 'Left Rear Accent'),
);

export const CHANNELS: readonly ChannelDef[] = ROWS.map(([num, id, name, kind, info]) => ({
  id,
  index: num - 1,
  name,
  kind,
  ...(info ? { closure: info } : {}),
}));

export const CHANNELS_BY_ID: ReadonlyMap<string, ChannelDef> = new Map(
  CHANNELS.map((c) => [c.id, c]),
);

export const CHANNELS_BY_INDEX: ReadonlyMap<number, ChannelDef> = new Map(
  CHANNELS.map((c) => [c.index, c]),
);

export function channel(id: string): ChannelDef {
  const def = CHANNELS_BY_ID.get(id);
  if (!def) throw new Error(`Unknown channel: ${id}`);
  return def;
}
