import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import type { Id } from '../../shared/ids/ids.types.ts'
import { problemType } from '../../shared/problem/problem.ts'

export const SEXES = ['F', 'M'] as const
export type Sex = (typeof SEXES)[number]

/**
 * 환자 (chart.md "용어"). 주민등록번호는 두지 않고 생년월일만 둔다.
 */
export interface Patient {
  id: Id<'patient'>
  /** 병원 안에서 유일한 숫자 문자열. */
  chartNumber: string
  name: string
  /** `YYYY-MM-DD` */
  birthDate: string
  sex: Sex
  /** `010-0000-xxxx` 형식. 시드는 실제로 쓰이지 않는 `010-0000-` 대역만 쓴다. */
  phone: string
  synthetic: boolean
}

/** 목록에 싣는 환자. 전화번호는 뒤 4자리만. */
export interface PatientSummary extends Omit<Patient, 'phone'> {
  phoneLast4: string
}

export function summaryOf({ phone, ...rest }: Patient): PatientSummary {
  return { ...rest, phoneLast4: phone.replaceAll('-', '').slice(-4) }
}

const PatientFields = {
  id: Schema.String,
  chartNumber: Schema.String.annotate({ description: '차트번호. 병원 안에서 유일한 숫자 문자열.' }),
  name: Schema.String,
  birthDate: Schema.String.annotate({ description: '생년월일 `YYYY-MM-DD`. 주민등록번호는 두지 않는다.' }),
  sex: Schema.Literals(SEXES).annotate({ description: '성별. `F` 또는 `M`.' }),
  synthetic: Schema.Boolean.annotate({
    description: '시드가 만든 가상 환자면 `true`. CLOUD AI는 `true`인 환자만 받는다.',
  }),
}

export const PatientSchema = Schema.Struct({
  ...PatientFields,
  phone: Schema.String.annotate({ description: '전화번호 전체.' }),
}).annotate({ identifier: 'Patient', description: '환자. 조회하면 열람 기록이 남는다.' })

export const PatientSummarySchema = Schema.Struct({
  ...PatientFields,
  phoneLast4: Schema.String.annotate({ description: '전화번호 뒤 4자리. 목록에는 전체 번호를 싣지 않는다.' }),
}).annotate({ identifier: 'PatientSummary', description: '목록의 환자.' })

export class PatientNotFound extends HttpApiError.Problem<PatientNotFound>()(
  'PatientNotFound',
  { type: problemType('PATIENT_NOT_FOUND'), status: 404, title: 'Patient not found' },
  { code: Schema.tag('PATIENT_NOT_FOUND') },
  { description: '`PATIENT_NOT_FOUND`: 없는 환자.' },
) {}

/** 예약 (0단계는 시드만. 상태·커맨드는 3단계). */
export interface Appointment {
  id: Id<'appointment'>
  patientId: Id<'patient'>
  /** ISO 8601 */
  startsAt: string
  durationMinutes: number
  procedureCode: string
  status: 'BOOKED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW'
}

/** 치료계획 (0단계는 시드만). */
export interface TreatmentPlan {
  id: Id<'treatmentPlan'>
  patientId: Id<'patient'>
  /** `YYYY-MM-DD` */
  createdOn: string
  status: 'PROPOSED' | 'ACCEPTED' | 'COMPLETED'
  procedureCodes: string[]
}

/** 시술 코드. 참조 데이터이고 가상의 코드와 이름이다. */
export interface ProcedureCode {
  code: string
  name: string
}
