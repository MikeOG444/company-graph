import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// t1-agent-definitions/agent-defs-helpers.js lives three levels under the repo root
// (.artifacts/tests/t1-agent-definitions/), so climb three levels to resolve REPO regardless of where this
// directory is invoked from.
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
export const AGENTS_DIR = path.join(REPO, '.claude', 'agents')

// The agent definitions that existed before task t1-agent-definitions landed (spec-wi-a5-agent-least-privilege).
// This is a fixture of repo state, not a guess at the implementation: it lets the AC-3/AC-10 tests below
// distinguish the definitions this task adds from the ones that were already there, without reading any
// diff or implementation artifact.
export const BASELINE_AGENT_NAMES = [
  'feedback-analyst', 'fixer', 'implementer', 'lens-correctness', 'lens-security',
  'lens-spec-conformance', 'mechanical', 'memory-analyst', 'opportunity-synthesizer',
  'patch-drafter', 'reproducer', 'root-cause', 'test-author', 'triage', 'usage-analyst',
  'verdict-rationale',
]

export const VALID_MODELS = new Set(['opus', 'sonnet', 'haiku'])
export const JUDGMENT_TOOLS = ['Read', 'Glob', 'Grep']

// Parse the `---\n...\n---\nbody` frontmatter block used by every file in .claude/agents/. Only the flat
// `key: value` shape these files use is supported; nested YAML is not needed here.
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

// Every .md file currently committed under .claude/agents/, each with its filename stem, raw text and
// parsed frontmatter/body.
export function readAllAgentDefs() {
  if (!fs.existsSync(AGENTS_DIR)) return []
  return fs.readdirSync(AGENTS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const stem = f.slice(0, -3)
      const text = fs.readFileSync(path.join(AGENTS_DIR, f), 'utf8')
      const parsed = parseAgentDef(text)
      return { file: f, stem, text, fm: parsed?.fm ?? null, body: parsed?.body ?? '' }
    })
}

const WRITE_TOOLS = new Set(['Bash', 'Write', 'Edit'])
export function holdsWriteTool(tools) {
  return tools.some(t => WRITE_TOOLS.has(t))
}
