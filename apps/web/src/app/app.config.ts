import { provideHttpClient } from '@angular/common/http'
import { type ApplicationConfig } from '@angular/core'
import { provideRouter, withComponentInputBinding, type Routes } from '@angular/router'

const routes: Routes = [
  { path: '', title: 'Dashboard · Knowledge Workspace', loadComponent: () => import('./pages/home.page').then((module) => module.HomePage) },
  { path: 'query', title: 'Query · Knowledge Workspace', loadComponent: () => import('./pages/query.page').then((module) => module.QueryPage) },
  { path: 'query/:conversationId', title: 'Conversation · Knowledge Workspace', loadComponent: () => import('./pages/query.page').then((module) => module.QueryPage) },
  { path: 'results', title: 'Results · Knowledge Workspace', loadComponent: () => import('./pages/results.page').then((module) => module.ResultsPage) },
  { path: 'library', title: 'Library · Knowledge Workspace', loadComponent: () => import('./pages/library.page').then((module) => module.LibraryPage) },
  { path: 'tasks', title: 'Tasks · Knowledge Workspace', loadComponent: () => import('./pages/tasks.page').then((module) => module.TasksPage) },
  { path: 'skills', title: 'Skills · Knowledge Workspace', loadComponent: () => import('./pages/skills.page').then((module) => module.SkillsPage) },
  { path: 'capabilities/:capabilityId', title: 'Capability · Knowledge Workspace', loadComponent: () => import('./pages/capability.page').then((module) => module.CapabilityPage) },
  { path: 'calendar', title: 'Calendar · Knowledge Workspace', loadComponent: () => import('./pages/calendar.page').then((module) => module.CalendarPage) },
  { path: 'files', redirectTo: 'library', pathMatch: 'full' },
  { path: '**', redirectTo: '' },
]

export const appConfig: ApplicationConfig = {
  providers: [provideHttpClient(), provideRouter(routes, withComponentInputBinding())],
}
