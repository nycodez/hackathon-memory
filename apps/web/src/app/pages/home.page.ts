import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core'
import { RouterLink } from '@angular/router'
import type { DashboardSummary, HealthSummary } from '@hackathon/shared'
import { finalize, forkJoin } from 'rxjs'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { ApiService } from '../core/api.service'

@Component({
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="page page-home">
      <header class="page-header hero-header">
        <div>
          <span class="eyebrow">Hackathon starter</span>
          <h1>Turn your documents into useful answers.</h1>
          <p>Upload a small corpus, let the learning library index it, and start a grounded conversation.</p>
        </div>
        <a class="button primary" routerLink="/query">Start a query <span aria-hidden="true">→</span></a>
      </header>

      @if (loading()) {
        <div class="state-card" role="status">Loading workspace…</div>
      } @else if (error()) {
        <div class="state-card error" role="alert">{{ error() }}</div>
      } @else {
        <div class="metric-grid">
          <article class="metric-card"><span>Documents</span><strong>{{ dashboard()?.documents ?? 0 }}</strong><small>{{ dashboard()?.readyDocuments ?? 0 }} ready to search</small></article>
          <article class="metric-card"><span>Conversations</span><strong>{{ dashboard()?.conversations ?? 0 }}</strong><small>Saved and resumable</small></article>
          <article class="metric-card"><span>Messages</span><strong>{{ dashboard()?.messages ?? 0 }}</strong><small>Across this workspace</small></article>
          <article class="metric-card"><span>System</span><strong class="status-word">{{ health()?.status ?? '—' }}</strong><small>{{ health()?.database ?? 'unknown' }} database</small></article>
        </div>
      }

      <div class="workflow-card">
        <div class="section-heading">
          <div><span class="eyebrow">Learning library</span><h2>From file to grounded answer</h2></div>
          <a routerLink="/library">Manage library</a>
        </div>
        <ol class="pipeline-list">
          <li><span>01</span><div><strong>Ingest</strong><small>Accept the original file and record its checksum.</small></div></li>
          <li><span>02</span><div><strong>Read</strong><small>Extract text or request OCR when needed.</small></div></li>
          <li><span>03</span><div><strong>Understand</strong><small>Summarize and split content into useful chunks.</small></div></li>
          <li><span>04</span><div><strong>Index</strong><small>Vectorize each chunk for hybrid retrieval.</small></div></li>
        </ol>
      </div>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage implements OnInit {
  private readonly api = inject(ApiService)
  private readonly destroyRef = inject(DestroyRef)
  protected readonly loading = signal(true)
  protected readonly error = signal('')
  protected readonly dashboard = signal<DashboardSummary | null>(null)
  protected readonly health = signal<HealthSummary | null>(null)

  ngOnInit(): void {
    forkJoin({ dashboard: this.api.dashboard(), health: this.api.health() }).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false))
    ).subscribe({
      next: ({ dashboard, health }) => {
        this.dashboard.set(dashboard)
        this.health.set(health)
      },
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }
}
