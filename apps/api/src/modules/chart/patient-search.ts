// hemr@0c4b7e8 src/modules/patients/patient.ts(initialsOf·classifyQuery)와 patient-repository.ts(queryCondition)를 바탕으로 함
import type { SqlClient } from 'effect/sql'

const INITIALS = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'

/** 이름의 초성. 한글 음절은 초성으로, 나머지 글자는 소문자로 둔다. 예: `김하늘` → `ㄱㅎㄴ` */
export function initialsOf(name: string): string {
  return [...name]
    .map((char) => {
      const code = char.charCodeAt(0) - 0xac00
      return code >= 0 && code < 11172 ? INITIALS[Math.floor(code / 588)] : char.toLowerCase()
    })
    .join('')
}

/** 검색에 쓰는 전화번호. 숫자만 남긴다. 예: `010-0000-1234` → `01000001234` */
export const phoneDigitsOf = (phone: string): string => phone.replace(/\D/g, '')

/**
 * 검색어의 종류 (chart.md "0단계 엔드포인트" `q`).
 *
 * - 숫자 4자리: 전화번호 뒤 4자리이거나 차트번호 앞부분
 * - 그 밖의 숫자(`-` 허용): 차트번호 앞부분
 * - 초성만: 이름 초성 부분 일치
 * - 그 밖: 이름 부분 일치(대소문자 무시)
 */
export type PatientQuery =
  { kind: 'DIGITS'; digits: string } | { kind: 'INITIALS'; initials: string } | { kind: 'TEXT'; text: string }

export function classifyQuery(q: string | undefined): PatientQuery | null {
  const trimmed = (q ?? '').trim()
  if (trimmed === '') return null
  const digits = trimmed.replaceAll('-', '')
  if (/^\d+$/.test(digits)) return { kind: 'DIGITS', digits }
  if (/^[ㄱ-ㅎ]+$/.test(trimmed)) return { kind: 'INITIALS', initials: trimmed }
  return { kind: 'TEXT', text: trimmed.toLowerCase() }
}

/** `LIKE`의 특수 문자를 글자 그대로 찾도록 막는다. 조건에 `ESCAPE '\'`를 붙여 쓴다. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

/** 검색어의 SQL 조건. `chart_patients`의 `name_folded`·`name_initials`·`phone_digits`를 쓴다. */
export function queryCondition(sql: SqlClient.SqlClient, query: PatientQuery) {
  switch (query.kind) {
    case 'DIGITS': {
      const digits = escapeLike(query.digits)
      return query.digits.length === 4
        ? sql`(chart_number LIKE ${`${digits}%`} ESCAPE '\\' OR phone_digits LIKE ${`%${digits}`} ESCAPE '\\')`
        : sql`chart_number LIKE ${`${digits}%`} ESCAPE '\\'`
    }
    case 'INITIALS':
      return sql`name_initials LIKE ${`%${escapeLike(query.initials)}%`} ESCAPE '\\'`
    case 'TEXT':
      // SQLite의 `lower()`는 ASCII만 바꾸므로 저장할 때 JS로 소문자로 바꾼 `name_folded`를 찾는다
      return sql`name_folded LIKE ${`%${escapeLike(query.text)}%`} ESCAPE '\\'`
  }
}
