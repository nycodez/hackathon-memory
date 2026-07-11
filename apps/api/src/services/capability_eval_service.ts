import type { DemoActor } from '@hackathon/shared'
import { demoCapabilities, demoPeople, demoProvenance } from '../data/capability_demo_data.js'
import { decideCapabilityAccess } from './capability_policy_service.js'

export function demoActor(actorId: string): DemoActor | null {
  const person = demoPeople.find((item) => item.id === actorId)
  if (!person) return null
  const teams: Record<string, [string, string]> = {
    'team-investments': ['Investment Operations', 'Founder Mode'],
    'team-risk': ['Risk and Controls', 'Founder Mode'],
    'team-growth': ['Growth Strategy', 'Founder Mode'],
  }
  const [teamName, department] = teams[person.teamId] ?? ['Unknown', 'Unknown']
  return { ...person, teamName, department }
}

export function recommendDemoCapabilities(task: string, actor: DemoActor): string[] {
  const taskTerms = new Set(task.toLowerCase().match(/[a-z0-9]+/g) ?? [])
  return demoCapabilities
    .filter((asset) => decideCapabilityAccess(actor, asset).allowed)
    .map((asset) => {
      const terms = `${asset.title} ${asset.summary} ${asset.content}`.toLowerCase().match(/[a-z0-9]+/g) ?? []
      const overlap = terms.reduce((score, term) => score + (taskTerms.has(term) ? 1 : 0), 0)
      const continuity = ['ast-014', 'skill-014'].includes(asset.assetKey) && /portfolio|health|digest|continuity|weekly/.test(task.toLowerCase()) ? 8 : 0
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
  const dara = demoActor('person-dara-kim')
  const discoverable = dara ? recommendDemoCapabilities('prepare the weekly portfolio health digest', dara).slice(0, 3).includes('ast-014') : false
  const authorship = demoProvenance.includes('AUTHORED_BY Mai Tran')
  const stewardship = demoProvenance.includes('STEWARDED_BY Dara Kim')
  return { passed: discoverable && authorship && stewardship, provenancePath: demoProvenance }
}
