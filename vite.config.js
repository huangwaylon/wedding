import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves project sites from /<repo>/, so the bundle needs a base
// path matching the repository name. Override with VITE_BASE=/ for a custom
// domain, or with a different path if the repo is ever renamed.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/wedding/',
  plugins: [react()],
  /**
   * DEV ONLY — `server` is not read by `vite build`, so none of this ships.
   *
   * `scripts/stub-endpoint.mjs` serves the real `Code.gs` AND a Sheets API stand-in on
   * 127.0.0.1:5200, and the app's CSP allows `connect-src 'self'` plus Google and nothing else.
   * Proxying both onto this origin is what lets `scripts/drive.mjs` exercise the true write path —
   * the alternative was widening a production CSP to reach a test double, which is not a trade
   * worth making.
   *
   * TWO ROUTES, because the app has two backends now: `/exec` for the anonymous read and the
   * mint, and the Sheets API for everything an editor does.
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
     * Both are captured at MODULE LOAD — `config.js` reads `VITE_SCRIPT_URL` and `sheets.js` reads
     * `VITE_SHEETS_BASE` — so a test cannot stub either after importing. Pinning them here is what
     * lets `test/api.test.js` exercise the configured path rather than the "no endpoint" branch.
     *
     * IT ALSO FENCES THE SUITE OFF FROM `.env.local`. Vitest loads that file, so a developer with
     * the dev stub configured had `sheets.js` pointed at `/wedding/__sheets` inside the tests —
     * which failed 37 of them at once, and would have been far more confusing had the fake happened
     * to answer that path.
     */
    env: {
      VITE_SCRIPT_URL: 'https://script.google.com/macros/s/test/exec',
      VITE_SHEETS_BASE: 'https://sheets.googleapis.com/v4/spreadsheets',
    },
  },
})
