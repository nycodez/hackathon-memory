import type { DemoActor } from '@hackathon/shared'
import {
  DEMO_CAPABILITY_KEY,
  DEMO_SUCCESSOR_ID,
  demoCapabilities,
  demoPeople,
  demoProvenance,
  demoTeams,
} from '../data/capability_demo_data.js'
import { decideCapabilityAccess } from './capability_policy_service.js'

export function demoActor(actorId: string): DemoActor | null {
  const person = demoPeople.find((item) => item.id === actorId)
  if (!person) return null
  const team = demoTeams.find((item) => item.id === person.teamId)
  return {
    ...person,
    teamName: team?.name ?? 'Unknown',
    department: team?.department ?? 'Unknown',
  }
}

export function recommendDemoCapabilities(task: string, actor: DemoActor): string[] {
  const taskTerms = new Set(task.toLowerCase().match(/[a-z0-9]+/g) ?? [])
  return demoCapabilities
    .filter((asset) => decideCapabilityAccess(actor, asset).allowed)
    .map((asset) => {
      const terms = `${asset.title} ${asset.summary} ${asset.content}`.toLowerCase().match(/[a-z0-9]+/g) ?? []
      const overlap = terms.reduce((score, term) => score + (taskTerms.has(term) ? 1 : 0), 0)
      const continuity = asset.assetKey === DEMO_CAPABILITY_KEY
        && /accounts payable|weekly ap|pay bills|vendor payment|accounting|continuity|day one/.test(task.toLowerCase()) ? 12 : 0
      const team = asset.ownerTeamId === actor.teamId ? 2 : 0
      return { assetKey: asset.assetKey, score: overlap + continuity + team + asset.outcomeScore }
    })
    .sort((left, right) => right.score - left.score)
    .map((item) => item.assetKey)
}

export function evaluateDemoDeparture(): {
  passed: boolean
  provenancePath: readonly string[]
} {
  const successor = demoActor(DEMO_SUCCESSOR_ID)
  const discoverable = successor
    ? recommendDemoCapabilities('weekly AP run', successor).slice(0, 3).includes(DEMO_CAPABILITY_KEY)
    : false
  const authorship = demoProvenance.includes('AUTHORED_BY Magdalene Choong')
  const stewardship = demoProvenance.includes('STEWARDED_BY Laura Nguyen')
  return { passed: discoverable && authorship && stewardship, provenancePath: demoProvenance }
}
