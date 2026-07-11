export type DocumentStatus =
  | 'ingested'
  | 'extracting'
  | 'needs_ocr'
  | 'summarizing'
  | 'vectorizing'
  | 'ready'
  | 'failed'

export interface ApiEnvelope<T> {
  success: boolean
  data?: T
  errors?: Array<{ rule: string; field: string; message: string }>
}

export interface HealthSummary {
  service: string
  status: 'ok' | 'degraded'
  database: 'connected' | 'unavailable'
  vectorDimensions: number
  now: string
}

export interface DashboardSummary {
  documents: number
  readyDocuments: number
  conversations: number
  messages: number
}

export interface Citation {
  label: string
  documentId: string
  documentName: string
  chunkId: string
  excerpt: string
  score: number
}

export type DecisionTraceStage = 'input' | 'analysis' | 'embedding' | 'retrieval' | 'selection' | 'response'
export type DecisionTraceOutcome = 'accepted' | 'completed' | 'no_match' | 'guardrail' | 'error'

export interface DecisionTraceEvent {
  id: string
  stage: DecisionTraceStage
  title: string
  detail: string
  outcome: DecisionTraceOutcome
  createdAt: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: Citation[]
  decisionTrace: DecisionTraceEvent[]
  createdAt: string
}

export interface ConversationSummary {
  id: string
  title: string
  preview: string
  messageCount: number
  createdAt: string
  updatedAt: string
}

export interface Conversation extends ConversationSummary {
  messages: ChatMessage[]
}

export interface KnowledgeDocument {
  id: string
  folderId: string | null
  name: string
  mimeType: string
  sizeBytes: number
  status: DocumentStatus
  summary: string | null
  requiresOcr: boolean
  chunkCount: number
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

export interface LibraryFolder {
  id: string
  parentId: string | null
  name: string
  createdAt: string
}

export interface LibraryListing {
  currentFolder: LibraryFolder | null
  breadcrumbs: LibraryFolder[]
  folders: LibraryFolder[]
  documents: KnowledgeDocument[]
}

export interface AskResult {
  conversation: Conversation
  message: ChatMessage
}

export type SkillKind = 'office' | 'accounting'

export interface AtomicSkill {
  code: string
  name: string
  description: string
  inputs: string[]
  kind: SkillKind
}

export interface SkillGroup {
  code: string
  name: string
  description: string
  kind: SkillKind
  skills: AtomicSkill[]
}

export interface TaskTemplate {
  code: string
  name: string
  description: string
  skills: AtomicSkill[]
}

export interface MemorizedTask {
  id: string
  name: string
  description: string
  skills: AtomicSkill[]
  createdAt: string
  updatedAt: string
}

export interface TaskWorkspace {
  skillGroups: SkillGroup[]
  templates: TaskTemplate[]
  tasks: MemorizedTask[]
}

export type TaskRecurrence = 'once' | 'daily' | 'weekly' | 'monthly'

export interface TaskSchedule {
  id: string
  taskId: string
  taskName: string
  scheduledFor: string
  timezone: string
  recurrence: TaskRecurrence
  createdAt: string
  updatedAt: string
}

export interface TaskOccurrence {
  scheduleId: string
  taskId: string
  taskName: string
  scheduledFor: string
  timezone: string
  recurrence: TaskRecurrence
}

export interface CalendarWindow {
  from: string
  to: string
  schedules: TaskSchedule[]
  occurrences: TaskOccurrence[]
}

export type MemoryActorStatus = 'active' | 'departed'

export interface MemoryActor {
  id: string
  slug: string
  name: string
  title: string
  email: string
  status: MemoryActorStatus
  isDemo: boolean
}

export type CapabilityStatus = 'active' | 'archived'
export type CapabilityPermissionLevel = 'view' | 'run' | 'steward'

export interface CapabilityCitation {
  label: string
  sourceId: string
  sourceName: string
  excerpt: string
  uri: string | null
}

export interface CapabilityProvenance {
  id: string
  sourceType: 'document' | 'decision_log' | 'interview' | 'run'
  assetKind: MemoryAssetKind
  sourceName: string
  excerpt: string
  uri: string | null
  capturedAt: string
  capturedBy: MemoryActor | null
}

export interface CapabilityStep {
  id: string
  position: number
  skillCode: string
  name: string
  description: string
  runnable: boolean
  configuration: Record<string, unknown>
}

export interface CapabilityVersion {
  id: string
  version: number
  changeSummary: string
  createdAt: string
  createdBy: MemoryActor
  steps: CapabilityStep[]
}

export interface CapabilitySummary {
  id: string
  slug: string
  name: string
  description: string
  status: CapabilityStatus
  owner: MemoryActor
  steward: MemoryActor
  activeVersion: number
  skillCount: number
  runCount: number
  lastRunAt: string | null
  canRun: boolean
}

export interface CapabilityDetail extends CapabilitySummary {
  version: CapabilityVersion
  provenance: CapabilityProvenance[]
  permission: CapabilityPermissionLevel | null
}

export type CapabilityRunStatus = 'running' | 'succeeded' | 'failed' | 'denied'
export type CapabilityRunStepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'

export interface CapabilityDecision {
  code: string
  outcome: 'proceed' | 'skip' | 'escalate' | 'deny'
  explanation: string
}

export interface CapabilityRunStep {
  id: string
  position: number
  skillCode: string
  name: string
  status: CapabilityRunStepStatus
  input: Record<string, unknown>
  output: Record<string, unknown>
  citations: CapabilityCitation[]
  decisions: CapabilityDecision[]
  startedAt: string | null
  completedAt: string | null
  errorMessage: string | null
}

export interface CapabilityRun {
  id: string
  capabilityId: string
  capabilityName: string
  capabilityVersionId: string
  version: number
  actor: MemoryActor
  status: CapabilityRunStatus
  idempotencyKey: string
  input: Record<string, unknown>
  output: Record<string, unknown>
  summary: string
  citations: CapabilityCitation[]
  decisions: CapabilityDecision[]
  steps: CapabilityRunStep[]
  startedAt: string
  completedAt: string | null
}

export interface CapabilityRunRequest {
  idempotencyKey: string
  asOfDate?: string
}

export interface CapabilityInstallation {
  task: MemorizedTask
  capabilityVersionId: string
}

export type MemoryAssetKind = 'prompt' | 'workflow' | 'agent' | 'decision' | 'best_practice'
export type MemorySearchResultType = 'capability' | 'task' | 'skill' | MemoryAssetKind

export interface MemorySearchResult {
  id: string
  type: MemorySearchResultType
  name: string
  description: string
  href: string
  detail: string
}

export interface MemorySearchResponse {
  query: string
  results: MemorySearchResult[]
}

export interface MemoryRecommendation {
  id: string
  type: 'reuse' | 'related' | 'governance'
  title: string
  rationale: string
  capabilityId: string
  capabilityName: string
  href: string
  confidence: number
}

export interface MemoryAnalytics {
  capabilityCount: number
  activeCapabilityCount: number
  versionCount: number
  runnableSkillCount: number
  runCount: number
  succeededRunCount: number
  uniqueSkillCount: number
  duplicatedSkills: Array<{
    skillCode: string
    name: string
    capabilityCount: number
  }>
  missingCapabilities: Array<{
    code: string
    name: string
    reason: string
  }>
  growth: Array<{
    month: string
    capabilities: number
    runs: number
  }>
}
