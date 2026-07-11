import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { ActivatedRoute, RouterLink } from '@angular/router'
import type {
  CapabilityDetail,
  CapabilityRun,
  CapabilityRunStep,
  MemoryActor,
} from '@hackathon/shared'
import { finalize, forkJoin } from 'rxjs'
import { ActorContextService } from '../core/actor-context.service'
import { ApiService } from '../core/api.service'

interface RunStepView extends CapabilityRunStep {
  outputLines: Array<{ label: string; value: string }>
}

interface RunView extends CapabilityRun {
  dateLabel: string
  outputLines: Array<{ label: string; value: string }>
  stepViews: RunStepView[]
}

@Component({
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="page capability-page">
      <nav class="capability-breadcrumb" aria-label="Breadcrumb"><a routerLink="/">Dashboard</a><span>→</span><strong>Capability</strong></nav>

      @if (error()) { <div class="state-card error" role="alert">{{ error() }}</div> }
      @if (notice()) { <div class="calendar-notice" role="status">{{ notice() }}</div> }
      @if (loading()) {
        <div class="state-card" role="status">Loading capability memory…</div>
      } @else if (capability(); as item) {
        <header class="capability-hero">
          <div class="capability-identity">
            <div class="capability-label-row">
              <span class="eyebrow">Runnable organizational memory</span>
              <span class="capability-version">Version {{ item.activeVersion }}</span>
            </div>
            <h1>{{ item.name }}</h1>
            <p>{{ item.description }}</p>
            <div class="capability-people">
              <div>
                <span>Original owner</span>
                <strong>{{ item.owner.name }}</strong>
                <small [class.departed]="item.owner.status === 'departed'">{{ item.owner.status }} · {{ item.owner.title }}</small>
              </div>
              <span class="continuity-arrow">→</span>
              <div>
                <span>Current steward</span>
                <strong>{{ item.steward.name }}</strong>
                <small>{{ item.steward.status }} · {{ item.steward.title }}</small>
              </div>
            </div>
          </div>

          <aside class="capability-run-control">
            <span class="eyebrow">Run as</span>
            <label>
              <span>Demo actor</span>
              <select #actorSelect [value]="actorContext.selectedActorId()" (change)="changeActor(actorSelect.value)">
                @for (actor of actors(); track actor.id) {
                  <option [value]="actor.id" [selected]="actor.id === actorContext.selectedActorId()">{{ actor.name }} · {{ actor.status }}</option>
                }
              </select>
            </label>
            <label>
              <span>Accounting date</span>
              <input #dateInput type="date" [value]="asOfDate()" (input)="asOfDate.set(dateInput.value)">
            </label>
            <div class="permission-status" [class.allowed]="item.canRun">
              <span></span>{{ item.canRun ? 'Authorized to run' : permissionMessage() }}
            </div>
            <button class="button primary" type="button" [disabled]="running() || !item.canRun" (click)="runCapability()">
              {{ running() ? 'Executing skills…' : 'Run capability' }}
            </button>
            <button class="button secondary" type="button" [disabled]="installing()" (click)="installCapability()">
              {{ installing() ? 'Installing…' : 'Install as task' }}
            </button>
          </aside>
        </header>

        <section class="continuity-proof" aria-label="Continuity proof">
          <span>Proof</span>
          <strong>The capability survived {{ item.owner.name }}’s departure.</strong>
          <p>{{ item.steward.name }} can inspect its provenance, execute the same governed version, and preserve a new outcome.</p>
        </section>

        <div class="capability-layout">
          <div class="capability-main-column">
            <section class="capability-card" aria-labelledby="steps-title">
              <header class="capability-card-heading">
                <div><span class="eyebrow">Deterministic order</span><h2 id="steps-title">Capability skills</h2></div>
                <span>{{ item.version.steps.length }} steps</span>
              </header>
              <ol class="capability-step-list">
                @for (step of item.version.steps; track step.id) {
                  <li>
                    <span class="capability-step-number">0{{ step.position + 1 }}</span>
                    <div><strong>{{ step.name }}</strong><p>{{ step.description }}</p></div>
                    <span class="skill-readiness" [class.runnable]="step.runnable">{{ step.runnable ? 'Runnable' : 'Defined' }}</span>
                  </li>
                }
              </ol>
            </section>

            @if (activeRunView(); as run) {
              <section #runOutcome class="capability-card run-outcome-card" aria-labelledby="run-outcome-title">
                <header class="capability-card-heading">
                  <div><span class="eyebrow">Persisted outcome</span><h2 id="run-outcome-title">{{ run.status === 'succeeded' ? 'Capability completed' : 'Capability run' }}</h2></div>
                  <span class="run-status" [attr.data-status]="run.status">{{ run.status }}</span>
                </header>
                <div class="run-summary">
                  <strong>{{ run.summary || 'Run recorded.' }}</strong>
                  <small>{{ run.actor.name }} · {{ run.dateLabel }} · Version {{ run.version }}</small>
                </div>
                @if (run.outputLines.length) {
                  <div class="run-output-grid">
                    @for (line of run.outputLines; track line.label) { <div><span>{{ line.label }}</span><strong>{{ line.value }}</strong></div> }
                  </div>
                }
                <ol class="run-step-timeline">
                  @for (step of run.stepViews; track step.id) {
                    <li [attr.data-status]="step.status">
                      <span class="run-step-marker">{{ step.status === 'succeeded' ? '✓' : step.position + 1 }}</span>
                      <div class="run-step-content">
                        <div><strong>{{ step.name }}</strong><span>{{ step.status }}</span></div>
                        @if (step.outputLines.length) {
                          <dl>
                            @for (line of step.outputLines; track line.label) { <div><dt>{{ line.label }}</dt><dd>{{ line.value }}</dd></div> }
                          </dl>
                        }
                        @for (decision of step.decisions; track decision.code) {
                          <div class="decision-card"><span>{{ decision.outcome }}</span><strong>{{ decision.code }}</strong><p>{{ decision.explanation }}</p></div>
                        }
                        @if (step.citations.length) {
                          <div class="run-citations">
                            @for (citation of step.citations; track citation.label) {
                              <article><span>{{ citation.label }}</span><strong>{{ citation.sourceName }}</strong><p>{{ citation.excerpt }}</p></article>
                            }
                          </div>
                        }
                      </div>
                    </li>
                  }
                </ol>
              </section>
            }
          </div>

          <aside class="capability-side-column">
            <section class="capability-card provenance-card" aria-labelledby="provenance-title">
              <header class="capability-card-heading"><div><span class="eyebrow">Evidence trail</span><h2 id="provenance-title">Provenance</h2></div></header>
              <div class="provenance-list">
                @for (source of item.provenance; track source.id) {
                  <article>
                    <span>{{ source.sourceType }}</span>
                    <strong>{{ source.sourceName }}</strong>
                    <p>{{ source.excerpt }}</p>
                    <small>Captured {{ source.capturedAt.slice(0, 10) }}@if (source.capturedBy) { · {{ source.capturedBy.name }} }</small>
                  </article>
                }
              </div>
            </section>

            <section class="capability-card history-card" aria-labelledby="history-title">
              <header class="capability-card-heading"><div><span class="eyebrow">Audit trail</span><h2 id="history-title">Run history</h2></div><span>{{ runViews().length }}</span></header>
              @if (runViews().length) {
                <div class="capability-run-history">
                  @for (run of runViews(); track run.id) {
                    <button type="button" [class.active]="activeRun()?.id === run.id" (click)="activeRun.set(run)">
                      <span class="run-status" [attr.data-status]="run.status">{{ run.status }}</span>
                      <strong>{{ run.actor.name }}</strong>
                      <small>{{ run.dateLabel }} · v{{ run.version }}</small>
                    </button>
                  }
                </div>
              } @else {
                <div class="skill-detail-empty">No recorded runs yet.</div>
              }
            </section>
          </aside>
        </div>
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CapabilityPage implements OnInit {
  @ViewChild('runOutcome') private runOutcome?: ElementRef<HTMLElement>
  private readonly api = inject(ApiService)
  private readonly route = inject(ActivatedRoute)
  private readonly destroyRef = inject(DestroyRef)
  protected readonly actorContext = inject(ActorContextService)
  protected readonly capabilityId = this.route.snapshot.paramMap.get('capabilityId') ?? ''
  protected readonly actors = signal<MemoryActor[]>([])
  protected readonly capability = signal<CapabilityDetail | null>(null)
  protected readonly runs = signal<CapabilityRun[]>([])
  protected readonly activeRun = signal<CapabilityRun | null>(null)
  protected readonly loading = signal(true)
  protected readonly running = signal(false)
  protected readonly installing = signal(false)
  protected readonly error = signal('')
  protected readonly notice = signal('')
  protected readonly asOfDate = signal(todayDateInput())

  protected readonly permissionMessage = computed(() => {
    const actor = this.actors().find((item) => item.id === this.actorContext.selectedActorId())
    if (actor?.status === 'departed') return 'Departed actors cannot run'
    return 'View access only'
  })
  protected readonly runViews = computed<RunView[]>(() => this.runs().map(toRunView))
  protected readonly activeRunView = computed<RunView | null>(() => {
    const run = this.activeRun()
    return run ? toRunView(run) : null
  })

  ngOnInit(): void {
    this.api.demoActors().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (actors) => {
        this.actors.set(actors)
        const selectedExists = actors.some((actor) => actor.id === this.actorContext.selectedActorId())
        if (!selectedExists) this.actorContext.select(
          actors.find((actor) => actor.status === 'active' && actor.title.toLocaleLowerCase().includes('successor'))?.id
          ?? actors.find((actor) => actor.status === 'active')?.id
          ?? actors[0]?.id
          ?? ''
        )
        this.loadCapability()
      },
      error: (error: unknown) => {
        this.loading.set(false)
        this.error.set(this.api.message(error))
      },
    })
  }

  protected changeActor(actorId: string): void {
    this.actorContext.select(actorId)
    this.activeRun.set(null)
    this.loadCapability()
  }

  protected runCapability(): void {
    const capability = this.capability()
    const actorId = this.actorContext.selectedActorId()
    if (!capability || !actorId || !capability.canRun || this.running()) return
    this.running.set(true)
    this.error.set('')
    this.notice.set('')
    this.api.runCapability(capability.id, {
      idempotencyKey: `${capability.id}:${actorId}:${this.asOfDate()}`,
      asOfDate: this.asOfDate(),
    }).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.running.set(false))
    ).subscribe({
      next: (run) => {
        this.activeRun.set(run)
        this.runs.update((runs) => [run, ...runs.filter((item) => item.id !== run.id)])
        this.notice.set('Capability run completed and was added to the audit trail.')
        this.refreshDetail()
        setTimeout(() => this.runOutcome?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' }))
      },
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }

  protected installCapability(): void {
    const capability = this.capability()
    if (!capability || this.installing()) return
    this.installing.set(true)
    this.error.set('')
    this.notice.set('')
    this.api.installCapability(capability.id).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.installing.set(false))
    ).subscribe({
      next: (installation) => this.notice.set(`${installation.task.name} was installed in Tasks from version ${capability.activeVersion}.`),
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }

  private loadCapability(): void {
    if (!this.capabilityId) {
      this.loading.set(false)
      this.error.set('A valid capability is required.')
      return
    }
    this.loading.set(true)
    this.error.set('')
    forkJoin({
      capability: this.api.capability(this.capabilityId),
      runs: this.api.capabilityRuns(this.capabilityId),
    }).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false))
    ).subscribe({
      next: ({ capability, runs }) => {
        this.capability.set(capability)
        this.runs.set(runs)
        if (!this.activeRun() && runs[0]) this.activeRun.set(runs[0])
      },
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }

  private refreshDetail(): void {
    this.api.capability(this.capabilityId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (capability) => this.capability.set(capability),
    })
  }
}

function toRunView(run: CapabilityRun): RunView {
  return {
    ...run,
    dateLabel: new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(run.startedAt)),
    outputLines: objectLines(run.output),
    stepViews: run.steps.map((step) => ({ ...step, citations: step.citations.slice(0, 2), outputLines: objectLines(step.output) })),
  }
}

function objectLines(value: Record<string, unknown>): Array<{ label: string; value: string }> {
  return Object.entries(value).slice(0, 8).map(([key, entry]) => ({
    label: formatOutputLabel(key),
    value: isCentAmount(key) && typeof entry === 'number' ? formatCurrency(entry) : formatValue(entry),
  }))
}

function formatOutputLabel(key: string): string {
  const label = key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/ cents$/i, '')

  return label.replace(/\b\w/g, (letter) => letter.toLocaleUpperCase())
}

function isCentAmount(key: string): boolean {
  return /(?:Cents|_cents)$/i.test(key)
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => formatValue(item)).join(', ')
  if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}: ${formatValue(item)}`).join(' · ')
  if (typeof value === 'number') return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)
  return String(value ?? '—')
}

function todayDateInput(): string {
  const value = new Date()
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
