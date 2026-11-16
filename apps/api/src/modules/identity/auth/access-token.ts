// hemr@0c4b7e8 src/modules/identity/auth/access-token.ts를 바탕으로 테넌트(`tid`)를 빼고 WebCrypto로 바꿈
import { Effect, Option, Redacted } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { constantTimeEqual, fromBase64Url, toBase64Url, utf8 } from './bytes.ts'

/** access token 유효 시간. 10분(identity-access.md). */
export const ACCESS_TOKEN_TTL_SECONDS = 600

/** access token에 담는 값. 권한은 담지 않고 요청마다 역할에서 계산한다. */
export interface AccessClaims {
  sub: Id<'staff'>
  /** 세션. 폐기한 세션의 토큰은 만료 전이라도 받지 않는다(검증하는 쪽이 저장소를 본다). */
  sid: Id<'session'>
  /** 발급·만료 시각(epoch 초). */
  iat: number
  exp: number
}

const HEADER = toBase64Url(utf8(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))

const sign = (secret: Redacted.Redacted<string>, body: string) =>
  Effect.promise(async () => {
    const key = await crypto.subtle.importKey(
      'raw',
      utf8(Redacted.value(secret)),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(body))))
  })

/** HS256 JWT로 서명한다. DO 하나가 발급과 검증을 함께 하므로 대칭 키로 충분하다. */
export const signAccessToken = (secret: Redacted.Redacted<string>, claims: AccessClaims) =>
  Effect.gen(function* () {
    const body = `${HEADER}.${toBase64Url(utf8(JSON.stringify(claims)))}`
    return `${body}.${yield* sign(secret, body)}`
  })

/** 서명과 만료를 확인한다. 헤더가 다르거나(알고리즘 바꿔치기), 서명이 틀리거나, 만료됐으면 `none`. */
export const verifyAccessToken = (secret: Redacted.Redacted<string>, token: string, nowMillis: number) =>
  Effect.gen(function* () {
    const [header, payload, signature, ...rest] = token.split('.')
    if (header !== HEADER || payload === undefined || signature === undefined || rest.length > 0) {
      return Option.none<AccessClaims>()
    }
    // 디코딩한 바이트가 아니라 문자열을 비교한다. 디코더가 너그러우면 다른 문자열도 통과할 수 있다
    const expected = yield* sign(secret, `${header}.${payload}`)
    if (!constantTimeEqual(utf8(signature), utf8(expected))) return Option.none<AccessClaims>()
    const decoded = fromBase64Url(payload)
    if (decoded === null) return Option.none<AccessClaims>()
    try {
      const claims = JSON.parse(new TextDecoder().decode(decoded)) as AccessClaims
      return typeof claims.exp === 'number' && nowMillis < claims.exp * 1000
        ? Option.some(claims)
        : Option.none<AccessClaims>()
    } catch {
      return Option.none<AccessClaims>()
    }
  })
