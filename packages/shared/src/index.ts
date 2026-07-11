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
  documentId: string
  documentName: string
  chunkId: string
  excerpt: string
  score: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: Citation[]
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

export interface AskResult {
  conversation: Conversation
  message: ChatMessage
}
