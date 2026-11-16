import { describe, expect, it } from 'vitest'
import { CHART_SEED, generateChartSeed, SEED_PATIENT_COUNT } from './seed.ts'

const TODAY = '2026-11-16'
const data = generateChartSeed(CHART_SEED, TODAY)

describe('Chart 시드', () => {
  it('같은 시드 값이면 같은 결과', () => {
    expect(generateChartSeed(CHART_SEED, TODAY)).toEqual(data)
    expect(generateChartSeed(CHART_SEED + 1, TODAY).patients).not.toEqual(data.patients)
  })

  it('환자 약 200명, 모두 synthetic, 전화는 010-0000- 대역이고 서로 다름', () => {
    expect(data.patients).toHaveLength(SEED_PATIENT_COUNT)
    expect(data.patients.every((each) => each.synthetic)).toBe(true)
    expect(data.patients.every((each) => /^010-0000-\d{4}$/.test(each.phone))).toBe(true)
    expect(new Set(data.patients.map((each) => each.phone)).size).toBe(SEED_PATIENT_COUNT)
    expect(new Set(data.patients.map((each) => each.chartNumber)).size).toBe(SEED_PATIENT_COUNT)
  })

  it('주민등록번호 형식 문자열이 어디에도 없다', () => {
    expect(JSON.stringify(data)).not.toMatch(/\d{6}-\d{7}/)
  })

  it('예약은 환자마다 0~6건, 지난 1년 안. 치료계획은 0~2건', () => {
    const byPatient = (items: ReadonlyArray<{ patientId: string }>) =>
      data.patients.map((patient) => items.filter((each) => each.patientId === patient.id).length)
    expect(Math.max(...byPatient(data.appointments))).toBeLessThanOrEqual(6)
    expect(Math.max(...byPatient(data.treatmentPlans))).toBeLessThanOrEqual(2)
    const yearAgo = Date.parse('2025-11-15T00:00:00Z')
    for (const each of data.appointments) {
      expect(Date.parse(each.startsAt)).toBeGreaterThan(yearAgo)
      expect(Date.parse(each.startsAt)).toBeLessThan(Date.parse(`${TODAY}T00:00:00+09:00`))
    }
    const codes = new Set(data.procedureCodes.map((each) => each.code))
    expect(data.appointments.every((each) => codes.has(each.procedureCode))).toBe(true)
  })

  it('"김" 성과 ID 형식', () => {
    expect(data.patients.some((each) => each.name.startsWith('김'))).toBe(true)
    expect(data.patients.every((each) => /^pat_[0-9A-HJKMNP-TV-Z]{26}$/.test(each.id))).toBe(true)
  })
})
