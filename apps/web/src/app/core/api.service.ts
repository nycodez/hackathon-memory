import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http'
import { Injectable } from '@angular/core'
import type {
  ApiEnvelope,
  AskResult,
  CalendarWindow,
  CapabilityDetail,
  CapabilityInstallation,
  CapabilityRun,
  CapabilityRunRequest,
  CapabilitySummary,
  Conversation,
  ConversationSummary,
  DashboardSummary,
  HealthSummary,
  KnowledgeDocument,
  LibraryFolder,
  LibraryListing,
  MemoryActor,
  MemoryAnalytics,
  MemoryRecommendation,
  MemorySearchResponse,
  MemorizedTask,
  TaskRecurrence,
  TaskSchedule,
  TaskWorkspace,
} from '@hackathon/shared'
import { map, type Observable } from 'rxjs'
import { ActorContextService } from './actor-context.service'

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(
    private readonly http: HttpClient,
    private readonly actorContext: ActorContextService
  ) {}

  private get headers(): HttpHeaders {
    const actorId = this.actorContext.selectedActorId()
    const values: Record<string, string> = { 'x-workspace-id': 'hackathon-demo' }
    if (actorId) values['x-actor-id'] = actorId
    return new HttpHeaders(values)
  }

  health(): Observable<HealthSummary> {
    return this.get<HealthSummary>('/api/health')
  }

  dashboard(): Observable<DashboardSummary> {
    return this.get<DashboardSummary>('/api/dashboard')
  }

  conversations(): Observable<ConversationSummary[]> {
    return this.get<ConversationSummary[]>('/api/conversations')
  }

  conversation(id: string): Observable<Conversation> {
    return this.get<Conversation>(`/api/conversations/${id}`)
  }

  deleteConversation(id: string): Observable<void> {
    return this.http.delete<void>(`/api/conversations/${id}`, { headers: this.headers })
  }

  ask(message: string, conversationId?: string): Observable<AskResult> {
    return this.unwrap(this.http.post<ApiEnvelope<AskResult>>('/api/query', { message, conversationId }, { headers: this.headers }))
  }

  documents(): Observable<KnowledgeDocument[]> {
    return this.get<KnowledgeDocument[]>('/api/documents')
  }

  library(folderId: string | null): Observable<LibraryListing> {
    const query = folderId ? `?folderId=${encodeURIComponent(folderId)}` : ''
    return this.get<LibraryListing>(`/api/library${query}`)
  }

  createFolder(name: string, parentId: string | null): Observable<LibraryFolder> {
    return this.unwrap(this.http.post<ApiEnvelope<LibraryFolder>>(
      '/api/library/folders',
      { name, parentId },
      { headers: this.headers }
    ))
  }

  deleteFolder(id: string): Observable<void> {
    return this.http.delete<void>(`/api/library/folders/${id}`, { headers: this.headers })
  }

  upload(file: File, folderId: string | null = null): Observable<KnowledgeDocument> {
    const form = new FormData()
    form.append('file', file)
    if (folderId) form.append('folderId', folderId)
    return this.unwrap(this.http.post<ApiEnvelope<KnowledgeDocument>>('/api/documents', form, { headers: this.headers }))
  }

  processDocument(id: string): Observable<KnowledgeDocument> {
    return this.unwrap(this.http.post<ApiEnvelope<KnowledgeDocument>>(`/api/documents/${id}/process`, {}, { headers: this.headers }))
  }

  documentContent(id: string): Observable<Blob> {
    return this.http.get(`/api/documents/${id}/content`, {
      headers: this.headers,
      responseType: 'blob',
    })
  }

  deleteDocument(id: string): Observable<void> {
    return this.http.delete<void>(`/api/documents/${id}`, { headers: this.headers })
  }

  taskWorkspace(): Observable<TaskWorkspace> {
    return this.get<TaskWorkspace>('/api/tasks')
  }

  createTask(name: string, description: string, skillCodes: string[]): Observable<MemorizedTask> {
    return this.unwrap(this.http.post<ApiEnvelope<MemorizedTask>>(
      '/api/tasks',
      { name, description, skillCodes },
      { headers: this.headers }
    ))
  }

  updateTask(id: string, name: string, description: string, skillCodes: string[]): Observable<MemorizedTask> {
    return this.unwrap(this.http.put<ApiEnvelope<MemorizedTask>>(
      `/api/tasks/${id}`,
      { name, description, skillCodes },
      { headers: this.headers }
    ))
  }

  deleteTask(id: string): Observable<void> {
    return this.http.delete<void>(`/api/tasks/${id}`, { headers: this.headers })
  }

  calendarWindow(from: string, to: string): Observable<CalendarWindow> {
    const query = new URLSearchParams({ from, to }).toString()
    return this.get<CalendarWindow>(`/api/calendar?${query}`)
  }

  scheduleTask(
    taskId: string,
    scheduledFor: string,
    timezone: string,
    recurrence: TaskRecurrence
  ): Observable<TaskSchedule> {
    return this.unwrap(this.http.put<ApiEnvelope<TaskSchedule>>(
      `/api/tasks/${taskId}/schedule`,
      { scheduledFor, timezone, recurrence },
      { headers: this.headers }
    ))
  }

  deleteTaskSchedule(id: string): Observable<void> {
    return this.http.delete<void>(`/api/calendar/schedules/${id}`, { headers: this.headers })
  }

  demoActors(): Observable<MemoryActor[]> {
    return this.get<MemoryActor[]>('/api/demo/actors')
  }

  capabilities(): Observable<CapabilitySummary[]> {
    return this.get<CapabilitySummary[]>('/api/capabilities')
  }

  capability(id: string): Observable<CapabilityDetail> {
    return this.get<CapabilityDetail>(`/api/capabilities/${id}`)
  }

  installCapability(id: string): Observable<CapabilityInstallation> {
    return this.unwrap(this.http.post<ApiEnvelope<CapabilityInstallation>>(
      `/api/capabilities/${id}/install`,
      {},
      { headers: this.headers }
    ))
  }

  runCapability(id: string, request: CapabilityRunRequest): Observable<CapabilityRun> {
    return this.unwrap(this.http.post<ApiEnvelope<CapabilityRun>>(
      `/api/capabilities/${id}/runs`,
      request,
      { headers: this.headers }
    ))
  }

  capabilityRuns(id: string): Observable<CapabilityRun[]> {
    return this.get<CapabilityRun[]>(`/api/capabilities/${id}/runs`)
  }

  capabilityRun(id: string): Observable<CapabilityRun> {
    return this.get<CapabilityRun>(`/api/runs/${id}`)
  }

  memorySearch(query: string): Observable<MemorySearchResponse> {
    return this.get<MemorySearchResponse>(`/api/memory/search?q=${encodeURIComponent(query)}`)
  }

  memoryRecommendations(context: string): Observable<MemoryRecommendation[]> {
    return this.get<MemoryRecommendation[]>(`/api/memory/recommendations?context=${encodeURIComponent(context)}`)
  }

  memoryAnalytics(): Observable<MemoryAnalytics> {
    return this.get<MemoryAnalytics>('/api/memory/analytics')
  }

  message(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const payload = error.error as ApiEnvelope<unknown> | undefined
      return payload?.errors?.[0]?.message ?? `Request failed (${error.status || 'network'})`
    }
    return error instanceof Error ? error.message : 'Something went wrong'
  }

  private get<T>(url: string): Observable<T> {
    return this.unwrap(this.http.get<ApiEnvelope<T>>(url, { headers: this.headers }))
  }

  private unwrap<T>(source: Observable<ApiEnvelope<T>>): Observable<T> {
    return source.pipe(map((response) => {
      if (!response.success || response.data === undefined) {
        throw new Error(response.errors?.[0]?.message ?? 'The API returned an invalid response')
      }
      return response.data
    }))
  }
}
