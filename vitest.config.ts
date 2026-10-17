import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'

import viteConfig from './vite.config.ts'

export default defineConfig((env) =>
  mergeConfig(viteConfig(env), {
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: 'client',
            environment: 'jsdom',
            include: ['src/**/__tests__/*.spec.ts'],
            exclude: [...configDefaults.exclude],
          },
        },
        {
          extends: true,
          test: {
            name: 'server',
            environment: 'node',
            include: ['server/**/__tests__/*.spec.ts', 'shared/**/__tests__/*.spec.ts'],
          },
        },
      ],
    },
  }),
)
