import { createHash } from 'node:crypto'
import type {
  CapabilityAsset,
  CapabilityAssetDetail,
  CapabilityCitation,
  CapabilityClassification,
  CapabilityDepartureScenario,
  CapabilityInstallation,
  CapabilitySearchResult,
  CapabilitySkillRun,
  CapabilitySummary,
  CapabilityType,
  CreateCapabilityInput,
  DemoActor,
  RunCapabilityInput,
  SearchCapabilitiesInput,
} from '@hackathon/shared'
import type { PoolClient, QueryResultRow } from 'pg'
import { query, transaction } from '../db/pool.js'
import { demoCapabilities, demoPeople, demoTeams } from '../data/capability_demo_data.js'
import { decideCapabilityAccess, runPortfolioDigest } from '../services/capability_policy_service.js'
import { embedText, toVectorLiteral } from '../services/vector_service.js'

interface AssetRow extends QueryResultRow {
  id: string
  asset_key: string
  type: CapabilityType
  title: string
  summary: string
  content: string
  rationale: string
  classification: CapabilityClassification
  owner_team_id: string
  owner_team_name: string
  status: CapabilityAsset['status']
  current_version: string
  current_steward: string | null
  outcome_score: string | number
  usage_count: number
  last_used_at: Date | null
  created_at: Date
  updated_at: Date
}

interface SearchRow extends AssetRow {
  chunk_id: string
  document_id: string
  document_name: string
  chunk_content: string
  score: string | number
  relationship: CapabilityCitation['relationship']
}

const assetSelect = `
  SELECT a.id, a.asset_key, a.type, a.title, a.summary, a.content, a.rationale,
         a.classification, a.owner_team_id, t.name AS owner_team_name, a.status,
         a.current_version, a.outcome_score, a.usage_count, a.last_used_at,
         a.created_at, a.updated_at,
         (SELECT p.name
          FROM capability_stewardship_assignments s
          JOIN capability_people p ON p.id = s.to_person_id
          WHERE s.capability_id = a.id AND s.accepted_at IS NOT NULL
          ORDER BY s.accepted_at DESC LIMIT 1) AS current_steward
  FROM capability_assets a
  JOIN capability_teams t ON t.id = a.owner_team_id AND t.workspace_id = a.workspace_id
`

export default class CapabilitiesRepository {
  async list(workspaceId: string, actor: DemoActor): Promise<CapabilityAsset[]> {
    const result = await query<AssetRow>(
      `${assetSelect}
       WHERE a.workspace_id = $1 AND a.status = 'active'
       ORDER BY a.updated_at DESC, a.title`,
      [workspaceId]
    )
    return result.rows
      .filter((row) => decisionForRow(actor, row).allowed)
      .map(mapAsset)
  }

