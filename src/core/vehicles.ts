// Vehicle capability profiles: which channels a car physically has and how it
// treats them. The show file is the same for every car; profiles shape what
// the editor shows, what the preview draws and what the generator targets.
//
// Sources: Tesla's README tables (docs/research/01-tesla-lightshow-format.md
// §5) unless a channel's `maybe` note says otherwise. Variants after Tesla's
// last README update (Dec 2024), like the 2025 Model Y, are marked unverified.

import { CHANNELS_BY_ID, type ChannelKind } from './channels';

export type ChannelGroup = 'front' | 'rear' | 'closures' | 'interior';
export type ModelId = 'modelS' | 'model3' | 'modelX' | 'modelY' | 'cybertruck';

export const MODEL_NAMES: Record<ModelId, string> = {
  modelS: 'Model S',
  model3: 'Model 3',
  modelX: 'Model X',
  modelY: 'Model Y',
  cybertruck: 'Cybertruck',
};

export interface ProfileChannel {
  id: string;
  group: ChannelGroup;
  /** How this car treats the channel, when it differs from the channel map. */
  kind: ChannelKind;
  /** What the channel drives on this car, when it isn't the channel's own name. */
  label?: string;
  /** Present only on some cars of this variant (region, options), or unverified. */
  maybe?: string;
  /** Channels sharing a row key are shown as one composer row (e.g. light bar LEDs). */
  row?: { key: string; label: string };
}

/**
 * Several channels driving one physical light: the light is on when any
 * input is on, and every output shows that combined state.
 */
export interface OrGroup {
  inputs: string[];
  outputs: string[];
}

/**
 * What the 3D preview should draw: the model's body, plus the lighting
 * hardware that differs between versions and trims.
 */
export interface BodyStyle {
  model: ModelId;
  /** Refreshed design (2024+ Model 3, 2025+ Model Y): slimmer headlights. */
  refresh?: boolean;
  /** Full-width light bars (2025+ Model Y Premium; Cybertruck). */
  frontLightBar?: boolean;
  rearLightBar?: boolean;
  /** Front fog lamps in the bumper. */
  fogLamps?: boolean;
}

export interface VehicleProfile {
  id: string;
  body: BodyStyle;
  model: ModelId;
  /** The variant, e.g. "2021 – present". */
  variant: string;
  name: string;
  channels: ProfileChannel[];
  /** Channels 5 and 6 take their ramp time from channel 4 on the same side. */
  channel4LeadsRamps: boolean;
  orGroups: OrGroup[];
  /** Model years covered, for VIN matching. `to` is open-ended when omitted. */
  years: { from: number; to?: number };
  /** What tells this variant apart from others of the same model year. */
  hint: string;
}

type Row = [id: string, group: ChannelGroup, extra?: Partial<Omit<ProfileChannel, 'id' | 'group'>>];

function profile(p: Omit<VehicleProfile, 'channels' | 'name'> & { rows: Row[] }): VehicleProfile {
  if (p.body.model !== p.model) throw new Error(`${p.id}: body is for ${p.body.model}`);
  const { rows, ...rest } = p;
  return {
    ...rest,
    name: `${MODEL_NAMES[p.model]} ${p.variant}`,
    channels: rows.map(([id, group, extra]) => {
      const def = CHANNELS_BY_ID.get(id);
      if (!def) throw new Error(`Unknown channel in ${p.id} profile: ${id}`);
      return { id, group, kind: def.kind, ...extra };
    }),
  };
}

const sides = (base: string, group: ChannelGroup, extra?: Row[2]): Row[] => [
  [`left${base}`, group, extra],
  [`right${base}`, group, extra],
];

const NA_ONLY = 'North America only';
const NON_NA = 'Outside North America only';

const centerDisplay = (maybe?: string): Row[] =>
  (['Red', 'Green', 'Blue'] as const).map((c): Row => [`centerFrontDisplay${c}`, 'interior', maybe ? { maybe } : {}]);

const accentLights: Row[] = ['rightRearAccent', 'rightFrontAccent', 'centerFrontAccent', 'leftFrontAccent', 'leftRearAccent'].flatMap(
  (base) => (['Red', 'Green', 'Blue'] as const).map((c): Row => [`${base}${c}`, 'interior']),
);

// --- Model S and X (2021+): share the front lighting layout -------------------

