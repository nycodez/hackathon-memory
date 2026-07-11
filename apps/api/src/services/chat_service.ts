import { randomUUID } from 'node:crypto'
import type { AskResult, Citation, DecisionTraceEvent } from '@hackathon/shared'
import ConversationsRepository from '../repositories/conversations_repository.js'
import DocumentsRepository from '../repositories/documents_repository.js'
import { embedText } from './vector_service.js'

export default class ChatService {
  constructor(
    private readonly conversations = new ConversationsRepository(),
    private readonly documents = new DocumentsRepository()
  ) {}

  async ask(workspaceId: string, content: string, conversationId?: string): Promise<AskResult> {
    const trace = createTrace(content, Boolean(conversationId))
    const activeConversationId = conversationId ?? await this.conversations.create(workspaceId, content)
    if (conversationId && !await this.conversations.get(workspaceId, conversationId)) {
      throw new Error('Conversation not found')
    }

    const embedding = embedText(content)
    trace.push(traceEvent('embedding', 'Query representation created', 'Prepared a 1,024-dimension feature-hash vector for semantic comparison.', 'completed'))
    const matches = await this.documents.search(workspaceId, content, embedding)
    trace.push(traceEvent(
      'retrieval',
      'Workspace corpus searched',
      `Ran workspace-scoped hybrid retrieval across ready chunks; ${matches.length} candidate${matches.length === 1 ? '' : 's'} returned.`,
      matches.length ? 'completed' : 'no_match'
    ))
    const citations: Citation[] = matches.map((match) => ({
      documentId: match.documentId,
      documentName: match.documentName,
      chunkId: match.chunkId,
      excerpt: match.content.slice(0, 280),
      score: Number(match.score.toFixed(4)),
    }))
    const documentCount = new Set(citations.map((citation) => citation.documentId)).size
    trace.push(traceEvent(
      'selection',
      citations.length ? 'Grounding evidence selected' : 'No grounding evidence selected',
      citations.length
        ? `Selected ${citations.length} passage${citations.length === 1 ? '' : 's'} from ${documentCount} document${documentCount === 1 ? '' : 's'} for the response.`
        : 'No ready passage met the retrieval threshold, so the system will not invent a corpus answer.',
      citations.length ? 'completed' : 'guardrail'
    ))
    const answer = groundedAnswer(content, citations)
    trace.push(traceEvent(
      'response',
      citations.length ? 'Grounded response assembled' : 'No-answer guardrail applied',
      citations.length
        ? 'Produced an evidence-first response and attached the selected source passages as citations.'
        : 'Returned a transparent no-answer response with guidance to add files or refine the query.',
      citations.length ? 'completed' : 'guardrail'
    ))
    const message = await this.conversations.addExchange(
      workspaceId,
      activeConversationId,
      content,
      answer,
      citations,
      trace
    )
    const conversation = await this.conversations.get(workspaceId, activeConversationId)
    if (!conversation) throw new Error('Conversation could not be loaded')
    return { conversation, message }
  }
}

function createTrace(content: string, continuingConversation: boolean): DecisionTraceEvent[] {
  return [traceEvent(
    'input',
    continuingConversation ? 'Follow-up query accepted' : 'New query accepted',
    `Validated ${content.length} characters and scoped the request to the active workspace.`,
    'accepted'
  )]
}

function traceEvent(
  stage: DecisionTraceEvent['stage'],
  title: string,
  detail: string,
  outcome: DecisionTraceEvent['outcome']
): DecisionTraceEvent {
  return {
    id: `${stage}-${randomUUID()}`,
    stage,
    title,
    detail,
    outcome,
    createdAt: new Date().toISOString(),
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
