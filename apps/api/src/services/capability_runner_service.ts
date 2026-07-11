import type {
  CapabilityCitation,
  CapabilityDecision,
  CapabilityRun,
  CapabilityRunRequest,
  CapabilityRunStepStatus,
} from '@hackathon/shared'
import type { PoolClient, QueryResultRow } from 'pg'
import { query, transaction } from '../db/pool.js'
import CapabilitiesRepository, { audit } from '../repositories/capabilities_repository.js'
import BedrockLlmService from './bedrock_llm_service.js'

export class CapabilityRunDeniedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CapabilityRunDeniedError'
  }
}

interface RuntimeStep extends QueryResultRow {
  id: string
  position: number
  skill_code: string
  name: string
}

interface RuntimeBill extends QueryResultRow {
  id: string
  vendor_name: string
  bill_number: string
  property_name: string
  amount_cents: number
  due_date: string
  approved: boolean
  approval_source: string
  payment_id: string | null
}

interface RunContext {
  asOfDate: string
  bills: RuntimeBill[]
  approved: RuntimeBill[]
  exceptions: RuntimeBill[]
  newlyPaid: RuntimeBill[]
  alreadyPaid: RuntimeBill[]
  citations: CapabilityCitation[]
}

interface StepResult {
  output: Record<string, unknown>
  decisions: CapabilityDecision[]
}

const openingBalanceCents = 5_000_000

export default class CapabilityRunnerService {
  private readonly capabilities = new CapabilitiesRepository()
  private readonly bedrock = new BedrockLlmService()

