import type { CapabilityRecommendation, DemoActor } from '@hackathon/shared'
import { Router, type Request, type RequestHandler, type Response } from 'express'
import { z } from 'zod'
import CapabilitiesRepository from '../repositories/capabilities_repository.js'
import { isAllowlistedDemoActorId, listDemoActors, requestedDemoActorId, resolveDemoActor } from '../services/demo_actor_service.js'
import { workspaceId } from '../services/workspace_service.js'

const router = Router()
const capabilities = new CapabilitiesRepository()

const capabilityType = z.enum(['workflow', 'prompt', 'agent', 'skill', 'decision', 'outcome'])
const classification = z.enum(['public', 'internal', 'confidential', 'restricted'])
const assetKey = z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/)
const createSchema = z.object({
  requestId: z.string().trim().min(8).max(100),
  type: capabilityType,
  title: z.string().trim().min(3).max(140),
  summary: z.string().trim().min(10).max(500),
  content: z.string().trim().min(20).max(30_000),
  rationale: z.string().trim().min(10).max(4_000),
  classification,
  ownerTeamId: z.string().trim().min(2).max(80),
  version: z.string().trim().regex(/^v\d+\.\d+$/).optional(),
  changeNotes: z.string().trim().max(500).optional(),
})
const searchSchema = z.object({
  query: z.string().trim().min(2).max(2_000),
  type: capabilityType.optional(),
  classification: classification.optional(),
  ownerTeamId: z.string().trim().min(2).max(80).optional(),
  includeLocked: z.boolean().optional(),
  limit: z.number().int().min(1).max(25).optional(),
})
const recommendSchema = z.object({
  task: z.string().trim().min(3).max(2_000),
  limit: z.number().int().min(1).max(10).optional(),
})
const runSchema = z.object({
  propertyGroupName: z.string().trim().min(2).max(120),
  runDate: z.string().date(),
  paymentAccount: z.string().trim().min(4).max(120),
})
const idSchema = z.string().uuid()

router.get('/actors', asyncRoute(async (req, res) => {
  res.json({ success: true, data: await listDemoActors(workspaceId(req)) })
}))

router.get('/assets', withActor(async (req, res, actor) => {
  res.json({ success: true, data: await capabilities.list(workspaceId(req), actor) })
}))

router.post('/assets', withActor(async (req, res, actor) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json(validationErrors(parsed.error))
  try {
    const created = await capabilities.create(workspaceId(req), actor, parsed.data)
    return res.status(201).json({ success: true, data: created })
  } catch (error) {
    if (error instanceof Error && [
      'Owner team not found',
      'Actor cannot create assets for this team',
      'Actor cannot create assets with this governance classification',
      'Actor is not active',
    ].includes(error.message)) {
      return res.status(error.message === 'Owner team not found' ? 404 : 403).json(failure('governance', 'capability', error.message))
    }
    throw error
  }
}))

router.get('/assets/:assetKey', withActor(async (req, res, actor) => {
  const parsed = assetKey.safeParse(req.params.assetKey)
  if (!parsed.success) return res.status(400).json(failure('validation', 'assetKey', 'A valid asset key is required'))
  const detail = await capabilities.get(workspaceId(req), parsed.data, actor)
  if (!detail) return res.status(404).json(failure('not_found', 'asset', 'Capability was not found'))
  if (detail === 'denied') return res.status(403).json(failure('governance', 'asset', 'Access denied by organizational memory policy'))
  return res.json({ success: true, data: detail })
}))

router.post('/search', withActor(async (req, res, actor) => {
  const parsed = searchSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json(validationErrors(parsed.error))
  const results = await capabilities.search(workspaceId(req), actor, parsed.data)
  return res.json({ success: true, data: results, meta: { actorId: actor.id, resultCount: results.length } })
}))

