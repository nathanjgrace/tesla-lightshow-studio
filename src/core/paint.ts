// Factory paint colors per vehicle version, for the 3D preview. Names and
// years come from Tesla's configurator history and service manuals; the hex
// values are visual approximations, not paint codes. Sources and confidence:
// docs/research/02-paint-colors.md.

export type PaintFinish = 'gloss' | 'metallic' | 'pearl' | 'satin' | 'matte' | 'stainless';

export const FINISH_LABELS: Record<PaintFinish, string> = {
  gloss: 'Gloss',
  metallic: 'Metallic',
  pearl: 'Multi-Coat',
  satin: 'Satin',
  matte: 'Matte',
  stainless: 'Stainless',
};

/** Finishes offered for a custom color. */
export const CUSTOM_FINISHES: PaintFinish[] = ['gloss', 'metallic', 'satin', 'matte'];

export interface PaintColor {
  id: string;
  name: string;
  /** sRGB hex, e.g. "#e9e9e6". */
  hex: string;
  finish: PaintFinish;
  /** Tesla wraps (Cybertruck) rather than paint. */
  wrap?: boolean;
}

const c = (id: string, name: string, hex: string, finish: PaintFinish, wrap?: boolean): PaintColor => ({
  id,
  name,
  hex,
  finish,
  ...(wrap ? { wrap } : {}),
});

export const PAINTS: Record<string, PaintColor> = Object.fromEntries(
  [
    c('pearlWhite', 'Pearl White Multi-Coat', '#e9e9e6', 'pearl'),
    c('solidBlack', 'Solid Black', '#0d0d0e', 'gloss'),
    c('diamondBlack', 'Diamond Black', '#08090b', 'metallic'),
    c('obsidianBlack', 'Obsidian Black Metallic', '#18181c', 'metallic'),
    c('midnightSilver', 'Midnight Silver Metallic', '#4b4f55', 'metallic'),
    c('stealthGrey', 'Stealth Grey', '#3d4044', 'gloss'),
    c('silverMetallic', 'Silver Metallic', '#b2b4b6', 'metallic'),
    c('quicksilver', 'Quicksilver', '#b4b7ba', 'metallic'),
    c('lunarSilver', 'Lunar Silver', '#a6aaab', 'metallic'),
    c('deepBlue', 'Deep Blue Metallic', '#1d3566', 'metallic'),
    c('marineBlue', 'Marine Blue', '#1b2a45', 'metallic'),
    c('glacierBlue', 'Glacier Blue', '#9db2c4', 'gloss'),
    c('frostBlue', 'Frost Blue Metallic', '#b7c6d0', 'metallic'),
    c('redMultiCoat', 'Red Multi-Coat', '#9e1119', 'pearl'),
    c('ultraRed', 'Ultra Red', '#b5121b', 'pearl'),
    c('stainless', 'Stainless Steel', '#b9bcc0', 'stainless'),
    c('satinStealthBlack', 'Satin Stealth Black', '#141416', 'satin', true),
    c('satinCeramicWhite', 'Satin Ceramic White', '#dcdcd8', 'satin', true),
    c('satinRoseGold', 'Satin Rose Gold', '#c49a8c', 'satin', true),
    c('satinAbyssBlue', 'Satin Abyss Blue', '#1f3550', 'satin', true),
    c('forestGreen', 'Forest Green', '#2c3d2e', 'gloss', true),
    c('satinCrimsonRed', 'Satin Crimson Red', '#7c1a1f', 'satin', true),
  ].map((p) => [p.id, p]),
);

/** A color offered for a vehicle version, with the model years it was offered (open-ended `to` = still offered). */
export interface Offer {
  paint: PaintColor;
  from?: number;
  to?: number;
}

type Row = [id: string, from?: number, to?: number];

const S_X_2021: Row[] = [
  ['pearlWhite'],
  ['solidBlack', 2021, 2025],
  ['diamondBlack', 2025],
  ['midnightSilver', 2021, 2022],
  ['stealthGrey', 2023],
  ['lunarSilver', 2024, 2025],
  ['deepBlue', 2021, 2024],
  ['frostBlue', 2025],
  ['redMultiCoat', 2021, 2022],
  ['ultraRed', 2023],
];

const CYBERTRUCK_WRAPS: Row[] = [
  ['satinStealthBlack', 2024, 2025],
  ['satinCeramicWhite', 2024, 2025],
  ['satinRoseGold', 2024, 2025],
  ['satinAbyssBlue', 2024, 2025],
  ['forestGreen', 2024, 2025],
  ['satinCrimsonRed', 2024, 2025],
];

