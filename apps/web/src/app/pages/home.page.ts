import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { RouterLink } from '@angular/router'
import type { CalendarWindow, TaskOccurrence, TaskWorkspace } from '@hackathon/shared'
import { finalize, forkJoin } from 'rxjs'
import { ApiService } from '../core/api.service'

interface MemorySearchResult {
  id: string
  type: 'Saved task' | 'Capability' | 'Atomic skill'
  name: string
  description: string
  detail: string
  route: string
  fragment?: string
  queryParams?: Record<string, string>
}

interface UpcomingRun extends TaskOccurrence {
  dateLabel: string
  recurrenceLabel: string
}

const emptyWorkspace: TaskWorkspace = {
  skillGroups: [],
  templates: [],
  tasks: [],
}

const emptyCalendar: CalendarWindow = {
  from: '',
  to: '',
  schedules: [],
  occurrences: [],
}

@Component({
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="page page-home memory-home">
      <header class="memory-search-hero">
        <span class="eyebrow">Organizational memory</span>
        <h1>Find the work your organization already knows how to do.</h1>
        <p>Search saved tasks, reusable capabilities, and atomic skills by name.</p>

        <div class="memory-search" [class.has-results]="hasSearchQuery()">
          <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"></circle><path d="m16 16 4 4"></path></svg>
          <input #searchInput type="search" autocomplete="off" placeholder="Search weekly AP run, vendor bill, meeting follow-up…" [value]="searchQuery()" (input)="searchQuery.set(searchInput.value)" aria-label="Search organizational memory">
          @if (searchQuery()) {
            <button type="button" (click)="clearSearch()" aria-label="Clear search">×</button>
          }

          @if (hasSearchQuery()) {
            <div class="memory-search-results" role="listbox" aria-label="Organizational memory search results">
              @if (searchResults().length) {
                @for (result of searchResults(); track result.type + result.id) {
                  <a [routerLink]="result.route" [fragment]="result.fragment" [queryParams]="result.queryParams" role="option">
                    <span class="search-result-kind" [attr.data-kind]="result.type">{{ result.type }}</span>
                    <div><strong>{{ result.name }}</strong><small>{{ result.description }}</small></div>
                    <span class="search-result-detail">{{ result.detail }}</span>
                    <i aria-hidden="true">→</i>
                  </a>
                }
              } @else {
                <div class="memory-search-empty"><strong>No matching memory</strong><span>Try a task, capability, or skill name.</span></div>
              }
            </div>
          }
        </div>

        <div class="memory-search-prompts" aria-label="Suggested searches">
          <span>Try</span>
          @for (suggestion of searchSuggestions; track suggestion) {
            <button type="button" (click)="searchQuery.set(suggestion)">{{ suggestion }}</button>
          }
        </div>
      </header>

      @if (loading()) {
        <div class="state-card" role="status">Loading organizational memory…</div>
      } @else if (error()) {
        <div class="state-card error" role="alert">{{ error() }}</div>
      } @else {
        <section class="memory-metric-grid" aria-label="Task memory summary">
          <a class="memory-metric" routerLink="/tasks">
            <span class="memory-metric-icon">✓</span>
            <div><small>Memorized tasks</small><strong>{{ workspace().tasks.length }}</strong><p>Saved, ordered workflows</p></div>
          </a>
          <a class="memory-metric" routerLink="/tasks" fragment="templates-title">
            <span class="memory-metric-icon">◇</span>
            <div><small>Capabilities</small><strong>{{ workspace().templates.length }}</strong><p>Reusable task blueprints</p></div>
          </a>
          <a class="memory-metric" routerLink="/skills">
            <span class="memory-metric-icon">+</span>
            <div><small>Atomic skills</small><strong>{{ skillCount() }}</strong><p>{{ accountingSkillCount() }} accounting skills</p></div>
          </a>
          <a class="memory-metric" routerLink="/calendar">
            <span class="memory-metric-icon">□</span>
            <div><small>Scheduled tasks</small><strong>{{ calendar().schedules.length }}</strong><p>Active planned schedules</p></div>
          </a>
        </section>

        <div class="memory-widget-grid">
          <section class="memory-widget upcoming-widget" aria-labelledby="upcoming-title">
            <header class="memory-widget-heading">
              <div><span class="eyebrow">Operations</span><h2 id="upcoming-title">Upcoming task runs</h2></div>
              <a routerLink="/calendar">Open calendar →</a>
            </header>
            @if (upcomingRuns().length) {
              <ol class="upcoming-run-list">
                @for (run of upcomingRuns(); track run.scheduleId + run.scheduledFor) {
                  <li>
                    <span class="run-sequence">0{{ $index + 1 }}</span>
                    <div><strong>{{ run.taskName }}</strong><time>{{ run.dateLabel }}</time></div>
                    <small>{{ run.recurrenceLabel }}</small>
                  </li>
                }
              </ol>
            } @else {
              <div class="memory-widget-empty">
                <span>□</span>
                <div><strong>Nothing scheduled yet</strong><small>Put a memorized task on the calendar to see its next runs here.</small></div>
                <a class="button secondary" routerLink="/calendar">Schedule a task</a>
              </div>
            }
          </section>

          <section class="memory-widget saved-task-widget" aria-labelledby="saved-tasks-title">
            <header class="memory-widget-heading">
              <div><span class="eyebrow">Workspace</span><h2 id="saved-tasks-title">Recently memorized</h2></div>
              <a routerLink="/tasks">View tasks →</a>
            </header>
            @if (workspace().tasks.length) {
              <div class="home-saved-task-list">
                @for (task of recentTasks(); track task.id) {
                  <a routerLink="/tasks">
                    <span>{{ task.skills.length }}</span>
                    <div><strong>{{ task.name }}</strong><small>{{ task.description || 'Saved task sequence' }}</small></div>
                    <i aria-hidden="true">→</i>
                  </a>
                }
              </div>
            } @else {
              <div class="memory-widget-empty compact">
                <span>◇</span>
                <div><strong>No tasks memorized</strong><small>Start from a capability or compose one from atomic skills.</small></div>
                <a class="button secondary" routerLink="/tasks">Create a task</a>
              </div>
            }
          </section>
        </div>

        <section class="memory-widget capability-widget" aria-labelledby="capabilities-title">
          <header class="memory-widget-heading">
            <div><span class="eyebrow">Ready to adapt</span><h2 id="capabilities-title">Reusable capabilities</h2></div>
            <a routerLink="/tasks" fragment="templates-title">Browse all →</a>
          </header>
          <div class="home-capability-grid">
            @for (capability of workspace().templates; track capability.code) {
              <a routerLink="/tasks" fragment="templates-title">
                <span>0{{ $index + 1 }}</span>
                <h3>{{ capability.name }}</h3>
                <p>{{ capability.description }}</p>
                <small>{{ capability.skills.length }} skills <i aria-hidden="true">→</i></small>
              </a>
            }
          </div>
        </section>
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage implements OnInit {
  private readonly api = inject(ApiService)
  private readonly destroyRef = inject(DestroyRef)
  protected readonly searchSuggestions = ['Weekly AP run', 'Pay a vendor bill', 'Meeting follow-up']
  protected readonly loading = signal(true)
  protected readonly error = signal('')
  protected readonly workspace = signal<TaskWorkspace>(emptyWorkspace)
  protected readonly calendar = signal<CalendarWindow>(emptyCalendar)
  protected readonly searchQuery = signal('')

  protected readonly skillCount = computed(() => this.workspace().skillGroups
    .reduce((count, group) => count + group.skills.length, 0))
  protected readonly accountingSkillCount = computed(() => this.workspace().skillGroups
    .filter((group) => group.kind === 'accounting')
    .reduce((count, group) => count + group.skills.length, 0))
  protected readonly recentTasks = computed(() => this.workspace().tasks.slice(0, 3))
  protected readonly hasSearchQuery = computed(() => Boolean(this.searchQuery().trim()))

  private readonly searchableMemory = computed<MemorySearchResult[]>(() => [
    ...this.workspace().tasks.map((task) => ({
      id: task.id,
      type: 'Saved task' as const,
      name: task.name,
      description: task.description || 'A memorized sequence of reusable skills.',
      detail: `${task.skills.length} skills`,
      route: '/tasks',
    })),
    ...this.workspace().templates.map((capability) => ({
      id: capability.code,
      type: 'Capability' as const,
      name: capability.name,
      description: capability.description,
      detail: `${capability.skills.length} skills`,
      route: '/tasks',
      fragment: 'templates-title',
    })),
    ...this.workspace().skillGroups.flatMap((group) => group.skills.map((skill) => ({
      id: skill.code,
      type: 'Atomic skill' as const,
      name: skill.name,
      description: skill.description,
      detail: group.name,
      route: '/skills',
      queryParams: { skill: skill.code },
    }))),
  ])

  protected readonly searchResults = computed(() => {
    const terms = this.searchQuery().trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return []
    return this.searchableMemory()
      .filter((item) => {
        const searchable = `${item.name} ${item.description} ${item.detail}`.toLocaleLowerCase()
        return terms.every((term) => searchable.includes(term))
      })
      .sort((left, right) => searchRank(left, terms) - searchRank(right, terms) || left.name.localeCompare(right.name))
      .slice(0, 10)
  })

  protected readonly upcomingRuns = computed<UpcomingRun[]>(() => this.calendar().occurrences.slice(0, 4).map((run) => ({
    ...run,
    dateLabel: new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(run.scheduledFor)),
    recurrenceLabel: run.recurrence === 'once' ? 'One time' : `Repeats ${run.recurrence}`,
  })))

  ngOnInit(): void {
    const from = new Date()
    const to = new Date(from)
    to.setDate(to.getDate() + 90)
    forkJoin({
      workspace: this.api.taskWorkspace(),
      calendar: this.api.calendarWindow(from.toISOString(), to.toISOString()),
    }).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false))
    ).subscribe({
      next: ({ workspace, calendar }) => {
        this.workspace.set(workspace)
        this.calendar.set(calendar)
      },
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }

  protected clearSearch(): void {
    this.searchQuery.set('')
  }
}

function searchRank(item: MemorySearchResult, terms: string[]): number {
  const name = item.name.toLocaleLowerCase()
  const query = terms.join(' ')
  if (name === query) return 0
  if (name.startsWith(query)) return 1
  if (terms.every((term) => name.includes(term))) return 2
  return item.type === 'Saved task' ? 3 : item.type === 'Capability' ? 4 : 5
}
