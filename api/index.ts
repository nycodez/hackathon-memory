import type { Request, Response } from 'express'
import app from '../apps/api/src/app.js'

export default function handler(request: Request, response: Response): void {
  const url = new URL(request.url, 'http://localhost')
  const path = url.searchParams.get('__path')

  if (path !== null) {
    url.searchParams.delete('__path')
    const query = url.searchParams.toString()
    request.url = `/api${path ? `/${path}` : ''}${query ? `?${query}` : ''}`
  }

  app(request, response)
}
