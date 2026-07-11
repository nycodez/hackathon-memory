import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { ActivatedRoute, RouterLink } from '@angular/router'
import type { AtomicSkill, SkillKind, TaskWorkspace } from '@hackathon/shared'
import { finalize } from 'rxjs'
import { ApiService } from '../core/api.service'

type SkillFilter = 'all' | SkillKind

interface SkillRecord extends AtomicSkill {
  groupName: string
  capabilityNames: string[]
  taskNames: string[]
}

const emptyWorkspace: TaskWorkspace = {
  skillGroups: [],
  templates: [],
  tasks: [],
}

@Component({
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="page skills-page">
      <header class="page-header compact-header skills-header">
        <div>
          <span class="eyebrow">Reusable primitives</span>
          <h1>Skills</h1>
          <p>Discover the atomic actions available to compose tasks and organizational capabilities.</p>
        </div>
        <a class="button primary" routerLink="/tasks" fragment="task-builder">Build a task</a>
      </header>

      @if (error()) {
        <div class="state-card error" role="alert">{{ error() }}</div>
      }
      @if (loading()) {
        <div class="state-card" role="status">Loading skill catalog…</div>
      } @else {
        <section class="skills-summary" aria-label="Skill catalog summary">
          <article><small>Total skills</small><strong>{{ skillRecords().length }}</strong><span>Available to task builders</span></article>
          <article><small>Office</small><strong>{{ officeCount() }}</strong><span>Communication and operations</span></article>
          <article><small>Accounting</small><strong>{{ accountingCount() }}</strong><span>Bookkeeping primitives</span></article>
          <article><small>In use</small><strong>{{ usedCount() }}</strong><span>Referenced by saved tasks</span></article>
        </section>

        <section class="skills-workspace">
          <div class="skills-catalog-panel">
            <div class="skills-toolbar">
              <label class="skills-search">
                <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"></circle><path d="m16 16 4 4"></path></svg>
                <input #skillSearch type="search" autocomplete="off" placeholder="Search skills by name, input, or group…" [value]="searchQuery()" (input)="searchQuery.set(skillSearch.value)" aria-label="Search skills">
                @if (searchQuery()) { <button type="button" (click)="searchQuery.set('')" aria-label="Clear skill search">×</button> }
              </label>
              <div class="skill-filter-tabs" aria-label="Filter skills by type">
                <button type="button" [class.active]="filter() === 'all'" (click)="filter.set('all')">All <span>{{ skillRecords().length }}</span></button>
                <button type="button" [class.active]="filter() === 'office'" (click)="filter.set('office')">Office <span>{{ officeCount() }}</span></button>
                <button type="button" [class.active]="filter() === 'accounting'" (click)="filter.set('accounting')">Accounting <span>{{ accountingCount() }}</span></button>
              </div>
            </div>

            <div class="skill-results-heading">
              <div><span class="eyebrow">Catalog</span><h2>{{ resultTitle() }}</h2></div>
              <span>{{ filteredSkills().length }} shown</span>
            </div>

            @if (filteredSkills().length) {
              <div class="standalone-skill-grid">
                @for (skill of filteredSkills(); track skill.code) {
                  <button type="button" class="standalone-skill-card" [class.selected]="selectedSkill()?.code === skill.code" (click)="selectSkill(skill.code)">
                    <span class="standalone-skill-kind" [attr.data-kind]="skill.kind">{{ skill.kind }}</span>
                    <strong>{{ skill.name }}</strong>
                    <small>{{ skill.description }}</small>
                    <span class="standalone-skill-group">{{ skill.groupName }}</span>
                    <i>{{ skill.inputs.length }} input{{ skill.inputs.length === 1 ? '' : 's' }} · {{ skill.capabilityNames.length }} capabilit{{ skill.capabilityNames.length === 1 ? 'y' : 'ies' }}</i>
                  </button>
                }
              </div>
            } @else {
              <div class="skills-empty"><strong>No skills found</strong><span>Try a broader name or a different skill type.</span></div>
            }
          </div>

          <aside class="skill-detail-panel" aria-label="Selected skill details">
            @if (selectedSkill(); as skill) {
              <div class="skill-detail-status"><span></span>Defined in catalog</div>
              <span class="eyebrow">{{ skill.groupName }}</span>
              <h2>{{ skill.name }}</h2>
              <p>{{ skill.description }}</p>

              <section class="skill-detail-section">
                <h3>Input contract</h3>
                <div class="skill-input-list">
                  @for (input of skill.inputs; track input) { <span>{{ input }}</span> }
                </div>
              </section>

              <section class="skill-detail-section">
                <h3>Used by capabilities</h3>
                @if (skill.capabilityNames.length) {
                  <ul>
                    @for (capability of skill.capabilityNames; track capability) { <li><span>◇</span>{{ capability }}</li> }
                  </ul>
                } @else {
                  <div class="skill-detail-empty">Not included in a starter capability yet.</div>
                }
              </section>

              <section class="skill-detail-section">
                <h3>Used by memorized tasks</h3>
                @if (skill.taskNames.length) {
                  <ul>
                    @for (task of skill.taskNames; track task) { <li><span>✓</span>{{ task }}</li> }
                  </ul>
                } @else {
                  <div class="skill-detail-empty">No saved task uses this skill yet.</div>
                }
              </section>

              <a class="button secondary" routerLink="/tasks" [queryParams]="{ addSkill: skill.code }" fragment="task-builder">Use in a task <span aria-hidden="true">→</span></a>
            } @else {
              <div class="skill-detail-no-selection"><span>◇</span><strong>Select a skill</strong><small>Its contract and usage will appear here.</small></div>
            }
          </aside>
        </section>
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SkillsPage implements OnInit {
  private readonly api = inject(ApiService)
  private readonly destroyRef = inject(DestroyRef)
  private readonly route = inject(ActivatedRoute)
  protected readonly workspace = signal<TaskWorkspace>(emptyWorkspace)
  protected readonly loading = signal(true)
  protected readonly error = signal('')
  protected readonly searchQuery = signal('')
  protected readonly filter = signal<SkillFilter>('all')
  protected readonly selectedCode = signal('')

  protected readonly skillRecords = computed<SkillRecord[]>(() => this.workspace().skillGroups.flatMap((group) => group.skills.map((skill) => ({
    ...skill,
    groupName: group.name,
    capabilityNames: this.workspace().templates
      .filter((capability) => capability.skills.some((item) => item.code === skill.code))
      .map((capability) => capability.name),
    taskNames: this.workspace().tasks
      .filter((task) => task.skills.some((item) => item.code === skill.code))
      .map((task) => task.name),
  }))))

  protected readonly officeCount = computed(() => this.skillRecords().filter((skill) => skill.kind === 'office').length)
  protected readonly accountingCount = computed(() => this.skillRecords().filter((skill) => skill.kind === 'accounting').length)
  protected readonly usedCount = computed(() => this.skillRecords().filter((skill) => skill.taskNames.length > 0).length)
  protected readonly filteredSkills = computed(() => {
    const terms = this.searchQuery().trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
    return this.skillRecords().filter((skill) => {
      if (this.filter() !== 'all' && skill.kind !== this.filter()) return false
      if (!terms.length) return true
      const searchable = `${skill.name} ${skill.description} ${skill.groupName} ${skill.inputs.join(' ')}`.toLocaleLowerCase()
      return terms.every((term) => searchable.includes(term))
    })
  })
  protected readonly selectedSkill = computed(() => {
    const skills = this.filteredSkills()
    return skills.find((skill) => skill.code === this.selectedCode()) ?? skills[0] ?? null
  })
  protected readonly resultTitle = computed(() => {
    if (this.searchQuery().trim()) return `Results for “${this.searchQuery().trim()}”`
    if (this.filter() === 'accounting') return 'Accounting skills'
    if (this.filter() === 'office') return 'Office skills'
    return 'All skills'
  })

  ngOnInit(): void {
    this.api.taskWorkspace().pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false))
    ).subscribe({
      next: (workspace) => {
        this.workspace.set(workspace)
        const requestedCode = this.route.snapshot.queryParamMap.get('skill')
        const requestedSkillExists = workspace.skillGroups.some((group) => group.skills.some((skill) => skill.code === requestedCode))
        this.selectedCode.set(requestedSkillExists
          ? (requestedCode ?? '')
          : (workspace.skillGroups[0]?.skills[0]?.code ?? ''))
      },
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }

  protected selectSkill(code: string): void {
    this.selectedCode.set(code)
  }
}