const sxFront = (): Row[] => [
  // Outer main beams ramp on LED reflector headlights but are on/off on
  // projector headlights; which builds have which isn't documented.
  ...sides('OuterMainBeam', 'front', { maybe: 'Ramps on reflector headlights only' }),
  ...sides('InnerMainBeam', 'front'),
  ...sides('Signature', 'front', { kind: 'boolean' }),
  ...sides('Channel4', 'front'),
  ...sides('Channel5', 'front'),
  ...sides('Channel6', 'front'),
  ...sides('FrontTurn', 'front', { kind: 'boolean' }),
  ...sides('FrontFog', 'front'),
  ...sides('AuxPark', 'front'),
  ...sides('SideMarker', 'front', { maybe: NA_ONLY }),
  ...sides('SideRepeater', 'front'),
];

const commonRear = (rearFog: string | undefined): Row[] => [
  ...sides('RearTurn', 'rear'),
  ['brakeLights', 'rear'],
  ...sides('Tail', 'rear'),
  ['reverseLights', 'rear'],
  ['rearFog', 'rear', rearFog ? { maybe: rearFog } : {}],
  ['licensePlate', 'rear'],
];

const commonClosures = (liftgate?: string): Row[] => [
  ...sides('Mirror', 'closures'),
  ['leftFrontWindow', 'closures'],
  ['leftRearWindow', 'closures'],
  ['rightFrontWindow', 'closures'],
  ['rightRearWindow', 'closures'],
  ['liftgate', 'closures', liftgate ? { maybe: liftgate } : {}],
  ['chargePort', 'closures'],
];

export const MODEL_S_2021 = profile({
  id: 'modelS-2021',
  model: 'modelS',
  body: { model: 'modelS', fogLamps: true },
  variant: '2021 – present',
  hint: 'Refreshed interior with a horizontal center screen',
  years: { from: 2021 },
  channel4LeadsRamps: true,
  // Model S: aux park and side markers work together, per side.
  orGroups: [
    { inputs: ['leftSideMarker', 'leftAuxPark'], outputs: ['leftSideMarker', 'leftAuxPark'] },
    { inputs: ['rightSideMarker', 'rightAuxPark'], outputs: ['rightSideMarker', 'rightAuxPark'] },
  ],
  rows: [
    ...sxFront(),
    ...commonRear(NON_NA),
    ['leftFrontDoorHandle', 'closures'],
    ['leftRearDoorHandle', 'closures'],
    ['rightFrontDoorHandle', 'closures'],
    ['rightRearDoorHandle', 'closures'],
    ...commonClosures(),
    ...centerDisplay(),
  ],
});

export const MODEL_X_2021 = profile({
  id: 'modelX-2021',
  model: 'modelX',
  body: { model: 'modelX', fogLamps: true },
  variant: '2021 – 2024',
  hint: 'White-only interior lighting',
  years: { from: 2021, to: 2024 },
  channel4LeadsRamps: true,
  orGroups: [],
  rows: [
    ...sxFront(),
    // North America Model X has rear fogs; elsewhere all cars do.
    ...commonRear(undefined),
    ...sides('FalconDoor', 'closures'),
    ...sides('FrontDoor', 'closures'),
    ...commonClosures(),
    ...centerDisplay('Unverified on Model X'),
  ],
});

export const MODEL_X_2025 = profile({
  id: 'modelX-2025',
  model: 'modelX',
  body: { model: 'modelX', fogLamps: true },
  variant: '2025 – present',
  years: { from: 2025 },
  channel4LeadsRamps: true,
  orGroups: [],
  hint: 'Colored interior light strips',
  rows: [
    ...sxFront(),
    ...commonRear(undefined),
    ...sides('FalconDoor', 'closures'),
    ...sides('FrontDoor', 'closures'),
    ...commonClosures(),
    ...centerDisplay('Unverified on Model X'),
    ...accentLights.map(([id, group]): Row => [id, group, { maybe: 'Unverified on Model X' }]),
  ],
});

// --- Model 3 and Y -------------------------------------------------------------

const threeYFront = (fogs: string | undefined): Row[] => [
  ...sides('OuterMainBeam', 'front', { maybe: 'Ramps on reflector headlights only' }),
  ...sides('InnerMainBeam', 'front'),
  ...sides('Signature', 'front'),
  ...sides('Channel4', 'front'),
  ...sides('Channel5', 'front'),
  ...sides('Channel6', 'front'),
  ...sides('FrontTurn', 'front'),
  ...sides('FrontFog', 'front', fogs ? { maybe: fogs } : {}),
  ...sides('AuxPark', 'front', fogs ? { maybe: fogs } : {}),
  ...sides('SideMarker', 'front', { maybe: NA_ONLY }),
  ...sides('SideRepeater', 'front'),
];

