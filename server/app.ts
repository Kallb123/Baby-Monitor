import { existsSync } from 'node:fs'

import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import { ZodError } from 'zod'

import type { ApiError, EntityStatesResponse, HealthResponse } from '../shared/api.ts'
import { referencedEntityIds } from '../shared/config.ts'
import type { ConfigStore } from './config-store.ts'
import type { Go2rtcClient } from './go2rtc.ts'
import type { HomeAssistantClient } from './home-assistant.ts'

export interface AppDeps {
  store: ConfigStore
  go2rtc: Go2rtcClient
  /** Undefined when HA_URL / HA_TOKEN are not configured. */
  homeAssistant?: HomeAssistantClient
  /** Built client directory to serve. Skipped when missing (e.g. in dev, where Vite serves it). */
  clientDir?: string
  logger?: boolean
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false })

  app.addContentTypeParser('application/sdp', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body)
  })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      const body: ApiError = {
        error: 'Invalid config',
        issues: error.issues.map((issue) => ({
          path: issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p)),
          message: issue.message,
        })),
      }
      return reply.status(400).send(body)
    }
    request.log.error(error)
    const status = (error as { statusCode?: number }).statusCode ?? 500
    const message = status < 500 && error instanceof Error ? error.message : 'Internal error'
    return reply.status(status).send({ error: message } satisfies ApiError)
  })

  app.get('/api/health', async (): Promise<HealthResponse> => ({
    ok: true,
    homeAssistant: Boolean(deps.homeAssistant),
    go2rtc: deps.go2rtc.baseUrl,
  }))

  app.get('/api/config', async () => deps.store.load())

  app.put('/api/config', async (request) => {
    const config = await deps.store.save(request.body)
    // Stream registration is best-effort: the config is already saved, and
    // go2rtc may simply not be running yet. The client retries playback.
    deps.go2rtc.syncStreams(config.cameras).catch((error: unknown) => {
      request.log.warn({ err: error }, 'go2rtc stream sync failed')
    })
    return config
  })

  /** States of the entities referenced by the saved config. Clients cannot query arbitrary entities. */
  app.get('/api/ha/states', async (): Promise<EntityStatesResponse> => {
    if (!deps.homeAssistant) return { configured: false, states: {} }
    const ids = referencedEntityIds(await deps.store.load())
    return { configured: true, states: await deps.homeAssistant.getStates(ids) }
  })

  /** WebRTC signalling: body is the browser's SDP offer, response is go2rtc's SDP answer. */
  app.post<{ Params: { id: string }; Body: string }>(
    '/api/streams/:id/webrtc',
    async (request, reply) => {
      const config = await deps.store.load()
      if (!config.cameras.some((camera) => camera.id === request.params.id)) {
        return reply.status(404).send({ error: 'Unknown camera' } satisfies ApiError)
      }
      if (typeof request.body !== 'string' || request.body.length === 0) {
        return reply
          .status(400)
          .send({ error: 'Expected an application/sdp body' } satisfies ApiError)
      }
      const answer = await deps.go2rtc.negotiate(request.params.id, request.body)
      return reply.type('application/sdp').send(answer)
    },
  )

  if (deps.clientDir && existsSync(deps.clientDir)) {
    await app.register(fastifyStatic, { root: deps.clientDir })
    // SPA fallback: unknown non-API GETs get index.html so client-side routes work on reload.
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) {
        return reply.sendFile('index.html')
      }
      return reply.status(404).send({ error: 'Not found' } satisfies ApiError)
    })
  }

  return app
}
