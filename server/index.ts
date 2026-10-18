import { buildApp } from './app.ts'
import { ConfigStore } from './config-store.ts'
import { loadDotEnv, readEnv } from './env.ts'
import { Go2rtcClient } from './go2rtc.ts'
import { HomeAssistantClient } from './home-assistant.ts'

loadDotEnv()
const env = readEnv()

const store = new ConfigStore(env.dataDir)
const go2rtc = new Go2rtcClient({ baseUrl: env.go2rtcUrl })
const homeAssistant =
  env.haUrl && env.haToken
    ? new HomeAssistantClient({ baseUrl: env.haUrl, token: env.haToken })
    : undefined

const app = await buildApp({
  store,
  go2rtc,
  homeAssistant,
  haUrl: env.haUrl,
  clientDir: process.env.NODE_ENV === 'production' ? env.clientDir : undefined,
  logger: true,
})

if (!homeAssistant) {
  app.log.warn('HA_URL / HA_TOKEN not set: temperature and cry detection are disabled')
}

// Re-register saved cameras on boot as a backstop: go2rtc only keeps
// API-added streams if its config file is writable and persisted.
const config = await store.load()
go2rtc.syncStreams(config.cameras).catch((error: unknown) => {
  app.log.warn({ err: error }, 'go2rtc stream sync failed on startup')
})

await app.listen({ host: env.host, port: env.port })
