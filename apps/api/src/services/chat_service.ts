import { randomUUID } from 'node:crypto'
import type { AskResult, Citation, DecisionTraceEvent } from '@hackathon/shared'
import ConversationsRepository from '../repositories/conversations_repository.js'
import DocumentsRepository from '../repositories/documents_repository.js'
import BedrockLlmService, { type QueryAnalysis } from './bedrock_llm_service.js'
import { embedText } from './vector_service.js'

export default class ChatService {
  constructor(
    private readonly conversations = new ConversationsRepository(),
    private readonly documents = new DocumentsRepository(),
    private readonly bedrock = new BedrockLlmService()
  ) {}

  async ask(workspaceId: string, content: string, conversationId?: string): Promise<AskResult> {
    const trace = createTrace(content, Boolean(conversationId))
    const activeConversationId = conversationId ?? await this.conversations.create(workspaceId, content)
    if (conversationId && !await this.conversations.get(workspaceId, conversationId)) {
      throw new Error('Conversation not found')
    }

    const analysis = await this.analyzeQuestion(content)
    trace.push(traceEvent(
      'analysis',
      analysis.source === 'bedrock' ? 'Question parsed by economy model' : 'Query parser fallback applied',
      `Intent: ${analysis.intent}. Retrieval query: “${analysis.searchQuery}”.`,
      analysis.source === 'bedrock' ? 'completed' : 'guardrail'
    ))
    const embedding = embedText(analysis.searchQuery)
    trace.push(traceEvent('embedding', 'Query representation created', 'Prepared a 1,024-dimension vector from the parsed retrieval query.', 'completed'))
    const matches = await this.documents.search(
      workspaceId,
      analysis.searchQuery,
      embedding,
      5,
      { monetaryIntent: analysis.monetaryIntent }
    )
    trace.push(traceEvent(
      'retrieval',
      'Workspace corpus searched',
      `Ran workspace-scoped hybrid retrieval across ready chunks; ${matches.length} candidate${matches.length === 1 ? '' : 's'} returned.`,
      matches.length ? 'completed' : 'no_match'
    ))
    const citations: Citation[] = matches.map((match, index) => ({
      label: `S${index + 1}`,
      documentId: match.documentId,
      documentName: match.documentName,
      chunkId: match.chunkId,
      excerpt: relevantExcerpt(match.content, analysis.searchQuery, analysis.monetaryIntent),
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
    const generation = await this.generateAnswer(content, matches, citations)
    trace.push(traceEvent('response', generation.title, generation.detail, generation.outcome))
    const message = await this.conversations.addExchange(
      workspaceId,
      activeConversationId,
      content,
      generation.answer,
      citations,
      trace
    )
    const conversation = await this.conversations.get(workspaceId, activeConversationId)
    if (!conversation) throw new Error('Conversation could not be loaded')
    return { conversation, message }
  }

  private async analyzeQuestion(question: string): Promise<QueryAnalysis & { source: 'bedrock' | 'fallback' }> {
    if (this.bedrock.isQueryAnalysisConfigured()) {
      try {
        return { ...await this.bedrock.analyzeQuery(question), source: 'bedrock' }
      } catch (error) {
        console.error('Bedrock query analysis failed', error instanceof Error ? error.name : 'UnknownError')
      }
    }

    return {
      searchQuery: question,
      intent: 'other',
      monetaryIntent: /\b(costs?|prices?|fees?|amount|charges?|deposit|payment|how much)\b/i.test(question),
      source: 'fallback',
    }
  }

  private async generateAnswer(
    question: string,
    matches: Awaited<ReturnType<DocumentsRepository['search']>>,
    citations: Citation[]
  ): Promise<{
    answer: string
    title: string
    detail: string
    outcome: DecisionTraceEvent['outcome']
  }> {
    if (!matches.length) {
      return {
        answer: noAnswer(question),
        title: 'No-answer guardrail applied',
        detail: 'Skipped the model call because no relevant library context was available.',
        outcome: 'guardrail',
      }
    }

    if (this.bedrock.isConfigured()) {
      try {
        const result = await this.bedrock.generate(question, matches)
        return {
          answer: result.text,
          title: 'Bedrock response generated',
          detail: `Sent ${result.contextCharacters} context characters from ${result.contextPassages} retrieved passage${result.contextPassages === 1 ? '' : 's'} to the configured Bedrock model.`,
          outcome: 'completed',
        }
      } catch (error) {
        const errorName = error instanceof Error ? error.name : 'UnknownError'
        console.error('Bedrock generation failed', errorName)
        return {
          answer: evidenceFallback(citations),
          title: 'Evidence fallback applied',
          detail: `Bedrock generation was unavailable (${errorName}); returned the retrieved evidence without generating unsupported content.`,
          outcome: 'guardrail',
        }
      }
    }

    return {
      answer: evidenceFallback(citations),
      title: 'Evidence fallback applied',
      detail: 'Bedrock is not fully configured; returned the retrieved evidence directly.',
      outcome: 'guardrail',
    }
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

function evidenceFallback(citations: Citation[]): string {
  const evidence = citations.slice(0, 3).map((citation, index) => (
    `${index + 1}. ${citation.excerpt.replace(/\s+/g, ' ').trim()}`
  )).join('\n\n')
  return `Here is the most relevant evidence from the indexed corpus:\n\n${evidence}`
}

function noAnswer(question: string): string {
  return `I could not find a grounded answer for “${question}” in the ready documents. Add relevant files or try a more specific query.`
}

function relevantExcerpt(content: string, searchQuery: string, monetaryIntent: boolean): string {
  const normalized = content.replace(/\s+/g, ' ').trim()
  const lower = normalized.toLocaleLowerCase()
  const terms = searchQuery.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  const amountIndex = monetaryIntent ? normalized.search(/[$][\s]*[0-9]/) : -1
  const termIndexes = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0)
  const focus = amountIndex >= 0 ? amountIndex : (termIndexes.length ? Math.min(...termIndexes) : 0)
  const start = Math.max(0, focus - 150)
  return normalized.slice(start, start + 420)
}
