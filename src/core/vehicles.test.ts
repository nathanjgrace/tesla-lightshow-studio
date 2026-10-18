import { describe, expect, it } from 'vitest';
import { CHANNELS_BY_ID } from './channels';
import { VEHICLES, vehiclesByModel } from './vehicles';

describe('vehicle profiles', () => {
  it.each(VEHICLES.map((v) => [v.id, v] as const))('%s lists each channel once', (_, v) => {
    const ids = v.channels.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(VEHICLES.map((v) => [v.id, v] as const))('%s combines only channels it has', (_, v) => {
    const ids = new Set(v.channels.map((c) => c.id));
    for (const g of v.orGroups) for (const id of [...g.inputs, ...g.outputs]) expect(ids.has(id)).toBe(true);
  });

  it('only gives falcon wings and front doors to Model X, door handles to Model S', () => {
    for (const v of VEHICLES) {
      const ids = new Set(v.channels.map((c) => c.id));
      expect(ids.has('leftFalconDoor')).toBe(v.model === 'modelX');
      expect(ids.has('leftFrontDoorHandle')).toBe(v.model === 'modelS');
    }
  });

  it('marks Model S/X signature and front turn lights as on/off', () => {
    for (const v of VEHICLES.filter((v) => v.model === 'modelS' || v.model === 'modelX')) {
      const kind = (id: string) => v.channels.find((c) => c.id === id)!.kind;
      expect(kind('leftSignature')).toBe('boolean');
      expect(kind('leftFrontTurn')).toBe('boolean');
    }
  });

  it('groups every vehicle under a model', () => {
    const grouped = vehiclesByModel().flatMap((m) => m.variants);
    expect(grouped).toHaveLength(VEHICLES.length);
    expect(VEHICLES.every((v) => v.channels.every((c) => CHANNELS_BY_ID.has(c.id)))).toBe(true);
  });
});
