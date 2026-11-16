import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { utf8 } from './bytes.ts'
import { base32Decode, base32Encode, generateTotpSecret, hotp, matchTotp, otpauthUri, totpStep } from './totp.ts'

const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect)

describe('hotp (RFC 6238 부록 B, SHA1)', () => {
  // 비밀 값은 ASCII "12345678901234567890", 8자리
  const secret = utf8('12345678901234567890')
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('T=%i초면 %s', async (seconds, expected) => {
    expect(await run(hotp(secret, totpStep(seconds * 1000), 8))).toBe(expected)
  })
})

describe('base32', () => {
  it('RFC 4648 예시와 같다', () => {
    expect(base32Encode(utf8('foobar'))).toBe('MZXW6YTBOI')
    expect(base32Decode('mzxw6ytboi======')).toEqual(utf8('foobar'))
  })

  it('잘못된 문자는 null', () => {
    expect(base32Decode('MZ1W')).toBeNull()
  })

  it('새 비밀 값은 160비트(32글자)', () => {
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/)
  })
})

describe('matchTotp', () => {
  const secret = base32Encode(utf8('12345678901234567890'))
  const now = 1111111111 * 1000
  const codeAt = (step: number) => run(hotp(base32Decode(secret)!, step))

  it('지금 구간의 코드면 그 구간 번호', async () => {
    expect(await run(matchTotp(secret, await codeAt(totpStep(now)), now))).toBe(totpStep(now))
  })

  it('앞뒤 한 구간까지 받는다', async () => {
    const step = totpStep(now)
    expect(await run(matchTotp(secret, await codeAt(step - 1), now))).toBe(step - 1)
    expect(await run(matchTotp(secret, await codeAt(step + 1), now))).toBe(step + 1)
  })

  it('두 구간 떨어진 코드는 받지 않는다', async () => {
    expect(await run(matchTotp(secret, await codeAt(totpStep(now) - 2), now))).toBeNull()
  })

  it('6자리 숫자가 아니면 null', async () => {
    expect(await run(matchTotp(secret, '12345', now))).toBeNull()
    expect(await run(matchTotp(secret, 'abcdef', now))).toBeNull()
  })
})

describe('otpauthUri', () => {
  it('인증 앱이 읽는 형식', () => {
    expect(otpauthUri('JBSWY3DPEHPK3PXP', 'desk')).toBe(
      'otpauth://totp/dlude%3Adesk?secret=JBSWY3DPEHPK3PXP&issuer=dlude&algorithm=SHA1&digits=6&period=30',
    )
  })
})
