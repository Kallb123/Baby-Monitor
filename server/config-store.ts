import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { appConfigSchema, defaultConfig, type AppConfig } from '../shared/config.ts'

/**
 * Persists the app config as a JSON file.
 *
 * Writes go to a temp file first and are then renamed over the real file, so
 * a crash mid-write never leaves a half-written config behind. Writes are
 * serialised so two concurrent saves cannot interleave.
 */
export class ConfigStore {
  readonly file: string
  #cache: AppConfig | undefined
  #writes: Promise<unknown> = Promise.resolve()

  constructor(dataDir: string) {
    this.file = join(dataDir, 'config.json')
  }

  async load(): Promise<AppConfig> {
    if (this.#cache) return this.#cache
    let raw: string
    try {
      raw = await readFile(this.file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.#cache = defaultConfig()
        return this.#cache
      }
      throw error
    }
    // A corrupt or outdated file should fail loudly rather than be overwritten.
    this.#cache = appConfigSchema.parse(JSON.parse(raw))
    return this.#cache
  }

  /** Validates, persists and returns the normalised config. Throws ZodError on invalid input. */
  async save(input: unknown): Promise<AppConfig> {
    const config = appConfigSchema.parse(input)
    const write = this.#writes.then(async () => {
      await mkdir(join(this.file, '..'), { recursive: true })
      const tmp = `${this.file}.${process.pid}.tmp`
      await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
      await rename(tmp, this.file)
      this.#cache = config
    })
    this.#writes = write.catch(() => {})
    await write
    return config
  }
}
