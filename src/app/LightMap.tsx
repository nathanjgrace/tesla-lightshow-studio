// The overhead map in the corner of the car view: the car from above, with its
// front and rear faces folded out flat (like an unfolded box), so every lamp
// is visible at once. Lamps glow as the show lights them; doors, windows,
// mirrors, liftgate and charge port fill in as they move. No need to fly the
// camera around to see what a moment of the show is doing.

import { useEffect, useRef, useState } from 'react';
import { CHANNELS_BY_ID } from '../core/channels';
import type { Simulation } from '../core/simulate';
import type { VehicleProfile } from '../core/vehicles';
import type { CarLayout, CarScene } from './car/CarScene';
import type { Playback } from './playback';

interface Props {
  scene: CarScene | undefined;
  sim: Simulation | undefined;
  playback: Playback;
  vehicle: VehicleProfile;
}

const PAD = 8;
const GAP = 7;
/** Height of each folded-out face, in px; lamp heights are stretched to fill it so stacked lamps stay apart. */
const FACE_H = 56;
const CAPTION_H = 26;

type Box = { min: [number, number, number]; max: [number, number, number] };
const center = (b: Box, a: 0 | 1 | 2) => (b.min[a] + b.max[a]) / 2;

export function LightMap({ scene, sim, playback, vehicle }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [layout, setLayout] = useState<CarLayout>();
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('lightMap') === '0';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!scene) return;
    setLayout(scene.layout());
    return scene.onBodyChange(() => setLayout(scene.layout()));
  }, [scene]);

  // Map scale: the car is drawn about 184 px long.
  const scale = layout ? 184 / (2 * layout.halfLength) : 36;
  const width = layout ? Math.round(2 * layout.halfWidth * scale + 2 * PAD + 14) : 100;
  const topH = layout ? 2 * layout.halfLength * scale : 184;
  const height = Math.round(PAD + FACE_H + GAP + topH + GAP + FACE_H + CAPTION_H);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !layout || hidden) return;
    const ctx = cv.getContext('2d')!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = width * dpr;
    cv.height = height * dpr;
    const cx = width / 2;
    const frontTop = PAD;
    const carTop = frontTop + FACE_H + GAP;
    const rearTop = carTop + topH + GAP;
    const names = new Map(vehicle.channels.map((c) => [c.id, c.label ?? CHANNELS_BY_ID.get(c.id)?.name ?? c.id]));

    // Sort lamps onto the three faces.
    const frontCut = layout.halfLength * 0.5;
    const front = layout.lamps.filter((l) => center(l, 0) > frontCut);
    const rear = layout.lamps.filter((l) => center(l, 0) < -frontCut);
    const side = layout.lamps.filter((l) => Math.abs(center(l, 0)) <= frontCut);
    const frontBars = layout.bars.filter((b) => center(b, 0) > 0);
    const rearBars = layout.bars.filter((b) => center(b, 0) <= 0);
    const yRange = (items: Box[]) => {
      const lo = Math.min(...items.map((l) => l.min[1]), Infinity);
      const hi = Math.max(...items.map((l) => l.max[1]), -Infinity);
      return Number.isFinite(lo) ? ([lo, Math.max(hi, lo + 0.2)] as const) : ([0.3, 1.1] as const);
    };
    const frontY = yRange([...front, ...frontBars]);
    const rearY = yRange([...rear, ...rearBars]);
    const zx = (z: number) => cx + z * scale;
    /** A lamp's rectangle on a folded-out face; `flip` puts higher lamps lower (the rear face folds down). */
    const faceRect = (b: Box, top: number, [lo, hi]: readonly [number, number], flip: boolean) => {
      const t = (y: number) => (y - lo) / (hi - lo);
      const inner = FACE_H - 12;
      const a = flip ? top + 6 + (1 - t(b.max[1])) * inner : top + 6 + (1 - t(b.max[1])) * inner;
      const h = Math.max(3, (t(b.max[1]) - t(b.min[1])) * inner);
      const x0 = zx(b.min[2]);
      const w = Math.max(3, (b.max[2] - b.min[2]) * scale);
      const y = flip ? top + FACE_H - (a - top) - h : a;
      return [x0, y, w, h] as const;
    };

    const rounded = (x: number, y: number, w: number, h: number, r: number) => {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
    };

    function draw(timeMs: number) {
      const frame = sim ? Math.max(0, Math.min(sim.frameCount - 1, Math.floor(timeMs / sim.stepTimeMs))) : 0;
      const level = (ids: readonly string[]) => {
        let v = 0;
        for (const id of ids) v = Math.max(v, sim?.levels.get(id)?.[frame] ?? 0);
        return v;
      };
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // The three faces.
      const bodyW = 2 * layout!.halfWidth * scale;
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 1;
      for (const top of [frontTop, rearTop]) {
        rounded(cx - bodyW / 2, top, bodyW, FACE_H, 9);
        ctx.fill();
        ctx.stroke();
      }
      rounded(cx - bodyW / 2, carTop, bodyW, topH, 22);
      ctx.fill();
      ctx.stroke();
      // Cabin glass, to show which way the car points.
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      rounded(cx - bodyW * 0.36, carTop + topH * 0.3, bodyW * 0.72, topH * 0.5, 12);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.32)';
      ctx.font = '600 8px Inter Variable, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('FRONT', cx, frontTop + FACE_H - 3);
      ctx.fillText('REAR', cx, rearTop + 9);

      const lamp = (x: number, y: number, w: number, h: number, color: string, v: number) => {
        rounded(x, y, w, h, 2);
        ctx.fillStyle = 'rgba(255,255,255,0.13)';
        ctx.fill();
        if (v <= 0.01) return;
        ctx.save();
        ctx.globalAlpha = Math.min(1, 0.25 + v);
        ctx.shadowColor = color;
        ctx.shadowBlur = 4 + 8 * v;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();
      };
      for (const l of front) lamp(...faceRect(l, frontTop, frontY, false), l.color, level(l.ids));
      for (const l of rear) lamp(...faceRect(l, rearTop, rearY, true), l.color, level(l.ids));
      for (const [bars, top, range, flip] of [
        [frontBars, frontTop, frontY, false],
        [rearBars, rearTop, rearY, true],
      ] as const) {
        for (const b of bars) {
          const [x, y, w, h] = faceRect(b, top, range, flip);
          const n = b.pixels.length;
          for (let i = 0; i < n; i++) lamp(x + (i * w) / n, y, Math.max(1, w / n - 0.5), h, b.color, level(b.pixels[i]!));
        }
      }
      // Lamps along the sides (repeaters) sit just outside the body outline.
      for (const l of side) {
        const s = center(l, 2) < 0 ? -1 : 1;
        const y = carTop + (layout!.halfLength - center(l, 0)) * scale;
        lamp(cx + s * (bodyW / 2 + 1.5) - 2.5, y - 4, 5, 8, l.color, level(l.ids));
      }

      // Moving parts, on the overhead view.
      const active: string[] = [];
      for (const c of layout!.closures) {
        const track = sim?.closures.get(c.id);
        const mirror = c.id.endsWith('Mirror');
        const position = track?.position[frame] ?? (mirror ? 1 : 0);
        const dancing = !!track?.dancing[frame];
        // A mirror rests unfolded; it's "doing something" when folded in.
        const amount = mirror ? 1 - position : position;
        if (amount <= 0.02 && !dancing) continue;
        const x = zx(c.min[2]);
        const w = Math.max(4, (c.max[2] - c.min[2]) * scale);
        const y = carTop + (layout!.halfLength - c.max[0]) * scale;
        const h = Math.max(4, (c.max[0] - c.min[0]) * scale);
        rounded(x, y, w, h, 3);
        ctx.fillStyle = dancing ? `rgba(192,132,252,${0.35 + 0.5 * amount})` : `rgba(110,168,255,${0.25 + 0.6 * amount})`;
        ctx.fill();
        ctx.strokeStyle = dancing ? '#c084fc' : '#6ea8ff';
        ctx.stroke();
        const name = (names.get(c.id) ?? c.id).replace(/^(Left|Right) /, (m) => (m.startsWith('L') ? 'L ' : 'R '));
        active.push(`${name} ${dancing ? 'dancing' : mirror ? 'folded' : `${Math.round(amount * 100)}%`}`);
      }
      ctx.fillStyle = active.length ? '#9cc2ff' : 'rgba(255,255,255,0.3)';
      ctx.font = '500 9px Inter Variable, system-ui, sans-serif';
      const caption = active.length > 2 ? [`${active[0]}`, `+ ${active.length - 1} more moving`] : active.length ? active : ['Nothing moving'];
      caption.forEach((line, i) => ctx.fillText(line, cx, rearTop + FACE_H + 11 + i * 11, width - 6));
    }

    return playback.subscribe(draw);
  }, [layout, sim, playback, vehicle, hidden, scale, width, height, topH]);

  const toggle = () => {
    setHidden((h) => {
      try {
        localStorage.setItem('lightMap', h ? '1' : '0');
      } catch {
        // Not remembered in private browsing.
      }
      return !h;
    });
  };

  if (!layout) return null;
  return (
    <div className={`light-map${hidden ? ' hidden' : ''}`}>
      <button className="light-map-toggle" onClick={toggle} title={hidden ? 'Show the overhead light map' : 'Hide the overhead light map'}>
        {hidden ? 'Light map' : '×'}
      </button>
      {!hidden && <canvas ref={canvas} style={{ width, height }} aria-label="Overhead map of the lights and moving parts in use" />}
    </div>
  );
}
