import { Router, type Request, type RequestHandler, type Response } from 'express'
import { timingSafeEqual } from 'node:crypto'
import multer from 'multer'
import { z } from 'zod'
import { query } from '../db/pool.js'
import CalendarRepository from '../repositories/calendar_repository.js'
import CapabilitiesRepository from '../repositories/capabilities_repository.js'
import ConversationsRepository from '../repositories/conversations_repository.js'
import DocumentsRepository from '../repositories/documents_repository.js'
import LibraryRepository from '../repositories/library_repository.js'
import TasksRepository from '../repositories/tasks_repository.js'
import ChatService from '../services/chat_service.js'
import CapabilityRunnerService, { CapabilityRunDeniedError } from '../services/capability_runner_service.js'
import IngestionService from '../services/ingestion_service.js'
import MemorySeedService from '../services/memory_seed_service.js'
import { applyPendingMigrations } from '../services/migration_service.js'
import { knownSkillCodes, taskSkillGroups, taskTemplates } from '../services/task_catalog.js'
import { VECTOR_DIMENSIONS } from '../services/vector_service.js'
import { workspaceId } from '../services/workspace_service.js'

const router = Router()
const documents = new DocumentsRepository()
const library = new LibraryRepository(documents)
const conversations = new ConversationsRepository()
const ingestion = new IngestionService(documents)
const chat = new ChatService(conversations, documents)
const tasks = new TasksRepository()
const calendar = new CalendarRepository()
const capabilities = new CapabilitiesRepository()
const capabilityRunner = new CapabilityRunnerService()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
})

const idSchema = z.string().uuid()
const askSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(8_000),
})
const optionalFolderIdSchema = z.preprocess(
  (value) => value === '' || value === undefined ? null : value,
  z.string().uuid().nullable()
)
const createFolderSchema = z.object({
  name: z.string().trim().min(1).max(80),
  parentId: optionalFolderIdSchema.optional().default(null),
})
const createTaskSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional().default(''),
  skillCodes: z.array(z.string().trim().min(1).max(80)).min(1).max(30)
    .refine((codes) => new Set(codes).size === codes.length, 'A skill can only appear once in a task'),
})
const calendarWindowSchema = z.object({
  from: z.string().datetime({ offset: true }).transform((value) => new Date(value)),
  to: z.string().datetime({ offset: true }).transform((value) => new Date(value)),
}).refine(({ from, to }) => to.getTime() > from.getTime(), {
  message: 'Calendar end must be after its start',
}).refine(({ from, to }) => to.getTime() - from.getTime() <= 93 * 24 * 60 * 60 * 1_000, {
  message: 'Calendar windows cannot exceed 93 days',
})
const taskScheduleSchema = z.object({
  scheduledFor: z.string().datetime({ offset: true }).transform((value) => new Date(value)),
  timezone: z.string().trim().min(1).max(80),
  recurrence: z.enum(['once', 'daily', 'weekly', 'monthly']),
})

router.post('/admin/memory-bootstrap', asyncRoute(async (req, res) => {
  if (!validBootstrapToken(req.get('x-bootstrap-token'))) return res.status(404).json(notFound('route'))
  const appliedMigrations = await applyPendingMigrations()
  await new MemorySeedService().seed(workspaceId(req))
  return res.json({ success: true, data: { appliedMigrations, seeded: true } })
}))
const capabilityRunSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(120),
  asOfDate: z.string().date().optional(),
})
const memorySearchSchema = z.object({
  q: z.string().trim().max(120).optional().default(''),
})
const recommendationSchema = z.object({
  context: z.string().trim().max(500).optional().default(''),
})

router.get('/health', async (_req, res) => {
  try {
    await query('SELECT 1')
    res.json({ success: true, data: {
      service: 'hackathon-framework',
      status: 'ok',
      database: 'connected',
      vectorDimensions: VECTOR_DIMENSIONS,
      now: new Date().toISOString(),
    } })
  } catch {
    res.status(503).json({ success: false, data: {
      service: 'hackathon-framework',
      status: 'degraded',
      database: 'unavailable',
      vectorDimensions: VECTOR_DIMENSIONS,
      now: new Date().toISOString(),
    } })
  }
})

