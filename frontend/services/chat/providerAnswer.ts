/**
 * [FEAT-20261015-MEMBERDETAIL] One cached read of a "what does this site's customer provider
 * say" route (`/api/customer-provider/*`) — the caching rule written ONCE for every screen
 * rule (ticket categories, the hand-typed customer card, and whatever comes next).
 *
 * The provider is fixed for the life of the back end, so a real answer — including shop-api's
 * `null` ("declares nothing") — is kept for the life of the page. A failure (5xx, network,
 * 404 from an older back end) is NOT remembered: the caller falls back to its own path now
 * and the next ask tries again.
 *
 * `pick` turns the response's `data` into the value, or null when it is absent/malformed.
 */
import { API_BASE_URL, authFetch } from '../apiClient';

export interface ProviderAnswer<T> {
  get(): Promise<T | null>;
  /** forget the answer (test seam) */
  reset(): void;
}

export function providerAnswer<T>(
  path: string,
  pick: (data: unknown) => T | null,
): ProviderAnswer<T> {
  let cached: Promise<T | null> | null = null;
  return {
    get() {
      if (!cached) {
        cached = authFetch(`${API_BASE_URL}${path}`)
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
          })
          .then((json) => pick(json?.data))
          .catch(() => {
            cached = null;
            return null;
          });
      }
      return cached;
    },
    reset() {
      cached = null;
    },
  };
}
