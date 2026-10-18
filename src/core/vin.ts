// Decodes a Tesla VIN locally (nothing is sent anywhere) into model, model
// year and factory, then lists the vehicle profiles it could be. Uses the
// standard VIN layout (49 CFR 565): position 4 = Tesla's model letter,
// 9 = check digit, 10 = model year, 11 = plant.

import { MODEL_NAMES, VEHICLES, type ModelId, type VehicleProfile } from './vehicles';

export interface VinResult {
  vin: string;
  model: ModelId;
  modelName: string;
  modelYear: number;
  plant: string | undefined;
  /** False when the check digit doesn't match: likely a typo. */
  checkDigitValid: boolean;
  /** Profiles matching this model and year; more than one means we need to ask. */
  candidates: VehicleProfile[];
  /** Set when the car is too old for custom light shows. */
  unsupported?: string;
}

export class VinError extends Error {}

const TESLA_WMIS = new Set(['5YJ', '7SA', '7G2', 'LRW', 'XP7', 'SFZ']);
const MODEL_LETTERS: Record<string, ModelId> = { S: 'modelS', '3': 'model3', X: 'modelX', Y: 'modelY', C: 'cybertruck' };
const PLANTS: Record<string, string> = {
  F: 'Fremont, California',
  A: 'Austin, Texas',
  C: 'Shanghai, China',
  B: 'Berlin, Germany',
  N: 'Reno, Nevada',
  P: 'Palo Alto, California',
};
// Model year letters repeat every 30 years; Tesla VINs are all 2010 or later.
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY';

const TRANSLITERATION: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export function checkDigit(vin: string): string {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = vin[i]!;
    const value = /\d/.test(ch) ? Number(ch) : TRANSLITERATION[ch]!;
    sum += value * WEIGHTS[i]!;
  }
  const r = sum % 11;
  return r === 10 ? 'X' : String(r);
}

export function decodeVin(input: string): VinResult {
  const vin = input.trim().toUpperCase().replace(/[\s-]/g, '');
  if (vin.length !== 17) throw new VinError(`A VIN has 17 characters; this has ${vin.length}`);
  if (/[IOQ]/.test(vin)) throw new VinError('VINs never contain the letters I, O or Q; check for 1 or 0 instead');
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) throw new VinError('A VIN only has letters and numbers');
  if (!TESLA_WMIS.has(vin.slice(0, 3))) throw new VinError("This doesn't look like a Tesla VIN (it should start with 5YJ, 7SA, 7G2, LRW or XP7)");

  const model = MODEL_LETTERS[vin[3]!];
  if (!model) throw new VinError(`Unknown Tesla model code "${vin[3]}" in position 4`);
  const yearIndex = YEAR_CODES.indexOf(vin[9]!);
  if (yearIndex < 0) throw new VinError(`Unknown model year code "${vin[9]}" in position 10`);
  const modelYear = 2010 + yearIndex;

  const candidates = VEHICLES.filter(
    (v) => v.model === model && v.years.from <= modelYear && (v.years.to === undefined || modelYear <= v.years.to),
  );
  const unsupported =
    (model === 'modelS' || model === 'modelX') && modelYear < 2021
      ? `Tesla only supports custom light shows on ${MODEL_NAMES[model]} 2021 and newer`
      : undefined;

  return {
    vin,
    model,
    modelName: MODEL_NAMES[model],
    modelYear,
    plant: PLANTS[vin[10]!],
    checkDigitValid: checkDigit(vin) === vin[8],
    candidates,
    ...(unsupported ? { unsupported } : {}),
  };
}
