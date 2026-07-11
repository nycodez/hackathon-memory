import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { DatePipe } from '@angular/common'
import { RouterLink } from '@angular/router'
import type { ConversationSummary } from '@hackathon/shared'
import { finalize } from 'rxjs'
import { ApiService } from '../core/api.service'

@Component({
  standalone: true,
  imports: [DatePipe, RouterLink],
  template: `
    <section class="page">
      <header class="page-header compact-header">
        <div><span class="eyebrow">Results</span><h1>Previous conversations</h1><p>Resume any saved session with its full message history and citations.</p></div>
        <a class="button primary" routerLink="/query">New conversation</a>
      </header>

      @if (loading()) {
        <div class="state-card" role="status">Loading conversations…</div>
      } @else if (error()) {
        <div class="state-card error" role="alert">{{ error() }}</div>
      } @else if (!conversations().length) {
        <div class="empty-card"><span>◫</span><h2>No conversations yet</h2><p>Start a query and the session will appear here automatically.</p><a class="button primary" routerLink="/query">Start querying</a></div>
      } @else {
        <div class="conversation-list">
          @for (conversation of conversations(); track conversation.id) {
            <a class="conversation-card" [routerLink]="['/query', conversation.id]">
              <div class="conversation-icon">◌</div>
              <div class="conversation-copy">
                <h2>{{ conversation.title }}</h2>
                <p>{{ conversation.preview }}</p>
                <small>{{ conversation.messageCount }} messages · Updated {{ conversation.updatedAt | date:'medium' }}</small>
              </div>
              <span class="resume">Resume →</span>
            </a>
          }
        </div>
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResultsPage implements OnInit {
  private readonly api = inject(ApiService)
  private readonly destroyRef = inject(DestroyRef)
  protected readonly conversations = signal<ConversationSummary[]>([])
  protected readonly loading = signal(true)
  protected readonly error = signal('')

  ngOnInit(): void {
    this.api.conversations().pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false))
    ).subscribe({
      next: (conversations) => this.conversations.set(conversations),
      error: (error: unknown) => this.error.set(this.api.message(error)),
    })
  }
}

