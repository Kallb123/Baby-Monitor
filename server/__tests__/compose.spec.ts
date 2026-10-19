import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, describe, expect, it } from 'vitest'
import { readEnv } from '../env.ts'

// Render the actual deployment config without a daemon or running services.
// Isolate .env so a developer's credentials and settings cannot affect tests.
const execute = promisify(execFile)
const composeAvailable = await execute('docker', ['compose', 'version']).then(
  () => true,
  () => false,
)
const directory = mkdtempSync(join(tmpdir(), 'baby-monitor-compose-'))
writeFileSync(
  join(directory, 'docker-compose.yml'),
  readFileSync(new URL('../../docker-compose.yml', import.meta.url)),
)
afterAll(() => rmSync(directory, { recursive: true, force: true }))

interface ComposeConfig {
  services: Record<
    'baby-monitor' | 'go2rtc',
    { environment: NodeJS.ProcessEnv; healthcheck: { test: string[] }; command: string[] }
  >
  configs: Record<'go2rtc-base' | 'demo-camera', { content: string }>
}

async function render(settings = ''): Promise<ComposeConfig> {
  writeFileSync(join(directory, '.env'), settings)
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(GO2RTC_|DEMO_|COMPOSE_|BABY_MONITOR_TAG$|PORT$|HA_URL$|HA_TOKEN$)/.test(key),
    ),
  )
  const { stdout } = await execute(
    'docker',
    ['compose', '--profile', 'demo', 'config', '--format', 'json'],
    { cwd: directory, env },
  )
  return JSON.parse(stdout) as ComposeConfig
}

function expectApiPort(config: ComposeConfig, port: number) {
  const baseUrl = `http://localhost:${port}`
  expect(config.configs['go2rtc-base'].content).toContain(`listen: ':${port}'`)
  expect(config.services.go2rtc.healthcheck.test).toContain(`${baseUrl}/api`)
  expect(config.services['baby-monitor'].environment.GO2RTC_URL).toBe(baseUrl)
  expect(readEnv(config.services['baby-monitor'].environment).go2rtcUrl).toBe(baseUrl)
}

describe.skipIf(!composeAvailable)('pipeline Compose configuration', () => {
  it('keeps the default API listener, health check and app connection aligned', async () => {
    const config = await render()
    expectApiPort(config, 1984)
    expect(config.configs['go2rtc-base'].content).toContain("listen: ':8554'")
    expect(config.configs['go2rtc-base'].content).toContain("listen: ':8555'")
    expect(config.configs['demo-camera'].content).toContain("listen: ':1985'")
    expect(config.configs['demo-camera'].content).toContain("listen: ':8654'")
  })

  it('moves every pipeline listener through .env without losing the saved stream overlay', async () => {
    const config = await render(
      [
        'PORT=9300',
        'GO2RTC_API_PORT=9198',
        'GO2RTC_RTSP_PORT=9554',
        'GO2RTC_WEBRTC_PORT=9555',
        'DEMO_API_PORT=9199',
        'DEMO_RTSP_PORT=9654',
      ].join('\n'),
    )
    expectApiPort(config, 9198)
    expect(readEnv(config.services['baby-monitor'].environment).port).toBe(9300)
    expect(config.configs['go2rtc-base'].content).toContain("listen: ':9554'")
    expect(config.configs['go2rtc-base'].content).toContain("listen: ':9555'")
    expect(config.configs['go2rtc-base'].content).not.toContain(':8554')
    expect(config.configs['demo-camera'].content).toContain("listen: ':9199'")
    expect(config.configs['demo-camera'].content).toContain("listen: ':9654'")
    expect(config.services.go2rtc.command).toEqual([
      'go2rtc',
      '-config',
      '/config/go2rtc.yaml',
      '-config',
      '/etc/go2rtc/base.yaml',
    ])
  })

  it('lets users change just the API port in the example env file', async () => {
    const example = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8')
    const config = await render(example.replace('GO2RTC_API_PORT=1984', 'GO2RTC_API_PORT=9198'))
    expect(config.services['baby-monitor'].environment.GO2RTC_API_PORT).toBe('9198')
    expectApiPort(config, 9198)
  })

  it('preserves an explicit external connection while health-checking the bundled API', async () => {
    const config = await render('GO2RTC_API_PORT=9198\nGO2RTC_URL=http://external-go2rtc:1234')
    expect(config.services['baby-monitor'].environment.GO2RTC_URL).toBe(
      'http://external-go2rtc:1234',
    )
    expect(config.services.go2rtc.healthcheck.test).toContain('http://localhost:9198/api')
    expect(config.configs['go2rtc-base'].content).toContain("listen: ':9198'")
  })
})
