import type { Request } from 'express'

const defaultWorkspace = 'hackathon-demo'

export function workspaceId(req: Request): string {
  const supplied = req.header('x-workspace-id')?.trim()
  if (!supplied) return defaultWorkspace
  return /^[a-zA-Z0-9_-]{1,64}$/.test(supplied) ? supplied : defaultWorkspace
}

