import { ChangeDetectionStrategy, Component } from '@angular/core'
import { RouterLink, RouterLinkActive, RouterOutlet, type IsActiveMatchOptions } from '@angular/router'

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <div class="app-shell">
      <aside class="sidebar">
        <a class="brand" routerLink="/" aria-label="Knowledge Workspace home">
          <span class="brand-mark">K</span>
          <span class="brand-copy"><strong>Knowledge</strong><small>Workspace</small></span>
        </a>

        <nav aria-label="Primary navigation">
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="exactRouteMatch">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 13a8 8 0 1 1 16 0"></path><path d="M12 13l4-4"></path><path d="M5 18h14"></path></svg>
            <span>Dashboard</span>
          </a>
          <a routerLink="/tasks" routerLinkActive="active" [routerLinkActiveOptions]="exactRouteMatch">
            <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="4" width="6" height="6" rx="1"></rect><rect x="15" y="14" width="6" height="6" rx="1"></rect><path d="M9 7h3a3 3 0 0 1 3 3v4M12 17H9a3 3 0 0 1-3-3v-4"></path></svg>
            <span>Tasks</span>
          </a>
          <a routerLink="/skills" routerLinkActive="active" [routerLinkActiveOptions]="exactRouteMatch">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m14.5 6.5 3-3 3 3-3 3"></path><path d="M17.5 3.5 11 10"></path><path d="M12.5 13.5 7 19H4v-3l5.5-5.5"></path><circle cx="11" cy="12" r="3"></circle></svg>
            <span>Skills</span>
          </a>
          <a routerLink="/calendar" routerLinkActive="active" [routerLinkActiveOptions]="exactRouteMatch">
            <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M8 3v4M16 3v4M3 10h18"></path><path d="M8 14h2M14 14h2M8 18h2"></path></svg>
            <span>Calendar</span>
          </a>
        </nav>

        <div class="sidebar-foot">
          <span class="status-dot"></span>
          <span><strong>Demo workspace</strong><small>Neon + pgvector</small></span>
        </div>
      </aside>

      <main class="main-content">
        <router-outlet />
      </main>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShellComponent {
  protected readonly exactRouteMatch: IsActiveMatchOptions = {
    paths: 'exact',
    queryParams: 'ignored',
    matrixParams: 'ignored',
    fragment: 'ignored',
  }
}
