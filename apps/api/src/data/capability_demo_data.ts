import type { CapabilityClassification, CapabilityType } from '@hackathon/shared'

export const DEMO_WORKSPACE_ID = 'hackathon-demo'

export const demoTeams = [
  { id: 'team-investments', name: 'Investment Operations', department: 'Founder Mode' },
  { id: 'team-risk', name: 'Risk and Controls', department: 'Founder Mode' },
  { id: 'team-growth', name: 'Growth Strategy', department: 'Founder Mode' },
] as const

export const demoPeople = [
  { id: 'person-mai-tran', name: 'Mai Tran', role: 'Portfolio Operations Lead', teamId: 'team-investments', status: 'departed', clearance: 'confidential' },
  { id: 'person-dara-kim', name: 'Dara Kim', role: 'Portfolio Operations Manager', teamId: 'team-investments', status: 'active', clearance: 'confidential' },
  { id: 'person-lee-park', name: 'Lee Park', role: 'Growth Analyst', teamId: 'team-growth', status: 'active', clearance: 'internal' },
  { id: 'person-alisa-ng', name: 'Alisa Ng', role: 'Risk Steward', teamId: 'team-risk', status: 'active', clearance: 'restricted' },
] as const satisfies ReadonlyArray<{
  id: string
  name: string
  role: string
  teamId: string
  status: 'active' | 'departed'
  clearance: CapabilityClassification
}>

export interface DemoCapability {
  assetKey: string
  type: CapabilityType
  title: string
  summary: string
  content: string
  rationale: string
  classification: CapabilityClassification
  ownerTeamId: string
  version: string
  outcomeScore: number
  usageCount: number
}

export const demoCapabilities: DemoCapability[] = [
  {
    assetKey: 'ast-014',
    type: 'workflow',
    title: 'Portfolio Health-Check Weekly Digest',
    summary: 'Generates weekly portfolio health exceptions, owner asks, and follow-up actions.',
    content: `Portfolio Health-Check Weekly Digest\n\nCollect KPI deltas and operator notes for each portfolio company. Flag red or amber movements, resolve the accountable owner, and write a concise owner ask. Produce an executive summary followed by at-risk accounts, owner asks, and next actions. Run each Friday before the Monday portfolio standup.`,
    rationale: 'Mai refined this workflow over 42 weekly runs. It saves 6.5 hours each week and produces an 88% owner-action completion rate.',
    classification: 'confidential',
    ownerTeamId: 'team-investments',
    version: 'v3.2',
    outcomeScore: 0.94,
    usageCount: 42,
  },
  {
    assetKey: 'prompt-014',
    type: 'prompt',
    title: 'Portfolio Digest Prompt',
    summary: 'Turns portfolio metrics and operator notes into executive digest sections.',
    content: 'Compare this week to the prior period. Return a concise executive summary, material health exceptions, named owner asks, and dated next actions. Do not invent metrics or owners.',
    rationale: 'Structured output makes the digest scannable and keeps every recommendation grounded in supplied portfolio evidence.',
    classification: 'confidential',
    ownerTeamId: 'team-investments',
    version: 'v2.1',
    outcomeScore: 0.91,
    usageCount: 38,
  },
  {
    assetKey: 'agent-014',
    type: 'agent',
    title: 'Portfolio Health Agent',
    summary: 'Resolves portfolio owners, compares KPI deltas, and writes action asks.',
    content: 'The agent reads approved portfolio metrics and notes, identifies meaningful weekly deltas, resolves accountable owners, then invokes the portfolio digest skill.',
    rationale: 'The agent standardizes analysis while preserving citations to the source evidence.',
    classification: 'confidential',
    ownerTeamId: 'team-investments',
    version: 'v1.4',
    outcomeScore: 0.9,
    usageCount: 37,
  },
  {
    assetKey: 'skill-014',
    type: 'skill',
    title: 'Run Portfolio Health Digest',
    summary: 'Runnable skill for generating a portfolio health weekly digest.',
    content: 'Inputs: portfolioName, periodStart, periodEnd, atRiskCount, ownerAskCount. Output: digestTitle, summary, counts, period, and nextAction.',
    rationale: 'A deterministic runtime gives the new steward a safe, repeatable way to reuse Mai’s workflow.',
    classification: 'confidential',
    ownerTeamId: 'team-investments',
    version: 'v1.0',
    outcomeScore: 0.96,
    usageCount: 35,
  },
  {
    assetKey: 'risk-009',
    type: 'decision',
    title: 'Restricted Counterparty Risk Memo',
    summary: 'Restricted risk-team decision record.',
    content: 'Restricted counterparty review content used only by the Risk and Controls team.',
    rationale: 'Demonstrates that retrieval filters protected source chunks before content leaves the database.',
    classification: 'restricted',
    ownerTeamId: 'team-risk',
    version: 'v1.0',
    outcomeScore: 0.82,
    usageCount: 12,
  },
]

export const demoProvenance = [
  'ast-014',
  'AUTHORED_BY Mai Tran',
  'STEWARDED_BY Dara Kim',
] as const
