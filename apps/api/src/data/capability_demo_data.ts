import type { CapabilityClassification, CapabilityType } from '@hackathon/shared'

export const DEMO_WORKSPACE_ID = 'hackathon-demo'
export const DEMO_OPERATIONS_TEAM_ID = 'team-property-operations'

export const demoTeams = [
  { id: DEMO_OPERATIONS_TEAM_ID, name: 'Property Operations', department: 'Property Management' },
  { id: 'team-risk', name: 'Risk and Compliance', department: 'Property Management' },
  { id: 'team-growth', name: 'Leasing and Resident Experience', department: 'Property Management' },
] as const

export const demoPeople = [
  { id: 'person-mai-tran', name: 'Mai Tran', role: 'Regional Property Operations Lead', teamId: DEMO_OPERATIONS_TEAM_ID, status: 'departed', clearance: 'confidential' },
  { id: 'person-dara-kim', name: 'Dara Kim', role: 'Property Operations Manager', teamId: DEMO_OPERATIONS_TEAM_ID, status: 'active', clearance: 'confidential' },
  { id: 'person-lee-park', name: 'Lee Park', role: 'Leasing Analyst', teamId: 'team-growth', status: 'active', clearance: 'internal' },
  { id: 'person-alisa-ng', name: 'Alisa Ng', role: 'Compliance Steward', teamId: 'team-risk', status: 'active', clearance: 'restricted' },
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
    title: 'Property Operations Weekly Digest',
    summary: 'Generates weekly property exceptions, work-order escalations, and resident follow-ups.',
    content: `Property Operations Weekly Digest\n\nCollect occupancy, delinquency, open work-order, inspection, and resident-escalation notes for each property. Flag material exceptions, resolve the accountable property manager, and write a dated follow-up. Produce a regional summary followed by urgent work orders, resident follow-ups, and next actions. Run each Friday before the Monday property-operations standup.`,
    rationale: 'Mai refined this workflow over 42 weekly runs. It saves 6.5 hours each week and produces an 88% follow-up completion rate across managed properties.',
    classification: 'confidential',
    ownerTeamId: DEMO_OPERATIONS_TEAM_ID,
    version: 'v3.2',
    outcomeScore: 0.94,
    usageCount: 42,
  },
  {
    assetKey: 'prompt-014',
    type: 'prompt',
    title: 'Property Operations Digest Prompt',
    summary: 'Turns property metrics and manager notes into a regional operations digest.',
    content: 'Compare this week to the prior period. Return a concise regional summary, material occupancy or delinquency exceptions, urgent work orders, named resident follow-ups, and dated next actions. Do not invent metrics, properties, residents, or owners.',
    rationale: 'Structured output makes the digest scannable and keeps every recommendation grounded in supplied property-management evidence.',
    classification: 'confidential',
    ownerTeamId: DEMO_OPERATIONS_TEAM_ID,
    version: 'v2.1',
    outcomeScore: 0.91,
    usageCount: 38,
  },
  {
    assetKey: 'agent-014',
    type: 'agent',
    title: 'Property Operations Health Agent',
    summary: 'Compares property metrics, resolves responsible managers, and drafts follow-ups.',
    content: 'The agent reads approved property metrics and manager notes, identifies meaningful weekly exceptions, resolves the accountable property manager, then invokes the property-operations digest skill.',
    rationale: 'The agent standardizes analysis while preserving citations to the source evidence.',
    classification: 'confidential',
    ownerTeamId: DEMO_OPERATIONS_TEAM_ID,
    version: 'v1.4',
    outcomeScore: 0.9,
    usageCount: 37,
  },
  {
    assetKey: 'skill-014',
    type: 'skill',
    title: 'Run Property Operations Digest',
    summary: 'Runnable skill for generating a weekly property-operations digest.',
    content: 'Inputs: propertyGroupName, periodStart, periodEnd, urgentWorkOrderCount, residentFollowUpCount. Output: digestTitle, summary, counts, period, and nextAction.',
    rationale: 'A deterministic runtime gives the new steward a safe, repeatable way to reuse Mai’s workflow.',
    classification: 'confidential',
    ownerTeamId: DEMO_OPERATIONS_TEAM_ID,
    version: 'v1.0',
    outcomeScore: 0.96,
    usageCount: 35,
  },
  {
    assetKey: 'risk-009',
    type: 'decision',
    title: 'Restricted Vendor Compliance Decision',
    summary: 'Restricted property-vendor compliance decision record.',
    content: 'Restricted insurance, licensing, and remediation review content used only by the Risk and Compliance team.',
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
