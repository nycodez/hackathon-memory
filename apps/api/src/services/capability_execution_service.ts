import { createHash, randomUUID } from 'node:crypto'
import type {
  CapabilityCitation,
  CapabilityRunOutput,
  CapabilityRunStep,
  DecisionTraceEvent,
  DemoActor,
  RunCapabilityInput,
} from '@hackathon/shared'
import type { SearchMatch } from '../repositories/documents_repository.js'
import BedrockLlmService from './bedrock_llm_service.js'

export interface CapabilityEvidence extends SearchMatch {
  relationship: CapabilityCitation['relationship']
}

export interface CapabilityExecutionResult {
  status: 'completed' | 'blocked'
  output: CapabilityRunOutput
  skillRuns: CapabilityRunStep[]
  citations: CapabilityCitation[]
  decisionTrace: DecisionTraceEvent[]
}

export default class CapabilityExecutionService {
  constructor(private readonly bedrock: Pick<BedrockLlmService, 'isConfigured' | 'generate'> = new BedrockLlmService()) {}

  async runWeeklyAp(
    input: RunCapabilityInput,
    actor: DemoActor,
    evidence: CapabilityEvidence[]
  ): Promise<CapabilityExecutionResult> {
    const startedAt = new Date().toISOString()
    const citations = evidence.map((item, index): CapabilityCitation => ({
      label: `S${index + 1}`,
      documentId: item.documentId,
      documentName: item.documentName,
      chunkId: item.chunkId,
      excerpt: item.content.replace(/\s+/g, ' ').trim().slice(0, 420),
      score: Number(item.score.toFixed(4)),
      relationship: item.relationship,
    }))
    const trace: DecisionTraceEvent[] = [
      traceEvent('input', 'Weekly AP run accepted', `Scoped the run to ${input.propertyGroupName} on ${input.runDate}.`, 'accepted'),
      traceEvent('governance', 'Actor and installation authorized', `${actor.name} is active, has confidential Property Accounting access, and installed the pinned capability version.`, 'completed'),
      traceEvent('retrieval', 'Learning Library evidence loaded', `Loaded ${citations.length} permission-checked source passages for the AP run.`, citations.length ? 'completed' : 'no_match'),
    ]

    const apDocument = evidence.find((item) => item.documentName.includes('open-ap'))?.content ?? ''
    const cashDocument = evidence.find((item) => item.documentName.includes('cash-position'))?.content ?? ''
    const approvalDocument = evidence.find((item) => item.documentName.includes('payment-approvals'))?.content ?? ''
    const billsReviewed = (apDocument.match(/^AP-/gm) ?? []).length
    const approvalCount = (approvalDocument.match(/^APR-/gm) ?? []).length
    const amountPaid = moneyAfter(apDocument, 'Open due total:')
    const openingBalance = moneyAfter(cashDocument, 'Verified available balance:')
    const reserveBalance = moneyAfter(cashDocument, 'Required post-payment reserve:')
    const evidenceComplete = citations.length >= 4 && billsReviewed > 0 && approvalCount === billsReviewed
      && amountPaid > 0 && openingBalance > 0 && reserveBalance > 0
    const reservePasses = openingBalance - amountPaid >= reserveBalance
    const paymentAllowed = evidenceComplete && reservePasses
    const endingBalance = paymentAllowed ? openingBalance - amountPaid : openingBalance
    const paymentBatchId = paymentAllowed
      ? `AP-${createHash('sha256').update(`${input.propertyGroupName}|${input.runDate}|${input.paymentAccount}`).digest('hex').slice(0, 10).toUpperCase()}`
      : ''

    trace.push(traceEvent(
      'planning',
      'Five-skill execution plan created',
      'Open site → check open AP → verify balance → pay approved bills → close session.',
      'completed'
    ))

    const skillRuns: CapabilityRunStep[] = []
    skillRuns.push(step(
      'skill-ap-open-site',
      'Open Property Accounting Site',
      'completed',
      `Opened a scoped accounting session for ${input.propertyGroupName}.`,
      { propertyGroupName: input.propertyGroupName, paymentAccount: input.paymentAccount },
      ['S1'],
      startedAt
    ))
    skillRuns.push(step(
      'skill-ap-check-open',
      'Check Open Accounts Payable',
      evidenceComplete ? 'completed' : 'blocked',
      evidenceComplete
        ? `Matched ${billsReviewed} due invoices to ${approvalCount} approval records.`
        : 'Stopped because the open AP and approval evidence was incomplete.',
      { billsReviewed, approvalCount, approvedTotal: amountPaid },
      labelsFor(citations, ['open-ap', 'payment-approvals']),
      startedAt
    ))
    skillRuns.push(step(
      'skill-ap-verify-balance',
      'Verify Operating Balance',
      reservePasses ? 'completed' : 'blocked',
      reservePasses
        ? `Verified the batch leaves $${formatMoney(endingBalance)} above the $${formatMoney(reserveBalance)} reserve.`
        : 'Stopped because the approved batch would breach the required reserve.',
      { openingBalance, reserveBalance, projectedEndingBalance: endingBalance },
      labelsFor(citations, ['cash-position']),
      startedAt
    ))
    skillRuns.push(step(
      'skill-ap-pay-approved',
      'Pay Approved Vendor Bills',
      paymentAllowed ? 'completed' : 'blocked',
      paymentAllowed
        ? `Submitted idempotent payment batch ${paymentBatchId} for $${formatMoney(amountPaid)}.`
        : 'No payment was submitted because an evidence or reserve gate blocked the run.',
      { paymentBatchId: paymentBatchId || 'not-created', billsPaid: paymentAllowed ? billsReviewed : 0, amountPaid: paymentAllowed ? amountPaid : 0 },
      labelsFor(citations, ['open-ap', 'cash-position', 'payment-approvals']),
      startedAt
    ))
    skillRuns.push(step(
      'skill-ap-close-session',
      'Close Accounting Session',
      'completed',
      paymentAllowed
        ? `Verified ${paymentBatchId}, recorded ending cash, and closed the session.`
        : 'Recorded the blocked outcome and closed the scoped session without payment.',
      { endingBalance, sessionClosed: true },
      labelsFor(citations, ['ap-playbook', 'cash-position']),
      startedAt
    ))

    for (const item of skillRuns) {
      trace.push(traceEvent('execution', item.title, item.detail, item.status === 'completed' ? 'completed' : 'guardrail'))
    }
    trace.push(traceEvent(
      'verification',
      paymentAllowed ? 'Payment outcome verified' : 'Stop condition verified',
      paymentAllowed
        ? `${billsReviewed} bills paid once; ending operating cash is $${formatMoney(endingBalance)}.`
        : 'The agent produced no payment side effect and retained the blocking evidence.',
      paymentAllowed ? 'completed' : 'guardrail'
    ))

    const deterministicSummary = paymentAllowed
      ? `${actor.name} completed the weekly AP run for ${input.propertyGroupName}: ${billsReviewed} approved bills totaling $${formatMoney(amountPaid)} were paid in batch ${paymentBatchId}; ending operating cash is $${formatMoney(endingBalance)}. [${labelsFor(citations, ['open-ap']).join(', ')}] [${labelsFor(citations, ['cash-position']).join(', ')}]`
      : `${actor.name}'s weekly AP run for ${input.propertyGroupName} was blocked before payment because the grounded approval or reserve checks did not pass.`
    let summary = deterministicSummary
    let generationMode: CapabilityRunOutput['generationMode'] = 'deterministic-grounded-fallback'

    if (this.bedrock.isConfigured() && evidence.length) {
      try {
        const generated = await this.bedrock.generate(
          `Write a one-paragraph AP run receipt for ${input.propertyGroupName}. State whether payment completed, bills paid, amount paid, batch ID, ending balance, and reserve. Cite every financial fact. The verified deterministic result is: ${deterministicSummary}`,
          evidence
        )
        summary = generated.text
        generationMode = 'bedrock-grounded'
      } catch (error) {
        trace.push(traceEvent('response', 'Bedrock fallback applied', `Grounded generation was unavailable (${errorName(error)}); retained the deterministic cited receipt.`, 'guardrail'))
      }
    }

    if (!trace.some((event) => event.stage === 'response')) {
      trace.push(traceEvent(
        'response',
        generationMode === 'bedrock-grounded' ? 'Grounded Bedrock receipt generated' : 'Deterministic grounded receipt generated',
        `Returned a cited outcome using ${generationMode}.`,
        generationMode === 'bedrock-grounded' ? 'completed' : 'guardrail'
      ))
    }

    return {
      status: paymentAllowed ? 'completed' : 'blocked',
      output: {
        summary,
        result: paymentAllowed ? 'paid' : 'blocked',
        paymentBatchId,
        billsReviewed,
        billsPaid: paymentAllowed ? billsReviewed : 0,
        amountPaid: paymentAllowed ? amountPaid : 0,
        openingBalance,
        endingBalance,
        reserveBalance,
        currency: 'USD',
        generationMode,
      },
      skillRuns,
      citations,
      decisionTrace: trace,
    }
  }
}

function moneyAfter(content: string, label: string): number {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = content.match(new RegExp(`${escaped}\\s*\\$([0-9,]+(?:\\.[0-9]{2})?)`, 'i'))
  return match?.[1] ? Number(match[1].replace(/,/g, '')) : 0
}

function labelsFor(citations: CapabilityCitation[], documentFragments: string[]): string[] {
  return citations
    .filter((citation) => documentFragments.some((fragment) => citation.documentName.includes(fragment)))
    .map((citation) => citation.label)
}

function step(
  skillKey: string,
  title: string,
  status: CapabilityRunStep['status'],
  detail: string,
  output: CapabilityRunStep['output'],
  citationLabels: string[],
  startedAt: string
): CapabilityRunStep {
  return { skillKey, title, status, detail, output, citationLabels, startedAt, completedAt: new Date().toISOString() }
}

function traceEvent(
  stage: DecisionTraceEvent['stage'],
  title: string,
  detail: string,
  outcome: DecisionTraceEvent['outcome']
): DecisionTraceEvent {
  return { id: `${stage}-${randomUUID()}`, stage, title, detail, outcome, createdAt: new Date().toISOString() }
}

function formatMoney(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError'
}
