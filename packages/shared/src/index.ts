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