  async get(workspaceId: string, assetKey: string, actor: DemoActor): Promise<CapabilityAssetDetail | null | 'denied'> {
    const result = await query<AssetRow>(
      `${assetSelect} WHERE a.workspace_id = $1 AND a.asset_key = $2`,
      [workspaceId, assetKey]
    )
    const row = result.rows[0]
    if (!row) return null
    const governance = decisionForRow(actor, row)
    await this.audit(workspaceId, actor.id, row.id, 'detail', governance.allowed ? 'allow' : 'deny', { assetKey })
    if (!governance.allowed) return 'denied'

    const [versions, provenance, decisions, outcomes, citations, installation] = await Promise.all([
      query<{ id: string; version: string; change_notes: string; created_by: string; approved_by: string | null; created_at: Date }>(
        `SELECT v.id, v.version, v.change_notes, creator.name AS created_by, approver.name AS approved_by, v.created_at
         FROM capability_versions v
         JOIN capability_people creator ON creator.id = v.created_by_person_id
         LEFT JOIN capability_people approver ON approver.id = v.approved_by_person_id
         WHERE v.workspace_id = $1 AND v.capability_id = $2 ORDER BY v.created_at DESC`,
        [workspaceId, row.id]
      ),
      query<{ edge_type: CapabilityAssetDetail['provenance'][number]['edgeType']; target_key: string; target_label: string; evidence: string; created_at: Date }>(
        `SELECT edge_type, target_key, target_label, evidence, created_at
         FROM capability_edges WHERE workspace_id = $1 AND capability_id = $2 ORDER BY created_at, edge_type`,
        [workspaceId, row.id]
      ),
      query<{ id: string; decision: string; rationale: string; decided_by: string; decided_at: Date }>(
        `SELECT d.id, d.decision, d.rationale, p.name AS decided_by, d.decided_at
         FROM capability_decisions d JOIN capability_people p ON p.id = d.decided_by_person_id
         WHERE d.workspace_id = $1 AND d.capability_id = $2 ORDER BY d.decided_at DESC`,
        [workspaceId, row.id]
      ),
      query<{ id: string; metric_name: string; value: string | number; unit: string; measured_at: string }>(
        `SELECT id, metric_name, value, unit, measured_at::text
         FROM capability_outcomes WHERE workspace_id = $1 AND capability_id = $2 ORDER BY measured_at DESC`,
        [workspaceId, row.id]
      ),
      query<{ document_id: string; document_name: string; chunk_id: string; content: string; relationship: CapabilityCitation['relationship'] }>(
        `SELECT d.id AS document_id, d.name AS document_name, c.id AS chunk_id, c.content, ad.relationship
         FROM capability_asset_documents ad
         JOIN knowledge_documents d ON d.id = ad.document_id AND d.workspace_id = $1
         JOIN LATERAL (
           SELECT id, content FROM document_chunks WHERE document_id = d.id ORDER BY chunk_index LIMIT 1
         ) c ON true
         WHERE ad.capability_id = $2`,
        [workspaceId, row.id]
      ),
      query<{ id: string; version: string; installed_at: Date }>(
        `SELECT id, version, installed_at FROM capability_installations
         WHERE workspace_id = $1 AND capability_id = $2 AND actor_person_id = $3
         ORDER BY installed_at DESC LIMIT 1`,
        [workspaceId, row.id, actor.id]
      ),
    ])

    const installed = installation.rows[0]
    return {
      ...mapAsset(row),
      rationale: row.rationale,
      content: row.content,
      governance: { decision: 'allow', reason: governance.reason },
      versions: versions.rows.map((item) => ({
        id: item.id,
        version: item.version,
        changeNotes: item.change_notes,
        createdBy: item.created_by,
        approvedBy: item.approved_by,
        createdAt: item.created_at.toISOString(),
      })),
      provenance: provenance.rows.map((item) => ({
        edgeType: item.edge_type,
        targetKey: item.target_key,
        targetLabel: item.target_label,
        evidence: item.evidence,
        createdAt: item.created_at.toISOString(),
      })),
      decisions: decisions.rows.map((item) => ({
        id: item.id,
        decision: item.decision,
        rationale: item.rationale,
        decidedBy: item.decided_by,
        decidedAt: item.decided_at.toISOString(),
      })),
      outcomes: outcomes.rows.map((item) => ({
        id: item.id,
        metricName: item.metric_name,
        value: Number(item.value),
        unit: item.unit,
        measuredAt: item.measured_at,
      })),
      citations: citations.rows.map((item) => ({
        label: item.document_name,
        documentId: item.document_id,
        documentName: item.document_name,
        chunkId: item.chunk_id,
        excerpt: item.content.slice(0, 280),
        score: 1,
        relationship: item.relationship,
      })),
      installation: installed ? {
        id: installed.id,
        assetKey: row.asset_key,
        version: installed.version,
        actorId: actor.id,
        installedAt: installed.installed_at.toISOString(),
      } : null,
    }
  }

