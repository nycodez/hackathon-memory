import type { AskResult, Citation } from '@hackathon/shared'
import ConversationsRepository from '../repositories/conversations_repository.js'
import DocumentsRepository from '../repositories/documents_repository.js'
import { embedText } from './vector_service.js'

export default class ChatService {
  constructor(
    private readonly conversations = new ConversationsRepository(),
    private readonly documents = new DocumentsRepository()
  ) {}

  async ask(workspaceId: string, content: string, conversationId?: string): Promise<AskResult> {
    const activeConversationId = conversationId ?? await this.conversations.create(workspaceId, content)
    if (conversationId && !await this.conversations.get(workspaceId, conversationId)) {
      throw new Error('Conversation not found')
    }

    const matches = await this.documents.search(workspaceId, content, embedText(content))
    const citations: Citation[] = matches.map((match) => ({
      documentId: match.documentId,
      documentName: match.documentName,
      chunkId: match.chunkId,
      excerpt: match.content.slice(0, 280),
      score: Number(match.score.toFixed(4)),
    }))
    const answer = groundedAnswer(content, citations)
    const message = await this.conversations.addExchange(
      workspaceId,
      activeConversationId,
      content,
      answer,
      citations
    )
    const conversation = await this.conversations.get(workspaceId, activeConversationId)
    if (!conversation) throw new Error('Conversation could not be loaded')
    return { conversation, message }
  }
}

function groundedAnswer(question: string, citations: Citation[]): string {
  if (!citations.length) {
    return `I could not find a grounded answer for “${question}” in the ready documents. Add relevant files or try a more specific query.`
  }

  const evidence = citations.slice(0, 3).map((citation, index) => (
    `${index + 1}. ${citation.excerpt.replace(/\s+/g, ' ').trim()}`
  )).join('\n\n')
  return `Here is the most relevant evidence from the indexed corpus:\n\n${evidence}`
}

