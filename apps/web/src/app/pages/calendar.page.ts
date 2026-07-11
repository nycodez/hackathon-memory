import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { ActivatedRoute, RouterLink } from '@angular/router'
import type {
  CalendarWindow,
  MemorizedTask,
  TaskOccurrence,
  TaskRecurrence,
  TaskSchedule,
} from '@hackathon/shared'
import { finalize, forkJoin } from 'rxjs'
import { ApiService } from '../core/api.service'

interface CalendarOccurrence extends TaskOccurrence {
  timeLabel: string
}

interface CalendarDay {
  key: string
  dayNumber: number
  inMonth: boolean
  isToday: boolean
  occurrences: CalendarOccurrence[]
}

interface ScheduleView extends TaskSchedule {
  dateLabel: string
  recurrenceLabel: string
}

const emptyCalendar: CalendarWindow = {
  from: '',
  to: '',
  schedules: [],
  occurrences: [],
}

const recurrenceLabels: Record<TaskRecurrence, string> = {
  once: 'One time',
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month',
}

@Component({
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="page calendar-page">
      <header class="page-header compact-header">
        <div>
          <span class="eyebrow">Task operations</span>
          <h1>Calendar</h1>
          <p>See when remembered tasks are planned to run and assign a one-time or recurring schedule.</p>
        </div>
      </header>

      @if (error()) {
        <div class="state-card error" role="alert">{{ error() }}</div>
      }
      @if (notice()) {
        <div class="calendar-notice" role="status">{{ notice() }}</div>
      }

      <div class="calendar-layout">
        <section class="calendar-board" aria-labelledby="calendar-month-title">
          <header class="calendar-toolbar">
            <div>
              <span class="eyebrow">Planned runs</span>
              <h2 id="calendar-month-title">{{ monthTitle() }}</h2>
            </div>
            <div class="calendar-controls" aria-label="Calendar navigation">
              <button type="button" [disabled]="calendarLoading()" (click)="previousMonth()" aria-label="Previous month">←</button>
              <button type="button" class="today-button" [disabled]="calendarLoading()" (click)="today()">Today</button>
              <button type="button" [disabled]="calendarLoading()" (click)="nextMonth()" aria-label="Next month">→</button>
            </div>
          </header>

          @if (calendarLoading()) {
            <div class="calendar-loading" role="status">Loading calendar…</div>
          } @else {
            <div class="calendar-grid" role="grid" [attr.aria-label]="monthTitle()">
              @for (weekday of weekdays; track weekday) {
                <div class="calendar-weekday" role="columnheader">{{ weekday }}</div>
              }
              @for (day of calendarDays(); track day.key) {
                <article class="calendar-day" role="gridcell" [class.outside-month]="!day.inMonth" [class.today]="day.isToday">
                  <span class="calendar-date">{{ day.dayNumber }}</span>
                  <div class="calendar-day-events">
                    @for (occurrence of day.occurrences; track occurrence.scheduleId + occurrence.scheduledFor) {
                      <div class="calendar-event" [title]="occurrence.taskName + ' · ' + occurrence.timeLabel">
                        <time>{{ occurrence.timeLabel }}</time>
                        <strong>{{ occurrence.taskName }}</strong>
                        @if (occurrence.recurrence !== 'once') { <span aria-label="Recurring">↻</span> }
                      </div>
                    }
                  </div>
                </article>
              }
            </div>
          }
        </section>

        <aside class="schedule-column">
          <section id="schedule-task" class="schedule-card" aria-labelledby="schedule-title">
            <span class="eyebrow">Add or update</span>
            <h2 id="schedule-title">Schedule a task</h2>
            <p>Each memorized task has one active schedule. Saving it again updates that schedule.</p>

            @if (tasksLoading()) {
              <div class="schedule-empty">Loading tasks…</div>
            } @else if (!tasks().length) {
              <div class="schedule-empty">
                <strong>No tasks to schedule</strong>
                <span>Memorize a task before placing it on the calendar.</span>
                <a routerLink="/tasks">Go to Tasks →</a>
              </div>
            } @else {
              <form class="schedule-form" (submit)="saveSchedule($event)">
                <label>
                  <span>Task</span>
                  <select #taskSelect [value]="selectedTaskId()" (change)="selectTask(taskSelect.value)">
                    @for (task of tasks(); track task.id) { <option [value]="task.id" [selected]="task.id === selectedTaskId()">{{ task.name }}</option> }
                  </select>
                </label>
                <label>
                  <span>Starts</span>
                  <input #dateInput type="datetime-local" [value]="scheduledFor()" (input)="scheduledFor.set(dateInput.value)">
                </label>
                <label>
                  <span>Repeats</span>
                  <select #recurrenceSelect [value]="recurrence()" (change)="setRecurrence(recurrenceSelect.value)">
                    <option value="once">One time</option>
                    <option value="daily">Every day</option>
                    <option value="weekly">Every week</option>
                    <option value="monthly">Every month</option>
                  </select>
                </label>
                <div class="timezone-note"><span>Timezone</span><strong>{{ timezone }}</strong></div>
                <button class="button primary" type="submit" [disabled]="saving() || !selectedTaskId() || !scheduledFor()">
                  {{ saving() ? 'Saving…' : 'Save schedule' }}
                </button>
              </form>
            }
          </section>

          <section class="schedule-list-card" aria-labelledby="schedule-list-title">
            <div class="schedule-list-heading">
              <div><span class="eyebrow">Planned queue</span><h2 id="schedule-list-title">Active schedules</h2></div>
              <span>{{ scheduleViews().length }}</span>
            </div>
            @if (calendarLoading()) {
              <div class="schedule-empty">Loading schedules…</div>
            } @else if (!scheduleViews().length) {
              <div class="schedule-empty"><strong>No active schedules</strong><span>Scheduled tasks will appear here and on the month grid.</span></div>
            } @else {
              <ol class="schedule-list">
                @for (schedule of scheduleViews(); track schedule.id) {
                  <li>
                    <span class="schedule-marker"></span>
                    <div>
                      <strong>{{ schedule.taskName }}</strong>
                      <time>{{ schedule.dateLabel }}</time>
                      <small>{{ schedule.recurrenceLabel }} · {{ schedule.timezone }}</small>
                    </div>
                    <button type="button" [disabled]="deletingId() === schedule.id" (click)="deleteSchedule(schedule.id)" [attr.aria-label]="'Remove schedule for ' + schedule.taskName">×</button>
                  </li>
                }
              </ol>
            }
          </section>
        </aside>
      </div>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarPage implements OnInit {
  private readonly api = inject(ApiService)
  private readonly destroyRef = inject(DestroyRef)
  private readonly route = inject(ActivatedRoute)
  protected readonly weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  protected readonly timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  protected readonly tasks = signal<MemorizedTask[]>([])
  protected readonly calendar = signal<CalendarWindow>(emptyCalendar)
  protected readonly currentMonth = signal(startOfMonth(new Date()))
  protected readonly tasksLoading = signal(true)
  protected readonly calendarLoading = signal(true)
  protected readonly saving = signal(false)
  protected readonly deletingId = signal<string | null>(null)
  protected readonly error = signal('')
  protected readonly notice = signal('')
  protected readonly selectedTaskId = signal('')
  protected readonly scheduledFor = signal(defaultLocalDateTime())
  protected readonly recurrence = signal<TaskRecurrence>('weekly')

  protected readonly monthTitle = computed(() => new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
  }).format(this.currentMonth()))

  protected readonly calendarDays = computed<CalendarDay[]>(() => {
    const month = this.currentMonth()
    const start = calendarGridStart(month)
    const todayKey = localDateKey(new Date())
    const occurrenceMap = new Map<string, CalendarOccurrence[]>()
    for (const occurrence of this.calendar().occurrences) {
      const date = new Date(occurrence.scheduledFor)
      const key = localDateKey(date)
      const current = occurrenceMap.get(key) ?? []
      current.push({
        ...occurrence,
        timeLabel: new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date),
      })
      occurrenceMap.set(key, current)
    }

    return Array.from({ length: 42 }, (_, index) => {
      const date = addDays(start, index)
      const key = localDateKey(date)
      return {
        key,
        dayNumber: date.getDate(),
        inMonth: date.getMonth() === month.getMonth(),
        isToday: key === todayKey,
        occurrences: occurrenceMap.get(key) ?? [],
      }
    })
  })

  protected readonly scheduleViews = computed<ScheduleView[]>(() => this.calendar().schedules.map((schedule) => ({
    ...schedule,
    dateLabel: new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(schedule.scheduledFor)),
    recurrenceLabel: recurrenceLabels[schedule.recurrence],
  })))

  ngOnInit(): void {
    const range = calendarRange(this.currentMonth())
    forkJoin({
      workspace: this.api.taskWorkspace(),
      calendar: this.api.calendarWindow(range.from, range.to),
    }).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => {
        this.tasksLoading.set(false)
        this.calendarLoading.set(false)
      })
    ).subscribe({
      next: ({ workspace, calendar }) => {
        this.calendar.set(calendar)
        const requestedTaskId = this.route.snapshot.queryParamMap.get('task')
        const requestedTaskExists = workspace.tasks.some((task) => task.id === requestedTaskId)
        const selectedTaskId = requestedTaskExists ? (requestedTaskId ?? '') : (workspace.tasks[0]?.id ?? '')
        this.selectedTaskId.set(selectedTaskId)
        this.tasks.set(workspace.tasks)
        this.applyExistingSchedule(selectedTaskId)
      },
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }

  protected previousMonth(): void {
    this.changeMonth(-1)
  }

  protected nextMonth(): void {
    this.changeMonth(1)
  }

  protected today(): void {
    this.currentMonth.set(startOfMonth(new Date()))
    this.loadCalendar()
  }

  protected setRecurrence(value: string): void {
    if (value === 'once' || value === 'daily' || value === 'weekly' || value === 'monthly') {
      this.recurrence.set(value)
    }
  }

  protected selectTask(taskId: string): void {
    this.selectedTaskId.set(taskId)
    this.applyExistingSchedule(taskId)
  }

  protected saveSchedule(event: Event): void {
    event.preventDefault()
    const taskId = this.selectedTaskId()
    const date = new Date(this.scheduledFor())
    if (!taskId || Number.isNaN(date.getTime()) || this.saving()) return

    this.saving.set(true)
    this.error.set('')
    this.notice.set('')
    this.api.scheduleTask(taskId, date.toISOString(), this.timezone, this.recurrence()).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.saving.set(false))
    ).subscribe({
      next: (schedule) => {
        this.notice.set(`${schedule.taskName} is scheduled.`)
        this.currentMonth.set(startOfMonth(date))
        this.loadCalendar()
      },
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }

  protected deleteSchedule(id: string): void {
    if (this.deletingId()) return
    this.deletingId.set(id)
    this.error.set('')
    this.notice.set('')
    this.api.deleteTaskSchedule(id).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.deletingId.set(null))
    ).subscribe({
      next: () => {
        this.notice.set('Schedule removed.')
        this.loadCalendar()
      },
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }

  private changeMonth(offset: number): void {
    const next = new Date(this.currentMonth())
    next.setMonth(next.getMonth() + offset)
    this.currentMonth.set(startOfMonth(next))
    this.loadCalendar()
  }

  private applyExistingSchedule(taskId: string): void {
    const existingSchedule = this.calendar().schedules.find((schedule) => schedule.taskId === taskId)
    if (existingSchedule) {
      this.scheduledFor.set(toLocalDateTimeInput(new Date(existingSchedule.scheduledFor)))
      this.recurrence.set(existingSchedule.recurrence)
      return
    }
    this.scheduledFor.set(defaultLocalDateTime())
    this.recurrence.set('weekly')
  }

  private loadCalendar(): void {
    const range = calendarRange(this.currentMonth())
    this.calendarLoading.set(true)
    this.error.set('')
    this.api.calendarWindow(range.from, range.to).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.calendarLoading.set(false))
    ).subscribe({
      next: (calendar) => this.calendar.set(calendar),
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }
}

function startOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1)
}

function calendarGridStart(month: Date): Date {
  return addDays(month, -month.getDay())
}

function calendarRange(month: Date): { from: string; to: string } {
  const from = calendarGridStart(month)
  return { from: from.toISOString(), to: addDays(from, 42).toISOString() }
}

function addDays(value: Date, days: number): Date {
  const date = new Date(value)
  date.setDate(date.getDate() + days)
  return date
}

function localDateKey(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function defaultLocalDateTime(): string {
  const value = new Date()
  value.setDate(value.getDate() + 1)
  value.setMinutes(0, 0, 0)
  value.setHours(9)
  return toLocalDateTimeInput(value)
}

function toLocalDateTimeInput(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  const hour = String(value.getHours()).padStart(2, '0')
  const minute = String(value.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hour}:${minute}`
}