  async search(workspaceId: string, actor: DemoActor, input: SearchCapabilitiesInput): Promise<CapabilitySearchResult[]> {
    const lexicalQuery = buildLexicalQuery(input.query)
    const embedding = toVectorLiteral(embedText(input.query))
    const limit = Math.min(Math.max(input.limit ?? 10, 1), 25)
    const result = await query<SearchRow>(
      `WITH params AS (SELECT to_tsquery('simple', $3) AS tsq, $4::vector AS embedding),
       ranked AS (
         SELECT a.id, c.id AS chunk_id, d.id AS document_id, d.name AS document_name,
                c.content AS chunk_content, ad.relationship,
                (0.46 * (1 - (c.embedding <=> params.embedding))
                 + 0.34 * least(ts_rank_cd(c.search_vector, params.tsq) * 4, 1)
                 + CASE WHEN a.owner_team_id = $2 THEN 0.10 ELSE 0 END
                 + (a.outcome_score::float * 0.07)
                 + least(a.usage_count, 50)::float / 50 * 0.03) AS score
         FROM capability_assets a
         JOIN capability_asset_documents ad ON ad.capability_id = a.id
         JOIN knowledge_documents d ON d.id = ad.document_id AND d.workspace_id = a.workspace_id AND d.status = 'ready'
         JOIN document_chunks c ON c.document_id = d.id AND c.workspace_id = a.workspace_id
         CROSS JOIN params
         WHERE a.workspace_id = $1 AND a.status = 'active'
           AND ($6::text IS NULL OR a.type = $6)
           AND ($7::text IS NULL OR a.classification = $7)
           AND ($8::text IS NULL OR a.owner_team_id = $8)
           AND classification_rank(a.classification) <= classification_rank($5)
           AND (a.classification IN ('public', 'internal') OR a.owner_team_id = $2 OR $5 = 'restricted')
           AND (c.search_vector @@ params.tsq OR (c.embedding <=> params.embedding) < 0.94)
       )
       SELECT a.id, a.asset_key, a.type, a.title, a.summary, a.content, a.rationale,
              a.classification, a.owner_team_id, t.name AS owner_team_name, a.status,
              a.current_version, a.outcome_score, a.usage_count, a.last_used_at,
              a.created_at, a.updated_at,
              (SELECT p.name FROM capability_stewardship_assignments s
               JOIN capability_people p ON p.id = s.to_person_id
               WHERE s.capability_id = a.id AND s.accepted_at IS NOT NULL
               ORDER BY s.accepted_at DESC LIMIT 1) AS current_steward,
              r.chunk_id, r.document_id, r.document_name, r.chunk_content, r.relationship, r.score
       FROM ranked r
       JOIN capability_assets a ON a.id = r.id
       JOIN capability_teams t ON t.id = a.owner_team_id
       ORDER BY r.score DESC, a.title
       LIMIT $9`,
      [workspaceId, actor.teamId, lexicalQuery, embedding, actor.clearance, input.type ?? null, input.classification ?? null, input.ownerTeamId ?? null, limit]
    )
    const matches = mergeSearchRows(result.rows)

    if (input.includeLocked) {
      const locked = await this.lockedMetadata(workspaceId, actor, input, Math.max(0, limit - matches.length))
      matches.push(...locked)
    }
    await this.audit(workspaceId, actor.id, null, 'search', 'allow', {
      query: input.query,
      accessibleResults: matches.filter((item) => !item.locked).length,
      lockedResults: matches.filter((item) => item.locked).length,
    })
    return matches.slice(0, limit)
  }

  async create(workspaceId: string, actor: DemoActor, input: CreateCapabilityInput): Promise<CapabilityAsset> {
    if (actor.status !== 'active') throw new Error('Actor is not active')
    const requestedAccess = decideCapabilityAccess(actor, {
      classification: input.classification,
      ownerTeamId: input.ownerTeamId,
    })
    if (!requestedAccess.allowed) throw new Error('Actor cannot create assets with this governance classification')
    const existing = await query<AssetRow>(
      `${assetSelect} WHERE a.workspace_id = $1 AND a.request_id = $2`,
      [workspaceId, input.requestId]
    )
    if (existing.rows[0]) return mapAsset(existing.rows[0])

    let created: string
    try {
      created = await transaction(async (client) => {
        const team = await client.query('SELECT id FROM capability_teams WHERE workspace_id = $1 AND id = $2', [workspaceId, input.ownerTeamId])
        if (!team.rowCount) throw new Error('Owner team not found')
        if (input.ownerTeamId !== actor.teamId && actor.clearance !== 'restricted') throw new Error('Actor cannot create assets for this team')

        const assetKey = await uniqueAssetKey(client, workspaceId, input.title, input.requestId)
        const documentId = await upsertTextDocument(client, workspaceId, `${input.title}.md`, `${input.title}\n\n${input.content}\n\nWhy it worked\n${input.rationale}`)
        const assetResult = await client.query<{ id: string }>(
        `INSERT INTO capability_assets (
           workspace_id, asset_key, request_id, type, title, summary, content, rationale,
           classification, owner_team_id, current_version, created_by_person_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id`,
        [workspaceId, assetKey, input.requestId, input.type, input.title, input.summary, input.content,
          input.rationale, input.classification, input.ownerTeamId, input.version ?? 'v1.0', actor.id]
      )
        const assetId = requiredRow(assetResult.rows[0]).id
        await client.query(
        `INSERT INTO capability_asset_documents (capability_id, document_id, relationship)
         VALUES ($1, $2, 'primary_artifact')`,
        [assetId, documentId]
      )
        await client.query(
        `INSERT INTO capability_versions (
           workspace_id, capability_id, version, change_notes, snapshot, created_by_person_id
         ) VALUES ($1,$2,$3,$4,$5,$6)`,
        [workspaceId, assetId, input.version ?? 'v1.0', input.changeNotes ?? 'Initial captured version', input, actor.id]
      )
        await client.query(
        `INSERT INTO capability_edges (
           workspace_id, capability_id, edge_type, target_kind, target_key, target_label, evidence
         ) VALUES
           ($1,$2,'AUTHORED_BY','person',$3,$4,$5),
           ($1,$2,'STEWARDED_BY','person',$3,$4,$6)`,
        [workspaceId, assetId, actor.id, actor.name, `Captured by ${actor.name}.`, `${actor.name} is the initial steward.`]
      )
        await client.query(
        `INSERT INTO capability_stewardship_assignments (
           workspace_id, capability_id, from_person_id, to_person_id, reason, assigned_at, accepted_at
         ) VALUES ($1,$2,$3,$3,$4,now(),now())`,
        [workspaceId, assetId, actor.id, 'Initial stewardship assigned during capture.']
      )
        await client.query(
        `INSERT INTO capability_audit_events (workspace_id, actor_person_id, capability_id, action, decision, detail)
         VALUES ($1,$2,$3,'capture','allow',$4)`,
        [workspaceId, actor.id, assetId, { requestId: input.requestId, documentId }]
      )
        return assetKey
      })
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const raced = await query<AssetRow>(
        `${assetSelect} WHERE a.workspace_id = $1 AND a.request_id = $2`,
        [workspaceId, input.requestId]
      )
      if (!raced.rows[0]) throw error
      return mapAsset(raced.rows[0])
    }

    const asset = await this.getBase(workspaceId, created)
    if (!asset) throw new Error('Created capability was not returned')
    return asset
  }

