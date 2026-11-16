// from hemr@0c4b7e8 src/shared/ids/ids.ts — 접두사를 dlude 것으로 바꿈(docs/design/conventions.md "ID 접두사")
import { monotonicFactory, ulid } from 'ulid'
import type { Id, IdKind } from './ids.types.ts'

/**
 * API에 노출하는 엔터티 종류별 ID 접두사.
 *
 * 새 접두사는 그 컨텍스트 문서의 용어 표에 먼저 올린다(`docs/design/conventions.md`).
 */
export const ID_PREFIXES = {
  staff: 'stf',
  session: 'ses',
  loginChallenge: 'chl',
  patient: 'pat',
  appointment: 'apt',
  treatmentPlan: 'tpl',
  event: 'evt',
  job: 'job',
} as const

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/

/** 주어진 엔터티 종류의 새 ID. 예: `newId('patient')` → `pat_01J...` */
export function newId<K extends IdKind>(kind: K, time?: number): Id<K> {
  return `${ID_PREFIXES[kind]}_${ulid(time)}` as Id<K>
}

/**
 * 같은 시각의 새 ID `count`개를 만든 순서대로 커지게 만든다. 한 요청에서 만든 여러 행을 ID 순으로 읽어도 요청
 * 순서가 유지된다. `newId`는 같은 밀리초 안에서 순서가 무작위다.
 */
export function newIds<K extends IdKind>(kind: K, count: number, time: number): Array<Id<K>> {
  const next = monotonicFactory()
  return Array.from({ length: count }, () => `${ID_PREFIXES[kind]}_${next(time)}` as Id<K>)
}

/** 값이 주어진 종류의 올바른 형식 ID인지. 클라이언트가 보낸 ID는 그대로 믿지 않고 형식을 검사한다. */
export function isId<K extends IdKind>(kind: K, value: unknown): value is Id<K> {
  if (typeof value !== 'string') return false
  const prefix = `${ID_PREFIXES[kind]}_`
  return value.startsWith(prefix) && ULID_PATTERN.test(value.slice(prefix.length))
}
