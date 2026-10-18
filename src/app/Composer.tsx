// The song/lighting composer: a timeline with the audio waveform on top and
// one row per light or closure below. Drawn on a canvas for speed; the
// static layer is cached and only the playhead is redrawn while playing.

import { useEffect, useRef } from 'react';
import { CHANNELS_BY_ID } from '../core/channels';
import { decodeClosure, type ClosureCommand } from '../core/encoding';
import type { FseqFile } from '../core/fseq';
import type { Simulation } from '../core/simulate';
import { formatTime } from '../core/validate';
import type { ChannelGroup, VehicleProfile } from '../core/vehicles';
import type { Peaks } from './audio';
import type { Playback } from './playback';

const LABEL_W = 168;
const RULER_H = 22;
const WAVE_H = 52;
const ROW_H = 18;
const GROUP_H = 22;
const HEADER_H = RULER_H + WAVE_H;

const C = {
  bg: '#121417',
  rowAlt: '#16191d',
  grid: '#24282e',
  label: '#c9ced6',
  labelDim: '#7d848e',
  group: '#8b93a0',
  wave: '#5b8def',
  playhead: '#ff3b3b',
  range: 'rgba(232, 33, 39, 0.28)',
  rangeEdge: '#ff6a5f',
  white: '#ffe7b0',
  amber: '#ffa21a',
  red: '#ff4a4a',
  position: '#e8eaee',
};

const CLOSURE_COLORS: Record<ClosureCommand, string | undefined> = {
  idle: undefined,
  open: '#3fa45b',
  close: '#3b82d6',
  dance: '#a855f7',
  stop: '#e04848',
};

const GROUP_LABELS: Record<ChannelGroup, string> = {
  front: 'Front lights',
  rear: 'Rear lights',
  closures: 'Doors & closures',
  interior: 'Interior',
};

type Row =
  | { type: 'group'; label: string }
  | { type: 'light'; label: string; ids: string[]; color: string; note?: string }
  | { type: 'closure'; label: string; id: string }
  | { type: 'rgb'; label: string; ids: [string, string, string]; note?: string };

function lightColor(id: string, group: ChannelGroup): string {
  if (/Turn|Repeater|SideMarker/.test(id)) return C.amber;
  if (group === 'rear' && !/reverse|license/i.test(id)) return C.red;
  return C.white;
}

export function buildRows(profile: VehicleProfile): Row[] {
  const rows: Row[] = [];
  const merged = new Map<string, Extract<Row, { type: 'light' }>>();
  let group: ChannelGroup | undefined;
  for (const pc of profile.channels) {
    if (pc.group !== group) {
      group = pc.group;
      rows.push({ type: 'group', label: GROUP_LABELS[group] });
    }
    const name = pc.label ?? CHANNELS_BY_ID.get(pc.id)!.name;
    // Light bars: many LEDs, one row showing the brightest.
    if (pc.row) {
      const existing = merged.get(pc.row.key);
      if (existing) existing.ids.push(pc.id);
      else {
        const row: Extract<Row, { type: 'light' }> = {
          type: 'light',
          label: pc.row.label,
          ids: [pc.id],
          color: C.white,
          ...(pc.maybe ? { note: pc.maybe } : {}),
        };
        merged.set(pc.row.key, row);
        rows.push(row);
      }
      continue;
    }
    if (pc.kind === 'closure') {
      rows.push({ type: 'closure', label: name, id: pc.id });
    } else if (pc.kind === 'rgb') {
      if (!pc.id.endsWith('Red')) continue;
      const base = pc.id.slice(0, -3);
      rows.push({
        type: 'rgb',
        label: name.replace(' (Red)', ''),
        ids: [`${base}Red`, `${base}Green`, `${base}Blue`],
        ...(pc.maybe ? { note: pc.maybe } : {}),
      });
    } else {
      rows.push({ type: 'light', label: name, ids: [pc.id], color: lightColor(pc.id, pc.group), ...(pc.maybe ? { note: pc.maybe } : {}) });
    }
  }
  return rows;
}

/** Shortens text with an ellipsis so it fits in maxWidth pixels. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

const rowHeight = (r: Row) => (r.type === 'group' ? GROUP_H : ROW_H);

interface View {
  startMs: number;
  pxPerSec: number;
  scrollY: number;
}

export interface Range {
  startMs: number;
  endMs: number;
}

interface Props {
  show: FseqFile;
  sim: Simulation;
  profile: VehicleProfile;
  peaks: Peaks | undefined;
  playback: Playback;
  /** The part of the song that gets exported. */
  range: Range;
  onRangeChange: (range: Range) => void;
}

