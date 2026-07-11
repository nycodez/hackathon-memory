import type {
  ApiEnvelope,
  CapabilityDetail,
  CapabilityInstallation,
  CapabilityRun,
  MemoryActor,
  MemoryAnalytics,
  MemoryRecommendation,
  MemorySearchResponse,
} from '@hackathon/shared'
import { getPool, query } from '../src/db/pool.js'
import MemorySeedService, { demoMemoryIds } from '../src/services/memory_seed_service.js'

const baseUrl = (process.env.MEMORY_EVAL_BASE_URL?.trim() || 'http://localhost:3333/api').replace(/\/$/, '')
const workspaceId = process.env.MEMORY_WORKSPACE_ID?.trim() || 'hackathon-demo'
const results: Array<{ name: string; passed: boolean; detail: string }> = []

try {
  if (process.env.MEMORY_EVAL_SEED !== 'false') await new MemorySeedService().seed(workspaceId)

  const actors = await api<MemoryActor[]>('/demo/actors')
  check('Demo actors are seeded', actors.length === 3, `${actors.length} actors`)
  const owner = actors.find((actor) => actor.id === demoMemoryIds.owner)
  const successor = actors.find((actor) => actor.id === demoMemoryIds.successor)
  const viewer = actors.find((actor) => actor.id === demoMemoryIds.unauthorized)
  check('Continuity roles use verified demo casting',
    owner?.name === 'Magdalene Choong' && successor?.name === 'Laura Nguyen' && viewer?.name === 'Eugene Koon',
    `${owner?.name} → ${successor?.name}; viewer ${viewer?.name}`)
  check('Source owner is departed in the simulated scenario', owner?.status === 'departed', owner?.status ?? 'missing')

  const search = await api<MemorySearchResponse>('/memory/search?q=weekly%20AP%20run')
  const capabilityHit = search.results.find((item) => item.type === 'capability' && item.id === demoMemoryIds.capability)
  check('Weekly AP Run is searchable', Boolean(capabilityHit), capabilityHit?.name ?? 'not found')

  const detail = await api<CapabilityDetail>(`/capabilities/${demoMemoryIds.capability}`, {
    actorId: demoMemoryIds.successor,
  })
  check('Capability has provenance and a steward', detail.provenance.length >= 2 && detail.steward.id === demoMemoryIds.successor,
    `${detail.provenance.length} sources; steward ${detail.steward.name}`)
  check('Published capability is runnable and ordered',
    detail.version.steps.length === 5 && detail.version.steps.every((step, index) => step.position === index && step.runnable),
    detail.version.steps.map((step) => step.skillCode).join(' → '))
  check('Prompt, workflow, agent, decision, and best-practice context are retained',
    ['prompt', 'workflow', 'agent', 'decision', 'best_practice'].every((kind) => detail.provenance.some((source) => source.assetKind === kind)),
    [...new Set(detail.provenance.map((source) => source.assetKind))].join(', '))

  const unauthorized = await raw(`/capabilities/${demoMemoryIds.capability}/runs`, {
    method: 'POST', actorId: demoMemoryIds.unauthorized,
    body: { idempotencyKey: `eval-denied-${Date.now()}`, asOfDate: '2026-07-12' },
  })
  check('Viewer cannot run the capability', unauthorized.status === 403, `HTTP ${unauthorized.status}`)
  const departed = await raw(`/capabilities/${demoMemoryIds.capability}/runs`, {
    method: 'POST', actorId: demoMemoryIds.owner,
    body: { idempotencyKey: `eval-departed-${Date.now()}`, asOfDate: '2026-07-12' },
  })
  check('Departed source owner cannot initiate a run', departed.status === 403, `HTTP ${departed.status}`)

  const idempotencyKey = `eval-successor-${Date.now()}`
  const paymentsBefore = await paymentCount()
  const firstRun = await api<CapabilityRun>(`/capabilities/${demoMemoryIds.capability}/runs`, {
    method: 'POST', actorId: demoMemoryIds.successor,
    body: { idempotencyKey, asOfDate: '2026-07-12' },
  })
  const paymentsAfterFirst = await paymentCount()
  const repeatedRun = await api<CapabilityRun>(`/capabilities/${demoMemoryIds.capability}/runs`, {
    method: 'POST', actorId: demoMemoryIds.successor,
    body: { idempotencyKey, asOfDate: '2026-07-12' },
  })
  const paymentsAfterRepeat = await paymentCount()
  check('Active successor can run inherited capability', firstRun.status === 'succeeded' && firstRun.actor.id === demoMemoryIds.successor,
    `${firstRun.status} by ${firstRun.actor.name}`)
  check('Skills execute in deterministic version order',
    firstRun.steps.map((step) => step.skillCode).join('|') === detail.version.steps.map((step) => step.skillCode).join('|') && firstRun.steps.every((step) => step.status === 'succeeded'),
    firstRun.steps.map((step) => `${step.position}:${step.skillCode}`).join(', '))
  check('Idempotency returns the same run without duplicate payments',
    repeatedRun.id === firstRun.id && paymentsAfterRepeat === paymentsAfterFirst && paymentsAfterFirst >= paymentsBefore,
    `${firstRun.id}; payments ${paymentsBefore} → ${paymentsAfterFirst} → ${paymentsAfterRepeat}`)
  check('Evidence-dependent steps and outcome carry citations',
    firstRun.citations.length >= 2 && firstRun.steps.every((step) => step.citations.length >= 2),
    `${firstRun.citations.length} run citations`)
  check('Run records decisions and a final accounting outcome',
    firstRun.decisions.length > 0 && typeof firstRun.output.endingBalanceCents === 'number' && firstRun.summary.length > 0,
    firstRun.summary)

  const persisted = await api<CapabilityRun>(`/runs/${firstRun.id}`)
  check('Run outcome persists and reloads', persisted.id === firstRun.id && persisted.status === 'succeeded' && persisted.steps.length === 5,
    `${persisted.id}; ${persisted.steps.length} steps`)
  const history = await api<CapabilityRun[]>(`/capabilities/${demoMemoryIds.capability}/runs`)
  check('Historical owner run remains available after departure',
    history.some((run) => run.id === demoMemoryIds.historicalRun && run.actor.id === demoMemoryIds.owner),
    `${history.length} total run(s)`)

  const installation = await api<CapabilityInstallation>(`/capabilities/${demoMemoryIds.capability}/install`, { method: 'POST' })
  check('Installed task retains source capability version',
    installation.capabilityVersionId === detail.version.id && installation.task.skills.length === detail.version.steps.length,
    `${installation.task.name} from v${detail.version.version}`)

  const assetSearch = await api<MemorySearchResponse>('/memory/search?q=summary%20prompt')
  check('Reusable prompt and agent memory are searchable', assetSearch.results.some((item) => item.type === 'prompt'),
    assetSearch.results.map((item) => item.type).join(', '))
  const recommendations = await api<MemoryRecommendation[]>('/memory/recommendations?context=weekly%20AP')
  check('Relevant proven work is recommended',
    recommendations.some((item) => item.capabilityId === demoMemoryIds.capability && item.type === 'reuse'),
    recommendations[0]?.rationale ?? 'no recommendation')
  const analytics = await api<MemoryAnalytics>('/memory/analytics')
  check('Memory analytics expose growth, duplication, and missing capabilities',
    analytics.capabilityCount >= 1 && analytics.runCount >= 2 && Array.isArray(analytics.duplicatedSkills) && analytics.missingCapabilities.length >= 1 && analytics.growth.length >= 1,
    `${analytics.capabilityCount} capabilities; ${analytics.runCount} runs; ${analytics.missingCapabilities.length} gaps`)

  for (const result of results) console.log(`${result.passed ? 'PASS' : 'FAIL'}  ${result.name} — ${result.detail}`)
  const passed = results.filter((result) => result.passed).length
  console.log(`\n${passed}/${results.length} organizational-memory eval gates passed`)
  if (passed !== results.length) process.exitCode = 1
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await getPool().end()
}

function check(name: string, passed: boolean, detail: string): void {
  results.push({ name, passed, detail })
}

async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await raw(path, options)
  const payload = await response.json() as ApiEnvelope<T>
  if (!response.ok || !payload.success || payload.data === undefined) {
    throw new Error(`${options.method ?? 'GET'} ${path} failed (${response.status}): ${JSON.stringify(payload.errors)}`)
  }
  return payload.data
}

interface RequestOptions {
  method?: 'GET' | 'POST'
  actorId?: string
  body?: Record<string, unknown>
}

function raw(path: string, options: RequestOptions = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'x-workspace-id': workspaceId,
      ...(options.actorId ? { 'x-actor-id': options.actorId } : {}),
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
}

async function paymentCount(): Promise<number> {
  const result = await query<{ count: number }>(
    'SELECT count(*)::int AS count FROM memory_demo_payments WHERE workspace_id = $1',
    [workspaceId]
  )
  return Number(result.rows[0]?.count ?? 0)
}
