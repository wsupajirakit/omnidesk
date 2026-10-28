/**
 * [FIX-20260829-APISTORM] — the breaker that stops the app hammering a dead API.
 *
 * The bug it exists for: with the backend unreachable every poll, every socket
 * fallback and every modal loader kept opening new connections, and the tab
 * locked the machine up. These tests pin the two halves that make the fix safe:
 * it opens on a real outage, and it NEVER opens on anything that is not one.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  COOLDOWN_MS,
  OUTAGE_THRESHOLD,
  CIRCUIT_OPEN_MESSAGE,
  buildCircuitOpenError,
  getApiCircuitState,
  isAbortError,
  isApiCircuitOpen,
  recordApiNetworkFailure,
  recordApiSuccess,
  resetApiCircuit,
} from '../services/apiCircuitBreaker';

const T0 = 1_700_000_000_000;

beforeEach(() => resetApiCircuit());

describe('closed while the API is healthy', () => {
  it('starts closed', () => {
    expect(isApiCircuitOpen(T0)).toBe(false);
  });

  // MUTATION NOTE: written with hardcoded counts on purpose. An earlier version
  // looped to `OUTAGE_THRESHOLD`, so lowering the constant to 1 moved the test
  // with the code and the mutation stayed green. The literal is the pin.
  it('the threshold is 3 — a lower one would fire the breaker on a blip', () => {
    expect(OUTAGE_THRESHOLD).toBe(3);
  });

  it('ONE network failure does not open it', () => {
    recordApiNetworkFailure(T0);
    expect(isApiCircuitOpen(T0)).toBe(false);
  });

  it('TWO network failures do not open it', () => {
    recordApiNetworkFailure(T0);
    recordApiNetworkFailure(T0);
    expect(isApiCircuitOpen(T0)).toBe(false);
  });

  it('a success between failures resets the count, so a flaky link never opens it', () => {
    for (let i = 0; i < 50; i += 1) {
      recordApiNetworkFailure(T0);
      recordApiSuccess();
    }
    expect(isApiCircuitOpen(T0)).toBe(false);
    expect(getApiCircuitState().consecutiveFailures).toBe(0);
  });
});

describe('opens on a real outage', () => {
  it('the THIRD consecutive network failure opens it', () => {
    recordApiNetworkFailure(T0);
    recordApiNetworkFailure(T0);
    expect(isApiCircuitOpen(T0)).toBe(false);
    recordApiNetworkFailure(T0);
    expect(isApiCircuitOpen(T0)).toBe(true);
  });

  it('refuses every request for the whole cooldown', () => {
    for (let i = 0; i < OUTAGE_THRESHOLD; i += 1) recordApiNetworkFailure(T0);
    expect(isApiCircuitOpen(T0 + 1)).toBe(true);
    expect(isApiCircuitOpen(T0 + COOLDOWN_MS - 1)).toBe(true);
  });

  it('a burst of 500 callers costs ONE probe, not 500 connections', () => {
    for (let i = 0; i < OUTAGE_THRESHOLD; i += 1) recordApiNetworkFailure(T0);
    const now = T0 + COOLDOWN_MS;
    let allowed = 0;
    for (let i = 0; i < 500; i += 1) if (!isApiCircuitOpen(now)) allowed += 1;
    expect(allowed).toBe(1);
  });
});

describe('recovers on its own', () => {
  const open = () => {
    for (let i = 0; i < OUTAGE_THRESHOLD; i += 1) recordApiNetworkFailure(T0);
  };

  it('lets one probe through once the cooldown elapses', () => {
    open();
    expect(isApiCircuitOpen(T0 + COOLDOWN_MS)).toBe(false);
  });

  it('closes fully when the probe succeeds', () => {
    open();
    isApiCircuitOpen(T0 + COOLDOWN_MS); // probe leaves
    recordApiSuccess();
    expect(isApiCircuitOpen(T0 + COOLDOWN_MS)).toBe(false);
    expect(getApiCircuitState().blockedUntil).toBe(0);
  });

  it('starts a fresh cooldown when the probe fails', () => {
    open();
    const probeAt = T0 + COOLDOWN_MS;
    isApiCircuitOpen(probeAt);
    recordApiNetworkFailure(probeAt);
    expect(isApiCircuitOpen(probeAt + 1)).toBe(true);
    expect(isApiCircuitOpen(probeAt + COOLDOWN_MS)).toBe(false);
  });

  it('a long outage never fires more than one request per cooldown', () => {
    open();
    let sent = 0;
    // ten cooldowns of a caller retrying every 100ms
    for (let t = T0; t <= T0 + COOLDOWN_MS * 10; t += 100) {
      if (!isApiCircuitOpen(t)) {
        sent += 1;
        recordApiNetworkFailure(t);
      }
    }
    expect(sent).toBeLessThanOrEqual(11);
  });
});

describe('what must NOT trip it', () => {
  it('an abort is the caller cancelling, not an outage', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(isAbortError(abort)).toBe(true);
  });

  it('a plain network error is not an abort', () => {
    expect(isAbortError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });
});

describe('the rejection handed to callers', () => {
  it('is a real Error with a recognisable flag', () => {
    const err = buildCircuitOpenError();
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(CIRCUIT_OPEN_MESSAGE);
    expect((err as Error & { isCircuitOpen?: boolean }).isCircuitOpen).toBe(true);
  });
});

describe('authFetch integration — the contract every service depends on', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiCircuit();
  });

  const loadAuthFetch = async () => (await import('../services/apiClient')).authFetch;

  it('an HTTP 500 counts as ALIVE — one bad response must not take the app offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    const authFetch = await loadAuthFetch();
    for (let i = 0; i < OUTAGE_THRESHOLD + 5; i += 1) {
      const res = await authFetch('/api/anything');
      expect(res.status).toBe(500);
    }
    expect(isApiCircuitOpen()).toBe(false);
  });

  // MUTATION NOTE: the test above cannot catch a deleted recordApiSuccess(),
  // because with no prior failures there is nothing to reset. This one starts
  // the count, lets ONE answered request through, and proves the count went
  // back to zero — the network drop before and after must not add up.
  it('a reachable server clears the failure count that came before it', async () => {
    const responses: Array<'boom' | 'answered'> = [
      'boom', 'boom', 'answered', 'boom', 'boom',
    ];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const kind = responses[call];
        call += 1;
        if (kind === 'boom') throw new TypeError('Failed to fetch');
        return new Response('{}', { status: 503 });
      }),
    );
    const authFetch = await loadAuthFetch();
    for (let i = 0; i < responses.length; i += 1) {
      await authFetch('/api/anything').catch(() => undefined);
    }
    expect(call).toBe(responses.length); // nothing was refused along the way
    expect(isApiCircuitOpen()).toBe(false);
    expect(getApiCircuitState().consecutiveFailures).toBe(2);
  });

  it('stops calling fetch once the API is unreachable', async () => {
    const spy = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', spy);
    const authFetch = await loadAuthFetch();
    for (let i = 0; i < 40; i += 1) {
      await authFetch('/api/anything').catch(() => undefined);
    }
    expect(spy.mock.calls.length).toBeLessThanOrEqual(OUTAGE_THRESHOLD);
  });

  it('an aborted request never counts toward the outage', async () => {
    const spy = vi.fn(async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    });
    vi.stubGlobal('fetch', spy);
    const authFetch = await loadAuthFetch();
    for (let i = 0; i < 40; i += 1) {
      await authFetch('/api/anything').catch(() => undefined);
    }
    expect(spy.mock.calls.length).toBe(40);
    expect(isApiCircuitOpen()).toBe(false);
  });
});
