// The composer's toolbar: effect brushes (with Tesla xLights hotkeys), snap,
// undo/redo, mirror/delete for the selection, and zoom. When something is
// selected, an inspector shows and edits it.

import {
  DoorClosed,
  DoorOpen,
  FlipHorizontal2,
  Gauge,
  Lightbulb,
  Magnet,
  Maximize2,
  Redo2,
  Square,
  Trash2,
  TrendingDown,
  TrendingUp,
  Undo2,
  Waves,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { CHANNELS_BY_ID } from '../core/channels';
import {
  CLOSURE_KINDS,
  DEFAULT_MOVE_PCT,
  DEFAULT_STROBE_MS,
  EFFECT_HOTKEYS,
  EFFECT_LABELS,
  isClosureKind,
  LIGHT_KINDS,
  type ClosureEffectKind,
  type Effect,
  type EffectKind,
  type LightEffectKind,
} from '../core/project';
import type { Editor } from './useEditor';

const hotkeyFor = (kind: EffectKind) => Object.entries(EFFECT_HOTKEYS).find(([, k]) => k === kind)?.[0]?.toUpperCase();

const LIGHT_BRUSHES: { kind: LightEffectKind; icon: ReactNode; text?: string }[] = [
  { kind: 'on', icon: <Lightbulb size={15} /> },
  { kind: 'on500', icon: <TrendingUp size={15} />, text: '.5' },
  { kind: 'on1000', icon: <TrendingUp size={15} />, text: '1' },
  { kind: 'on2000', icon: <TrendingUp size={15} />, text: '2' },
  { kind: 'off500', icon: <TrendingDown size={15} />, text: '.5' },
  { kind: 'off1000', icon: <TrendingDown size={15} />, text: '1' },
  { kind: 'off2000', icon: <TrendingDown size={15} />, text: '2' },
  { kind: 'strobe', icon: <Zap size={15} /> },
];

const CLOSURE_BRUSHES: { kind: ClosureEffectKind; icon: ReactNode }[] = [
  { kind: 'open', icon: <DoorOpen size={15} /> },
  { kind: 'move', icon: <Gauge size={15} /> },
  { kind: 'dance', icon: <Waves size={15} /> },
  { kind: 'close', icon: <DoorClosed size={15} /> },
  { kind: 'stop', icon: <Square size={13} /> },
];

function IconButton({ title, onClick, disabled, active, children }: { title: string; onClick: () => void; disabled?: boolean; active?: boolean; children: ReactNode }) {
  return (
    <button className={`tool${active ? ' active' : ''}`} title={title} aria-label={title} aria-pressed={active} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

interface Props {
  editor: Editor;
  /** Shown first in the toolbar (the Auto-generate button). */
  lead?: ReactNode;
  onMirror: () => void;
  onDelete: () => void;
  onChangeSelected: (change: (e: Effect) => Effect) => void;
  zoom: (factor: number | 'fit') => void;
}

export function ComposerBar({ editor, lead, onMirror, onDelete, onChangeSelected, zoom }: Props) {
  const selected = editor.project?.effects.filter((e) => editor.selection.has(e.id)) ?? [];
  const single = selected.length === 1 ? selected[0] : undefined;

  return (
    <div className="composer-bar">
      <div className="composer-tools">
      {lead}
      <div className="tool-group" role="group" aria-label="Light effects">
        <span className="tool-group-label">Lights</span>
        {LIGHT_BRUSHES.map((b) => (
          <IconButton
            key={b.kind}
            title={`${EFFECT_LABELS[b.kind]}${hotkeyFor(b.kind) ? ` (${hotkeyFor(b.kind)})` : ''}`}
            active={editor.lightBrush === b.kind}
            onClick={() => editor.setLightBrush(b.kind)}
          >
            {b.icon}
            {b.text && <span className="tool-sub">{b.text}</span>}
          </IconButton>
        ))}
      </div>
      <div className="tool-group" role="group" aria-label="Door and closure effects">
        <span className="tool-group-label">Doors</span>
        {CLOSURE_BRUSHES.map((b) => (
          <IconButton
            key={b.kind}
            title={b.kind === 'move' ? 'Move to a position: click higher on the row to open further' : `${EFFECT_LABELS[b.kind]}${b.kind === 'stop' ? ' (F on a door row)' : hotkeyFor(b.kind) ? ` (${hotkeyFor(b.kind)})` : ''}`}
            active={editor.closureBrush === b.kind}
            onClick={() => editor.setClosureBrush(b.kind)}
          >
            {b.icon}
          </IconButton>
        ))}
      </div>
      <div className="tool-group" role="group" aria-label="Editing">
        <IconButton title="Snap to grid (hold Alt to bypass)" active={editor.snap} onClick={() => editor.setSnap(!editor.snap)}>
          <Magnet size={15} />
        </IconButton>
        <IconButton title="Undo (Ctrl/⌘ Z)" onClick={editor.undo} disabled={!editor.canUndo}>
          <Undo2 size={15} />
        </IconButton>
        <IconButton title="Redo (Ctrl/⌘ Shift Z)" onClick={editor.redo} disabled={!editor.canRedo}>
          <Redo2 size={15} />
        </IconButton>
        <IconButton title="Mirror to the other side (M)" onClick={onMirror} disabled={selected.length === 0}>
          <FlipHorizontal2 size={15} />
        </IconButton>
        <IconButton title="Delete (Del)" onClick={onDelete} disabled={selected.length === 0}>
          <Trash2 size={15} />
        </IconButton>
      </div>

      <div className="tool-group push-right" role="group" aria-label="Zoom">
        <IconButton title="Zoom out" onClick={() => zoom(1 / 1.5)}>
          <ZoomOut size={15} />
        </IconButton>
        <IconButton title="Zoom in (Ctrl/⌘ + scroll)" onClick={() => zoom(1.5)}>
          <ZoomIn size={15} />
        </IconButton>
        <IconButton title="Fit the whole show" onClick={() => zoom('fit')}>
          <Maximize2 size={15} />
        </IconButton>
      </div>
      </div>
      <div className="inspector">
        {single ? (
          <>
            <span className="inspector-channel">{CHANNELS_BY_ID.get(single.channel)?.name}</span>
            <select
              value={single.kind}
              onChange={(e) => onChangeSelected((fx) => ({ ...fx, kind: e.target.value as EffectKind }))}
              aria-label="Effect type"
            >
              {(isClosureKind(single.kind) ? CLOSURE_KINDS : LIGHT_KINDS).map((k) => (
                <option key={k} value={k}>
                  {EFFECT_LABELS[k]}
                </option>
              ))}
            </select>
            <TimeField label="Start" ms={single.startMs} onChange={(v) => onChangeSelected((fx) => ({ ...fx, startMs: v, endMs: v + (fx.endMs - fx.startMs) }))} />
            <TimeField label="Length" ms={single.endMs - single.startMs} onChange={(v) => onChangeSelected((fx) => ({ ...fx, endMs: fx.startMs + Math.max(20, v) }))} />
            {single.kind === 'move' && (
              <label className="inspector-pct">
                <span>Open</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={single.targetPct ?? DEFAULT_MOVE_PCT}
                  onChange={(e) => onChangeSelected((fx) => ({ ...fx, targetPct: Number(e.target.value) }))}
                  aria-label="How far open"
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={Math.round(single.targetPct ?? DEFAULT_MOVE_PCT)}
                  onChange={(e) => onChangeSelected((fx) => ({ ...fx, targetPct: Math.min(100, Math.max(0, Number(e.target.value) || 0)) }))}
                  aria-label="Percent open"
                />
                <span>%</span>
              </label>
            )}
            {single.kind === 'strobe' && (
              <TimeField
                label="Rate"
                ms={single.periodMs ?? DEFAULT_STROBE_MS}
                onChange={(v) => onChangeSelected((fx) => ({ ...fx, periodMs: Math.max(40, v) }))}
              />
            )}
          </>
        ) : selected.length > 1 ? (
          <span className="inspector-channel">{selected.length} effects selected</span>
        ) : (
          <span className="inspector-hint">
            Drag on a row to draw · double-click adds 1 s · drag edges to resize · <kbd>←</kbd> <kbd>→</kbd> step by beat · <kbd>?</kbd> all
            shortcuts
          </span>
        )}
      </div>

    </div>
  );
}

function TimeField({ label, ms, onChange }: { label: string; ms: number; onChange: (ms: number) => void }) {
  return (
    <label className="time-field">
      <span>{label}</span>
      <input
        type="number"
        step={0.05}
        min={0}
        value={(ms / 1000).toFixed(2)}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.round(v * 1000));
        }}
      />
      <span className="unit">s</span>
    </label>
  );
}
