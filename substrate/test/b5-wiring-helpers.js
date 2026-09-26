// Call-structure helpers for the B5 wiring tests (spec-wi-b5-sibling-value-repair), written at k9d.
//
// Why this exists: run k9b's wiring tests located things by their first TEXTUAL occurrence in the file.
// `text.indexOf('boundaryRepair(')` finds the function's DEFINITION inside the fix-loop block, not a call, and
// a function declaration hoists, so where it sits in the file says nothing about when it runs. Four of the
// seven k9b failures were that, and a fixer then moved code around to satisfy them. These helpers answer the
// question the spec actually asks — which CALLS happen, in which order, inside which function — so a test
// built on them fails when the wiring changes and not when a declaration moves.
//
// Deliberately small: a lexer that skips strings, template literals (with ${} nesting), comments and regex
// literals well enough to brace-match function bodies in this repo's workflow scripts. Every helper throws
// rather than guessing when it cannot find what it was asked for.

const IDENT = /[A-Za-z0-9_$]/

// Index just past the `}` that closes the `{` at `open`, skipping strings, templates, comments and regexes.
export function matchBrace(text, open) {
  if (text[open] !== '{') throw new Error(`matchBrace: no { at ${open}`)
  const stack = ['{']          // '{' = code brace, '${' = template substitution
  let i = open + 1
  let prevSig = '{'            // last significant non-space char, to tell a regex from a division
  while (i < text.length) {
    const c = text[i], n = text[i + 1]
    if (c === '/' && n === '/') { i = text.indexOf('\n', i); if (i < 0) break; continue }
    if (c === '/' && n === '*') { i = text.indexOf('*/', i + 2) + 2; continue }
    if (c === '"' || c === "'") {
      i++
      while (i < text.length && text[i] !== c) { if (text[i] === '\\') i++; i++ }
      i++; prevSig = c; continue
    }
    if (c === '`') { i = skipTemplate(text, i + 1); prevSig = '`'; continue }
    if (c === '/' && /[(,=:[!&|?{};+\-*%<>~^]|^$/.test(prevSig)) {
      i++
      let inClass = false
      while (i < text.length) {
        const r = text[i]
        if (r === '\\') { i += 2; continue }
        if (r === '[') inClass = true
        else if (r === ']') inClass = false
        else if (r === '/' && !inClass) break
        else if (r === '\n') break
        i++
      }
      i++
      while (IDENT.test(text[i] ?? '')) i++
      prevSig = '/'; continue
    }
    if (c === '{') stack.push('{')
    else if (c === '}') { stack.pop(); if (!stack.length) return i + 1 }
    if (!/\s/.test(c)) prevSig = c
    i++
  }
  throw new Error(`matchBrace: unbalanced { at ${open}`)
}

// From just inside a template literal, return the index just past its closing backtick.
function skipTemplate(text, i) {
  while (i < text.length) {
    const c = text[i]
    if (c === '\\') { i += 2; continue }
    if (c === '`') return i + 1
    if (c === '$' && text[i + 1] === '{') { i = matchBrace(text, i + 1); continue }
    i++
  }
  throw new Error('skipTemplate: unterminated template literal')
}

// Every `function name(...) {` declaration (async or not) in the text: { name, start, bodyStart, bodyEnd }.
export function functionDecls(text) {
  const out = []
  const re = /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g
  let m
  while ((m = re.exec(text))) {
    // Walk the parameter list by paren depth, then the next { opens the body.
    let i = m.index + m[0].length, depth = 1
    while (depth && i < text.length) {
      if (text[i] === '(') depth++
      else if (text[i] === ')') depth--
      i++
    }
    const bodyStart = text.indexOf('{', i)
    out.push({ name: m[1], start: m.index, bodyStart, bodyEnd: matchBrace(text, bodyStart) })
  }
  return out
}

export function functionNamed(text, name) {
  const found = functionDecls(text).filter(d => d.name === name)
  if (found.length !== 1) throw new Error(`expected exactly one declaration of ${name}, found ${found.length}`)
  return found[0]
}

// The innermost declared function whose body contains `idx`.
export function enclosingFunction(text, idx) {
  const hits = functionDecls(text).filter(d => d.bodyStart < idx && idx < d.bodyEnd)
  if (!hits.length) throw new Error(`no declared function encloses index ${idx}`)
  return hits.reduce((a, b) => (b.bodyEnd - b.bodyStart < a.bodyEnd - a.bodyStart ? b : a))
}

// A per-character mask: true where the character is CODE, false inside a comment, a string, or the literal
// part of a template (a template's ${...} substitutions are code). k11d: callSites without it counted
// "testValidity (the pure function...)" in a comment as a call, and a mutation that removed the real call
// survived. Cached per text.
const maskCache = new Map()
export function codeMask(text) {
  if (maskCache.has(text)) return maskCache.get(text)
  const mask = new Uint8Array(text.length).fill(1)
  const off = (a, b) => mask.fill(0, a, Math.min(b, text.length))
  const tmpl = (i) => {                    // i is just past an opening backtick; returns index past the closer
    let start = i - 1
    while (i < text.length) {
      const c = text[i]
      if (c === '\\') { i += 2; continue }
      if (c === '`') { off(start, i + 1); return i + 1 }
      if (c === '$' && text[i + 1] === '{') { off(start, i + 2); i = code(i + 2, true); start = i - 1; continue }
      i++
    }
    off(start, i); return i
  }
  const code = (i, inSub) => {             // scans code; in a substitution, returns index past its closing }
    let depth = 0
    while (i < text.length) {
      const c = text[i], n = text[i + 1]
      if (c === '/' && n === '/') { const e = text.indexOf('\n', i); off(i, e < 0 ? text.length : e); i = e < 0 ? text.length : e; continue }
      if (c === '/' && n === '*') { const e = text.indexOf('*/', i + 2); off(i, e + 2); i = e + 2; continue }
      if (c === '"' || c === "'") { let j = i + 1; while (j < text.length && text[j] !== c && text[j] !== '\n') { if (text[j] === '\\') j++; j++ } off(i, j + 1); i = j + 1; continue }
      if (c === '`') { i = tmpl(i + 1); continue }
      if (c === '{') depth++
      else if (c === '}') { if (inSub && depth === 0) { mask[i] = 0; return i + 1 } depth-- }
      i++
    }
    return i
  }
  code(0, false)
  maskCache.set(text, mask)
  return mask
}

// Indices (absolute, within [from, to)) of CALLS to `name` — never its own declaration, and never a mention
// inside a comment or a string.
export function callSites(text, name, from = 0, to = text.length) {
  const mask = codeMask(text)
  const out = []
  const re = new RegExp(`(^|[^\\w$.])${name.replace(/\$/g, '\\$')}\\s*\\(`, 'g')
  re.lastIndex = from
  let m
  while ((m = re.exec(text)) && m.index < to) {
    const at = m.index + m[1].length
    if (/function\s+$/.test(text.slice(Math.max(0, at - 20), at))) continue
    if (!mask[at]) continue
    out.push(at)
  }
  return out
}

// `target` plus every declared function that calls it, directly or through another such function.
export function reachersOf(text, target) {
  const decls = functionDecls(text)
  const reach = new Set([target])
  for (let grew = true; grew;) {
    grew = false
    for (const d of decls) {
      if (reach.has(d.name)) continue
      if ([...reach].some(r => callSites(text, r, d.bodyStart, d.bodyEnd).length)) { reach.add(d.name); grew = true }
    }
  }
  return reach
}

// First call, within [from, to), to any function in `names`; -1 if none.
export function firstCallOf(text, names, from, to) {
  const all = [...names].flatMap(n => callSites(text, n, from, to))
  return all.length ? Math.min(...all) : -1
}
