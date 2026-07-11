import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { FormsModule } from '@angular/forms'
import { RouterLink } from '@angular/router'
import type {
  CapabilityAsset,
  CapabilityClassification,
  CapabilitySearchResult,
  CapabilitySummary,
  CapabilityType,
  CreateCapabilityInput,
  DemoActor,
} from '@hackathon/shared'
import { finalize, forkJoin } from 'rxjs'
import { MemoryApiService } from '../core/memory-api.service'

interface CapabilityCard {
  assetKey: string
  title: string
  type: CapabilityType
  classification: CapabilityClassification
  summary: string
  version: string
  steward: string
  score: number | null
  reasons: string[]
  citationCount: number
  locked: boolean
}

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <section class="page memory-page">
      <header class="page-header memory-hero">
        <div>
          <span class="eyebrow">Organizational memory</span>
          <h1>Capabilities compound when people move on.</h1>
          <p>Discover the prompts, workflows, agents, decisions, and outcomes built on evidence from the Learning Library.</p>
        </div>
        <button class="button primary" type="button" (click)="openCapture()">Save capability</button>
      </header>

      @if (summary()) {
        <div class="memory-metric-grid" aria-label="Capability memory summary">
          <article><span>Capabilities</span><strong>{{ summary()?.assets }}</strong></article>
          <article><span>Runnable skills</span><strong>{{ summary()?.runnableSkills }}</strong></article>
          <article><span>Stewardship transfers</span><strong>{{ summary()?.stewardshipTransfers }}</strong></article>
          <article><span>Recorded runs</span><strong>{{ summary()?.runs }}</strong></article>
        </div>
      }

      <article class="continuity-banner">
        <span aria-hidden="true">◇</span>
        <div>
          <strong>Mai Tran left. Her portfolio health-check capability did not.</strong>
          <p>Authorship remains with Mai while stewardship, governance, evidence, and the runnable version transfer to Dara Kim.</p>
        </div>
      </article>

      <div class="memory-toolbar">
        <label class="memory-search-field">
          <span>Search capabilities</span>
          <input name="memoryQuery" [(ngModel)]="query" placeholder="Try: weekly portfolio health digest" (keyup.enter)="search()" />
        </label>
        <label>
          <span>Viewing as</span>
          <select name="actor" [(ngModel)]="selectedActorId" (ngModelChange)="actorChanged()">
            @for (actor of actors(); track actor.id) {
              <option [value]="actor.id">{{ actor.name }} · {{ actor.role }}</option>
            }
          </select>
        </label>
        <label>
          <span>Type</span>
          <select name="assetType" [(ngModel)]="selectedType">
            <option value="">All types</option>
            @for (type of capabilityTypes; track type) { <option [value]="type">{{ type }}</option> }
          </select>
        </label>
        <button class="button primary" type="button" [disabled]="busy()" (click)="search()">{{ busy() ? 'Searching…' : 'Search' }}</button>
      </div>

      @if (error()) {
        <div class="state-card error" role="alert">{{ error() }}</div>
      } @else if (loading()) {
        <div class="state-card" role="status">Loading capability memory…</div>
      } @else if (!cards().length) {
        <div class="empty-card"><span>◇</span><h2>No capabilities found</h2><p>Try a broader task or capture a new capability.</p></div>
      } @else {
        <div class="capability-list">
          @for (card of cards(); track card.assetKey) {
            <article class="capability-card" [class.locked]="card.locked">
              <div class="capability-card-main">
                <div class="badge-row">
                  <span class="memory-badge">{{ card.type }}</span>
                  <span class="memory-badge classification">{{ card.classification }}</span>
                  @if (card.version) { <span class="memory-badge neutral">{{ card.version }}</span> }
                  @if (card.locked) { <span class="memory-badge locked-badge">Locked</span> }
                </div>
                <h2>{{ card.title }} <small>· {{ card.assetKey }}</small></h2>
                <p>{{ card.summary }}</p>
                @if (card.reasons.length) {
                  <ul class="reason-list">
                    @for (reason of card.reasons; track reason) { <li>{{ reason }}</li> }
                  </ul>
                }
                <footer>
                  <span>{{ card.steward }}</span>
                  @if (card.citationCount) { <span>{{ card.citationCount }} grounded citation{{ card.citationCount === 1 ? '' : 's' }}</span> }
                </footer>
              </div>
              <div class="capability-card-action">
                @if (card.score !== null) { <strong>{{ card.score }}</strong><small>relevance</small> }
                @if (!card.locked) {
                  <a class="button secondary" [routerLink]="['/memory/assets', card.assetKey]">Open</a>
                } @else {
                  <span class="locked-note">Content withheld by policy</span>
                }
              </div>
            </article>
          }
        </div>
      }
    </section>

    @if (captureOpen()) {
      <div class="memory-modal-backdrop" role="presentation">
        <section class="memory-modal" role="dialog" aria-modal="true" aria-labelledby="capture-title">
          <header><div><span class="eyebrow">Learning Library + capability graph</span><h2 id="capture-title">Save a capability</h2></div><button type="button" aria-label="Close" (click)="closeCapture()">×</button></header>
          <form (ngSubmit)="createCapability()">
            <div class="form-grid">
              <label><span>Title</span><input name="title" [(ngModel)]="capture.title" required maxlength="140" /></label>
              <label><span>Type</span><select name="type" [(ngModel)]="capture.type">@for (type of capabilityTypes; track type) { <option [value]="type">{{ type }}</option> }</select></label>
              <label><span>Classification</span><select name="classification" [(ngModel)]="capture.classification">@for (item of classifications; track item) { <option [value]="item">{{ item }}</option> }</select></label>
              <label><span>Version</span><input name="version" [(ngModel)]="capture.version" maxlength="24" /></label>
            </div>
            <label><span>Summary</span><textarea name="summary" [(ngModel)]="capture.summary" required maxlength="500"></textarea></label>
            <label><span>Capability content</span><textarea name="content" [(ngModel)]="capture.content" required maxlength="12000" placeholder="Prompt, workflow steps, operating instructions, or agent configuration"></textarea></label>
            <label><span>Why it worked</span><textarea name="rationale" [(ngModel)]="capture.rationale" required maxlength="2000"></textarea></label>
            <label><span>Change notes</span><input name="changeNotes" [(ngModel)]="capture.changeNotes" maxlength="500" /></label>
            @if (captureError()) { <p class="form-error" role="alert">{{ captureError() }}</p> }
            <footer><button class="button secondary" type="button" (click)="closeCapture()">Cancel</button><button class="button primary" type="submit" [disabled]="captureBusy()">{{ captureBusy() ? 'Saving…' : 'Save and index' }}</button></footer>
          </form>
        </section>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemoryPage implements OnInit {
  private readonly api = inject(MemoryApiService)
  private readonly destroyRef = inject(DestroyRef)

  protected readonly capabilityTypes: CapabilityType[] = ['workflow', 'prompt', 'agent', 'skill', 'decision', 'outcome']
  protected readonly classifications: CapabilityClassification[] = ['public', 'internal', 'confidential', 'restricted']
  protected readonly actors = signal<DemoActor[]>([])
  protected readonly cards = signal<CapabilityCard[]>([])
  protected readonly summary = signal<CapabilitySummary | null>(null)
  protected readonly loading = signal(true)
  protected readonly busy = signal(false)
  protected readonly error = signal('')
  protected readonly captureOpen = signal(false)
  protected readonly captureBusy = signal(false)
  protected readonly captureError = signal('')

  protected selectedActorId = 'person-dara-kim'
  protected selectedType: CapabilityType | '' = ''
  protected query = ''
  protected capture = this.emptyCapture()

  ngOnInit(): void {
    forkJoin({ actors: this.api.actors(), assets: this.api.assets(this.selectedActorId), summary: this.api.summary(this.selectedActorId) }).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false))
    ).subscribe({
      next: ({ actors, assets, summary }) => {
        this.actors.set(actors)
        this.summary.set(summary)
        this.cards.set(assets.map((asset) => this.assetCard(asset)))
      },
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }

  protected search(): void {
    if (!this.query.trim()) {
      this.reloadAssets()
      return
    }
    this.busy.set(true)
    this.error.set('')
    this.api.search({
      query: this.query.trim(),
      type: this.selectedType || undefined,
      includeLocked: true,
      limit: 12,
    }, this.selectedActorId).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.busy.set(false))
    ).subscribe({
      next: (results) => this.cards.set(results.map((result) => this.searchCard(result))),
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }

  protected actorChanged(): void {
    if (this.query.trim()) this.search()
    else this.reloadAssets()
    this.api.summary(this.selectedActorId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (summary) => this.summary.set(summary),
      error: () => undefined,
    })
  }

  protected openCapture(): void {
    const actor = this.actors().find((item) => item.id === this.selectedActorId)
    this.capture = { ...this.emptyCapture(), ownerTeamId: actor?.teamId ?? 'team-investments' }
    this.captureError.set('')
    this.captureOpen.set(true)
  }

  protected closeCapture(): void {
    if (!this.captureBusy()) this.captureOpen.set(false)
  }

  protected createCapability(): void {
    const input: CreateCapabilityInput = {
      requestId: `capture-${Date.now()}`,
      type: this.capture.type,
      title: this.capture.title.trim(),
      summary: this.capture.summary.trim(),
      content: this.capture.content.trim(),
      rationale: this.capture.rationale.trim(),
      classification: this.capture.classification,
      ownerTeamId: this.capture.ownerTeamId,
      version: this.capture.version.trim() || undefined,
      changeNotes: this.capture.changeNotes.trim() || undefined,
    }
    this.captureBusy.set(true)
    this.captureError.set('')
    this.api.create(input, this.selectedActorId).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.captureBusy.set(false))
    ).subscribe({
      next: () => {
        this.captureOpen.set(false)
        this.reloadAssets()
      },
      error: (error: unknown) => this.captureError.set(this.api.message(error)),
    })
  }

  private reloadAssets(): void {
    this.busy.set(true)
    this.error.set('')
    this.api.assets(this.selectedActorId).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.busy.set(false))
    ).subscribe({
      next: (assets) => this.cards.set(assets.map((asset) => this.assetCard(asset))),
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }

  private assetCard(asset: CapabilityAsset): CapabilityCard {
    return {
      assetKey: asset.assetKey,
      title: asset.title,
      type: asset.type,
      classification: asset.classification,
      summary: asset.summary,
      version: asset.currentVersion,
      steward: asset.currentSteward ? `Steward: ${asset.currentSteward}` : 'Steward not assigned',
      score: null,
      reasons: [],
      citationCount: 0,
      locked: false,
    }
  }

  private searchCard(result: CapabilitySearchResult): CapabilityCard {
    const asset = result.asset
    const locked = result.lockedMetadata
    return {
      assetKey: asset?.assetKey ?? locked?.assetKey ?? 'locked',
      title: asset?.title ?? locked?.title ?? 'Restricted capability',
      type: asset?.type ?? locked?.type ?? 'workflow',
      classification: asset?.classification ?? locked?.classification ?? 'restricted',
      summary: asset?.summary ?? 'This capability exists, but its content is outside the current actor\'s clearance.',
      version: asset?.currentVersion ?? '',
      steward: asset?.currentSteward ? `Steward: ${asset.currentSteward}` : 'Governance metadata only',
      score: Number(result.score.toFixed(3)),
      reasons: result.reasons,
      citationCount: result.citations.length,
      locked: result.locked,
    }
  }

  private emptyCapture(): {
    title: string
    type: CapabilityType
    classification: CapabilityClassification
    version: string
    summary: string
    content: string
    rationale: string
    changeNotes: string
    ownerTeamId: string
  } {
    return {
      title: '',
      type: 'workflow',
      classification: 'internal',
      version: 'v1.0',
      summary: '',
      content: '',
      rationale: '',
      changeNotes: 'Initial organizational memory capture',
      ownerTeamId: 'team-investments',
    }
  }
}