/** Colors per vehicle profile id (see vehicles.ts), in Tesla's configurator order. */
const OFFERED: Record<string, Row[]> = {
  'modelS-2021': S_X_2021,
  'modelX-2021': S_X_2021.filter(([, from]) => (from ?? 0) <= 2024).map(([id, from, to]) => [id, from, to && Math.min(to, 2024)]),
  'modelX-2025': [['pearlWhite'], ['diamondBlack'], ['stealthGrey'], ['lunarSilver', 2025, 2025], ['frostBlue'], ['ultraRed']],
  'model3-2017': [
    ['pearlWhite'],
    ['solidBlack'],
    ['obsidianBlack', 2017, 2018],
    ['midnightSilver'],
    ['silverMetallic', 2017, 2019],
    ['deepBlue'],
    ['redMultiCoat'],
  ],
  'model3-2020': [['pearlWhite'], ['solidBlack'], ['midnightSilver', 2020, 2023], ['stealthGrey', 2023], ['deepBlue'], ['redMultiCoat']],
  'model3-2024': [
    ['pearlWhite'],
    ['solidBlack', 2024, 2024],
    ['diamondBlack', 2025],
    ['stealthGrey'],
    ['quicksilver'],
    ['deepBlue', 2024, 2025],
    ['marineBlue', 2025],
    ['ultraRed'],
  ],
  'model3-2026-standard': [['pearlWhite'], ['diamondBlack'], ['stealthGrey']],
  'modelY-2020': [
    ['pearlWhite'],
    ['solidBlack'],
    ['midnightSilver', 2020, 2023],
    ['stealthGrey', 2023],
    ['quicksilver', 2024],
    ['deepBlue'],
    ['redMultiCoat', 2020, 2023],
    ['ultraRed', 2024],
  ],
  'modelY-2025': [
    ['pearlWhite'],
    ['diamondBlack'],
    ['stealthGrey'],
    ['quicksilver'],
    ['glacierBlue'],
    ['marineBlue', 2025],
    ['ultraRed'],
  ],
  'modelY-2026-standard': [['pearlWhite'], ['diamondBlack'], ['stealthGrey']],
  'cybertruck-2024': [['stainless'], ...CYBERTRUCK_WRAPS],
};

/** The colors offered for a vehicle profile; the first is its default. */
export function factoryPaints(profileId: string): Offer[] {
  const rows = OFFERED[profileId] ?? [['pearlWhite']];
  return rows.map(([id, from, to]) => {
    const paint = PAINTS[id];
    if (!paint) throw new Error(`Unknown paint ${id} for ${profileId}`);
    return { paint, ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) };
  });
}

/** "2021 – 2022", "2023 – present", or "" when offered for the whole version. */
export function offerYears(offer: Offer): string {
  if (offer.from === undefined && offer.to === undefined) return '';
  if (offer.to === undefined) return `${offer.from} – present`;
  if (offer.from === offer.to) return `${offer.from}`;
  return `${offer.from ?? ''} – ${offer.to}`;
}

/** The car's look in the preview: a factory color by id, or a custom color. */
export type PaintChoice = { paintId: string } | { custom: string; finish: PaintFinish };

export function resolvePaint(choice: PaintChoice | undefined, profileId: string): { hex: string; finish: PaintFinish; name: string } {
  const offers = factoryPaints(profileId);
  if (choice && 'custom' in choice && /^#[0-9a-f]{6}$/i.test(choice.custom)) {
    return { hex: choice.custom.toLowerCase(), finish: choice.finish, name: 'Custom' };
  }
  const offer = (choice && 'paintId' in choice && offers.find((o) => o.paint.id === choice.paintId)) || offers[0]!;
  return { hex: offer.paint.hex, finish: offer.paint.finish, name: offer.paint.name };
}

/** Parses a stored choice defensively (it comes from localStorage). */
export function parsePaintChoice(raw: string | null): PaintChoice | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (typeof v.paintId === 'string') return { paintId: v.paintId };
    if (typeof v.custom === 'string' && typeof v.finish === 'string' && v.finish in FINISH_LABELS) {
      return { custom: v.custom, finish: v.finish as PaintFinish };
    }
  } catch {
    // Ignore bad data.
  }
  return undefined;
}
