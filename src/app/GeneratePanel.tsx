// One-click shows: the Auto-generate button in the composer toolbar and its
// panel (style, intensity, closures, variations).

import { LoaderCircle, Plus, RefreshCw, Shuffle, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Analysis, SectionKind } from '../core/analysis';
import { CHANNELS_BY_ID } from '../core/channels';
import { DEFAULT_OPTIONS, musicMap, STYLES, type GenerateOptions, type StyleId } from '../core/generate';
import { formatTime } from '../core/validate';
import type { VehicleProfile } from '../core/vehicles';

export type AnalysisState = { status: 'none' } | { status: 'pending' } | { status: 'ready'; analysis: Analysis } | { status: 'failed'; error: string };

const SECTION_LABELS: Record<SectionKind, string> = {
  intro: 'Intro',
  verse: 'Verse',
  build: 'Build',
  chorus: 'Chorus',
  drop: 'Drop',
  break: 'Break',
  outro: 'Outro',
};

/** What a car's closures are called, for the switch's hint. */
function closureSummary(profile: VehicleProfile): string {
  const names: string[] = [];
  const has = (re: RegExp) => profile.channels.some((c) => c.kind === 'closure' && re.test(c.id));
  if (has(/FalconDoor/)) names.push('falcon wings');
  if (has(/FrontDoor$/)) names.push('front doors');
  if (has(/Window/)) names.push('windows');
  if (has(/Mirror/)) names.push('mirrors');
  if (has(/Handle/)) names.push('door handles');
  const lift = profile.channels.find((c) => c.id === 'liftgate');
  if (lift) names.push((lift.label ?? CHANNELS_BY_ID.get('liftgate')!.name).toLowerCase());
  if (has(/chargePort/)) names.push('charge port');
  return names.length ? names.join(', ').replace(/^./, (c) => c.toUpperCase()) : 'This car has no moving parts in shows';
}

function loadOptions(): GenerateOptions {
  try {
    const v = JSON.parse(localStorage.getItem('generate') ?? '{}') as Partial<GenerateOptions>;
    return {
      ...DEFAULT_OPTIONS,
      ...(v.style && v.style in STYLES ? { style: v.style } : {}),
      ...(typeof v.intensity === 'number' ? { intensity: Math.min(1, Math.max(0, v.intensity)) } : {}),
      ...(typeof v.closures === 'boolean' ? { closures: v.closures } : {}),
    };
  } catch {
    return DEFAULT_OPTIONS;
  }
}

interface Props {
  state: AnalysisState;
  profile: VehicleProfile;
  rangeLabel: string;
  /** The show already has effects in the range, which generating replaces. */
  hasEffects: boolean;
  onGenerate: (options: GenerateOptions) => void;
  /** Opened from outside (the empty-show prompt). */
  openSignal?: number;
  /** Where the drops land, and whether the user has placed them (rather than the song analysis). */
  drops: readonly number[];
  dropsPlaced: boolean;
  /** Undefined goes back to the drops found in the song. */
  onDropsChange: (drops: number[] | undefined) => void;
  playheadMs: () => number;
  onSeek: (timeMs: number) => void;
}

