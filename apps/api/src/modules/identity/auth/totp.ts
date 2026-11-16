import { Effect } from 'effect'
import { constantTimeEqual, randomBytes, utf8 } from './bytes.ts'

/**
 * TOTP (RFC 6238, HMAC-SHA1, 30초, 6자리). 인증 앱(Google Authenticator 등)의 기본값과 같다.
 * 비밀 값은 base32 문자열로 다룬다.
 */
export const TOTP_PERIOD_SECONDS = 30
export const TOTP_DIGITS = 6
/** 앞뒤로 허용하는 구간 수. 단말 시계가 조금 어긋나도 받는다(identity-access.md). */
export const TOTP_WINDOW = 1

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31]
  return output
}

/** 공백·소문자·패딩을 받는다. 잘못된 문자가 있으면 `null`. */
export function base32Decode(text: string): Uint8Array<ArrayBuffer> | null {
  const clean = text.replace(/[\s=]/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const output: number[] = []
  for (const char of clean) {
    const index = BASE32.indexOf(char)
    if (index < 0) return null
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Uint8Array.from(output)
}

/** 새 비밀 값. 160비트(RFC 4226 권장). */
export const generateTotpSecret = (): string => base32Encode(randomBytes(20))

/** 인증 앱에 등록하는 URI. QR로 보여 준다. */
export function otpauthUri(secret: string, account: string, issuer = 'dlude'): string {
  const label = encodeURIComponent(`${issuer}:${account}`)
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  })
  return `otpauth://totp/${label}?${params}`
}

/** 시각(epoch 밀리초)의 30초 구간 번호. */
export const totpStep = (nowMillis: number): number => Math.floor(nowMillis / 1000 / TOTP_PERIOD_SECONDS)

/** 구간 번호의 코드(RFC 4226 HOTP). */
export const hotp = (secret: Uint8Array<ArrayBuffer>, counter: number, digits: number = TOTP_DIGITS) =>
  Effect.promise(async () => {
    const message = new Uint8Array(8)
    new DataView(message.buffer).setBigUint64(0, BigInt(counter))
    const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, message))
    const offset = mac[mac.length - 1]! & 0x0f
    const binary = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!
    return String(binary % 10 ** digits).padStart(digits, '0')
  })

/**
 * 코드가 맞은 구간 번호. 지금 구간과 앞뒤 `TOTP_WINDOW` 구간을 본다. 맞는 구간이 없거나 형식이 틀리면 `null`.
 * 같은 구간 코드를 두 번 받지 않는 판정은 이 번호로 판정 함수가 한다.
 */
export const matchTotp = (secret: string, code: string, nowMillis: number) =>
  Effect.gen(function* () {
    const key = base32Decode(secret)
    if (key === null || key.length === 0 || !/^\d{6}$/.test(code)) return null
    const current = totpStep(nowMillis)
    let matched: number | null = null
    // 일치해도 멈추지 않고 모든 구간을 계산해 응답 시간이 일치 위치를 드러내지 않게 한다
    for (let step = current - TOTP_WINDOW; step <= current + TOTP_WINDOW; step++) {
      if (constantTimeEqual(utf8(yield* hotp(key, step)), utf8(code)) && matched === null) matched = step
    }
    return matched
  })
