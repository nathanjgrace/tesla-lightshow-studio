// Editor state: the project being edited, undo/redo history, the selection,
// and the effect "brushes" new effects are drawn with.

import { useCallback, useMemo, useRef, useState } from 'react';
import { placeEffects, removeEffects, type ClosureEffectKind, type Effect, type LightEffectKind, type Project } from '../core/project';

const HISTORY_LIMIT = 200;

export interface Editor {
  project: Project | undefined;
  selection: ReadonlySet<string>;
  lightBrush: LightEffectKind;
  closureBrush: ClosureEffectKind;
  snap: boolean;
  canUndo: boolean;
  canRedo: boolean;
  load(project: Project): void;
  /** Replaces the effects; `record` adds an undo step (false while dragging). */
  setEffects(effects: readonly Effect[], record: boolean): void;
  /** Starts an undoable change that will be applied in pieces (e.g. a drag). */
  beginChange(): void;
  place(effects: readonly Effect[], select?: boolean): void;
  remove(ids: ReadonlySet<string>): void;
  select(ids: Iterable<string>): void;
  undo(): void;
  redo(): void;
  setLightBrush(kind: LightEffectKind): void;
  setClosureBrush(kind: ClosureEffectKind): void;
  setSnap(snap: boolean): void;
}

export function useEditor(): Editor {
  const [project, setProject] = useState<Project>();
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [lightBrush, setLightBrush] = useState<LightEffectKind>('on');
  const [closureBrush, setClosureBrush] = useState<ClosureEffectKind>('open');
  const [snap, setSnap] = useState(true);
  const past = useRef<(readonly Effect[])[]>([]);
  const future = useRef<(readonly Effect[])[]>([]);
  const [, bump] = useState(0);
  const projectRef = useRef(project);
  projectRef.current = project;

  const pushHistory = useCallback(() => {
    const current = projectRef.current;
    if (!current) return;
    past.current.push(current.effects);
    if (past.current.length > HISTORY_LIMIT) past.current.shift();
    future.current = [];
  }, []);

  const setEffects = useCallback(
    (effects: readonly Effect[], record: boolean) => {
      if (!projectRef.current) return;
      if (record) pushHistory();
      setProject((p) => (p ? { ...p, effects } : p));
      bump((n) => n + 1);
    },
    [pushHistory],
  );

  return useMemo<Editor>(
    () => ({
      project,
      selection,
      lightBrush,
      closureBrush,
      snap,
      canUndo: past.current.length > 0,
      canRedo: future.current.length > 0,
      load(p) {
        past.current = [];
        future.current = [];
        setSelection(new Set());
        setProject(p);
      },
      setEffects,
      beginChange: pushHistory,
      place(effects, select = true) {
        const p = projectRef.current;
        if (!p) return;
        setEffects(placeEffects(p.effects, effects), true);
        if (select) setSelection(new Set(effects.map((e) => e.id)));
      },
      remove(ids) {
        const p = projectRef.current;
        if (!p || ids.size === 0) return;
        setEffects(removeEffects(p.effects, ids), true);
        setSelection(new Set());
      },
      select(ids) {
        setSelection(new Set(ids));
      },
      undo() {
        const p = projectRef.current;
        const prev = past.current.pop();
        if (!p || !prev) return;
        future.current.push(p.effects);
        setProject({ ...p, effects: prev });
        setSelection(new Set());
      },
      redo() {
        const p = projectRef.current;
        const next = future.current.pop();
        if (!p || !next) return;
        past.current.push(p.effects);
        setProject({ ...p, effects: next });
        setSelection(new Set());
      },
      setLightBrush,
      setClosureBrush,
      setSnap,
    }),
    [project, selection, lightBrush, closureBrush, snap, setEffects, pushHistory],
  );
}
