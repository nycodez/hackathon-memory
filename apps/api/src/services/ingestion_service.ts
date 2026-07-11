import type { KnowledgeDocument } from '@hackathon/shared'
import DocumentsRepository, { type StoredDocument } from '../repositories/documents_repository.js'
import BedrockOcrService from './bedrock_ocr_service.js'
import { extractPdfText } from './pdf_text_service.js'
import { embedText } from './vector_service.js'

const textMimeTypes = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'application/json',
  'application/xml',
])

export default class IngestionService {
  constructor(
    private readonly documents = new DocumentsRepository(),
    private readonly ocr = new BedrockOcrService()
  ) {}

  async process(workspaceId: string, documentId: string): Promise<KnowledgeDocument | null> {
    const claimed = await this.documents.claimForProcessing(workspaceId, documentId)
    if (!claimed) return publicDocument(await this.documents.get(workspaceId, documentId))

    const document = await this.documents.get(workspaceId, documentId)
    if (!document) return null

    try {
      const extraction = await extractText(document)
      let text = extraction.text

      if (extraction.requiresOcr) {
        text = await this.ocr.transcribe(document)
        if (!text) {
          await this.documents.setStage(workspaceId, documentId, 'needs_ocr', {
            requiresOcr: true,
            error: 'OCR is required. Configure Bedrock credentials and a Bedrock OCR model, then process the file again.',
          })
          return publicDocument(await this.documents.get(workspaceId, documentId))
        }
      }

      const normalized = normalizeText(text)
      if (normalized.length < 20) throw new Error('The file did not contain enough readable text to index')

      await this.documents.setStage(workspaceId, documentId, 'summarizing', {
        text: normalized,
        requiresOcr: extraction.requiresOcr,
      })
      const summary = summarize(normalized)
      await this.documents.setStage(workspaceId, documentId, 'vectorizing', { summary })

      const chunks = chunkText(normalized).map((content) => ({ content, embedding: embedText(content) }))
      await this.documents.replaceChunks(workspaceId, documentId, chunks)
      await this.documents.setStage(workspaceId, documentId, 'ready')
      return publicDocument(await this.documents.get(workspaceId, documentId))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Document processing failed'
      await this.documents.setStage(workspaceId, documentId, 'failed', { error: message })
      return publicDocument(await this.documents.get(workspaceId, documentId))
    }
  }
}

async function extractText(document: StoredDocument): Promise<{ text: string; requiresOcr: boolean }> {
  if (textMimeTypes.has(document.mimeType) || hasTextExtension(document.name)) {
    return { text: document.rawData.toString('utf8'), requiresOcr: false }
  }

  if (document.mimeType === 'application/pdf' || document.name.toLowerCase().endsWith('.pdf')) {
    try {
      const text = (await extractPdfText(document.rawData)).trim()
      return { text, requiresOcr: text.length < 40 }
    } catch {
      return { text: '', requiresOcr: true }
    }
  }

  if (document.mimeType.startsWith('image/')) return { text: '', requiresOcr: true }
  throw new Error(`Unsupported file type: ${document.mimeType}`)
}

function normalizeText(value: string): string {
  return value.replace(/\0/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

function summarize(value: string): string {
  const sentences = value.match(/[^.!?\n]+[.!?]?/g)?.map((item) => item.trim()).filter(Boolean) ?? []
  const selected = sentences.slice(0, 4).join(' ')
  return (selected || value).slice(0, 700)
}

function chunkText(value: string, size = 1_400, overlap = 180): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < value.length) {
    let end = Math.min(start + size, value.length)
    if (end < value.length) {
      const boundary = Math.max(value.lastIndexOf('\n', end), value.lastIndexOf('. ', end))
      if (boundary > start + Math.floor(size * 0.6)) end = boundary + 1
    }
    chunks.push(value.slice(start, end).trim())
    if (end >= value.length) break
    start = Math.max(start + 1, end - overlap)
  }
  return chunks.filter(Boolean)
}

function hasTextExtension(name: string): boolean {
  return /\.(txt|md|markdown|csv|json|html?|xml)$/i.test(name)
}

function publicDocument(document: StoredDocument | null): KnowledgeDocument | null {
  if (!document) return null
  const { rawData: _rawData, ...result } = document
  return result
}
