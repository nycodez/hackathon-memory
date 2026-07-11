import assert from 'node:assert/strict'
import test from 'node:test'
import { demoCapabilities } from '../src/data/capability_demo_data.js'
import { demoActor, evaluateDemoDeparture, recommendDemoCapabilities } from '../src/services/capability_eval_service.js'
import { decideCapabilityAccess, runPortfolioDigest } from '../src/services/capability_policy_service.js'
import { isAllowlistedDemoActorId, selectDemoActorId } from '../src/services/demo_actor_service.js'

test('recommendation gate returns ast-014 in the top three for at least 8/10 tasks', () => {
  const actor = required(demoActor('person-dara-kim'))
  const tasks = [
    'prepare weekly portfolio health digest',
    'find Mai portfolio continuity workflow',
    'summarize health exceptions and owner asks',
    'weekly investment portfolio operator report',
    'create Monday portfolio standup digest',
    'reuse the portfolio KPI follow-up workflow',
    'find a skill for at risk accounts',
    'portfolio action ask report',
    'owner accountability weekly summary',
    'preserve departed employee health check knowledge',
  ]
  const passing = tasks.filter((task) => recommendDemoCapabilities(task, actor).slice(0, 3).includes('ast-014'))
  assert.ok(passing.length >= 8, `expected at least 8/10, received ${passing.length}/10`)
})

test('governance gate passes all seven cases without returning protected content', () => {
  const cases = [
    ['person-dara-kim', 'ast-014', true],
    ['person-dara-kim', 'skill-014', true],
    ['person-dara-kim', 'prompt-014', true],
    ['person-lee-park', 'ast-014', false],
    ['person-dara-kim', 'risk-009', false],
    ['person-alisa-ng', 'risk-009', true],
    ['person-dara-kim', 'agent-014', true],
  ] as const
  for (const [actorId, assetKey, expected] of cases) {
    const actor = required(demoActor(actorId))
    const asset = required(demoCapabilities.find((item) => item.assetKey === assetKey))
    const decision = decideCapabilityAccess(actor, asset)
    assert.equal(decision.allowed, expected, `${actorId} -> ${assetKey}`)
    if (!decision.allowed) assert.ok(!('content' in decision), 'denials must not carry protected content')
  }
})

test('departure continuity preserves authorship and accepted stewardship', () => {
  const departure = evaluateDemoDeparture()
  assert.equal(departure.passed, true)
  assert.ok(departure.provenancePath.includes('AUTHORED_BY Mai Tran'))
  assert.ok(departure.provenancePath.includes('STEWARDED_BY Dara Kim'))
})

test('deterministic skill validates the expected output contract', () => {
  const output = runPortfolioDigest({
    portfolioName: 'Founder Mode Portfolio',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-07',
    atRiskCount: 3,
    ownerAskCount: 5,
  }, 'Dara Kim')
  assert.equal(output.atRiskCount, 3)
  assert.match(String(output.summary), /5 owner asks/)
})

test('unknown actor headers never inherit Dara identity', () => {
  assert.equal(selectDemoActorId(undefined), 'person-dara-kim')
  const supplied = selectDemoActorId('person-unknown')
  assert.equal(supplied, 'person-unknown')
  assert.equal(isAllowlistedDemoActorId(supplied), false)
})

function required<T>(value: T | null | undefined): T {
  assert.ok(value)
  return value
}
