import { provideHttpClient } from '@angular/common/http'
import { type ApplicationConfig } from '@angular/core'
import { provideRouter, withComponentInputBinding, type Routes } from '@angular/router'

const routes: Routes = [
  { path: '', title: 'Dashboard · Organizational Memory', loadComponent: () => import('./pages/home.page').then((module) => module.HomePage) },
  { path: 'query', title: 'Query · Organizational Memory', loadComponent: () => import('./pages/query.page').then((module) => module.QueryPage) },
  { path: 'query/:conversationId', title: 'Conversation · Organizational Memory', loadComponent: () => import('./pages/query.page').then((module) => module.QueryPage) },
  { path: 'results', title: 'Results · Organizational Memory', loadComponent: () => import('./pages/results.page').then((module) => module.ResultsPage) },
  { path: 'library', title: 'Library · Organizational Memory', loadComponent: () => import('./pages/library.page').then((module) => module.LibraryPage) },
  { path: 'tasks', title: 'Tasks · Organizational Memory', loadComponent: () => import('./pages/tasks.page').then((module) => module.TasksPage) },
  { path: 'skills', title: 'Skills · Organizational Memory', loadComponent: () => import('./pages/skills.page').then((module) => module.SkillsPage) },
  { path: 'capabilities/:capabilityId', title: 'Capability · Organizational Memory', loadComponent: () => import('./pages/capability.page').then((module) => module.CapabilityPage) },
  { path: 'calendar', title: 'Calendar · Organizational Memory', loadComponent: () => import('./pages/calendar.page').then((module) => module.CalendarPage) },
  { path: 'files', redirectTo: 'library', pathMatch: 'full' },
  { path: '**', redirectTo: '' },
]

export const appConfig: ApplicationConfig = {
  providers: [provideHttpClient(), provideRouter(routes, withComponentInputBinding())],
}
