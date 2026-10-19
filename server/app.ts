import { existsSync } from 'node:fs'

import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import { ZodError } from 'zod'

import type {
  ApiError,
  EntityStatesResponse,
  HealthResponse,
  SystemInfoResponse,
} from '../shared/api.ts'
import { referencedEntityIds } from '../shared/config.ts'
import type { ConfigStore } from './config-store.ts'
import { EntityStateStream } from './entity-state-stream.ts'
import type { Go2rtcClient } from './go2rtc.ts'
import type { HomeAssistantClient } from './home-assistant.ts'

export interface AppDeps {
  store: ConfigStore
  go2rtc: Go2rtcClient
  /** Undefined when HA_URL / HA_TOKEN are not configured. */
  homeAssistant?: HomeAssistantClient
  /** HA_URL, shown on the settings page even when HA_TOKEN is missing. */
  haUrl?: string
  /** Built client directory to serve. Skipped when missing (e.g. in dev, where Vite serves it). */
  clientDir?: string
  logger?: boolean
}

/** Drops user:password@ so an HA_URL with embedded credentials is safe to show. */
function displayUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`
  } catch {
    return undefined
  }
}

async function homeAssistantInfo(deps: AppDeps): Promise<SystemInfoResponse['homeAssistant']> {
  const rawUrl = deps.homeAssistant?.baseUrl ?? deps.haUrl
  const url = rawUrl ? displayUrl(rawUrl) : undefined
  if (!deps.homeAssistant) {
    const missing = rawUrl ? 'HA_TOKEN is not set' : 'HA_URL and HA_TOKEN are not set'
    return { url, status: 'unconfigured', message: missing }
  }
  const message = await deps.homeAssistant.check()
  return message ? { url, status: 'error', message } : { url, status: 'connected' }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false })
  const entityStream = new EntityStateStream(deps.homeAssistant)
  entityStream.setEntities(referencedEntityIds(await deps.store.load()))
  // preClose runs before Fastify waits for the long-lived SSE responses to finish.
  app.addHook('preClose', async () => entityStream.close())

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

  /** Read-only server settings and a live Home Assistant check, for the settings page. */
  app.get('/api/system', async (): Promise<SystemInfoResponse> => ({
    homeAssistant: await homeAssistantInfo(deps),
    go2rtc: { url: displayUrl(deps.go2rtc.baseUrl) },
  }))

  app.get('/api/config', async () => deps.store.load())

  app.put('/api/config', async (request) => {
    const config = await deps.store.save(request.body)
    entityStream.setEntities(referencedEntityIds(config))
    // Stream registration is best-effort: the config is already saved, and
    // go2rtc may simply not be running yet. The client retries playback.
    deps.go2rtc.syncStreams(config.cameras).catch((error: unknown) => {
      request.log.warn({ err: error }, 'go2rtc stream sync failed')
    })
    return config
  })

  /** States of the entities referenced by the saved config. Clients cannot query arbitrary entities. */
  app.get('/api/ha/states', async (request): Promise<EntityStatesResponse> => {
    if (!deps.homeAssistant) return { configured: false, states: {} }
    const ids = referencedEntityIds(await deps.store.load())
    const { states, errors } = await deps.homeAssistant.getStates(ids)
    if (errors.length > 0) {
      request.log.warn({ err: errors[0], failed: errors.length }, 'Home Assistant fetch failed')
    }
    return { configured: true, states }
  })

  app.get('/api/ha/events', (_request, reply) => {
    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    reply.raw.write('retry: 3000\n\n')
    const write = (frame: string) => {
      // Disconnect a stalled viewer rather than buffering updates indefinitely.
      if (reply.raw.writableLength > 1024 * 1024) reply.raw.destroy()
      else if (!reply.raw.destroyed) reply.raw.write(frame)
    }
    const heartbeat = setInterval(() => write('event: heartbeat\ndata: {}\n\n'), 15_000)
    const unsubscribe = entityStream.subscribe(
      (response) => write(`data: ${JSON.stringify(response)}\n\n`),
      () => reply.raw.end(),
    )
    reply.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
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
      const isAppRoute = !request.url.startsWith('/api/') && !request.url.startsWith('/assets/')
      if (request.method === 'GET' && isAppRoute) {
        return reply.sendFile('index.html')
      }
      return reply.status(404).send({ error: 'Not found' } satisfies ApiError)
    })
  }

  return app
}
