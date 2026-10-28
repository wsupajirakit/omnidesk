/**
 * [FEAT-20261027-TANSTACK] Request recorder for the request-count suites.
 *
 * Replaces ONLY the network edge (`globalThis.fetch`): every real service runs
 * as in production and every request it makes is recorded as `METHOD /path`
 * (ObjectIds folded to `:id`, query string kept separately). Responses come from
 * a small route table; anything unrouted gets an empty success body.
 *
 * Used by `test/requests/*.requests.test.tsx` to pin how many requests each
 * user action costs, before and after a screen moves to TanStack Query.
 */
import { act } from '@testing-library/react';

type Body = unknown;
/** A responder may return a Promise to hold the response open (e.g. to observe a page mid-fetch). */
export type Route = [RegExp, (path: string, method: string) => Body | Promise<Body>];

class HttpError {
  constructor(readonly status: number, readonly body: unknown) {}
}
/** Responder helper: answer this request with a non-2xx status. */
export const httpError = (status: number, body: unknown = { success: false, message: 'boom' }) => new HttpError(status, body);

export interface RecordedRequest {
  method: string;
  path: string;
  query: string;
}

const OBJECT_ID = /[0-9a-f]{24}/g;

export function installFetchRecorder(routes: Route[] = []) {
  const log: RecordedRequest[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = String(typeof input === 'string' ? input : (input as Request).url ?? input);
    const rel = raw.replace(/^https?:\/\/[^/]+/, '');
    const [path, query = ''] = rel.split('?');
    const method = String(init?.method ?? 'GET').toUpperCase();
    log.push({ method, path: path.replace(OBJECT_ID, ':id'), query });
    const hit = routes.find(([rx]) => rx.test(path));
    const body = hit ? await hit[1](path, method) : { success: true, data: [] };
    // a responder returns httpError(status, body) to answer with a non-2xx status
    const status = body instanceof HttpError ? body.status : 200;
    const payload = body instanceof HttpError ? body.body : body;
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  return {
    log,
    mark: () => log.length,
    since: (mark: number) => log.slice(mark),
    /** `METHOD /path` → count, for readable assertions */
    tally: (mark = 0) =>
      log.slice(mark).reduce<Record<string, number>>((acc, r) => {
        const k = `${r.method} ${r.path}`;
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {}),
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/** Resolve once no new request has started for `quietMs` — a page "settled". */
export async function waitForQuiet(rec: { mark: () => number }, quietMs = 400, maxMs = 8000) {
  const start = Date.now();
  let last = rec.mark();
  let lastChange = Date.now();
  while (Date.now() - start < maxMs) {
    await act(() => new Promise((r) => setTimeout(r, 50)));
    const now = rec.mark();
    if (now !== last) { last = now; lastChange = Date.now(); }
    else if (Date.now() - lastChange >= quietMs) return;
  }
  throw new Error(`requests never settled within ${maxMs}ms`);
}

/** Flip `document.visibilityState` the way a real tab switch does. */
export function setTabHidden(hidden: boolean) {
  Object.defineProperty(document, 'visibilityState', { value: hidden ? 'hidden' : 'visible', configurable: true });
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
  // bubbles like the real event, so listeners on `window` (TanStack's focusManager) hear it too
  document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
}
