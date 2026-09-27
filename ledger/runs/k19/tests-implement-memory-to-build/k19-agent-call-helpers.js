// Helper for locating agent() CALL SITES (never a bare textual/indexOf search) in the workflow scripts
// under test, for spec-wi-b1-b2-memory-to-build. Built directly on top of the existing
// substrate/test/b5-wiring-helpers.js call-structure primitives (codeMask, callSites) so a call to
// `agent` is found the same way that file finds any other call: by scanning real call sites, never by
// the first textual occurrence of the word "agent" in the file (which would just as happily match a
// comment, a variable named agentType, or a declaration).
//
// Reuses codeMask()/callSites() exactly as exported by b5-wiring-helpers.js (copied alongside this file)
// rather than reimplementing string/comment/template skipping.
import { codeMask, callSites, matchBrace } from './b5-wiring-helpers.js'

// Index just past the ')' that closes the '(' at `openIdx`, using the same code/string/comment mask
// b5-wiring-helpers.js already computes for the whole text, so parens inside strings/templates/comments
// are correctly ignored.
export function matchParenIdx(text, mask, openIdx) {
  let depth = 0
  for (let i = openIdx; i < text.length; i++) {
    if (!mask[i]) continue
    const c = text[i]
    if (c === '(') depth++
    else if (c === ')') { depth--; if (depth === 0) return i }
  }
  throw new Error(`matchParenIdx: unmatched ( at ${openIdx}`)
}

