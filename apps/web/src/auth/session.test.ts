import { describe, expect, it, vi } from 'vitest'
import { createSession } from './session.ts'
import type { ApiResult } from './session.ts'

const ok = <A>(value: A): ApiResult<A> => ({ ok: true, value })
const fail = (code: string): ApiResult<never> => ({ ok: false, code })

/** `valid` 토큰만 받는 가짜 API. */
const protectedCall = (valid: () => string) =>
  vi.fn(async (token: string | null) => (token === valid() ? ok('patients') : fail('UNAUTHENTICATED')))

describe('session.call', () => {
  it('access token이 만료되면 refresh를 한 번 하고 다시 부른다', async () => {
    const refresh = vi.fn(async () => ok({ accessToken: 'new' }))
    const session = createSession({ refresh })
    session.signIn('expired')
    const request = protectedCall(() => 'new')

    expect(await session.call(request)).toEqual(ok('patients'))
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(request.mock.calls.map(([token]) => token)).toEqual(['expired', 'new'])
    expect(session.state).toBe('signedIn')
  })

  it('refresh가 실패하면 로그아웃 상태가 되고 원래 오류를 돌려준다', async () => {
    const session = createSession({ refresh: async () => fail('REFRESH_TOKEN_INVALID') })
    session.signIn('expired')
    const changes: string[] = []
    session.subscribe(() => changes.push(session.state))

    expect(await session.call(protectedCall(() => 'new'))).toEqual(fail('UNAUTHENTICATED'))
    expect(session.state).toBe('signedOut')
    expect(session.token).toBeNull()
    expect(changes).toEqual(['signedOut'])
  })

  it('동시에 만료된 요청들도 refresh는 한 번', async () => {
    let resolve: (value: ApiResult<{ accessToken: string }>) => void = () => {}
    const refresh = vi.fn(() => new Promise<ApiResult<{ accessToken: string }>>((done) => (resolve = done)))
    const session = createSession({ refresh })
    session.signIn('expired')
    const request = protectedCall(() => 'new')

    const calls = Promise.all([session.call(request), session.call(request), session.call(request)])
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled())
    resolve(ok({ accessToken: 'new' }))
    expect(await calls).toEqual([ok('patients'), ok('patients'), ok('patients')])
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('401이 아닌 실패는 refresh하지 않는다. 다시 불러도 401이면 더 refresh하지 않는다', async () => {
    const refresh = vi.fn(async () => ok({ accessToken: 'still-wrong' }))
    const session = createSession({ refresh })
    session.signIn('t')

    expect(await session.call(async () => fail('PERMISSION_DENIED'))).toEqual(fail('PERMISSION_DENIED'))
    expect(refresh).not.toHaveBeenCalled()

    const request = protectedCall(() => 'never')
    expect(await session.call(request)).toEqual(fail('UNAUTHENTICATED'))
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('restore: 처음 열 때 refresh 쿠키가 있으면 로그인, 없으면 로그아웃', async () => {
    const signedIn = createSession({ refresh: async () => ok({ accessToken: 'a' }) })
    expect(signedIn.state).toBe('unknown')
    expect(await signedIn.restore()).toBe(true)
    expect(signedIn.token).toBe('a')

    const signedOut = createSession({ refresh: async () => fail('REFRESH_TOKEN_INVALID') })
    expect(await signedOut.restore()).toBe(false)
    expect(signedOut.state).toBe('signedOut')
  })
})