  async install(workspaceId: string, assetKey: string, actor: DemoActor): Promise<CapabilityInstallation | null | 'denied'> {
    const row = await this.getRow(workspaceId, assetKey)
    if (!row) return null
    const governance = decisionForRow(actor, row)
    if (!governance.allowed) {
      await this.audit(workspaceId, actor.id, row.id, 'install', 'deny', { reason: governance.reason })
      return 'denied'
    }
    const result = await query<{ id: string; installed_at: Date }>(
      `INSERT INTO capability_installations (workspace_id, capability_id, actor_person_id, version)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (capability_id, actor_person_id, version)
       DO UPDATE SET installed_at = capability_installations.installed_at
       RETURNING id, installed_at`,
      [workspaceId, row.id, actor.id, row.current_version]
    )
    const installed = requiredRow(result.rows[0])
    await this.audit(workspaceId, actor.id, row.id, 'install', 'allow', { version: row.current_version })
    return {
      id: installed.id,
      assetKey,
      version: row.current_version,
      actorId: actor.id,
      installedAt: installed.installed_at.toISOString(),
    }
  }

  async run(
    workspaceId: string,
    assetKey: string,
    actor: DemoActor,
    input: RunCapabilityInput
  ): Promise<CapabilitySkillRun | null | 'denied' | 'not_installed'> {
    const row = await this.getRow(workspaceId, assetKey)
    if (!row) return null
    const governance = decisionForRow(actor, row)
    if (!governance.allowed) {
      await this.audit(workspaceId, actor.id, row.id, 'run', 'deny', { reason: governance.reason })
      return 'denied'
    }
    const installation = await query(
      `SELECT id FROM capability_installations
       WHERE workspace_id = $1 AND capability_id = $2 AND actor_person_id = $3 AND version = $4`,
      [workspaceId, row.id, actor.id, row.current_version]
    )
    if (!installation.rowCount) return 'not_installed'
    if (assetKey !== 'ast-014' && assetKey !== 'skill-014') throw new Error('Capability has no deterministic runtime')

    const provenancePath = await this.provenancePath(workspaceId, assetKey === 'skill-014' ? 'ast-014' : assetKey)
    if (assetKey === 'skill-014') provenancePath.push('DEPENDS_ON skill-014')
    const output = runPortfolioDigest(input, actor.name)
    const result = await query<{ id: string; created_at: Date }>(
      `INSERT INTO capability_skill_runs (
         workspace_id, capability_id, actor_person_id, version, status, input, output, provenance_path
       ) VALUES ($1,$2,$3,$4,'completed',$5,$6,$7)
       RETURNING id, created_at`,
      [workspaceId, row.id, actor.id, row.current_version, input, output, JSON.stringify(provenancePath)]
    )
    await query(
      `UPDATE capability_assets SET usage_count = usage_count + 1, last_used_at = now(), updated_at = now()
       WHERE id = $1`,
      [row.id]
    )
    await this.audit(workspaceId, actor.id, row.id, 'run', 'allow', { version: row.current_version })
    const run = requiredRow(result.rows[0])
    return {
      id: run.id,
      assetKey,
      version: row.current_version,
      actorId: actor.id,
      status: 'completed',
      input: { ...input },
      output,
      provenancePath,
      createdAt: run.created_at.toISOString(),
    }
  }

