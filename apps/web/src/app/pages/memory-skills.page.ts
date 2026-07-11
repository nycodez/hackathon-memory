import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { FormsModule } from '@angular/forms'
import { RouterLink } from '@angular/router'
import type { CapabilityAsset, CapabilityAssetDetail, CapabilityInstallation, CapabilitySkillRun, DemoActor, RunCapabilityInput } from '@hackathon/shared'
import { finalize, forkJoin } from 'rxjs'
import { MemoryApiService } from '../core/memory-api.service'

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <section class="page memory-page">
      <header class="page-header compact-header">
        <div><span class="eyebrow">Property accounting agent</span><h1>Run the inherited capability on day one.</h1><p>The agent executes five versioned skills, grounds financial facts in the Learning Library, and persists citations, decisions, outcome, and lineage.</p></div>
        <label class="header-selector"><span>Viewing as</span><select name="actor" [(ngModel)]="selectedActorId" (ngModelChange)="actorChanged()">@for (actor of actors(); track actor.id) { <option [value]="actor.id">{{ actor.name }} · {{ actor.role }}</option> }</select></label>
      </header>

      @if (error()) { <div class="state-card error" role="alert">{{ error() }}</div> }
      @if (loading()) {
        <div class="state-card" role="status">Loading runnable capabilities…</div>
      } @else {
        <div class="skills-layout">
          <aside class="skill-catalog">
            <span class="eyebrow">Catalog</span><h2>Runnable capabilities</h2>
            @for (item of runnableAssets(); track item.assetKey) {
              <button type="button" [class.active]="item.assetKey === selectedAssetKey" (click)="selectAsset(item.assetKey)"><strong>{{ item.title }}</strong><span>{{ item.assetKey }} · {{ item.currentVersion }}</span></button>
            }
          </aside>

          @if (detail()) {
            <article class="skill-workbench">
              <header><div class="badge-row"><span class="memory-badge">{{ detail()?.type }}</span><span class="memory-badge classification">{{ detail()?.classification }}</span><span class="memory-badge neutral">{{ detail()?.currentVersion }}</span></div><h2>{{ detail()?.title }}</h2><p>{{ detail()?.summary }}</p></header>
              <div class="skill-status"><div><span>Steward</span><strong>{{ detail()?.currentSteward }}</strong></div><div><span>Version</span><strong>{{ detail()?.currentVersion }}</strong></div><div><span>Installation</span><strong>{{ installation() ? 'Installed' : 'Not installed' }}</strong></div></div>

              @if (!installation()) {
                <button class="button primary" type="button" [disabled]="actionBusy()" (click)="install()">{{ actionBusy() ? 'Checking policy…' : 'Install this version' }}</button>
              } @else {
                <form class="run-form" (ngSubmit)="run()">
                  <span class="eyebrow">Run installed capability</span>
                  <div class="form-grid">
                    <label><span>Property group</span><input name="propertyGroupName" [(ngModel)]="runInput.propertyGroupName" required /></label>
                    <label><span>Run date</span><input type="date" name="runDate" [(ngModel)]="runInput.runDate" required /></label>
                    <label><span>Payment account</span><input name="paymentAccount" [(ngModel)]="runInput.paymentAccount" required /></label>
                  </div>
                  <button class="button primary" type="submit" [disabled]="actionBusy()">{{ actionBusy() ? 'Agent is executing 5 skills…' : 'Run weekly AP capability' }}</button>
                </form>
              }

              @if (runResult()) {
                <section class="run-result" aria-live="polite">
                  <header><div><span class="eyebrow">{{ runResult()?.status }} run</span><h3>{{ runResult()?.id }}</h3></div><span class="run-mode">{{ runResult()?.output?.generationMode }}</span></header>
                  <p>{{ runResult()?.output?.summary }}</p>
                  <div class="run-facts">
                    <div><span>Bills paid</span><strong>{{ runResult()?.output?.billsPaid }}</strong></div>
                    <div><span>Amount paid</span><strong>{{ runResult()?.output?.currency }} {{ runResult()?.output?.amountPaid }}</strong></div>
                    <div><span>Ending cash</span><strong>{{ runResult()?.output?.currency }} {{ runResult()?.output?.endingBalance }}</strong></div>
                    <div><span>Batch</span><strong>{{ runResult()?.output?.paymentBatchId }}</strong></div>
                  </div>
                  <div class="run-section-heading"><div><span class="eyebrow">Agent execution</span><h4>Capability = 5 skills</h4></div><span>{{ runResult()?.skillRuns?.length }} / 5 recorded</span></div>
                  <ol class="skill-run-list">
                    @for (skill of runResult()?.skillRuns ?? []; track skill.skillKey; let index = $index) {
                      <li [attr.data-status]="skill.status"><span>{{ index + 1 }}</span><div><strong>{{ skill.title }}</strong><p>{{ skill.detail }}</p><small>{{ skill.skillKey }} · citations {{ skill.citationLabels.length ? skill.citationLabels : 'none' }}</small></div><b>{{ skill.status }}</b></li>
                    }
                  </ol>
                  <div class="run-two-column">
                    <section><div class="run-section-heading"><div><span class="eyebrow">Grounding</span><h4>Learning Library citations</h4></div><a class="text-link" routerLink="/library">Open Library →</a></div><div class="run-citation-list">@for (citation of runResult()?.citations ?? []; track citation.chunkId) { <blockquote><strong>[{{ citation.label }}] {{ citation.documentName }}</strong><span>{{ citation.excerpt }}</span></blockquote> }</div></section>
                    <section><div class="run-section-heading"><div><span class="eyebrow">Decision log</span><h4>Why the agent acted</h4></div><span>{{ runResult()?.decisionTrace?.length }} events</span></div><div class="run-trace-list">@for (event of runResult()?.decisionTrace ?? []; track event.id) { <div [attr.data-outcome]="event.outcome"><span>{{ event.stage }}</span><strong>{{ event.title }}</strong><small>{{ event.detail }}</small></div> }</div></section>
                  </div>
                  <div class="provenance-path">@for (step of runResult()?.provenancePath ?? []; track step) { <span>{{ step }}</span> }</div>
                </section>
              }

              <a class="text-link" [routerLink]="['/memory/assets', detail()?.assetKey]">Review evidence and provenance →</a>
            </article>
          }
        </div>
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemorySkillsPage implements OnInit {
  private readonly api = inject(MemoryApiService)
  private readonly destroyRef = inject(DestroyRef)

  protected readonly actors = signal<DemoActor[]>([])
  protected readonly runnableAssets = signal<CapabilityAsset[]>([])
  protected readonly detail = signal<CapabilityAssetDetail | null>(null)
  protected readonly installation = signal<CapabilityInstallation | null>(null)
  protected readonly runResult = signal<CapabilitySkillRun | null>(null)
  protected readonly loading = signal(true)
  protected readonly actionBusy = signal(false)
  protected readonly error = signal('')
  protected selectedActorId = 'person-laura-nguyen'
  protected selectedAssetKey = 'ap-weekly-run'
  protected runInput: RunCapabilityInput = {
    propertyGroupName: 'Midtown Residential',
    runDate: '2026-07-12',
    paymentAccount: 'Midtown Operating ••1842',
  }

  ngOnInit(): void {
    forkJoin({ actors: this.api.actors(), assets: this.api.assets(this.selectedActorId) }).pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: ({ actors, assets }) => {
        this.actors.set(actors)
        const runnable = assets.filter((asset) => asset.type === 'workflow')
        this.runnableAssets.set(runnable)
        if (!runnable.some((asset) => asset.assetKey === this.selectedAssetKey) && runnable[0]) this.selectedAssetKey = runnable[0].assetKey
        this.loadDetail()
      },
      error: (error: unknown) => { this.loading.set(false); this.error.set(this.api.message(error)) },
    })
  }

  protected actorChanged(): void {
    this.installation.set(null)
    this.runResult.set(null)
    this.reloadCatalog()
  }

  protected selectAsset(assetKey: string): void {
    this.selectedAssetKey = assetKey
    this.installation.set(null)
    this.runResult.set(null)
    this.loadDetail()
  }

  protected install(): void {
    this.actionBusy.set(true)
    this.error.set('')
    this.api.install(this.selectedAssetKey, this.selectedActorId).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.actionBusy.set(false))
    ).subscribe({
      next: (installation) => this.installation.set(installation),
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }

  protected run(): void {
    this.actionBusy.set(true)
    this.error.set('')
    this.api.run(this.selectedAssetKey, this.runInput, this.selectedActorId).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.actionBusy.set(false))
    ).subscribe({
      next: (result) => this.runResult.set(result),
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }

  private reloadCatalog(): void {
    this.loading.set(true)
    this.api.assets(this.selectedActorId).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false))
    ).subscribe({
      next: (assets) => {
        this.runnableAssets.set(assets.filter((asset) => asset.type === 'workflow'))
        this.loadDetail()
      },
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }

  private loadDetail(): void {
    if (!this.selectedAssetKey) { this.loading.set(false); return }
    this.loading.set(true)
    this.error.set('')
    this.api.asset(this.selectedAssetKey, this.selectedActorId).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false))
    ).subscribe({
      next: (detail) => { this.detail.set(detail); this.installation.set(detail.installation) },
      error: (error: unknown) => { this.detail.set(null); this.error.set(this.api.message(error)) },
    })
  }
}
