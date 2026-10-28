import { ApiError } from '../types';
// [FEAT-20260808-HTTPONLY-FE] (a) WHAT: import getStoredAuth (presence of a
// session) instead of getAuthToken (a JS-readable JWT, now gone). (b) WHY: the
// 401 auto-logout signal used to key on "we hold a token"; there is no token
// anymore, so it keys on "we have an active session" instead. (c) REVERT:
// `import { getAuthToken } from './authStorage';` and use getAuthToken() below.
import { getStoredAuth } from './authStorage';
// [FIX-20260829-APISTORM] breaker helpers — see ./apiCircuitBreaker.ts
import {
  buildCircuitOpenError,
  isAbortError,
  isApiCircuitOpen,
  recordApiNetworkFailure,
  recordApiSuccess,
} from './apiCircuitBreaker';

const resolvedApiBaseUrl = (import.meta as any).env?.VITE_API_BASE_URL;
if (!resolvedApiBaseUrl) {
  throw new Error('Missing VITE_API_BASE_URL environment variable');
}
export const API_BASE_URL = resolvedApiBaseUrl;

const safeJsonParse = (text: string) => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * [FEAT-20260904-UPLOADPROGRESS] Exported so the XHR uploader raises the SAME
 * error shape as every fetch call — same message precedence, same `.status`,
 * same `.rawResponse`. A second copy of this rule would drift the moment one of
 * them learned about a new error envelope. Share the pipe, never copy the rule.
 *
 * ⚠️ It takes a `Response`, so the uploader hands it a minimal stand-in built
 * from the XHR (`status`, `statusText`) — the only two fields read here.
 */
export const buildApiError = (response: Response, rawResponse: string, actionLabel: string): ApiError => {
  const parsed = safeJsonParse(rawResponse);
  const fallback = `Failed to ${actionLabel} (HTTP ${response.status} ${response.statusText})`;
  const candidate =
    parsed?.message ||
    parsed?.error?.message ||
    parsed?.error ||
    (typeof parsed === 'string' ? parsed : undefined) ||
    rawResponse ||
    fallback;
  const error = new Error((candidate || fallback).trim() || fallback) as ApiError;
  error.rawResponse = rawResponse;
  (error as any).status = response.status;   // let callers branch on 409 etc.
  return error;
};

export const handleApiResponse = async <T>(response: Response, actionLabel: string): Promise<T> => {
  const rawResponse = await response.text();
  // [FEAT-20260808-HTTPONLY-FE] fire the auto-logout signal on a 401 while a
  // session exists. was: `getAuthToken()` (do we hold a token). revert: getAuthToken().
  if (response.status === 401 && typeof window !== 'undefined' && getStoredAuth()) {
    window.dispatchEvent(new CustomEvent('auth:invalid'));
  }
  if (!response.ok) {
    throw buildApiError(response, rawResponse, actionLabel);
  }
  const parsed = safeJsonParse(rawResponse);
  return (parsed ?? ({} as T)) as T;
};

const normalizeHeaders = (headers?: HeadersInit): Record<string, string> => {
  const normalized: Record<string, string> = {};
  if (!headers) return normalized;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      normalized[key] = value;
    });
  } else if (Array.isArray(headers)) {
    headers.forEach(([key, value]) => {
      normalized[key] = value;
    });
  } else {
    Object.assign(normalized, headers);
  }
  return normalized;
};

export const getAuthHeaders = (headers?: HeadersInit): HeadersInit => {
  const built = normalizeHeaders(headers);
  if (!built.Accept) {
    built.Accept = 'application/json';
  }
  // [FEAT-20260808-HTTPONLY-FE] (a) WHAT: the `Authorization: Bearer <jwt>`
  // header is no longer attached. (b) WHY: auth now rides the HttpOnly cookie
  // sent by `credentials: 'include'` below; the JWT is JS-invisible so there is
  // nothing to put in a Bearer header. (c) REVERT: restore
  //   `const token = getAuthToken(); if (token) built.Authorization = `Bearer ${token}`;`
  // (and re-import getAuthToken).
  return built;
};

// [FEAT-20260808-HTTPONLY-FE] (a) WHAT: every request now sends credentials
// (`credentials: 'include'`) so the browser attaches the HttpOnly auth cookie.
// (b) WHY: the cookie is the sole REST credential post-migration (Bearer dropped
// above). (c) REVERT: remove `credentials: 'include'` from the fetch init.
// [FIX-20260829-APISTORM] (a) WHAT: every request now passes through the shared
// circuit breaker in ./apiCircuitBreaker.ts. While the API is unreachable the
// call is rejected without opening a connection. (b) WHY: nothing limited the
// retry rate before — polls, socket fallbacks and modal loaders that only latch
// on success all kept firing at a dead backend until the tab froze the machine.
// (c) NOTE: an HTTP 4xx/5xx counts as SUCCESS here — the server answered, so it
// is alive; only a rejected fetch (refused/DNS/offline) is an outage, and an
// AbortError is the caller cancelling and is ignored entirely.
// (d) REVERT: drop the three helper calls and return the bare fetch below.
export const authFetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  if (isApiCircuitOpen()) {
    throw buildCircuitOpenError();
  }
  const headers = getAuthHeaders(init.headers);
  try {
    const response = await fetch(input, { ...init, credentials: 'include', headers });
    recordApiSuccess();
    return response;
  } catch (error) {
    if (!isAbortError(error)) {
      recordApiNetworkFailure();
    }
    throw error;
  }
};
