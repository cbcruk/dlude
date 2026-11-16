import { Context, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'
import type { Id } from '../../shared/ids/ids.types.ts'
import type { Appointment, Patient, ProcedureCode, TreatmentPlan } from './patient.ts'
import { initialsOf, phoneDigitsOf, queryCondition } from './patient-search.ts'
import type { PatientQuery } from './patient-search.ts'

export interface PatientSearch {
  query: PatientQuery | null
  /** 이 환자 다음부터(이름, ID 순). */
  after: { name: string; id: string } | null
  limit: number
}

/**
 * Chart 저장소. SQL 구현 하나(F2). 행 하나에 문장 하나씩 쓴다(DO SQLite는 문장마다 바인딩 100개 제한).
 */
export class PatientRepository extends Context.Service<
  PatientRepository,
  {
    countPatients(): Effect.Effect<number>
    savePatient(patient: Patient): Effect.Effect<void>
    findPatient(id: Id<'patient'>): Effect.Effect<Option.Option<Patient>>
    /** 이름, ID 순. */
    searchPatients(input: PatientSearch): Effect.Effect<ReadonlyArray<Patient>>
    saveProcedureCode(code: ProcedureCode): Effect.Effect<void>
    saveAppointment(appointment: Appointment): Effect.Effect<void>
    /** `from` 이상 `to` 미만에 시작하는 예약. 시작 시각 순. */
    appointmentsBetween(from: string, to: string): Effect.Effect<ReadonlyArray<Appointment>>
    saveTreatmentPlan(plan: TreatmentPlan): Effect.Effect<void>
    treatmentPlansOf(patientId: Id<'patient'>): Effect.Effect<ReadonlyArray<TreatmentPlan>>
  }
>()('dlude/chart/PatientRepository') {
  static readonly layer = Layer.effect(
    PatientRepository,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      interface PatientRow extends Omit<Patient, 'synthetic'> {
        synthetic: number
      }
      const toPatient = (row: PatientRow): Patient => ({ ...row, synthetic: row.synthetic === 1 })
      const patientColumns = sql.literal(
        'id, chart_number AS chartNumber, name, birth_date AS birthDate, sex, phone, synthetic',
      )
      interface PlanRow extends Omit<TreatmentPlan, 'procedureCodes'> {
        procedureCodes: string
      }
      const toPlan = (row: PlanRow): TreatmentPlan => ({
        ...row,
        procedureCodes: JSON.parse(row.procedureCodes) as string[],
      })

      return PatientRepository.of({
        countPatients: () =>
          sql<{ n: number }>`SELECT count(*) AS n FROM chart_patients`.pipe(
            Effect.map((rows) => rows[0]?.n ?? 0),
            Effect.orDie,
          ),
        savePatient: (patient) =>
          sql`
            INSERT INTO chart_patients ${sql.insert({
              id: patient.id,
              chart_number: patient.chartNumber,
              name: patient.name,
              name_folded: patient.name.toLowerCase(),
              name_initials: initialsOf(patient.name),
              birth_date: patient.birthDate,
              sex: patient.sex,
              phone: patient.phone,
              phone_digits: phoneDigitsOf(patient.phone),
              synthetic: patient.synthetic ? 1 : 0,
            })}
          `.pipe(Effect.asVoid, Effect.orDie),
        findPatient: (id) =>
          sql<PatientRow>`SELECT ${patientColumns} FROM chart_patients WHERE id = ${id}`.pipe(
            Effect.map((rows) => Option.map(Option.fromNullishOr(rows[0]), toPatient)),
            Effect.orDie,
          ),
        searchPatients: (input) => {
          const conditions = [sql`1 = 1`]
          if (input.query !== null) conditions.push(queryCondition(sql, input.query))
          if (input.after !== null) {
            const { name, id } = input.after
            conditions.push(sql`(name > ${name} OR (name = ${name} AND id > ${id}))`)
          }
          return sql<PatientRow>`
            SELECT ${patientColumns} FROM chart_patients WHERE ${sql.and(conditions)}
            ORDER BY name, id LIMIT ${input.limit}
          `.pipe(
            Effect.map((rows) => rows.map(toPatient)),
            Effect.orDie,
          )
        },
        saveProcedureCode: (code) =>
          sql`INSERT INTO chart_procedure_codes ${sql.insert({ code: code.code, name: code.name })}`.pipe(
            Effect.asVoid,
            Effect.orDie,
          ),
        saveAppointment: (appointment) =>
          sql`
            INSERT INTO chart_appointments ${sql.insert({
              id: appointment.id,
              patient_id: appointment.patientId,
              starts_at: appointment.startsAt,
              duration_minutes: appointment.durationMinutes,
              procedure_code: appointment.procedureCode,
              status: appointment.status,
            })}
          `.pipe(Effect.asVoid, Effect.orDie),
        appointmentsBetween: (from, to) =>
          sql<Appointment>`
            SELECT id, patient_id AS patientId, starts_at AS startsAt, duration_minutes AS durationMinutes,
              procedure_code AS procedureCode, status
            FROM chart_appointments WHERE starts_at >= ${from} AND starts_at < ${to}
            ORDER BY starts_at, id
          `.pipe(Effect.orDie),
        saveTreatmentPlan: (plan) =>
          sql`
            INSERT INTO chart_treatment_plans ${sql.insert({
              id: plan.id,
              patient_id: plan.patientId,
              created_on: plan.createdOn,
              status: plan.status,
              procedure_codes: JSON.stringify(plan.procedureCodes),
            })}
          `.pipe(Effect.asVoid, Effect.orDie),
        treatmentPlansOf: (patientId) =>
          sql<PlanRow>`
            SELECT id, patient_id AS patientId, created_on AS createdOn, status, procedure_codes AS procedureCodes
            FROM chart_treatment_plans WHERE patient_id = ${patientId} ORDER BY created_on, id
          `.pipe(
            Effect.map((rows) => rows.map(toPlan)),
            Effect.orDie,
          ),
      })
    }),
  )
}
