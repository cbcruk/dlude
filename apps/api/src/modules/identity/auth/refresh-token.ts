// hemr@0c4b7e8 src/modules/identity/auth/refresh-token.ts를 바탕으로 WebCrypto로 바꿈
import { Effect } from 'effect'
import { randomBytes, toBase64Url, utf8 } from './bytes.ts'

/** 새 refresh token. 256비트 난수이고 쿠키로만 오간다. */
export const newRefreshToken = (): string => toBase64Url(randomBytes(32))

/** 저장소에는 원문 대신 SHA-256 값만 둔다. DB가 새도 토큰을 쓸 수 없다. */
export const refreshTokenHash = (token: string) =>
  Effect.promise(async () => toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(token)))))
