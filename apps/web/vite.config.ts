import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 개발 서버에서는 /v1을 alchemy dev의 Worker로 넘긴다. 배포에서는 같은 Worker가 정적 파일과 /v1을 함께 낸다(F6).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/v1': process.env['DLUDE_API_ORIGIN'] ?? 'http://localhost:1337' },
  },
})
