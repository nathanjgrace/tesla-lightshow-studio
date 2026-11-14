// Autosave: the open show (effects, export range, song and its audio) is kept
// in this browser's IndexedDB, so a refresh or a closed tab doesn't lose work.
// One slot: opening another show replaces it.

import type { SongInfo } from '../core/songSearch';
import type { Project } from '../core/project';

export interface SavedSession {
  title: string;
  source: { kind: 'library'; id: string } | { kind: 'file'; name: string } | { kind: 'new'; name: string };
  song?: SongInfo;
  audio?: Blob;
  project: Project;
  range: { startMs: number; endMs: number };
  savedAt: number;
}

const DB = 'lightshow-studio';
const STORE = 'session';
const KEY = 'current';

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error('IndexedDB is unavailable'));
  });
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(STORE, mode);
        const request = fn(tx.objectStore(STORE));
        tx.oncomplete = () => {
          d.close();
          resolve(request.result);
        };
        tx.onerror = tx.onabort = () => {
          d.close();
          reject(tx.error ?? new Error('Could not save'));
        };
      }),
  );
}

export const saveSession = (session: SavedSession): Promise<unknown> => run('readwrite', (s) => s.put(session, KEY));

/** The saved show, or undefined when there is none (or storage is unavailable, as in some private windows). */
export async function loadSession(): Promise<SavedSession | undefined> {
  try {
    const value = await run<SavedSession | undefined>('readonly', (s) => s.get(KEY) as IDBRequest<SavedSession | undefined>);
    return value?.project?.effects && value.project.base instanceof Uint8Array ? value : undefined;
  } catch {
    return undefined;
  }
}
