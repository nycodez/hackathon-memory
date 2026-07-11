import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { RouterLink } from '@angular/router'
import type {
  CapabilityAsset,
  CapabilityDepartureScenario,
  CapabilitySummary,
  DashboardSummary,
  HealthSummary,
} from '@hackathon/shared'
import { finalize, forkJoin } from 'rxjs'
import { ApiService } from '../core/api.service'
import { MemoryApiService } from '../core/memory-api.service'

@Component({
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="page page-home memory-home">
      <header class="page-header home-dashboard-hero">
        <div>
          <div class="home-status-line">
            <span class="eyebrow">Property management memory</span>
            <span class="live-status" [class.degraded]="health()?.status !== 'ok'"><i></i>{{ health()?.status === 'ok' ? 'Memory online' : 'Needs attention' }}</span>
          </div>
          <h1>Your property teams already know how to do more.</h1>
          <p>Find proven operating practices across managed properties, preserve their evidence and context, and transfer what works without losing authorship or governance.</p>
        </div>
        <div class="home-hero-actions">
          <a class="button primary" routerLink="/memory">Find a capability <span aria-hidden="true">→</span></a>
          <a class="button secondary" routerLink="/library">Add evidence</a>
        </div>
      </header>

      @if (loading()) {
        <div class="state-card" role="status">Loading organizational memory…</div>
      } @else if (error()) {
        <div class="state-card error" role="alert">{{ error() }}</div>
      } @else {
        <div class="home-insight-grid" aria-label="Organizational memory summary">
          <article class="home-insight-card accent-card">
            <span>Capabilities</span>
            <strong>{{ memorySummary()?.assets ?? 0 }}</strong>
            <small>{{ dashboard()?.readyDocuments ?? 0 }} evidence documents indexed</small>
          </article>
          <article class="home-insight-card">
            <span>Runnable skills</span>
            <strong>{{ memorySummary()?.runnableSkills ?? 0 }}</strong>
            <small>{{ memorySummary()?.installations ?? 0 }} version-pinned installs</small>
          </article>
          <article class="home-insight-card">
            <span>Continuity transfers</span>
            <strong>{{ memorySummary()?.stewardshipTransfers ?? 0 }}</strong>
            <small>{{ memorySummary()?.departedPeople ?? 0 }} departed author retained</small>
          </article>
          <article class="home-insight-card system-card" [class.degraded]="health()?.status !== 'ok'">
            <span>Knowledge substrate</span>
            <strong>{{ health()?.status === 'ok' ? 'Healthy' : 'Degraded' }}</strong>
            <small>{{ health()?.database ?? 'unknown' }} database · {{ health()?.vector ?? 'unknown' }} vectors</small>
          </article>
        </div>

        <div class="home-widget-grid">
          <article class="home-widget capability-spotlight">
            <header>
              <div><span class="eyebrow">Capability spotlight</span><h2>{{ spotlight()?.title ?? 'No active capability' }}</h2></div>
              @if (spotlight()) { <span class="memory-badge classification">{{ spotlight()?.classification }}</span> }
            </header>
            @if (spotlight()) {
              <p>{{ spotlight()?.summary }}</p>
              <div class="spotlight-facts">
                <div><span>Version</span><strong>{{ spotlight()?.currentVersion }}</strong></div>
                <div><span>Steward</span><strong>{{ spotlight()?.currentSteward ?? 'Unassigned' }}</strong></div>
                <div><span>Proven outcome</span><strong>{{ spotlightOutcome() }}%</strong></div>
                <div><span>Prior uses</span><strong>{{ spotlight()?.usageCount }}</strong></div>
              </div>
              <footer>
                <a class="button secondary" [routerLink]="['/memory/assets', spotlight()?.assetKey]">Review evidence and provenance</a>
                <a class="text-link" routerLink="/memory/recommendations">Use it for a task →</a>
              </footer>
            }
          </article>

          <article class="home-widget continuity-widget" [class.passed]="departure()?.passed">
            <header><div><span class="eyebrow">Continuity proof</span><h2>Mai left. Property operations kept moving.</h2></div><span class="continuity-state">{{ departure()?.passed ? 'Verified' : 'Review' }}</span></header>
            <p>The original author remains credited while Dara inherits stewardship and a governed path to reuse across managed properties.</p>
            <div class="continuity-path">
              @for (step of departure()?.provenancePath ?? []; track step) {
                <span>{{ step }}</span>
              }
            </div>
            <dl>
              <div><dt>Discoverable</dt><dd [class.yes]="departure()?.discoverable">{{ departure()?.discoverable ? 'Yes' : 'No' }}</dd></div>
              <div><dt>Authorship intact</dt><dd [class.yes]="departure()?.authorshipIntact">{{ departure()?.authorshipIntact ? 'Yes' : 'No' }}</dd></div>
              <div><dt>Steward accepted</dt><dd [class.yes]="departure()?.stewardshipAccepted">{{ departure()?.stewardshipAccepted ? 'Yes' : 'No' }}</dd></div>
            </dl>
          </article>
        </div>

        <section class="home-widget action-widget">
          <div class="section-heading">
            <div><span class="eyebrow">Work with memory</span><h2>Move from evidence to action</h2></div>
            <span>{{ memorySummary()?.runs ?? 0 }} recorded runs</span>
          </div>
          <div class="home-action-grid">
            <a routerLink="/memory"><span>◇</span><div><strong>Capture or search</strong><small>Save a capability or find prior work with governed citations.</small></div><i>→</i></a>
            <a routerLink="/memory/recommendations"><span>◎</span><div><strong>Recommend for a task</strong><small>Describe a property-operations task and surface relevant organizational practice.</small></div><i>→</i></a>
            <a routerLink="/memory/skills"><span>▦</span><div><strong>Install and run</strong><small>Pin an approved version and keep the execution provenance.</small></div><i>→</i></a>
            <a routerLink="/library"><span>▱</span><div><strong>Manage evidence</strong><small>Upload the source material that grounds capabilities and answers.</small></div><i>→</i></a>
          </div>
        </section>

        <div class="workflow-card memory-pipeline-card">
          <div class="section-heading">
            <div><span class="eyebrow">Memory lifecycle</span><h2>Evidence becomes reusable capability</h2></div>
            <a routerLink="/query">Query the evidence</a>
          </div>
          <ol class="pipeline-list">
            <li><span>01</span><div><strong>Capture evidence</strong><small>Learning Library preserves the original source and checksum.</small></div></li>
            <li><span>02</span><div><strong>Index meaning</strong><small>Extraction, chunks, and vectors make the evidence discoverable.</small></div></li>
            <li><span>03</span><div><strong>Add context</strong><small>Authorship, decisions, outcomes, versions, and stewardship explain why it worked.</small></div></li>
            <li><span>04</span><div><strong>Reuse safely</strong><small>Governed recommendations, pinned installs, and auditable runs compound the knowledge.</small></div></li>
          </ol>
        </div>
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage implements OnInit {
  private readonly api = inject(ApiService)
  private readonly memoryApi = inject(MemoryApiService)
  private readonly destroyRef = inject(DestroyRef)
  private readonly demoActorId = 'person-dara-kim'

  protected readonly loading = signal(true)
  protected readonly error = signal('')
  protected readonly dashboard = signal<DashboardSummary | null>(null)
  protected readonly health = signal<HealthSummary | null>(null)
  protected readonly memorySummary = signal<CapabilitySummary | null>(null)
  protected readonly departure = signal<CapabilityDepartureScenario | null>(null)
  protected readonly spotlight = signal<CapabilityAsset | null>(null)
  protected readonly spotlightOutcome = signal(0)

  ngOnInit(): void {
    forkJoin({
      dashboard: this.api.dashboard(),
      health: this.api.health(),
      memorySummary: this.memoryApi.summary(this.demoActorId),
      departure: this.memoryApi.departureScenario(this.demoActorId),
      assets: this.memoryApi.assets(this.demoActorId),
    }).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false))
    ).subscribe({
      next: ({ dashboard, health, memorySummary, departure, assets }) => {
        const spotlight = assets.find((asset) => asset.assetKey === 'ast-014') ?? assets[0] ?? null
        this.dashboard.set(dashboard)
        this.health.set(health)
        this.memorySummary.set(memorySummary)
        this.departure.set(departure)
        this.spotlight.set(spotlight)
        this.spotlightOutcome.set(spotlight ? Math.round(spotlight.outcomeScore * 100) : 0)
      },
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }
}
