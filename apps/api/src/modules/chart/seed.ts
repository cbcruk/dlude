import { Clock, Effect } from 'effect'
import { encodeTime } from 'ulid'
import { Transaction } from '../../shared/db/transaction.ts'
import { ID_PREFIXES } from '../../shared/ids/ids.ts'
import type { Id, IdKind } from '../../shared/ids/ids.types.ts'
import { clinicDate } from '../../shared/time/clinic-date.ts'
import type { Appointment, Patient, ProcedureCode, Sex, TreatmentPlan } from './patient.ts'
import { PatientRepository } from './patient-repository.ts'

/** 시드 값. 같으면 같은 데이터가 나온다(chart.md "시드"). */
export const CHART_SEED = 20261116
export const SEED_PATIENT_COUNT = 200

/** 가상의 시술 코드. 실제 수가 코드가 아니다. */
export const SEED_PROCEDURE_CODES: ReadonlyArray<ProcedureCode> = [
  { code: 'V-CK01', name: '정기 검진' },
  { code: 'V-SC01', name: '스케일링' },
  { code: 'V-XR01', name: '파노라마 촬영' },
  { code: 'V-RS01', name: '레진 충전' },
  { code: 'V-RC01', name: '신경치료' },
  { code: 'V-CR01', name: '크라운' },
  { code: 'V-EX01', name: '발치' },
  { code: 'V-IM01', name: '임플란트' },
]

// 흔한 성과 이름 음절. 조합은 결정적 난수로 고르므로 실제 인물과 관계없다
const SURNAMES = '김김김이이박박최정강조윤장임한오서신권황안송류홍'
const GIVEN = '민서준지하윤도현우예수진은채유연아시원재영성호경혜'

/** mulberry32. 작은 결정적 난수기. [0, 1) */
function random(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
/** ID 시각. 결정적이어야 해서 고정한다. */
const ID_TIME = Date.parse('2026-01-01T00:00:00.000Z')

export interface ChartSeed {
  procedureCodes: ReadonlyArray<ProcedureCode>
  patients: Patient[]
  appointments: Appointment[]
  treatmentPlans: TreatmentPlan[]
}

/**
 * 가상 환자 약 200명과 지난 1년 예약(환자마다 0~6건), 치료계획(0~2건)을 만든다. 순수 함수다: 같은 `seed`와 `today`면
 * 같은 결과. 전화번호는 실제로 쓰이지 않는 `010-0000-` 대역이고 주민등록번호는 만들지 않는다. 모두 `synthetic: true`.
 */
export function generateChartSeed(seed: number, today: string): ChartSeed {
  const next = random(seed)
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1))
  const pick = <A>(items: ArrayLike<A>): A => items[Math.floor(next() * items.length)]!
  let sequence = 0
  const id = <K extends IdKind>(kind: K): Id<K> => {
    sequence += 1
    const randomPart = Array.from({ length: 16 }, () => pick(CROCKFORD)).join('')
    return `${ID_PREFIXES[kind]}_${encodeTime(ID_TIME + sequence, 10)}${randomPart}` as Id<K>
  }
  const daysAgo = (days: number) => {
    const date = new Date(`${today}T00:00:00.000Z`)
    date.setUTCDate(date.getUTCDate() - days)
    return date.toISOString().slice(0, 10)
  }

  const usedPhones = new Set<string>()
  const patients: Patient[] = []
  const appointments: Appointment[] = []
  const treatmentPlans: TreatmentPlan[] = []

  for (let index = 0; index < SEED_PATIENT_COUNT; index++) {
    let last4: string
    do last4 = String(int(0, 9999)).padStart(4, '0')
    while (usedPhones.has(last4))
    usedPhones.add(last4)
    const sex: Sex = next() < 0.5 ? 'F' : 'M'
    const birth = new Date(Date.UTC(int(1950, 2018), int(0, 11), int(1, 28)))
    const patient: Patient = {
      id: id('patient'),
      chartNumber: String(10001 + index),
      name: pick(SURNAMES) + pick(GIVEN) + pick(GIVEN),
      birthDate: birth.toISOString().slice(0, 10),
      sex,
      phone: `010-0000-${last4}`,
      synthetic: true,
    }
    patients.push(patient)

    for (let count = int(0, 6); count > 0; count--) {
      const day = daysAgo(int(1, 365))
      const hour = String(int(9, 17)).padStart(2, '0')
      const roll = next()
      appointments.push({
        id: id('appointment'),
        patientId: patient.id,
        startsAt: new Date(`${day}T${hour}:${pick(['00', '30'])}:00+09:00`).toISOString(),
        durationMinutes: pick([30, 30, 60]),
        procedureCode: pick(SEED_PROCEDURE_CODES).code,
        status: roll < 0.85 ? 'COMPLETED' : roll < 0.95 ? 'CANCELLED' : 'NO_SHOW',
      })
    }
    for (let count = int(0, 2); count > 0; count--) {
      const roll = next()
      treatmentPlans.push({
        id: id('treatmentPlan'),
        patientId: patient.id,
        createdOn: daysAgo(int(1, 365)),
        status: roll < 0.3 ? 'PROPOSED' : roll < 0.7 ? 'ACCEPTED' : 'COMPLETED',
        procedureCodes: Array.from({ length: int(1, 3) }, () => pick(SEED_PROCEDURE_CODES).code),
      })
    }
  }
  return { procedureCodes: SEED_PROCEDURE_CODES, patients, appointments, treatmentPlans }
}

/** 환자 표가 비어 있으면 시드를 넣는다. 한 트랜잭션. 시드 값은 고정이고 예약 날짜만 오늘에 맞춘다. */
export const seedChart = Effect.gen(function* () {
  const repository = yield* PatientRepository
  if ((yield* repository.countPatients()) > 0) return
  const transaction = yield* Transaction
  const data = generateChartSeed(CHART_SEED, clinicDate(yield* Clock.currentTimeMillis))
  yield* transaction.run(
    Effect.gen(function* () {
      yield* Effect.forEach(data.procedureCodes, repository.saveProcedureCode, { discard: true })
      yield* Effect.forEach(data.patients, repository.savePatient, { discard: true })
      yield* Effect.forEach(data.appointments, repository.saveAppointment, { discard: true })
      yield* Effect.forEach(data.treatmentPlans, repository.saveTreatmentPlan, { discard: true })
    }),
  )
})
