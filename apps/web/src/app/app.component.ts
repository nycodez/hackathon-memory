import { ChangeDetectionStrategy, Component } from '@angular/core'
import { AppShellComponent } from './layout/app-shell.component'

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AppShellComponent],
  template: '<app-shell />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {}

