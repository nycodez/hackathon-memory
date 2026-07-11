import type { CalendarWindow, TaskOccurrence, TaskRecurrence, TaskSchedule } from '@hackathon/shared'
import type { QueryResultRow } from 'pg'
import { query } from '../db/pool.js'

interface ScheduleRow extends QueryResultRow {
  id: string
  task_id: string
  task_name: string
  scheduled_for: Date
  timezone: string
  recurrence: TaskRecurrence
  created_at: Date
  updated_at: Date
}

const scheduleSelect = `
  SELECT s.id, s.task_id, t.name AS task_name, s.scheduled_for, s.timezone,
         s.recurrence, s.created_at, s.updated_at
  FROM memory_task_schedules s
  JOIN memory_tasks t ON t.id = s.task_id
`

export default class CalendarRepository {
  async window(workspaceId: string, from: Date, to: Date): Promise<CalendarWindow> {
    const result = await query<ScheduleRow>(
      `${scheduleSelect}
       WHERE s.workspace_id = $1 AND t.workspace_id = $1
       ORDER BY s.scheduled_for, lower(t.name)`,
      [workspaceId]
    )
    const schedules = result.rows.map(mapSchedule)
    const occurrences = schedules
      .flatMap((schedule) => expandSchedule(schedule, from, to))
      .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor))

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      schedules,
      occurrences,
    }
  }

  async upsert(
    workspaceId: string,
    taskId: string,
    scheduledFor: Date,
    timezone: string,
    recurrence: TaskRecurrence
  ): Promise<TaskSchedule | null> {
    const result = await query<ScheduleRow>(
      `INSERT INTO memory_task_schedules (workspace_id, task_id, scheduled_for, timezone, recurrence)
       SELECT $1, t.id, $3, $4, $5
       FROM memory_tasks t
       WHERE t.id = $2 AND t.workspace_id = $1
       ON CONFLICT (task_id) DO UPDATE SET
         scheduled_for = EXCLUDED.scheduled_for,
         timezone = EXCLUDED.timezone,
         recurrence = EXCLUDED.recurrence,
         updated_at = now()
       RETURNING id, task_id,
         (SELECT task.name FROM memory_tasks task WHERE task.id = memory_task_schedules.task_id) AS task_name,
         scheduled_for, timezone, recurrence, created_at, updated_at`,
      [workspaceId, taskId, scheduledFor, timezone, recurrence]
    )
    const row = result.rows[0]
    return row ? mapSchedule(row) : null
  }

  async remove(workspaceId: string, id: string): Promise<boolean> {
    const result = await query(
      'DELETE FROM memory_task_schedules WHERE workspace_id = $1 AND id = $2',
      [workspaceId, id]
    )
    return result.rowCount === 1
  }
}

function mapSchedule(row: ScheduleRow): TaskSchedule {
  return {
    id: row.id,
    taskId: row.task_id,
    taskName: row.task_name,
    scheduledFor: row.scheduled_for.toISOString(),
    timezone: row.timezone,
    recurrence: row.recurrence,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function expandSchedule(schedule: TaskSchedule, from: Date, to: Date): TaskOccurrence[] {
  const occurrences: TaskOccurrence[] = []
  let cursor = new Date(schedule.scheduledFor)
  const anchorDay = cursor.getUTCDate()
  const fromTime = from.getTime()
  const toTime = to.getTime()

  if (schedule.recurrence === 'once') {
    if (cursor.getTime() >= fromTime && cursor.getTime() < toTime) occurrences.push(toOccurrence(schedule, cursor))
    return occurrences
  }

  cursor = fastForward(cursor, from, schedule.recurrence, anchorDay)
  while (cursor.getTime() < fromTime) {
    cursor = nextOccurrence(cursor, schedule.recurrence, anchorDay)
  }
  while (cursor.getTime() < toTime && occurrences.length < 500) {
    occurrences.push(toOccurrence(schedule, cursor))
    cursor = nextOccurrence(cursor, schedule.recurrence, anchorDay)
  }
  return occurrences
}

function fastForward(
  value: Date,
  from: Date,
  recurrence: Exclude<TaskRecurrence, 'once'>,
  anchorDay: number
): Date {
  if (value.getTime() >= from.getTime()) return value
  if (recurrence === 'daily' || recurrence === 'weekly') {
    const interval = (recurrence === 'daily' ? 1 : 7) * 24 * 60 * 60 * 1_000
    const elapsedIntervals = Math.floor((from.getTime() - value.getTime()) / interval)
    return new Date(value.getTime() + Math.max(0, elapsedIntervals) * interval)
  }

  const elapsedMonths = Math.max(0,
    (from.getUTCFullYear() - value.getUTCFullYear()) * 12 + from.getUTCMonth() - value.getUTCMonth() - 1
  )
  let cursor = new Date(value)
  if (elapsedMonths) {
    cursor.setUTCDate(1)
    cursor.setUTCMonth(cursor.getUTCMonth() + elapsedMonths)
    const lastDay = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)).getUTCDate()
    cursor.setUTCDate(Math.min(anchorDay, lastDay))
  }
  return cursor
}

function nextOccurrence(
  value: Date,
  recurrence: Exclude<TaskRecurrence, 'once'>,
  anchorDay: number
): Date {
  if (recurrence === 'daily') return new Date(value.getTime() + 24 * 60 * 60 * 1_000)
  if (recurrence === 'weekly') return new Date(value.getTime() + 7 * 24 * 60 * 60 * 1_000)

  const next = new Date(value)
  next.setUTCDate(1)
  next.setUTCMonth(next.getUTCMonth() + 1)
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate()
  next.setUTCDate(Math.min(anchorDay, lastDay))
  return next
}

function toOccurrence(schedule: TaskSchedule, scheduledFor: Date): TaskOccurrence {
  return {
    scheduleId: schedule.id,
    taskId: schedule.taskId,
    taskName: schedule.taskName,
    scheduledFor: scheduledFor.toISOString(),
    timezone: schedule.timezone,
    recurrence: schedule.recurrence,
  }
}