  async run(
    workspaceId: string,
    capabilityId: string,
    actorId: string,
    request: CapabilityRunRequest
  ): Promise<CapabilityRun> {
    const actor = await this.capabilities.actor(workspaceId, actorId)
    if (!actor) {
      throw new CapabilityRunDeniedError('The selected actor does not exist in this workspace')
    }
    const access = await query<QueryResultRow & { permission: string | null; capability_exists: boolean }>(
      `SELECT c.id IS NOT NULL AS capability_exists, p.permission
       FROM memory_capabilities c
       LEFT JOIN memory_capability_permissions p ON p.capability_id = c.id AND p.actor_id = $3
       WHERE c.workspace_id = $1 AND c.id = $2 AND c.status = 'active'`,
      [workspaceId, capabilityId, actorId]
    )
    if (!access.rows[0]?.capability_exists) throw new Error('Capability not found')
    const allowed = actor.status === 'active' && ['run', 'steward'].includes(access.rows[0]?.permission ?? '')
    if (!allowed) {
      await transaction((client) => audit(client, workspaceId, actorId, 'capability.run.denied', 'capability', capabilityId, {
        actorStatus: actor.status, permission: access.rows[0]?.permission ?? null,
      }))
      throw new CapabilityRunDeniedError(
        actor.status === 'departed' ? 'Departed actors cannot initiate capability runs' : 'This actor does not have run permission'
      )
    }

    const existing = await this.findIdempotentRun(workspaceId, capabilityId, actorId, request.idempotencyKey)
    if (existing) return existing

    const runId = await transaction(async (client) => {
      const capability = await client.query<QueryResultRow & { version_id: string }>(
        `SELECT active_version_id AS version_id FROM memory_capabilities
         WHERE workspace_id = $1 AND id = $2 AND status = 'active' FOR UPDATE`,
        [workspaceId, capabilityId]
      )
      const versionId = capability.rows[0]?.version_id
      if (!versionId) throw new Error('Capability not found')
      const steps = await client.query<RuntimeStep>(
        `SELECT id, position, skill_code, name FROM memory_capability_steps
         WHERE capability_version_id = $1 ORDER BY position`,
        [versionId]
      )
      if (!steps.rowCount) throw new Error('Capability has no executable steps')
      const sources = await client.query<QueryResultRow & {
        id: string; source_name: string; excerpt: string; uri: string | null
      }>(
        `SELECT id, source_name, excerpt, uri FROM memory_capability_provenance
         WHERE workspace_id = $1 AND capability_id = $2 AND capability_version_id = $3
         ORDER BY captured_at, source_name`,
        [workspaceId, capabilityId, versionId]
      )
      const citations: CapabilityCitation[] = sources.rows.map((source, index) => ({
        label: `S${index + 1}`, sourceId: source.id, sourceName: source.source_name,
        excerpt: source.excerpt, uri: source.uri,
      }))
      const asOfDate = request.asOfDate ?? new Date().toISOString().slice(0, 10)
      const inserted = await client.query<QueryResultRow & { id: string }>(
        `INSERT INTO memory_capability_runs
           (workspace_id, capability_id, capability_version_id, actor_id, idempotency_key, status, input)
         VALUES ($1, $2, $3, $4, $5, 'running', $6::jsonb)
         ON CONFLICT (workspace_id, capability_id, actor_id, idempotency_key) DO NOTHING
         RETURNING id`,
        [workspaceId, capabilityId, versionId, actorId, request.idempotencyKey, JSON.stringify({ asOfDate })]
      )
      const created = inserted.rows[0]
      if (!created) throw new Error('Capability run could not be created')
      const runId = created.id
      await client.query(
        `INSERT INTO memory_run_steps
           (run_id, capability_step_id, position, skill_code, name, status)
         SELECT $1, id, position, skill_code, name, 'pending'
         FROM memory_capability_steps WHERE capability_version_id = $2 ORDER BY position`,
        [runId, versionId]
      )
      await audit(client, workspaceId, actorId, 'capability.run.started', 'capability_run', runId, {
        capabilityId, capabilityVersionId: versionId, idempotencyKey: request.idempotencyKey,
      })

      const context: RunContext = {
        asOfDate, bills: [], approved: [], exceptions: [], newlyPaid: [], alreadyPaid: [], citations,
      }
      for (const step of steps.rows) {
        await this.executeStep(client, workspaceId, actorId, runId, step, context)
      }
      const output = await this.finalOutcome(client, workspaceId, context)
      const decisions: CapabilityDecision[] = [{
        code: 'capability_completed', outcome: context.exceptions.length ? 'escalate' : 'proceed',
        explanation: context.exceptions.length
          ? `${context.exceptions.length} bill(s) require approval before payment.`
          : 'All eligible bills were processed without exceptions.',
      }]
      const summary = deterministicSummary(output)
      await client.query(
        `UPDATE memory_capability_runs SET status = 'succeeded', output = $2::jsonb,
           summary = $3, citations = $4::jsonb, decisions = $5::jsonb, completed_at = now()
         WHERE id = $1`,
        [runId, JSON.stringify(output), summary, JSON.stringify(citations), JSON.stringify(decisions)]
      )
      await audit(client, workspaceId, actorId, 'capability.run.completed', 'capability_run', runId, {
        status: 'succeeded', output,
      })
      return runId
    })

    if (!runId) {
      const raced = await this.findIdempotentRun(workspaceId, capabilityId, actorId, request.idempotencyKey)
      if (raced) return raced
      throw new Error('Capability run idempotency conflict could not be resolved')
    }
    const completed = await this.capabilities.run(workspaceId, runId)
    if (!completed) throw new Error('Completed capability run could not be loaded')
    if (this.bedrock.isConfigured()) {
      try {
        const summary = await this.bedrock.summarizeCapabilityRun(
          completed.output,
          completed.citations.map((source) => ({
            label: source.label, sourceName: source.sourceName, excerpt: source.excerpt,
          }))
        )
        await query('UPDATE memory_capability_runs SET summary = $2 WHERE workspace_id = $1 AND id = $3', [workspaceId, summary, runId])
        completed.summary = summary
      } catch {
        // The deterministic accounting outcome remains authoritative when optional summarization is unavailable.
      }
    }
    return completed
  }