// Every real call to `agent(...)` within text[from, to). For each, splits the argument list into the
// leading prompt text and the trailing `{ label: ..., ..., schema: ... }` options object (the shape every
// agent() call in this repo uses — see build-spec.js / build-implement.js), and pulls out label / model /
// schema / agentType for convenience.
export function agentCalls(text, from = 0, to = text.length) {
  const mask = codeMask(text)
  const nameStarts = callSites(text, 'agent', from, to)
  return nameStarts.map(nameStart => {
    let i = nameStart + 'agent'.length
    while (/\s/.test(text[i])) i++
    if (text[i] !== '(') throw new Error(`agentCalls: expected ( right after "agent" at ${nameStart}`)
    const closeIdx = matchParenIdx(text, mask, i)
    const argsText = text.slice(i + 1, closeIdx)
    const optMatch = argsText.match(/\{\s*label:[\s\S]*schema:\s*\w+[\s\S]*?\}\s*$/)
    const options = optMatch ? optMatch[0] : ''
    const prompt = optMatch ? argsText.slice(0, optMatch.index) : argsText
    const label = options.match(/label:\s*(`[^`]*`|'[^']*'|"[^"]*")/)?.[1] ?? null
    const model = options.match(/model:\s*(MODEL\.\w+)/)?.[1] ?? null
    const schema = options.match(/schema:\s*(\w+)/)?.[1] ?? null
    const agentType = options.match(/agentType:\s*['"]([\w-]+)['"]/)?.[1]
      ?? options.match(/\.\.\.\s*(?:AT|NEW)\(\s*['"]([\w-]+)['"]\s*\)/)?.[1] ?? null
    return { nameStart, argsStart: i + 1, argsEnd: closeIdx, argsText, prompt, options, label, model, schema, agentType }
  })
}

// Every agent() call within [from, to) whose `label` field's literal text includes `labelSubstring`.
export function agentCallsByLabel(text, labelSubstring, from = 0, to = text.length) {
  return agentCalls(text, from, to).filter(c => c.label != null && c.label.includes(labelSubstring))
}

// Every agent() call within [from, to) whose `label` field's literal text matches `labelRegex`.
export function agentCallsByLabelRegex(text, labelRegex, from = 0, to = text.length) {
  return agentCalls(text, from, to).filter(c => c.label != null && labelRegex.test(c.label))
}

// The [start, end) argument-list paren span (start just after '(', end at the matching ')') of every
// real call to `name(...)`, found the same call-site way as agentCalls above (via b5-wiring-helpers'
// callSites + codeMask), for ANY callee identifier — not just `agent`. Used to test whether some other
// call site lies textually inside (nested within) a given call's argument list, e.g. inside the callback
// argument of pipeline(...) / parallel(...).
export function calleeArgSpans(text, name, from = 0, to = text.length) {
  const mask = codeMask(text)
  const nameStarts = callSites(text, name, from, to)
  return nameStarts.map(nameStart => {
    let i = nameStart + name.length
    while (/\s/.test(text[i])) i++
    if (text[i] !== '(') throw new Error(`calleeArgSpans: expected ( right after "${name}" at ${nameStart}`)
    const closeIdx = matchParenIdx(text, mask, i)
    return { nameStart, argsStart: i + 1, argsEnd: closeIdx }
  })
}

export function isWithinAnySpan(idx, spans) {
  return spans.some(s => idx > s.argsStart && idx < s.argsEnd)
}

// Every {...} brace block (found via b5-wiring-helpers' own matchBrace, over real code positions only)
// that encloses `idx`, innermost first. Used to check whether a call site sits inside some guarding
// `if (...) { ... }` block, without assuming any particular variable name for that guard beyond scanning
// the text immediately preceding the block's opening brace.
export function enclosingBraces(text, idx) {
  const mask = codeMask(text)
  const spans = []
  for (let i = 0; i < idx; i++) {
    if (!mask[i] || text[i] !== '{') continue
    let end
    try { end = matchBrace(text, i) } catch { continue }
    if (end > idx) spans.push({ start: i, end })
  }
  spans.sort((a, b) => (a.end - a.start) - (b.end - b.start))
  return spans
}

// True if `idx` sits inside a brace block whose "header" (the ~`headerWindow` characters immediately
// before the block's opening `{`) matches `headerRegex` — e.g. an `if (A.memory_ref) { ... }` guard.
export function isGuardedBy(text, idx, headerRegex, headerWindow = 300) {
  return enclosingBraces(text, idx).some(({ start }) => headerRegex.test(text.slice(Math.max(0, start - headerWindow), start)))
}

// Every braced `if (<cond>) { ... } [else { ... }]` in text whose <cond> matches conditionRegex — with
// proper paren depth matching (so a condition containing its own nested parens, e.g.
// `A.canary && (A.canary.task_id === task.id || A.canary.spec_id === spec.id)`, is read in full rather
// than truncated at the first `)`). Returns { condText, ifBlock: {start,end}, elseBlock: {start,end}|null }
// for each match (elseBlock null when there is no following else).
export function ifBlocksMatching(text, conditionRegex) {
  const mask = codeMask(text)
  const out = []
  const re = /\bif\s*\(/g
  let m
  while ((m = re.exec(text))) {
    if (!mask[m.index]) continue
    const openParen = m.index + m[0].length - 1
    let closeParen
    try { closeParen = matchParenIdx(text, mask, openParen) } catch { continue }
    const condText = text.slice(openParen + 1, closeParen)
    if (!conditionRegex.test(condText)) continue
    let i = closeParen + 1
    while (i < text.length && /\s/.test(text[i])) i++
    if (text[i] !== '{') continue
    const bodyEnd = matchBrace(text, i)
    let j = bodyEnd
    while (j < text.length && /\s/.test(text[j])) j++
    let elseBlock = null
    if (text.slice(j, j + 4) === 'else') {
      let k = j + 4
      while (k < text.length && /\s/.test(text[k])) k++
      if (text[k] === '{') {
        elseBlock = { start: k, end: matchBrace(text, k) }
      } else if (text.slice(k, k + 2) === 'if') {
        elseBlock = { start: k, end: text.length } // coarse: rest of the else-if chain, good enough for containment checks
      }
    }
    out.push({ condText, ifBlock: { start: i, end: bodyEnd }, elseBlock })
  }
  return out
}