export function GenerateButton({ state, profile, rangeLabel, hasEffects, onGenerate, openSignal, drops, dropsPlaced, onDropsChange, playheadMs, onSeek }: Props) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<GenerateOptions>(loadOptions);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openSignal) setOpen(true);
  }, [openSignal]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const update = (change: Partial<GenerateOptions>) => {
    const next = { ...options, ...change };
    setOptions(next);
    try {
      const { style, intensity, closures } = next;
      localStorage.setItem('generate', JSON.stringify({ style, intensity, closures }));
    } catch {
      // Not remembered in private browsing.
    }
    return next;
  };

  const ready = state.status === 'ready';
  const [generated, setGenerated] = useState(false);
  // The drops the last generated show was built on: moving one offers a regenerate.
  const dropsKey = drops.join(',');
  const [builtOn, setBuiltOn] = useState<string>();
  const generate = (o: GenerateOptions) => {
    if (!ready) return;
    onGenerate(o);
    setGenerated(true);
    setBuiltOn(dropsKey);
    setOpen(false);
  };
  const hasClosures = profile.channels.some((c) => c.kind === 'closure');

  return (
    <div className="generate" ref={ref}>
      <button className={`generate-trigger${open ? ' open' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
        {state.status === 'pending' ? <LoaderCircle size={15} className="song-spin" /> : <Sparkles size={15} />}
        Auto-generate
      </button>
      {generated && !open && builtOn !== dropsKey && (
        <button className="generate-redo" disabled={!ready} onClick={() => generate(options)} title="Build the show again around the drops as they are now">
          <RefreshCw size={14} /> Regenerate
        </button>
      )}
      {generated && !open && (
        <button className="generate-again" disabled={!ready} onClick={() => generate(update({ seed: options.seed + 1 }))} title="Generate a different variation">
          <Shuffle size={15} />
        </button>
      )}
      {open && (
        <div className="generate-panel" role="dialog" aria-label="Auto-generate a show">
          <div className="generate-head">
            <span>Auto-generate</span>
            <button className="icon" onClick={() => setOpen(false)} aria-label="Close">
              <X size={15} />
            </button>
          </div>

          <SongSummary state={state} />

          {ready && (
            <>
              <div className="generate-label">
                {drops.length === 1 ? 'The drop' : 'Drops'}
                {dropsPlaced && (
                  <button className="generate-link" onClick={() => onDropsChange(undefined)}>
                    Use the song's
                  </button>
                )}
              </div>
              <div className="generate-drops">
                {drops.map((t, i) => (
                  <span key={t} className="generate-drop">
                    <button onClick={() => onSeek(t)} title="Jump there">
                      {formatTime(t)}
                    </button>
                    <button onClick={() => onDropsChange(drops.filter((_, j) => j !== i))} aria-label={`Remove the drop at ${formatTime(t)}`} title="Remove">
                      <X size={12} />
                    </button>
                  </span>
                ))}
                {drops.length === 0 && <span className="muted">None: the show stays even throughout.</span>}
                <button
                  className="generate-drop-add"
                  onClick={() => onDropsChange([...new Set([...drops, Math.round(playheadMs())])].sort((a, b) => a - b))}
                  title="Put a drop where the playhead is"
                >
                  <Plus size={13} /> At the playhead
                </button>
              </div>
              <p className="generate-hint">
                Where every light hits at once, with a build before and the big moves after. Drag the red markers on the music to move them; double-click the music to
                add one.
              </p>
            </>
          )}

          <div className="generate-label">Style</div>
          <div className="generate-styles" role="radiogroup" aria-label="Style">
            {(Object.keys(STYLES) as StyleId[]).map((id) => (
              <button key={id} role="radio" aria-checked={options.style === id} className={options.style === id ? 'on' : ''} onClick={() => update({ style: id })}>
                <span className="generate-style-name">{STYLES[id].label}</span>
                <span className="generate-style-hint">{STYLES[id].hint}</span>
              </button>
            ))}
          </div>

          <label className="generate-label" htmlFor="generate-intensity">
            Intensity <span className="generate-value">{Math.round(options.intensity * 100)}%</span>
          </label>
          <input
            id="generate-intensity"
            className="generate-slider"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={options.intensity}
            onChange={(e) => update({ intensity: Number(e.target.value) })}
          />
          <div className="generate-scale">
            <span>Calm</span>
            <span>Busy</span>
          </div>

          <details className="generate-map">
            <summary>What follows what</summary>
            <dl>
              {musicMap(profile).map((row) => (
                <div key={row.sound}>
                  <dt>{row.sound}</dt>
                  <dd>{row.lights}</dd>
                </div>
              ))}
            </dl>
          </details>

          <label className={`paint-toggle generate-closures${hasClosures ? '' : ' disabled'}`}>
            <span>
              <span className="paint-toggle-title">Move doors and closures</span>
              <span className="paint-toggle-hint">{closureSummary(profile)}</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              disabled={!hasClosures}
              checked={hasClosures && options.closures}
              onChange={(e) => update({ closures: e.target.checked })}
            />
          </label>

          <div className="generate-actions">
            <button className="primary" disabled={!ready} onClick={() => generate(options)}>
              <Sparkles size={15} /> Generate show
            </button>
            <button disabled={!ready} onClick={() => generate(update({ seed: options.seed + 1 }))} title="Generate a different variation">
              <Shuffle size={15} /> Variation
            </button>
          </div>
          <p className="generate-foot">
            For {profile.name}, {rangeLabel}.{' '}
            {hasEffects ? 'Replaces the effects there; Ctrl/⌘ Z undoes it.' : 'You can edit everything afterwards.'}
          </p>
        </div>
      )}
    </div>
  );
}

function SongSummary({ state }: { state: AnalysisState }) {
  if (state.status === 'pending') {
    return (
      <div className="generate-song muted">
        <LoaderCircle size={14} className="song-spin" /> Listening to the song: beats, hits, melody and sections…
      </div>
    );
  }
  if (state.status === 'failed') return <div className="generate-song error-text">Couldn't analyze the song: {state.error}</div>;
  if (state.status === 'none') return <div className="generate-song muted">This show has no song to follow. Open or drop one first.</div>;
  const a = state.analysis;
  const total = a.durationMs || 1;
  return (
    <div className="generate-song">
      <div className="generate-stats">
        <span>
          <strong>{a.bpm ? Math.round(a.bpm) : '–'}</strong> BPM
        </span>
        <span>
          <strong>{a.downbeats.length}</strong> bars
        </span>
        <span>
          <strong>{a.notes.length}</strong> {a.notes.length === 1 ? 'note' : 'notes'}
        </span>
        <span>
          <strong>{a.sections.length}</strong> {a.sections.length === 1 ? 'section' : 'sections'}
        </span>
      </div>
      <div className="generate-sections" aria-label="Sections">
        {a.sections.map((s) => (
          <span
            key={s.startMs}
            className={`generate-section ${s.kind}`}
            style={{ flexGrow: (s.endMs - s.startMs) / total }}
            title={`${SECTION_LABELS[s.kind]} · ${formatTime(s.startMs)}–${formatTime(s.endMs)}`}
          >
            {(s.endMs - s.startMs) / total > 0.14 ? SECTION_LABELS[s.kind] : ''}
          </span>
        ))}
      </div>
    </div>
  );
}
