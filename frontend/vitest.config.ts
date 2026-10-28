import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  // cast: vite6 plugin type vs vitest2's bundled vite types differ — harmless, keeps `tsc` clean
  plugins: [react() as any],
  // [FEAT-20260808-WSTEST] TEST-ONLY: provide the WS env the live-chat transport reads at module load
  // (`services/chat/useTicketWS.ts` captures import.meta.env.VITE_WS_URL/VITE_WS_ENV as consts). vitest
  // snapshots import.meta.env per imported module and `.env.*` is gitignored, so this `define` is the only
  // CI-reliable way to let the WS characterization suite drive a real connect. Affects the test build only
  // (vitest.config, NOT vite.config) → zero product/runtime impact. revert: delete this `define` block.
  define: {
    'import.meta.env.VITE_WS_URL': JSON.stringify('wss://ws.test.local/live'),
    'import.meta.env.VITE_WS_ENV': JSON.stringify('test'),
    // the API base the services read at module load; a checkout has no .env in tests
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(process.env.VITE_API_BASE_URL ?? 'http://localhost:8088'),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    /* [FIX-20260830-VITESTWTSCAN] a git WORKTREE checked out under
       `.worktrees/<lane>/` is a full second copy of this repo, tests
       included, so a bare `vitest run` collected every spec twice — 951 files
       instead of 267, most of them failing to resolve. Build outputs kept
       under other names (`dist.bak-*`) are the same trap. Vitest's default
       exclude only covers node_modules/dist/.git, so it is restated here with
       the two extra patterns; dropping either one brings the duplicates back.
       revert: delete this `exclude` array. */
    exclude: [
      '**/node_modules/**',
      '**/dist*/**',
      '**/.git/**',
      '**/.worktrees/**',
    ],
    environmentOptions: { jsdom: { url: 'http://localhost/' } },
  },
});