router.get('/dashboard', asyncRoute(async (req, res) => {
  const workspace = workspaceId(req)
  const result = await query<{
    documents: number
    ready_documents: number
    conversations: number
    messages: number
  }>(
    `SELECT
       (SELECT count(*)::int FROM knowledge_documents WHERE workspace_id = $1) AS documents,
       (SELECT count(*)::int FROM knowledge_documents WHERE workspace_id = $1 AND status = 'ready') AS ready_documents,
       (SELECT count(*)::int FROM conversation_sessions WHERE workspace_id = $1) AS conversations,
       (SELECT count(*)::int FROM conversation_messages WHERE workspace_id = $1) AS messages`,
    [workspace]
  )
  const row = result.rows[0]
  res.json({ success: true, data: {
    documents: Number(row?.documents ?? 0),
    readyDocuments: Number(row?.ready_documents ?? 0),
    conversations: Number(row?.conversations ?? 0),
    messages: Number(row?.messages ?? 0),
  } })
}))

router.get('/conversations', asyncRoute(async (req, res) => {
  res.json({ success: true, data: await conversations.list(workspaceId(req)) })
}))

router.get('/conversations/:id', asyncRoute(async (req, res) => {
  const parsed = idSchema.safeParse(req.params.id)
  if (!parsed.success) return res.status(400).json(validationError('id', 'A valid conversation ID is required'))
  const conversation = await conversations.get(workspaceId(req), parsed.data)
  if (!conversation) return res.status(404).json(notFound('conversation'))
  return res.json({ success: true, data: conversation })
}))

router.delete('/conversations/:id', asyncRoute(async (req, res) => {
  const parsed = idSchema.safeParse(req.params.id)
  if (!parsed.success) return res.status(400).json(validationError('id', 'A valid conversation ID is required'))
  const removed = await conversations.remove(workspaceId(req), parsed.data)
  if (!removed) return res.status(404).json(notFound('conversation'))
  return res.status(204).send()
}))

router.post('/query', asyncRoute(async (req, res) => {
  const parsed = askSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json(validationError('message', parsed.error.issues[0]?.message ?? 'Invalid query'))
  try {
    const result = await chat.ask(workspaceId(req), parsed.data.message, parsed.data.conversationId)
    return res.status(parsed.data.conversationId ? 200 : 201).json({ success: true, data: result })
  } catch (error) {
    if (error instanceof Error && error.message === 'Conversation not found') {
      return res.status(404).json(notFound('conversation'))
    }
    throw error
  }
}))

router.get('/documents', asyncRoute(async (req, res) => {
  res.json({ success: true, data: await documents.list(workspaceId(req)) })
}))

router.get('/tasks', asyncRoute(async (req, res) => {
  res.json({ success: true, data: {
    skillGroups: taskSkillGroups(),
    templates: taskTemplates(),
    tasks: await tasks.list(workspaceId(req)),
  } })
}))

router.get('/demo/actors', asyncRoute(async (req, res) => {
  return res.json({ success: true, data: await capabilities.actors(workspaceId(req)) })
}))

router.get('/capabilities', asyncRoute(async (req, res) => {
  return res.json({
    success: true,
    data: await capabilities.list(workspaceId(req), optionalActorId(req)),
  })
}))

router.get('/capabilities/:id', asyncRoute(async (req, res) => {
  const id = idSchema.safeParse(req.params.id)
  if (!id.success) return res.status(400).json(validationError('id', 'A valid capability ID is required'))
  const capability = await capabilities.get(workspaceId(req), id.data, optionalActorId(req))
  if (!capability) return res.status(404).json(notFound('capability'))
  return res.json({ success: true, data: capability })
}))

router.post('/capabilities/:id/install', asyncRoute(async (req, res) => {
  const id = idSchema.safeParse(req.params.id)
  if (!id.success) return res.status(400).json(validationError('id', 'A valid capability ID is required'))
  const installation = await capabilities.install(workspaceId(req), id.data)
  if (!installation) return res.status(404).json(notFound('capability'))
  return res.status(201).json({ success: true, data: installation })
}))