export function Composer({ show, sim, profile, peaks, playback, range, onRangeChange }: Props) {
  // Held in refs so dragging the range redraws without rebuilding the canvas.
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const onRangeRef = useRef(onRangeChange);
  onRangeRef.current = onRangeChange;
  const drawRangeRef = useRef<() => void>(() => {});
  useEffect(() => drawRangeRef.current(), [range]);

  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ startMs: 0, pxPerSec: 40, scrollY: 0 });
  const redraw = useRef<() => void>(() => {});
  const fitted = useRef(false);

  const durationMs = show.frameCount * show.stepTimeMs;

  // A new show starts zoomed to fit. Declared first so it runs before drawing.
  useEffect(() => {
    fitted.current = false;
    view.current = { startMs: 0, pxPerSec: 40, scrollY: 0 };
  }, [show]);

  useEffect(() => {
    const el = host.current!;
    const cv = canvas.current!;
    const ctx = cv.getContext('2d')!;
    const rows = buildRows(profile);
    const contentH = rows.reduce((h, r) => h + rowHeight(r), 0);
    const staticLayer = document.createElement('canvas');
    const sctx = staticLayer.getContext('2d')!;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let playheadMs = playback.timeMs();

    const timelineW = () => Math.max(1, width - LABEL_W);
    const xOf = (ms: number) => LABEL_W + ((ms - view.current.startMs) / 1000) * view.current.pxPerSec;
    const msOf = (x: number) => view.current.startMs + ((x - LABEL_W) / view.current.pxPerSec) * 1000;

    function clampView() {
      const v = view.current;
      const minPx = timelineW() / Math.max(1, durationMs / 1000);
      v.pxPerSec = Math.min(800, Math.max(minPx, v.pxPerSec));
      const visibleMs = (timelineW() / v.pxPerSec) * 1000;
      v.startMs = Math.max(0, Math.min(v.startMs, durationMs - visibleMs));
      v.scrollY = Math.max(0, Math.min(v.scrollY, contentH - (height - HEADER_H)));
    }

    function drawStatic() {
      const v = view.current;
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sctx.fillStyle = C.bg;
      sctx.fillRect(0, 0, width, height);
      const t0 = v.startMs;
      const t1 = msOf(width);
      const msPerPx = 1000 / v.pxPerSec;
      const frameOf = (ms: number) => Math.max(0, Math.min(sim.frameCount, Math.floor(ms / sim.stepTimeMs)));

      // Rows
      sctx.save();
      sctx.beginPath();
      sctx.rect(0, HEADER_H, width, height - HEADER_H);
      sctx.clip();
      let y = HEADER_H - v.scrollY;
      rows.forEach((row, i) => {
        const h = rowHeight(row);
        if (y + h < HEADER_H || y > height) {
          y += h;
          return;
        }
        if (row.type === 'group') {
          sctx.fillStyle = C.bg;
          sctx.fillRect(0, y, width, h);
          sctx.fillStyle = C.group;
          sctx.font = '600 11px system-ui, sans-serif';
          sctx.fillText(row.label.toUpperCase(), 10, y + 15);
          sctx.fillStyle = C.grid;
          sctx.fillRect(LABEL_W, y + h - 1, width - LABEL_W, 1);
          y += h;
          return;
        }
        sctx.fillStyle = i % 2 ? C.rowAlt : C.bg;
        sctx.fillRect(LABEL_W, y, width - LABEL_W, h);

        if (row.type === 'light' || row.type === 'rgb') {
          const tracks = row.ids.map((id) => sim.levels.get(id));
          for (let x = LABEL_W; x < width; x++) {
            const a = frameOf(msOf(x));
            const b = Math.max(a + 1, frameOf(msOf(x) + msPerPx));
            let peak = 0;
            const rgb = [0, 0, 0];
            tracks.forEach((track, ti) => {
              if (!track) return;
              for (let f = a; f < b && f < sim.frameCount; f++) {
                const l = track[f]!;
                if (ti < 3 && l > rgb[ti]!) rgb[ti] = l;
                if (l > peak) peak = l;
              }
            });
            if (peak <= 0.01) continue;
            const barH = Math.max(2, peak * (h - 4));
            sctx.fillStyle =
              row.type === 'rgb'
                ? `rgb(${Math.round(rgb[0]! * 255)},${Math.round(rgb[1]! * 255)},${Math.round(rgb[2]! * 255)})`
                : row.color;
            sctx.globalAlpha = 0.35 + 0.65 * peak;
            sctx.fillRect(x, y + h - 2 - barH, 1, barH);
          }
          sctx.globalAlpha = 1;
        } else {
          const def = CHANNELS_BY_ID.get(row.id)!;
          const fa = frameOf(t0);
          const fb = Math.min(sim.frameCount, frameOf(t1) + 1);
          const byteAt = (f: number) => (def.index < show.channelCount ? show.data[f * show.channelCount + def.index]! : 0);
          // Command blocks.
          let runStart = fa;
          let runCmd = decodeClosure(byteAt(fa));
          const flush = (end: number) => {
            const color = CLOSURE_COLORS[runCmd];
            if (!color) return;
            const xa = xOf(runStart * sim.stepTimeMs);
            const xb = Math.max(xa + 2, xOf(end * sim.stepTimeMs));
            sctx.fillStyle = color;
            sctx.globalAlpha = 0.55;
            sctx.fillRect(xa, y + 2, xb - xa, h - 4);
            sctx.globalAlpha = 1;
            if (xb - xa > 42) {
              sctx.fillStyle = '#fff';
              sctx.font = '10px system-ui, sans-serif';
              sctx.fillText(runCmd[0]!.toUpperCase() + runCmd.slice(1), Math.max(xa, LABEL_W) + 4, y + 13);
            }
          };
          for (let f = fa + 1; f < fb; f++) {
            const cmd = decodeClosure(byteAt(f));
            if (cmd !== runCmd) {
              flush(f);
              runStart = f;
              runCmd = cmd;
            }
          }
          flush(fb);
          // Simulated position (how open it is) as a line.
          const track = sim.closures.get(row.id);
          if (track) {
            sctx.strokeStyle = C.position;
            sctx.globalAlpha = 0.8;
            sctx.lineWidth = 1;
            sctx.beginPath();
            for (let x = LABEL_W; x < width; x++) {
              const f = Math.min(sim.frameCount - 1, frameOf(msOf(x)));
              const py = y + h - 3 - track.position[f]! * (h - 6);
              if (x === LABEL_W) sctx.moveTo(x, py);
              else sctx.lineTo(x, py);
            }
            sctx.stroke();
            sctx.globalAlpha = 1;
          }
        }
        y += h;
      });

      // Labels column
      y = HEADER_H - v.scrollY;
      sctx.fillStyle = C.bg;
      sctx.fillRect(0, HEADER_H, LABEL_W, height - HEADER_H);
      sctx.font = '12px system-ui, sans-serif';
      for (const row of rows) {
        const h = rowHeight(row);
        if (row.type === 'group') {
          sctx.fillStyle = C.group;
          sctx.font = '600 11px system-ui, sans-serif';
          sctx.fillText(row.label.toUpperCase(), 10, y + 15);
          sctx.font = '12px system-ui, sans-serif';
        } else {
          const note = 'note' in row ? row.note : undefined;
          sctx.fillStyle = note ? C.labelDim : C.label;
          sctx.fillText(fitText(sctx, row.label + (note ? ' *' : ''), LABEL_W - 20), 14, y + 13);
        }
        y += h;
      }
      sctx.fillStyle = C.grid;
      sctx.fillRect(LABEL_W - 1, HEADER_H, 1, height - HEADER_H);
      sctx.restore();

      // Ruler
      sctx.fillStyle = '#0d0f12';
      sctx.fillRect(0, 0, width, HEADER_H);
      const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
      const step = steps.find((s) => s * v.pxPerSec >= 70) ?? 120;
      sctx.font = '10px system-ui, sans-serif';
      for (let s = Math.floor(t0 / 1000 / step) * step; s * 1000 <= t1; s += step) {
        const x = xOf(s * 1000);
        if (x < LABEL_W) continue;
        sctx.fillStyle = C.grid;
        sctx.fillRect(x, 0, 1, height);
        sctx.fillStyle = C.labelDim;
        sctx.fillText(formatTime(s * 1000).replace(/\.0$/, ''), x + 3, 14);
      }

      // Waveform
      const midY = RULER_H + WAVE_H / 2;
      sctx.fillStyle = '#0f1216';
      sctx.fillRect(LABEL_W, RULER_H, width - LABEL_W, WAVE_H);
      if (peaks) {
        sctx.fillStyle = C.wave;
        for (let x = LABEL_W; x < width; x++) {
          const a = Math.floor(msOf(x) / peaks.bucketMs);
          const b = Math.max(a + 1, Math.floor((msOf(x) + msPerPx) / peaks.bucketMs));
          let lo = 0;
          let hi = 0;
          for (let i = Math.max(0, a); i < b && i < peaks.min.length; i++) {
            if (peaks.min[i]! < lo) lo = peaks.min[i]!;
            if (peaks.max[i]! > hi) hi = peaks.max[i]!;
          }
          const top = midY - hi * (WAVE_H / 2 - 3);
          const bottom = midY - lo * (WAVE_H / 2 - 3);
          sctx.fillRect(x, top, 1, Math.max(1, bottom - top));
        }
      }
      sctx.fillStyle = '#0d0f12';
      sctx.fillRect(0, 0, LABEL_W, HEADER_H);
      sctx.fillStyle = C.labelDim;
      sctx.font = '11px system-ui, sans-serif';
      sctx.fillText(peaks ? 'Audio' : 'Audio (none)', 14, RULER_H + WAVE_H / 2 + 4);
      sctx.fillStyle = C.grid;
      sctx.fillRect(0, HEADER_H - 1, width, 1);
    }

    function drawFrame() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(staticLayer, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Export range: dim what's outside it, mark it on the ruler with handles.
      const { startMs, endMs } = rangeRef.current;
      const xa = Math.max(LABEL_W, xOf(startMs));
      const xb = Math.min(width, xOf(endMs));
      ctx.fillStyle = 'rgba(5, 6, 8, 0.6)';
      if (xa > LABEL_W) ctx.fillRect(LABEL_W, RULER_H, xa - LABEL_W, height - RULER_H);
      if (xb < width) ctx.fillRect(xb, RULER_H, width - xb, height - RULER_H);
      if (xb > xa) {
        ctx.fillStyle = C.range;
        ctx.fillRect(xa, 0, xb - xa, RULER_H);
        ctx.fillStyle = '#fff';
        ctx.font = '600 10px system-ui, sans-serif';
        if (xb - xa > 120) ctx.fillText(`Export ${formatTime(endMs - startMs)}`, xa + 8, 15);
      }
      ctx.fillStyle = C.rangeEdge;
      for (const ms of [startMs, endMs]) {
        const hx = xOf(ms);
        if (hx < LABEL_W - 4 || hx > width + 4) continue;
        ctx.fillRect(hx - 2, 0, 4, HEADER_H);
        ctx.fillRect(hx - 5, 4, 10, 14);
      }

      const x = xOf(playheadMs);
      if (x >= LABEL_W && x <= width) {
        ctx.fillStyle = C.playhead;
        ctx.fillRect(Math.round(x) - 1, 0, 2, height);
        ctx.beginPath();
        ctx.moveTo(x - 6, 0);
        ctx.lineTo(x + 6, 0);
        ctx.lineTo(x, 8);
        ctx.fill();
      }
    }

    function full() {
      clampView();
      drawStatic();
      drawFrame();
    }
    redraw.current = full;

    function resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = el.clientWidth;
      height = el.clientHeight;
      for (const c of [cv, staticLayer]) {
        c.width = Math.max(1, Math.round(width * dpr));
        c.height = Math.max(1, Math.round(height * dpr));
      }
      cv.style.width = `${width}px`;
      cv.style.height = `${height}px`;
      if (!fitted.current && width > LABEL_W) {
        fitted.current = true;
        view.current.pxPerSec = timelineW() / Math.max(1, durationMs / 1000);
      }
      full();
    }

    const observer = new ResizeObserver(resize);
    observer.observe(el);

    const unsubscribe = playback.subscribe((t) => {
      playheadMs = t;
      // Keep the playhead in view while playing.
      const v = view.current;
      const visibleMs = (timelineW() / v.pxPerSec) * 1000;
      if (playback.isPlaying && (t > v.startMs + visibleMs * 0.92 || t < v.startMs)) {
        v.startMs = t - visibleMs * 0.08;
        full();
      } else {
        drawFrame();
      }
    });

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const v = view.current;
      const rect = cv.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      if (e.ctrlKey || e.metaKey) {
        const anchor = msOf(Math.max(LABEL_W, mx));
        v.pxPerSec *= Math.exp(-e.deltaY * 0.0025);
        clampView();
        v.startMs = anchor - ((Math.max(LABEL_W, mx) - LABEL_W) / v.pxPerSec) * 1000;
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        v.startMs += ((e.shiftKey ? e.deltaY : e.deltaX) / v.pxPerSec) * 1000;
      } else {
        v.scrollY += e.deltaY;
      }
      full();
    }

    // Pointer: drag the export range's edges (ruler and waveform) or the
    // range itself (ruler); anywhere else seeks.
    type Drag = { kind: 'seek' } | { kind: 'start' | 'end' } | { kind: 'move'; grabMs: number; startMs: number; endMs: number };
    let drag: Drag | undefined;
    const MIN_RANGE_MS = 1000;
    function hit(e: PointerEvent): Drag['kind'] | undefined {
      const rect = cv.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (x < LABEL_W) return undefined;
      const { startMs, endMs } = rangeRef.current;
      if (y < HEADER_H) {
        if (Math.abs(x - xOf(startMs)) <= 7) return 'start';
        if (Math.abs(x - xOf(endMs)) <= 7) return 'end';
        if (y < RULER_H && x > xOf(startMs) && x < xOf(endMs)) return 'move';
      }
      return 'seek';
    }
    function pointerMs(e: PointerEvent) {
      return msOf(e.clientX - cv.getBoundingClientRect().left);
    }
    function apply(e: PointerEvent) {
      if (!drag) return;
      const t = Math.max(0, Math.min(durationMs, pointerMs(e)));
      const r = rangeRef.current;
      if (drag.kind === 'seek') playback.seek(t);
      else if (drag.kind === 'start') onRangeRef.current({ startMs: Math.min(t, r.endMs - MIN_RANGE_MS), endMs: r.endMs });
      else if (drag.kind === 'end') onRangeRef.current({ startMs: r.startMs, endMs: Math.max(t, r.startMs + MIN_RANGE_MS) });
      else if (drag.kind === 'move') {
        const length = drag.endMs - drag.startMs;
        const start = Math.max(0, Math.min(durationMs - length, drag.startMs + t - drag.grabMs));
        onRangeRef.current({ startMs: start, endMs: start + length });
      }
    }
    function onDown(e: PointerEvent) {
      const kind = hit(e);
      if (!kind) return;
      const r = rangeRef.current;
      drag = kind === 'move' ? { kind, grabMs: pointerMs(e), ...r } : { kind };
      cv.setPointerCapture(e.pointerId);
      if (kind !== 'move') apply(e);
    }
    function onMove(e: PointerEvent) {
      if (drag) return apply(e);
      const kind = hit(e);
      cv.style.cursor = kind === 'start' || kind === 'end' ? 'ew-resize' : kind === 'move' ? 'grab' : 'default';
    }
    const onUp = () => (drag = undefined);
    drawRangeRef.current = drawFrame;

    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    return () => {
      observer.disconnect();
      unsubscribe();
      cv.removeEventListener('wheel', onWheel);
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerup', onUp);
    };
  }, [show, sim, profile, peaks, playback, durationMs]);

  const zoom = (factor: number) => {
    const v = view.current;
    const centerMs = v.startMs + ((host.current!.clientWidth - LABEL_W) / v.pxPerSec) * 500;
    v.pxPerSec *= factor;
    v.startMs = centerMs - ((host.current!.clientWidth - LABEL_W) / v.pxPerSec) * 500;
    redraw.current();
  };
  const fit = () => {
    view.current.startMs = 0;
    view.current.pxPerSec = 0; // clamped up to "whole show fits"
    redraw.current();
  };

  return (
    <div className="composer">
      <div className="composer-bar">
        <span className="pane-title">Composer</span>
        <span className="legend">
          <i style={{ background: CLOSURE_COLORS.open }} />
          Open
          <i style={{ background: CLOSURE_COLORS.dance }} />
          Dance
          <i style={{ background: CLOSURE_COLORS.close }} />
          Close
          <i style={{ background: CLOSURE_COLORS.stop }} />
          Stop
          <span className="legend-note">white line = how open · * = not on every car · red handles = exported part</span>
        </span>
        <span className="spacer" />
        <button onClick={() => zoom(1 / 1.5)} title="Zoom out">−</button>
        <button onClick={() => zoom(1.5)} title="Zoom in">+</button>
        <button onClick={fit}>Fit</button>
      </div>
      <div ref={host} className="composer-canvas">
        <canvas ref={canvas} />
      </div>
    </div>
  );
}
