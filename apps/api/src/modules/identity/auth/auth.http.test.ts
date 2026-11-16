import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { testApp } from '../../../testing/app.ts'
import { adjustableClock } from '../../../testing/clock.ts'
import { DEFAULT_DEV_PASSWORD } from './auth-config.ts'
import { SecurityLog } from './security-log.ts'
import { DIRECTOR_TOTP_SECRET } from '../seed.ts'
import { refreshCookieOf, SeededIdentity, signIn, totpCode } from './testing.ts'

let disposers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(disposers.map((dispose) => dispose()))
  disposers = []
})

function setup() {
  const clock = adjustableClock()
  const app = testApp(SeededIdentity, clock.layer)
  disposers.push(app.dispose)
  return { app, clock }
}

const login = (app: ReturnType<typeof setup>['app'], loginId: string, password = DEFAULT_DEV_PASSWORD) =>
  app.request('POST', '/auth/sessions', { body: { loginId, password } })

const problemCode = async (response: Response) => ((await response.json()) as { code: string }).code

describe('로그인 (비밀번호 → TOTP)', () => {
  it('원장: 비밀번호 → TOTP → 세션, refresh 쿠키, /me', async () => {
    const { app, clock } = setup()
    const started = await login(app, 'Director')
    expect(started.status).toBe(200)
    const challenge = await started.json()
    expect(challenge).toMatchObject({ next: 'TOTP', expiresIn: 300 })
    expect(challenge).not.toHaveProperty('otpauthUri')

    const verified = await app.request('POST', '/auth/sessions:verify-totp', {
      body: { challengeToken: challenge.challengeToken, code: await totpCode(DIRECTOR_TOTP_SECRET, clock.now()) },
    })
    expect(verified.status).toBe(200)
    const session = await verified.json()
    expect(session).toMatchObject({
      expiresIn: 600,
      staff: { loginId: 'director', role: 'DIRECTOR', synthetic: true },
    })
    expect(session).not.toHaveProperty('refreshToken')
    const cookie = verified.headers.getSetCookie().find((each) => each.startsWith('dlude_refresh='))
    expect(cookie).toMatch(/HttpOnly/)
    expect(cookie).toMatch(/Secure/)
    expect(cookie).toMatch(/SameSite=Strict/)
    expect(cookie).toMatch(/Path=\/v1\/auth/)

    const me = await app.request('GET', '/me', { token: session.accessToken })
    expect(me.status).toBe(200)
    expect(await me.json()).toEqual({
      staff: session.staff,
      permissions: ['patient:read', 'staff:read'],
      totpEnrolled: true,
    })
  })

  it('TOTP가 없는 직원은 첫 로그인에서 등록하고, 다음 로그인부터는 TOTP', async () => {
    const { app, clock } = setup()
    const started = await (await login(app, 'desk')).json()
    expect(started.next).toBe('TOTP_ENROLL')
    expect(started.otpauthUri).toMatch(/^otpauth:\/\/totp\/dlude%3Adesk\?secret=[A-Z2-7]{32}&/)

    // 위 도전은 쓰지 않고 버린다. signIn은 새 도전(새 비밀 값)으로 등록까지 한다
    const { accessToken } = await signIn(app, 'desk', clock.now())
    const me = await (await app.request('GET', '/me', { token: accessToken })).json()
    expect(me.totpEnrolled).toBe(true)

    clock.advance(30_000)
    expect((await (await login(app, 'desk')).json()).next).toBe('TOTP')
  })

  it('없는 아이디와 틀린 비밀번호는 같은 401 INVALID_CREDENTIALS', async () => {
    const { app } = setup()
    const unknown = await login(app, 'nobody')
    const wrong = await login(app, 'desk', 'wrong-password')
    expect(unknown.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(await unknown.json()).toEqual(await wrong.json())
  })

  it('5번째 실패에서 423 ACCOUNT_LOCKED. 잠금은 실패 응답이어도 남아 맞는 비밀번호도 막고, 세션을 끝낸다', async () => {
    const { app, clock } = setup()
    const { accessToken } = await signIn(app, 'director', clock.now())

    const statuses: number[] = []
    for (let attempt = 1; attempt <= 5; attempt++) statuses.push((await login(app, 'director', 'wrong')).status)
    expect(statuses).toEqual([401, 401, 401, 401, 423])

    const correct = await login(app, 'director')
    expect(correct.status).toBe(423)
    expect(await problemCode(correct)).toBe('ACCOUNT_LOCKED')
    expect(await problemCode(await app.request('GET', '/me', { token: accessToken }))).toBe('UNAUTHENTICATED')

    const events = await app.run(SecurityLog.use((log) => log.list()).pipe(Effect.provide(SecurityLog.layer)))
    expect(events.map((each) => each.type)).toEqual([
      'LOGIN_SUCCEEDED',
      ...Array<string>(5).fill('LOGIN_FAILED'),
      'ACCOUNT_LOCKED',
      'LOGIN_FAILED',
    ])
  })

  it('없거나 만료된 로그인 도전은 401 CHALLENGE_INVALID', async () => {
    const { app, clock } = setup()
    const code = await totpCode(DIRECTOR_TOTP_SECRET, clock.now())
    const bogus = await app.request('POST', '/auth/sessions:verify-totp', {
      body: { challengeToken: 'chl_01JBQ000000000000000000001', code },
    })
    expect(await problemCode(bogus)).toBe('CHALLENGE_INVALID')

    const { challengeToken } = await (await login(app, 'director')).json()
    clock.advance(5 * 60_000)
    const expired = await app.request('POST', '/auth/sessions:verify-totp', {
      body: { challengeToken, code: await totpCode(DIRECTOR_TOTP_SECRET, clock.now()) },
    })
    expect(expired.status).toBe(401)
    expect(await problemCode(expired)).toBe('CHALLENGE_INVALID')
  })

  it('틀린 코드와 이미 쓴 구간의 코드는 401 TOTP_INVALID', async () => {
    const { app, clock } = setup()
    const { challengeToken } = await (await login(app, 'director')).json()
    const wrong = await app.request('POST', '/auth/sessions:verify-totp', {
      body: { challengeToken, code: await totpCode(DIRECTOR_TOTP_SECRET, clock.now(), 3) },
    })
    expect(wrong.status).toBe(401)
    expect(await problemCode(wrong)).toBe('TOTP_INVALID')

    await signIn(app, 'director', clock.now())
    const again = await (await login(app, 'director')).json()
    const replay = await app.request('POST', '/auth/sessions:verify-totp', {
      body: { challengeToken: again.challengeToken, code: await totpCode(DIRECTOR_TOTP_SECRET, clock.now()) },
    })
    expect(await problemCode(replay)).toBe('TOTP_INVALID')
  })
})

describe('refresh', () => {
  const refresh = (app: ReturnType<typeof setup>['app'], token?: string) =>
    app.request('POST', '/auth/sessions:refresh', token === undefined ? {} : { cookie: `dlude_refresh=${token}` })

  it('회전하면 새 쿠키를 주고, 10초 안의 직전 토큰은 동시 refresh로 받되 쿠키를 바꾸지 않는다', async () => {
    const { app, clock } = setup()
    const { refresh: first } = await signIn(app, 'director', clock.now())

    const rotated = await refresh(app, first)
    expect(rotated.status).toBe(200)
    expect(await rotated.json()).toMatchObject({ expiresIn: 600 })
    const second = refreshCookieOf(rotated)
    expect(second).toBeTruthy()
    expect(second).not.toBe(first)

    // 시계는 실제 시각에 더하므로 경계(10초)보다 조금 안쪽으로 감는다
    clock.advance(9_000)
    const concurrent = await refresh(app, first)
    expect(concurrent.status).toBe(200)
    expect(refreshCookieOf(concurrent)).toBeUndefined()
    const { accessToken } = await concurrent.json()
    expect((await app.request('GET', '/me', { token: accessToken })).status).toBe(200)
  })

  it('10초 밖의 직전 토큰은 401 REFRESH_TOKEN_REUSED이고 세션이 끝난다', async () => {
    const { app, clock } = setup()
    const { refresh: first, accessToken } = await signIn(app, 'director', clock.now())
    const second = refreshCookieOf(await refresh(app, first))!

    clock.advance(10_001)
    const reused = await refresh(app, first)
    expect(reused.status).toBe(401)
    expect(await problemCode(reused)).toBe('REFRESH_TOKEN_REUSED')
    expect(refreshCookieOf(reused)).toBe('')
    expect(await problemCode(await refresh(app, second))).toBe('REFRESH_TOKEN_INVALID')
    expect(await problemCode(await app.request('GET', '/me', { token: accessToken }))).toBe('UNAUTHENTICATED')
  })

  it('쿠키가 없거나 모르는 토큰, 12시간 지난 세션은 401 REFRESH_TOKEN_INVALID', async () => {
    const { app, clock } = setup()
    expect(await problemCode(await refresh(app))).toBe('REFRESH_TOKEN_INVALID')
    expect(await problemCode(await refresh(app, 'unknown'))).toBe('REFRESH_TOKEN_INVALID')

    const { refresh: token } = await signIn(app, 'director', clock.now())
    clock.advance(12 * 3600_000)
    expect(await problemCode(await refresh(app, token))).toBe('REFRESH_TOKEN_INVALID')
  })
})

describe('로그아웃', () => {
  it('204로 쿠키를 지우고 세션을 끝낸다. 다시 불러도 204', async () => {
    const { app, clock } = setup()
    const { accessToken, refresh } = await signIn(app, 'director', clock.now())
    const cookie = `dlude_refresh=${refresh}`

    const response = await app.request('DELETE', '/auth/sessions/current', { cookie })
    expect(response.status).toBe(204)
    expect(refreshCookieOf(response)).toBe('')
    expect(await problemCode(await app.request('GET', '/me', { token: accessToken }))).toBe('UNAUTHENTICATED')
    expect((await app.request('DELETE', '/auth/sessions/current', { cookie })).status).toBe(204)
    expect((await app.request('DELETE', '/auth/sessions/current')).status).toBe(204)
  })

  it('쿠키 없이 access token만으로도 끝낸다', async () => {
    const { app, clock } = setup()
    const { accessToken } = await signIn(app, 'director', clock.now())
    expect((await app.request('DELETE', '/auth/sessions/current', { token: accessToken })).status).toBe(204)
    expect((await app.request('GET', '/me', { token: accessToken })).status).toBe(401)
  })
})

describe('/me', () => {
  it('토큰이 없거나 틀리거나 만료되면 401 UNAUTHENTICATED', async () => {
    const { app, clock } = setup()
    expect(await problemCode(await app.request('GET', '/me'))).toBe('UNAUTHENTICATED')
    expect(await problemCode(await app.request('GET', '/me', { token: 'x.y.z' }))).toBe('UNAUTHENTICATED')

    const { accessToken } = await signIn(app, 'director', clock.now())
    clock.advance(600_000)
    expect(await problemCode(await app.request('GET', '/me', { token: accessToken }))).toBe('UNAUTHENTICATED')
  })
})

describe('TOTP 해제', () => {
  it('원장은 409 TOTP_REQUIRED_FOR_ROLE', async () => {
    const { app, clock } = setup()
    const { accessToken } = await signIn(app, 'director', clock.now())
    clock.advance(30_000)
    const response = await app.request('POST', '/me/totp:disable', {
      token: accessToken,
      body: { code: await totpCode(DIRECTOR_TOTP_SECRET, clock.now()) },
    })
    expect(response.status).toBe(409)
    expect(await problemCode(response)).toBe('TOTP_REQUIRED_FOR_ROLE')
  })

  it('그 밖의 역할은 맞는 코드로 끄고, 다음 로그인에서 다시 등록한다. 틀린 코드는 401 TOTP_INVALID', async () => {
    const { app, clock } = setup()
    const { accessToken, secret } = await signIn(app, 'desk', clock.now())
    clock.advance(30_000)

    const wrong = await app.request('POST', '/me/totp:disable', {
      token: accessToken,
      body: { code: await totpCode(secret, clock.now(), 3) },
    })
    expect(await problemCode(wrong)).toBe('TOTP_INVALID')

    const disabled = await app.request('POST', '/me/totp:disable', {
      token: accessToken,
      body: { code: await totpCode(secret, clock.now()) },
    })
    expect(disabled.status).toBe(204)
    expect((await (await app.request('GET', '/me', { token: accessToken })).json()).totpEnrolled).toBe(false)
    expect((await (await login(app, 'desk')).json()).next).toBe('TOTP_ENROLL')
  })
})
