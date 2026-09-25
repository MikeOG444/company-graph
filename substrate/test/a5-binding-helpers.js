import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Landed at substrate/test/, two levels under the repo root. The Test Author wrote it for
// .artifacts/tests/t2-workflow-bindings/ and climbed three, which reads the main checkout rather than the
// task worktree (k7's t1 escalation); re-pointed by hand when landed.
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const WORKFLOWS_DIR = path.join(REPO, '.claude', 'workflows')
export const AGENTS_DIR = path.join(REPO, '.claude', 'agents')

// The nine workflow scripts task t2-workflow-bindings owns (spec-wi-a5-agent-least-privilege,
// touched_surfaces). Order matches the spec's own listing.
export const WORKFLOW_FILES = [
  'build-spec.js',
  'build-implement.js',
  'build-reentry.js',
  'create-project.js',
  'launch.js',
  'maintain-triage.js',
  'deploy.js',
  'improve-analyze.js',
  'memory-roll.js',
]

export function readWorkflow(file) {
  return fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8')
}

export function readAllWorkflows() {
  return WORKFLOW_FILES.map(file => ({ file, text: readWorkflow(file) }))
}

// ---------------------------------------------------------------------------------------------------------
// Pure scanner (AC-11): a function of workflow TEXT plus nothing else. It reads nothing from disk itself —
// callers hand it a string, whether that string came from fs.readFileSync or from a hardcoded fixture of
// the historical pre-fix source. Every agent() call site's option object in this codebase is written
// `{ label: <expr>, [phase: <expr>,] model: MODEL.<tier> [, ...AT('type') | ...NEW('type') | agentType:
// '<type>'] , schema: <Name> }` (see build-spec.js's `spec:${w.id}` site or build-implement.js's
// `impl:${task.id}` site for the shape). extractSites finds every such object literal and reports, per
// site: its label text verbatim, its MODEL.<tier> expression, its schema name, and whether/how it names an
// agentType.
export function extractSites(text) {
  const re = /\{\s*label:\s*([\s\S]*?),\s*(?:phase:\s*[^,]*,\s*)?model:\s*(MODEL\.\w+)\s*,([\s\S]*?),?\s*schema:\s*(\w+)\s*\}/g
  const sites = []
  let m
  while ((m = re.exec(text))) {
    const [, labelRaw, model, extra, schema] = m
    // A computed name (build-implement's lens site binds AT(`lens-${...}`)) is still a binding through the
    // helper: it counts as bound, with agentType null and the template kept in agentTypePattern. Tests that
    // resolve a definition by name skip it; the lens definitions predate this work item. (Fixed by hand at k7.)
    const spread = extra.match(/\.\.\.\s*(AT|NEW)\(\s*(['"`])([\w-]+)\2\s*\)/)
    const computed = spread ? null : extra.match(/\.\.\.\s*(AT|NEW)\(\s*`([^`]*\$\{[^`]*)`\s*\)/)
    const literal = extra.match(/(?:^|[,{\s])agentType:\s*(['"`])([\w-]+)\1/)
    sites.push({
      label: labelRaw.trim(),
      model,
      schema,
      helper: spread ? spread[1] : (computed ? computed[1] : null),
      agentType: spread ? spread[3] : (literal ? literal[2] : null),
      agentTypePattern: computed ? computed[2] : null,
      bound: Boolean(spread || literal || computed),
      index: m.index,
    })
  }
  return sites
}

// The prompt text (first argument) that precedes a given call site's option object, so AC-9 can check the
// prompt itself for an inline read-only restatement. Purely textual: walks backward from the option
// object's start to the nearest preceding `agent(` call opening, so the slice is that call's own prompt
// argument and never bleeds into a prior site's prompt.
export function promptBefore(text, site) {
  const callIdx = text.lastIndexOf('agent(', site.index)
  const start = callIdx === -1 ? Math.max(0, site.index - 4000) : callIdx + 'agent('.length
  return text.slice(start, site.index)
}

// ---------------------------------------------------------------------------------------------------------
// MODEL tiers (AC-6): every workflow declares `const MODEL = { strong: 'opus', mid: 'sonnet', cheap:
// 'haiku' }` identically (verified independently by the AC-6 test itself for the file under test), so the
// tier name in a MODEL.<tier> expression maps to a frontmatter `model:` value this way.
export const MODEL_TIER = { 'MODEL.strong': 'opus', 'MODEL.mid': 'sonnet', 'MODEL.cheap': 'haiku' }

// ---------------------------------------------------------------------------------------------------------
// Agent definition resolution, mirroring .claude/agents/*.md frontmatter parsing used by the t1 test set.
export function parseAgentDef(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!m) return null
  const fm = {}
  for (const line of m[1].split(/\r?\n/)) {
    const mm = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (mm) fm[mm[1]] = mm[2].trim()
  }
  return { fm, body: m[2] }
}

export function toolsList(fm) {
  if (!fm || typeof fm.tools !== 'string' || fm.tools.length === 0) return []
  return fm.tools.split(',').map(s => s.trim()).filter(Boolean)
}

const WRITE_TOOLS = new Set(['Bash', 'Write', 'Edit'])
export function holdsWriteTool(tools) {
  return tools.some(t => WRITE_TOOLS.has(t))
}

// Resolve an agentType name to its committed definition, or null if unresolvable.
export function resolveAgentDef(name) {
  const file = path.join(AGENTS_DIR, `${name}.md`)
  if (!fs.existsSync(file)) return null
  const parsed = parseAgentDef(fs.readFileSync(file, 'utf8'))
  return parsed ? { file, fm: parsed.fm, body: parsed.body } : null
}

// ---------------------------------------------------------------------------------------------------------
// AT()/NEW() helper extraction (AC-7, AC-8). Each workflow declares its helper(s) as single-line `const`
// statements near the top of the file, e.g.:
//   const MISSING = new Set(A.missing_agent_types ?? [])
//   const AT = (t) => (A.agent_types === false || MISSING.has(t) ? {} : { agentType: t })
// This extracts those exact declaration lines (whatever their final form) and evaluates them against a
// synthetic `A`, so the test exercises the ACTUAL helper text rather than assuming its internals.
export function loadHelperFactory(text) {
  const missingLine = text.match(/^\s*const MISSING\s*=.*$/m)?.[0] ?? ''
  const atLine = text.match(/^\s*const AT\s*=.*$/m)?.[0] ?? ''
  const newLine = text.match(/^\s*const NEW\s*=.*$/m)?.[0] ?? ''
  const body = `
    ${missingLine}
    ${atLine}
    ${newLine}
    return {
      AT: typeof AT !== 'undefined' ? AT : undefined,
      NEW: typeof NEW !== 'undefined' ? NEW : undefined,
      hasMissingDecl: ${JSON.stringify(missingLine.length > 0)},
    }
  `
  // eslint-disable-next-line no-new-func
  const factory = new Function('A', body)
  return { hasAT: atLine.length > 0, hasNew: newLine.length > 0, make: (A) => factory(A) }
}
