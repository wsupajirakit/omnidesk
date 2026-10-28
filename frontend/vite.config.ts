import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// [FIX-20260729-TWBUILD] compiles Tailwind at build time (was cdn.tailwindcss.com)
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(() => {
    return {
      server: {
        port: 5173,
        host: '0.0.0.0',
        /* [LOCAL-TRAEFIK-20260813] The dev server rejects any Host header it does
         * not recognise (Vite's DNS-rebinding guard), so reaching it through a
         * local Traefik that mirrors the Coolify setup returns "Blocked request"
         * — a Vite 403, not the BE proxy-gate. Production is unaffected: there
         * the SPA is static files served by nginx from `dist`, and this dev
         * server never runs. เฉพาะ dev เท่านั้น ไม่กระทบ build.
         * revert: delete this key. */
        allowedHosts: ['console.omnidesk.test', 'api.omnidesk.test'],
      },
      plugins: [react(), tailwindcss()],
      // [REFACTOR-20260808-VENDORCHUNK] Split stable framework vendors into their own
      // long-term-cacheable chunk, and give lucide-react a single shared chunk so it is
      // no longer duplicated across the entry `index` chunk AND the lazy InsightReport
      // chunk. Config-only; no app code changes; the existing retryLazy handles
      // chunk-load failures. revert: delete this `build` block.
      //
      // [FEAT-20260811-VENDORCHARTS] `vendor-charts` — the earlier comment here
      // deliberately avoided a recharts chunk, fearing it would be pulled into the
      // eager graph. The fe_bundle_investigation (2026-08-10 §D2) DISPROVED that
      // fear by measurement: with this entry, `index` grows +38 bytes, dist/index.html
      // gains NO modulepreload of vendor-charts, and the chunk loads only with the
      // lazy InsightReport route. What it buys: the biggest chunk drops 444→~358 KB
      // and the recharts payload becomes cacheable ACROSS releases (it only changes
      // when the library version does, not when InsightReport.tsx is edited).
      // ตรวจแล้วไม่ดึงเข้า eager · ได้ cache ข้าม release · revert: ลบบรรทัด vendor-charts.
      build: {
        rollupOptions: {
          output: {
            manualChunks: {
              'vendor-react': ['react', 'react-dom', 'react-router-dom'],
              'vendor-icons': ['lucide-react'],
              'vendor-charts': ['recharts'],
            },
          },
        },
      },
      define: {
        'global': 'window',
        'process.env': {},
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
