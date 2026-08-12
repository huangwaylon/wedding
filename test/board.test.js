/**
 * `useBoard`'s mutation primitive.
 *
 * There is no DOM here, so this does not render the hook — it pins the property the single
 * `run` wrapper exists for: every mutation, without exception, flags a rejected key. A
 * hand-written copy that forgets to leaves a rotated key still showing edit controls and still
 * failing silently.
 *
 * The first block reads as a source check rather than a behavioural one. That is weaker than
 * calling the hook and it is the strongest thing available without a DOM: the failure it guards
 * is somebody adding another mutation with its own try/catch.
 *
 * A source check cannot test a RULE, though — it can only confirm the code says something, not
 * that it decides correctly. So anything with a rule in it belongs in a callable function, which
 * is what `missingColumnsFor` is and what the second block exercises.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { API_ERROR } from '../src/lib/api.js'
import { TASK_COLUMNS } from '../src/schema.js'
import { missingColumnsFor } from '../src/state/useBoard.js'

const source = readFileSync('src/state/useBoard.js', 'utf8')

/**
 * Comments discuss the duplication this file forbids, so they have to go first.
 *
 * They are REMOVED, not blanked. Blanking a `//` line leaves an empty line behind, and
 * `declarationOf` splits on blank lines — so a comment inside a mutation would manufacture a
 * false block boundary and the assertion would read only the half above it.
 */
function code(text) {
  return text.replace(/\/\*\*?[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*\n/gm, '')
}

const body = code(source)

/**
 * The block of source declaring one mutation. Blocks rather than a brace-matching regex,
 * because some of these are a single line and some span twenty.
 */
function declarationOf(name) {
  return body
    .split(/\n\s*\n/)
    .find((block) => block.includes(`const ${name} = useCallback`))
}

describe('the mutation primitive', () => {
  it('exists exactly once', () => {
    expect(body.match(/const run = useCallback/g)).toHaveLength(1)
  })

  it('is the only place that flags a rejected key', () => {
    // One copy cannot drift from itself; several can.
    expect(body.match(/unauthorizedRef\.current\?\.\(\)/g)).toHaveLength(1)
  })

  it('is the only place that classifies a failure', () => {
    expect(body.match(/API_ERROR\.TRANSIENT/g)?.length ?? 0).toBeLessThanOrEqual(2)
    expect(body.match(/code === API_ERROR\.UNAUTHORIZED/g)).toHaveLength(1)
  })

  it('is the only place that moves the saving counter', () => {
    // A mutation that bumps `saving` without the matching decrement wedges the service
    // worker's update check forever, because it never looks safe to reload again.
    expect(body.match(/setSaving\(\(count\) => count \+ 1\)/g)).toHaveLength(1)
    expect(body.match(/setSaving\(\(count\) => count - 1\)/g)).toHaveLength(1)
  })

  it('routes every mutation through it', () => {
    // The named mutations the hook exposes, each of which must be a `run` call rather than
    // its own try/catch.
    for (const mutation of [
      'compact',
      'saveConfig',
      'seedTemplate',
      'addTask',
      'addSubtask',
      'editTask',
      'removeTask',
      'restoreTask',
    ]) {
      const declaration = declarationOf(mutation)
      expect(declaration, `${mutation} not found`).toBeTruthy()
      expect(declaration, `${mutation} does not call run`).toMatch(/\brun\(/)
      expect(declaration, `${mutation} has its own try/catch`).not.toMatch(/\btry\b/)
    }
  })

  it('restores the previous tasks on failure', () => {
    expect(body).toMatch(/if \(rollback\) setTasks\(rollback\)/)
  })

  it('leaves the seed and the config writes non-optimistic', () => {
    // Forty rows appearing and then vanishing is worse than a second of a spinner, and a
    // config write has no row to show optimistically in the first place.
    expect(declarationOf('seedTemplate')).toMatch(
      /run\(\(key\) => api\.createTasks\(drafts, key\)\)/,
    )
    expect(declarationOf('saveConfig')).not.toMatch(/previous/)
  })

  it('declares the outdated-script flag before the mutations that depend on it', () => {
    // A `useCallback` dep array is evaluated during render, so a `const` declared BELOW one is
    // still in its temporal dead zone — a ReferenceError on every render, not a lint nit.
    expect(body.indexOf('const outdatedScript')).toBeLessThan(body.indexOf('const editTask'))
    expect(body.indexOf('const refuseIfOutdated')).toBeLessThan(body.indexOf('const addTask'))
  })

  it('puts the SAME guard in front of every write that touches a row', () => {
    // ONE guard rather than one per operation: a per-op check goes missing from something
    // eventually, and the paths that write a date are the ones that matter.
    for (const name of [
      'addTask',
      'editTask',
      'addSubtask',
      'removeTask',
      'restoreTask',
      'compact',
    ]) {
      expect(declarationOf(name), `${name} is unguarded`).toMatch(/refuseIfOutdated\(\)/)
    }
    // And deliberately NOT on the config, which writes key/value pairs on the other tab: it is
    // how somebody fixes the wedding date while the script is being redeployed.
    expect(declarationOf('saveConfig')).not.toMatch(/refuseIfOutdated/)
  })

  it('refuses rather than letting the script reshape the row', () => {
    // A warning alone would still let somebody make the mess: the write returns {ok:true}, the
    // row is written, and the column it has never heard of is simply dropped.
    expect(declarationOf('refuseIfOutdated')).toMatch(/setError\(API_ERROR\.OUTDATED\)/)
    expect(declarationOf('refuseIfOutdated')).toMatch(/return Promise\.resolve\(false\)/)
  })
})

/**
 * The out-of-date rule itself, called rather than grepped for.
 *
 * A deployment is pinned to a version, so the browser can be running a newer column list than
 * the script. The rule has to compare the WHOLE list: checking the last column alone is sound
 * only while the list can grow and nothing is ever renamed, and a rename leaves a stale
 * deployment holding every other column including the last one.
 */
describe('missingColumnsFor', () => {
  /** What a deployment predating the current layout reports. */
  const LEGACY = [
    'id',
    'title',
    'category',
    'start',
    'end',
    'all_day',
    'done_at',
    'notes',
    'owner',
    'created_at',
    'updated_at',
    'deleted_at',
    'parent_id',
  ]

  it('catches a RENAMED column, not just an appended one', () => {
    expect(missingColumnsFor(LEGACY)).toEqual(['due'])
  })

  it('is not fooled by the last column being present', () => {
    // Which is why the rule cannot read the final entry alone: this list has it.
    expect(LEGACY).toContain(TASK_COLUMNS[TASK_COLUMNS.length - 1])
    expect(missingColumnsFor(LEGACY).length).toBeGreaterThan(0)
  })

  it('passes a deployment that knows every column, extras and order notwithstanding', () => {
    expect(missingColumnsFor(TASK_COLUMNS)).toEqual([])
    expect(missingColumnsFor([...TASK_COLUMNS].reverse())).toEqual([])
    expect(missingColumnsFor([...TASK_COLUMNS, 'something_newer'])).toEqual([])
  })

  it('treats an unread schema and an empty one differently', () => {
    // `null` is "nothing read yet" and must not flag, or every cold start would warn about
    // itself. `[]` is a script that sends no schema at all, so everything is missing.
    expect(missingColumnsFor(null)).toEqual([])
    expect(missingColumnsFor([])).toEqual(TASK_COLUMNS)
  })

  it('knows the unauthorized code it branches on', () => {
    // Guards against the string drifting out of step with the api module.
    expect(API_ERROR.UNAUTHORIZED).toBe('unauthorized')
  })
})
