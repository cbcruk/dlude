import { Effect, Layer, ManagedRuntime } from 'effect'
import { afterAll, describe, expect, it } from 'vitest'
import type { Id } from '../../shared/ids/ids.types.ts'
import { TestSql } from '../../testing/sql.ts'
import type { Patient } from './patient.ts'
import { classifyQuery, initialsOf } from './patient-search.ts'
import { PatientRepository } from './patient-repository.ts'

const patient = (n: number, name: string, phone: string): Patient => ({
  id: `pat_01JBQ0000000000000000000${String(n).padStart(2, '0')}` as Id<'patient'>,
  chartNumber: String(10000 + n),
  name,
  birthDate: '1990-01-01',
  sex: 'F',
  phone,
  synthetic: true,
})

const PATIENTS = [
  patient(1, '김하늘', '010-0000-1234'),
  patient(2, '김민준', '010-0000-5678'),
  patient(3, '박서준', '010-0000-1010'),
  patient(4, '이은채', '010-0000-1234'.replace('1234', '9999')),
]

const runtime = ManagedRuntime.make(
  Layer.effectDiscard(Effect.forEach(PATIENTS, (each) => PatientRepository.use((r) => r.savePatient(each)))).pipe(
    Layer.provideMerge(PatientRepository.layer),
    Layer.provide(TestSql()),
  ),
)
afterAll(() => runtime.dispose())

const search = (q: string) =>
  runtime.runPromise(
    PatientRepository.use((r) => r.searchPatients({ query: classifyQuery(q), after: null, limit: 50 })).pipe(
      Effect.map((rows) => rows.map((row) => row.name)),
    ),
  )

describe('initialsOf', () => {
  it('한글 음절은 초성으로, 나머지는 소문자로', () => {
    expect(initialsOf('김하늘')).toBe('ㄱㅎㄴ')
    expect(initialsOf('Kim김')).toBe('kimㄱ')
  })
})

describe('환자 검색', () => {
  it('이름 부분 일치', async () => {
    expect(await search('김')).toEqual(['김민준', '김하늘'])
    expect(await search('서준')).toEqual(['박서준'])
  })

  it('초성', async () => {
    expect(await search('ㄱㅎ')).toEqual(['김하늘'])
    expect(await search('ㅅㅈ')).toEqual(['박서준'])
  })

  it('차트번호 앞부분', async () => {
    expect(await search('10003')).toEqual(['박서준'])
    expect(await search('1000')).toEqual(['김민준', '김하늘', '박서준', '이은채'])
  })

  it('전화번호 뒤 4자리', async () => {
    expect(await search('1234')).toEqual(['김하늘'])
    expect(await search('9999')).toEqual(['이은채'])
  })

  it('LIKE 특수 문자는 글자 그대로', async () => {
    expect(await search('%')).toEqual([])
    expect(await search('_')).toEqual([])
  })

  it('빈 검색어는 전체', async () => {
    expect(classifyQuery('  ')).toBeNull()
    expect(await search('')).toHaveLength(4)
  })
})
