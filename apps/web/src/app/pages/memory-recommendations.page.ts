import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { FormsModule } from '@angular/forms'
import { RouterLink } from '@angular/router'
import type { CapabilityRecommendation, DemoActor } from '@hackathon/shared'
import { finalize } from 'rxjs'
import { MemoryApiService } from '../core/memory-api.service'

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <section class="page memory-page">
      <header class="page-header compact-header">
        <div>
          <span class="eyebrow">Organizational memory</span>
          <h1>Start with the accounting capability your team already proved.</h1>
          <p>Describe a task. Recommendations combine Learning Library evidence, capability provenance, reuse, and measured outcomes after enforcing the current actor's access.</p>
        </div>
      </header>

      <article class="recommend-composer">
        <label for="recommend-task">What are you trying to accomplish?</label>
        <textarea id="recommend-task" name="task" [(ngModel)]="task" rows="4"></textarea>
        <div>
          <label>
            <span>Viewing as</span>
            <select name="actor" [(ngModel)]="selectedActorId">
              @for (actor of actors(); track actor.id) {
                <option [value]="actor.id">{{ actor.name }} · {{ actor.role }}</option>
              }
            </select>
          </label>
          <button class="button primary" type="button" [disabled]="loading() || task.length < 3" (click)="recommend()">{{ loading() ? 'Finding prior work…' : 'Recommend capabilities' }}</button>
        </div>
      </article>

      @if (error()) {
        <div class="state-card error" role="alert">{{ error() }}</div>
      } @else if (!submitted()) {
        <div class="memory-callout"><span>✦</span><p>Try the 60-second demo task: run the weekly AP process for Midtown Residential on day one.</p></div>
      } @else if (!recommendations().length) {
        <div class="empty-card"><span>◎</span><h2>No governed match found</h2><p>Add relevant evidence to the Learning Library or broaden the task.</p></div>
      } @else {
        <div class="recommendation-stack">
          @for (recommendation of recommendations(); track recommendation.asset?.assetKey ?? recommendation.lockedMetadata?.assetKey) {
            <article class="recommendation-card" [class.locked]="recommendation.locked">
              <div class="recommendation-score"><strong>{{ recommendation.score }}</strong><span>score</span></div>
              <div>
                <div class="badge-row">
                  <span class="memory-badge">{{ recommendation.asset?.type ?? recommendation.lockedMetadata?.type }}</span>
                  <span class="memory-badge classification">{{ recommendation.asset?.classification ?? recommendation.lockedMetadata?.classification }}</span>
                  @if (recommendation.locked) { <span class="memory-badge locked-badge">Locked</span> }
                </div>
                <h2>{{ recommendation.asset?.title ?? recommendation.lockedMetadata?.title }}</h2>
                <p>{{ recommendation.explanation }}</p>
                <ul class="reason-list">@for (reason of recommendation.reasons; track reason) { <li>{{ reason }}</li> }</ul>
                @if (recommendation.citations.length) { <small>{{ recommendation.citations.length }} permission-checked Learning Library citation{{ recommendation.citations.length === 1 ? '' : 's' }}</small> }
              </div>
              <div class="recommendation-action">
                @if (recommendation.asset) {
                  <a class="button secondary" [routerLink]="['/memory/assets', recommendation.asset.assetKey]">Review capability</a>
                } @else {
                  <span>Content withheld by policy</span>
                }
              </div>
            </article>
          }
        </div>
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemoryRecommendationsPage implements OnInit {
  private readonly api = inject(MemoryApiService)
  private readonly destroyRef = inject(DestroyRef)

  protected readonly actors = signal<DemoActor[]>([])
  protected readonly recommendations = signal<CapabilityRecommendation[]>([])
  protected readonly loading = signal(false)
  protected readonly submitted = signal(false)
  protected readonly error = signal('')
  protected selectedActorId = 'person-laura-nguyen'
  protected task = 'Run the weekly AP process for Midtown Residential on day one.'

  ngOnInit(): void {
    this.api.actors().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (actors) => this.actors.set(actors),
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }

  protected recommend(): void {
    const task = this.task.trim()
    if (!task) return
    this.loading.set(true)
    this.submitted.set(true)
    this.error.set('')
    this.api.recommendations({ task, limit: 6 }, this.selectedActorId).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false))
    ).subscribe({
      next: (recommendations) => this.recommendations.set(recommendations),
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }
}
