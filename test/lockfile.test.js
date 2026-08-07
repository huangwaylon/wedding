/**
 * The lockfile must not carry a private registry.
 *
 * This repo is developed on a machine where `NPM_CONFIG_REGISTRY` points at an internal
 * Apple mirror, and a bare `npm install` bakes that host into every `resolved` URL. The
 * result works locally and fails on a GitHub runner with `getaddrinfo ENOTFOUND`, which
 * npm reports only as the useless "Exit handler never called!". A repo `.npmrc` cannot
 * prevent it — npm ranks env vars higher — so the check lives here.
 *
 * Fix:
 *   rm -rf node_modules package-lock.json
 *   npm install --registry=https://registry.npmjs.org
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const lockfile = JSON.parse(readFileSync('package-lock.json', 'utf8'))

describe('package-lock.json', () => {
  it('resolves every package from the public registry', () => {
    const offenders = []
    for (const [path, entry] of Object.entries(lockfile.packages ?? {})) {
      if (!entry.resolved) continue
      if (!entry.resolved.startsWith('https://registry.npmjs.org/')) {
        offenders.push(`${path || '<root>'}: ${entry.resolved}`)
      }
    }
    expect(offenders, 'packages resolved from a non-public registry').toEqual([])
  })

  it('is a modern lockfile', () => {
    expect(lockfile.lockfileVersion).toBeGreaterThanOrEqual(3)
  })

  it('has no dependency the app does not declare', () => {
    // The bundle is React plus application code: no charting library, no icon pack, no
    // date library. Each of those would also be a CSP decision.
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(Object.keys(manifest.dependencies)).toEqual(['react', 'react-dom'])
  })
})
