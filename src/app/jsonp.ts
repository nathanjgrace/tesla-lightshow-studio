// JSONP: loads a URL as a <script> that calls a global callback with the data.
// Used when a JSON API (like iTunes Search) doesn't send CORS headers.

let sequence = 0;

export interface JsonpOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Calls makeUrl with a unique callback name and resolves with what the script passes to it. */
export function jsonp<T = unknown>(makeUrl: (callback: string) => string, { timeoutMs = 8000, signal }: JsonpOptions = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const name = `__jsonp_${Date.now().toString(36)}_${++sequence}`;
    const globals = window as unknown as Record<string, unknown>;
    const script = document.createElement('script');

    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      script.remove();
      // A removed script can still run if it was already downloading, so leave a no-op for a while.
      globals[name] = () => {};
      setTimeout(() => delete globals[name], 60_000);
    };
    const onAbort = () => {
      finish();
      reject(signal!.reason);
    };
    globals[name] = (data: T) => {
      finish();
      resolve(data);
    };
    script.onerror = () => {
      finish();
      reject(new Error('The request failed'));
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error('The request timed out'));
    }, timeoutMs);
    signal?.addEventListener('abort', onAbort);
    script.async = true;
    script.src = makeUrl(name);
    document.head.appendChild(script);
  });
}
