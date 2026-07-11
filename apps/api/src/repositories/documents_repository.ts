import { createHash } from 'node:crypto'
import type { KnowledgeDocument } from '@hackathon/shared'
import type { QueryResultRow } from 'pg'
import { query, transaction } from '../db/pool.js'
import { toVectorLiteral } from '../services/vector_service.js'

interface DocumentRow extends QueryResultRow {
  id: string
  name: string
  mime_type: string
  size_bytes: number
  raw_data?: Buffer
  status: KnowledgeDocument['status']
  summary: string | null
  requires_ocr: boolean
  chunk_count: string | number
  error_message: string | null
  created_at: Date
  updated_at: Date
}

interface SearchRow extends QueryResultRow {
  chunk_id: string
  document_id: string
  document_name: string
  content: string
  score: string | number
}

export interface SearchMatch {
  chunkId: string
  documentId: string
  documentName: string
  content: string
  score: number
}

export interface StoredDocument extends KnowledgeDocument {
  rawData: Buffer
}

const documentSelect = `
  SELECT d.id, d.name, d.mime_type, d.size_bytes, d.status, d.summary,
         d.requires_ocr, d.error_message, d.created_at, d.updated_at,
         count(c.id)::int AS chunk_count
  FROM knowledge_documents d
  LEFT JOIN document_chunks c ON c.document_id = d.id
`

export default class DocumentsRepository {
  async list(workspaceId: string): Promise<KnowledgeDocument[]> {
    const result = await query<DocumentRow>(
      `${documentSelect}
       WHERE d.workspace_id = $1
       GROUP BY d.id
       ORDER BY d.updated_at DESC`,
      [workspaceId]
    )
    return result.rows.map(mapDocument)
  }

  async ingest(workspaceId: string, file: Express.Multer.File): Promise<KnowledgeDocument> {
    const checksum = createHash('sha256').update(file.buffer).digest('hex')
    await query(
      `INSERT INTO knowledge_documents (
         workspace_id, name, mime_type, size_bytes, content_sha256, raw_data
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (workspace_id, content_sha256)
       DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
      [workspaceId, file.originalname, file.mimetype || 'application/octet-stream', file.size, checksum, file.buffer]
    )
    const result = await query<DocumentRow>(
      `${documentSelect}
       WHERE d.workspace_id = $1 AND d.content_sha256 = $2
       GROUP BY d.id`,
      [workspaceId, checksum]
    )
    return mapDocument(requiredRow(result.rows[0]))
  }

  async get(workspaceId: string, id: string): Promise<StoredDocument | null> {
    const result = await query<DocumentRow>(
      `SELECT d.*, count(c.id)::int AS chunk_count
       FROM knowledge_documents d
       LEFT JOIN document_chunks c ON c.document_id = d.id
       WHERE d.workspace_id = $1 AND d.id = $2
       GROUP BY d.id`,
      [workspaceId, id]
    )
    const row = result.rows[0]
    if (!row?.raw_data) return null
    return { ...mapDocument(row), rawData: row.raw_data }
  }

  async claimForProcessing(workspaceId: string, id: string): Promise<boolean> {
    const result = await query(
      `UPDATE knowledge_documents
       SET status = 'extracting', error_message = NULL, updated_at = now()
       WHERE workspace_id = $1 AND id = $2
         AND status IN ('ingested', 'needs_ocr', 'failed')`,
      [workspaceId, id]
    )
    return result.rowCount === 1
  }

  async setStage(
    workspaceId: string,
    id: string,
    status: KnowledgeDocument['status'],
    values: { text?: string; summary?: string; requiresOcr?: boolean; error?: string | null } = {}
  ): Promise<void> {
    await transaction(async (client) => {
      await client.query(
        `UPDATE knowledge_documents
         SET status = $3,
             extracted_text = coalesce($4, extracted_text),
             summary = coalesce($5, summary),
             requires_ocr = coalesce($6, requires_ocr),
             error_message = $7,
             updated_at = now()
         WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, id, status, values.text ?? null, values.summary ?? null, values.requiresOcr ?? null, values.error ?? null]
      )
      await client.query(
        `INSERT INTO ingestion_events (workspace_id, document_id, stage, detail)
         VALUES ($1, $2, $3, $4)`,
        [workspaceId, id, status, { error: values.error ?? null }]
      )
    })
  }

  async replaceChunks(
    workspaceId: string,
    documentId: string,
    chunks: Array<{ content: string; embedding: number[] }>
  ): Promise<void> {
    await transaction(async (client) => {
      await client.query(
        'DELETE FROM document_chunks WHERE workspace_id = $1 AND document_id = $2',
        [workspaceId, documentId]
      )
      for (const [index, chunk] of chunks.entries()) {
        await client.query(
          `INSERT INTO document_chunks (
             workspace_id, document_id, chunk_index, content, token_estimate, embedding
           ) VALUES ($1, $2, $3, $4, $5, $6::vector)`,
          [workspaceId, documentId, index, chunk.content, Math.ceil(chunk.content.length / 4), toVectorLiteral(chunk.embedding)]
        )
      }
    })
  }

  async search(workspaceId: string, text: string, embedding: number[], limit = 5): Promise<SearchMatch[]> {
    const result = await query<SearchRow>(
      `WITH params AS (
         SELECT plainto_tsquery('simple', $2) AS tsq, $3::vector AS embedding
       )
       SELECT c.id AS chunk_id, d.id AS document_id, d.name AS document_name, c.content,
              (
                0.7 * (1 - (c.embedding <=> params.embedding)) +
                0.3 * ts_rank_cd(c.search_vector, params.tsq)
              ) AS score
       FROM document_chunks c
       JOIN knowledge_documents d ON d.id = c.document_id
       CROSS JOIN params
       WHERE c.workspace_id = $1 AND d.status = 'ready'
         AND (c.search_vector @@ params.tsq OR (c.embedding <=> params.embedding) < 0.95)
       ORDER BY score DESC
       LIMIT $4`,
      [workspaceId, text, toVectorLiteral(embedding), limit]
    )
    return result.rows.map((row) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      documentName: row.document_name,
      content: row.content,
      score: Number(row.score),
    }))
  }

  async remove(workspaceId: string, id: string): Promise<boolean> {
    const result = await query('DELETE FROM knowledge_documents WHERE workspace_id = $1 AND id = $2', [workspaceId, id])
    return result.rowCount === 1
  }
}

function mapDocument(row: DocumentRow): KnowledgeDocument {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    status: row.status,
    summary: row.summary,
    requiresOcr: row.requires_ocr,
    chunkCount: Number(row.chunk_count),
    errorMessage: row.error_message,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function requiredRow<T>(row: T | undefined): T {
  if (!row) throw new Error('Expected database row was not returned')
  return row
}
