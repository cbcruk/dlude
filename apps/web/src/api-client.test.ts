import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApi } from './api-client.ts'

// effect의 fetch 클라이언트는 처음 본 전역 fetch를 붙잡으므로 파일에서 한 번만 바꾸고 동작만 테스트마다 정한다
const fetchMock = vi.fn<typeof fetch>()
vi.stubGlobal('fetch', fetchMock)
vi.stubGlobal('location', { origin: 'http://clinic.test' })
beforeEach(() => fetchMock.mockReset())

const json = (status: number, body: unknown, type = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': type } })

const staffBody = {
  id: 'stf_x',
  loginId: 'director',
  name: '가상 원장',
  role: 'DIRECTOR',
  emoji: '🦷',
  synthetic: true,
}

describe('createApi', () => {
  it('커맨드 경로는 `:` 하나로 보내고 access token을 Bearer로 붙인다', async () => {
    fetchMock.mockImplementation(async () => json(200, { accessToken: 'a', expiresIn: 600, staff: staffBody }))
    const api = createApi(() => 'token-1')

    expect(await api.verifyTotp({ challengeToken: 'chl_x', code: '123456' })).toMatchObject({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('http://clinic.test/v1/auth/sessions:verify-totp')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer token-1')
  })

  it('Problem 응답은 code로', async () => {
    fetchMock.mockImplementation(async () =>
      json(
        401,
        {
          type: 'urn:dlude:problem:invalid-credentials',
          title: 'Invalid login ID or password',
          status: 401,
          code: 'INVALID_CREDENTIALS',
        },
        'application/problem+json',
      ),
    )
    expect(await createApi(() => null).login({ loginId: 'a', password: 'b' })).toEqual({
      ok: false,
      code: 'INVALID_CREDENTIALS',
    })
  })
})