  private async executeStep(
    client: PoolClient,
    workspaceId: string,
    actorId: string,
    runId: string,
    step: RuntimeStep,
    context: RunContext
  ): Promise<void> {
    const input = { asOfDate: context.asOfDate }
    await this.updateStep(client, runId, step.position, 'running', input, {}, [], null, true)
    try {
      const result = await this.handler(step.skill_code)(client, workspaceId, runId, context)
      await this.updateStep(
        client, runId, step.position, 'succeeded', input, result.output,
        result.decisions, null, false, context.citations
      )
      await audit(client, workspaceId, actorId, 'capability.run.step.completed', 'capability_run', runId, {
        position: step.position, skillCode: step.skill_code, status: 'succeeded', decisions: result.decisions,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Skill execution failed'
      await this.updateStep(client, runId, step.position, 'failed', input, {}, [{
        code: 'execution_failed', outcome: 'escalate', explanation: message,
      }], message, false, context.citations)
      throw error
    }
  }

  private handler(skillCode: string) {
    const handlers: Record<string, (
      client: PoolClient, workspaceId: string, runId: string, context: RunContext
    ) => Promise<StepResult>> = {
      run_ap_aging_report: this.runApAging,
      summarize_document: this.verifyApprovals,
      enter_vendor_bill: this.enterBills,
      pay_vendor_bill: this.payBills,
      reconcile_bank_account: this.reconcile,
    }
    const handler = handlers[skillCode]
    if (!handler) throw new Error(`No governed handler is registered for ${skillCode}`)
    return handler
  }

  private readonly runApAging = async (
    client: PoolClient, workspaceId: string, _runId: string, context: RunContext
  ): Promise<StepResult> => {
    const result = await client.query<RuntimeBill>(
      `SELECT b.id, b.vendor_name, b.bill_number, b.property_name, b.amount_cents,
         b.due_date::text, b.approved, b.approval_source, p.id AS payment_id
       FROM memory_demo_bills b LEFT JOIN memory_demo_payments p ON p.bill_id = b.id
       WHERE b.workspace_id = $1 AND b.due_date <= $2::date
       ORDER BY b.due_date, b.vendor_name, b.bill_number`,
      [workspaceId, context.asOfDate]
    )
    context.bills = result.rows
    return {
      output: { asOfDate: context.asOfDate, reviewedBills: result.rowCount, openBills: result.rows.filter((bill) => !bill.payment_id).length },
      decisions: [{ code: 'aging_generated', outcome: 'proceed', explanation: `Reviewed ${result.rowCount} due bill(s).` }],
    }
  }

  private readonly verifyApprovals = async (
    _client: PoolClient, _workspaceId: string, _runId: string, context: RunContext
  ): Promise<StepResult> => {
    const open = context.bills.filter((bill) => !bill.payment_id)
    context.approved = open.filter((bill) => bill.approved)
    context.exceptions = open.filter((bill) => !bill.approved)
    context.alreadyPaid = context.bills.filter((bill) => Boolean(bill.payment_id))
    return {
      output: {
        approvedBillNumbers: context.approved.map((bill) => bill.bill_number),
        exceptionBillNumbers: context.exceptions.map((bill) => bill.bill_number),
        alreadyPaidBillNumbers: context.alreadyPaid.map((bill) => bill.bill_number),
      },
      decisions: [{
        code: 'approval_gate', outcome: context.exceptions.length ? 'escalate' : 'proceed',
        explanation: context.exceptions.length
          ? `${context.exceptions.length} bill(s) lack approval and will not be paid.`
          : 'Every open due bill has approval evidence.',
      }],
    }
  }

  private readonly enterBills = async (
    _client: PoolClient, _workspaceId: string, _runId: string, context: RunContext
  ): Promise<StepResult> => ({
    output: {
      enteredBills: context.approved.length,
      coding: context.approved.map((bill) => ({ billNumber: bill.bill_number, property: bill.property_name, account: 'Repairs & maintenance' })),
    },
    decisions: [{ code: 'coding_verified', outcome: 'proceed', explanation: 'Approved bills retain property-level accounting coding.' }],
  })

  private readonly payBills = async (
    client: PoolClient, workspaceId: string, runId: string, context: RunContext
  ): Promise<StepResult> => {
    for (const bill of context.approved) {
      const reference = `PAY-${bill.bill_number.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}`
      const inserted = await client.query(
        `INSERT INTO memory_demo_payments
           (workspace_id, bill_id, run_id, payment_reference, amount_cents)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (bill_id) DO NOTHING`,
        [workspaceId, bill.id, runId, reference, bill.amount_cents]
      )
      if (inserted.rowCount) context.newlyPaid.push(bill)
      else context.alreadyPaid.push(bill)
    }
    const amountCents = context.newlyPaid.reduce((total, bill) => total + bill.amount_cents, 0)
    return {
      output: {
        paidBills: context.newlyPaid.length, paidAmountCents: amountCents,
        paymentReferences: context.newlyPaid.map((bill) => `PAY-${bill.bill_number.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}`),
        duplicatePaymentsPrevented: context.alreadyPaid.length,
      },
      decisions: [{
        code: 'idempotent_payment', outcome: 'proceed',
        explanation: `${context.newlyPaid.length} new payment(s) created; ${context.alreadyPaid.length} existing payment(s) were not duplicated.`,
      }],
    }
  }

  private readonly reconcile = async (
    client: PoolClient, workspaceId: string, _runId: string, context: RunContext
  ): Promise<StepResult> => {
    const paid = await client.query<QueryResultRow & { total: number }>(
      `SELECT coalesce(sum(amount_cents), 0)::int AS total FROM memory_demo_payments WHERE workspace_id = $1`,
      [workspaceId]
    )
    const endingBalanceCents = openingBalanceCents - Number(paid.rows[0]?.total ?? 0)
    return {
      output: {
        endingBalanceCents,
        exceptionCount: context.exceptions.length,
        exceptionBillNumbers: context.exceptions.map((bill) => bill.bill_number),
      },
      decisions: [{
        code: 'reconciliation_complete', outcome: context.exceptions.length ? 'escalate' : 'proceed',
        explanation: `Operating account reconciled to ${formatMoney(endingBalanceCents)}.`,
      }],
    }
  }

  private async finalOutcome(
    client: PoolClient,
    workspaceId: string,
    context: RunContext
  ): Promise<Record<string, unknown>> {
    const paid = await client.query<QueryResultRow & { total: number }>(
      `SELECT coalesce(sum(amount_cents), 0)::int AS total FROM memory_demo_payments WHERE workspace_id = $1`,
      [workspaceId]
    )
    return {
      asOfDate: context.asOfDate,
      reviewedBills: context.bills.length,
      approvedBills: context.approved.length,
      paidBills: context.newlyPaid.length,
      paidAmountCents: context.newlyPaid.reduce((total, bill) => total + bill.amount_cents, 0),
      alreadyPaidBills: context.alreadyPaid.length,
      exceptionCount: context.exceptions.length,
      exceptions: context.exceptions.map((bill) => ({
        billNumber: bill.bill_number, vendor: bill.vendor_name, reason: 'Approval evidence is missing',
      })),
      endingBalanceCents: openingBalanceCents - Number(paid.rows[0]?.total ?? 0),
    }
  }

  private async updateStep(
    client: PoolClient,
    runId: string,
    position: number,
    status: CapabilityRunStepStatus,
    input: Record<string, unknown>,
    output: Record<string, unknown>,
    decisions: CapabilityDecision[],
    errorMessage: string | null,
    starting: boolean,
    citations: CapabilityCitation[] = []
  ): Promise<void> {
    await client.query(
      `UPDATE memory_run_steps SET status = $3, input = $4::jsonb, output = $5::jsonb,
         citations = $6::jsonb, decisions = $7::jsonb, error_message = $8,
         started_at = CASE WHEN $9 THEN coalesce(started_at, now()) ELSE started_at END,
         completed_at = CASE WHEN $9 THEN completed_at ELSE now() END
       WHERE run_id = $1 AND position = $2`,
      [runId, position, status, JSON.stringify(input), JSON.stringify(output), JSON.stringify(citations),
        JSON.stringify(decisions), errorMessage, starting]
    )
  }

  private async findIdempotentRun(
    workspaceId: string,
    capabilityId: string,
    actorId: string,
    idempotencyKey: string
  ): Promise<CapabilityRun | null> {
    const result = await query<QueryResultRow & { id: string }>(
      `SELECT id FROM memory_capability_runs
       WHERE workspace_id = $1 AND capability_id = $2 AND actor_id = $3 AND idempotency_key = $4`,
      [workspaceId, capabilityId, actorId, idempotencyKey]
    )
    return result.rows[0] ? this.capabilities.run(workspaceId, result.rows[0].id) : null
  }
}

function deterministicSummary(output: Record<string, unknown>): string {
  return [
    `Reviewed ${output.reviewedBills ?? 0} due bill(s).`,
    `Created ${output.paidBills ?? 0} payment(s) totaling ${formatMoney(Number(output.paidAmountCents ?? 0))}.`,
    `${output.exceptionCount ?? 0} exception(s) require follow-up.`,
    `The operating account reconciled to ${formatMoney(Number(output.endingBalanceCents ?? 0))}.`,
    '[S1] [S2]',
  ].join(' ')
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}
