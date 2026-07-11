import type { ChatMessage, Citation, Conversation, ConversationSummary } from '@hackathon/shared'
import type { QueryResultRow } from 'pg'
import { query, transaction } from '../db/pool.js'

interface ConversationRow extends QueryResultRow {
  id: string
  title: string
  preview: string | null
  message_count: string | number
  created_at: Date
  updated_at: Date
}

interface MessageRow extends QueryResultRow {
  id: string
  role: ChatMessage['role']
  content: string
  citations: unknown
  created_at: Date
}

export default class ConversationsRepository {
  async list(workspaceId: string): Promise<ConversationSummary[]> {
    const result = await query<ConversationRow>(
      `SELECT s.id, s.title, s.created_at, s.updated_at,
              count(m.id)::int AS message_count,
              coalesce(
                (array_agg(m.content ORDER BY m.created_at DESC) FILTER (WHERE m.role = 'assistant'))[1],
                (array_agg(m.content ORDER BY m.created_at DESC))[1],
                ''
              ) AS preview
       FROM conversation_sessions s
       LEFT JOIN conversation_messages m ON m.conversation_id = s.id
       WHERE s.workspace_id = $1
       GROUP BY s.id
       ORDER BY s.updated_at DESC`,
      [workspaceId]
    )
    return result.rows.map(mapSummary)
  }

  async get(workspaceId: string, id: string): Promise<Conversation | null> {
    const sessionResult = await query<ConversationRow>(
      `SELECT s.id, s.title, s.created_at, s.updated_at, count(m.id)::int AS message_count,
              coalesce((array_agg(m.content ORDER BY m.created_at DESC))[1], '') AS preview
       FROM conversation_sessions s
       LEFT JOIN conversation_messages m ON m.conversation_id = s.id
       WHERE s.workspace_id = $1 AND s.id = $2
       GROUP BY s.id`,
      [workspaceId, id]
    )
    const session = sessionResult.rows[0]
    if (!session) return null
    const messages = await query<MessageRow>(
      `SELECT id, role, content, citations, created_at
       FROM conversation_messages
       WHERE workspace_id = $1 AND conversation_id = $2
       ORDER BY created_at`,
      [workspaceId, id]
    )
    return { ...mapSummary(session), messages: messages.rows.map(mapMessage) }
  }

  async create(workspaceId: string, firstMessage: string): Promise<string> {
    const title = firstMessage.replace(/\s+/g, ' ').trim().slice(0, 72) || 'New conversation'
    const result = await query<{ id: string }>(
      'INSERT INTO conversation_sessions (workspace_id, title) VALUES ($1, $2) RETURNING id',
      [workspaceId, title]
    )
    const id = result.rows[0]?.id
    if (!id) throw new Error('Conversation could not be created')
    return id
  }

  async addExchange(
    workspaceId: string,
    conversationId: string,
    userContent: string,
    assistantContent: string,
    citations: Citation[]
  ): Promise<ChatMessage> {
    return transaction(async (client) => {
      const ownsSession = await client.query(
        'SELECT id FROM conversation_sessions WHERE workspace_id = $1 AND id = $2 FOR UPDATE',
        [workspaceId, conversationId]
      )
      if (!ownsSession.rowCount) throw new Error('Conversation not found')
      await client.query(
        `INSERT INTO conversation_messages (workspace_id, conversation_id, role, content)
         VALUES ($1, $2, 'user', $3)`,
        [workspaceId, conversationId, userContent]
      )
      const result = await client.query<MessageRow>(
        `INSERT INTO conversation_messages (workspace_id, conversation_id, role, content, citations)
         VALUES ($1, $2, 'assistant', $3, $4)
         RETURNING id, role, content, citations, created_at`,
        [workspaceId, conversationId, assistantContent, JSON.stringify(citations)]
      )
      await client.query('UPDATE conversation_sessions SET updated_at = now() WHERE id = $1', [conversationId])
      const message = result.rows[0]
      if (!message) throw new Error('Assistant message could not be stored')
      return mapMessage(message)
    })
  }
}

function mapSummary(row: ConversationRow): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    preview: row.preview ?? '',
    messageCount: Number(row.message_count),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function mapMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    citations: Array.isArray(row.citations) ? (row.citations as Citation[]) : [],
    createdAt: row.created_at.toISOString(),
  }
}
