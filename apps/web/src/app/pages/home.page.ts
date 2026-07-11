import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { RouterLink } from '@angular/router'
import type {
  CalendarWindow,
  CapabilitySummary,
  MemoryAnalytics,
  MemoryRecommendation,
  MemorySearchResult,
  TaskOccurrence,
  TaskWorkspace,
} from '@hackathon/shared'
import { Subject, catchError, debounceTime, distinctUntilChanged, finalize, forkJoin, of, switchMap } from 'rxjs'
import { ApiService } from '../core/api.service'

interface MemorySearchView extends MemorySearchResult {
  typeLabel: string
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
          <input #searchInput type="search" autocomplete="off" placeholder="Search weekly AP run, vendor bill, meeting follow-up…" [value]="searchQuery()" (input)="updateSearch(searchInput.value)" aria-label="Search organizational memory">
          @if (searchQuery()) {
            <button type="button" (click)="clearSearch()" aria-label="Clear search">×</button>
          }

          @if (hasSearchQuery()) {
            <div class="memory-search-results" role="listbox" aria-label="Organizational memory search results">
              @if (searching()) {
                <div class="memory-search-empty"><strong>Searching organizational memory…</strong></div>
              } @else if (searchResults().length) {
                @for (result of searchResults(); track result.type + result.id) {
                  <a [routerLink]="result.route" [fragment]="result.fragment" [queryParams]="result.queryParams" role="option">
                    <span class="search-result-kind" [attr.data-kind]="result.typeLabel">{{ result.typeLabel }}</span>
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
            <button type="button" (click)="updateSearch(suggestion)">{{ suggestion }}</button>
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
          <a class="memory-metric" href="#capabilities-title">
            <span class="memory-metric-icon">◇</span>
            <div><small>Capabilities</small><strong>{{ capabilities().length }}</strong><p>Governed reusable knowledge</p></div>
          </a>
          <a class="memory-metric" routerLink="/skills">
            <span class="memory-metric-icon">+</span>
            <div><small>Runnable skills</small><strong>{{ analytics()?.runnableSkillCount ?? 0 }}</strong><p>{{ skillCount() }} defined in the catalog</p></div>
          </a>
          <a class="memory-metric" href="#memory-analytics">
            <span class="memory-metric-icon">↗</span>
            <div><small>Successful runs</small><strong>{{ analytics()?.succeededRunCount ?? 0 }}</strong><p>{{ analytics()?.runCount ?? 0 }} governed runs recorded</p></div>
          </a>
        </section>

        <div class="official-memory-grid">
          <section class="memory-widget recommendation-widget" aria-labelledby="recommendations-title">
            <header class="memory-widget-heading">
              <div><span class="eyebrow">Relevant prior work</span><h2 id="recommendations-title">Recommended memory</h2></div>
              <span class="memory-widget-note">Context-aware</span>
            </header>
            <div class="recommendation-list">
              @for (recommendation of recommendations(); track recommendation.id) {
                <a [routerLink]="['/capabilities', recommendation.capabilityId]">
                  <span>{{ recommendation.type }}</span>
                  <div><strong>{{ recommendation.title }}</strong><p>{{ recommendation.rationale }}</p><small>{{ recommendation.capabilityName }} · {{ recommendation.confidence * 100 }}% confidence</small></div>
                  <i aria-hidden="true">→</i>
                </a>
              }
            </div>
          </section>

          <section id="memory-analytics" class="memory-widget memory-analytics-widget" aria-labelledby="analytics-title">
            <header class="memory-widget-heading">
              <div><span class="eyebrow">Capability intelligence</span><h2 id="analytics-title">Memory health</h2></div>
              <span class="memory-widget-note">Growth · duplication · gaps</span>
            </header>
            @if (analytics(); as insight) {
              <div class="memory-health-grid">
                <div><span>Versions</span><strong>{{ insight.versionCount }}</strong></div>
                <div><span>Unique skills</span><strong>{{ insight.uniqueSkillCount }}</strong></div>
                <div><span>Duplicated</span><strong>{{ insight.duplicatedSkills.length }}</strong></div>
                <div><span>Missing</span><strong>{{ insight.missingCapabilities.length }}</strong></div>
                <div><span>{{ latestGrowth()?.month || 'Growth' }}</span><strong>+{{ latestGrowth()?.capabilities ?? 0 }}</strong></div>
              </div>
              @if (insight.missingCapabilities.length) {
                <div class="memory-gap-list">
                  @for (gap of insight.missingCapabilities; track gap.code) { <div><span>Gap</span><strong>{{ gap.name }}</strong><small>{{ gap.reason }}</small></div> }
                </div>
              }
            }
          </section>
        </div>

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
            <span class="memory-widget-note">Versioned + governed</span>
          </header>
          <div class="home-capability-grid">
            @for (capability of capabilities(); track capability.id) {
              <a [routerLink]="['/capabilities', capability.id]">
                <span>0{{ $index + 1 }}</span>
                <h3>{{ capability.name }}</h3>
                <p>{{ capability.description }}</p>
                <div class="capability-owner-line"><span>{{ capability.owner.name }}</span><i>→</i><strong>{{ capability.steward.name }}</strong></div>
                <small>{{ capability.skillCount }} skills · {{ capability.runCount }} runs <i aria-hidden="true">→</i></small>
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
  private readonly searchTerms = new Subject<string>()
  protected readonly searchSuggestions = ['Weekly AP run', 'Pay a vendor bill', 'Meeting follow-up']
  protected readonly loading = signal(true)
  protected readonly error = signal('')
  protected readonly workspace = signal<TaskWorkspace>(emptyWorkspace)
  protected readonly calendar = signal<CalendarWindow>(emptyCalendar)
  protected readonly capabilities = signal<CapabilitySummary[]>([])
  protected readonly recommendations = signal<MemoryRecommendation[]>([])
  protected readonly analytics = signal<MemoryAnalytics | null>(null)
  protected readonly searchQuery = signal('')
  protected readonly searching = signal(false)
  protected readonly searchResults = signal<MemorySearchView[]>([])
  protected readonly latestGrowth = computed(() => {
    const growth = this.analytics()?.growth ?? []
    return growth[growth.length - 1] ?? null
  })

  protected readonly skillCount = computed(() => this.workspace().skillGroups
    .reduce((count, group) => count + group.skills.length, 0))
  protected readonly recentTasks = computed(() => this.workspace().tasks.slice(0, 3))
  protected readonly hasSearchQuery = computed(() => Boolean(this.searchQuery().trim()))

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
    this.searchTerms.pipe(
      debounceTime(140),
      distinctUntilChanged(),
      switchMap((query) => {
        if (!query.trim()) return of({ query: '', results: [] })
        this.searching.set(true)
        return this.api.memorySearch(query).pipe(
          catchError(() => of({ query, results: [] })),
          finalize(() => this.searching.set(false))
        )
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((response) => this.searchResults.set(response.results.map(toSearchView)))

    const from = new Date()
    const to = new Date(from)
    to.setDate(to.getDate() + 90)
    forkJoin({
      workspace: this.api.taskWorkspace(),
      calendar: this.api.calendarWindow(from.toISOString(), to.toISOString()),
      capabilities: this.api.capabilities(),
      recommendations: this.api.memoryRecommendations('weekly AP'),
      analytics: this.api.memoryAnalytics(),
    }).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false))
    ).subscribe({
      next: ({ workspace, calendar, capabilities, recommendations, analytics }) => {
        this.workspace.set(workspace)
        this.calendar.set(calendar)
        this.capabilities.set(capabilities)
        this.recommendations.set(recommendations)
        this.analytics.set(analytics)
      },
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }

  protected clearSearch(): void {
    this.updateSearch('')
  }

  protected updateSearch(query: string): void {
    this.searchQuery.set(query)
    if (!query.trim()) this.searchResults.set([])
    this.searchTerms.next(query)
  }
}

function toSearchView(result: MemorySearchResult): MemorySearchView {
  const [pathWithQuery, fragment] = result.href.split('#', 2)
  const [route, queryString] = (pathWithQuery ?? result.href).split('?', 2)
  const queryParams = queryString ? Object.fromEntries(new URLSearchParams(queryString)) : undefined
  return {
    ...result,
    typeLabel: searchTypeLabel(result.type),
    route: route || '/',
    fragment,
    queryParams,
  }
}

function searchTypeLabel(type: MemorySearchResult['type']): string {
  const labels: Record<MemorySearchResult['type'], string> = {
    capability: 'Capability',
    task: 'Saved task',
    skill: 'Atomic skill',
    prompt: 'Prompt',
    workflow: 'Workflow',
    agent: 'Agent pattern',
    decision: 'Decision',
    best_practice: 'Best practice',
  }
  return labels[type]
}
