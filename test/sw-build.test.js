/**
 * The generated service worker. This exists because its failure modes are silent: an
 * incomplete precache list makes `install` reject, so no worker ever activates and the
 * app is simply never fast — and nothing in a build or on screen says so.
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildFromDist, precachePaths } from '../scripts/build-sw.js'

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'wd-sw-'))
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}

const TREE = {
  'index.html': '<!doctype html>',
  'manifest.webmanifest': '{}',
  'assets/index-abc123.js': 'console.log(1)',
  'assets/index-abc123.css': 'body{}',
  'icons/icon-192.png': 'png',
}

describe('precachePaths', () => {
  it('walks the whole tree, including what Vite’s manifest omits', () => {
    // `.vite/manifest.json` maps index.html to its JS chunk and lists neither
    // index.html itself nor anything copied from public/. A manifest-derived list would
    // precache 2 of 5 files here and miss the one the guarantee is named after.
    const paths = precachePaths(fixture(TREE))
    expect(paths).toEqual([
      'assets/index-abc123.css',
      'assets/index-abc123.js',
      'icons/icon-192.png',
      'index.html',
      'manifest.webmanifest',
    ])
  })

  it('excludes the worker itself', () => {
    const paths = precachePaths(fixture({ ...TREE, 'sw.js': 'self' }))
    expect(paths).not.toContain('sw.js')
  })

  it('uses forward slashes on every platform', () => {
    for (const path of precachePaths(fixture(TREE))) {
      expect(path).not.toContain('\\')
    }
  })
})

describe('buildFromDist', () => {
  it('prefixes every asset with the base path', () => {
    const { source } = buildFromDist(fixture(TREE), '/wedding/')
    expect(source).toContain('"/wedding/index.html"')
    expect(source).toContain('"/wedding/assets/index-abc123.js"')
    expect(source).toContain("const BASE = '/wedding/'")
  })

  it('honours a custom base', () => {
    const { source } = buildFromDist(fixture(TREE), '/')
    expect(source).toContain('"/index.html"')
  })

  it('changes the cache name when a file’s CONTENTS change', () => {
    // The reason the id hashes contents rather than names: index.html is not in the JS
    // module graph, so editing it — a CSP change, for instance — renames nothing. A
    // name-derived id would leave sw.js byte-identical and the change would never reach
    // a device.
    const before = buildFromDist(fixture(TREE), '/wedding/').source
    const after = buildFromDist(
      fixture({ ...TREE, 'index.html': '<!doctype html><!-- edited -->' }),
      '/wedding/',
    ).source
    expect(cacheName(before)).not.toBe(cacheName(after))
  })

  it('is stable for an identical tree', () => {
    const first = buildFromDist(fixture(TREE), '/wedding/').source
    const second = buildFromDist(fixture(TREE), '/wedding/').source
    expect(cacheName(first)).toBe(cacheName(second))
  })

  it('keeps the cross-origin bail-out as the first thing the fetch handler does', () => {
    // Scope decides which CLIENTS a worker controls, not which requests it SEES, so the
    // Apps Script endpoint arrives here too. A worker responding to it would be an
    // un-CSP'd proxy in front of the edit key.
    const { source } = buildFromDist(fixture(TREE), '/wedding/')
    const handler = source.slice(source.indexOf("addEventListener('fetch'"))
    const bail = handler.indexOf('!== self.location.origin')
    const respond = handler.indexOf('respondWith')
    expect(bail).toBeGreaterThan(-1)
    expect(bail).toBeLessThan(respond)
  })

  it('matches with ignoreVary', () => {
    // Pages sends `Vary: Accept-Encoding` and `vite preview` sends `Vary: Origin`. Without
    // this, a header difference misses the cache and falls through to the network — a cache
    // that silently only works online.
    const { source } = buildFromDist(fixture(TREE), '/wedding/')
    expect(source.match(/ignoreVary: true/g)).toHaveLength(2)
  })

  it('precaches with cache:"reload"', () => {
    // Pages serves max-age=600 through a CDN, so without this install can pair a fresh
    // sw.js with an edge-cached stale index.html.
    const { source } = buildFromDist(fixture(TREE), '/wedding/')
    expect(source).toContain("cache: 'reload'")
  })

  it('does not skip waiting on its own', () => {
    // A running page keeps the version it started with; src/lib/serviceWorker.js decides
    // when a swap cannot lose a half-typed task.
    const { source } = buildFromDist(fixture(TREE), '/wedding/')
    const install = source.slice(
      source.indexOf("addEventListener('install'"),
      source.indexOf("addEventListener('activate'"),
    )
    // Comments stripped: the install block explains why it does NOT call this, and a
    // bare substring search matches that explanation.
    expect(withoutComments(install)).not.toContain('skipWaiting')
    // The message handler is the only route in, and the app decides when to send it.
    expect(source).toContain('SKIP_WAITING')
    expect(withoutComments(source)).toContain('self.skipWaiting()')
  })

  it('serves index.html for a navigation', () => {
    // A start_url launch requests BASE itself, but the precached key is BASE +
    // 'index.html', so matching the request would miss.
    const { source } = buildFromDist(fixture(TREE), '/wedding/')
    expect(source).toContain("mode === 'navigate'")
    expect(source).toContain('caches.match(INDEX')
  })
})

function cacheName(source) {
  return /const CACHE = '([^']+)'/.exec(source)[1]
}

/** The generated worker is heavily commented, so a substring search needs this. */
function withoutComments(source) {
  return source.replace(/^\s*\/\/.*$/gm, '')
}
