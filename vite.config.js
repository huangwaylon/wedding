import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves project sites from /<repo>/, so the bundle's base path must match the
// repository name. Override with VITE_BASE=/ for a custom domain, or with another path if the
// repo is renamed.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/wedding/',
  plugins: [react()],
  /**
   * Dev only: `server` is not read by `vite build`, so none of this ships.
   *
   * `scripts/stub-endpoint.mjs` serves the real `Code.gs` and a Sheets API stand-in on
   * 127.0.0.1:5200. The CSP allows `connect-src 'self'` plus Google and nothing else, so
   * proxying both onto this origin is what lets `scripts/drive.mjs` exercise the true write path
   * without widening a production CSP to reach a test double. Two routes, because the app has two
   * backends: `/exec` for the anonymous read and the mint, the Sheets API for an editor's work.
   *
   *   VITE_SCRIPT_URL=/wedding/__endpoint
   *   VITE_SHEETS_BASE=/wedding/__sheets
   */
  server: {
    proxy: {
      '/wedding/__endpoint': {
        target: 'http://127.0.0.1:5200',
        changeOrigin: true,
        // The read's cache-buster rides in the query string, so it has to survive the rewrite.
        rewrite: (path) => path.replace('/wedding/__endpoint', '/'),
      },
      '/wedding/__sheets': {
        target: 'http://127.0.0.1:5200',
        changeOrigin: true,
        rewrite: (path) => path.replace('/wedding/__sheets', '/v4/spreadsheets'),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.{js,jsx}'],
    /**
     * Both are captured at module load — `config.js` reads `VITE_SCRIPT_URL`, `sheets.js` reads
     * `VITE_SHEETS_BASE` — so a test cannot stub either after importing. Pinning them here lets
     * `test/api.test.js` exercise the configured path rather than the "no endpoint" branch, and
     * fences the suite off from `.env.local`, which vitest loads: a developer running the dev stub
     * would otherwise have `sheets.js` pointed at `/wedding/__sheets` inside the tests.
     * `VITE_SHEETS_BASE` is the only reason `sheets.js`'s base URL is overridable and must never
     * be set in a shipped build.
     */
    env: {
      VITE_SCRIPT_URL: 'https://script.google.com/macros/s/test/exec',
      VITE_SHEETS_BASE: 'https://sheets.googleapis.com/v4/spreadsheets',
    },
  },
})
