import type { MemorizedTask } from '@hackathon/shared'
import type { QueryResultRow } from 'pg'
import { query, transaction } from '../db/pool.js'
import { resolveSkills } from '../services/task_catalog.js'

interface TaskRow extends QueryResultRow {
  id: string
  name: string
  description: string
  skill_codes: string[]
  created_at: Date
  updated_at: Date
}

const taskSelect = `
  SELECT t.id, t.name, t.description, t.created_at, t.updated_at,
         coalesce(
           array_agg(s.skill_code ORDER BY s.position) FILTER (WHERE s.id IS NOT NULL),
           ARRAY[]::text[]
         ) AS skill_codes
  FROM memory_tasks t
  LEFT JOIN memory_task_steps s ON s.task_id = t.id
`

export default class TasksRepository {
  async list(workspaceId: string): Promise<MemorizedTask[]> {
    const result = await query<TaskRow>(
      `${taskSelect}
       WHERE t.workspace_id = $1
       GROUP BY t.id
       ORDER BY t.updated_at DESC, lower(t.name)`,
      [workspaceId]
    )
    return result.rows.map(mapTask)
  }

  async create(
    workspaceId: string,
    name: string,
    description: string,
    skillCodes: string[]
  ): Promise<MemorizedTask> {
    return transaction(async (client) => {
      try {
        const taskResult = await client.query<Omit<TaskRow, 'skill_codes'>>(
          `INSERT INTO memory_tasks (workspace_id, name, description)
           VALUES ($1, $2, $3)
           RETURNING id, name, description, created_at, updated_at`,
          [workspaceId, name, description]
        )
        const task = taskResult.rows[0]
        if (!task) throw new Error('Task could not be created')

        await client.query(
          `INSERT INTO memory_task_steps (task_id, skill_code, position)
           SELECT $1, selected.skill_code, selected.position - 1
           FROM unnest($2::text[]) WITH ORDINALITY AS selected(skill_code, position)`,
          [task.id, skillCodes]
        )

        return {
          id: task.id,
          name: task.name,
          description: task.description,
          skills: resolveSkills(skillCodes),
          createdAt: task.created_at.toISOString(),
          updatedAt: task.updated_at.toISOString(),
        }
      } catch (error) {
        if (isUniqueViolation(error)) throw new Error('A task with this name already exists')
        throw error
      }
    })
  }

  async update(
    workspaceId: string,
    id: string,
    name: string,
    description: string,
    skillCodes: string[]
  ): Promise<MemorizedTask | null> {
    return transaction(async (client) => {
      try {
        const taskResult = await client.query<Omit<TaskRow, 'skill_codes'>>(
          `UPDATE memory_tasks
           SET name = $3, description = $4, updated_at = now()
           WHERE workspace_id = $1 AND id = $2
           RETURNING id, name, description, created_at, updated_at`,
          [workspaceId, id, name, description]
        )
        const task = taskResult.rows[0]
        if (!task) return null

        await client.query('DELETE FROM memory_task_steps WHERE task_id = $1', [id])
        await client.query(
          `INSERT INTO memory_task_steps (task_id, skill_code, position)
           SELECT $1, selected.skill_code, selected.position - 1
           FROM unnest($2::text[]) WITH ORDINALITY AS selected(skill_code, position)`,
          [id, skillCodes]
        )

        return {
          id: task.id,
          name: task.name,
          description: task.description,
          skills: resolveSkills(skillCodes),
          createdAt: task.created_at.toISOString(),
          updatedAt: task.updated_at.toISOString(),
        }
      } catch (error) {
        if (isUniqueViolation(error)) throw new Error('A task with this name already exists')
        throw error
      }
    })
  }

  async remove(workspaceId: string, id: string): Promise<boolean> {
    const result = await query(
      'DELETE FROM memory_tasks WHERE workspace_id = $1 AND id = $2',
      [workspaceId, id]
    )
    return result.rowCount === 1
  }
}

function mapTask(row: TaskRow): MemorizedTask {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    skills: resolveSkills(row.skill_codes),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}
