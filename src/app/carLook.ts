// How the preview car looks: paint per vehicle version and the reflections
// switch. Lives above the car view so the toolbar's car picker can set it.

import { useState } from 'react';
import { parsePaintChoice, resolvePaint, type PaintChoice, type PaintFinish } from '../core/paint';
import type { VehicleProfile } from '../core/vehicles';

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered in private browsing; that's fine.
  }
}

// Paint is remembered per vehicle version, since each has its own colors.
const paintKey = (vehicle: VehicleProfile) => `paint:${vehicle.id}`;

export interface CarLook {
  paint: PaintChoice | undefined;
  choosePaint: (choice: PaintChoice) => void;
  hex: string;
  finish: PaintFinish;
  reflections: boolean;
  setReflections: (on: boolean) => void;
}

export function useCarLook(vehicle: VehicleProfile): CarLook {
  // Older versions stored the reflections toggle as finish=glossy.
  const [reflections, setReflectionsState] = useState(() => {
    const v = stored('reflections');
    return v === null ? stored('finish') === 'glossy' : v === '1';
  });
  const [paints, setPaints] = useState<Record<string, PaintChoice | undefined>>({});
  const paint = vehicle.id in paints ? paints[vehicle.id] : parsePaintChoice(stored(paintKey(vehicle)));
  const { hex, finish } = resolvePaint(paint, vehicle.id);
  return {
    paint,
    hex,
    finish,
    choosePaint: (choice) => {
      setPaints((p) => ({ ...p, [vehicle.id]: choice }));
      store(paintKey(vehicle), JSON.stringify(choice));
    },
    reflections,
    setReflections: (on) => {
      setReflectionsState(on);
      store('reflections', on ? '1' : '0');
    },
  };
}

/** "Model S 2021 – present" → "Model S ’21+", for the compact car picker. */
export function shortVehicleName(name: string): string {
  return name
    .replace(/\b\d{2}(\d{2}) – present\b/, '’$1+')
    .replace(/\b\d{2}(\d{2}) – \d{2}(\d{2})\b/, '’$1–’$2');
}
