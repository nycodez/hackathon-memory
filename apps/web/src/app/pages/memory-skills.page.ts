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
        <div><span class="eyebrow">Organizational memory</span><h1>Install proven work. Run it with provenance.</h1><p>Every installation is actor-checked and version-pinned. Every run records its capability, version, inputs, output, and lineage.</p></div>
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
                  <span class="eyebrow">Run installed skill</span>
                  <div class="form-grid">
                    <label><span>Property group</span><input name="propertyGroupName" [(ngModel)]="runInput.propertyGroupName" required /></label>
                    <label><span>Period start</span><input type="date" name="periodStart" [(ngModel)]="runInput.periodStart" required /></label>
                    <label><span>Period end</span><input type="date" name="periodEnd" [(ngModel)]="runInput.periodEnd" required /></label>
                    <label><span>Urgent work orders</span><input type="number" min="0" name="urgentWorkOrderCount" [(ngModel)]="runInput.urgentWorkOrderCount" required /></label>
                    <label><span>Resident follow-ups</span><input type="number" min="0" name="residentFollowUpCount" [(ngModel)]="runInput.residentFollowUpCount" required /></label>
                  </div>
                  <button class="button primary" type="submit" [disabled]="actionBusy()">{{ actionBusy() ? 'Running…' : 'Run skill' }}</button>
                </form>
              }

              @if (runResult()) {
                <section class="run-result" aria-live="polite"><div><span class="eyebrow">Completed run</span><h3>{{ runResult()?.id }}</h3></div><p>{{ runResult()?.output?.['summary'] }}</p><div class="provenance-path">@for (step of runResult()?.provenancePath ?? []; track step) { <span>{{ step }}</span> }</div></section>
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
  protected selectedActorId = 'person-dara-kim'
  protected selectedAssetKey = 'ast-014'
  protected runInput: RunCapabilityInput = {
    propertyGroupName: 'Midtown Residential',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-07',
    urgentWorkOrderCount: 3,
    residentFollowUpCount: 5,
  }

  ngOnInit(): void {
    forkJoin({ actors: this.api.actors(), assets: this.api.assets(this.selectedActorId) }).pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: ({ actors, assets }) => {
        this.actors.set(actors)
        const runnable = assets.filter((asset) => asset.type === 'workflow' || asset.type === 'skill')
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
        this.runnableAssets.set(assets.filter((asset) => asset.type === 'workflow' || asset.type === 'skill'))
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
