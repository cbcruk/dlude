import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { DUMMY_PASSWORD_HASH, hashPassword, PBKDF2_ITERATIONS, verifyPassword } from './password.ts'

const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect)

describe('비밀번호 해시 (PBKDF2-SHA256)', () => {
  it('반복 횟수가 해시 문자열에 들어간다', async () => {
    const [scheme, iterations, salt, hash] = (await run(hashPassword('dlude-dev-password'))).split('$')
    expect({ scheme, iterations }).toEqual({ scheme: 'pbkdf2-sha256', iterations: String(PBKDF2_ITERATIONS) })
    expect(salt).toMatch(/^[\w-]+$/)
    expect(hash).toMatch(/^[\w-]+$/)
  })

  it('같은 비밀번호만 맞는다', async () => {
    const hash = await run(hashPassword('dlude-dev-password'))
    expect(await run(verifyPassword('dlude-dev-password', hash))).toBe(true)
    expect(await run(verifyPassword('dlude-dev-passwore', hash))).toBe(false)
  })

  it('다른 반복 횟수로 만든 해시도 검증한다(나중에 반복을 바꿔도 이전 해시가 맞음)', async () => {
    const hash = await run(hashPassword('pw', 1_000))
    expect(hash.split('$')[1]).toBe('1000')
    expect(await run(verifyPassword('pw', hash))).toBe(true)
  })

  it('형식이 틀리거나 상한을 넘는 반복의 해시는 어떤 비밀번호와도 맞지 않는다', async () => {
    const malformed = ['', 'scrypt$1$a$b', 'pbkdf2-sha256$x$AA$AA', 'pbkdf2-sha256$100001$AA$AA', 'pbkdf2-sha256$1$$']
    for (const stored of malformed) {
      expect(await run(verifyPassword('pw', stored))).toBe(false)
    }
  })

  it('고정 해시는 형식이 맞고 어떤 비밀번호와도 맞지 않는다', async () => {
    expect(DUMMY_PASSWORD_HASH.split('$')).toHaveLength(4)
    expect(await run(verifyPassword('dlude-dev-password', DUMMY_PASSWORD_HASH))).toBe(false)
  })
})
