import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves project sites from /<repo>/, so the bundle needs a base
// path matching the repository name. Override with VITE_BASE=/ for a custom
// domain, or with a different path if the repo is ever renamed.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/wedding/',
  plugins: [react()],
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
