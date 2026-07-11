import type { CapabilityClassification, DemoActor, RunCapabilityInput } from '@hackathon/shared'

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

export function runPropertyOperationsDigest(input: RunCapabilityInput, actorName: string): Record<string, string | number | boolean> {
  return {
    digestTitle: `${input.propertyGroupName} property operations digest`,
    summary: `${input.urgentWorkOrderCount} urgent work orders need attention; ${input.residentFollowUpCount} resident follow-ups are ready for action.`,
    urgentWorkOrderCount: input.urgentWorkOrderCount,
    residentFollowUpCount: input.residentFollowUpCount,
    period: `${input.periodStart} to ${input.periodEnd}`,
    nextAction: `Send ${actorName}'s digest to property managers before Monday operations standup.`,
  }
}
