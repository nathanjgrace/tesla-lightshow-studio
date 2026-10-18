import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { readFseq, type FseqFile } from '../core/fseq';
import { simulate, type Simulation } from '../core/simulate';
import { formatTime, validate, type Issue } from '../core/validate';
import { MODEL_X } from '../core/vehicles';
import { DEFAULT_SHOW_ID, LIBRARY, type LibraryShow } from '../library/catalog';
import { audioType, fromZip, loadLibraryShow, type LoadedFiles } from '../library/load';
import { computePeaks, type Peaks } from './audio';
import { CarView } from './CarView';
import { Composer } from './Composer';
import { Playback } from './playback';

type Layout = 'side' | 'stack';

interface Loaded {
  title: string;
  show: FseqFile;
  sim: Simulation;
  issues: Issue[];
  audio: Blob | undefined;
}

const profile = MODEL_X;

function stored<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode); layout just won't persist.
  }
}

function initialSelection(): { showId: string; car: number } {
  const params = new URLSearchParams(location.search);
  const show = LIBRARY.find((s) => s.id === params.get('show')) ?? LIBRARY.find((s) => s.id === DEFAULT_SHOW_ID)!;
  const car = Math.min(show.cars, Math.max(1, Number(params.get('car')) || 1));
  return { showId: show.id, car };
}

