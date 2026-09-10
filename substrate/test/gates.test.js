import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { cli, tmpRoot } from './helpers.js'

test('open → list → decide round trip, validated as GateRecord', () => {
  const root = tmpRoot()
  const payload = path.join(root, 'gated.json')
  fs.writeFileSync(payload, JSON.stringify({ specs: ['spec-7'] }))

  const open = cli('gates', ['open', '--gate', 'spec_gate', '--run', 'r1', '--workflow', 'build-spec',
    '--options', 'approve,revise,kill', '--payload', payload, '--next', 'build-implement', '--now', '2026-09-10T10:00:00Z'], { root })
  assert.equal(open.code, 0, open.err)
  assert.equal(open.out, 'r1-spec_gate')
  const rec = JSON.parse(fs.readFileSync(path.join(root, 'gates', 'open', 'r1-spec_gate.json'), 'utf8'))
  assert.equal(rec.status, 'open')
  assert.deepEqual(rec.options, ['approve', 'revise', 'kill'])
  assert.deepEqual(rec.payload, { specs: ['spec-7'] })
  assert.equal(rec.provenance.method, 'hitl')

  const list = cli('gates', ['list'], { root })
  assert.match(list.out, /r1-spec_gate\topen\tspec_gate/)

  // Wrong option is refused and leaves the gate open.
  assert.equal(cli('gates', ['decide', 'r1-spec_gate', 'yolo'], { root }).code, 1)
  assert.ok(fs.existsSync(path.join(root, 'gates', 'open', 'r1-spec_gate.json')))

  const dec = cli('gates', ['decide', 'r1-spec_gate', 'approve', '--note', 'fine', '--now', '2026-09-10T11:00:00Z'], { root })
  assert.equal(dec.code, 0, dec.err)
  assert.match(dec.out, /next: \/build-implement/)
  assert.match(dec.out, /"decision":"approve"/)
  assert.ok(!fs.existsSync(path.join(root, 'gates', 'open', 'r1-spec_gate.json')))
  const closed = JSON.parse(fs.readFileSync(path.join(root, 'gates', 'closed', 'r1-spec_gate.json'), 'utf8'))
  assert.equal(closed.status, 'decided')
  assert.equal(closed.decision.option, 'approve')
  assert.equal(closed.decision.decided_by, 'human_employee')

  // Deciding twice is refused.
  assert.equal(cli('gates', ['decide', 'r1-spec_gate', 'kill'], { root }).code, 1)
  assert.equal(cli('gates', ['list'], { root }).out, 'no open gates')
  assert.match(cli('gates', ['list', '--closed'], { root }).out, /decided.*→ approve/)
})

test('same run + gate twice gets a distinct id; stale filter works', () => {
  const root = tmpRoot()
  const a = cli('gates', ['open', '--gate', 'launch_approval', '--run', 'r2', '--workflow', 'launch', '--options', 'approve,veto', '--now', '2020-01-01T00:00:00Z'], { root })
  const b = cli('gates', ['open', '--gate', 'launch_approval', '--run', 'r2', '--workflow', 'launch', '--options', 'approve,veto'], { root })
  assert.equal(a.out, 'r2-launch_approval')
  assert.equal(b.out, 'r2-launch_approval-2')
  const stale = cli('gates', ['list', '--stale', '24'], { root })
  assert.match(stale.out, /r2-launch_approval\t/)
  assert.doesNotMatch(stale.out, /r2-launch_approval-2/)
})
