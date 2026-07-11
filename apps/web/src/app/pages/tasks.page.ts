import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { ActivatedRoute, RouterLink } from '@angular/router'
import type {
  AtomicSkill,
  CalendarWindow,
  MemorizedTask,
  SkillKind,
  TaskSchedule,
  TaskTemplate,
  TaskWorkspace,
} from '@hackathon/shared'
import { finalize, forkJoin } from 'rxjs'
import { ApiService } from '../core/api.service'

type SkillFilter = 'all' | SkillKind

interface PickerSkill extends AtomicSkill {
  groupName: string
  selected: boolean
}

interface TaskView extends MemorizedTask {
  schedule: TaskSchedule | null
  scheduleLabel: string
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
    <section class="page tasks-page">
      <header class="page-header compact-header">
        <div>
          <span class="eyebrow">Organizational memory</span>
          <h1>Tasks</h1>
          <p>Compose, manage, and schedule repeatable work built from reusable skills.</p>
        </div>
        <a class="button primary" href="#task-builder">Create a task</a>
      </header>

      @if (error()) { <div class="state-card error" role="alert">{{ error() }}</div> }
      @if (notice()) { <div class="calendar-notice" role="status">{{ notice() }}</div> }
      @if (loading()) {
        <div class="state-card" role="status">Loading task memory…</div>
      } @else {
        <section class="task-section" aria-labelledby="memorized-tasks-title">
          <div class="section-heading task-section-heading">
            <div>
              <span class="eyebrow">Saved to this workspace</span>
              <h2 id="memorized-tasks-title">Memorized tasks</h2>
              <p>Manage each task’s ordered sequence and planned schedule.</p>
            </div>
            <span class="task-count">{{ taskViews().length }} task{{ taskViews().length === 1 ? '' : 's' }}</span>
          </div>

          @if (!taskViews().length) {
            <div class="task-empty">
              <span>◇</span>
              <div><strong>No tasks memorized yet</strong><small>Start from a capability or compose a sequence with the compact skill picker.</small></div>
            </div>
          } @else {
            <div class="memorized-task-grid">
              @for (task of taskViews(); track task.id) {
                <article class="memorized-task-card">
                  <div class="memorized-task-head">
                    <div>
                      <span>{{ task.skills.length }} skills</span>
                      <h3>{{ task.name }}</h3>
                    </div>
                    <span class="task-schedule-badge" [class.unscheduled]="!task.schedule">{{ task.scheduleLabel }}</span>
                  </div>
                  @if (task.description) { <p>{{ task.description }}</p> }
                  <ol class="task-step-list">
                    @for (skill of task.skills; track skill.code) {
                      <li><span>{{ $index + 1 }}</span><div><strong>{{ skill.name }}</strong><small>{{ skill.description }}</small></div></li>
                    }
                  </ol>
                  <div class="task-card-actions">
                    <button type="button" (click)="editTask(task)">Edit</button>
                    <button type="button" [disabled]="duplicatingId() === task.id" (click)="duplicateTask(task)">{{ duplicatingId() === task.id ? 'Duplicating…' : 'Duplicate' }}</button>
                    <a [routerLink]="['/calendar']" [queryParams]="{ task: task.id }">{{ task.schedule ? 'Reschedule' : 'Schedule' }}</a>
                    <button type="button" class="danger" [disabled]="deletingId() === task.id" (click)="deleteTask(task.id)">{{ deletingId() === task.id ? 'Deleting…' : 'Delete' }}</button>
                  </div>
                </article>
              }
            </div>
          }
        </section>

        <section class="task-section" aria-labelledby="templates-title">
          <div class="section-heading task-section-heading">
            <div><span class="eyebrow">Reusable workflows</span><h2 id="templates-title">Starter capabilities</h2><p>Adapt a proven skill sequence into a named task for this workspace.</p></div>
          </div>
          <div class="task-template-grid">
            @for (template of workspace().templates; track template.code) {
              <article class="task-template-card">
                <span class="task-template-number">0{{ $index + 1 }}</span>
                <h3>{{ template.name }}</h3>
                <p>{{ template.description }}</p>
                <div class="template-skill-chain">
                  @for (skill of template.skills; track skill.code) {
                    <span>{{ skill.name }}</span>@if (!$last) { <i>→</i> }
                  }
                </div>
                <button class="button secondary" type="button" (click)="useTemplate(template)">Use capability</button>
              </article>
            }
          </div>
        </section>

        <section #builder id="task-builder" class="task-builder" aria-labelledby="task-builder-title">
          <div class="task-builder-intro task-builder-title-row">
            <div>
              <span class="eyebrow">{{ editingId() ? 'Update a task' : 'Compose a task' }}</span>
              <h2 id="task-builder-title">{{ editingId() ? 'Edit the remembered sequence' : 'Build the remembered sequence' }}</h2>
              <p>Arrange atomic skills in the exact order a person or agent should perform them.</p>
            </div>
            @if (editingId()) { <button class="button secondary" type="button" (click)="resetBuilder()">Cancel editing</button> }
          </div>

          <form class="task-builder-form" (submit)="saveTask($event)">
            <div class="task-details-fields">
              <label><span>Task name</span><input #nameInput type="text" maxlength="100" autocomplete="off" placeholder="e.g. Friday vendor payment run" [value]="taskName()" (input)="taskName.set(nameInput.value)"></label>
              <label><span>Purpose</span><textarea #descriptionInput rows="3" maxlength="500" placeholder="What outcome should this task produce?" [value]="taskDescription()" (input)="taskDescription.set(descriptionInput.value)"></textarea></label>
            </div>

            <div class="selected-skill-panel">
              <div class="selected-skill-heading"><strong>Task sequence</strong><span>{{ selectedSkills().length }} selected</span></div>
              @if (!selectedSkills().length) {
                <div class="selected-skill-empty">Add skills with the compact picker below.</div>
              } @else {
                <ol class="selected-skill-list">
                  @for (skill of selectedSkills(); track skill.code) {
                    <li>
                      <span class="step-number">{{ $index + 1 }}</span>
                      <div><strong>{{ skill.name }}</strong><small>Needs: @for (input of skill.inputs; track input) { {{ input }}@if (!$last) { · } }</small></div>
                      <div class="step-actions">
                        <button type="button" [disabled]="$first" (click)="moveSkill($index, -1)" [attr.aria-label]="'Move ' + skill.name + ' earlier'">↑</button>
                        <button type="button" [disabled]="$last" (click)="moveSkill($index, 1)" [attr.aria-label]="'Move ' + skill.name + ' later'">↓</button>
                        <button type="button" (click)="removeSkill(skill.code)" [attr.aria-label]="'Remove ' + skill.name">×</button>
                      </div>
                    </li>
                  }
                </ol>
              }
              <button class="button primary memorize-button" type="submit" [disabled]="!canSave() || saving()">
                @if (saving()) { {{ editingId() ? 'Saving changes…' : 'Memorizing…' }} } @else { {{ editingId() ? 'Save changes' : 'Memorize task' }} }
              </button>
            </div>
          </form>

          <section class="compact-skill-picker" aria-labelledby="compact-skill-picker-title">
            <div class="compact-picker-heading">
              <div><span class="eyebrow">Add to sequence</span><h3 id="compact-skill-picker-title">Compact skill picker</h3></div>
              <a routerLink="/skills">Browse full Skills catalog →</a>
            </div>
            <div class="compact-picker-toolbar">
              <label>
                <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"></circle><path d="m16 16 4 4"></path></svg>
                <input #pickerSearch type="search" autocomplete="off" placeholder="Find a skill by name or input…" [value]="skillSearch()" (input)="skillSearch.set(pickerSearch.value)" aria-label="Find a skill to add">
              </label>
              <div class="compact-picker-filters" aria-label="Filter task skill picker">
                <button type="button" [class.active]="skillFilter() === 'all'" (click)="skillFilter.set('all')">All</button>
                <button type="button" [class.active]="skillFilter() === 'office'" (click)="skillFilter.set('office')">Office</button>
                <button type="button" [class.active]="skillFilter() === 'accounting'" (click)="skillFilter.set('accounting')">Accounting</button>
              </div>
            </div>
            @if (pickerSkills().length) {
              <div class="compact-picker-grid">
                @for (skill of pickerSkills(); track skill.code) {
                  <button type="button" [class.selected]="skill.selected" (click)="toggleSkill(skill.code)">
                    <span>{{ skill.selected ? '✓' : '+' }}</span>
                    <div><strong>{{ skill.name }}</strong><small>{{ skill.groupName }} · {{ skill.kind }}</small></div>
                  </button>
                }
              </div>
              @if (!skillSearch().trim() && pickerMatchCount() > pickerSkills().length) {
                <div class="compact-picker-note">Showing {{ pickerSkills().length }} of {{ pickerMatchCount() }} skills. Search by name to find any skill.</div>
              }
            } @else {
              <div class="compact-picker-empty">No skills match this search.</div>
            }
          </section>
        </section>
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TasksPage implements OnInit {
  @ViewChild('builder') private builder?: ElementRef<HTMLElement>
  private readonly api = inject(ApiService)
  private readonly destroyRef = inject(DestroyRef)
  private readonly route = inject(ActivatedRoute)
  protected readonly workspace = signal<TaskWorkspace>(emptyWorkspace)
  protected readonly calendar = signal<CalendarWindow>(emptyCalendar)
  protected readonly loading = signal(true)
  protected readonly saving = signal(false)
  protected readonly deletingId = signal<string | null>(null)
  protected readonly duplicatingId = signal<string | null>(null)
  protected readonly editingId = signal<string | null>(null)
  protected readonly error = signal('')
  protected readonly notice = signal('')
  protected readonly taskName = signal('')
  protected readonly taskDescription = signal('')
  protected readonly selectedCodes = signal<string[]>([])
  protected readonly skillSearch = signal('')
  protected readonly skillFilter = signal<SkillFilter>('all')

  private readonly skillsByCode = computed(() => new Map(
    this.workspace().skillGroups.flatMap((group) => group.skills).map((skill) => [skill.code, skill])
  ))
  protected readonly selectedSkills = computed(() => this.selectedCodes()
    .map((code) => this.skillsByCode().get(code))
    .filter((skill): skill is AtomicSkill => Boolean(skill)))
  private readonly pickerMatches = computed<PickerSkill[]>(() => {
    const terms = this.skillSearch().trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
    const selected = new Set(this.selectedCodes())
    return this.workspace().skillGroups.flatMap((group) => group.skills
      .filter((skill) => this.skillFilter() === 'all' || skill.kind === this.skillFilter())
      .filter((skill) => {
        if (!terms.length) return true
        const searchable = `${skill.name} ${skill.description} ${skill.inputs.join(' ')} ${group.name}`.toLocaleLowerCase()
        return terms.every((term) => searchable.includes(term))
      })
      .map((skill) => ({ ...skill, groupName: group.name, selected: selected.has(skill.code) })))
  })
  protected readonly pickerMatchCount = computed(() => this.pickerMatches().length)
  protected readonly pickerSkills = computed(() => this.pickerMatches().slice(0, this.skillSearch().trim() ? 30 : 12))
  protected readonly canSave = computed(() => Boolean(this.taskName().trim() && this.selectedCodes().length))
  protected readonly taskViews = computed<TaskView[]>(() => {
    const schedules = new Map(this.calendar().schedules.map((schedule) => [schedule.taskId, schedule]))
    return this.workspace().tasks.map((task) => {
      const schedule = schedules.get(task.id) ?? null
      return { ...task, schedule, scheduleLabel: schedule ? formatSchedule(schedule) : 'Not scheduled' }
    })
  })

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
        const requestedSkill = this.route.snapshot.queryParamMap.get('addSkill')
        const skillExists = workspace.skillGroups.some((group) => group.skills.some((skill) => skill.code === requestedSkill))
        if (requestedSkill && skillExists) {
          this.selectedCodes.set([requestedSkill])
          setTimeout(() => this.scrollToBuilder())
        }
      },
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }

