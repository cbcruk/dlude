/** 인증 코드가 쓰는 바이트 변환. WebCrypto만 써서 Node와 workerd에서 같은 코드가 돈다(F5). */

export const utf8 = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text)

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/** 잘못된 문자가 있으면 `null`. */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null
  const base64 = text.replaceAll('-', '+').replaceAll('_', '/')
  try {
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    return Uint8Array.from(binary, (char) => char.charCodeAt(0))
  } catch {
    return null
  }
}

export const randomBytes = (length: number): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(length))

/** 길이가 같을 때 내용과 상관없이 같은 시간에 비교한다. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}
