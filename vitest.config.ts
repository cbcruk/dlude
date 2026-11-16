import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'tools', include: ['tools/**/*.test.ts'] } },
      'apps/api/vitest.config.ts',
      'apps/web/vitest.config.ts',
    ],
  },
})
