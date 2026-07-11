import { transaction } from '../db/pool.js'

export const demoMemoryIds = {
  owner: '10000000-0000-4000-8000-000000000001',
  successor: '10000000-0000-4000-8000-000000000002',
  unauthorized: '10000000-0000-4000-8000-000000000003',
  capability: '20000000-0000-4000-8000-000000000001',
  version: '20000000-0000-4000-8000-000000000002',
  historicalRun: '30000000-0000-4000-8000-000000000001',
} as const

const stepIds = [
  '21000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000002',
  '21000000-0000-4000-8000-000000000003',
  '21000000-0000-4000-8000-000000000004',
  '21000000-0000-4000-8000-000000000005',
] as const

const skillSteps = [
  ['run_ap_aging_report', 'Run AP aging', 'Find due and overdue property vendor bills as of the run date.'],
  ['summarize_document', 'Verify approvals and evidence', 'Validate invoice approval evidence before any accounting write.'],
  ['enter_vendor_bill', 'Enter approved vendor bills', 'Confirm approved bills are coded to the correct property and expense account.'],
  ['pay_vendor_bill', 'Pay due vendor bills', 'Create idempotent payments for approved due bills from the operating account.'],
  ['reconcile_bank_account', 'Reconcile the AP outcome', 'Return paid totals, remaining exceptions, and the resulting operating balance.'],
] as const

