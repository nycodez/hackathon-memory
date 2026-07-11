import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { FormsModule } from '@angular/forms'
import { ActivatedRoute, RouterLink } from '@angular/router'
import type { CapabilityAssetDetail, DemoActor } from '@hackathon/shared'
import { finalize, forkJoin } from 'rxjs'
import { MemoryApiService } from '../core/memory-api.service'

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <section class="page memory-page">
      <a class="back-link" routerLink="/memory">← Capabilities</a>

      <div class="actor-detail-selector">
        <label><span>Viewing as</span><select name="actor" [(ngModel)]="selectedActorId" (ngModelChange)="loadAsset()">@for (actor of actors(); track actor.id) { <option [value]="actor.id">{{ actor.name }} · {{ actor.role }}</option> }</select></label>
      </div>

      @if (loading()) {
        <div class="state-card" role="status">Loading governed capability…</div>
      } @else if (error()) {
        <div class="state-card error" role="alert">{{ error() }}</div>
      } @else if (asset()) {
        <header class="capability-detail-header">
          <div>
            <div class="badge-row"><span class="memory-badge">{{ asset()?.type }}</span><span class="memory-badge classification">{{ asset()?.classification }}</span><span class="memory-badge neutral">{{ asset()?.currentVersion }}</span></div>
            <h1>{{ asset()?.title }} <small>· {{ asset()?.assetKey }}</small></h1>
            <p>{{ asset()?.summary }}</p>
          </div>
          <a class="button primary" routerLink="/memory/skills">Install or run</a>
        </header>

        @if (asset()?.assetKey === 'ap-weekly-run') {
          <article class="continuity-banner"><span aria-hidden="true">◇</span><div><strong>Fictional continuity scenario: Magdalene leaves; the AP capability remains operational.</strong><p>Authorship stays with Magdalene Choong. Laura Nguyen accepted stewardship and can execute all five skills on day one.</p></div></article>
        }

        <div class="capability-detail-grid">
          <article class="detail-panel span-two"><span class="eyebrow">Context</span><h2>Why it worked</h2><p>{{ asset()?.rationale }}</p><pre>{{ asset()?.content }}</pre></article>
          <article class="detail-panel"><span class="eyebrow">Governance</span><h2>{{ asset()?.governance?.decision }}</h2><p>{{ asset()?.governance?.reason }}</p><dl><div><dt>Current steward</dt><dd>{{ asset()?.currentSteward ?? 'Unassigned' }}</dd></div><div><dt>Owner team</dt><dd>{{ asset()?.ownerTeamName }}</dd></div><div><dt>Usage</dt><dd>{{ asset()?.usageCount }}</dd></div></dl></article>

          <article class="detail-panel span-two"><span class="eyebrow">Provenance</span><h2>Organizational lineage</h2><div class="provenance-list">@for (edge of asset()?.provenance ?? []; track edge.edgeType + edge.targetKey) { <div><strong>{{ edge.edgeType }}</strong><span>{{ edge.targetLabel }}</span><small>{{ edge.evidence }}</small></div> }</div></article>
          <article class="detail-panel"><span class="eyebrow">Evidence</span><h2>Learning Library citations</h2><a class="text-link library-inline-link" routerLink="/library">Open Learning Library →</a><div class="citation-list">@for (citation of asset()?.citations ?? []; track citation.chunkId) { <blockquote><strong>{{ citation.documentName }}</strong><span>{{ citation.excerpt }}</span><small>{{ citation.relationship }} · {{ citation.score }}</small></blockquote> } @empty { <p>No accessible evidence for this actor.</p> }</div></article>

          <article class="detail-panel"><span class="eyebrow">Versions</span><h2>Change history</h2><div class="version-list">@for (version of asset()?.versions ?? []; track version.id) { <div><strong>{{ version.version }}</strong><span>{{ version.changeNotes }}</span><small>{{ version.createdBy }} · {{ version.createdAt }}</small></div> }</div></article>
          <article class="detail-panel"><span class="eyebrow">Decisions</span><h2>Decision context</h2><div class="version-list">@for (decision of asset()?.decisions ?? []; track decision.id) { <div><strong>{{ decision.decision }}</strong><span>{{ decision.rationale }}</span><small>{{ decision.decidedBy }}</small></div> } @empty { <p>No linked decisions.</p> }</div></article>
          <article class="detail-panel"><span class="eyebrow">Outcomes</span><h2>Measured value</h2><div class="outcome-grid">@for (outcome of asset()?.outcomes ?? []; track outcome.id) { <div><strong>{{ outcome.value }} {{ outcome.unit }}</strong><span>{{ outcome.metricName }}</span></div> } @empty { <p>No measured outcomes yet.</p> }</div></article>
        </div>
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemoryAssetPage implements OnInit {
  private readonly api = inject(MemoryApiService)
  private readonly route = inject(ActivatedRoute)
  private readonly destroyRef = inject(DestroyRef)
  private readonly assetKey = this.route.snapshot.paramMap.get('assetKey') ?? ''

  protected readonly actors = signal<DemoActor[]>([])
  protected readonly asset = signal<CapabilityAssetDetail | null>(null)
  protected readonly loading = signal(true)
  protected readonly error = signal('')
  protected selectedActorId = 'person-laura-nguyen'

  ngOnInit(): void {
    forkJoin({ actors: this.api.actors(), asset: this.api.asset(this.assetKey, this.selectedActorId) }).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false))
    ).subscribe({
      next: ({ actors, asset }) => { this.actors.set(actors); this.asset.set(asset) },
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }

  protected loadAsset(): void {
    this.loading.set(true)
    this.error.set('')
    this.asset.set(null)
    this.api.asset(this.assetKey, this.selectedActorId).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false))
    ).subscribe({
      next: (asset) => this.asset.set(asset),
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }
}