  async getRun(workspaceId: string, runId: string, actor: DemoActor): Promise<CapabilitySkillRun | null | 'denied'> {
    const result = await query<{
      id: string
      asset_key: string
      version: string
      actor_person_id: string
      status: CapabilitySkillRun['status']
      input: CapabilitySkillRun['input']
      output: CapabilitySkillRun['output']
      provenance_path: string[]
      created_at: Date
      classification: CapabilityClassification
      owner_team_id: string
    }>(
      `SELECT r.id, a.asset_key, r.version, r.actor_person_id, r.status, r.input, r.output,
              r.provenance_path, r.created_at, a.classification, a.owner_team_id
       FROM capability_skill_runs r JOIN capability_assets a ON a.id = r.capability_id
       WHERE r.workspace_id = $1 AND r.id = $2`,
      [workspaceId, runId]
    )
    const row = result.rows[0]
    if (!row) return null
    if (!decideCapabilityAccess(actor, { classification: row.classification, ownerTeamId: row.owner_team_id }).allowed) return 'denied'
    return {
      id: row.id,
      assetKey: row.asset_key,
      version: row.version,
      actorId: row.actor_person_id,
      status: row.status,
      input: row.input,
      output: row.output,
      provenancePath: row.provenance_path,
      createdAt: row.created_at.toISOString(),
    }
  }

  async summary(workspaceId: string): Promise<CapabilitySummary> {
    const result = await query<{
      assets: number
      active_people: number
      departed_people: number
      stewardship_transfers: number
      runnable_skills: number
      installations: number
      runs: number
    }>(
      `SELECT
        (SELECT count(*)::int FROM capability_assets WHERE workspace_id = $1) AS assets,
        (SELECT count(*)::int FROM capability_people WHERE workspace_id = $1 AND status = 'active') AS active_people,
        (SELECT count(*)::int FROM capability_people WHERE workspace_id = $1 AND status = 'departed') AS departed_people,
        (SELECT count(*)::int FROM capability_stewardship_assignments WHERE workspace_id = $1) AS stewardship_transfers,
        (SELECT count(*)::int FROM capability_assets WHERE workspace_id = $1 AND type = 'skill') AS runnable_skills,
        (SELECT count(*)::int FROM capability_installations WHERE workspace_id = $1) AS installations,
        (SELECT count(*)::int FROM capability_skill_runs WHERE workspace_id = $1) AS runs`,
      [workspaceId]
    )
    const row = requiredRow(result.rows[0])
    return {
      assets: Number(row.assets),
      activePeople: Number(row.active_people),
      departedPeople: Number(row.departed_people),
      stewardshipTransfers: Number(row.stewardship_transfers),
      runnableSkills: Number(row.runnable_skills),
      installations: Number(row.installations),
      runs: Number(row.runs),
    }
  }

  async departureScenario(workspaceId: string, actor: DemoActor): Promise<CapabilityDepartureScenario> {
    const search = await this.search(workspaceId, actor, { query: 'prepare weekly portfolio health digest', limit: 3 })
    const discoverable = search.some((item) => item.asset?.assetKey === 'ast-014')
    const provenancePath = await this.provenancePath(workspaceId, 'ast-014')
    const stewardshipAccepted = provenancePath.includes('STEWARDED_BY Dara Kim')
    const authorshipIntact = provenancePath.includes('AUTHORED_BY Mai Tran')
    return {
      passed: discoverable && stewardshipAccepted && authorshipIntact,
      discoverable,
      stewardshipAccepted,
      runnable: discoverable,
      authorshipIntact,
      outputDigest: '3 accounts need attention; 5 owner asks are ready for follow-up.',
      provenancePath,
    }
  }

