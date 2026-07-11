import { provideHttpClient } from '@angular/common/http'
import { type ApplicationConfig } from '@angular/core'
import { provideRouter, withComponentInputBinding, type Routes } from '@angular/router'

const routes: Routes = [
  { path: '', title: 'Home · Knowledge Workspace', loadComponent: () => import('./pages/home.page').then((module) => module.HomePage) },
  { path: 'query', title: 'Query · Knowledge Workspace', loadComponent: () => import('./pages/query.page').then((module) => module.QueryPage) },
  { path: 'query/:conversationId', title: 'Conversation · Knowledge Workspace', loadComponent: () => import('./pages/query.page').then((module) => module.QueryPage) },
  { path: 'results', title: 'Results · Knowledge Workspace', loadComponent: () => import('./pages/results.page').then((module) => module.ResultsPage) },
  { path: 'library', title: 'Library · Knowledge Workspace', loadComponent: () => import('./pages/library.page').then((module) => module.LibraryPage) },
  { path: 'memory', title: 'Capabilities · Memory Workspace', loadComponent: () => import('./pages/memory.page').then((module) => module.MemoryPage) },
  { path: 'memory/recommendations', title: 'Recommendations · Memory Workspace', loadComponent: () => import('./pages/memory-recommendations.page').then((module) => module.MemoryRecommendationsPage) },
  { path: 'memory/skills', title: 'Skills · Memory Workspace', loadComponent: () => import('./pages/memory-skills.page').then((module) => module.MemorySkillsPage) },
  { path: 'memory/assets/:assetKey', title: 'Capability · Memory Workspace', loadComponent: () => import('./pages/memory-asset.page').then((module) => module.MemoryAssetPage) },
  { path: 'files', redirectTo: 'library', pathMatch: 'full' },
  { path: '**', redirectTo: '' },
]

export const appConfig: ApplicationConfig = {
  providers: [provideHttpClient(), provideRouter(routes, withComponentInputBinding())],
}
