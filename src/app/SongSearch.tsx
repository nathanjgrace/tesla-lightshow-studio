import {
  ArrowLeft,
  ArrowUpRight,
  FolderOpen,
  Info,
  LoaderCircle,
  Music,
  Pause,
  Play,
  RotateCw,
  Scissors,
  Search,
  Sparkles,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { artworkAt, formatLength, songInfo, SOURCE_NAMES, type SongInfo, type SongResult, type SongSource } from '../core/songSearch';
import { AUDIO_ACCEPT, isAudioFile } from '../library/load';
import { Dialog } from './dialogs';
import { previewClip, resetSongSearch, searchSongs, SongSearchError, type SourceFailure } from './musicSearch';

export const MOD_KEY = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
const FORMATS = 'MP3, WAV, M4A, FLAC, OGG or Opus';
// Long enough not to search on every keystroke: Apple allows about 20 searches a minute.
const DEBOUNCE_MS = 350;
const SOURCE_HOSTS: Record<SongSource, string> = { apple: 'itunes.apple.com', deezer: 'api.deezer.com' };

type Status = 'idle' | 'loading' | 'done' | 'error';

function Artwork({ url, px, className = '' }: { url: string | undefined; px: number; className?: string }) {
  const src = url && artworkAt(url, px);
  // Fades in once loaded; a cached image can finish before React sees onLoad, hence the ref check.
  const [loaded, setLoaded] = useState<string>();
  return (
    <span className={`song-art ${className}`} aria-hidden="true">
      <Music size={px > 100 ? 28 : 16} />
      {src && (
        <img
          key={src}
          ref={(el) => {
            if (el?.complete && el.naturalWidth) setLoaded(src);
          }}
          src={src}
          alt=""
          draggable={false}
          className={loaded === src ? 'loaded' : undefined}
          onLoad={() => setLoaded(src)}
          onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
        />
      )}
    </span>
  );
}

function ListenLink({ url, source = 'apple', compact }: { url: string | undefined; source?: SongSource; compact?: boolean }) {
  if (!url) return null;
  const name = SOURCE_NAMES[source];
  return (
    <a
      className="song-apple"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      tabIndex={compact ? -1 : undefined}
      onClick={(e) => e.stopPropagation()}
      title={`Open this song in ${name}`}
    >
      Listen on {name} <ArrowUpRight size={12} />
    </a>
  );
}

/**
 * Search Apple's catalog (or Deezer's) by name, preview the 30-second clip, then bring your
 * own copy. Previews are never used as the show's audio.
 */
export function SongSearchDialog({
  initialTerm = '',
  onFile,
  onClose,
}: {
  initialTerm?: string;
  /** Starts a show from the user's own file; rejects if it can't be read. */
  onFile: (file: File, song: SongInfo | undefined) => Promise<void>;
  onClose: () => void;
}) {
  const [term, setTerm] = useState(initialTerm);
  const [results, setResults] = useState<SongResult[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [failures, setFailures] = useState<SourceFailure[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [active, setActive] = useState(-1);
  const [selected, setSelected] = useState<SongResult>();
  const [playing, setPlaying] = useState<string>();
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fileError, setFileError] = useState<string>();
  const audio = useRef<HTMLAudioElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const request = useRef(0);
  const dragDepth = useRef(0);

  // Search as you type: debounced, and stale responses are dropped.
  useEffect(() => {
    const q = term.trim();
    const id = ++request.current;
    if (q.length < 2) {
      setResults([]);
      setStatus('idle');
      setActive(-1);
      return;
    }
    setStatus('loading');
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchSongs(q, { signal: controller.signal })
        .then((songs: SongResult[]) => {
          if (id !== request.current) return;
          setResults(songs);
          setActive(songs.length ? 0 : -1);
          setStatus('done');
        })
        .catch((e: unknown) => {
          if (id !== request.current || (e instanceof DOMException && e.name === 'AbortError')) return;
          setFailures(e instanceof SongSearchError ? e.failures : []);
          setStatus('error');
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term, attempt]);

  // One shared player; it stops when the dialog closes.
  useEffect(() => {
    const el = audio.current;
    return () => {
      el?.pause();
      el?.removeAttribute('src');
    };
  }, []);

  // ⌘/Ctrl K inside the dialog jumps back to the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSelected(undefined);
        requestAnimationFrame(() => input.current?.select());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function stopPreview() {
    audio.current?.pause();
    setPlaying(undefined);
    setProgress(0);
  }

  function togglePreview(song: SongResult) {
    const el = audio.current;
    if (!el) return;
    if (playing === song.id) {
      stopPreview();
      return;
    }
    el.src = song.previewUrl;
    setPlaying(song.id);
    setProgress(0);
    el.play().catch(() => setPlaying((p) => (p === song.id ? undefined : p)));
  }

  function pick(song: SongResult) {
    if (playing && playing !== song.id) stopPreview();
    setSelected(song);
    setFileError(undefined);
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.song-drop button')?.focus());
  }

  function backToResults() {
    setSelected(undefined);
    requestAnimationFrame(() => input.current?.focus());
  }

  /** Starts the show on the song's 30-second preview instead of the user's copy. */
  async function useClip() {
    if (!selected || busy) return;
    stopPreview();
    setBusy(true);
    setFileError(undefined);
    try {
      const file = await previewClip(selected);
      await onFile(file, { ...songInfo(selected), clip: true });
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function takeFile(file: File | undefined) {
    if (!file || busy) return;
    if (!isAudioFile(file.name)) {
      setFileError(`${file.name} isn't a song file. Use ${FORMATS}.`);
      return;
    }
    stopPreview();
    setBusy(true);
    setFileError(undefined);
    try {
      await onFile(file, selected && songInfo(selected));
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!results.length) return;
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a + step + results.length) % results.length);
    } else if (e.key === 'Enter') {
      const song = results[active] ?? results[0];
      if (song) {
        e.preventDefault();
        pick(song);
      }
    } else if (e.key === 'Escape' && term) {
      // First Escape clears the search; the next one closes the dialog.
      e.stopPropagation();
      setTerm('');
    }
  }

  // Drops inside the dialog are handled here, not by the app-wide drop target.
  const drag = {
    onDragEnter: (e: React.DragEvent) => {
      e.stopPropagation();
      if (!e.dataTransfer.types.includes('Files')) return;
      dragDepth.current++;
      setDragging(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      e.stopPropagation();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    },
    onDragOver: (e: React.DragEvent) => {
      e.stopPropagation();
      if (e.dataTransfer.types.includes('Files')) e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepth.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer.files);
      void takeFile(files.find((f) => isAudioFile(f.name)) ?? files[0]);
    },
  };

  const activeSong = results[active];
  const listId = 'song-results';
  const optionId = (s: SongResult) => `song-option-${s.id}`;

  function previewButton(song: SongResult, labeled = false) {
    const on = playing === song.id;
    return (
      <button
        className={`song-play${on ? ' on' : ''}${labeled ? ' labeled' : ''}`}
        style={{ '--p': on ? progress : 0 } as CSSProperties}
        tabIndex={labeled ? undefined : -1}
        onClick={(e) => {
          e.stopPropagation();
          togglePreview(song);
        }}
        aria-label={on ? `Stop preview of ${song.title}` : `Play a preview of ${song.title}`}
        title={on ? 'Stop preview' : 'Play 30-second preview'}
      >
        <span className="song-play-icon">{on ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}</span>
        {labeled && (on ? 'Stop preview' : 'Preview')}
      </button>
    );
  }

  return (
    <div className="song-dialog" {...drag}>
      <Dialog title="Find a song" onClose={onClose} wide>
        {selected ? (
          <div className="song-picked">
            <button className="song-back" onClick={backToResults}>
              <ArrowLeft size={14} /> Back to results
            </button>
            <div
              className="song-card"
              style={selected.artworkUrl ? ({ '--art': `url("${artworkAt(selected.artworkUrl, 200).replace(/"/g, '%22')}")` } as CSSProperties) : undefined}
            >
              <Artwork url={selected.artworkUrl} px={200} className="large" />
              <div className="song-card-text">
                <span className="song-kicker">Selected song</span>
                <h3 className="song-card-title">{selected.title}</h3>
                <p className="song-card-artist">{selected.artist}</p>
                <p className="song-card-meta">
                  {[selected.album, selected.year, selected.durationMs && formatLength(selected.durationMs)].filter(Boolean).join(' · ')}
                </p>
                <div className="song-card-actions">
                  {previewButton(selected, true)}
                  <ListenLink url={selected.trackViewUrl} source={selected.source} />
                </div>
              </div>
            </div>

            <div
              className={`song-drop${dragging ? ' over' : ''}${busy ? ' busy' : ''}`}
              onClick={() => !busy && fileInput.current?.click()}
            >
              <span className="song-drop-icon">{busy ? <LoaderCircle size={22} className="song-spin" /> : <Upload size={22} />}</span>
              <p className="song-drop-title">{busy ? 'Reading your file…' : <>Drop your copy of “{selected.title}” here</>}</p>
              <p className="muted">{FORMATS} · it never leaves your computer</p>
              <button
                className="primary"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  fileInput.current?.click();
                }}
              >
                <FolderOpen size={15} /> Choose file…
              </button>
            </div>
            <div className="song-clip">
              <span className="song-clip-text">
                <span className="song-clip-title">No copy of the song?</span>
                <span className="muted">Use its 30-second preview from Deezer. The show will be 30 seconds long.</span>
              </span>
              <button disabled={busy} onClick={() => void useClip()}>
                <Scissors size={15} /> Use the 30-second clip
              </button>
            </div>
            {fileError && <p className="error-text song-file-error">{fileError}</p>}
          </div>
        ) : (
          <>
            <div className={`song-input${status === 'loading' ? ' loading' : ''}`}>
              <Search size={17} className="song-input-icon" />
              <input
                ref={input}
                data-autofocus
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={onInputKey}
                placeholder="Song title or artist"
                spellCheck={false}
                autoComplete="off"
                role="combobox"
                aria-label="Search for a song"
                aria-autocomplete="list"
                aria-expanded={results.length > 0}
                aria-controls={listId}
                aria-activedescendant={activeSong ? optionId(activeSong) : undefined}
              />
              {status === 'loading' && <LoaderCircle size={16} className="song-spin song-input-spinner" aria-label="Searching" />}
              {term && (
                <button className="song-clear" onClick={() => (setTerm(''), input.current?.focus())} aria-label="Clear search" tabIndex={-1}>
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="song-results">
              {results.length > 0 ? (
                <ul ref={list} id={listId} role="listbox" aria-label="Songs" className={status === 'loading' ? 'stale' : ''}>
                  {results.map((song, i) => (
                    <li
                      key={song.id}
                      id={optionId(song)}
                      role="option"
                      aria-selected={i === active}
                      className={`song-row${i === active ? ' active' : ''}${playing === song.id ? ' playing' : ''}`}
                      onMouseMove={() => i !== active && setActive(i)}
                      onClick={() => pick(song)}
                    >
                      <Artwork url={song.artworkUrl} px={100} />
                      <span className="song-row-text">
                        <span className="song-row-title truncate">{song.title}</span>
                        <span className="song-row-artist truncate">{song.artist}</span>
                        <span className="song-row-meta">
                          <span className="truncate">{[song.album, song.year].filter(Boolean).join(' · ')}</span>
                          <ListenLink url={song.trackViewUrl} source={song.source} compact />
                        </span>
                      </span>
                      <span className="song-row-len">{song.durationMs ? formatLength(song.durationMs) : ''}</span>
                      {previewButton(song)}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="song-empty">
                  {status === 'error' ? (
                    <>
                      <TriangleAlert size={22} className="song-empty-icon warn" />
                      <p className="song-empty-title">Couldn't reach the music catalogs</p>
                      {failures.length > 0 && (
                        <ul className="song-failures">
                          {failures.map((f) => (
                            <li key={f.source}>
                              <strong>{SOURCE_NAMES[f.source]}</strong> ({SOURCE_HOSTS[f.source]}): {f.detail}
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="muted">
                        {failures.some((f) => f.reason === 'blocked')
                          ? 'An ad or content blocker, a privacy extension or a network filter (work, school, Pi-hole) is likely blocking these sites. Allow them for this page, or '
                          : 'Check your connection, or '}
                        drop your song file here to start without searching.
                      </p>
                      <button
                        className="song-retry"
                        onClick={() => {
                          resetSongSearch();
                          setAttempt((a) => a + 1);
                        }}
                      >
                        <RotateCw size={14} /> Try again
                      </button>
                    </>
                  ) : status === 'done' ? (
                    <>
                      <Search size={22} className="song-empty-icon" />
                      <p className="song-empty-title">No songs found for “{term.trim()}”</p>
                      <p className="muted">Try the artist's name too, or check the spelling.</p>
                    </>
                  ) : status === 'loading' ? (
                    <>
                      <LoaderCircle size={22} className="song-empty-icon song-spin" />
                      <p className="muted">Searching…</p>
                    </>
                  ) : (
                    <>
                      <Sparkles size={22} className="song-empty-icon accent" />
                      <p className="song-empty-title">Start with the song</p>
                      <p className="muted">
                        Search by title or artist and listen to a preview. Then add your own copy of the track for a full-length show, or
                        use the 30-second clip.
                      </p>
                      <p className="muted small">Already have the file? Drop it here to skip the search.</p>
                    </>
                  )}
                </div>
              )}
            </div>
            {dragging && (
              <div className="song-drop-hint">
                <Upload size={16} /> Drop to start a show from this file
              </div>
            )}
          </>
        )}
        <p className="song-fineprint">
          <Info size={13} />
          <span>
            Search and previews by Apple Music, or Deezer when Apple can't be reached. Shows made from a preview clip are for personal use; the
            song still belongs to its rights holders.
          </span>
        </p>
        <audio
          ref={audio}
          preload="none"
          onTimeUpdate={(e) => setProgress(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)}
          onEnded={() => (setPlaying(undefined), setProgress(0))}
          onError={() => (setPlaying(undefined), setProgress(0))}
        />
        <input
          ref={fileInput}
          type="file"
          accept={`${AUDIO_ACCEPT},audio/*`}
          hidden
          onChange={(e) => {
            void takeFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </Dialog>
    </div>
  );
}

/** Artwork and "Title · Artist", for the show menu in the top bar. */
export function SongBadge({ song }: { song: SongInfo }) {
  return (
    <span className="song-badge">
      <Artwork url={song.artworkUrl} px={60} className="tiny" />
      <span className="truncate">
        <span className="song-badge-title">{song.title}</span>
        <span className="song-badge-artist"> · {song.artist}</span>
      </span>
      {song.clip && (
        <span className="song-badge-clip" title="This show uses the song's 30-second preview from Deezer">
          30 s clip
        </span>
      )}
    </span>
  );
}

/** A small non-blocking note at the bottom of the window. */
export function Toast({
  message,
  tone = 'info',
  action,
  onClose,
}: {
  message: string;
  tone?: 'info' | 'warn';
  action?: { label: string; onSelect: () => void };
  onClose: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, 12_000);
    return () => clearTimeout(timer);
  }, [message, onClose]);
  return (
    <div className={`toast ${tone}`} role="status">
      {tone === 'warn' ? <TriangleAlert size={16} className="toast-icon" /> : <Music size={16} className="toast-icon" />}
      <span>{message}</span>
      {action && (
        <button
          className="toast-action"
          onClick={() => {
            action.onSelect();
            onClose();
          }}
        >
          {action.label}
        </button>
      )}
      <button className="toast-close" onClick={onClose} aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  );
}

/** Shown in the composer when no show is open. */
export function StartState({ onFind, onOpen }: { onFind: () => void; onOpen: () => void }) {
  return (
    <div className="start-state">
      <span className="start-mark">
        <Music size={22} />
      </span>
      <h2>Start a light show</h2>
      <p className="muted">Pick the song first. The show is built around its music.</p>
      <div className="start-actions">
        <button className="primary" onClick={onFind}>
          <Search size={16} /> Find a song… <kbd>{MOD_KEY} K</kbd>
        </button>
        <button onClick={onOpen}>
          <FolderOpen size={16} /> Open a show file…
        </button>
      </div>
      <p className="muted small">Or drop a song or a .fseq show anywhere on this page.</p>
    </div>
  );
}
