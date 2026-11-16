import { afterAll, describe, expect, it } from 'vitest'
import { testApp } from './testing/app.ts'

const app = testApp()
afterAll(() => app.dispose())

describe('AppLive', () => {
  it('/v1/health에 200과 status ok로 답한다', async () => {
    const response = await app.request('GET', '/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('없는 경로는 404 NOT_FOUND Problem Details', async () => {
    const response = await app.request('GET', '/missing')
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toBe('application/problem+json')
    expect(await response.json()).toEqual({
      type: 'urn:dlude:problem:not-found',
      title: 'Resource not found',
      status: 404,
      code: 'NOT_FOUND',
    })
  })

  it('요청 본문이 틀리면 400 VALIDATION_FAILED와 위반 목록', async () => {
    const response = await app.request('POST', '/auth/sessions', { body: { loginId: '' } })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      violations: [
        { field: 'loginId', code: 'INVALID_VALUE' },
        { field: 'password', code: 'REQUIRED' },
      ],
    })
  })
})
