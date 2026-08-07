/**
 * `useBoard`'s mutation primitive.
 *
 * There is no DOM here, so this does not render the hook — it pins the property that made
 * unifying the four hand-written copies worth doing: every mutation, without exception,
 * flags a rejected key. The fourth copy (`compact`) had quietly dropped that, so a rotated
 * key plus a Purge left the app still showing edit controls and still failing silently.
 *
 * Read as a source check rather than a behavioural one. That is a weaker test than calling
 * the hook, and it is the strongest one available without a DOM: the failure it guards is
 * somebody adding a fifth mutation with its own try/catch.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { API_ERROR } from '../src/lib/api.js'

const source = readFileSync('src/state/useBoard.js', 'utf8')

/**
 * Comments discuss the duplication this file forbids, so they have to go first.
 *
 * They are REMOVED, not blanked. Blanking a `//` line leaves an empty line behind, and
 * `declarationOf` splits on blank lines — so a comment inside a mutation manufactured a false
 * block boundary and the assertion read only the half above it.
 */
function code(text) {
  return text.replace(/\/\*\*?[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*\n/gm, '')
}

const body = code(source)

/**
 * The block of source declaring one mutation. Blocks rather than a brace-matching regex,
 * because after the unification some of these are a single line and some span twenty.
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
    // One copy cannot drift from itself. Four could, and did.
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
    // its own try/catch. `compact` is listed first because it is the one that regressed.
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

  it('treats an unread schema and an empty one differently', () => {
    // The whole point of the guard. A deployment older than this bundle sends no `schema` field,
    // so an EMPTY list is the positive signal that it cannot store a column we write. `null` —
    // nothing read yet — must not flag, or every cold start would warn about itself.
    //
    // Written as `schema.length > 0 && ...` first, which excluded the only case it exists for:
    // the old script sends nothing, so `length > 0` was false and the write went through and
    // silently lost `parent_id`.
    expect(body).toMatch(/useState\(null\)/)
    expect(body).toMatch(/const outdatedScript = schema !== null && !schema\.includes\(/)
    expect(body).not.toMatch(/schema\.length > 0/)
  })

  it('declares the outdated-script flag before the mutations that depend on it', () => {
    // A `useCallback` dep array is evaluated during render, so a `const` declared BELOW one is
    // still in its temporal dead zone — a ReferenceError on every render, not a lint nit.
    expect(body.indexOf('const outdatedScript')).toBeLessThan(body.indexOf('const editTask'))
    expect(body.indexOf('const outdatedScript')).toBeLessThan(body.indexOf('const addSubtask'))
  })

  it('guards a SUBTASK edit too, not just a new subtask', () => {
    // `toggleDone` comes through `editTask`, so ticking a checklist item on an out-of-date script
    // would be written by a script that has never heard of `parent_id` — dropping it and promoting
    // the item to a task of its own. A top-level edit is unaffected: its `parent_id` is empty.
    const declaration = declarationOf('editTask')
    expect(declaration).toMatch(/if \(task\.parentId && outdatedScript\)/)
    expect(declaration).toMatch(/return Promise\.resolve\(false\)/)
  })

  it('refuses the write rather than letting the script reshape it', () => {
    // A warning alone would still let somebody make the mess: the write returns {ok:true}, the
    // row is created, and the column is dropped.
    const declaration = declarationOf('addSubtask')
    expect(declaration).toMatch(/if \(outdatedScript\)/)
    expect(declaration).toMatch(/return Promise\.resolve\(false\)/)
  })

  it('names the required column from the schema rather than as a literal', () => {
    // So the check cannot drift from the column list it is checking.
    expect(body).toMatch(/REQUIRED_COLUMN = TASK_COLUMNS\[TASK_COLUMNS\.length - 1\]/)
  })

  it('knows the unauthorized code it branches on', () => {
    // Guards against the string drifting out of step with the api module.
    expect(API_ERROR.UNAUTHORIZED).toBe('unauthorized')
  })
})
