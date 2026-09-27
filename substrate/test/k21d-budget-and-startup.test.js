// k21d: three defects found reviewing k21 by hand.
// (1) k21 computed RATIO at the top of build-implement.js from a function whose default is a `const` declared
//     inside the fix-loop block ~300 lines later: every run threw "Cannot access 'DEFAULT_BILLED_PER_OUTPUT' before
//     initialization" at startup. Tests that evaluate the block alone cannot see it, so this runs the top level.
// (2) The per-round ceiling defaulted to task/k_rounds; that stopped k1i, k7 and k21 in round 1 while each was far
//     under its task ceiling. With no explicit budget.round_tokens the round ceiling is now the task ceiling.
// (3) With a live NOTIFY_* config in the environment the suite opened 72 real GitHub issues. The suite now starts
//     with no delivery config.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { REPO } from './helpers.js'
import { readWorkflowText } from './extract-fixloop.js'
import { functionNamed } from './b5-wiring-helpers.js'

// Run the whole workflow body with stub runtime bindings and no specs: it must reach its final return.
async function runTopLevel(args) {
  const src = readWorkflowText().replace(/^export const meta/m, 'const meta')
  const run = new Function('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', `return (async () => {${src}\n})()`)
  return run(args, async () => null, async () => [], async () => [], () => {}, () => {}, { spent: () => 0 })
}

test('build-implement.js runs its top level without a startup error, with and without billed_per_output', async () => {
  for (const extra of [{}, { billed_per_output: 3 }, { billed_per_output: 'x' }]) {
    const out = await runTopLevel({ specs: [], run_id: 'k21d', ...extra })
    assert.equal(out.spend.billed_per_output, extra.billed_per_output === 3 ? 3 : 4)
  }
})

test('with no budget.round_tokens the round ceiling is the task ceiling; an explicit one still tightens it', () => {
  const text = readWorkflowText()
  const rt = functionNamed(text, 'runTask')
  const body = text.slice(rt.bodyStart, rt.bodyEnd)
  const call = body.match(/roundBudget\(\{([^}]*)\}\)/)
  assert.ok(call, 'runTask must derive the round ceiling through roundBudget')
  assert.match(call[1], /k_rounds:\s*A\.budget\?\.round_tokens\s*!=\s*null\s*\?\s*K_ROUNDS\s*:\s*0/,
    'k_rounds must be 0 (round ceiling = task ceiling) unless budget.round_tokens is given')
})

test('the suite starts with no NOTIFY_* delivery config, from npm test and from the shared helpers', () => {
  for (const k of Object.keys(process.env)) assert.ok(!k.startsWith('NOTIFY_'), `${k} leaked into the test process`)
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'))
  assert.match(pkg.scripts.test, /--import \.\/substrate\/test\/no-live-notify\.js/)
  for (const f of ['helpers.js', 'c5-env-helpers.js']) {
    assert.match(fs.readFileSync(path.join(REPO, 'substrate', 'test', f), 'utf8'), /^import '\.\/no-live-notify\.js'/m, f)
  }
})

// C12 behaviour, end to end through the top level: a stub gate reader that miscopies once, always, or reports a
// genuinely undecided gate. The build must proceed after one re-read, refuse after two, and never re-read otherwise.
async function gateRun(reads) {
  const calls = []
  const agent = async (prompt, opts) => { calls.push(opts?.label); return opts?.label === 'gate:spec_gate' ? reads[Math.min(calls.length - 1, reads.length - 1)] : null }
  const src = readWorkflowText().replace(/^export const meta/m, 'const meta')
  const run = new Function('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', `return (async () => {${src}\n})()`)
  const out = await run({ specs: [{ spec: { id: 's1', gate: 'pending', acceptance: [] }, graph: { tasks: [] } }], gate: { gate_id: 'k8-spec_gate' }, run_id: 'k21d' },
    agent, async () => [], async () => [], () => {}, () => {}, { spent: () => 0 })
  return { out, gateCalls: calls.filter(l => l === 'gate:spec_gate').length }
}
const good = { found: true, status: 'decided', gate: 'spec_gate', option: 'approve', id: 'k8-spec_gate' }
const miscopy = { ...good, gate: 'k8-spec_gate' }

test('C12: a miscopied gate read is re-read once and the approved build proceeds', async () => {
  const { out, gateCalls } = await gateRun([miscopy, good])
  assert.equal(gateCalls, 2)
  assert.ok(!out.refused, JSON.stringify(out).slice(0, 200))
})

test('C12: a read that miscopies twice refuses, naming the failed field; an undecided gate refuses without a re-read', async () => {
  const twice = await gateRun([miscopy, miscopy])
  assert.equal(twice.gateCalls, 2)
  assert.equal(twice.out.refused, true)
  assert.match(twice.out.reason, /gate/)
  const open = await gateRun([{ ...good, status: 'open' }])
  assert.equal(open.gateCalls, 1)
  assert.equal(open.out.refused, true)
  assert.match(open.out.reason, /status/)
})

test('C15: a ratio of zero never overrides the default', async () => {
  const out = await runTopLevel({ specs: [], run_id: 'k21d', billed_per_output: 0 })
  assert.equal(out.spend.billed_per_output, 4)
})

test('C15: runTask books an over_budget entry right after it books the round spend', () => {
  const text = readWorkflowText()
  const rt = functionNamed(text, 'runTask')
  const body = text.slice(rt.bodyStart, rt.bodyEnd)
  const booked = body.indexOf('ctx.tokens += ctx.last_round_tokens')
  const check = body.indexOf('if (isOverBudget(', booked)
  assert.ok(booked > -1 && check > booked, 'isOverBudget must be consulted after the round spend is booked')
  const branch = body.slice(check, body.indexOf('\n    }', check))
  assert.match(branch, /overBudget\.push\(\{\s*task_id: task\.id, round: ctx\.round, billed_est, budget: ctx\.task_tokens_billed \}\)/)
})