const threeYOrGroups = (tailsDriveLicensePlate: boolean): OrGroup[] => [
  // Channels 4-6 are one physical light per side.
  { inputs: ['leftChannel4', 'leftChannel5', 'leftChannel6'], outputs: ['leftChannel4', 'leftChannel5', 'leftChannel6'] },
  { inputs: ['rightChannel4', 'rightChannel5', 'rightChannel6'], outputs: ['rightChannel4', 'rightChannel5', 'rightChannel6'] },
  // All aux park lights and side markers operate together.
  {
    inputs: ['leftSideMarker', 'leftAuxPark', 'rightSideMarker', 'rightAuxPark'],
    outputs: ['leftSideMarker', 'leftAuxPark', 'rightSideMarker', 'rightAuxPark'],
  },
  ...(tailsDriveLicensePlate
    ? [{ inputs: ['leftTail', 'rightTail'], outputs: ['leftTail', 'rightTail', 'licensePlate'] }]
    : []),
];

const SR_PLUS = 'Not on Standard Range Plus';
const FOGS_2024 = 'Reportedly not fitted on 2024+ Model 3 (unverified)';

export const MODEL_3_2017 = profile({
  id: 'model3-2017',
  model: 'model3',
  body: { model: 'model3', fogLamps: true },
  variant: '2017 – Oct 2020',
  years: { from: 2017, to: 2020 },
  channel4LeadsRamps: true,
  orGroups: threeYOrGroups(true),
  hint: 'Built before October 2020',
  rows: [
    ...threeYFront(SR_PLUS),
    ...commonRear(NON_NA).map(([id, group, extra]): Row =>
      id === 'licensePlate' ? [id, group, { ...extra, label: 'License Plate (via tails)' }] : [id, group, extra],
    ),
    ...commonClosures('Only with a power trunk'),
    ...centerDisplay(),
  ],
});

export const MODEL_3_2020 = profile({
  id: 'model3-2020',
  model: 'model3',
  body: { model: 'model3', fogLamps: true },
  variant: 'Oct 2020 – 2023',
  hint: 'Built October 2020 or later',
  years: { from: 2020, to: 2023 },
  channel4LeadsRamps: true,
  orGroups: threeYOrGroups(false),
  rows: [...threeYFront(SR_PLUS), ...commonRear(NON_NA), ...commonClosures('Only with a power trunk'), ...centerDisplay()],
});

export const MODEL_3_2024 = profile({
  id: 'model3-2024',
  model: 'model3',
  body: { model: 'model3', refresh: true },
  variant: '2024 – present · Premium / Performance',
  hint: 'Refreshed design with colored interior light strips',
  years: { from: 2024 },
  channel4LeadsRamps: true,
  orGroups: threeYOrGroups(false),
  rows: [
    ...threeYFront(FOGS_2024),
    ...commonRear(NON_NA),
    ...commonClosures('Only with a power trunk'),
    ...centerDisplay(),
    ...accentLights,
  ],
});

export const MODEL_3_STANDARD = profile({
  id: 'model3-2026-standard',
  model: 'model3',
  body: { model: 'model3', refresh: true },
  variant: '2026 – present · Standard',
  hint: 'Standard trim: no colored interior light strips',
  years: { from: 2026 },
  channel4LeadsRamps: true,
  orGroups: threeYOrGroups(false),
  rows: [...threeYFront(FOGS_2024), ...commonRear(NON_NA), ...commonClosures('Only with a power trunk'), ...centerDisplay()],
});

export const MODEL_Y_2020 = profile({
  id: 'modelY-2020',
  model: 'modelY',
  body: { model: 'modelY', fogLamps: true },
  variant: '2020 – 2024',
  years: { from: 2020, to: 2025 },
  channel4LeadsRamps: true,
  orGroups: threeYOrGroups(false),
  hint: 'No light bar across the front',
  rows: [...threeYFront(undefined), ...commonRear(NON_NA), ...commonClosures('Only with a power liftgate'), ...centerDisplay()],
});

// The 2025+ Model Y came out after Tesla's last light show documentation
// update, so which channels drive its light bars is unknown. The preview
// assumes the front bar follows the signature lights and the rear bar the tail
// lights, the closest match on earlier cars.
const Y_2025 = 'Unverified on 2025+ Model Y';

const y2025Front = (lightBar: boolean): Row[] =>
  threeYFront(undefined).map(([id, group, extra]): Row => {
    const bar = lightBar && /Signature$/.test(id);
    return [id, group, { maybe: bar ? 'Assumed to drive the front light bar (unverified)' : Y_2025, ...extra }];
  });