  async seedDemo(workspaceId: string): Promise<void> {
    await transaction(async (client) => {
      for (const team of demoTeams) {
        await client.query(
          `INSERT INTO capability_teams (id, workspace_id, name, department) VALUES ($1,$2,$3,$4)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, department = EXCLUDED.department`,
          [team.id, workspaceId, team.name, team.department]
        )
      }
      for (const person of demoPeople) {
        await client.query(
          `INSERT INTO capability_people (id, workspace_id, name, role, team_id, status, clearance)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role,
             team_id = EXCLUDED.team_id, status = EXCLUDED.status, clearance = EXCLUDED.clearance`,
          [person.id, workspaceId, person.name, person.role, person.teamId, person.status, person.clearance]
        )
      }
      for (const capability of demoCapabilities) {
        const documentId = await upsertTextDocument(
          client,
          workspaceId,
          `${capability.assetKey}-${slug(capability.title)}.md`,
          `${capability.title}\n\n${capability.content}\n\nWhy it worked\n${capability.rationale}`
        )
        const assetResult = await client.query<{ id: string }>(
          `INSERT INTO capability_assets (
             workspace_id, asset_key, request_id, type, title, summary, content, rationale,
             classification, owner_team_id, current_version, outcome_score, usage_count,
             last_used_at, created_by_person_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'2026-07-04T00:00:00Z',$14)
           ON CONFLICT (workspace_id, asset_key) DO UPDATE SET
             title = EXCLUDED.title, summary = EXCLUDED.summary, content = EXCLUDED.content,
             rationale = EXCLUDED.rationale, classification = EXCLUDED.classification,
             owner_team_id = EXCLUDED.owner_team_id, current_version = EXCLUDED.current_version,
             outcome_score = EXCLUDED.outcome_score, usage_count = GREATEST(capability_assets.usage_count, EXCLUDED.usage_count),
             updated_at = now()
           RETURNING id`,
          [workspaceId, capability.assetKey, `seed-${capability.assetKey}`, capability.type, capability.title,
            capability.summary, capability.content, capability.rationale, capability.classification,
            capability.ownerTeamId, capability.version, capability.outcomeScore, capability.usageCount, 'person-mai-tran']
        )
        const assetId = requiredRow(assetResult.rows[0]).id
        await client.query(
          `INSERT INTO capability_asset_documents (capability_id, document_id, relationship)
           VALUES ($1,$2,'primary_artifact') ON CONFLICT DO NOTHING`,
          [assetId, documentId]
        )
        await client.query(
          `INSERT INTO capability_versions (
             workspace_id, capability_id, version, change_notes, snapshot, created_by_person_id, approved_by_person_id, created_at
           ) VALUES ($1,$2,$3,$4,$5,'person-mai-tran','person-alisa-ng','2026-06-14T03:00:00Z')
           ON CONFLICT (capability_id, version) DO UPDATE SET snapshot = EXCLUDED.snapshot`,
          [workspaceId, assetId, capability.version, 'Approved clean-room demo version.', capability]
        )
      }

      const astId = await assetIdFor(client, workspaceId, 'ast-014')
      const promptId = await assetIdFor(client, workspaceId, 'prompt-014')
      const agentId = await assetIdFor(client, workspaceId, 'agent-014')
      const skillId = await assetIdFor(client, workspaceId, 'skill-014')
      const edgeRows: Array<[string, string, string, string, string]> = [
        ['AUTHORED_BY', 'person', 'person-mai-tran', 'Mai Tran', 'Workflow v3.2 was authored by Mai before departure.'],
        ['STEWARDED_BY', 'person', 'person-dara-kim', 'Dara Kim', 'Dara accepted stewardship after Mai’s departure.'],
        ['DEPENDS_ON', 'capability', 'prompt-014', 'Portfolio Digest Prompt', 'Workflow v3.2 uses prompt-014.'],
        ['DEPENDS_ON', 'capability', 'agent-014', 'Portfolio Health Agent', 'Workflow v3.2 uses agent-014.'],
        ['DEPENDS_ON', 'capability', 'skill-014', 'Run Portfolio Health Digest', 'Workflow v3.2 runs skill-014.'],
      ]
      for (const [edgeType, targetKind, targetKey, targetLabel, evidence] of edgeRows) {
        await client.query(
          `INSERT INTO capability_edges (
             workspace_id, capability_id, edge_type, target_kind, target_key, target_label, evidence, created_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,'2026-07-08T04:00:00Z') ON CONFLICT DO NOTHING`,
          [workspaceId, astId, edgeType, targetKind, targetKey, targetLabel, evidence]
        )
      }
      for (const [childId, label] of [[promptId, 'Portfolio Digest Prompt'], [agentId, 'Portfolio Health Agent'], [skillId, 'Run Portfolio Health Digest']] as const) {
        await client.query(
          `INSERT INTO capability_edges (workspace_id, capability_id, edge_type, target_kind, target_key, target_label, evidence)
           VALUES ($1,$2,'AUTHORED_BY','person','person-mai-tran','Mai Tran',$3) ON CONFLICT DO NOTHING`,
          [workspaceId, childId, `${label} was authored by Mai Tran.`]
        )
      }
      await client.query(
        `INSERT INTO capability_stewardship_assignments (
           workspace_id, capability_id, from_person_id, to_person_id, reason, assigned_at, accepted_at
         ) VALUES ($1,$2,'person-mai-tran','person-dara-kim',$3,'2026-07-08T02:00:00Z','2026-07-08T04:00:00Z')
         ON CONFLICT (capability_id, to_person_id) DO UPDATE SET accepted_at = EXCLUDED.accepted_at`,
        [workspaceId, astId, 'Founder-mode continuity after Mai Tran departure.']
      )
      await client.query(
        `INSERT INTO capability_decisions (workspace_id, capability_id, decided_by_person_id, decision, rationale, decided_at)
         SELECT $1,$2,'person-alisa-ng','Approved continuity transfer to Dara Kim',
                'Dara has team match, clearance, and accepted stewardship.','2026-07-08T03:30:00Z'
         WHERE NOT EXISTS (SELECT 1 FROM capability_decisions WHERE capability_id = $2 AND decision = 'Approved continuity transfer to Dara Kim')`,
        [workspaceId, astId]
      )
      for (const outcome of [
        ['hours_saved_weekly', 6.5, 'hours'],
        ['owner_action_completion', 0.88, 'ratio'],
      ] as const) {
        await client.query(
          `INSERT INTO capability_outcomes (workspace_id, capability_id, metric_name, value, unit, measured_at)
           VALUES ($1,$2,$3,$4,$5,'2026-07-04') ON CONFLICT DO NOTHING`,
          [workspaceId, astId, ...outcome]
        )
      }
    })
  }

