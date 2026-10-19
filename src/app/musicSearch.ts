// Song search across catalogs: Apple's iTunes Search first, Deezer when Apple
// can't be reached. Ad blockers, network filters and Apple's rate limit
// (roughly 20 searches a minute) can each stop one catalog, so a second one
// on a different domain keeps search working. Results are cached, and a
// catalog that just failed is skipped for a while instead of retried on every
// keystroke.

import {
  deezerSearchUrl,
  parseDeezerResults,
  parseItunesResults,
  searchUrl,
  sameSong,
  SOURCE_NAMES,
  type SongInfo,
  type SongResult,
  type SongSource,
} from '../core/songSearch';
import { jsonp } from './jsonp';

export type FailureReason = 'blocked' | 'timeout' | 'busy' | 'error';

export interface SourceFailure {
  source: SongSource;
  reason: FailureReason;
  detail: string;
}

/** Every catalog failed; `failures` says how. */
export class SongSearchError extends Error {
  constructor(readonly failures: SourceFailure[]) {
    super(failures.map((f) => `${SOURCE_NAMES[f.source]}: ${f.detail}`).join('; '));
  }
}

const TIMEOUT_MS = 7000;
/** How long to skip a catalog after it fails, by reason. */
const PAUSE_MS: Record<FailureReason, number> = { blocked: 5 * 60_000, timeout: 60_000, busy: 60_000, error: 30_000 };

const cache = new Map<string, SongResult[]>();
const pausedUntil: Record<SongSource, number> = { apple: 0, deezer: 0 };

class Failure extends Error {
  constructor(
    readonly reason: FailureReason,
    detail: string,
  ) {
    super(detail);
  }
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/** Lets the next search try every catalog again (the Retry button). */
export function resetSongSearch(): void {
  pausedUntil.apple = 0;
  pausedUntil.deezer = 0;
}

export async function searchSongs(term: string, { signal, limit = 8 }: { signal?: AbortSignal; limit?: number } = {}): Promise<SongResult[]> {
  const key = `${term.trim().toLowerCase()}|${limit}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const failures: SourceFailure[] = [];
  for (const source of ['apple', 'deezer'] as const) {
    if (Date.now() < pausedUntil[source]) {
      failures.push({ source, reason: 'busy', detail: 'skipped after failing a moment ago' });
      continue;
    }
    try {
      const songs = source === 'apple' ? await searchApple(term, limit, signal) : await searchDeezer(term, limit, signal);
      cache.set(key, songs);
      if (cache.size > 200) cache.delete(cache.keys().next().value!);
      return songs;
    } catch (e) {
      if (isAbort(e) || signal?.aborted) throw e;
      const f = e instanceof Failure ? e : new Failure('error', e instanceof Error ? e.message : String(e));
      failures.push({ source, reason: f.reason, detail: f.message });
      pausedUntil[source] = Date.now() + PAUSE_MS[f.reason];
      console.warn(`Song search: ${SOURCE_NAMES[source]} failed (${f.reason}): ${f.message}`);
    }
  }
  throw new SongSearchError(failures);
}

/**
 * Apple sends CORS headers (Access-Control-Allow-Origin: *), so a request
 * the browser refuses was blocked by an extension or the network, and
 * there's no point retrying it another way: move on to Deezer.
 */
async function searchApple(term: string, limit: number, signal: AbortSignal | undefined): Promise<SongResult[]> {
  let response: Response;
  try {
    response = await fetchWithTimeout(searchUrl(term, { limit }), signal);
  } catch (e) {
    if (isAbort(e) && signal?.aborted) throw e;
    if (isAbort(e)) throw new Failure('timeout', 'no answer within 7 seconds');
    throw new Failure('blocked', 'blocked by the browser, an extension or the network');
  }
  if (response.status === 403 || response.status === 429 || response.status >= 500) {
    throw new Failure('busy', `busy or rate-limited (HTTP ${response.status})`);
  }
  if (!response.ok) throw new Failure('error', `HTTP ${response.status}`);
  return parseItunesResults(await response.json());
}

async function searchDeezer(term: string, limit: number, signal: AbortSignal | undefined): Promise<SongResult[]> {
  // Deezer sends no CORS headers, so it's JSONP only.
  const json = await jsonpOrFailure((callback) => deezerSearchUrl(term, { limit, callback }), signal);
  // Deezer reports errors (like its quota) as a normal response.
  const error = (json as { error?: { message?: unknown } } | undefined)?.error;
  if (error) throw new Failure('busy', String(error.message ?? 'error'));
  return parseDeezerResults(json);
}

async function jsonpOrFailure(makeUrl: (callback: string) => string, signal: AbortSignal | undefined): Promise<unknown> {
  try {
    return await jsonp(makeUrl, { signal, timeoutMs: TIMEOUT_MS });
  } catch (e) {
    if (isAbort(e) || signal?.aborted) throw e;
    const message = e instanceof Error ? e.message : String(e);
    throw /timed out/i.test(message)
      ? new Failure('timeout', 'no answer within 7 seconds')
      : new Failure('blocked', 'blocked by the browser, an extension or the network');
  }
}

async function fetchWithTimeout(url: string, signal: AbortSignal | undefined): Promise<Response> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'AbortError')), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * The song's 30-second preview as an audio file, for a show that uses the
 * clip instead of the user's own copy (the owner's choice; see DESIGN §10d).
 * Deezer's MP3 previews can be downloaded by the page (CORS: *); Apple's
 * can't, so an Apple result is matched to the same recording on Deezer.
 */
export async function previewClip(song: SongResult, signal?: AbortSignal): Promise<File> {
  let url: string | undefined;
  if (song.source === 'deezer') {
    url = song.previewUrl;
  } else {
    // A plain search: Deezer's field search (artist:"…" track:"…") returned
    // nothing when checked in October 2026.
    const json = await jsonpOrFailure((callback) => deezerSearchUrl(`${song.artist} ${song.title}`, { limit: 15, callback }), signal);
    url = sameSong(parseDeezerResults(json), song)?.previewUrl;
    if (!url) throw new Error(`Couldn't find a downloadable preview of “${song.title}”. Try another version of the song, or use your own copy.`);
  }
  let response: Response;
  try {
    response = await fetchWithTimeout(url, signal);
  } catch (e) {
    if (isAbort(e) && signal?.aborted) throw e;
    throw new Error("Couldn't download the preview: Deezer's preview server (dzcdn.net) didn't answer or was blocked.");
  }
  if (!response.ok) throw new Error(`Couldn't download the preview (HTTP ${response.status}). Search for the song again and retry.`);
  const blob = await response.blob();
  return new File([blob], clipFileName(song), { type: 'audio/mpeg' });
}

function clipFileName(song: SongInfo): string {
  const safe = `${song.artist} - ${song.title}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${safe} (30-second preview).mp3`;
}
