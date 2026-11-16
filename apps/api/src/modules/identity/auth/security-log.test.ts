import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'
import { afterAll, describe, expect, it } from 'vitest'
import { testApp } from '../../../testing/app.ts'
import { adjustableClock } from '../../../testing/clock.ts'
import { DEFAULT_DEV_PASSWORD } from './auth-config.ts'
import { DIRECTOR_TOTP_SECRET } from '../seed.ts'
import { SeededIdentity, signIn, totpCode } from './testing.ts'

const clock = adjustableClock()
const app = testApp(SeededIdentity, clock.layer)
afterAll(() => app.dispose())

const rows = () =>
  app.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql<Record<string, unknown>>`SELECT * FROM security_events ORDER BY seq`
    }).pipe(Effect.orDie),
  )

describe('보안 기록 (P7)', () => {
  it('열은 시각·종류·직원·세션·이유뿐이다', async () => {
    const columns = await app.run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ name: string }>`SELECT name FROM pragma_table_info('security_events')`
      }).pipe(Effect.orDie),
    )
    expect(columns.map((each) => each.name)).toEqual(['seq', 'time', 'type', 'staff_id', 'session_id', 'reason'])
  })

  it('로그인·실패·refresh·로그아웃을 거쳐도 비밀번호, 코드, 토큰 값이 행에 없다', async () => {
    const wrongPassword = 'wrong-password-value'
    await app.request('POST', '/auth/sessions', { body: { loginId: 'director', password: wrongPassword } })
    const { challengeToken } = await (
      await app.request('POST', '/auth/sessions', { body: { loginId: 'director', password: DEFAULT_DEV_PASSWORD } })
    ).json()
    const wrongCode = await totpCode(DIRECTOR_TOTP_SECRET, clock.now(), 3)
    await app.request('POST', '/auth/sessions:verify-totp', { body: { challengeToken, code: wrongCode } })

    const session = await signIn(app, 'desk', clock.now())
    const refreshed = await app.request('POST', '/auth/sessions:refresh', {
      cookie: `dlude_refresh=${session.refresh}`,
    })
    const { accessToken } = await refreshed.json()
    await app.request('DELETE', '/auth/sessions/current', { token: accessToken })

    const stored = JSON.stringify(await rows())
    expect((await rows()).map((each) => each['type'])).toEqual([
      'LOGIN_FAILED',
      'TOTP_FAILED',
      'TOTP_ENROLLED',
      'LOGIN_SUCCEEDED',
      'LOGGED_OUT',
    ])
    for (const secret of [
      wrongPassword,
      DEFAULT_DEV_PASSWORD,
      wrongCode,
      challengeToken,
      session.refresh,
      session.accessToken,
      accessToken,
      session.secret,
    ]) {
      expect(stored).not.toContain(secret)
    }
  })
})