export function App() {
  const playback = useMemo(() => new Playback(), []);
  // Lets automated browser checks drive playback during development.
  if (import.meta.env.DEV) (window as unknown as { __playback: Playback }).__playback = playback;
  const playing = useSyncExternalStore(
    (cb) => playback.subscribeState(cb),
    () => playback.isPlaying,
  );

  const [layout, setLayout] = useState<Layout>(() =>
    stored('layout', window.innerWidth < 800 ? 'stack' : 'side', ['side', 'stack']),
  );
  const [split, setSplit] = useState(() => {
    try {
      const v = Number(localStorage.getItem('split'));
      return v > 0.15 && v < 0.85 ? v : 0.5;
    } catch {
      return 0.5;
    }
  });
  const [selection, setSelection] = useState(initialSelection);
  const [fileName, setFileName] = useState<string>();
  const [loaded, setLoaded] = useState<Loaded>();
  const [peaks, setPeaks] = useState<Peaks>();
  const [loading, setLoading] = useState<{ label: string; progress?: number }>();
  const [error, setError] = useState<string>();
  const [checksOpen, setChecksOpen] = useState(false);
  const loadToken = useRef(0);

  const libraryShow: LibraryShow | undefined = fileName ? undefined : LIBRARY.find((s) => s.id === selection.showId);

  const present = useCallback(
    async (title: string, files: LoadedFiles, token: number) => {
      const show = readFseq(files.fseq);
      const sim = simulate(show, profile);
      if (token !== loadToken.current) return;
      setLoaded({ title, show, sim, issues: validate(show), audio: files.audio });
      setPeaks(undefined);
      playback.setSource(files.audio, show.frameCount * show.stepTimeMs);
      setLoading(undefined);
      if (files.audio) {
        computePeaks(files.audio)
          .then((p) => token === loadToken.current && setPeaks(p))
          .catch(() => {});
      }
    },
    [playback],
  );

  // Load the selected library show.
  useEffect(() => {
    if (!libraryShow) return;
    const token = ++loadToken.current;
    const { car } = selection;
    setError(undefined);
    playback.pause();
    setLoading({ label: `Downloading “${libraryShow.title}” from Tesla's repo…`, progress: 0 });
    const url = new URL(location.href);
    url.searchParams.set('show', libraryShow.id);
    if (libraryShow.cars > 1) url.searchParams.set('car', String(car));
    else url.searchParams.delete('car');
    history.replaceState(null, '', url);
    loadLibraryShow(libraryShow, car, (p) => token === loadToken.current && setLoading((l) => l && { ...l, progress: p }))
      .then((files) => present(libraryShow.title + (libraryShow.cars > 1 ? ` · Car ${car}` : ''), files, token))
      .catch((e: unknown) => {
        if (token !== loadToken.current) return;
        setLoading(undefined);
        setError(e instanceof Error ? e.message : String(e));
      });
  }, [libraryShow, selection, playback, present]);

  async function openFiles(list: FileList) {
    const files = Array.from(list);
    const token = ++loadToken.current;
    setError(undefined);
    playback.pause();
    try {
      let loadedFiles: LoadedFiles;
      const zip = files.find((f) => /\.zip$/i.test(f.name));
      const fseq = files.find((f) => /\.fseq$/i.test(f.name));
      const audio = files.find((f) => /\.(wav|mp3)$/i.test(f.name));
      if (zip) loadedFiles = fromZip(new Uint8Array(await zip.arrayBuffer()));
      else if (fseq) {
        loadedFiles = {
          fseq: new Uint8Array(await fseq.arrayBuffer()),
          ...(audio ? { audio: new Blob([audio], { type: audioType(audio.name) }) } : {}),
        };
      } else throw new Error('Choose a .fseq file (and optionally its .wav/.mp3), or a .zip');
      const name = (zip ?? fseq)!.name;
      setFileName(name);
      const url = new URL(location.href);
      url.search = '';
      history.replaceState(null, '', url);
      await present(name, loadedFiles, token);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Keyboard: space = play/pause, Home = back to start.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(target.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        playback.toggle();
      } else if (e.code === 'Home') playback.seek(0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playback]);

  const timeRef = useRef<HTMLSpanElement>(null);
  useEffect(
    () =>
      playback.subscribe((t) => {
        if (timeRef.current) timeRef.current.textContent = formatTime(t);
      }),
    [playback],
  );

  const panes = useRef<HTMLDivElement>(null);
  function startDrag(e: React.PointerEvent) {
    const el = panes.current!;
    const rect = el.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const f = layout === 'side' ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height;
      setSplit(Math.min(0.85, Math.max(0.15, f)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setSplit((s) => {
        store('split', String(s));
        return s;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    e.preventDefault();
  }

  function chooseLayout(l: Layout) {
    setLayout(l);
    store('layout', l);
  }

  const issues = loaded?.issues ?? [];
  const errors = issues.filter((i) => i.severity === 'error').length;
  const duration = loaded ? loaded.show.frameCount * loaded.show.stepTimeMs : 0;

  return (
    <div className="app">
      <header className="toolbar">
        <span className="brand">
          <span className="brand-dot" /> Lightshow Studio
        </span>

        <label className="field">
          <span>Show</span>
          <select
            value={fileName ? '__file' : selection.showId}
            onChange={(e) => {
              if (e.target.value === '__file') return;
              setFileName(undefined);
              setSelection({ showId: e.target.value, car: 1 });
            }}
          >
            <optgroup label="Tesla examples">
              {LIBRARY.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                  {s.cars > 1 ? ` (${s.cars} cars)` : ''}
                </option>
              ))}
            </optgroup>
            {fileName && (
              <optgroup label="Your file">
                <option value="__file">{fileName}</option>
              </optgroup>
            )}
          </select>
        </label>

        {libraryShow && libraryShow.cars > 1 && (
          <label className="field">
            <span>Car</span>
            <select value={selection.car} onChange={(e) => setSelection({ ...selection, car: Number(e.target.value) })}>
              {Array.from({ length: libraryShow.cars }, (_, i) => (
                <option key={i} value={i + 1}>
                  Car {i + 1}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="button">
          Open file…
          <input
            type="file"
            multiple
            accept=".fseq,.wav,.mp3,.zip"
            onChange={(e) => {
              if (e.target.files?.length) void openFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </label>

        <span className="divider" />

        <button className="icon" onClick={() => playback.seek(0)} title="Back to start (Home)" aria-label="Back to start">
          ⏮
        </button>
        <button className="play" onClick={() => playback.toggle()} disabled={!loaded} title="Play / pause (Space)">
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>
        <span className="time">
          <span ref={timeRef}>0:00.0</span> / {formatTime(duration)}
        </span>

        <span className="spacer" />

        {loaded && (
          <div className="checks">
            <button className={`chip ${errors ? 'bad' : issues.length ? 'warn' : 'good'}`} onClick={() => setChecksOpen((o) => !o)}>
              {errors ? `${errors} error${errors > 1 ? 's' : ''}` : issues.length ? `${issues.length} warning${issues.length > 1 ? 's' : ''}` : '✓ No problems'}
            </button>
            {checksOpen && (
              <div className="popover" role="dialog" aria-label="Show checks">
                <p className="popover-title">Checks for this show</p>
                {issues.length === 0 && <p>No problems found.</p>}
                <ul>
                  {issues.map((issue, i) => (
                    <li key={i} className={`issue ${issue.severity}`}>
                      <button
                        className="when"
                        disabled={issue.timeMs === undefined}
                        onClick={() => issue.timeMs !== undefined && playback.seek(issue.timeMs)}
                      >
                        {issue.timeMs !== undefined ? formatTime(issue.timeMs) : '—'}
                      </button>
                      <span>{issue.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="segmented" role="group" aria-label="Layout">
          <button className={layout === 'side' ? 'on' : ''} onClick={() => chooseLayout('side')} title="Side by side">
            ◧ Side by side
          </button>
          <button className={layout === 'stack' ? 'on' : ''} onClick={() => chooseLayout('stack')} title="Top and bottom">
            ⬒ Top / bottom
          </button>
        </div>
      </header>

      <div
        ref={panes}
        className={`panes ${layout}`}
        style={{ gridTemplate: layout === 'side' ? `1fr / ${split}fr 6px ${1 - split}fr` : `${split}fr 6px ${1 - split}fr / 1fr` }}
      >
        <section className="pane">
          <CarView sim={loaded?.sim} playback={playback} />
          <div className="pane-badge">
            {profile.name} · stylized preview
            {loaded && <span className="pane-badge-title">{loaded.title}</span>}
          </div>
        </section>
        <div className="splitter" onPointerDown={startDrag} role="separator" aria-orientation={layout === 'side' ? 'vertical' : 'horizontal'} />
        <section className="pane">
          {loaded ? (
            <Composer show={loaded.show} sim={loaded.sim} profile={profile} peaks={peaks} playback={playback} />
          ) : (
            <p className="pane-message">{error ? '' : 'Loading…'}</p>
          )}
        </section>

        {(loading || error) && (
          <div className="overlay">
            {loading && (
              <div className="overlay-card">
                <p>{loading.label}</p>
                <div className="progress">
                  <div style={{ width: `${Math.round((loading.progress ?? 0) * 100)}%` }} />
                </div>
              </div>
            )}
            {error && (
              <div className="overlay-card error">
                <p>Couldn't load this show: {error}</p>
                <button onClick={() => setError(undefined)}>Dismiss</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
