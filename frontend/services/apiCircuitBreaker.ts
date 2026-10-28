/**
 * ==== [FIX-20260829-APISTORM] stop the front-end from hammering a dead API ====
 *
 * WHAT: a circuit breaker shared by every REST call (all of them go through
 * `authFetch` in ./apiClient.ts). After a few CONSECUTIVE network failures it
 * refuses new requests for a cooldown window and rejects them immediately,
 * instead of letting every poll and every per-component retry open another
 * doomed connection.
 *
 * WHY: with the backend unreachable, nothing in the app limited the retry rate.
 * Polls (SystemConfig 20s, Users, Groups, WebhookList, Dashboard, ...), socket
 * fallbacks (services/chat/usePartialTicketFetch.ts refetches the WHOLE list on
 * every failure path) and modal loaders that only latch on SUCCESS
 * (components/hook/HookFormModal.tsx:1108 — `.then` sets `groupsLoaded`, `.catch`
 * sets nothing, so the guard reopens on every failure) all pile up. The browser
 * queues each dead connection and the tab locks the machine up.
 *
 * ⚠️ NETWORK FAILURES ONLY. An HTTP 4xx/5xx means the server ANSWERED — that is
 * not an outage and must never trip the breaker, or one unlucky 500 would take
 * the whole app offline. An aborted request (AbortController, used all over the
 * chat pages) is a caller decision, not a failure, and is likewise ignored.
 *
 * HOW IT RECOVERS: after the cooldown one probe request is let through
 * (half-open). It succeeding closes the breaker; it failing starts a new
 * cooldown. So the app comes back on its own the moment the API returns, with
 * at most one wasted request per cooldown window.
 *
 * revert: delete this file and drop the three call sites in ./apiClient.ts
 * (`isApiCircuitOpen`, `recordApiNetworkFailure`, `recordApiSuccess`).
 */

/** Consecutive network failures before the breaker opens. */
export const OUTAGE_THRESHOLD = 3;

/** How long the breaker stays open before letting one probe through. */
export const COOLDOWN_MS = 5000;

/** Message carried by the synthetic rejection, so callers can recognise it. */
export const CIRCUIT_OPEN_MESSAGE = 'API unreachable — requests paused';

type CircuitState = {
  /** Consecutive network failures observed so far. */
  consecutiveFailures: number;
  /** Epoch ms until which new requests are refused; 0 = breaker closed. */
  blockedUntil: number;
  /** True while the single half-open probe is in flight. */
  probeInFlight: boolean;
};

const state: CircuitState = {
  consecutiveFailures: 0,
  blockedUntil: 0,
  probeInFlight: false,
};

/** Test seam — every spec that exercises a failing fetch must start clean. */
export const resetApiCircuit = (): void => {
  state.consecutiveFailures = 0;
  state.blockedUntil = 0;
  state.probeInFlight = false;
};

/** Read-only snapshot, for tests and for any UI that wants to show "offline". */
export const getApiCircuitState = (): Readonly<CircuitState> => ({ ...state });

/**
 * True when this request must be refused without touching the network.
 *
 * Once the cooldown has elapsed the FIRST caller is allowed through as a probe
 * and the rest keep being refused until that probe reports back — otherwise a
 * page with ten pending loaders would send ten probes at once and we would be
 * back to a burst.
 */
export const isApiCircuitOpen = (now: number = Date.now()): boolean => {
  if (state.blockedUntil === 0) return false;
  if (now < state.blockedUntil) return true;
  if (state.probeInFlight) return true;
  state.probeInFlight = true;
  return false;
};

/**
 * A request reached the server (any status) — the API is alive, so clear
 * everything. Called for HTTP errors too, on purpose: a 500 is a live server.
 */
export const recordApiSuccess = (): void => {
  resetApiCircuit();
};

/**
 * `fetch` itself rejected: connection refused, DNS, offline, CORS failure.
 * Opens the breaker once the threshold is reached, and restarts the cooldown
 * when a half-open probe fails.
 */
export const recordApiNetworkFailure = (now: number = Date.now()): void => {
  state.consecutiveFailures += 1;
  state.probeInFlight = false;
  if (state.consecutiveFailures >= OUTAGE_THRESHOLD) {
    state.blockedUntil = now + COOLDOWN_MS;
  }
};

/** The rejection handed to callers while the breaker is open. */
export const buildCircuitOpenError = (): Error => {
  const error = new Error(CIRCUIT_OPEN_MESSAGE);
  (error as Error & { isCircuitOpen?: boolean }).isCircuitOpen = true;
  return error;
};

/**
 * An abort is the caller cancelling on purpose (route change, new search
 * keystroke). It says nothing about the server, so it must not count.
 */
export const isAbortError = (error: unknown): boolean =>
  Boolean(error) && (error as { name?: string }).name === 'AbortError';
