import { describe, expect, it } from 'vitest';
import { checkDigit, decodeVin, VinError } from './vin';

// Made-up VINs with correct check digits.
describe('decodeVin', () => {
  it('decodes a 2021 Model X from Fremont', () => {
    const r = decodeVin('5yjxcbe25mf123456');
    expect(r).toMatchObject({ model: 'modelX', modelYear: 2021, plant: 'Fremont, California', checkDigitValid: true });
    expect(r.candidates.map((c) => c.id)).toEqual(['modelX-2021']);
  });

  it('offers both Model 3 variants for model year 2020', () => {
    const r = decodeVin('5YJ3E1EA6LF000001');
    expect(r.candidates.map((c) => c.id)).toEqual(['model3-2017', 'model3-2020']);
  });

  it('offers both Model Y variants for model year 2025', () => {
    const r = decodeVin('7SAYGDEE1SF000123');
    expect(r.candidates.map((c) => c.id)).toEqual(['modelY-2020', 'modelY-2025']);
  });

  it('decodes a Cybertruck', () => {
    expect(decodeVin('7G2CEHED2RA012345')).toMatchObject({ model: 'cybertruck', modelYear: 2024, plant: 'Austin, Texas' });
  });

  it('flags Model S/X older than 2021 as unsupported', () => {
    const r = decodeVin('5YJSA1E27HF000001');
    expect(r.modelYear).toBe(2017);
    expect(r.unsupported).toMatch(/2021/);
    expect(r.candidates).toEqual([]);
  });

  it('notices a typo through the check digit', () => {
    expect(decodeVin('5YJXCBE25MF123457').checkDigitValid).toBe(false);
  });

  it('ignores spaces and dashes', () => {
    expect(decodeVin(' 5YJXC-BE25M F123456 ').vin).toBe('5YJXCBE25MF123456');
  });

  it.each([
    ['5YJXCBE25MF12345', /17 characters/],
    ['5YJXCBE25MF12345O', /I, O or Q/],
    ['1HGCM82633A004352', /Tesla/],
  ])('rejects %s', (vin, message) => {
    expect(() => decodeVin(vin)).toThrow(VinError);
    expect(() => decodeVin(vin)).toThrow(message);
  });

  it('computes check digits per the standard (known Honda example)', () => {
    expect(checkDigit('1HGCM82633A004352')).toBe('3');
  });
});

describe('decodeVin trims', () => {
  it('offers Premium and Standard for a 2026 Model Y', () => {
    // 7SAYGDEE?TF000123 with a valid check digit
    const vin = '7SAYGDEE' + 'X' + 'TF000123';
    const fixed = vin.slice(0, 8) + checkDigit(vin) + vin.slice(9);
    expect(decodeVin(fixed).candidates.map((c) => c.id)).toEqual(['modelY-2025', 'modelY-2026-standard']);
  });
});