router.post('/capabilities/:id/runs', asyncRoute(async (req, res) => {
  const id = idSchema.safeParse(req.params.id)
  if (!id.success) return res.status(400).json(validationError('id', 'A valid capability ID is required'))
  const actorId = requiredActorId(req)
  if (!actorId) return res.status(400).json(validationError('x-actor-id', 'A valid x-actor-id header is required'))
  const parsed = capabilityRunSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json(validationError('run', parsed.error.issues[0]?.message ?? 'Invalid capability run'))
  }
  try {
    const run = await capabilityRunner.run(workspaceId(req), id.data, actorId, parsed.data)
    return res.status(201).json({ success: true, data: run })
  } catch (error) {
    if (error instanceof CapabilityRunDeniedError) {
      return res.status(403).json({
        success: false,
        errors: [{ rule: 'permission', field: 'actor', message: error.message }],
      })
    }
    if (error instanceof Error && error.message === 'Capability not found') {
      return res.status(404).json(notFound('capability'))
    }
    throw error
  }
}))

router.get('/capabilities/:id/runs', asyncRoute(async (req, res) => {
  const id = idSchema.safeParse(req.params.id)
  if (!id.success) return res.status(400).json(validationError('id', 'A valid capability ID is required'))
  const capability = await capabilities.get(workspaceId(req), id.data, optionalActorId(req))
  if (!capability) return res.status(404).json(notFound('capability'))
  return res.json({ success: true, data: await capabilities.runs(workspaceId(req), id.data) })
}))

router.get('/runs/:id', asyncRoute(async (req, res) => {
  const id = idSchema.safeParse(req.params.id)
  if (!id.success) return res.status(400).json(validationError('id', 'A valid run ID is required'))
  const run = await capabilities.run(workspaceId(req), id.data)
  if (!run) return res.status(404).json(notFound('run'))
  return res.json({ success: true, data: run })
}))

router.get('/memory/search', asyncRoute(async (req, res) => {
  const parsed = memorySearchSchema.safeParse(req.query)
  if (!parsed.success) return res.status(400).json(validationError('q', 'Search cannot exceed 120 characters'))
  return res.json({ success: true, data: await capabilities.search(workspaceId(req), parsed.data.q) })
}))

router.get('/memory/recommendations', asyncRoute(async (req, res) => {
  const parsed = recommendationSchema.safeParse(req.query)
  if (!parsed.success) return res.status(400).json(validationError('context', 'Context cannot exceed 500 characters'))
  return res.json({ success: true, data: await capabilities.recommendations(workspaceId(req), parsed.data.context) })
}))

router.get('/memory/analytics', asyncRoute(async (req, res) => {
  return res.json({ success: true, data: await capabilities.analytics(workspaceId(req)) })
}))

router.post('/tasks', asyncRoute(async (req, res) => {
  const parsed = createTaskSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json(validationError('task', parsed.error.issues[0]?.message ?? 'Invalid task'))
  }
  const knownCodes = knownSkillCodes()
  const unknownCode = parsed.data.skillCodes.find((code) => !knownCodes.has(code))
  if (unknownCode) return res.status(400).json(validationError('skillCodes', `Unknown skill: ${unknownCode}`))
  try {
    const task = await tasks.create(
      workspaceId(req),
      parsed.data.name,
      parsed.data.description,
      parsed.data.skillCodes
    )
    return res.status(201).json({ success: true, data: task })
  } catch (error) {
    if (error instanceof Error && error.message === 'A task with this name already exists') {
      return res.status(409).json({ success: false, errors: [{ rule: 'unique', field: 'name', message: error.message }] })
    }
    throw error
  }
}))

router.put('/tasks/:id', asyncRoute(async (req, res) => {
  const id = idSchema.safeParse(req.params.id)
  if (!id.success) return res.status(400).json(validationError('id', 'A valid task ID is required'))
  const parsed = createTaskSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json(validationError('task', parsed.error.issues[0]?.message ?? 'Invalid task'))
  }
  const knownCodes = knownSkillCodes()
  const unknownCode = parsed.data.skillCodes.find((code) => !knownCodes.has(code))
  if (unknownCode) return res.status(400).json(validationError('skillCodes', `Unknown skill: ${unknownCode}`))
  try {
    const task = await tasks.update(
      workspaceId(req),
      id.data,
      parsed.data.name,
      parsed.data.description,
      parsed.data.skillCodes
    )
    if (!task) return res.status(404).json(notFound('task'))
    return res.json({ success: true, data: task })
  } catch (error) {
    if (error instanceof Error && error.message === 'A task with this name already exists') {
      return res.status(409).json({ success: false, errors: [{ rule: 'unique', field: 'name', message: error.message }] })
    }
    throw error
  }
}))

