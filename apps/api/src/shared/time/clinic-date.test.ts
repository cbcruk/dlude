import { describe, expect, it } from 'vitest'
import { clinicDate, clinicDayRange, clinicTime } from './clinic-date.ts'

describe('clinicDate', () => {
  it('UTC가 아니라 병원 시간대를 쓴다', () => {
    // UTC 2026-11-04 15:00은 서울 2026-11-05 00:00이다.
    expect(clinicDate(Date.UTC(2026, 10, 4, 15, 0))).toBe('2026-11-05')
    expect(clinicDate(Date.UTC(2026, 10, 4, 14, 59))).toBe('2026-11-04')
  })
})

describe('clinicTime', () => {
  it('병원 시간대와 24시간제를 쓴다', () => {
    expect(clinicTime(Date.UTC(2026, 10, 4, 15, 0))).toBe('00:00')
    expect(clinicTime(Date.UTC(2026, 10, 4, 14, 59))).toBe('23:59')
  })
})

describe('clinicDayRange', () => {
  it('서울 자정부터 다음 자정 전까지를 덮는다', () => {
    const range = clinicDayRange('2026-11-07')
    expect(range).toEqual({ from: '2026-11-06T15:00:00.000Z', to: '2026-11-07T15:00:00.000Z' })
    expect(clinicDate(Date.parse('2026-11-07T14:59:59.999Z'))).toBe('2026-11-07')
    expect(clinicDate(Date.parse(range.to))).toBe('2026-11-08')
  })
})