export const MODEL_Y_2025 = profile({
  id: 'modelY-2025',
  model: 'modelY',
  body: { model: 'modelY', refresh: true, frontLightBar: true, rearLightBar: true },
  variant: '2025 – present · Premium / Performance',
  hint: 'Light bars across the front and back',
  years: { from: 2025 },
  channel4LeadsRamps: true,
  orGroups: threeYOrGroups(false),
  rows: [
    ...y2025Front(true),
    ...commonRear(NON_NA).map(([id, group, extra]): Row =>
      /Tail$/.test(id) ? [id, group, { ...extra, maybe: 'Assumed to drive the rear light bar (unverified)' }] : [id, group, extra],
    ),
    ...commonClosures('Only with a power liftgate'),
    ...centerDisplay(),
    ...accentLights,
  ],
});

export const MODEL_Y_STANDARD = profile({
  id: 'modelY-2026-standard',
  model: 'modelY',
  // Reports conflict on whether the rear light strip lights up on Standard.
  body: { model: 'modelY', refresh: true },
  variant: '2026 – present · Standard',
  hint: 'Standard trim: no front light bar, single-piece headlights',
  years: { from: 2026 },
  channel4LeadsRamps: true,
  orGroups: threeYOrGroups(false),
  rows: [...y2025Front(false), ...commonRear(NON_NA), ...commonClosures('Only with a power liftgate'), ...centerDisplay()],
});

// --- Cybertruck ------------------------------------------------------------------
// Several channels drive different lights than their names suggest
// (README "Cybertruck Light Remapping").

const lightBar = (base: string, count: number, label: string, maybe?: string): Row[] =>
  Array.from({ length: count }, (_, i): Row => [
    `${base}${i + 1}`,
    'front',
    { row: { key: base, label }, ...(maybe ? { maybe } : {}) },
  ]);

export const CYBERTRUCK_2024 = profile({
  id: 'cybertruck-2024',
  model: 'cybertruck',
  body: { model: 'cybertruck', frontLightBar: true, rearLightBar: true },
  variant: '2024 – present',
  hint: 'Cybertruck',
  years: { from: 2024 },
  channel4LeadsRamps: false,
  orGroups: [],
  rows: [
    ...sides('OuterMainBeam', 'front'),
    ...sides('InnerMainBeam', 'front'),
    ...sides('FrontTurn', 'front'),
    ...sides('SideMarker', 'front', { kind: 'ramping' }),
    ...lightBar('frontLightBar', 60, 'Front Light Bar (60 LEDs)'),
    ...lightBar('offroadLightBar', 6, 'Offroad Light Bar (6)', 'Optional upgrade'),
    ['leftAuxPark', 'front', { label: 'Frunk Light' }],
    ...lightBar('rearLightBar', 52, 'Rear Light Bar (52 LEDs)').map(([id, , extra]): Row => [id, 'rear', extra]),
    ['brakeLights', 'rear', { kind: 'dimmable' }],
    ['leftTail', 'rear', { label: 'Left Reverse Light' }],
    ['rightTail', 'rear', { label: 'Right Reverse Light' }],
    ['leftSideRepeater', 'rear', { label: 'Left Rear Side Marker' }],
    ['rightSideRepeater', 'rear', { label: 'Right Rear Side Marker' }],
    ['reverseLights', 'rear', { label: 'Bed Lights' }],
    ['licensePlate', 'rear'],
    ...sides('Mirror', 'closures'),
    ['leftFrontWindow', 'closures'],
    ['leftRearWindow', 'closures'],
    ['rightFrontWindow', 'closures'],
    ['rightRearWindow', 'closures'],
    ['liftgate', 'closures', { label: 'Powered Frunk' }],
    ['chargePort', 'closures'],
    ...centerDisplay(),
    ...accentLights,
  ],
});

/** Every supported vehicle, grouped by model, in menu order. */
export const VEHICLES: readonly VehicleProfile[] = [
  MODEL_S_2021,
  MODEL_3_2017,
  MODEL_3_2020,
  MODEL_3_2024,
  MODEL_3_STANDARD,
  MODEL_X_2021,
  MODEL_X_2025,
  MODEL_Y_2020,
  MODEL_Y_2025,
  MODEL_Y_STANDARD,
  CYBERTRUCK_2024,
];

export const VEHICLES_BY_ID: ReadonlyMap<string, VehicleProfile> = new Map(VEHICLES.map((v) => [v.id, v]));

export const DEFAULT_VEHICLE_ID = MODEL_X_2021.id;

/** Vehicles grouped under their model, for menus. */
export function vehiclesByModel(): { model: ModelId; name: string; variants: VehicleProfile[] }[] {
  const order: ModelId[] = ['modelS', 'model3', 'modelX', 'modelY', 'cybertruck'];
  return order.map((model) => ({ model, name: MODEL_NAMES[model], variants: VEHICLES.filter((v) => v.model === model) }));
}
