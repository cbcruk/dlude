import { Effect } from 'effect'

/**
 * 감사 기록에 남길 내용 해시(SHA-256, 16진). 본문 대신 해시만 남겨 바뀌었는지는 알되 무엇인지는 남기지 않는다(P7).
 * 키 순서와 상관없이 같은 값이면 같은 해시가 나오도록 키를 정렬해 직렬화한다.
 */
export const contentHash = (value: unknown): Effect.Effect<string> =>
  Effect.promise(async () => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(value)))
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  })

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  )
}
