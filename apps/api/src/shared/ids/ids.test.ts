import { describe, expect, it } from 'vitest'
import { ID_PREFIXES, isId, newId, newIds } from './ids.ts'

describe('ID_PREFIXES', () => {
  it('conventions.md의 0단계 접두사 표와 같다', () => {
    expect(Object.values(ID_PREFIXES).sort()).toEqual(['apt', 'chl', 'evt', 'job', 'pat', 'ses', 'stf', 'tpl'])
  })
})

describe('newId', () => {
  it('ULID 앞에 엔터티 종류 접두사를 붙인다', () => {
    expect(newId('patient')).toMatch(/^pat_[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(newId('staff')).toMatch(/^stf_/)
  })

  it('만든 시각 순으로 정렬된다', () => {
    expect(newId('session', 1_000) < newId('session', 2_000)).toBe(true)
  })
})

describe('newIds', () => {
  it('같은 시각이어도 만든 순서대로 커진다', () => {
    const ids = newIds('event', 5, 1_000)
    expect([...ids].sort()).toEqual(ids)
  })
})

describe('isId', () => {
  it('같은 종류의 ID를 받는다', () => {
    expect(isId('session', newId('session'))).toBe(true)
  })

  it('다른 종류의 ID는 거부한다', () => {
    expect(isId('session', newId('patient'))).toBe(false)
  })

  it('형식이 틀린 값은 거부한다', () => {
    expect(isId('session', 'ses_123')).toBe(false)
    expect(isId('session', 42)).toBe(false)
  })
})
