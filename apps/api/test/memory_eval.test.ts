import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEMO_CAPABILITY_KEY,
  DEMO_SUCCESSOR_ID,
  demoCapabilities,
  demoEvidenceDocuments,
} from '../src/data/capability_demo_data.js'
import { demoActor, evaluateDemoDeparture, recommendDemoCapabilities } from '../src/services/capability_eval_service.js'
import CapabilityExecutionService, { type CapabilityEvidence } from '../src/services/capability_execution_service.js'
import { decideCapabilityAccess } from '../src/services/capability_policy_service.js'
import { isAllowlistedDemoActorId, selectDemoActorId } from '../src/services/demo_actor_service.js'

test('weekly AP recommendation returns the capability in the top three for at least 8/10 tasks', () => {
  const actor = required(demoActor(DEMO_SUCCESSOR_ID))
  const tasks = [
    'weekly AP run',
    'run accounts payable for the property portfolio',
    'find Magdalene vendor payment workflow',
    'pay approved property bills',
    'check open AP and operating cash',
    'reuse the Friday accounting routine',
    'execute vendor payments on day one',
    'find the inherited accounts payable capability',
    'close the weekly AP batch',
    'preserve departed CFO accounting knowledge',
  ]
  const passing = tasks.filter((task) => recommendDemoCapabilities(task, actor).slice(0, 3).includes(DEMO_CAPABILITY_KEY))
  assert.ok(passing.length >= 8, `expected at least 8/10, received ${passing.length}/10`)
})

test('governance allows the successor and withholds accounting content from another team', () => {
  const capability = required(demoCapabilities.find((item) => item.assetKey === DEMO_CAPABILITY_KEY))
  const successor = required(demoActor(DEMO_SUCCESSOR_ID))
  const crossTeam = required(demoActor('person-eugene-koon'))
  const governance = required(demoActor('person-denning-tan'))
  assert.equal(decideCapabilityAccess(successor, capability).allowed, true)
  assert.equal(decideCapabilityAccess(crossTeam, capability).allowed, false)
  assert.equal(decideCapabilityAccess(governance, capability).allowed, true)
})

test('departure continuity preserves Magdalene authorship and Laura stewardship', () => {
  const departure = evaluateDemoDeparture()
  assert.equal(departure.passed, true)
  assert.ok(departure.provenancePath.includes('AUTHORED_BY Magdalene Choong'))
  assert.ok(departure.provenancePath.includes('STEWARDED_BY Laura Nguyen'))
})

test('grounded AP agent executes all five skills and produces the verified outcome', async () => {
  const evidence: CapabilityEvidence[] = demoEvidenceDocuments.map((document, index) => ({
    chunkId: `chunk-${index}`,
    documentId: `document-${index}`,
    documentName: document.name,
    content: document.content,
    score: 1,
    relationship: document.relationship,
  }))
  const result = await new CapabilityExecutionService({
    isConfigured: () => false,
    generate: async () => { throw new Error('disabled in deterministic test') },
  }).runWeeklyAp({
    propertyGroupName: 'Midtown Residential',
    runDate: '2026-07-12',
    paymentAccount: 'Midtown Operating ••1842',
  }, required(demoActor(DEMO_SUCCESSOR_ID)), evidence)
  assert.equal(result.status, 'completed')
  assert.equal(result.skillRuns.length, 5)
  assert.equal(result.output.billsPaid, 3)
  assert.equal(result.output.amountPaid, 18_910)
  assert.equal(result.output.endingBalance, 33_850)
  assert.equal(result.citations.length, 4)
  assert.ok(result.decisionTrace.some((event) => event.stage === 'verification'))
})

test('unknown actor headers never inherit Laura identity', () => {
  assert.equal(selectDemoActorId(undefined), DEMO_SUCCESSOR_ID)
  const supplied = selectDemoActorId('person-unknown')
  assert.equal(supplied, 'person-unknown')
  assert.equal(isAllowlistedDemoActorId(supplied), false)
})

function required<T>(value: T | null | undefined): T {
  assert.ok(value)
  return value
}
