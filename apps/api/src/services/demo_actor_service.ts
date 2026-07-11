import type { DemoActor } from '@hackathon/shared'
import type { Request } from 'express'
import type { QueryResultRow } from 'pg'
import { query } from '../db/pool.js'

const defaultActorId = 'person-laura-nguyen'
const allowedActorIds = new Set(['person-laura-nguyen', 'person-eugene-koon', 'person-denning-tan'])

interface ActorRow extends QueryResultRow {
  id: string
  name: string
  role: string
  team_id: string
  team_name: string
  department: string
  status: DemoActor['status']
  clearance: DemoActor['clearance']
}

export function requestedDemoActorId(req: Request): string {
  return selectDemoActorId(req.header('x-demo-actor-id'))
}

export function selectDemoActorId(headerValue: string | undefined): string {
  const candidate = headerValue?.trim()
  return candidate || defaultActorId
}

export function isAllowlistedDemoActorId(actorId: string): boolean {
  return allowedActorIds.has(actorId)
}

export async function resolveDemoActor(workspaceId: string, actorId: string): Promise<DemoActor | null> {
  if (!allowedActorIds.has(actorId)) return null
  const result = await query<ActorRow>(
    `SELECT p.id, p.name, p.role, p.team_id, t.name AS team_name, t.department, p.status, p.clearance
     FROM capability_people p
     JOIN capability_teams t ON t.id = p.team_id AND t.workspace_id = p.workspace_id
     WHERE p.workspace_id = $1 AND p.id = $2`,
    [workspaceId, actorId]
  )
  const row = result.rows[0]
  return row ? mapActor(row) : null
}

export async function listDemoActors(workspaceId: string): Promise<DemoActor[]> {
  const result = await query<ActorRow>(
    `SELECT p.id, p.name, p.role, p.team_id, t.name AS team_name, t.department, p.status, p.clearance
     FROM capability_people p
     JOIN capability_teams t ON t.id = p.team_id AND t.workspace_id = p.workspace_id
     WHERE p.workspace_id = $1 AND p.id = ANY($2::text[])
     ORDER BY p.name`,
    [workspaceId, [...allowedActorIds]]
  )
  return result.rows.map(mapActor)
}

function mapActor(row: ActorRow): DemoActor {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    teamId: row.team_id,
    teamName: row.team_name,
    department: row.department,
    status: row.status,
    clearance: row.clearance,
  }
}
