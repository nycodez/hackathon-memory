import type {
  CapabilityCitation,
  CapabilityDetail,
  CapabilityInstallation,
  CapabilityPermissionLevel,
  CapabilityProvenance,
  CapabilityRun,
  CapabilityRunStep,
  CapabilitySummary,
  MemoryActor,
  MemoryAnalytics,
  MemoryAssetKind,
  MemoryRecommendation,
  MemorySearchResponse,
  MemorySearchResult,
} from '@hackathon/shared'
import type { PoolClient, QueryResultRow } from 'pg'
import { query, transaction } from '../db/pool.js'
import { taskSkillGroups } from '../services/task_catalog.js'

interface CapabilityRow extends QueryResultRow {
  id: string
  slug: string
  name: string
  description: string
  status: 'active' | 'archived'
  owner: ActorJson
  steward: ActorJson
  active_version: number
  active_version_id: string
  skill_count: number
  run_count: number
  last_run_at: Date | null
  permission: CapabilityPermissionLevel | null
  permission_actor_status: MemoryActor['status'] | null
}

interface ActorJson {
  id: string
  slug: string
  name: string
  title: string
  email: string
  status: 'active' | 'departed'
  isDemo: boolean
}

interface RunRow extends QueryResultRow {
  id: string
  capability_id: string
  capability_name: string
  capability_version_id: string
  version: number
  actor: ActorJson
  status: CapabilityRun['status']
  idempotency_key: string
  input: Record<string, unknown>
  output: Record<string, unknown>
  summary: string
  citations: CapabilityCitation[]
  decisions: CapabilityRun['decisions']
  started_at: Date
  completed_at: Date | null
}

const actorJson = (alias: string) => `jsonb_build_object(
  'id', ${alias}.id, 'slug', ${alias}.slug, 'name', ${alias}.name,
  'title', ${alias}.title, 'email', ${alias}.email, 'status', ${alias}.status,
  'isDemo', ${alias}.is_demo
)`

const capabilitySelect = `
  SELECT c.id, c.slug, c.name, c.description, c.status, c.active_version_id,
    ${actorJson('owner')} AS owner,
    ${actorJson('steward')} AS steward,
    v.version AS active_version,
    (SELECT count(*)::int FROM memory_capability_steps s WHERE s.capability_version_id = v.id) AS skill_count,
    (SELECT count(*)::int FROM memory_capability_runs r WHERE r.capability_id = c.id AND r.status = 'succeeded') AS run_count,
    (SELECT max(r.started_at) FROM memory_capability_runs r WHERE r.capability_id = c.id) AS last_run_at,
    permission.permission
    , (SELECT status FROM memory_actors selected_actor WHERE selected_actor.id = $2) AS permission_actor_status
  FROM memory_capabilities c
  JOIN memory_actors owner ON owner.id = c.owner_actor_id
  JOIN memory_actors steward ON steward.id = c.steward_actor_id
  JOIN memory_capability_versions v ON v.id = c.active_version_id
  LEFT JOIN memory_capability_permissions permission
    ON permission.capability_id = c.id AND permission.actor_id = $2
`

export default class CapabilitiesRepository {
  async actors(workspaceId: string): Promise<MemoryActor[]> {
    const result = await query<QueryResultRow & {
      id: string; slug: string; name: string; title: string; email: string
      status: MemoryActor['status']; is_demo: boolean
    }>(
      `SELECT id, slug, name, title, email, status, is_demo
       FROM memory_actors WHERE workspace_id = $1 AND is_demo = true
       ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, name`,
      [workspaceId]
    )
    return result.rows.map((row) => ({
      id: row.id, slug: row.slug, name: row.name, title: row.title, email: row.email,
      status: row.status, isDemo: row.is_demo,
    }))
  }