export default class MemorySeedService {
  async seed(workspaceId = 'hackathon-demo'): Promise<void> {
    await transaction(async (client) => {
      const actors = [
        [demoMemoryIds.owner, 'magdalene-choong-demo', 'Magdalene Choong', 'CFO at GenAI Fund · Demo source owner (simulated departure)', 'magdalene.demo@example.com', 'departed'],
        [demoMemoryIds.successor, 'laura-nguyen-demo', 'Laura Nguyen', 'Partner at GenAI Fund · Demo successor', 'laura.demo@example.com', 'active'],
        [demoMemoryIds.unauthorized, 'eugene-koon-demo', 'Eugene Koon', 'Head of Programs at GenAI Fund · Demo viewer', 'eugene.demo@example.com', 'active'],
      ] as const
      for (const actor of actors) {
        await client.query(
          `INSERT INTO memory_actors (id, workspace_id, slug, name, title, email, status, is_demo)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true)
           ON CONFLICT (id) DO UPDATE SET
             slug = EXCLUDED.slug, name = EXCLUDED.name, title = EXCLUDED.title, email = EXCLUDED.email,
             status = EXCLUDED.status, is_demo = true, updated_at = now()`,
          [actor[0], workspaceId, ...actor.slice(1)]
        )
      }

      await client.query(
        `INSERT INTO memory_capabilities
           (id, workspace_id, slug, name, description, owner_actor_id, steward_actor_id)
         VALUES ($1, $2, 'weekly-ap-run', 'Weekly AP Run',
           'A governed property-management accounting capability in a hypothetical continuity scenario that reviews open payables, verifies evidence, pays approved bills, and reconciles the outcome.',
           $3, $4)
         ON CONFLICT (workspace_id, slug) DO UPDATE SET
           name = EXCLUDED.name, description = EXCLUDED.description,
           owner_actor_id = EXCLUDED.owner_actor_id, steward_actor_id = EXCLUDED.steward_actor_id,
           status = 'active', updated_at = now()`,
        [demoMemoryIds.capability, workspaceId, demoMemoryIds.owner, demoMemoryIds.successor]
      )
      await client.query(
        `INSERT INTO memory_capability_versions
           (id, capability_id, version, change_summary, created_by_actor_id, created_at)
         VALUES ($1, $2, 1, 'Captured the production weekly AP close procedure before the owner departed.', $3, '2026-06-20T14:00:00Z')
         ON CONFLICT (capability_id, version) DO NOTHING`,
        [demoMemoryIds.version, demoMemoryIds.capability, demoMemoryIds.owner]
      )
      for (const [position, step] of skillSteps.entries()) {
        await client.query(
          `INSERT INTO memory_capability_steps
             (id, capability_version_id, position, skill_code, name, description, runnable, configuration)
           VALUES ($1, $2, $3, $4, $5, $6, true, $7::jsonb)
           ON CONFLICT (capability_version_id, position) DO NOTHING`,
          [stepIds[position], demoMemoryIds.version, position, ...step, JSON.stringify({ governed: true })]
        )
      }
      await client.query(
        'UPDATE memory_capabilities SET active_version_id = $2 WHERE id = $1',
        [demoMemoryIds.capability, demoMemoryIds.version]
      )

      const provenance = [
        [
          '22000000-0000-4000-8000-000000000001', 'document', 'workflow', 'Weekly AP Runbook',
          'Every Friday, review AP aging, require approval evidence, pay only approved due bills, and reconcile the operating account before closing the run.',
          'memory://weekly-ap-runbook', demoMemoryIds.owner, '2026-06-20T14:15:00Z',
        ],
        [
          '22000000-0000-4000-8000-000000000002', 'decision_log', 'decision', 'AP approval control decision',
          'A bill without written approval is an exception. It must not be paid by the capability and must appear in the final outcome.',
          'memory://ap-approval-decision', demoMemoryIds.owner, '2026-06-20T14:30:00Z',
        ],
        [
          '22000000-0000-4000-8000-000000000003', 'document', 'prompt', 'AP outcome summary prompt',
          'Summarize bills reviewed, bills paid, payment total, approval exceptions, and the reconciled operating balance. Cite the runbook and approval decision.',
          'memory://ap-summary-prompt', demoMemoryIds.owner, '2026-06-20T14:35:00Z',
        ],
        [
          '22000000-0000-4000-8000-000000000004', 'document', 'agent', 'Governed AP runner pattern',
          'The agent executes the published skill order deterministically. It may summarize with Bedrock, but accounting writes and permission gates remain governed handlers.',
          'memory://governed-ap-agent', demoMemoryIds.owner, '2026-06-20T14:40:00Z',
        ],
        [
          '22000000-0000-4000-8000-000000000005', 'interview', 'best_practice', 'Property accounting handoff notes',
          'Hypothetical continuity scenario: preserve property coding, never duplicate a payment, and surface missing approvals as exceptions for the successor instead of silently skipping them.',
          'memory://property-accounting-handoff', demoMemoryIds.owner, '2026-06-20T14:45:00Z',
        ],
        [
          '22000000-0000-4000-8000-000000000006', 'document', 'best_practice', 'GenAI Fund team roster (demo casting only)',
          'Public team names are used only to cast this hypothetical continuity demo; simulated departure and succession statuses do not describe real employment changes.',
          'https://genaifund.ai/team/', demoMemoryIds.owner, '2026-06-20T14:50:00Z',
        ],
      ] as const
      for (const source of provenance) {
        await client.query(
          `INSERT INTO memory_capability_provenance
             (id, workspace_id, capability_id, capability_version_id, source_type, asset_kind, source_name, excerpt, uri, captured_by_actor_id, captured_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (capability_version_id, source_name) DO UPDATE SET asset_kind = EXCLUDED.asset_kind`,
          [source[0], workspaceId, demoMemoryIds.capability, demoMemoryIds.version, ...source.slice(1)]
        )
      }

      const permissions = [
        [demoMemoryIds.owner, 'steward'],
        [demoMemoryIds.successor, 'steward'],
        [demoMemoryIds.unauthorized, 'view'],
      ] as const
      for (const [actorId, permission] of permissions) {
        await client.query(
          `INSERT INTO memory_capability_permissions (workspace_id, capability_id, actor_id, permission)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (capability_id, actor_id) DO UPDATE SET permission = EXCLUDED.permission`,
          [workspaceId, demoMemoryIds.capability, actorId, permission]
        )
      }

      const bills = [
        ['40000000-0000-4000-8000-000000000001', 'Northstar Plumbing', 'NS-1048', 'Harbor View Apartments', 184250, '2026-07-10', true, 'Approved by property manager in AP runbook evidence'],
        ['40000000-0000-4000-8000-000000000002', 'Metro Elevator', 'ME-7781', 'Harbor View Apartments', 96500, '2026-07-11', false, 'Approval missing; retain as exception'],
        ['40000000-0000-4000-8000-000000000003', 'BrightLine Electric', 'BL-2201', 'Parkside Commons', 72500, '2026-06-13', true, 'Historical approval retained with prior run'],
      ] as const
      for (const bill of bills) {
        await client.query(
          `INSERT INTO memory_demo_bills
             (id, workspace_id, vendor_name, bill_number, property_name, amount_cents, due_date, approved, approval_source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (workspace_id, vendor_name, bill_number) DO UPDATE SET
             property_name = EXCLUDED.property_name, amount_cents = EXCLUDED.amount_cents,
             due_date = EXCLUDED.due_date, approved = EXCLUDED.approved,
             approval_source = EXCLUDED.approval_source`,
          [bill[0], workspaceId, ...bill.slice(1)]
        )
      }

      const historicalCitations = JSON.stringify([{
        label: 'S1', sourceId: '22000000-0000-4000-8000-000000000001',
        sourceName: 'Weekly AP Runbook', excerpt: provenance[0][4], uri: provenance[0][5],
      }])
      const historicalDecisions = JSON.stringify([{
        code: 'approved_due_bills', outcome: 'proceed',
        explanation: 'One approved due bill was eligible for payment.',
      }])
      await client.query(
        `INSERT INTO memory_capability_runs
           (id, workspace_id, capability_id, capability_version_id, actor_id, idempotency_key,
            status, input, output, summary, citations, decisions, started_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, 'historical-owner-run', 'succeeded',
           '{"asOfDate":"2026-06-13"}'::jsonb,
           '{"reviewedBills":1,"paidBills":1,"paidAmountCents":72500,"exceptionCount":0,"endingBalanceCents":4927500}'::jsonb,
           'Paid 1 approved bill totaling $725.00 and reconciled the operating account.', $6::jsonb, $7::jsonb,
           '2026-06-13T13:00:00Z', '2026-06-13T13:00:05Z')
         ON CONFLICT (workspace_id, capability_id, actor_id, idempotency_key) DO NOTHING`,
        [demoMemoryIds.historicalRun, workspaceId, demoMemoryIds.capability, demoMemoryIds.version, demoMemoryIds.owner, historicalCitations, historicalDecisions]
      )
      for (const [position, step] of skillSteps.entries()) {
        await client.query(
          `INSERT INTO memory_run_steps
             (id, run_id, capability_step_id, position, skill_code, name, status, input, output,
              citations, decisions, started_at, completed_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'succeeded', '{}'::jsonb, '{}'::jsonb,
             $7::jsonb, '[]'::jsonb, '2026-06-13T13:00:00Z', '2026-06-13T13:00:05Z')
           ON CONFLICT (run_id, position) DO NOTHING`,
          [`31000000-0000-4000-8000-${String(position + 1).padStart(12, '0')}`, demoMemoryIds.historicalRun,
            stepIds[position], position, step[0], step[1], historicalCitations]
        )
      }
      await client.query(
        `INSERT INTO memory_demo_payments
           (id, workspace_id, bill_id, run_id, payment_reference, amount_cents, paid_at)
         VALUES ('41000000-0000-4000-8000-000000000001', $1,
           '40000000-0000-4000-8000-000000000003', $2, 'PAY-HIST-BL-2201', 72500, '2026-06-13T13:00:04Z')
         ON CONFLICT (bill_id) DO NOTHING`,
        [workspaceId, demoMemoryIds.historicalRun]
      )
      await client.query(
        `INSERT INTO memory_audit_events
           (id, workspace_id, actor_id, action, entity_type, entity_id, detail, created_at)
         VALUES ('50000000-0000-4000-8000-000000000001', $1, $2,
           'capability.run.completed', 'capability_run', $3,
           '{"status":"succeeded","source":"seed"}'::jsonb, '2026-06-13T13:00:05Z')
         ON CONFLICT (id) DO NOTHING`,
        [workspaceId, demoMemoryIds.owner, demoMemoryIds.historicalRun]
      )
    })
  }
}
