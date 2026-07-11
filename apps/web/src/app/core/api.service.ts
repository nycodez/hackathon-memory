import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http'
import { Injectable } from '@angular/core'
import type {
  ApiEnvelope,
  AskResult,
  Conversation,
  ConversationSummary,
  DashboardSummary,
  HealthSummary,
  KnowledgeDocument,
} from '@hackathon/shared'
import { map, type Observable } from 'rxjs'

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly headers = new HttpHeaders({ 'x-workspace-id': 'hackathon-demo' })

  constructor(private readonly http: HttpClient) {}

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

  ask(message: string, conversationId?: string): Observable<AskResult> {
    return this.unwrap(this.http.post<ApiEnvelope<AskResult>>('/api/query', { message, conversationId }, { headers: this.headers }))
  }

  documents(): Observable<KnowledgeDocument[]> {
    return this.get<KnowledgeDocument[]>('/api/documents')
  }

  upload(file: File): Observable<KnowledgeDocument> {
    const form = new FormData()
    form.append('file', file)
    return this.unwrap(this.http.post<ApiEnvelope<KnowledgeDocument>>('/api/documents', form, { headers: this.headers }))
  }

  processDocument(id: string): Observable<KnowledgeDocument> {
    return this.unwrap(this.http.post<ApiEnvelope<KnowledgeDocument>>(`/api/documents/${id}/process`, {}, { headers: this.headers }))
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