  async actor(workspaceId: string, actorId: string): Promise<MemoryActor | null> {
    const result = await query<QueryResultRow & {
      id: string; slug: string; name: string; title: string; email: string
      status: MemoryActor['status']; is_demo: boolean
    }>(
      `SELECT id, slug, name, title, email, status, is_demo
       FROM memory_actors WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, actorId]
    )
    const row = result.rows[0]
    return row ? {
      id: row.id, slug: row.slug, name: row.name, title: row.title, email: row.email,
      status: row.status, isDemo: row.is_demo,
    } : null
  }

  async list(workspaceId: string, actorId: string | null): Promise<CapabilitySummary[]> {
    const result = await query<CapabilityRow>(
      `${capabilitySelect}
       WHERE c.workspace_id = $1
       ORDER BY CASE c.status WHEN 'active' THEN 0 ELSE 1 END, lower(c.name)`,
      [workspaceId, actorId]
    )
    return result.rows.map(mapCapability)
  }

  async get(workspaceId: string, id: string, actorId: string | null): Promise<CapabilityDetail | null> {
    const result = await query<CapabilityRow>(
      `${capabilitySelect} WHERE c.workspace_id = $1 AND c.id = $3`,
      [workspaceId, actorId, id]
    )
    const row = result.rows[0]
    if (!row) return null

    const [versionResult, stepsResult, provenanceResult] = await Promise.all([
      query<QueryResultRow & {
        id: string; version: number; change_summary: string; created_at: Date; created_by: ActorJson
      }>(
        `SELECT v.id, v.version, v.change_summary, v.created_at, ${actorJson('creator')} AS created_by
         FROM memory_capability_versions v
         JOIN memory_actors creator ON creator.id = v.created_by_actor_id
         WHERE v.id = $1`,
        [row.active_version_id]
      ),
      query<QueryResultRow & {
        id: string; position: number; skill_code: string; name: string; description: string
        runnable: boolean; configuration: Record<string, unknown>
      }>(
        `SELECT id, position, skill_code, name, description, runnable, configuration
         FROM memory_capability_steps WHERE capability_version_id = $1 ORDER BY position`,
        [row.active_version_id]
      ),
      query<QueryResultRow & {
        id: string; source_type: CapabilityProvenance['sourceType']; asset_kind: MemoryAssetKind; source_name: string
        excerpt: string; uri: string | null; captured_at: Date; captured_by: ActorJson | null
      }>(
        `SELECT p.id, p.source_type, p.asset_kind, p.source_name, p.excerpt, p.uri, p.captured_at,
           CASE WHEN captured.id IS NULL THEN NULL ELSE ${actorJson('captured')} END AS captured_by
         FROM memory_capability_provenance p
         LEFT JOIN memory_actors captured ON captured.id = p.captured_by_actor_id
         WHERE p.workspace_id = $1 AND p.capability_id = $2
         ORDER BY p.captured_at, p.source_name`,
        [workspaceId, id]
      ),
    ])
    const version = versionResult.rows[0]
    if (!version) return null
    return {
      ...mapCapability(row),
      version: {
        id: version.id,
        version: version.version,
        changeSummary: version.change_summary,
        createdAt: version.created_at.toISOString(),
        createdBy: mapActorJson(version.created_by),
        steps: stepsResult.rows.map((step) => ({
          id: step.id, position: step.position, skillCode: step.skill_code,
          name: step.name, description: step.description, runnable: step.runnable,
          configuration: step.configuration,
        })),
      },
      provenance: provenanceResult.rows.map((source) => ({
        id: source.id, sourceType: source.source_type, assetKind: source.asset_kind, sourceName: source.source_name,
        excerpt: source.excerpt, uri: source.uri, capturedAt: source.captured_at.toISOString(),
        capturedBy: source.captured_by ? mapActorJson(source.captured_by) : null,
      })),
      permission: row.permission,
    }
  }

  async install(workspaceId: string, capabilityId: string): Promise<CapabilityInstallation | null> {
    return transaction(async (client) => {
      const source = await client.query<QueryResultRow & {
        version_id: string; name: string; description: string; skill_codes: string[]
      }>(
        `SELECT c.active_version_id AS version_id, c.name, c.description,
           array_agg(s.skill_code ORDER BY s.position) AS skill_codes
         FROM memory_capabilities c
         JOIN memory_capability_steps s ON s.capability_version_id = c.active_version_id
         WHERE c.workspace_id = $1 AND c.id = $2 AND c.status = 'active'
         GROUP BY c.id`,
        [workspaceId, capabilityId]
      )
      const capability = source.rows[0]
      if (!capability) return null
      const existing = await client.query<QueryResultRow & { id: string }>(
        'SELECT id FROM memory_tasks WHERE workspace_id = $1 AND capability_version_id = $2 LIMIT 1',
        [workspaceId, capability.version_id]
      )
      let taskId = existing.rows[0]?.id
      if (!taskId) {
        const name = await availableTaskName(client, workspaceId, capability.name)
        const created = await client.query<QueryResultRow & { id: string }>(
          `INSERT INTO memory_tasks (workspace_id, name, description, capability_version_id)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [workspaceId, name, capability.description, capability.version_id]
        )
        taskId = created.rows[0]?.id
        if (!taskId) throw new Error('Capability installation could not create a task')
        await client.query(
          `INSERT INTO memory_task_steps (task_id, skill_code, position)
           SELECT $1, selected.skill_code, selected.position - 1
           FROM unnest($2::text[]) WITH ORDINALITY selected(skill_code, position)`,
          [taskId, capability.skill_codes]
        )
        await audit(client, workspaceId, null, 'capability.installed', 'task', taskId, {
          capabilityId, capabilityVersionId: capability.version_id,
        })
      }
      const task = await loadTask(client, workspaceId, taskId)
      if (!task) throw new Error('Installed task could not be loaded')
      return { task, capabilityVersionId: capability.version_id }
    })
  }

  async runs(workspaceId: string, capabilityId: string): Promise<CapabilityRun[]> {
    const result = await query<RunRow>(`${runSelect} WHERE r.workspace_id = $1 AND r.capability_id = $2 ORDER BY r.started_at DESC`, [workspaceId, capabilityId])
    const runs: CapabilityRun[] = []
    for (const row of result.rows) runs.push(await this.mapRun(row))
    return runs
  }

  async run(workspaceId: string, runId: string): Promise<CapabilityRun | null> {
    const result = await query<RunRow>(`${runSelect} WHERE r.workspace_id = $1 AND r.id = $2`, [workspaceId, runId])
    return result.rows[0] ? this.mapRun(result.rows[0]) : null
  }

  async search(workspaceId: string, term: string): Promise<MemorySearchResponse> {
    const normalized = term.trim()
    const pattern = `%${normalized.replace(/[%_\\]/g, '\\$&')}%`
    const [capabilities, tasks, assets] = await Promise.all([
      query<QueryResultRow & { id: string; name: string; description: string; version: number; skill_count: number }>(
        `SELECT c.id, c.name, c.description, v.version,
           (SELECT count(*)::int FROM memory_capability_steps s WHERE s.capability_version_id = v.id) AS skill_count
         FROM memory_capabilities c JOIN memory_capability_versions v ON v.id = c.active_version_id
         WHERE c.workspace_id = $1 AND c.status = 'active'
           AND ($2 = '%%' OR c.name ILIKE $2 ESCAPE '\\' OR c.description ILIKE $2 ESCAPE '\\')
         ORDER BY lower(c.name) LIMIT 20`,
        [workspaceId, pattern]
      ),
      query<QueryResultRow & { id: string; name: string; description: string; skill_count: number }>(
        `SELECT t.id, t.name, t.description, count(s.id)::int AS skill_count
         FROM memory_tasks t LEFT JOIN memory_task_steps s ON s.task_id = t.id
         WHERE t.workspace_id = $1
           AND ($2 = '%%' OR t.name ILIKE $2 ESCAPE '\\' OR t.description ILIKE $2 ESCAPE '\\')
         GROUP BY t.id ORDER BY lower(t.name) LIMIT 20`,
        [workspaceId, pattern]
      ),
      query<QueryResultRow & {
        id: string; capability_id: string; asset_kind: MemoryAssetKind; source_name: string; excerpt: string
      }>(
        `SELECT p.id, p.capability_id, p.asset_kind, p.source_name, p.excerpt
         FROM memory_capability_provenance p
         WHERE p.workspace_id = $1
           AND ($2 = '%%' OR p.source_name ILIKE $2 ESCAPE '\\' OR p.excerpt ILIKE $2 ESCAPE '\\')
         ORDER BY p.captured_at DESC LIMIT 20`,
        [workspaceId, pattern]
      ),
    ])
    const lower = normalized.toLocaleLowerCase()
    const skillResults: MemorySearchResult[] = taskSkillGroups().flatMap((group) => group.skills)
      .filter((skill) => !lower || `${skill.name} ${skill.description} ${skill.code}`.toLocaleLowerCase().includes(lower))
      .slice(0, 20)
      .map((skill) => ({
        id: skill.code, type: 'skill', name: skill.name, description: skill.description,
        href: `/skills?skill=${encodeURIComponent(skill.code)}`, detail: `${skill.kind} skill`,
      }))
    const results: MemorySearchResult[] = [
      ...capabilities.rows.map((item) => ({
        id: item.id, type: 'capability' as const, name: item.name, description: item.description,
        href: `/capabilities/${item.id}`, detail: `v${item.version} · ${item.skill_count} skills`,
      })),
      ...tasks.rows.map((item) => ({
        id: item.id, type: 'task' as const, name: item.name, description: item.description,
        href: `/tasks?task=${item.id}`, detail: `${item.skill_count} skills`,
      })),
      ...assets.rows.map((item) => ({
        id: item.id, type: item.asset_kind, name: item.source_name, description: item.excerpt,
        href: `/capabilities/${item.capability_id}`, detail: item.asset_kind.replace('_', ' '),
      })),
      ...skillResults,
    ].slice(0, 30)
    return { query: normalized, results }
  }

  async recommendations(workspaceId: string, context: string): Promise<MemoryRecommendation[]> {
    const normalizedContext = context.trim().replace(/accounts payable/ig, 'AP')
    const pattern = `%${normalizedContext.replace(/[%_\\]/g, '\\$&')}%`
    const result = await query<QueryResultRow & {
      id: string; name: string; description: string; successful_runs: number; matched_sources: number
    }>(
      `SELECT c.id, c.name, c.description,
         (SELECT count(*)::int FROM memory_capability_runs r WHERE r.capability_id = c.id AND r.status = 'succeeded') AS successful_runs,
         (SELECT count(*)::int FROM memory_capability_provenance p
           WHERE p.capability_id = c.id AND ($2 = '%%' OR p.source_name ILIKE $2 ESCAPE '\\' OR p.excerpt ILIKE $2 ESCAPE '\\')) AS matched_sources
       FROM memory_capabilities c
       WHERE c.workspace_id = $1 AND c.status = 'active'
         AND ($2 = '%%' OR c.name ILIKE $2 ESCAPE '\\' OR c.description ILIKE $2 ESCAPE '\\'
           OR EXISTS (SELECT 1 FROM memory_capability_provenance p WHERE p.capability_id = c.id
             AND (p.source_name ILIKE $2 ESCAPE '\\' OR p.excerpt ILIKE $2 ESCAPE '\\')))
       ORDER BY successful_runs DESC, matched_sources DESC, lower(c.name)
       LIMIT 5`,
      [workspaceId, pattern]
    )
    return result.rows.map((item) => ({
      id: `reuse-${item.id}`,
      type: item.successful_runs ? 'reuse' : 'related',
      title: item.successful_runs ? `Reuse proven ${item.name}` : `Review related ${item.name}`,
      rationale: item.successful_runs
        ? `${item.successful_runs} successful prior run(s) and ${item.matched_sources} matching source(s) make this a proven reusable pattern.`
        : `${item.matched_sources} source(s) match the current work context.`,
      capabilityId: item.id,
      capabilityName: item.name,
      href: `/capabilities/${item.id}`,
      confidence: Math.min(0.98, 0.7 + item.successful_runs * 0.08 + item.matched_sources * 0.03),
    }))
  }

  async analytics(workspaceId: string): Promise<MemoryAnalytics> {
    const [counts, duplicates, growth] = await Promise.all([
      query<QueryResultRow & {
        capability_count: number; active_capability_count: number; version_count: number
        runnable_skill_count: number; run_count: number; succeeded_run_count: number; unique_skill_count: number
      }>(
        `SELECT
           (SELECT count(*)::int FROM memory_capabilities WHERE workspace_id = $1) AS capability_count,
           (SELECT count(*)::int FROM memory_capabilities WHERE workspace_id = $1 AND status = 'active') AS active_capability_count,
           (SELECT count(*)::int FROM memory_capability_versions v JOIN memory_capabilities c ON c.id = v.capability_id WHERE c.workspace_id = $1) AS version_count,
           (SELECT count(*)::int FROM memory_capability_steps s JOIN memory_capability_versions v ON v.id = s.capability_version_id JOIN memory_capabilities c ON c.id = v.capability_id WHERE c.workspace_id = $1 AND s.runnable = true) AS runnable_skill_count,
           (SELECT count(*)::int FROM memory_capability_runs WHERE workspace_id = $1) AS run_count,
           (SELECT count(*)::int FROM memory_capability_runs WHERE workspace_id = $1 AND status = 'succeeded') AS succeeded_run_count,
           (SELECT count(DISTINCT s.skill_code)::int FROM memory_capability_steps s JOIN memory_capability_versions v ON v.id = s.capability_version_id JOIN memory_capabilities c ON c.id = v.capability_id WHERE c.workspace_id = $1) AS unique_skill_count`,
        [workspaceId]
      ),
      query<QueryResultRow & { skill_code: string; name: string; capability_count: number }>(
        `SELECT s.skill_code, min(s.name) AS name, count(DISTINCT c.id)::int AS capability_count
         FROM memory_capability_steps s
         JOIN memory_capability_versions v ON v.id = s.capability_version_id
         JOIN memory_capabilities c ON c.id = v.capability_id
         WHERE c.workspace_id = $1
         GROUP BY s.skill_code HAVING count(DISTINCT c.id) > 1
         ORDER BY capability_count DESC, s.skill_code`,
        [workspaceId]
      ),
      query<QueryResultRow & { month: string; capabilities: number; runs: number }>(
        `WITH months AS (
           SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month FROM memory_capabilities WHERE workspace_id = $1
           UNION
           SELECT to_char(date_trunc('month', started_at), 'YYYY-MM') AS month FROM memory_capability_runs WHERE workspace_id = $1
         )
         SELECT m.month,
           (SELECT count(*)::int FROM memory_capabilities c WHERE c.workspace_id = $1 AND to_char(date_trunc('month', c.created_at), 'YYYY-MM') = m.month) AS capabilities,
           (SELECT count(*)::int FROM memory_capability_runs r WHERE r.workspace_id = $1 AND to_char(date_trunc('month', r.started_at), 'YYYY-MM') = m.month) AS runs
         FROM months m ORDER BY m.month`,
        [workspaceId]
      ),
    ])
    const row = counts.rows[0]
    const existingSlugs = new Set((await query<QueryResultRow & { slug: string }>(
      'SELECT slug FROM memory_capabilities WHERE workspace_id = $1', [workspaceId]
    )).rows.map((item) => item.slug.replaceAll('-', '_')))
    const missingCapabilities = taskSkillGroups().length ? [
      { code: 'customer_invoice_to_deposit', name: 'Customer invoice to deposit', reason: 'Starter pattern exists, but no governed capability version has been published.' },
      { code: 'meeting_followup', name: 'Meeting follow-up', reason: 'Frequently reusable workflow has no steward or provenance yet.' },
      { code: 'vendor_selection', name: 'Vendor selection', reason: 'Related atomic skills exist without an approved reusable workflow.' },
    ].filter((item) => !existingSlugs.has(item.code)) : []
    return {
      capabilityCount: Number(row?.capability_count ?? 0),
      activeCapabilityCount: Number(row?.active_capability_count ?? 0),
      versionCount: Number(row?.version_count ?? 0),
      runnableSkillCount: Number(row?.runnable_skill_count ?? 0),
      runCount: Number(row?.run_count ?? 0),
      succeededRunCount: Number(row?.succeeded_run_count ?? 0),
      uniqueSkillCount: Number(row?.unique_skill_count ?? 0),
      duplicatedSkills: duplicates.rows.map((item) => ({
        skillCode: item.skill_code, name: item.name, capabilityCount: Number(item.capability_count),
      })),
      missingCapabilities,
      growth: growth.rows.map((item) => ({
        month: item.month, capabilities: Number(item.capabilities), runs: Number(item.runs),
      })),
    }
  }

  private async mapRun(row: RunRow): Promise<CapabilityRun> {
    const steps = await query<QueryResultRow & {
      id: string; position: number; skill_code: string; name: string; status: CapabilityRunStep['status']
      input: Record<string, unknown>; output: Record<string, unknown>; citations: CapabilityCitation[]
      decisions: CapabilityRunStep['decisions']; started_at: Date | null; completed_at: Date | null
      error_message: string | null
    }>(
      `SELECT id, position, skill_code, name, status, input, output, citations, decisions,
         started_at, completed_at, error_message
       FROM memory_run_steps WHERE run_id = $1 ORDER BY position`,
      [row.id]
    )
    return {
      id: row.id, capabilityId: row.capability_id, capabilityName: row.capability_name,
      capabilityVersionId: row.capability_version_id, version: row.version,
      actor: mapActorJson(row.actor), status: row.status, idempotencyKey: row.idempotency_key,
      input: row.input, output: row.output, summary: row.summary,
      citations: row.citations, decisions: row.decisions,
      steps: steps.rows.map((step) => ({
        id: step.id, position: step.position, skillCode: step.skill_code, name: step.name,
        status: step.status, input: step.input, output: step.output, citations: step.citations,
        decisions: step.decisions, startedAt: step.started_at?.toISOString() ?? null,
        completedAt: step.completed_at?.toISOString() ?? null, errorMessage: step.error_message,
      })),
      startedAt: row.started_at.toISOString(), completedAt: row.completed_at?.toISOString() ?? null,
    }
  }
}

