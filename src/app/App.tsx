import {
  Car,
  CircleCheck,
  CircleHelp,
  Columns2,
  Download,
  FilePlus2,
  FolderOpen,
  Library,
  Music,
  Pause,
  Play,
  Rows2,
  Search,
  SkipBack,
  TriangleAlert,
  User,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { showFileName } from '../core/export';
import { readFseq } from '../core/fseq';
import {
  blankProject,
  compileProject,
  effectFamily,
  EFFECT_HOTKEYS,
  isClosureKind,
  mirrored,
  newEffectId,
  projectFromShow,
  type Effect,
  type EffectKind,
} from '../core/project';
import { simulate } from '../core/simulate';
import { bestMatch, durationWarning, guessFromFileName, songInfo, SOURCE_NAMES, type SongInfo } from '../core/songSearch';
import { formatTime, validate } from '../core/validate';
import { DEFAULT_VEHICLE_ID, VEHICLES_BY_ID, vehiclesByModel, type VehicleProfile } from '../core/vehicles';
import { DEFAULT_SHOW_ID, LIBRARY, type LibraryShow } from '../library/catalog';
import { AUDIO_ACCEPT, audioType, fromZip, isAudioFile, loadLibraryShow, type LoadedFiles } from '../library/load';
import { audioDurationMs, computePeaks, type Peaks } from './audio';
import { CarView } from './CarView';
import { Composer, type Range } from './Composer';
import { ComposerBar } from './ComposerBar';
import { ExportDialog, UsbHelpDialog, VinDialog } from './dialogs';
import { exportFseq, exportUsbZip } from './exportShow';
import { searchSongs } from './musicSearch';
import { Menu } from './Menu';
import { Playback } from './playback';
import { MOD_KEY, SongBadge, SongSearchDialog, StartState, Toast } from './SongSearch';
import { useEditor } from './useEditor';

type Layout = 'side' | 'stack';
type CarMode = 'single' | 'multi';
type Modal = 'vin' | 'export' | 'help' | 'song' | undefined;

interface Doc {
  /** Changes whenever a different show is opened. */
  key: string;
  title: string;
  audio: Blob | undefined;
  /** Where it came from, for the File menu. */
  source: { kind: 'library'; id: string } | { kind: 'file'; name: string } | { kind: 'new'; name: string };
  /** The song behind a new show, from Apple's catalog (metadata only, never audio). */
  song?: SongInfo;
}

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
    // Storage can be unavailable (private mode); settings just won't persist.
  }
}

function initialShowId(): string {
  const id = new URLSearchParams(location.search).get('show');
  return LIBRARY.find((s) => s.id === id)?.id ?? DEFAULT_SHOW_ID;
}

let docCounter = 0;

