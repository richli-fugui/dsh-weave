#!/usr/bin/env node
// L0 only: checks specification structure, never invokes DSH, a model or a tool.
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const catalog = JSON.parse(readFileSync(new URL('./scenarios.json', import.meta.url), 'utf8'))
const present = (v) => typeof v === 'string' && v.trim().length > 0
const levels = new Set(['L1', 'L2', 'L3', 'L4'])
const operations = new Set(['fixture.prepare', 'ui.act', 'fault.inject', 'user.say', 'system.observe'])
const expectedCounts = { INTENT: 12, CARD: 10, SCHED: 10, STOP: 24, APPROVAL: 10, CONTEXT: 10, NETWORK: 10, RECOVERY: 10, DATA: 10, OFFICE: 12, UX: 8, SECURITY: 6, PERF: 6, RELEASE: 6 }

assert.equal(catalog.schemaVersion, '1.0')
assert.equal(catalog.status, 'SPECIFICATION_ONLY')
assert.equal(catalog.runtimeExecuted, false, 'This catalog cannot contain product execution claims')
assert.equal(catalog.requiredCaseCount, 144)
assert.equal(catalog.cases.length, 144)
assert.equal(catalog.groups.length, 14)
assert.equal(catalog.invariants.length, 26)
assert.equal(catalog.actionProtocol.unknownOperationPolicy, 'FAIL_NOT_IMPLEMENTED')
assert.deepEqual(new Set(catalog.actionProtocol.allowedOperations), operations)

const invariantIds = new Set()
for (const entry of catalog.invariants) {
  assert.match(entry.id, /^INV[0-9]{2}$/)
  assert.ok(present(entry.description), entry.id + ': missing definition')
  assert.ok(!invariantIds.has(entry.id), 'Duplicate invariant ' + entry.id)
  invariantIds.add(entry.id)
}
const groups = new Map()
for (const group of catalog.groups) {
  assert.ok(Object.hasOwn(expectedCounts, group.id), 'Unknown group ' + group.id)
  assert.ok(!groups.has(group.id), 'Duplicate group ' + group.id)
  assert.equal(group.caseCount, expectedCounts[group.id])
  assert.ok(present(group.title) && present(group.fixtureId))
  assert.ok(group.requiredLevels.length > 0)
  for (const level of group.requiredLevels) assert.ok(levels.has(level))
  groups.set(group.id, group)
}

const ids = new Set()
const covered = new Set()
const counts = {}
const priorities = {}
for (const entry of catalog.cases) {
  const failLabel = entry.id || '(missing ID)'
  assert.ok(!ids.has(entry.id), 'Duplicate case ' + failLabel)
  ids.add(entry.id)
  const group = groups.get(entry.area)
  assert.ok(group, failLabel + ': unknown area')
  assert.match(entry.id, new RegExp('^' + entry.area + '-[0-9]{3}$'))
  assert.ok(present(entry.title), failLabel + ': missing title')
  assert.ok(['P0', 'P1'].includes(entry.priority))
  assert.equal(entry.status, 'PLANNED', failLabel + ': specification is not a test result')
  assert.equal(entry.implementationRequired, true)
  assert.equal(entry.given.fixtureId, group.fixtureId)
  assert.equal(entry.given.variantId, entry.id)
  assert.ok(present(entry.given.premise))
  assert.deepEqual(entry.requiredLevels, group.requiredLevels)
  assert.ok(entry.steps.length >= 3)
  assert.equal(entry.steps[0].op, 'fixture.prepare')
  assert.equal(entry.steps[0].args.fixtureId, entry.given.fixtureId)
  assert.equal(entry.steps[0].args.variantId, entry.id)
  assert.equal(entry.steps.at(-1).op, 'system.observe')
  for (const step of entry.steps) {
    assert.ok(operations.has(step.op), failLabel + ': unsupported protocol operation')
    assert.ok(step.args && typeof step.args === 'object' && !Array.isArray(step.args))
    if (step.op === 'user.say') assert.ok(present(step.args.text))
    if (step.op === 'ui.act') assert.ok(present(step.args.action))
    if (step.op === 'fault.inject') assert.ok(present(step.args.fault))
    if (step.op === 'system.observe') assert.ok(Number.isFinite(step.args.deadlineMs) && step.args.deadlineMs > 0)
  }
  assert.ok(present(entry.expected.narrative))
  assert.ok(entry.expected.invariants.length > 0)
  for (const id of entry.expected.invariants) {
    assert.ok(invariantIds.has(id), failLabel + ': undefined invariant ' + id)
    covered.add(id)
  }
  assert.ok(entry.evidenceRequired.length >= 2)
  for (const evidence of entry.evidenceRequired) assert.ok(present(evidence))
  counts[entry.area] = (counts[entry.area] || 0) + 1
  priorities[entry.priority] = (priorities[entry.priority] || 0) + 1
}
assert.deepEqual(counts, expectedCounts)
assert.deepEqual(covered, invariantIds, 'Every invariant must be referenced')
for (const [area, count] of Object.entries(expectedCounts)) {
  for (let i = 1; i <= count; i++) {
    assert.ok(ids.has(area + '-' + String(i).padStart(3, '0')), 'Missing sequential case in ' + area)
  }
}
console.log(JSON.stringify({
  status: 'CATALOG_VALID',
  catalogVersion: catalog.catalogVersion,
  scenarioCount: catalog.cases.length,
  groupCount: groups.size,
  invariantCount: covered.size,
  priorityCounts: priorities,
  runtimeTestsExecuted: 0,
  note: '仅规格结构检查通过；没有执行任何产品功能测试，不能计为144项PASS。'
}, null, 2))
