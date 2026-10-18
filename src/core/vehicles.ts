// Vehicle capability profiles: which channels a car physically has and how it
// treats them. The show file is the same for every car; profiles shape what
// the editor shows, what the preview draws and what the generator targets.
// Source: Tesla's README tables (docs/research/01-tesla-lightshow-format.md §5).

import { CHANNELS_BY_ID, type ChannelKind } from './channels';

export type ChannelGroup = 'front' | 'rear' | 'closures' | 'interior';

export interface ProfileChannel {
  id: string;
  group: ChannelGroup;
  /** How this car treats the channel, when it differs from the channel map. */
  kind: ChannelKind;
  /** Present only on some cars of this model (region, options, build date). */
  maybe?: string;
}

export interface VehicleProfile {
  id: string;
  name: string;
  channels: ProfileChannel[];
  /**
   * On Model S/X the ramp time of channels 5 and 6 comes from channel 4 on
   * the same side (research §5, "Ramping Channels 4-6").
   */
  channel4LeadsRamps: boolean;
}

type Row = [id: string, group: ChannelGroup, kind?: ChannelKind, maybe?: string];

function profile(id: string, name: string, channel4LeadsRamps: boolean, rows: Row[]): VehicleProfile {
  return {
    id,
    name,
    channel4LeadsRamps,
    channels: rows.map(([channelId, group, kind, maybe]) => {
      const def = CHANNELS_BY_ID.get(channelId);
      if (!def) throw new Error(`Unknown channel in ${id} profile: ${channelId}`);
      return { id: channelId, group, kind: kind ?? def.kind, ...(maybe ? { maybe } : {}) };
    }),
  };
}

const bothSides = (base: string, group: ChannelGroup, kind?: ChannelKind, maybe?: string): Row[] => [
  [`left${base}`, group, kind, maybe],
  [`right${base}`, group, kind, maybe],
];

export const MODEL_X: VehicleProfile = profile('modelX', 'Model X (2021+)', true, [
  // Outer main beams ramp on LED reflector headlights but are on/off on
  // projector headlights; which Model X builds have which is unverified.
  ...bothSides('OuterMainBeam', 'front'),
  ...bothSides('InnerMainBeam', 'front'),
  ...bothSides('Signature', 'front', 'boolean'),
  ...bothSides('Channel4', 'front'),
  ...bothSides('Channel5', 'front'),
  ...bothSides('Channel6', 'front'),
  ...bothSides('FrontTurn', 'front', 'boolean'),
  ...bothSides('FrontFog', 'front'),
  ...bothSides('AuxPark', 'front'),
  ...bothSides('SideMarker', 'front', undefined, 'North America only'),
  ...bothSides('SideRepeater', 'front'),
  ...bothSides('RearTurn', 'rear'),
  ['brakeLights', 'rear'],
  ...bothSides('Tail', 'rear'),
  ['reverseLights', 'rear'],
  ['rearFog', 'rear'],
  ['licensePlate', 'rear'],
  ...bothSides('FalconDoor', 'closures'),
  ...bothSides('FrontDoor', 'closures'),
  ...bothSides('Mirror', 'closures'),
  ['leftFrontWindow', 'closures'],
  ['leftRearWindow', 'closures'],
  ['rightFrontWindow', 'closures'],
  ['rightRearWindow', 'closures'],
  ['liftgate', 'closures'],
  ['chargePort', 'closures'],
  // Whether Model X responds to these is unverified (research §7).
  ['centerFrontDisplayRed', 'interior', undefined, 'Unverified on Model X'],
  ['centerFrontDisplayGreen', 'interior', undefined, 'Unverified on Model X'],
  ['centerFrontDisplayBlue', 'interior', undefined, 'Unverified on Model X'],
]);
