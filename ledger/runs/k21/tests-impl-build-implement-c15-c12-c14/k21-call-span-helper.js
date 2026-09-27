// Small local helper, private to this TestSet: given the index of a call's NAME (as returned by
// b5-wiring-helpers.js's `callSites`), returns the span of its argument list, skipping strings/comments/
// templates via the same `codeMask` b5-wiring-helpers already builds for exactly this purpose.
//
// Used to find "the agent() call whose arguments contain this label/prompt text" without ever falling
// back to a whole-file `indexOf` search for the call itself — the call is always located first via
// `callSites`, and this only walks forward from an already-verified call site to its matching close paren.
import { codeMask } from './b5-wiring-helpers.js'

export function callSpan(text, nameStart) {
  let i = nameStart
  while (/[\w$]/.test(text[i] ?? '')) i++
  while (/\s/.test(text[i] ?? '')) i++
  if (text[i] !== '(') throw new Error(`callSpan: expected '(' after call name at ${nameStart}`)
  const mask = codeMask(text)
  let depth = 1
  let j = i + 1
  while (depth && j < text.length) {
    if (mask[j]) {
      if (text[j] === '(') depth++
      else if (text[j] === ')') depth--
    }
    j++
  }
  if (depth) throw new Error(`callSpan: unbalanced '(' starting at ${nameStart}`)
  return { nameStart, argsStart: i + 1, end: j }
}

// Among every call site of `fnName` (found via b5-wiring-helpers' callSites, never indexOf), returns the
// one whose argument list contains `anchorIdx` (e.g. the index of a distinctive label string).
export function callOwning(text, callSitesFn, fnName, anchorIdx, from, to) {
  const sites = callSitesFn(text, fnName, from, to)
  for (const s of sites) {
    const span = callSpan(text, s)
    if (anchorIdx > span.argsStart && anchorIdx < span.end) return span
  }
  return null
}
