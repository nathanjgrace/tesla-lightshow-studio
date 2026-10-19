import { describe, expect, it } from 'vitest';
import { factoryPaints, offerYears, parsePaintChoice, PAINTS, resolvePaint } from './paint';
import { VEHICLES } from './vehicles';

describe('factoryPaints', () => {
  it('lists colors for every vehicle version, each with a valid hex', () => {
    for (const v of VEHICLES) {
      const offers = factoryPaints(v.id);
      expect(offers.length, v.id).toBeGreaterThan(1);
      for (const o of offers) expect(o.paint.hex, `${v.id} ${o.paint.id}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('keeps colors inside the version years', () => {
    for (const v of VEHICLES) {
      for (const o of factoryPaints(v.id)) {
        if (o.from !== undefined) expect(o.from, `${v.id} ${o.paint.id}`).toBeGreaterThanOrEqual(v.years.from);
        if (o.to !== undefined && v.years.to !== undefined) expect(o.to, `${v.id} ${o.paint.id}`).toBeLessThanOrEqual(v.years.to);
      }
    }
  });

  it('defaults the Cybertruck to bare stainless and others to Pearl White', () => {
    expect(factoryPaints('cybertruck-2024')[0]!.paint.id).toBe('stainless');
    expect(factoryPaints('modelX-2021')[0]!.paint.id).toBe('pearlWhite');
  });

  it('only offers the 2025 refresh colors on the 2025 Model X', () => {
    const ids = (id: string) => factoryPaints(id).map((o) => o.paint.id);
    expect(ids('modelX-2025')).toContain('frostBlue');
    expect(ids('modelX-2021')).not.toContain('frostBlue');
    expect(ids('modelX-2021')).toContain('midnightSilver');
  });
});

describe('offerYears', () => {
  it('formats ranges', () => {
    expect(offerYears({ paint: PAINTS.ultraRed! })).toBe('');
    expect(offerYears({ paint: PAINTS.ultraRed!, from: 2023 })).toBe('2023 – present');
    expect(offerYears({ paint: PAINTS.ultraRed!, from: 2021, to: 2022 })).toBe('2021 – 2022');
    expect(offerYears({ paint: PAINTS.ultraRed!, from: 2025, to: 2025 })).toBe('2025');
  });
});

describe('resolvePaint', () => {
  it('uses the factory color, or the default when the color isn’t offered', () => {
    expect(resolvePaint({ paintId: 'ultraRed' }, 'modelX-2025').name).toBe('Ultra Red');
    expect(resolvePaint({ paintId: 'stainless' }, 'modelX-2025').name).toBe('Pearl White Multi-Coat');
    expect(resolvePaint(undefined, 'cybertruck-2024').finish).toBe('stainless');
  });

  it('uses a custom color when it is a valid hex', () => {
    expect(resolvePaint({ custom: '#12AB34', finish: 'matte' }, 'modelY-2025')).toEqual({ hex: '#12ab34', finish: 'matte', name: 'Custom' });
    expect(resolvePaint({ custom: 'red', finish: 'matte' }, 'modelY-2025').name).toBe('Pearl White Multi-Coat');
  });
});

describe('parsePaintChoice', () => {
  it('reads stored choices and ignores junk', () => {
    expect(parsePaintChoice('{"paintId":"deepBlue"}')).toEqual({ paintId: 'deepBlue' });
    expect(parsePaintChoice('{"custom":"#ff0000","finish":"satin"}')).toEqual({ custom: '#ff0000', finish: 'satin' });
    expect(parsePaintChoice('{"custom":"#ff0000","finish":"chrome"}')).toBeUndefined();
    expect(parsePaintChoice('not json')).toBeUndefined();
    expect(parsePaintChoice(null)).toBeUndefined();
  });
});
