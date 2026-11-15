import { defineConfig } from 'vitest/config'

// 앱 패키지는 자기 vitest.config.ts를 가지면 여기 projects에 더한다.
export default defineConfig({
  test: {
    projects: [{ test: { name: 'tools', include: ['tools/**/*.test.ts'] } }],
  },
})
