// Finding a song by name with Apple's iTunes Search API (free, no key):
// https://performance-partners.apple.com/search-api. Results come with a
// 30-second preview that may only be played for choosing a song, next to a
// link to Apple Music. Previews never become a show's soundtrack or go into
// an export: the user always brings their own copy of the song.

import { formatTime } from './validate';

export const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';

/** What we keep about the song behind the current show. */
export interface SongInfo {
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  trackViewUrl?: string;
  durationMs?: number;
}

/** One search result, validated. */
export interface SongResult extends SongInfo {
  id: string;
  /** 30-second preview clip. For previewing only, never for export. */
  previewUrl: string;
  year?: number;
  genre?: string;
}

export interface SearchOptions {
  limit?: number;
  /** Two-letter store country; Apple defaults to US. */
  country?: string;
  /** JSONP callback name, for browsers that block the CORS request. */
  callback?: string;
}

export function searchUrl(term: string, { limit = 8, country, callback }: SearchOptions = {}): string {
  const params = new URLSearchParams({ term: term.trim(), media: 'music', entity: 'song', limit: String(limit) });
  if (country) params.set('country', country);
  if (callback) params.set('callback', callback);
  return `${ITUNES_SEARCH_URL}?${params}`;
}

/** Turns an iTunes Search response into songs, dropping anything unusable. */
export function parseItunesResults(json: unknown): SongResult[] {
  const results = isRecord(json) && Array.isArray(json.results) ? json.results : [];
  const seen = new Set<string>();
  const songs: SongResult[] = [];
  for (const r of results) {
    if (!isRecord(r)) continue;
    if (r.kind !== undefined && r.kind !== 'song') continue;
    const title = text(r.trackName);
    const artist = text(r.artistName);
    const previewUrl = httpUrl(r.previewUrl);
    if (!title || !artist || !previewUrl) continue;
    const id = typeof r.trackId === 'number' || typeof r.trackId === 'string' ? String(r.trackId) : previewUrl;
    if (seen.has(id)) continue;
    seen.add(id);
    const ms = r.trackTimeMillis;
    const year = Number(text(r.releaseDate)?.slice(0, 4));
    songs.push({
      id,
      title,
      artist,
      previewUrl,
      ...optional('album', text(r.collectionName)),
      ...optional('artworkUrl', httpUrl(r.artworkUrl100) ?? httpUrl(r.artworkUrl60)),
      ...optional('trackViewUrl', httpUrl(r.trackViewUrl)),
      ...optional('durationMs', typeof ms === 'number' && ms > 0 && Number.isFinite(ms) ? ms : undefined),
      ...optional('year', year > 1800 && year < 3000 ? year : undefined),
      ...optional('genre', text(r.primaryGenreName)),
    });
  }
  return songs;
}

/** Apple's artwork URLs end in e.g. 100x100bb.jpg; any square size can be requested. */
export function artworkAt(url: string, px: number): string {
  return url.replace(/\/\d+x\d+(bb|cc|sr)?\.(jpg|jpeg|png|webp)(?=$|\?)/i, `/${px}x${px}bb.$2`);
}

export function songInfo(r: SongResult): SongInfo {
  const { title, artist, album, artworkUrl, trackViewUrl, durationMs } = r;
  return {
    title,
    artist,
    ...optional('album', album),
    ...optional('artworkUrl', artworkUrl),
    ...optional('trackViewUrl', trackViewUrl),
    ...optional('durationMs', durationMs),
  };
}

/** A song's length as m:ss, rounded to the second. */
export function formatLength(ms: number): string {
  return formatTime(Math.round(ms / 1000) * 1000).replace(/\.\d$/, '');
}

export interface DurationMismatch {
  fileMs: number;
  trackMs: number;
  /** Positive when the user's file is longer. */
  diffMs: number;
}

/** Whether the user's file is noticeably longer or shorter than the catalog version. */
export function durationMismatch(fileMs: number, trackMs: number | undefined, toleranceMs = 5000): DurationMismatch | undefined {
  if (!trackMs || !Number.isFinite(trackMs) || !Number.isFinite(fileMs)) return undefined;
  const diffMs = fileMs - trackMs;
  return Math.abs(diffMs) > toleranceMs ? { fileMs, trackMs, diffMs } : undefined;
}

/** A gentle note when the file and the chosen song differ in length, or undefined. */
export function durationWarning(fileMs: number, trackMs: number | undefined): string | undefined {
  const m = durationMismatch(fileMs, trackMs);
  if (!m) return undefined;
  const ratio = m.fileMs / m.trackMs;
  const kind = ratio < 0.6 ? 'a clip or a short edit' : m.diffMs < 0 ? 'an edit' : 'an extended or live version';
  return `Your file is ${formatLength(m.fileMs)}, but the album version is ${formatLength(m.trackMs)}. That's fine if it's ${kind}.`;
}

// Bracketed parts of downloaded file names that aren't part of the song's name.
const JUNK = /\b(official|video|audio|lyrics?|visuali[sz]er|hd|hq|4k|\d+\s*kbps|mp3|free download)\b/i;

/** "01 - Daft Punk - One More Time.mp3" → "Daft Punk One More Time", for a search. */
export function guessFromFileName(name: string): string {
  let s = name.replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]{2,5}$/i, '');
  s = s.replace(/_/g, ' ');
  if (!s.includes(' ')) s = s.replace(/\./g, ' ');
  s = s.replace(/[([{]([^)\]}]*)[)\]}]/g, (group, inner: string) => (JUNK.test(inner) ? ' ' : group));
  s = s.replace(/\b\d+\s*kbps\b/gi, ' ');
  // Leading track numbers ("01 - ", "1-02 ", "07. ") when a name follows.
  s = s.replace(/^\s*(?:\d{1,2}-)?\d{1,3}(?:\s*[-.)]\s*|\s+)(?=\D)/, '');
  return s
    .replace(/\s+[-–—|]+\s+|\s+[-–—]|[-–—]\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lowercase letters and digits only, accents removed. */
function squash(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

function coreTitle(title: string): string {
  return title.replace(/\s*[([].*?[)\]]/g, '').replace(/\s+(feat|ft)\.?\s.*$/i, '');
}

function primaryArtist(artist: string): string {
  return artist.split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b|\bwith\b|\band\b)\s*/i)[0]!.replace(/^the\s+/i, '');
}

/** Whether a file name mentions both the song's title and its (first) artist. */
export function matchesFileName(song: Pick<SongInfo, 'title' | 'artist'>, fileName: string): boolean {
  const file = squash(guessFromFileName(fileName));
  const title = squash(coreTitle(song.title)) || squash(song.title);
  const artist = squash(primaryArtist(song.artist)) || squash(song.artist);
  return title.length > 0 && artist.length > 0 && file.includes(title) && file.includes(artist);
}

/** The result that matches a dropped file's name, preferring the closest length. */
export function bestMatch<T extends SongInfo>(results: readonly T[], fileName: string, fileMs?: number): T | undefined {
  const matches = results.filter((r) => matchesFileName(r, fileName));
  if (fileMs === undefined) return matches[0];
  const off = (r: T) => (r.durationMs ? Math.abs(r.durationMs - fileMs) : Infinity);
  return matches.reduce<T | undefined>((best, r) => (!best || off(r) < off(best) ? r : best), undefined);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function text(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Only http(s) links, so a bad response can't inject javascript: URLs into hrefs. */
function httpUrl(v: unknown): string | undefined {
  const s = text(v);
  return s && /^https?:\/\//i.test(s) ? s : undefined;
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}