router.delete('/tasks/:id', asyncRoute(async (req, res) => {
  const parsed = idSchema.safeParse(req.params.id)
  if (!parsed.success) return res.status(400).json(validationError('id', 'A valid task ID is required'))
  const removed = await tasks.remove(workspaceId(req), parsed.data)
  if (!removed) return res.status(404).json(notFound('task'))
  return res.status(204).send()
}))

router.get('/calendar', asyncRoute(async (req, res) => {
  const parsed = calendarWindowSchema.safeParse(req.query)
  if (!parsed.success) {
    return res.status(400).json(validationError('calendar', parsed.error.issues[0]?.message ?? 'Invalid calendar window'))
  }
  return res.json({
    success: true,
    data: await calendar.window(workspaceId(req), parsed.data.from, parsed.data.to),
  })
}))

router.put('/tasks/:id/schedule', asyncRoute(async (req, res) => {
  const id = idSchema.safeParse(req.params.id)
  if (!id.success) return res.status(400).json(validationError('id', 'A valid task ID is required'))
  const parsed = taskScheduleSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json(validationError('schedule', parsed.error.issues[0]?.message ?? 'Invalid task schedule'))
  }
  const schedule = await calendar.upsert(
    workspaceId(req),
    id.data,
    parsed.data.scheduledFor,
    parsed.data.timezone,
    parsed.data.recurrence
  )
  if (!schedule) return res.status(404).json(notFound('task'))
  return res.json({ success: true, data: schedule })
}))

router.delete('/calendar/schedules/:id', asyncRoute(async (req, res) => {
  const parsed = idSchema.safeParse(req.params.id)
  if (!parsed.success) return res.status(400).json(validationError('id', 'A valid schedule ID is required'))
  const removed = await calendar.remove(workspaceId(req), parsed.data)
  if (!removed) return res.status(404).json(notFound('schedule'))
  return res.status(204).send()
}))

router.get('/documents/:id/content', asyncRoute(async (req, res) => {
  const parsed = idSchema.safeParse(req.params.id)
  if (!parsed.success) return res.status(400).json(validationError('id', 'A valid document ID is required'))
  const document = await documents.get(workspaceId(req), parsed.data)
  if (!document) return res.status(404).json(notFound('document'))

  const previewType = documentPreviewType(document.name, document.mimeType)
  if (!previewType) {
    return res.status(415).json({
      success: false,
      errors: [{ rule: 'unsupported_type', field: 'document', message: 'Preview is available for PDF, image, Markdown, and text files' }],
    })
  }

  res.set({
    'Cache-Control': 'private, no-store',
    'Content-Type': previewContentType(previewType, document.name, document.mimeType),
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
  })
  return res.send(document.rawData)
}))

router.get('/library', asyncRoute(async (req, res) => {
  const parsed = optionalFolderIdSchema.safeParse(req.query.folderId)
  if (!parsed.success) return res.status(400).json(validationError('folderId', 'A valid folder ID is required'))
  const listing = await library.list(workspaceId(req), parsed.data)
  if (!listing) return res.status(404).json(notFound('folder'))
  return res.json({ success: true, data: listing })
}))

router.post('/library/folders', asyncRoute(async (req, res) => {
  const parsed = createFolderSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json(validationError('folder', parsed.error.issues[0]?.message ?? 'Invalid folder'))
  try {
    const folder = await library.create(workspaceId(req), parsed.data.name, parsed.data.parentId)
    return res.status(201).json({ success: true, data: folder })
  } catch (error) {
    if (error instanceof Error && error.message === 'Folder not found') {
      return res.status(404).json(notFound('folder'))
    }
    if (error instanceof Error && error.message === 'A folder with this name already exists here') {
      return res.status(409).json({ success: false, errors: [{ rule: 'unique', field: 'name', message: error.message }] })
    }
    throw error
  }
}))