  protected useTemplate(template: TaskTemplate): void {
    this.editingId.set(null)
    this.taskName.set(template.name)
    this.taskDescription.set(template.description)
    this.selectedCodes.set(template.skills.map((skill) => skill.code))
    this.scrollToBuilder()
  }

  protected editTask(task: MemorizedTask): void {
    this.editingId.set(task.id)
    this.taskName.set(task.name)
    this.taskDescription.set(task.description)
    this.selectedCodes.set(task.skills.map((skill) => skill.code))
    this.error.set('')
    this.notice.set('')
    this.scrollToBuilder()
  }

  protected duplicateTask(task: MemorizedTask): void {
    if (this.duplicatingId()) return
    this.duplicatingId.set(task.id)
    this.error.set('')
    this.notice.set('')
    const name = nextCopyName(task.name, this.workspace().tasks.map((item) => item.name))
    this.api.createTask(name, task.description, task.skills.map((skill) => skill.code)).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.duplicatingId.set(null))
    ).subscribe({
      next: (copy) => {
        this.workspace.update((workspace) => ({ ...workspace, tasks: [copy, ...workspace.tasks] }))
        this.notice.set(`${copy.name} was created.`)
      },
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }

  protected toggleSkill(code: string): void {
    this.selectedCodes.update((codes) => codes.includes(code)
      ? codes.filter((item) => item !== code)
      : [...codes, code])
  }

  protected removeSkill(code: string): void {
    this.selectedCodes.update((codes) => codes.filter((item) => item !== code))
  }

  protected moveSkill(index: number, direction: -1 | 1): void {
    this.selectedCodes.update((codes) => {
      const target = index + direction
      if (target < 0 || target >= codes.length) return codes
      const reordered = [...codes]
      const current = reordered[index]
      const adjacent = reordered[target]
      if (!current || !adjacent) return codes
      reordered[index] = adjacent
      reordered[target] = current
      return reordered
    })
  }

  protected saveTask(event: Event): void {
    event.preventDefault()
    const name = this.taskName().trim()
    if (!name || !this.selectedCodes().length || this.saving()) return
    this.saving.set(true)
    this.error.set('')
    this.notice.set('')
    const editingId = this.editingId()
    const request = editingId
      ? this.api.updateTask(editingId, name, this.taskDescription().trim(), this.selectedCodes())
      : this.api.createTask(name, this.taskDescription().trim(), this.selectedCodes())
    request.pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.saving.set(false))
    ).subscribe({
      next: (task) => {
        this.workspace.update((workspace) => ({
          ...workspace,
          tasks: [task, ...workspace.tasks.filter((item) => item.id !== task.id)],
        }))
        this.notice.set(editingId ? `${task.name} was updated.` : `${task.name} was memorized.`)
        this.resetBuilder()
      },
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }

  protected deleteTask(id: string): void {
    if (this.deletingId()) return
    this.deletingId.set(id)
    this.error.set('')
    this.notice.set('')
    this.api.deleteTask(id).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.deletingId.set(null))
    ).subscribe({
      next: () => {
        this.workspace.update((workspace) => ({
          ...workspace,
          tasks: workspace.tasks.filter((task) => task.id !== id),
        }))
        this.calendar.update((calendar) => ({
          ...calendar,
          schedules: calendar.schedules.filter((schedule) => schedule.taskId !== id),
          occurrences: calendar.occurrences.filter((occurrence) => occurrence.taskId !== id),
        }))
        if (this.editingId() === id) this.resetBuilder()
      },
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }

  protected resetBuilder(): void {
    this.editingId.set(null)
    this.taskName.set('')
    this.taskDescription.set('')
    this.selectedCodes.set([])
    this.skillSearch.set('')
    this.skillFilter.set('all')
  }

  private scrollToBuilder(): void {
    setTimeout(() => this.builder?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
}

function nextCopyName(name: string, existingNames: string[]): string {
  const existing = new Set(existingNames.map((item) => item.toLocaleLowerCase()))
  let candidate = `${name} copy`
  let suffix = 2
  while (existing.has(candidate.toLocaleLowerCase())) {
    candidate = `${name} copy ${suffix}`
    suffix += 1
  }
  return candidate
}

function formatSchedule(schedule: TaskSchedule): string {
  const date = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(schedule.scheduledFor))
  return schedule.recurrence === 'once' ? date : `${capitalize(schedule.recurrence)} · ${date}`
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