router.post('/recommendations', withActor(async (req, res, actor) => {
  const parsed = recommendSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json(validationErrors(parsed.error))
  const results = await capabilities.search(workspaceId(req), actor, {
    query: parsed.data.task,
    includeLocked: true,
    limit: parsed.data.limit ?? 5,
  })
  const recommendations: CapabilityRecommendation[] = results.map((result) => ({
    ...result,
    explanation: result.locked
      ? 'This capability may be relevant, but its evidence is hidden by governance policy.'
      : `Recommended because ${result.reasons.join(', ').toLowerCase()}.`,
  }))
  return res.json({ success: true, data: recommendations, meta: { actorId: actor.id, task: parsed.data.task } })
}))

router.post('/assets/:assetKey/install', withActor(async (req, res, actor) => {
  const parsed = assetKey.safeParse(req.params.assetKey)
  if (!parsed.success) return res.status(400).json(failure('validation', 'assetKey', 'A valid asset key is required'))
  const result = await capabilities.install(workspaceId(req), parsed.data, actor)
  if (!result) return res.status(404).json(failure('not_found', 'asset', 'Capability was not found'))
  if (result === 'denied') return res.status(403).json(failure('governance', 'asset', 'Installation denied by organizational memory policy'))
  return res.status(201).json({ success: true, data: result })
}))

router.post('/assets/:assetKey/runs', withActor(async (req, res, actor) => {
  const parsedKey = assetKey.safeParse(req.params.assetKey)
  if (!parsedKey.success) return res.status(400).json(failure('validation', 'assetKey', 'A valid asset key is required'))
  const parsedBody = runSchema.safeParse(req.body)
  if (!parsedBody.success) return res.status(400).json(validationErrors(parsedBody.error))
  try {
    const result = await capabilities.run(workspaceId(req), parsedKey.data, actor, parsedBody.data)
    if (!result) return res.status(404).json(failure('not_found', 'asset', 'Capability was not found'))
    if (result === 'denied') return res.status(403).json(failure('governance', 'asset', 'Run denied by organizational memory policy'))
    if (result === 'not_installed') return res.status(409).json(failure('not_installed', 'asset', 'Install this capability version before running it'))
    return res.status(201).json({ success: true, data: result })
  } catch (error) {
    if (error instanceof Error && error.message === 'Capability has no deterministic runtime') {
      return res.status(422).json(failure('runtime', 'asset', error.message))
    }
    throw error
  }
}))

router.get('/runs/:runId', withActor(async (req, res, actor) => {
  const parsed = idSchema.safeParse(req.params.runId)
  if (!parsed.success) return res.status(400).json(failure('validation', 'runId', 'A valid run ID is required'))
  const result = await capabilities.getRun(workspaceId(req), parsed.data, actor)
  if (!result) return res.status(404).json(failure('not_found', 'run', 'Run was not found'))
  if (result === 'denied') return res.status(403).json(failure('governance', 'run', 'Run access denied by organizational memory policy'))
  return res.json({ success: true, data: result })
}))

router.get('/summary', asyncRoute(async (req, res) => {
  res.json({ success: true, data: await capabilities.summary(workspaceId(req)) })
}))

router.get('/departure-scenario', withActor(async (req, res, actor) => {
  res.json({ success: true, data: await capabilities.departureScenario(workspaceId(req), actor) })
}))

function withActor(handler: (req: Request, res: Response, actor: DemoActor) => Promise<unknown>): RequestHandler {
  return asyncRoute(async (req, res) => {
    const actorId = requestedDemoActorId(req)
    if (!isAllowlistedDemoActorId(actorId)) {
      return res.status(401).json(failure('identity', 'x-demo-actor-id', 'Unknown demo actor'))
    }
    const actor = await resolveDemoActor(workspaceId(req), actorId)
    if (!actor) return res.status(503).json(failure('configuration', 'actor', 'Demo actors have not been seeded'))
    return handler(req, res, actor)
  })
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req, res, next) => { void handler(req, res).catch(next) }
}

function validationErrors(error: z.ZodError) {
  return {
    success: false,
    errors: error.issues.map((issue) => ({
      rule: 'validation',
      field: issue.path.join('.') || 'request',
      message: issue.message,
    })),
  }
}

function failure(rule: string, field: string, message: string) {
  return { success: false, errors: [{ rule, field, message }] }
}

export default router
