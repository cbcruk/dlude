// hemr@0c4b7e8 src/modules/identity/auth/password.ts를 바탕으로 scrypt → PBKDF2-SHA256(WebCrypto)로 바꿈(F5)
import { Effect } from 'effect'
import { constantTimeEqual, fromBase64Url, randomBytes, toBase64Url, utf8 } from './bytes.ts'

/**
 * 비밀번호 해시. 저장 형식은 `pbkdf2-sha256$반복$salt$hash`(salt·hash는 base64url)라 반복 횟수를 바꿔도 이전 해시를
 * 그대로 검증한다.
 *
 * 반복 횟수 100,000은 workerd가 허용하는 PBKDF2 상한이다. 개인 단계 배포에서 CPU 시간을 재서 확정한다(작업 11).
 */
export const PBKDF2_ITERATIONS = 100_000
const KEY_BITS = 256

const derive = (password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) =>
  Effect.promise(async () => {
    const key = await crypto.subtle.importKey('raw', utf8(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits'])
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, KEY_BITS)
    return new Uint8Array(bits)
  })

export const hashPassword = (password: string, iterations: number = PBKDF2_ITERATIONS) =>
  Effect.gen(function* () {
    const salt = randomBytes(16)
    const key = yield* derive(password, salt, iterations)
    return ['pbkdf2-sha256', iterations, toBase64Url(salt), toBase64Url(key)].join('$')
  })

/** 저장한 해시와 맞는지. 형식이 잘못된 해시는 어떤 비밀번호와도 맞지 않는다. */
export const verifyPassword = (password: string, stored: string) =>
  Effect.gen(function* () {
    const [scheme, rawIterations, rawSalt, rawHash, ...rest] = stored.split('$')
    const iterations = Number(rawIterations)
    const salt = fromBase64Url(rawSalt ?? '')
    const expected = fromBase64Url(rawHash ?? '')
    const valid =
      scheme === 'pbkdf2-sha256' &&
      rest.length === 0 &&
      Number.isSafeInteger(iterations) &&
      iterations > 0 &&
      iterations <= PBKDF2_ITERATIONS &&
      salt !== null &&
      salt.length > 0 &&
      expected !== null &&
      expected.length > 0
    if (!valid) return false
    return constantTimeEqual(yield* derive(password, salt, iterations), expected)
  })

/**
 * 없는 아이디도 이 해시로 검증해 응답 시간으로 아이디가 있는지 드러나지 않게 한다. 어떤 비밀번호와도 맞지 않는다
 * (salt·hash가 정해진 값이고 원래 비밀번호는 버렸다).
 */
export const DUMMY_PASSWORD_HASH = `pbkdf2-sha256$${PBKDF2_ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`
