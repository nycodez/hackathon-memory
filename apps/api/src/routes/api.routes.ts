import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { query } from '../db/pool.js'
import ConversationsRepository from '../repositories/conversations_repository.js'
import DocumentsRepository from '../repositories/documents_repository.js'
import ChatService from '../services/chat_service.js'
import IngestionService from '../services/ingestion_service.js'
import { VECTOR_DIMENSIONS } from '../services/vector_service.js'
import { workspaceId } from '../services/workspace_service.js'

const router = Router()
const documents = new DocumentsRepository()
const conversations = new ConversationsRepository()
const ingestion = new IngestionService(documents)
const chat = new ChatService(conversations, documents)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
})

const idSchema = z.string().uuid()
const askSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(8_000),
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

router.get('/dashboard', async (req, res) => {
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
})

router.get('/conversations', async (req, res) => {
  res.json({ success: true, data: await conversations.list(workspaceId(req)) })
})

router.get('/conversations/:id', async (req, res) => {
  const parsed = idSchema.safeParse(req.params.id)
  if (!parsed.success) return res.status(400).json(validationError('id', 'A valid conversation ID is required'))
  const conversation = await conversations.get(workspaceId(req), parsed.data)
  if (!conversation) return res.status(404).json(notFound('conversation'))
  return res.json({ success: true, data: conversation })
})

router.post('/query', async (req, res) => {
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
})

router.get('/documents', async (req, res) => {
  res.json({ success: true, data: await documents.list(workspaceId(req)) })
})

router.post('/documents', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json(validationError('file', 'Choose one file to upload'))
  const document = await documents.ingest(workspaceId(req), req.file)
  return res.status(202).json({ success: true, data: document })
})

router.post('/documents/:id/process', async (req, res) => {
  const parsed = idSchema.safeParse(req.params.id)
  if (!parsed.success) return res.status(400).json(validationError('id', 'A valid document ID is required'))
  const document = await ingestion.process(workspaceId(req), parsed.data)
  if (!document) return res.status(404).json(notFound('document'))
  return res.json({ success: true, data: document })
})

router.delete('/documents/:id', async (req, res) => {
  const parsed = idSchema.safeParse(req.params.id)
  if (!parsed.success) return res.status(400).json(validationError('id', 'A valid document ID is required'))
  const removed = await documents.remove(workspaceId(req), parsed.data)
  if (!removed) return res.status(404).json(notFound('document'))
  return res.status(204).send()
})

function validationError(field: string, message: string) {
  return { success: false, errors: [{ rule: 'validation', field, message }] }
}

function notFound(field: string) {
  return { success: false, errors: [{ rule: 'not_found', field, message: `${field} was not found` }] }
}

export default router