const runSelect = `
  SELECT r.id, r.capability_id, c.name AS capability_name, r.capability_version_id,
    v.version, ${actorJson('actor')} AS actor, r.status, r.idempotency_key,
    r.input, r.output, r.summary, r.citations, r.decisions, r.started_at, r.completed_at
  FROM memory_capability_runs r
  JOIN memory_capabilities c ON c.id = r.capability_id
  JOIN memory_capability_versions v ON v.id = r.capability_version_id
  JOIN memory_actors actor ON actor.id = r.actor_id
`

function mapCapability(row: CapabilityRow): CapabilitySummary {
  return {
    id: row.id, slug: row.slug, name: row.name, description: row.description,
    status: row.status, owner: mapActorJson(row.owner), steward: mapActorJson(row.steward),
    activeVersion: row.active_version, skillCount: Number(row.skill_count), runCount: Number(row.run_count),
    lastRunAt: row.last_run_at?.toISOString() ?? null,
    canRun: row.permission_actor_status === 'active' && (row.permission === 'run' || row.permission === 'steward'),
  }
}

function mapActorJson(actor: ActorJson): MemoryActor {
  return { ...actor }
}

async function availableTaskName(client: PoolClient, workspaceId: string, baseName: string): Promise<string> {
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidate = suffix ? `${baseName} (${suffix + 1})` : baseName
    const exists = await client.query('SELECT 1 FROM memory_tasks WHERE workspace_id = $1 AND lower(name) = lower($2)', [workspaceId, candidate])
    if (!exists.rowCount) return candidate
  }
  throw new Error('No available task name for capability installation')
}

