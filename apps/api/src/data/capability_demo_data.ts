import type { CapabilityClassification, CapabilityType } from '@hackathon/shared'

export const DEMO_WORKSPACE_ID = 'hackathon-demo'
export const DEMO_ACCOUNTING_TEAM_ID = 'team-property-accounting'
export const DEMO_CAPABILITY_KEY = 'ap-weekly-run'
export const DEMO_SUCCESSOR_ID = 'person-laura-nguyen'
export const DEMO_AUTHOR_ID = 'person-magdalene-choong'
export const DEMO_GOVERNANCE_ID = 'person-denning-tan'

export const demoTeams = [
  { id: DEMO_ACCOUNTING_TEAM_ID, name: 'Property Accounting', department: 'Property Management' },
  { id: 'team-operations', name: 'Property Operations', department: 'Property Management' },
  { id: 'team-governance', name: 'Governance and Controls', department: 'Property Management' },
] as const

export const demoPeople = [
  { id: DEMO_AUTHOR_ID, name: 'Magdalene Choong', role: 'CFO', teamId: DEMO_ACCOUNTING_TEAM_ID, status: 'departed', clearance: 'confidential' },
  { id: DEMO_SUCCESSOR_ID, name: 'Laura Nguyen', role: 'Partner', teamId: DEMO_ACCOUNTING_TEAM_ID, status: 'active', clearance: 'confidential' },
  { id: 'person-eugene-koon', name: 'Eugene Koon', role: 'Head of Programs', teamId: 'team-operations', status: 'active', clearance: 'internal' },
  { id: DEMO_GOVERNANCE_ID, name: 'Denning Tan', role: 'Partner', teamId: 'team-governance', status: 'active', clearance: 'restricted' },
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
    assetKey: DEMO_CAPABILITY_KEY,
    type: 'workflow',
    title: 'Weekly Accounts Payable Run',
    summary: 'A governed property-accounting capability that reviews open AP, verifies cash, pays approved bills, and closes the accounting session.',
    content: `Weekly Accounts Payable Run

Goal: finish the approved weekly AP batch for a managed-property group with a cited, auditable result.

The capability is composed of five versioned skills:
1. Open the property-accounting site in a scoped session.
2. Check open AP and select only approved, due invoices.
3. Verify the operating-account balance and minimum reserve.
4. Submit the approved payment batch with idempotency protection.
5. Close the accounting session and record the outcome.

The agent must ground every financial fact in Learning Library evidence, stop if approvals or cash are insufficient, and persist its decision trace, citations, skill results, and final outcome.`,
    rationale: 'The workflow turns a person-dependent accounting routine into a reusable runbook. Prior runs completed in under four minutes with every payment tied to an approval and source record.',
    classification: 'confidential',
    ownerTeamId: DEMO_ACCOUNTING_TEAM_ID,
    version: 'v4.0',
    outcomeScore: 0.98,
    usageCount: 42,
  },
  {
    assetKey: 'skill-ap-open-site',
    type: 'skill',
    title: 'Open Property Accounting Site',
    summary: 'Starts a workspace-scoped accounting session for the selected property group.',
    content: 'Validate the active actor, property group, and run date. Open a scoped accounting session. Never reuse credentials or session state from another actor.',
    rationale: 'Explicit session scoping prevents cross-property and cross-actor accounting actions.',
    classification: 'confidential',
    ownerTeamId: DEMO_ACCOUNTING_TEAM_ID,
    version: 'v1.2',
    outcomeScore: 0.97,
    usageCount: 42,
  },
  {
    assetKey: 'skill-ap-check-open',
    type: 'skill',
    title: 'Check Open Accounts Payable',
    summary: 'Retrieves due vendor invoices and filters the batch to documented approvals.',
    content: 'Read the open AP report and approval register. Include only invoices that are due, approved, non-duplicate, and assigned to the selected property group.',
    rationale: 'The approval intersection keeps unapproved and duplicate invoices out of the payment batch.',
    classification: 'confidential',
    ownerTeamId: DEMO_ACCOUNTING_TEAM_ID,
    version: 'v2.3',
    outcomeScore: 0.99,
    usageCount: 42,
  },
  {
    assetKey: 'skill-ap-verify-balance',
    type: 'skill',
    title: 'Verify Operating Balance',
    summary: 'Checks available cash and the required property reserve before payment.',
    content: 'Read the verified operating balance and reserve requirement. Block the run unless the approved batch can be paid without breaching reserve.',
    rationale: 'A separate balance gate prevents a valid invoice batch from creating an invalid cash position.',
    classification: 'confidential',
    ownerTeamId: DEMO_ACCOUNTING_TEAM_ID,
    version: 'v1.5',
    outcomeScore: 0.99,
    usageCount: 42,
  },
  {
    assetKey: 'skill-ap-pay-approved',
    type: 'skill',
    title: 'Pay Approved Vendor Bills',
    summary: 'Submits one idempotent payment batch for the approved invoices.',
    content: 'Create a payment batch keyed by property group and run date. Record vendor, invoice, amount, approval reference, payment account, and batch ID. A repeated request must return the original batch rather than pay twice.',
    rationale: 'The deterministic idempotency key protects the highest-risk step from duplicate payment.',
    classification: 'confidential',
    ownerTeamId: DEMO_ACCOUNTING_TEAM_ID,
    version: 'v3.1',
    outcomeScore: 0.99,
    usageCount: 42,
  },
  {
    assetKey: 'skill-ap-close-session',
    type: 'skill',
    title: 'Close Accounting Session',
    summary: 'Verifies the batch result, records ending cash, and closes the scoped session.',
    content: 'Confirm the payment batch once, calculate ending cash, persist citations and decisions, then close the accounting session even when a prior skill blocks.',
    rationale: 'A formal close step leaves a complete handoff record instead of hidden browser state.',
    classification: 'confidential',
    ownerTeamId: DEMO_ACCOUNTING_TEAM_ID,
    version: 'v1.4',
    outcomeScore: 0.98,
    usageCount: 42,
  },
]

