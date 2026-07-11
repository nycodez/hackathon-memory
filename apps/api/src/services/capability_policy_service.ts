import type { CapabilityClassification, DemoActor } from '@hackathon/shared'

const clearanceRank: Record<CapabilityClassification, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
}

export interface GovernedAsset {
  classification: CapabilityClassification
  ownerTeamId: string
}

export interface GovernanceDecision {
  allowed: boolean
  reason: string
}

export function decideCapabilityAccess(actor: DemoActor, asset: GovernedAsset): GovernanceDecision {
  const hasClearance = clearanceRank[actor.clearance] >= clearanceRank[asset.classification]
  const hasTeamAccess = asset.classification === 'public'
    || asset.classification === 'internal'
    || actor.teamId === asset.ownerTeamId
    || actor.clearance === 'restricted'
  const allowed = actor.status === 'active' && hasClearance && hasTeamAccess

  return {
    allowed,
    reason: allowed
      ? `Allowed for ${actor.name} with ${actor.clearance} clearance.`
      : `Denied: ${actor.name} lacks active status, clearance, or team access for ${asset.classification} memory.`,
  }
}
