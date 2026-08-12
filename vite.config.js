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
   * `scripts/stub-endpoint.mjs` serves the real `Code.gs` on 127.0.0.1:5200, and the app's CSP
   * allows `connect-src 'self'` plus Google and nothing else. Proxying the stub onto this origin
   * is what lets `scripts/drive.mjs` exercise the true write path — the alternative was widening
   * a production CSP to reach a test double, which is not a trade worth making.
   *
   *   VITE_SCRIPT_URL=/wedding/__endpoint
   */
  server: {
    proxy: {
      '/wedding/__endpoint': {
        target: 'http://127.0.0.1:5200',
        changeOrigin: true,
        // The read's cache-buster rides in the query string, so it has to survive the rewrite.
        rewrite: (path) => path.replace('/wedding/__endpoint', '/'),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.{js,jsx}'],
    // `config.js` captures VITE_SCRIPT_URL at module load, so a test cannot stub it
    // after importing. Supplying it here is what lets test/api.test.js exercise the
    // configured path rather than only the "no endpoint" branch.
    env: {
      VITE_SCRIPT_URL: 'https://script.google.com/macros/s/test/exec',
    },
  },
})
