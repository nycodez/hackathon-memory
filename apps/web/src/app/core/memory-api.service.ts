import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http'
import { Injectable } from '@angular/core'
import type {
  ApiEnvelope,
  CapabilityAsset,
  CapabilityAssetDetail,
  CapabilityDepartureScenario,
  CapabilityInstallation,
  CapabilityRecommendation,
  CapabilitySearchResult,
  CapabilitySkillRun,
  CapabilitySummary,
  CreateCapabilityInput,
  DemoActor,
  RecommendCapabilitiesInput,
  RunCapabilityInput,
  SearchCapabilitiesInput,
} from '@hackathon/shared'
import { map, type Observable } from 'rxjs'

@Injectable({ providedIn: 'root' })
export class MemoryApiService {
  private readonly workspaceId = 'hackathon-demo'

  constructor(private readonly http: HttpClient) {}

  actors(): Observable<DemoActor[]> {
    return this.get<DemoActor[]>('/api/memory/actors')
  }

  summary(actorId: string): Observable<CapabilitySummary> {
    return this.get<CapabilitySummary>('/api/memory/summary', actorId)
  }

  departureScenario(actorId: string): Observable<CapabilityDepartureScenario> {
    return this.get<CapabilityDepartureScenario>('/api/memory/departure-scenario', actorId)
  }

  assets(actorId: string): Observable<CapabilityAsset[]> {
    return this.get<CapabilityAsset[]>('/api/memory/assets', actorId)
  }

  asset(assetKey: string, actorId: string): Observable<CapabilityAssetDetail> {
    return this.get<CapabilityAssetDetail>(`/api/memory/assets/${encodeURIComponent(assetKey)}`, actorId)
  }

  create(input: CreateCapabilityInput, actorId: string): Observable<CapabilityAsset> {
    return this.post<CapabilityAsset>('/api/memory/assets', input, actorId)
  }

  search(input: SearchCapabilitiesInput, actorId: string): Observable<CapabilitySearchResult[]> {
    return this.post<CapabilitySearchResult[]>('/api/memory/search', input, actorId)
  }

  recommendations(input: RecommendCapabilitiesInput, actorId: string): Observable<CapabilityRecommendation[]> {
    return this.post<CapabilityRecommendation[]>('/api/memory/recommendations', input, actorId)
  }

  install(assetKey: string, actorId: string): Observable<CapabilityInstallation> {
    return this.post<CapabilityInstallation>(`/api/memory/assets/${encodeURIComponent(assetKey)}/install`, {}, actorId)
  }

  run(assetKey: string, input: RunCapabilityInput, actorId: string): Observable<CapabilitySkillRun> {
    return this.post<CapabilitySkillRun>(`/api/memory/assets/${encodeURIComponent(assetKey)}/runs`, input, actorId)
  }

  runDetail(runId: string, actorId: string): Observable<CapabilitySkillRun> {
    return this.get<CapabilitySkillRun>(`/api/memory/runs/${encodeURIComponent(runId)}`, actorId)
  }

  message(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const payload = error.error as ApiEnvelope<unknown> | undefined
      return payload?.errors?.[0]?.message ?? `Request failed (${error.status || 'network'})`
    }
    return error instanceof Error ? error.message : 'Something went wrong'
  }

  private get<T>(url: string, actorId?: string): Observable<T> {
    return this.unwrap(this.http.get<ApiEnvelope<T>>(url, { headers: this.headers(actorId) }))
  }

  private post<T>(url: string, body: unknown, actorId: string): Observable<T> {
    return this.unwrap(this.http.post<ApiEnvelope<T>>(url, body, { headers: this.headers(actorId) }))
  }

  private headers(actorId?: string): HttpHeaders {
    let headers = new HttpHeaders({ 'x-workspace-id': this.workspaceId })
    if (actorId) headers = headers.set('x-demo-actor-id', actorId)
    return headers
  }

  private unwrap<T>(source: Observable<ApiEnvelope<T>>): Observable<T> {
    return source.pipe(map((response) => {
      if (!response.success || response.data === undefined) {
        throw new Error(response.errors?.[0]?.message ?? 'The memory API returned an invalid response')
      }
      return response.data
    }))
  }
}
