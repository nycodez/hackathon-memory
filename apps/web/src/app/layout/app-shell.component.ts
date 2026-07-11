import { ChangeDetectionStrategy, Component } from '@angular/core'
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router'

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <div class="app-shell">
      <aside class="sidebar">
        <a class="brand" routerLink="/" aria-label="Memory Workspace home">
          <span class="brand-mark">M</span>
          <span class="brand-copy"><strong>Memory</strong><small>Workspace</small></span>
        </a>

        <nav aria-label="Primary navigation">
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">
            <span aria-hidden="true">⌂</span> Home
          </a>
          <a routerLink="/query" routerLinkActive="active">
            <span aria-hidden="true">◌</span> Query
          </a>
          <a routerLink="/results" routerLinkActive="active">
            <span aria-hidden="true">◫</span> Results
          </a>
          <a routerLink="/library" routerLinkActive="active">
            <span aria-hidden="true">▱</span> Library
          </a>

          <hr class="nav-section-divider" />
          <span class="nav-section-label">Organizational memory</span>

          <a class="memory-nav custom-nav-start" routerLink="/memory" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">
            <span aria-hidden="true">◇</span> Capabilities
          </a>
          <a class="memory-nav" routerLink="/memory/recommendations" routerLinkActive="active">
            <span aria-hidden="true">◎</span> Recommendations
          </a>
          <a class="memory-nav" routerLink="/memory/skills" routerLinkActive="active">
            <span aria-hidden="true">▦</span> Skills
          </a>
        </nav>

        <div class="sidebar-foot">
          <span class="status-dot"></span>
          <span><strong>Demo workspace</strong><small>Library + capability graph</small></span>
        </div>
      </aside>

      <main class="main-content">
        <router-outlet />
      </main>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShellComponent {}
