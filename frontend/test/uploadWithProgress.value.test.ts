/**
 * [FEAT-20260904-UPLOADPROGRESS] The upload transport: progress, cancel, errors.
 * ===========================================================================
 * Driven against a fake `XMLHttpRequest`, because the three things that matter
 * here are all timing and none of them can be observed from a screenshot:
 * a percentage that must never be invented, a cancel that must be tellable from
 * a failure, and an error shape that must match every other API call.
 *
 * ⚠️ WHAT THE FAKE MUST GET RIGHT. `upload.onprogress` and `onload` are separate
 * objects on a real XHR — progress hangs off `xhr.upload`, completion off `xhr`.
 * A fake that flattens them passes tests the real browser fails.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  isUploadAbort,
  uploadWithProgress,
  type UploadProgress,
} from '../services/uploadWithProgress';

class FakeXHR {
  static last: FakeXHR | null = null;

  upload: { onprogress?: (e: ProgressEvent) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  ontimeout?: () => void;
  onabort?: () => void;
  status = 200;
  statusText = 'OK';
  responseText = '{}';
  withCredentials = false;
  headers: Record<string, string> = {};
  opened: [string, string] | null = null;
  sent: unknown = null;
  aborted = false;

  constructor() {
    FakeXHR.last = this;
  }

  open(method: string, url: string): void {
    this.opened = [method, url];
  }

  setRequestHeader(key: string, value: string): void {
    this.headers[key] = value;
  }

  send(body: unknown): void {
    this.sent = body;
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }

  /** Drive one progress tick the way a browser would. */
  emitProgress(loaded: number, total: number, lengthComputable = true): void {
    this.upload.onprogress?.({
      loaded,
      total,
      lengthComputable,
    } as ProgressEvent);
  }

  /** Finish the request with a status and a body. */
  finish(status: number, body: string): void {
    this.status = status;
    this.responseText = body;
    this.onload?.();
  }
}

const install = (): void => {
  vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
};

afterEach(() => {
  vi.unstubAllGlobals();
  FakeXHR.last = null;
});

const start = <T,>(onProgress?: (p: UploadProgress) => void) => {
  install();
  const handle = uploadWithProgress<T>('/api/x', new FormData(), {
    onProgress,
    actionLabel: 'upload a file',
  });
  return { handle, xhr: FakeXHR.last as FakeXHR };
};

describe('[UPLOADPROGRESS] the request itself', () => {
  it('posts to the url with the cookie credential and no hand-set Content-Type', () => {
    /* 🔴 Setting Content-Type by hand drops the multipart boundary and the
       server cannot parse the body — a failure that looks like "the file is
       broken". And the auth cookie is HttpOnly, so `withCredentials` IS the
       credential; forgetting it is a 401 on a request that looks correct. */
    const { xhr } = start();
    expect(xhr.opened).toEqual(['POST', '/api/x']);
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.headers['Content-Type']).toBeUndefined();
    expect(xhr.headers['Accept']).toBe('application/json');
  });

  it('resolves with the parsed body on 2xx', async () => {
    const { handle, xhr } = start<{ id: string }>();
    xhr.finish(201, '{"id":"st-9"}');
    await expect(handle.promise).resolves.toEqual({ id: 'st-9' });
  });

  it('a 2xx with a non-JSON body still resolves, like handleApiResponse', async () => {
    const { handle, xhr } = start();
    xhr.finish(200, 'OK');
    await expect(handle.promise).resolves.toEqual({});
  });
});

describe('[UPLOADPROGRESS] progress', () => {
  it('🔴 reports whole percents from the bytes actually sent', async () => {
    const seen: UploadProgress[] = [];
    const { handle, xhr } = start((p) => seen.push(p));
    xhr.emitProgress(25, 100);
    xhr.emitProgress(100, 100);
    xhr.finish(200, '{}');
    await handle.promise;
    expect(seen.map((p) => p.percent)).toEqual([25, 100]);
  });

  it('🔴 an unknown total reports 0%, never a made-up number', async () => {
    /* 🔴 MUTATION KILLER. `lengthComputable === false` means the browser does
       not know the size. Dividing by `event.total` there yields NaN or Infinity,
       and a bar at "NaN%" is worse than an indeterminate one. */
    const seen: UploadProgress[] = [];
    const { handle, xhr } = start((p) => seen.push(p));
    /* ⚠️ A NON-ZERO total WITH `lengthComputable: false` is the input that
       separates the two rules. An earlier version of this case passed 0 as the
       total, so reading `event.total` directly gave the same answer and the
       mutation survived — the case proved nothing about the flag.
       Pick the input where the two rules give different answers. */
    xhr.emitProgress(1024, 4096, false);
    xhr.finish(200, '{}');
    await handle.promise;
    expect(seen[0]).toEqual({ loaded: 1024, total: 0, percent: 0 });
  });

  it('never reports after the request has settled', async () => {
    /* A late tick would move a bar that belongs to a finished upload — or to the
       NEXT one, if the caller reuses the same state. */
    const seen: UploadProgress[] = [];
    const { handle, xhr } = start((p) => seen.push(p));
    xhr.finish(200, '{}');
    await handle.promise;
    xhr.emitProgress(50, 100);
    expect(seen).toHaveLength(0);
  });
});

describe('[UPLOADPROGRESS] cancel', () => {
  it('🔴 rejects with an AbortError, which is tellable from a real failure', async () => {
    /* 🔴 The caller must stay SILENT when the admin cancelled and shout when the
       upload broke. Both arrive as a rejected promise, so the only thing that
       separates them is this name. */
    const { handle, xhr } = start();
    handle.cancel();
    await expect(handle.promise).rejects.toSatisfy(isUploadAbort);
    expect(xhr.aborted).toBe(true);
  });

  it('cancelling after the upload finished does nothing', async () => {
    const { handle, xhr } = start();
    xhr.finish(200, '{"id":"a"}');
    await expect(handle.promise).resolves.toEqual({ id: 'a' });
    handle.cancel();
    expect(xhr.aborted).toBe(false);
  });

  it('a server failure is NOT an abort', async () => {
    const { handle, xhr } = start();
    xhr.finish(400, '{"error":"Unsupported video type: .mov. Allowed: .mp4"}');
    await expect(handle.promise).rejects.toSatisfy(
      (e: unknown) => !isUploadAbort(e),
    );
  });
});

describe('[UPLOADPROGRESS] errors carry what the API sent', () => {
  it('🔴 a 400 keeps the server message and the status', async () => {
    /* 🔴 This is what makes the 400 work worth anything on this leg: the
       sentence the server wrote — "Allowed: .mp4" — has to reach the admin. A
       transport that swallowed it into "upload failed" would undo that. */
    const { handle, xhr } = start();
    xhr.finish(400, '{"error":"Unsupported video type: .mov. Allowed: .mp4"}');
    await expect(handle.promise).rejects.toThrow(
      'Unsupported video type: .mov. Allowed: .mp4',
    );
    await handle.promise.catch((e: { status?: number }) => {
      expect(e.status).toBe(400);
    });
  });

  it('a network failure rejects with the action label, not a blank message', async () => {
    const { handle, xhr } = start();
    xhr.status = 0;
    xhr.onerror?.();
    await expect(handle.promise).rejects.toThrow(/upload a file/);
  });
});
