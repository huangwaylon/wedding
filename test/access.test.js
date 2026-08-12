/**
 * The capability URL. This is the whole access-control surface on the client, and the
 * cases that matter are the ones where something almost works: a truncated link, a
 * `#section` anchor, a stale key shadowing a fresh one.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  KEY_PATTERN,
  isKeyRejected,
  markKeyRejected,
  parseEditKey,
  parsePastedLink,
  readEditKey,
  resolveAccess,
  shouldStripHash,
  writeEditKey,
} from '../src/lib/access.js'
import { STORAGE_KEYS } from '../src/config.js'

const KEY = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

/** `config.js` talks to the real `localStorage`, which vitest's node env lacks. */
beforeEach(() => {
  const store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  })
})

describe('parseEditKey', () => {
  it('reads the fragment', () => {
    expect(parseEditKey(`#k=${KEY}`)).toBe(KEY)
    expect(parseEditKey(`k=${KEY}`)).toBe(KEY)
    expect(parseEditKey(`#foo=1&k=${KEY}`)).toBe(KEY)
  })

  it('rejects anything that is not a whole key', () => {
    // A truncated link must not be stored: a key that is 63 characters long produces
    // an `unauthorized` later, which is indistinguishable from a rotated key and sends
    // somebody hunting for the wrong problem.
    expect(parseEditKey(`#k=${'a'.repeat(31)}`)).toBeNull()
    expect(parseEditKey('#k=')).toBeNull()
    expect(parseEditKey('#k=not-hex-at-all-not-hex-at-all-')).toBeNull()
  })

  it('ignores an ordinary anchor', () => {
    expect(parseEditKey('#settings')).toBeNull()
    expect(parseEditKey('')).toBeNull()
    expect(parseEditKey(null)).toBeNull()
  })

  it('accepts the length range openssl actually produces', () => {
    expect(KEY_PATTERN.test('a'.repeat(32))).toBe(true)
    expect(KEY_PATTERN.test('A'.repeat(64))).toBe(true)
    expect(KEY_PATTERN.test('a'.repeat(129))).toBe(false)
  })
})

describe('parsePastedLink', () => {
  it('takes a whole edit link', () => {
    expect(parsePastedLink(`https://example.github.io/wedding/#k=${KEY}`)).toBe(KEY)
  })

  it('takes a bare key, and a query string spelling', () => {
    expect(parsePastedLink(KEY)).toBe(KEY)
    expect(parsePastedLink(`  ${KEY}  `)).toBe(KEY)
    // Not how the app ever produces a link, but somebody's mail client may have
    // rewritten it, and refusing that would be unhelpful pedantry.
    expect(parsePastedLink(`https://example.github.io/wedding/?k=${KEY}`)).toBe(KEY)
  })

  it('returns null rather than guessing', () => {
    expect(parsePastedLink('https://example.github.io/wedding/')).toBeNull()
    expect(parsePastedLink('')).toBeNull()
  })
})

describe('storage', () => {
  it('round-trips a valid key and refuses an invalid one', () => {
    expect(writeEditKey(KEY)).toBe(KEY)
    expect(readEditKey()).toBe(KEY)
    expect(writeEditKey('short')).toBeNull()
  })

  it('ignores a stored value that is not a key', () => {
    localStorage.setItem(STORAGE_KEYS.editKey, 'garbage')
    expect(readEditKey()).toBeNull()
  })

  it('clears the rejection flag when a new key is stored', () => {
    writeEditKey(KEY)
    markKeyRejected()
    expect(isKeyRejected()).toBe(true)
    // Pasting a fresh link is how a rotation is delivered; the old complaint has to go.
    writeEditKey(OTHER)
    expect(isKeyRejected()).toBe(false)
  })

  it('clears both on revoke', () => {
    writeEditKey(KEY)
    markKeyRejected()
    writeEditKey(null)
    expect(readEditKey()).toBeNull()
    expect(isKeyRejected()).toBe(false)
  })
})

describe('shouldStripHash', () => {
  it('keeps the fragment in the browser and clears it once installed', () => {
    // The reason: an installed web app has its own storage bucket, so the fragment has
    // to survive in Safari long enough for "Add to Home Screen" to record it.
    expect(shouldStripHash({ standalone: false })).toBe(false)
    expect(shouldStripHash({ standalone: true })).toBe(true)
  })
})

describe('resolveAccess', () => {
  it('is view-only with no key anywhere', () => {
    // No key IS view-only: there is no second field saying so, and a planner opening the bare
    // URL must get a board with nothing to dismiss.
    const access = resolveAccess({ hash: '', standalone: false })
    expect(access).toEqual({ key: null, rejected: false, strip: false })
  })

  it('captures a key from the fragment and grants edit', () => {
    const access = resolveAccess({ hash: `#k=${KEY}`, standalone: false })
    expect(access.key).toBe(KEY)
    expect(readEditKey()).toBe(KEY)
  })

  it('uses the stored key when the URL is bare', () => {
    writeEditKey(KEY)
    expect(resolveAccess({ hash: '', standalone: false }).key).toBe(KEY)
  })

  it('lets a key in the URL beat the stored one', () => {
    // How a rotation reaches a device that already holds the dead key. If the stored
    // one won, opening the new link would appear to do nothing.
    writeEditKey(KEY)
    const access = resolveAccess({ hash: `#k=${OTHER}`, standalone: false })
    expect(access.key).toBe(OTHER)
    expect(readEditKey()).toBe(OTHER)
  })

  it('reports a flagged key without dropping it', () => {
    writeEditKey(KEY)
    markKeyRejected()
    const access = resolveAccess({ hash: '', standalone: false })
    expect(access.rejected).toBe(true)
    // Still present, so the UI can say what is wrong instead of silently downgrading.
    expect(access.key).toBe(KEY)
  })

  it('only asks for the hash to be stripped when it carried a key', () => {
    expect(resolveAccess({ hash: '#settings', standalone: true }).strip).toBe(false)
    expect(resolveAccess({ hash: `#k=${KEY}`, standalone: true }).strip).toBe(true)
  })
})
