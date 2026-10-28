/**
 * [FEAT-20261027-TANSTACK] The app's single QueryClient.
 *
 * Every query/mutation hook in `services/<module>/queries/` passes THIS client
 * explicitly (see `useAppQuery.ts`), so a component works with or without a
 * `QueryClientProvider` above it — which keeps the ~120 existing component
 * tests rendering pages bare, exactly as they do today. The provider in
 * `index.tsx` hands the same instance to anything that calls `useQueryClient()`.
 * Tests isolate it with `queryClient.clear()` after each case (`test/setup.ts`).
 * revert: delete this file with the rest of services/query/.
 */
import { QueryClient } from '@tanstack/react-query';
import { QUERY_DEFAULTS } from './queryPolicy';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: QUERY_DEFAULTS.staleTimeMs,
      gcTime: QUERY_DEFAULTS.gcTimeMs,
      retry: QUERY_DEFAULTS.retry,
      refetchOnWindowFocus: QUERY_DEFAULTS.refetchOnWindowFocus,
      refetchOnReconnect: QUERY_DEFAULTS.refetchOnReconnect,
    },
    mutations: { retry: QUERY_DEFAULTS.retry },
  },
});

/* The focus / online listeners (what makes `refetchOnWindowFocus` work) are wired by
   `QueryClient.mount()`, which normally only QueryClientProvider calls. Hooks here pass
   this client WITHOUT a provider (see the header), so mount it once at creation —
   mount() is ref-counted, so the provider in index.tsx mounting it again is harmless.
   Without this line a screen rendered bare would never refetch on returning to the tab
   (caught by test/requests/adminPollers.requests.test.tsx). */
queryClient.mount();
