// The composer: audio waveform on top, one row per light or closure below,
// and the effects on each row. Drawn on a canvas; the static layer is cached
// and only the playhead and export range redraw while playing.
//
// Editing: drag on an empty part of a row to draw an effect with the current
// brush, drag an effect to move it (all selected effects move together), drag
// its edges to resize, click to select (shift/cmd to add). Click empty space
// to seek. Alt disables snapping.

import { useEffect, useRef } from 'react';
import { CHANNELS_BY_ID } from '../core/channels';
import { decodeClosure, type ClosureCommand } from '../core/encoding';
import type { FseqFile } from '../core/fseq';
import { EFFECT_LABELS, effectFamily, newEffectId, placeEffects, type Effect } from '../core/project';
import type { Simulation } from '../core/simulate';
import { formatTime } from '../core/validate';
import type { ChannelGroup, VehicleProfile } from '../core/vehicles';
import type { Peaks } from './audio';
import type { Playback } from './playback';
import type { Editor } from './useEditor';

const LABEL_W = 176;
const RULER_H = 24;
const WAVE_H = 56;
const ROW_H = 20;
const GROUP_H = 26;
const HEADER_H = RULER_H + WAVE_H;
const EDGE_PX = 6;

const C = {
  bg: '#0f1114',
  rowAlt: '#131619',
  grid: '#20242a',
  gridMinor: '#181b20',
  label: '#d4d8de',
  labelDim: '#737b86',
  group: '#8b93a0',
  wave: '#5b8def',
  playhead: '#ff3b3b',
  white: '#ffe7b0',
  amber: '#ffa21a',
  red: '#ff4a4a',
  position: '#e8eaee',
  range: 'rgba(232, 33, 39, 0.24)',
  rangeEdge: '#ff6a5f',
  selection: '#6ea8ff',
};

export const CLOSURE_COLORS: Record<ClosureCommand, string | undefined> = {
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
  | { type: 'light'; label: string; ids: string[]; color: string; note?: string; editable: boolean }
  | { type: 'closure'; label: string; id: string; editable: true }
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
    const note = pc.maybe ? { note: pc.maybe } : {};
    // Light bars: many LEDs, one row showing the brightest.
    if (pc.row) {
      const existing = merged.get(pc.row.key);
      if (existing) existing.ids.push(pc.id);
      else {
        const row: Extract<Row, { type: 'light' }> = { type: 'light', label: pc.row.label, ids: [pc.id], color: C.white, editable: false, ...note };
        merged.set(pc.row.key, row);
        rows.push(row);
      }
      continue;
    }
    if (pc.kind === 'closure') rows.push({ type: 'closure', label: name, id: pc.id, editable: true });
    else if (pc.kind === 'rgb') {
      if (!pc.id.endsWith('Red')) continue;
      const base = pc.id.slice(0, -3);
      rows.push({ type: 'rgb', label: name.replace(' (Red)', ''), ids: [`${base}Red`, `${base}Green`, `${base}Blue`], ...note });
    } else {
      rows.push({ type: 'light', label: name, ids: [pc.id], color: lightColor(pc.id, pc.group), editable: effectFamily(pc.id) === 'light', ...note });
    }
  }
  return rows;
}

const rowHeight = (r: Row) => (r.type === 'group' ? GROUP_H : ROW_H);
const rowChannel = (r: Row): string | undefined =>
  r.type === 'closure' ? r.id : r.type === 'light' && r.editable ? r.ids[0] : undefined;

/** Shortens text with an ellipsis so it fits in maxWidth pixels. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(1, w), h, Math.min(r, w / 2));
}

export interface Range {
  startMs: number;
  endMs: number;
}

interface View {
  startMs: number;
  pxPerSec: number;
  scrollY: number;
}

interface Props {
  /** Changes when a different show is opened; the view re-fits to it. */
  docKey: string;
  show: FseqFile;
  sim: Simulation;
  profile: VehicleProfile;
  peaks: Peaks | undefined;
  playback: Playback;
  editor: Editor;
  /** The part of the song that gets exported. */
  range: Range;
  onRangeChange: (range: Range) => void;
  /** Lets the toolbar zoom buttons drive the view. */
  zoomRef?: React.MutableRefObject<((factor: number | 'fit') => void) | undefined>;
}