export function App() {
  const playback = useMemo(() => new Playback(), []);
  const editor = useEditor();
  // Lets automated browser checks drive the app during development.
  if (import.meta.env.DEV) Object.assign(window, { __playback: playback, __editor: editor });
  const playing = useSyncExternalStore(
    (cb) => playback.subscribeState(cb),
    () => playback.isPlaying,
  );

  const [layout, setLayout] = useState<Layout>(() => (stored('layout') === 'stack' ? 'stack' : 'side'));
  const [split, setSplit] = useState(() => {
    const v = Number(stored('split'));
    return v > 0.15 && v < 0.85 ? v : 0.38;
  });
  const [vehicle, setVehicle] = useState<VehicleProfile>(
    () => VEHICLES_BY_ID.get(stored('vehicle') ?? '') ?? VEHICLES_BY_ID.get(DEFAULT_VEHICLE_ID)!,
  );
  const [carMode, setCarMode] = useState<CarMode>('single');
  const [doc, setDoc] = useState<Doc>();
  const [range, setRange] = useState<Range>({ startMs: 0, endMs: 0 });
  const [peaks, setPeaks] = useState<Peaks>();
  const [loading, setLoading] = useState<{ label: string; progress?: number }>();
  const [error, setError] = useState<string>();
  const [checksOpen, setChecksOpen] = useState(false);
  const [modal, setModal] = useState<Modal>();
  const [toast, setToast] = useState<{ message: string; tone?: 'info' | 'warn'; action?: { label: string; onSelect: () => void } }>();
  const loadToken = useRef(0);
  const zoomRef = useRef<(factor: number | 'fit') => void>(undefined);
  const clipboard = useRef<Effect[]>([]);
  const openInput = useRef<HTMLInputElement>(null);
  const songInput = useRef<HTMLInputElement>(null);

  // The show is compiled from the editable project; everything else derives from it.
  const show = useMemo(() => (editor.project ? compileProject(editor.project) : undefined), [editor.project]);
  const sim = useMemo(() => (show ? simulate(show, vehicle) : undefined), [show, vehicle]);
  const issues = useMemo(() => (show ? validate(show) : []), [show]);
  const durationMs = show ? show.frameCount * show.stepTimeMs : 0;

  const open = useCallback(
    async (title: string, source: Doc['source'], files: LoadedFiles | { audio: Blob; blankMs: number }, token: number, song?: SongInfo) => {
      const project = 'blankMs' in files ? blankProject(files.blankMs) : projectFromShow(readFseq(files.fseq));
      if (token !== loadToken.current) return;
      const duration = project.frameCount * project.stepTimeMs;
      editor.load(project);
      setDoc({ key: String(++docCounter), title, audio: files.audio, source, ...(song ? { song } : {}) });
      setRange({ startMs: 0, endMs: duration });
      setPeaks(undefined);
      playback.setSource(files.audio, duration);
      setLoading(undefined);
      if (files.audio) {
        computePeaks(files.audio)
          .then((p) => token === loadToken.current && setPeaks(p))
          .catch(() => {});
      }
    },
    [playback, editor],
  );

  const openLibrary = useCallback(
    (show: LibraryShow) => {
      const token = ++loadToken.current;
      setError(undefined);
      playback.pause();
      setLoading({ label: `Downloading “${show.title}” from Tesla's repo…`, progress: 0 });
      const url = new URL(location.href);
      url.searchParams.set('show', show.id);
      url.searchParams.delete('car');
      history.replaceState(null, '', url);
      // Single-car mode: multi-car shows play the first car's part.
      loadLibraryShow(show, 1, (p) => token === loadToken.current && setLoading((l) => l && { ...l, progress: p }))
        .then((files) => open(show.title, { kind: 'library', id: show.id }, files, token))
        .catch((e: unknown) => {
          if (token !== loadToken.current) return;
          setLoading(undefined);
          setError(e instanceof Error ? e.message : String(e));
        });
    },
    [open, playback],
  );

  // Open the default (or linked) example on first load.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    openLibrary(LIBRARY.find((s) => s.id === initialShowId())!);
  }, [openLibrary]);

  function clearUrl() {
    const url = new URL(location.href);
    url.search = '';
    history.replaceState(null, '', url);
  }

  async function openFiles(list: FileList) {
    const files = Array.from(list);
    const token = ++loadToken.current;
    setError(undefined);
    playback.pause();
    try {
      let loadedFiles: LoadedFiles;
      const zip = files.find((f) => /\.zip$/i.test(f.name));
      const fseq = files.find((f) => /\.fseq$/i.test(f.name));
      const audio = files.find((f) => isAudioFile(f.name));
      if (zip) loadedFiles = fromZip(new Uint8Array(await zip.arrayBuffer()));
      else if (fseq) {
        loadedFiles = {
          fseq: new Uint8Array(await fseq.arrayBuffer()),
          ...(audio ? { audio: new Blob([audio], { type: audioType(audio.name) }) } : {}),
        };
      } else throw new Error('Choose a .fseq file (and optionally its music), or a .zip');
      const name = (zip ?? fseq)!.name;
      clearUrl();
      await open(name.replace(/\.(zip|fseq)$/i, ''), { kind: 'file', name }, loadedFiles, token);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** A blank show over the user's own song file; throws if the file can't be read. */
  async function startFromSong(file: File, song?: SongInfo): Promise<{ durationMs: number; token: number }> {
    const token = ++loadToken.current;
    setError(undefined);
    setToast(undefined);
    playback.pause();
    const audio = new Blob([file], { type: audioType(file.name) });
    const blankMs = await audioDurationMs(audio, file.name);
    clearUrl();
    await open(song?.title ?? file.name.replace(/\.[^.]+$/, ''), { kind: 'new', name: file.name }, { audio, blankMs }, token, song);
    return { durationMs: blankMs, token };
  }

  async function newFromSong(file: File) {
    try {
      const { durationMs, token } = await startFromSong(file);
      void matchSong(file.name, durationMs, token);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** After a plain drop, quietly look the song up by its file name to add artwork and title. */
  async function matchSong(fileName: string, durationMs: number, token: number) {
    const term = guessFromFileName(fileName);
    if (term.length < 3) return;
    const match = bestMatch(await searchSongs(term, { limit: 5 }).catch(() => []), fileName, durationMs);
    if (!match || token !== loadToken.current) return;
    const song = songInfo(match);
    const fileTitle = fileName.replace(/\.[^.]+$/, '');
    setDoc((d) => d && { ...d, title: song.title, song });
    setToast({
      message: `Matched “${song.title}” by ${song.artist} on ${SOURCE_NAMES[song.source ?? 'apple']}.`,
      action: {
        label: 'Not this song',
        onSelect: () => token === loadToken.current && setDoc((d) => d && { ...d, title: fileTitle, song: undefined }),
      },
    });
  }

  async function newFromSearch(file: File, song: SongInfo | undefined) {
    if (!song) {
      // Dropped a file in the dialog without picking a song: same as a plain drop.
      const { durationMs, token } = await startFromSong(file);
      setModal(undefined);
      void matchSong(file.name, durationMs, token);
      return;
    }
    const { durationMs } = await startFromSong(file, song);
    setModal(undefined);
    // A preview clip is short by design.
    const warning = song.clip ? undefined : durationWarning(durationMs, song.durationMs);
    if (warning) setToast({ message: warning, tone: 'warn' });
  }

  const findSong = useCallback(() => {
    playback.pause();
    setModal('song');
  }, [playback]);

  // Drag and drop anywhere: a song starts a new show; a .fseq or .zip opens one.
  const [dropping, setDropping] = useState(false);
  const dragDepth = useRef(0);
  const dropHandlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      dragDepth.current++;
      setDropping(true);
    },
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDropping(false);
    },
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes('Files')) e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDropping(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.some((f) => /\.(fseq|zip)$/i.test(f.name))) void openFiles(e.dataTransfer.files);
      else {
        const song = files.find((f) => isAudioFile(f.name));
        if (song) void newFromSong(song);
        else setError(`Couldn't use ${files[0]?.name ?? 'that'}: drop a song (MP3, WAV, M4A, FLAC, OGG) or a .fseq/.zip show`);
      }
    },
  };

  function chooseVehicle(v: VehicleProfile) {
    setVehicle(v);
    store('vehicle', v.id);
  }

  const selectedEffects = useCallback(
    () => editor.project?.effects.filter((e) => editor.selection.has(e.id)) ?? [],
    [editor],
  );

  const mirrorSelection = useCallback(() => {
    const copies = mirrored(selectedEffects());
    if (copies.length) editor.place(copies, false);
  }, [editor, selectedEffects]);

  const changeSelected = useCallback(
    (change: (e: Effect) => Effect) => {
      const changed = selectedEffects().map(change);
      if (changed.length) editor.place(changed);
    },
    [editor, selectedEffects],
  );

  // Keyboard: transport, editing, and Tesla's xLights hotkeys for effect types.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (modal || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'k') {
        e.preventDefault();
        findSong();
      } else if (e.code === 'Space') {
        e.preventDefault();
        playback.toggle();
      } else if (e.code === 'Home') playback.seek(0);
      else if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        editor.redo();
      } else if (mod && key === 'a') {
        e.preventDefault();
        editor.select(editor.project?.effects.map((fx) => fx.id) ?? []);
      } else if (mod && key === 'c') {
        clipboard.current = selectedEffects();
      } else if (mod && key === 'x') {
        clipboard.current = selectedEffects();
        editor.remove(editor.selection);
      } else if (mod && key === 'v' && clipboard.current.length) {
        e.preventDefault();
        // Paste at the playhead, keeping the copied effects' spacing.
        const first = Math.min(...clipboard.current.map((fx) => fx.startMs));
        const at = playback.timeMs();
        editor.place(clipboard.current.map((fx) => ({ ...fx, id: newEffectId(), startMs: fx.startMs - first + at, endMs: fx.endMs - first + at })));
      } else if (mod && key === 'd') {
        e.preventDefault();
        const sel = selectedEffects();
        if (!sel.length) return;
        const span = Math.max(...sel.map((fx) => fx.endMs)) - Math.min(...sel.map((fx) => fx.startMs));
        editor.place(sel.map((fx) => ({ ...fx, id: newEffectId(), startMs: fx.startMs + span, endMs: fx.endMs + span })));
      } else if (key === 'delete' || key === 'backspace') {
        e.preventDefault();
        editor.remove(editor.selection);
      } else if (key === 'escape') editor.select([]);
      else if (key === 'm' && !mod) mirrorSelection();
      else if (!mod && EFFECT_HOTKEYS[key]) {
        // Like xLights: the hotkey changes the selected effects (F is Stop on doors) and sets the brush.
        const kind = EFFECT_HOTKEYS[key]!;
        const kindFor = (fx: Effect): EffectKind | undefined => {
          if (effectFamily(fx.channel) === 'closure') return key === 'f' ? 'stop' : isClosureKind(kind) ? kind : undefined;
          return isClosureKind(kind) ? undefined : kind;
        };
        const changed = selectedEffects().flatMap((fx) => {
          const k = kindFor(fx);
          return k ? [{ ...fx, kind: k }] : [];
        });
        if (changed.length) editor.place(changed);
        if (isClosureKind(kind)) editor.setClosureBrush(kind);
        else editor.setLightBrush(kind);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playback, modal, editor, selectedEffects, mirrorSelection, findSong]);

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
    const rect = panes.current!.getBoundingClientRect();
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

  const errors = issues.filter((i) => i.severity === 'error').length;
  const closeModal = useCallback(() => setModal(undefined), []);
  const closeToast = useCallback(() => setToast(undefined), []);
  const libraryId = doc?.source.kind === 'library' ? doc.source.id : undefined;

  return (
    <div className="app" {...dropHandlers}>
      {dropping && (
        <div className="drop-overlay">
          <div className="drop-card">
            <Music size={28} />
            <p className="drop-title">Drop to open</p>
            <p className="muted">A song starts a new show · a .fseq or .zip opens an existing one</p>
          </div>
        </div>
      )}
      <header className="topbar">
        <div className="tb-left">
          <span className="brand" title="Lightshow Studio">
            <span className="brand-mark" />
            <span className="brand-name">Lightshow Studio</span>
          </span>
          <Menu
            className="file-menu"
            title="Open, create or switch shows"
            label={
              doc?.song ? (
                <SongBadge song={doc.song} />
              ) : (
                <>
                  <Library size={15} />
                  <span className="truncate">{doc?.title ?? (loading || !started.current ? 'Loading…' : 'No show open')}</span>
                </>
              )
            }
            sections={[
              {
                items: [
                  {
                    id: 'find',
                    label: (
                      <span className="menu-label-row">
                        Find a song… <kbd>{MOD_KEY} K</kbd>
                      </span>
                    ),
                    hint: 'Search by name, preview, add your copy',
                    icon: <Search size={15} />,
                    onSelect: findSong,
                  },
                  { id: 'new', label: 'New show from a song…', hint: 'MP3, WAV, M4A, FLAC or OGG · or drop it anywhere', icon: <FilePlus2 size={15} />, onSelect: () => songInput.current?.click() },
                  { id: 'open', label: 'Open a show file…', hint: '.fseq (plus its music) or .zip', icon: <FolderOpen size={15} />, onSelect: () => openInput.current?.click() },
                ],
              },
              {
                label: 'Tesla example shows',
                items: LIBRARY.map((s) => ({ id: s.id, label: s.title, hint: s.blurb, checked: s.id === libraryId, onSelect: () => openLibrary(s) })),
              },
            ]}
          />
          <input
            ref={songInput}
            type="file"
            accept={`${AUDIO_ACCEPT},audio/*`}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void newFromSong(f);
              e.target.value = '';
            }}
          />
          <input
            ref={openInput}
            type="file"
            multiple
            accept={`.fseq,.zip,${AUDIO_ACCEPT}`}
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void openFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        <div className="tb-center transport">
          <button className="round" onClick={() => playback.seek(0)} title="Back to start (Home)" aria-label="Back to start">
            <SkipBack size={16} />
          </button>
          <button className="round play" onClick={() => playback.toggle()} disabled={!show} title="Play / pause (Space)" aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </button>
          <span className="time">
            <span ref={timeRef}>0:00.0</span>
            <span className="time-total"> / {formatTime(durationMs)}</span>
          </span>
        </div>

        <div className="tb-right">
          <Menu
            title="Choose your car"
            align="right"
            label={
              <>
                <Car size={15} />
                <span className="truncate">{vehicle.name}</span>
              </>
            }
            sections={[
              ...vehiclesByModel().map((m) => ({
                label: m.name,
                items: m.variants.map((v) => ({ id: v.id, label: v.variant, hint: v.hint, checked: v.id === vehicle.id, onSelect: () => chooseVehicle(v) })),
              })),
              { items: [{ id: 'vin', label: 'Look up by VIN…', hint: 'Find your exact version', icon: <Search size={15} />, onSelect: () => setModal('vin') }] },
            ]}
          />
          <div className="segmented" role="group" aria-label="Number of cars">
            <button className={carMode === 'single' ? 'on' : ''} onClick={() => setCarMode('single')} title="Single car">
              <User size={15} />
            </button>
            <button className={carMode === 'multi' ? 'on' : ''} onClick={() => setCarMode('multi')} title="Multiple cars (coming later)">
              <Users size={15} />
            </button>
          </div>
          <div className="segmented" role="group" aria-label="Layout">
            <button className={layout === 'side' ? 'on' : ''} onClick={() => chooseLayout('side')} title="Side by side">
              <Columns2 size={15} />
            </button>
            <button className={layout === 'stack' ? 'on' : ''} onClick={() => chooseLayout('stack')} title="Top and bottom">
              <Rows2 size={15} />
            </button>
          </div>
          {show && (
            <div className="checks">
              <button
                className={`chip ${errors ? 'bad' : issues.length ? 'warn' : 'good'}`}
                onClick={() => setChecksOpen((o) => !o)}
                title="Checks against Tesla's rules"
              >
                {errors || issues.length ? <TriangleAlert size={14} /> : <CircleCheck size={14} />}
                {errors ? `${errors}` : issues.length ? `${issues.length}` : 'OK'}
              </button>
              {checksOpen && (
                <div className="popover" role="dialog" aria-label="Show checks">
                  <p className="popover-title">Checks against Tesla's rules</p>
                  {issues.length === 0 && <p className="muted">No problems found.</p>}
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
          <button className="primary export" onClick={() => setModal('export')} disabled={!show}>
            <Download size={15} /> Export
          </button>
          <button className="icon-only" onClick={() => setModal('help')} title="How to put a show on your Tesla" aria-label="USB drive instructions">
            <CircleHelp size={17} />
          </button>
        </div>
      </header>

      <div
        ref={panes}
        className={`panes ${layout}`}
        style={{ gridTemplate: layout === 'side' ? `1fr / ${split}fr 5px ${1 - split}fr` : `${split}fr 5px ${1 - split}fr / 1fr` }}
      >
        <section className="pane car-pane">
          <CarView sim={sim} vehicle={vehicle} playback={playback} />
        </section>
        <div className="splitter" onPointerDown={startDrag} role="separator" aria-orientation={layout === 'side' ? 'vertical' : 'horizontal'} />
        <section className="pane composer">
          {show && sim && doc ? (
            <>
              <ComposerBar
                editor={editor}
                onMirror={mirrorSelection}
                onDelete={() => editor.remove(editor.selection)}
                onChangeSelected={changeSelected}
                zoom={(f) => zoomRef.current?.(f)}
              />
              <Composer
                docKey={doc.key}
                show={show}
                sim={sim}
                profile={vehicle}
                peaks={peaks}
                playback={playback}
                editor={editor}
                range={range}
                onRangeChange={setRange}
                zoomRef={zoomRef}
              />
            </>
          ) : (
            !loading && started.current ? (
              <StartState onFind={findSong} onOpen={() => openInput.current?.click()} />
            ) : (
              <p className="pane-message">{error ? '' : 'Loading…'}</p>
            )
          )}
        </section>

        {carMode === 'multi' && (
          <div className="overlay">
            <div className="overlay-card">
              <p className="overlay-title">
                <Users size={16} /> Multiple cars: coming later
              </p>
              <p className="muted">
                This mode will choreograph several cars parked side by side (Tesla supports synchronized shows across several cars), with
                sweeps that travel from car to car and one show file per car. For now the editor works on a single car.
              </p>
              <button className="primary" onClick={() => setCarMode('single')}>
                Back to single car
              </button>
            </div>
          </div>
        )}

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
                <p>Couldn't open this show: {error}</p>
                <button onClick={() => setError(undefined)}>Dismiss</button>
              </div>
            )}
          </div>
        )}
      </div>

      {modal === 'vin' && (
        <VinDialog
          onClose={closeModal}
          onPick={(v) => {
            chooseVehicle(v);
            closeModal();
          }}
        />
      )}
      {modal === 'help' && <UsbHelpDialog onClose={closeModal} />}
      {modal === 'song' && <SongSearchDialog onFile={newFromSearch} onClose={closeModal} />}
      {toast && <Toast key={toast.message} {...toast} onClose={closeToast} />}
      {modal === 'export' && doc && show && (
        <ExportDialog
          defaultName={showFileName(doc.song?.title ?? doc.title)}
          startMs={range.startMs}
          endMs={range.endMs}
          durationMs={durationMs}
          errors={errors}
          hasAudio={!!doc.audio}
          format={formatTime}
          onUsb={(name) => exportUsbZip(name, show, doc.audio, range)}
          onFseq={(name) => exportFseq(name, show, range)}
          onResetRange={() => setRange({ startMs: 0, endMs: durationMs })}
          onHelp={() => setModal('help')}
          onClose={closeModal}
        />
      )}
    </div>
  );
}