async function loadTask(client: PoolClient, workspaceId: string, taskId: string): Promise<CapabilityInstallation['task'] | null> {
  const result = await client.query<QueryResultRow & {
    id: string; name: string; description: string; skill_codes: string[]; created_at: Date; updated_at: Date
  }>(
    `SELECT t.id, t.name, t.description, t.created_at, t.updated_at,
       array_agg(s.skill_code ORDER BY s.position) AS skill_codes
     FROM memory_tasks t JOIN memory_task_steps s ON s.task_id = t.id
     WHERE t.workspace_id = $1 AND t.id = $2 GROUP BY t.id`,
    [workspaceId, taskId]
  )
  const row = result.rows[0]
  if (!row) return null
  const skills = taskSkillGroups().flatMap((group) => group.skills)
  const byCode = new Map(skills.map((skill) => [skill.code, skill]))
  return {
    id: row.id, name: row.name, description: row.description,
    skills: row.skill_codes.flatMap((code) => byCode.get(code) ?? []),
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  }
}

export async function audit(
  client: PoolClient,
  workspaceId: string,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  detail: Record<string, unknown>
): Promise<void> {
  await client.query(
    `INSERT INTO memory_audit_events (workspace_id, actor_id, action, entity_type, entity_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [workspaceId, actorId, action, entityType, entityId, JSON.stringify(detail)]
  )
}