export const demoEvidenceDocuments = [
  {
    key: 'ap-playbook',
    name: 'weekly-ap-run-playbook.md',
    relationship: 'instructions' as const,
    content: `Weekly AP Run Playbook — Property Accounting

Run every Friday for the selected managed-property group. Open a scoped accounting session; reconcile the open AP report to the approval register; verify operating cash remains above the required reserve; submit one idempotent payment batch; verify the batch; record ending cash; close the session.

Stop conditions: missing approval, duplicate invoice, insufficient available cash, reserve breach, or an unverified payment result. Every completed run must retain citations and a decision trace.`,
  },
  {
    key: 'open-ap',
    name: 'midtown-open-ap-2026-07-10.md',
    relationship: 'evidence' as const,
    content: `Midtown Residential — Open Accounts Payable — 10 July 2026

AP-1042 | Metro Water | Utilities | Due 12 July 2026 | $12,480.00 | Approval APR-701
AP-1048 | Apex Elevator | Maintenance | Due 12 July 2026 | $4,250.00 | Approval APR-704
AP-1051 | GreenScape | Grounds | Due 12 July 2026 | $2,180.00 | Approval APR-709

Open due total: $18,910.00. No duplicate invoice numbers detected.`,
  },
  {
    key: 'cash-position',
    name: 'midtown-cash-position-2026-07-10.md',
    relationship: 'evidence' as const,
    content: `Midtown Residential — Verified Cash Position — 10 July 2026

Operating account: Midtown Operating ••1842
Verified available balance: $52,760.00
Required post-payment reserve: $25,000.00
Maximum payable without reserve breach: $27,760.00
Verified by property accounting at 08:45 UTC.`,
  },
  {
    key: 'approvals',
    name: 'midtown-payment-approvals-2026-07-10.md',
    relationship: 'decision_context' as const,
    content: `Midtown Residential — Vendor Payment Approvals — 10 July 2026

APR-701 approves AP-1042 Metro Water for $12,480.00.
APR-704 approves AP-1048 Apex Elevator for $4,250.00.
APR-709 approves AP-1051 GreenScape for $2,180.00.

Approved batch total: $18,910.00. Approval scope: weekly AP run dated 12 July 2026.`,
  },
] as const

export const demoProvenance = [
  DEMO_CAPABILITY_KEY,
  'AUTHORED_BY Magdalene Choong',
  'STEWARDED_BY Laura Nguyen',
] as const