router.delete('/library/folders/:id', asyncRoute(async (req, res) => {
  const parsed = idSchema.safeParse(req.params.id)
  if (!parsed.success) return res.status(400).json(validationError('id', 'A valid folder ID is required'))
  const removed = await library.remove(workspaceId(req), parsed.data)
  if (!removed) return res.status(404).json(notFound('folder'))
  return res.status(204).send()
}))

router.post('/documents', upload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json(validationError('file', 'Choose one file to upload'))
  const parsed = optionalFolderIdSchema.safeParse(req.body.folderId)
  if (!parsed.success) return res.status(400).json(validationError('folderId', 'A valid folder ID is required'))
  try {
    const document = await documents.ingest(workspaceId(req), req.file, parsed.data)
    return res.status(202).json({ success: true, data: document })
  } catch (error) {
    if (error instanceof Error && error.message === 'Folder not found') {
      return res.status(404).json(notFound('folder'))
    }
    throw error
  }
}))

router.post('/documents/:id/process', asyncRoute(async (req, res) => {
  const parsed = idSchema.safeParse(req.params.id)
  if (!parsed.success) return res.status(400).json(validationError('id', 'A valid document ID is required'))
  const document = await ingestion.process(workspaceId(req), parsed.data)
  if (!document) return res.status(404).json(notFound('document'))
  return res.json({ success: true, data: document })
}))

router.delete('/documents/:id', asyncRoute(async (req, res) => {
  const parsed = idSchema.safeParse(req.params.id)
  if (!parsed.success) return res.status(400).json(validationError('id', 'A valid document ID is required'))
  const removed = await documents.remove(workspaceId(req), parsed.data)
  if (!removed) return res.status(404).json(notFound('document'))
  return res.status(204).send()
}))

function asyncRoute(handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    void handler(req, res).catch(next)
  }
}

function validationError(field: string, message: string) {
  return { success: false, errors: [{ rule: 'validation', field, message }] }
}

function notFound(field: string) {
  return { success: false, errors: [{ rule: 'not_found', field, message: `${field} was not found` }] }
}

function validBootstrapToken(provided: string | undefined): boolean {
  const expected = process.env.MEMORY_BOOTSTRAP_TOKEN?.trim()
  if (!expected || !provided) return false
  const expectedBuffer = Buffer.from(expected)
  const providedBuffer = Buffer.from(provided)
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer)
}

function optionalActorId(req: Request): string | null {
  const parsed = idSchema.safeParse(req.header('x-actor-id'))
  return parsed.success ? parsed.data : null
}

function requiredActorId(req: Request): string | null {
  return optionalActorId(req)
}

type DocumentPreviewType = 'pdf' | 'image' | 'markdown' | 'text'

function documentPreviewType(name: string, mimeType: string): DocumentPreviewType | null {
  const normalizedName = name.toLowerCase()
  const normalizedMimeType = mimeType.toLowerCase().split(';', 1)[0]?.trim()
  if (normalizedMimeType === 'application/pdf' || normalizedName.endsWith('.pdf')) return 'pdf'
  if (
    ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(normalizedMimeType ?? '') ||
    /\.(png|jpe?g|webp|gif)$/.test(normalizedName)
  ) return 'image'
  if (
    normalizedMimeType === 'text/markdown' ||
    normalizedName.endsWith('.md') ||
    normalizedName.endsWith('.markdown')
  ) return 'markdown'
  if (
    normalizedMimeType?.startsWith('text/') ||
    ['application/json', 'application/xml'].includes(normalizedMimeType ?? '') ||
    /\.(txt|csv|json|html?|xml)$/.test(normalizedName)
  ) return 'text'
  return null
}

function previewContentType(type: DocumentPreviewType, name: string, mimeType: string): string {
  if (type === 'pdf') return 'application/pdf'
  if (type === 'markdown') return 'text/markdown; charset=utf-8'
  if (type === 'text') return 'text/plain; charset=utf-8'

  const normalizedMimeType = mimeType.toLowerCase().split(';', 1)[0]?.trim()
  if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(normalizedMimeType ?? '')) {
    return normalizedMimeType ?? 'application/octet-stream'
  }
  const normalizedName = name.toLowerCase()
  if (normalizedName.endsWith('.png')) return 'image/png'
  if (/\.jpe?g$/.test(normalizedName)) return 'image/jpeg'
  if (normalizedName.endsWith('.webp')) return 'image/webp'
  return 'image/gif'
}

export default router
