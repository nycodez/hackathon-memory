import { provideHttpClient } from '@angular/common/http'
import { type ApplicationConfig } from '@angular/core'
import { provideRouter, withComponentInputBinding, type Routes } from '@angular/router'

const routes: Routes = [
  { path: '', title: 'Home · Knowledge Workspace', loadComponent: () => import('./pages/home.page').then((module) => module.HomePage) },
  { path: 'query', title: 'Query · Knowledge Workspace', loadComponent: () => import('./pages/query.page').then((module) => module.QueryPage) },
  { path: 'query/:conversationId', title: 'Conversation · Knowledge Workspace', loadComponent: () => import('./pages/query.page').then((module) => module.QueryPage) },
  { path: 'results', title: 'Results · Knowledge Workspace', loadComponent: () => import('./pages/results.page').then((module) => module.ResultsPage) },
  { path: 'files', title: 'Files · Knowledge Workspace', loadComponent: () => import('./pages/files.page').then((module) => module.FilesPage) },
  { path: '**', redirectTo: '' },
]

export const appConfig: ApplicationConfig = {
  providers: [provideHttpClient(), provideRouter(routes, withComponentInputBinding())],
}

