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
  vector: 'available' | 'unavailable'
  indexedDocuments: number
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

export type CapabilityType = 'workflow' | 'prompt' | 'agent' | 'skill' | 'decision' | 'outcome'
export type CapabilityClassification = 'public' | 'internal' | 'confidential' | 'restricted'
export type CapabilityStatus = 'active' | 'archived'

export interface DemoActor {
  id: string
  name: string
  role: string
  teamId: string
  teamName: string
  department: string
  status: 'active' | 'departed'
  clearance: CapabilityClassification
}

export interface CapabilityAsset {
  id: string
  assetKey: string
  type: CapabilityType
  title: string
  summary: string
  classification: CapabilityClassification
  ownerTeamId: string
  ownerTeamName: string
  status: CapabilityStatus
  currentVersion: string
  currentSteward: string | null
  outcomeScore: number
  usageCount: number
  lastUsedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CapabilityCitation extends Citation {
  relationship: 'primary_artifact' | 'evidence' | 'instructions' | 'example' | 'decision_context'
}

export interface CapabilityVersion {
  id: string
  version: string
  changeNotes: string
  createdBy: string
  approvedBy: string | null
  createdAt: string
}

export interface CapabilityEdge {
  edgeType: 'AUTHORED_BY' | 'STEWARDED_BY' | 'DEPENDS_ON' | 'DERIVED_FROM' | 'APPROVED_BY' | 'PRODUCED_OUTCOME'
  targetKey: string
  targetLabel: string
  evidence: string
  createdAt: string
}

export interface CapabilityDecision {
  id: string
  decision: string
  rationale: string
  decidedBy: string
  decidedAt: string
}

export interface CapabilityOutcome {
  id: string
  metricName: string
  value: number
  unit: string
  measuredAt: string
}

export interface CapabilityAssetDetail extends CapabilityAsset {
  rationale: string
  content: string
  governance: { decision: 'allow'; reason: string }
  versions: CapabilityVersion[]
  provenance: CapabilityEdge[]
  decisions: CapabilityDecision[]
  outcomes: CapabilityOutcome[]
  citations: CapabilityCitation[]
  installation: CapabilityInstallation | null
}

export interface CapabilitySearchResult {
  asset: CapabilityAsset | null
  locked: boolean
  lockedMetadata?: {
    assetKey: string
    title: string
    type: CapabilityType
    classification: CapabilityClassification
  }
  score: number
  reasons: string[]
  citations: CapabilityCitation[]
}

export interface CapabilityRecommendation extends CapabilitySearchResult {
  explanation: string
}

export interface CapabilitySummary {
  assets: number
  activePeople: number
  departedPeople: number
  stewardshipTransfers: number
  runnableSkills: number
  installations: number
  runs: number
}

export interface CapabilityInstallation {
  id: string
  assetKey: string
  version: string
  actorId: string
  installedAt: string
}

export interface CapabilitySkillRun {
  id: string
  assetKey: string
  version: string
  actorId: string
  status: 'completed' | 'blocked' | 'failed'
  input: Record<string, string | number | boolean>
  output: Record<string, string | number | boolean>
  provenancePath: string[]
  createdAt: string
}

export interface CreateCapabilityInput {
  requestId: string
  type: CapabilityType
  title: string
  summary: string
  content: string
  rationale: string
  classification: CapabilityClassification
  ownerTeamId: string
  version?: string
  changeNotes?: string
}

export interface SearchCapabilitiesInput {
  query: string
  type?: CapabilityType
  classification?: CapabilityClassification
  ownerTeamId?: string
  includeLocked?: boolean
  limit?: number
}

export interface RecommendCapabilitiesInput {
  task: string
  limit?: number
}

export interface RunCapabilityInput {
  portfolioName: string
  periodStart: string
  periodEnd: string
  atRiskCount: number
  ownerAskCount: number
}

export interface CapabilityDepartureScenario {
  passed: boolean
  discoverable: boolean
  stewardshipAccepted: boolean
  runnable: boolean
  authorshipIntact: boolean
  outputDigest: string
  provenancePath: string[]
}