  private async lockedMetadata(
    workspaceId: string,
    actor: DemoActor,
    input: SearchCapabilitiesInput,
    limit: number
  ): Promise<CapabilitySearchResult[]> {
    if (!limit) return []
    const terms = (input.query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((term) => term.length > 2)
    if (!terms.length) return []
    const result = await query<AssetRow>(
      `${assetSelect}
       WHERE a.workspace_id = $1 AND a.status = 'active'
         AND ($2::text IS NULL OR a.type = $2)
         AND ($3::text IS NULL OR a.classification = $3)
         AND ($4::text IS NULL OR a.owner_team_id = $4)
         AND (a.title ILIKE ANY($5::text[]) OR a.summary ILIKE ANY($5::text[]))
       ORDER BY a.outcome_score DESC LIMIT $6`,
      [workspaceId, input.type ?? null, input.classification ?? null, input.ownerTeamId ?? null,
        terms.map((term) => `%${term}%`), limit * 2]
    )
    return result.rows
      .filter((row) => !decisionForRow(actor, row).allowed)
      .slice(0, limit)
      .map((row) => ({
        asset: null,
        locked: true,
        lockedMetadata: {
          assetKey: row.asset_key,
          title: row.title,
          type: row.type,
          classification: row.classification,
        },
        score: 0,
        reasons: ['Access is restricted by organizational governance policy.'],
        citations: [],
      }))
  }

  private async provenancePath(workspaceId: string, assetKey: string): Promise<string[]> {
    const result = await query<{ edge_type: string; target_label: string }>(
      `SELECT e.edge_type, e.target_label
       FROM capability_edges e JOIN capability_assets a ON a.id = e.capability_id
       WHERE e.workspace_id = $1 AND a.asset_key = $2 AND e.edge_type IN ('AUTHORED_BY', 'STEWARDED_BY')
       ORDER BY CASE e.edge_type WHEN 'AUTHORED_BY' THEN 1 ELSE 2 END`,
      [workspaceId, assetKey]
    )
    return [assetKey, ...result.rows.map((item) => `${item.edge_type} ${item.target_label}`)]
  }

  private async getBase(workspaceId: string, assetKey: string): Promise<CapabilityAsset | null> {
    const row = await this.getRow(workspaceId, assetKey)
    return row ? mapAsset(row) : null
  }

  private async getRow(workspaceId: string, assetKey: string): Promise<AssetRow | null> {
    const result = await query<AssetRow>(`${assetSelect} WHERE a.workspace_id = $1 AND a.asset_key = $2`, [workspaceId, assetKey])
    return result.rows[0] ?? null
  }

  private async audit(
    workspaceId: string,
    actorId: string,
    capabilityId: string | null,
    action: string,
    decision: 'allow' | 'deny',
    detail: Record<string, unknown>
  ): Promise<void> {
    await query(
      `INSERT INTO capability_audit_events (workspace_id, actor_person_id, capability_id, action, decision, detail)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [workspaceId, actorId, capabilityId, action, decision, detail]
    )
  }
}

async function upsertTextDocument(client: PoolClient, workspaceId: string, name: string, content: string): Promise<string> {
  const rawData = Buffer.from(content, 'utf8')
  const checksum = createHash('sha256').update(rawData).digest('hex')
  const result = await client.query<{ id: string }>(
    `INSERT INTO knowledge_documents (
       workspace_id, name, mime_type, size_bytes, content_sha256, raw_data,
       extracted_text, summary, status, requires_ocr
     ) VALUES ($1,$2,'text/markdown',$3,$4,$5,$6,$7,'ready',false)
     ON CONFLICT (workspace_id, content_sha256) DO UPDATE SET
       name = EXCLUDED.name, extracted_text = EXCLUDED.extracted_text,
       summary = EXCLUDED.summary, status = 'ready', updated_at = now()
     RETURNING id`,
    [workspaceId, name, rawData.length, checksum, rawData, content, content.slice(0, 700)]
  )
  const documentId = requiredRow(result.rows[0]).id
  await client.query('DELETE FROM document_chunks WHERE workspace_id = $1 AND document_id = $2', [workspaceId, documentId])
  await client.query(
    `INSERT INTO document_chunks (workspace_id, document_id, chunk_index, content, token_estimate, embedding)
     VALUES ($1,$2,0,$3,$4,$5::vector)`,
    [workspaceId, documentId, content, Math.ceil(content.length / 4), toVectorLiteral(embedText(content))]
  )
  await client.query(
    `INSERT INTO ingestion_events (workspace_id, document_id, stage, detail)
     VALUES ($1,$2,'ready',$3)`,
    [workspaceId, documentId, { source: 'capability_capture' }]
  )
  return documentId
}

async function uniqueAssetKey(client: PoolClient, workspaceId: string, title: string, requestId: string): Promise<string> {
  const base = slug(title).slice(0, 32) || 'capability'
  const suffix = createHash('sha256').update(requestId).digest('hex').slice(0, 6)
  const key = `${base}-${suffix}`
  const exists = await client.query('SELECT id FROM capability_assets WHERE workspace_id = $1 AND asset_key = $2', [workspaceId, key])
  return exists.rowCount ? `${base}-${suffix}-${Date.now().toString(36)}` : key
}

async function assetIdFor(client: PoolClient, workspaceId: string, assetKey: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    'SELECT id FROM capability_assets WHERE workspace_id = $1 AND asset_key = $2',
    [workspaceId, assetKey]
  )
  return requiredRow(result.rows[0]).id
}

function mapAsset(row: AssetRow): CapabilityAsset {
  return {
    id: row.id,
    assetKey: row.asset_key,
    type: row.type,
    title: row.title,
    summary: row.summary,
    classification: row.classification,
    ownerTeamId: row.owner_team_id,
    ownerTeamName: row.owner_team_name,
    status: row.status,
    currentVersion: row.current_version,
    currentSteward: row.current_steward,
    outcomeScore: Number(row.outcome_score),
    usageCount: Number(row.usage_count),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function decisionForRow(actor: DemoActor, row: AssetRow) {
  return decideCapabilityAccess(actor, {
    classification: row.classification,
    ownerTeamId: row.owner_team_id,
  })
}

function mapSearchResult(row: SearchRow): CapabilitySearchResult {
  const reasons = ['Learning Library content match']
  if (Number(row.outcome_score) >= 0.9) reasons.push('High measured outcome quality')
  if (Number(row.usage_count) >= 30) reasons.push('Frequently reused')
  return {
    asset: mapAsset(row),
    locked: false,
    score: Number(Number(row.score).toFixed(4)),
    reasons,
    citations: [{
      label: row.document_name,
      documentId: row.document_id,
      documentName: row.document_name,
      chunkId: row.chunk_id,
      excerpt: row.chunk_content.slice(0, 280),
      score: Number(row.score),
      relationship: row.relationship,
    }],
  }
}

function mergeSearchRows(rows: SearchRow[]): CapabilitySearchResult[] {
  const merged = new Map<string, CapabilitySearchResult>()
  for (const row of rows) {
    const item = mapSearchResult(row)
    const existing = merged.get(row.id)
    if (!existing) {
      merged.set(row.id, item)
      continue
    }
    existing.score = Math.max(existing.score, item.score)
    if (!existing.citations.some((citation) => citation.chunkId === item.citations[0]?.chunkId)) {
      existing.citations.push(...item.citations)
    }
  }
  return [...merged.values()].sort((left, right) => right.score - left.score)
}

function buildLexicalQuery(value: string): string {
  const terms = new Set((value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((term) => term.length > 2))
  return terms.size ? [...terms].slice(0, 24).map((term) => `${term}:*`).join(' | ') : '__no_match__'
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function requiredRow<T>(row: T | undefined): T {
  if (!row) throw new Error('Expected database row was not returned')
  return row
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}
