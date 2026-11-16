import { Effect, Option, Redacted } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { signAccessToken, verifyAccessToken } from './access-token.ts'
import { toBase64Url, utf8 } from './bytes.ts'
import { newRefreshToken, refreshTokenHash } from './refresh-token.ts'
import { generateDataKey, open, seal } from './secret-box.ts'

const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect)
const secret = Redacted.make('test-jwt-secret')
const claims = {
  sub: 'stf_01JBQ000000000000000000001' as Id<'staff'>,
  sid: 'ses_01JBQ000000000000000000001' as Id<'session'>,
  iat: 1_000,
  exp: 1_600,
}

describe('access token (HS256)', () => {
  it('서명한 값을 만료 전에 그대로 읽는다', async () => {
    const token = await run(signAccessToken(secret, claims))
    expect(await run(verifyAccessToken(secret, token, 1_599_999))).toEqual(Option.some(claims))
  })

  it('만료 시각부터는 받지 않는다', async () => {
    const token = await run(signAccessToken(secret, claims))
    expect(Option.isNone(await run(verifyAccessToken(secret, token, 1_600_000)))).toBe(true)
  })

  it('다른 키, 바꾼 본문, 알고리즘 바꿔치기, 덧붙인 조각은 받지 않는다', async () => {
    const token = await run(signAccessToken(secret, claims))
    const [header, payload, signature] = token.split('.')
    const forged = `${header}.${toBase64Url(utf8(JSON.stringify({ ...claims, sub: 'stf_other' })))}.${signature}`
    const none = toBase64Url(utf8(JSON.stringify({ alg: 'none', typ: 'JWT' })))
    const cases: Array<[Redacted.Redacted<string>, string]> = [
      [Redacted.make('other'), token],
      [secret, forged],
      [secret, `${none}.${payload}.`],
      [secret, `${token}.extra`],
    ]
    for (const [key, value] of cases) {
      expect(Option.isNone(await run(verifyAccessToken(key, value, 1_000_000)))).toBe(true)
    }
  })
})

describe('refresh token', () => {
  it('256비트 난수이고 저장은 SHA-256 해시', async () => {
    const token = newRefreshToken()
    expect(token).toMatch(/^[\w-]{43}$/)
    expect(newRefreshToken()).not.toBe(token)
    const hash = await run(refreshTokenHash(token))
    expect(hash).toMatch(/^[\w-]{43}$/)
    expect(hash).not.toBe(token)
    expect(await run(refreshTokenHash(token))).toBe(hash)
  })
})

describe('secret-box (AES-GCM)', () => {
  const key = Redacted.make(generateDataKey())

  it('봉인한 값을 같은 키로 연다', async () => {
    const sealed = await run(seal(key, 'JBSWY3DPEHPK3PXP'))
    expect(sealed.startsWith('v1.')).toBe(true)
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP')
    expect(await run(open(key, sealed))).toEqual(Option.some('JBSWY3DPEHPK3PXP'))
  })

  it('다른 키나 바뀐 내용은 열지 않는다', async () => {
    const sealed = await run(seal(key, 'secret'))
    expect(Option.isNone(await run(open(Redacted.make(generateDataKey()), sealed)))).toBe(true)
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'BB' : 'AA')
    expect(Option.isNone(await run(open(key, tampered)))).toBe(true)
    expect(Option.isNone(await run(open(key, 'v2.x.y')))).toBe(true)
  })
})
