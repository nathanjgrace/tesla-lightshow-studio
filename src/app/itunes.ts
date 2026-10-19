import { parseItunesResults, searchUrl, type SongResult } from '../core/songSearch';
import { jsonp } from './jsonp';

// Set after the first CORS or network failure, so later searches go straight to JSONP.
let useJsonp = false;

/** Searches Apple's catalog: fetch first, JSONP when the browser blocks the cross-origin request. */
export async function searchSongs(term: string, { signal, limit = 8 }: { signal?: AbortSignal; limit?: number } = {}): Promise<SongResult[]> {
  if (!useJsonp) {
    try {
      const response = await fetch(searchUrl(term, { limit }), { signal });
      if (!response.ok) throw new Error(`Apple Music search failed (${response.status})`);
      return parseItunesResults(await response.json());
    } catch (e) {
      // fetch reports CORS and network failures as TypeError; aborts and HTTP errors pass through.
      if (!(e instanceof TypeError)) throw e;
      useJsonp = true;
    }
  }
  return parseItunesResults(await jsonp((callback) => searchUrl(term, { limit, callback }), { signal }));
}