export function Composer(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // Latest props, read by the long-lived canvas handlers.
  const data = useRef(props);
  data.current = props;
  const redraw = useRef<{ full: () => void; frame: () => void; fit: () => void }>(undefined);

  useEffect(() => {
    const el = host.current!;
    const cv = canvas.current!;
    const ctx = cv.getContext('2d')!;
    const staticLayer = document.createElement('canvas');
    const sctx = staticLayer.getContext('2d')!;
    const view: View = { startMs: 0, pxPerSec: 40, scrollY: 0 };
    let width = 0;
    let height = 0;
    let dpr = 1;
    let playheadMs = data.current.playback.timeMs();
    let rowsFor: VehicleProfile | undefined;
    let rows: Row[] = [];
    let rowTops: number[] = [];
    let contentH = 0;

    // Pointer drag in progress (declared early: drawing reads createPreview).
    type Drag =
      | { kind: 'seek' }
      | { kind: 'range'; which: 'start' | 'end' | 'move'; grabMs: number; startMs: number; endMs: number }
      | { kind: 'create'; row: number; channel: string; anchorMs: number; moved: boolean }
      | {
          kind: 'edit';
          edge: 'start' | 'end' | 'body';
          grabMs: number;
          originals: Effect[];
          snapshot: readonly Effect[];
          moved: boolean;
          clicked: Effect;
          additive: boolean;
        };
    let drag: Drag | undefined;
    let createPreview: { row: number; a: number; b: number } | undefined;

    const d = () => data.current;
    const durationMs = () => d().show.frameCount * d().show.stepTimeMs;
    const timelineW = () => Math.max(1, width - LABEL_W);
    const xOf = (ms: number) => LABEL_W + ((ms - view.startMs) / 1000) * view.pxPerSec;
    const msOf = (x: number) => view.startMs + ((x - LABEL_W) / view.pxPerSec) * 1000;

    function layoutRows() {
      if (rowsFor === d().profile) return;
      rowsFor = d().profile;
      rows = buildRows(rowsFor);
      rowTops = [];
      let y = 0;
      for (const r of rows) {
        rowTops.push(y);
        y += rowHeight(r);
      }
      contentH = y;
    }

    function clampView() {
      const minPx = timelineW() / Math.max(1, durationMs() / 1000);
      view.pxPerSec = Math.min(1200, Math.max(minPx, view.pxPerSec));
      const visibleMs = (timelineW() / view.pxPerSec) * 1000;
      view.startMs = Math.max(0, Math.min(view.startMs, durationMs() - visibleMs));
      view.scrollY = Math.max(0, Math.min(view.scrollY, contentH - (height - HEADER_H)));
    }

    /** Grid step for snapping and minor lines: the smallest that's at least 8 px. */
    function gridMs() {
      const steps = [20, 50, 100, 250, 500, 1000, 2000, 5000];
      return steps.find((s) => (s / 1000) * view.pxPerSec >= 8) ?? 5000;
    }

    function effectsByChannel(): Map<string, Effect[]> {
      const map = new Map<string, Effect[]>();
      for (const e of d().editor.project?.effects ?? []) {
        const list = map.get(e.channel);
        if (list) list.push(e);
        else map.set(e.channel, [e]);
      }
      return map;
    }

    function drawStatic() {
      const { show, sim, peaks, editor } = d();
      layoutRows();
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sctx.fillStyle = C.bg;
      sctx.fillRect(0, 0, width, height);
      const t0 = view.startMs;
      const t1 = msOf(width);
      const msPerPx = 1000 / view.pxPerSec;
      const frameOf = (ms: number) => Math.max(0, Math.min(sim.frameCount, Math.floor(ms / sim.stepTimeMs)));
      const byChannel = effectsByChannel();

      // Minor grid
      const minor = gridMs();
      if ((minor / 1000) * view.pxPerSec >= 10) {
        sctx.fillStyle = C.gridMinor;
        for (let ms = Math.floor(t0 / minor) * minor; ms <= t1; ms += minor) {
          const x = xOf(ms);
          if (x >= LABEL_W) sctx.fillRect(Math.round(x), HEADER_H, 1, height - HEADER_H);
        }
      }

      sctx.save();
      sctx.beginPath();
      sctx.rect(0, HEADER_H, width, height - HEADER_H);
      sctx.clip();
      rows.forEach((row, i) => {
        const y = HEADER_H + rowTops[i]! - view.scrollY;
        const h = rowHeight(row);
        if (y + h < HEADER_H || y > height) return;
        if (row.type === 'group') {
          sctx.fillStyle = C.bg;
          sctx.fillRect(LABEL_W, y, width - LABEL_W, h);
          sctx.fillStyle = C.grid;
          sctx.fillRect(LABEL_W, y + h - 1, width - LABEL_W, 1);
          return;
        }
        if (i % 2) {
          sctx.fillStyle = C.rowAlt;
          sctx.fillRect(LABEL_W, y, width - LABEL_W, h);
        }

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
            const barH = Math.max(2, peak * (h - 6));
            sctx.fillStyle =
              row.type === 'rgb'
                ? `rgb(${Math.round(rgb[0]! * 255)},${Math.round(rgb[1]! * 255)},${Math.round(rgb[2]! * 255)})`
                : row.color;
            sctx.globalAlpha = 0.3 + 0.6 * peak;
            sctx.fillRect(x, y + h - 3 - barH, 1, barH);
          }
          sctx.globalAlpha = 1;
        } else {
          // Closure command blocks from the compiled show, plus how open it is.
          const def = CHANNELS_BY_ID.get(row.id)!;
          const fa = frameOf(t0);
          const fb = Math.min(sim.frameCount, frameOf(t1) + 1);
          const byteAt = (f: number) => (def.index < show.channelCount ? show.data[f * show.channelCount + def.index]! : 0);
          let runStart = fa;
          let runCmd = decodeClosure(byteAt(fa));
          const flush = (end: number) => {
            const color = CLOSURE_COLORS[runCmd];
            if (!color) return;
            const xa = xOf(runStart * sim.stepTimeMs);
            const xb = Math.max(xa + 2, xOf(end * sim.stepTimeMs));
            sctx.fillStyle = color;
            sctx.globalAlpha = 0.5;
            roundRect(sctx, xa, y + 3, xb - xa, h - 6, 3);
            sctx.fill();
            sctx.globalAlpha = 1;
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
          const track = sim.closures.get(row.id);
          if (track) {
            sctx.strokeStyle = C.position;
            sctx.globalAlpha = 0.75;
            sctx.lineWidth = 1;
            sctx.beginPath();
            for (let x = LABEL_W; x < width; x++) {
              const f = Math.min(sim.frameCount - 1, frameOf(msOf(x)));
              const py = y + h - 4 - track.position[f]! * (h - 8);
              if (x === LABEL_W) sctx.moveTo(x, py);
              else sctx.lineTo(x, py);
            }
            sctx.stroke();
            sctx.globalAlpha = 1;
          }
        }

        // Editable effects on this row: outlined blocks with labels.
        const channel = rowChannel(row);
        if (channel) {
          for (const e of byChannel.get(channel) ?? []) {
            if (e.endMs < t0 || e.startMs > t1) continue;
            const xa = xOf(e.startMs);
            const w = Math.max(2, xOf(e.endMs) - xa);
            const selected = editor.selection.has(e.id);
            roundRect(sctx, xa + 0.5, y + 2.5, w - 1, h - 5, 4);
            sctx.fillStyle = selected ? 'rgba(110, 168, 255, 0.22)' : 'rgba(255, 255, 255, 0.04)';
            sctx.fill();
            sctx.lineWidth = selected ? 1.5 : 1;
            sctx.strokeStyle = selected ? C.selection : 'rgba(255, 255, 255, 0.28)';
            sctx.stroke();
            if (w > 46) {
              sctx.fillStyle = selected ? '#fff' : 'rgba(255,255,255,0.78)';
              sctx.font = '500 10px Inter Variable, system-ui, sans-serif';
              sctx.fillText(fitText(sctx, EFFECT_LABELS[e.kind], w - 10), Math.max(xa, LABEL_W) + 5, y + h / 2 + 3.5);
            }
            if (selected && w > 14) {
              sctx.fillStyle = C.selection;
              sctx.fillRect(xa + 1, y + 6, 2, h - 12);
              sctx.fillRect(xa + w - 3, y + 6, 2, h - 12);
            }
          }
        }
      });

      // Labels column
      sctx.fillStyle = C.bg;
      sctx.fillRect(0, HEADER_H, LABEL_W, height - HEADER_H);
      rows.forEach((row, i) => {
        const y = HEADER_H + rowTops[i]! - view.scrollY;
        if (y + rowHeight(row) < HEADER_H || y > height) return;
        if (row.type === 'group') {
          sctx.fillStyle = C.group;
          sctx.font = '600 10.5px Inter Variable, system-ui, sans-serif';
          sctx.fillText(row.label.toUpperCase(), 14, y + 17);
          return;
        }
        const note = 'note' in row ? row.note : undefined;
        const editable = 'editable' in row && row.editable;
        sctx.font = '12px Inter Variable, system-ui, sans-serif';
        sctx.fillStyle = note ? C.labelDim : editable ? C.label : C.labelDim;
        sctx.fillText(fitText(sctx, row.label + (note ? ' *' : ''), LABEL_W - 28), 18, y + 14);
        if (!editable) {
          // Small lock: shown, not editable yet (light bars, RGB).
          sctx.fillStyle = '#4a515b';
          sctx.fillRect(LABEL_W - 18, y + 9, 7, 6);
          sctx.strokeStyle = '#4a515b';
          sctx.lineWidth = 1.2;
          sctx.beginPath();
          sctx.arc(LABEL_W - 14.5, y + 9, 2.4, Math.PI, 0);
          sctx.stroke();
        }
      });
      sctx.fillStyle = C.grid;
      sctx.fillRect(LABEL_W - 1, HEADER_H, 1, height - HEADER_H);
      sctx.restore();

      // Ruler
      sctx.fillStyle = '#0b0d10';
      sctx.fillRect(0, 0, width, HEADER_H);
      const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
      const step = steps.find((s) => s * view.pxPerSec >= 80) ?? 120;
      sctx.font = '10px Inter Variable, system-ui, sans-serif';
      for (let s = Math.floor(t0 / 1000 / step) * step; s * 1000 <= t1; s += step) {
        const x = xOf(s * 1000);
        if (x < LABEL_W) continue;
        sctx.fillStyle = C.grid;
        sctx.fillRect(Math.round(x), 0, 1, height);
        sctx.fillStyle = C.labelDim;
        sctx.fillText(formatTime(s * 1000).replace(/\.0$/, ''), x + 4, 15);
      }

      // Waveform
      const midY = RULER_H + WAVE_H / 2;
      sctx.fillStyle = '#0d1014';
      sctx.fillRect(LABEL_W, RULER_H, width - LABEL_W, WAVE_H);
      if (peaks) {
        const grad = sctx.createLinearGradient(0, RULER_H, 0, RULER_H + WAVE_H);
        grad.addColorStop(0, '#7aa2ff');
        grad.addColorStop(0.5, '#4f7de6');
        grad.addColorStop(1, '#7aa2ff');
        sctx.fillStyle = grad;
        for (let x = LABEL_W; x < width; x++) {
          const a = Math.floor(msOf(x) / peaks.bucketMs);
          const b = Math.max(a + 1, Math.floor((msOf(x) + msPerPx) / peaks.bucketMs));
          let lo = 0;
          let hi = 0;
          for (let i = Math.max(0, a); i < b && i < peaks.min.length; i++) {
            if (peaks.min[i]! < lo) lo = peaks.min[i]!;
            if (peaks.max[i]! > hi) hi = peaks.max[i]!;
          }
          const top = midY - hi * (WAVE_H / 2 - 4);
          const bottom = midY - lo * (WAVE_H / 2 - 4);
          sctx.fillRect(x, top, 1, Math.max(1, bottom - top));
        }
      }
      sctx.fillStyle = '#0b0d10';
      sctx.fillRect(0, 0, LABEL_W, HEADER_H);
      sctx.fillStyle = C.labelDim;
      sctx.font = '600 10.5px Inter Variable, system-ui, sans-serif';
      sctx.fillText(peaks ? 'MUSIC' : 'MUSIC (NONE)', 14, RULER_H + WAVE_H / 2 + 4);
      sctx.fillStyle = C.grid;
      sctx.fillRect(0, HEADER_H - 1, width, 1);
    }

    function drawFrame() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(staticLayer, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Export range: dim what's outside it, mark it on the ruler with handles.
      const { startMs, endMs } = d().range;
      const xa = Math.max(LABEL_W, xOf(startMs));
      const xb = Math.min(width, xOf(endMs));
      ctx.fillStyle = 'rgba(5, 6, 8, 0.55)';
      if (xa > LABEL_W) ctx.fillRect(LABEL_W, RULER_H, xa - LABEL_W, height - RULER_H);
      if (xb < width) ctx.fillRect(xb, RULER_H, width - xb, height - RULER_H);
      if (xb > xa) {
        ctx.fillStyle = C.range;
        ctx.fillRect(xa, 0, xb - xa, RULER_H);
        ctx.fillStyle = '#fff';
        ctx.font = '600 10px Inter Variable, system-ui, sans-serif';
        if (xb - xa > 130) ctx.fillText(`EXPORT  ${formatTime(endMs - startMs)}`, xa + 9, 16);
      }
      ctx.fillStyle = C.rangeEdge;
      for (const ms of [startMs, endMs]) {
        const hx = xOf(ms);
        if (hx < LABEL_W - 4 || hx > width + 4) continue;
        ctx.fillRect(hx - 1.5, 0, 3, HEADER_H);
        roundRect(ctx, hx - 5, 4, 10, 15, 3);
        ctx.fill();
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
      if (createPreview) {
        const y = HEADER_H + rowTops[createPreview.row]! - view.scrollY;
        ctx.strokeStyle = C.selection;
        ctx.setLineDash([4, 3]);
        roundRect(ctx, xOf(createPreview.a) + 0.5, y + 2.5, xOf(createPreview.b) - xOf(createPreview.a), ROW_H - 5, 4);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    function full() {
      layoutRows();
      clampView();
      drawStatic();
      drawFrame();
    }

    function fit() {
      view.startMs = 0;
      view.pxPerSec = 0; // clamped up to "whole show fits"
      view.scrollY = 0;
      full();
    }

    function zoom(factor: number | 'fit') {
      if (factor === 'fit') return fit();
      const centerMs = view.startMs + (timelineW() / view.pxPerSec) * 500;
      view.pxPerSec *= factor;
      clampView();
      view.startMs = centerMs - (timelineW() / view.pxPerSec) * 500;
      full();
    }
    redraw.current = { full, frame: drawFrame, fit };
    if (d().zoomRef) d().zoomRef!.current = zoom;

    let fitted = false;
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
      if (!fitted && width > LABEL_W) {
        fitted = true;
        view.pxPerSec = 0;
      }
      full();
    }
    const observer = new ResizeObserver(resize);
    observer.observe(el);

    const unsubscribe = d().playback.subscribe((t) => {
      playheadMs = t;
      const visibleMs = (timelineW() / view.pxPerSec) * 1000;
      if (d().playback.isPlaying && (t > view.startMs + visibleMs * 0.92 || t < view.startMs)) {
        view.startMs = t - visibleMs * 0.08;
        full();
      } else drawFrame();
    });

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const mx = e.clientX - cv.getBoundingClientRect().left;
      if (e.ctrlKey || e.metaKey) {
        const anchorX = Math.max(LABEL_W, mx);
        const anchor = msOf(anchorX);
        view.pxPerSec *= Math.exp(-e.deltaY * 0.0025);
        clampView();
        view.startMs = anchor - ((anchorX - LABEL_W) / view.pxPerSec) * 1000;
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        view.startMs += ((e.shiftKey ? e.deltaY : e.deltaX) / view.pxPerSec) * 1000;
      } else {
        view.scrollY += e.deltaY;
      }
      full();
    }

    // --- Pointer interactions -------------------------------------------------

    type Hit =
      | { zone: 'none' }
      | { zone: 'rangeStart' | 'rangeEnd' | 'rangeMove' | 'seek' }
      | { zone: 'effect'; effect: Effect; edge: 'start' | 'end' | 'body'; row: number }
      | { zone: 'empty'; row: number; channel: string };

    function rowAt(y: number): number {
      const cy = y - HEADER_H + view.scrollY;
      for (let i = rows.length - 1; i >= 0; i--) if (cy >= rowTops[i]!) return i;
      return -1;
    }

    function hit(x: number, y: number): Hit {
      if (x < LABEL_W) return { zone: 'none' };
      if (y < HEADER_H) {
        const { startMs, endMs } = d().range;
        if (Math.abs(x - xOf(startMs)) <= 7) return { zone: 'rangeStart' };
        if (Math.abs(x - xOf(endMs)) <= 7) return { zone: 'rangeEnd' };
        if (y < RULER_H && x > xOf(startMs) && x < xOf(endMs)) return { zone: 'rangeMove' };
        return { zone: 'seek' };
      }
      const r = rowAt(y);
      const row = rows[r];
      const channel = row && rowChannel(row);
      if (!row || !channel || !d().editor.project) return { zone: 'seek' };
      const effects = d().editor.project!.effects;
      for (let i = effects.length - 1; i >= 0; i--) {
        const e = effects[i]!;
        if (e.channel !== channel) continue;
        const xa = xOf(e.startMs);
        const xb = xOf(e.endMs);
        if (x < xa - 3 || x > xb + 3) continue;
        const edgeZone = xb - xa > EDGE_PX * 3 ? EDGE_PX : 3;
        const edge = x - xa < edgeZone ? 'start' : xb - x < edgeZone ? 'end' : 'body';
        return { zone: 'effect', effect: e, edge, row: r };
      }
      return { zone: 'empty', row: r, channel };
    }

    function snapMs(ms: number, alt: boolean) {
      const step = alt || !d().editor.snap ? d().show.stepTimeMs : gridMs();
      return Math.max(0, Math.min(durationMs(), Math.round(ms / step) * step));
    }

    const MIN_RANGE_MS = 1000;

    const pointer = (e: PointerEvent | MouseEvent) => {
      const rect = cv.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    function onDown(e: PointerEvent) {
      const { x, y } = pointer(e);
      const h = hit(x, y);
      const t = msOf(x);
      const editor = d().editor;
      if (h.zone === 'none') return;
      cv.setPointerCapture(e.pointerId);
      if (h.zone === 'rangeStart' || h.zone === 'rangeEnd' || h.zone === 'rangeMove') {
        drag = { kind: 'range', which: h.zone === 'rangeStart' ? 'start' : h.zone === 'rangeEnd' ? 'end' : 'move', grabMs: t, ...d().range };
      } else if (h.zone === 'seek') {
        drag = { kind: 'seek' };
        d().playback.seek(t);
      } else if (h.zone === 'empty') {
        drag = { kind: 'create', row: h.row, channel: h.channel, anchorMs: snapMs(t, e.altKey), moved: false };
      } else if (h.zone === 'effect') {
        const additive = e.shiftKey || e.metaKey || e.ctrlKey;
        const selected = editor.selection.has(h.effect.id);
        const ids = selected ? editor.selection : new Set([h.effect.id]);
        if (!selected && !additive) editor.select([h.effect.id]);
        const project = editor.project!;
        drag = {
          kind: 'edit',
          edge: h.edge,
          grabMs: t,
          originals: project.effects.filter((fx) => (h.edge === 'body' ? ids.has(fx.id) : fx.id === h.effect.id)),
          snapshot: project.effects,
          moved: false,
          clicked: h.effect,
          additive,
        };
      }
    }

    function onMove(e: PointerEvent) {
      const { x, y } = pointer(e);
      if (!drag) {
        const h = hit(x, y);
        cv.style.cursor =
          h.zone === 'rangeStart' || h.zone === 'rangeEnd' || (h.zone === 'effect' && h.edge !== 'body')
            ? 'ew-resize'
            : h.zone === 'rangeMove' || (h.zone === 'effect' && h.edge === 'body')
              ? 'grab'
              : h.zone === 'empty'
                ? 'crosshair'
                : 'default';
        return;
      }
      const t = Math.max(0, Math.min(durationMs(), msOf(x)));
      if (drag.kind === 'seek') d().playback.seek(t);
      else if (drag.kind === 'range') {
        const r = d().range;
        if (drag.which === 'start') d().onRangeChange({ startMs: Math.min(t, r.endMs - MIN_RANGE_MS), endMs: r.endMs });
        else if (drag.which === 'end') d().onRangeChange({ startMs: r.startMs, endMs: Math.max(t, r.startMs + MIN_RANGE_MS) });
        else {
          const length = drag.endMs - drag.startMs;
          const start = Math.max(0, Math.min(durationMs() - length, drag.startMs + t - drag.grabMs));
          d().onRangeChange({ startMs: start, endMs: start + length });
        }
      } else if (drag.kind === 'create') {
        const b = snapMs(t, e.altKey);
        if (Math.abs(xOf(b) - xOf(drag.anchorMs)) > 3) drag.moved = true;
        createPreview = { row: drag.row, a: Math.min(drag.anchorMs, b), b: Math.max(drag.anchorMs, b) };
        drawFrame();
      } else {
        const delta = t - drag.grabMs;
        if (!drag.moved && Math.abs(delta / 1000) * view.pxPerSec < 3) return;
        const editor = d().editor;
        if (!drag.moved) {
          drag.moved = true;
          editor.beginChange();
        }
        const step = d().show.stepTimeMs;
        const edge = drag.edge;
        const updated = drag.originals.map((o) => {
          if (edge === 'body') {
            const len = o.endMs - o.startMs;
            const start = Math.max(0, Math.min(durationMs() - len, snapMs(o.startMs + delta, e.altKey)));
            return { ...o, startMs: start, endMs: start + len };
          }
          if (edge === 'start') return { ...o, startMs: Math.min(snapMs(o.startMs + delta, e.altKey), o.endMs - step) };
          return { ...o, endMs: Math.max(snapMs(o.endMs + delta, e.altKey), o.startMs + step) };
        });
        editor.setEffects(placeEffects(drag.snapshot, updated), false);
      }
    }

    function onUp(e: PointerEvent) {
      const current = drag;
      drag = undefined;
      createPreview = undefined;
      if (!current) return;
      const editor = d().editor;
      if (current.kind === 'create') {
        const { x } = pointer(e);
        if (!current.moved) {
          // A click on empty space: seek there and clear the selection.
          editor.select([]);
          d().playback.seek(msOf(x));
          drawFrame();
          return;
        }
        const b = snapMs(msOf(x), e.altKey);
        const startMs = Math.min(current.anchorMs, b);
        const endMs = Math.max(current.anchorMs, b, startMs + d().show.stepTimeMs);
        const kind = effectFamily(current.channel) === 'closure' ? editor.closureBrush : editor.lightBrush;
        editor.place([{ id: newEffectId(), channel: current.channel, startMs, endMs, kind }]);
      } else if (current.kind === 'edit' && !current.moved) {
        // A click on an effect: select it (or toggle it with shift/cmd).
        if (current.additive) {
          const next = new Set(editor.selection);
          if (next.has(current.clicked.id)) next.delete(current.clicked.id);
          else next.add(current.clicked.id);
          editor.select(next);
        } else editor.select([current.clicked.id]);
      } else if (current.kind === 'edit') {
        editor.select(current.originals.map((o) => o.id));
      }
      drawFrame();
    }

    function onDouble(e: MouseEvent) {
      const { x, y } = pointer(e);
      const h = hit(x, y);
      if (h.zone !== 'empty') return;
      // Double-click: a one-second effect where you clicked.
      const editor = d().editor;
      const startMs = snapMs(msOf(x), e.altKey);
      const kind = effectFamily(h.channel) === 'closure' ? editor.closureBrush : editor.lightBrush;
      editor.place([{ id: newEffectId(), channel: h.channel, startMs, endMs: Math.min(durationMs(), startMs + 1000), kind }]);
    }

    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('dblclick', onDouble);
    return () => {
      observer.disconnect();
      unsubscribe();
      cv.removeEventListener('wheel', onWheel);
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerup', onUp);
      cv.removeEventListener('dblclick', onDouble);
    };
  }, []);

  // Redraw when the data changes; re-fit when a different show opens.
  const { show, sim, profile, peaks, editor, range, docKey } = props;
  useEffect(() => redraw.current?.full(), [show, sim, profile, peaks, editor.selection, editor.snap]);
  useEffect(() => redraw.current?.frame(), [range]);
  useEffect(() => redraw.current?.fit(), [docKey]);

  return (
    <div ref={host} className="composer-canvas">
      <canvas ref={canvas} />
    </div>
  );
}
