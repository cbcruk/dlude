import { Context, Data, Effect, Layer, Option } from 'effect'
import { isId } from '../../shared/ids/ids.ts'
import type { Id } from '../../shared/ids/ids.types.ts'
import type { Appointment, Patient, TreatmentPlan } from './patient.ts'
import { PatientNotFound } from './patient.ts'
import { classifyQuery } from './patient-search.ts'
import { PatientRepository } from './patient-repository.ts'

export type { Appointment, Patient, PatientSummary, TreatmentPlan } from './patient.ts'

/** `cursor`가 이 목록이 낸 값이 아니다. */
export class InvalidCursor extends Data.TaggedError('InvalidCursor')<{}> {}

export interface PatientPage {
  items: ReadonlyArray<Patient>
  /** 다음 쪽 커서(마지막 환자 ID). 마지막 쪽이면 `null`. */
  nextCursor: string | null
}

/**
 * 차트(EMR) 포트 (architecture.md 7절). 다른 컨텍스트는 Chart 저장소가 아니라 이것만 쓴다. 0단계는 읽기 메서드만
 * 있고, `appendNote`·`attachDocument`는 2·4단계에서 더한다. 실제 EMR을 붙인다면 이 구현만 바꾼다.
 *
 * 열람 기록은 남기지 않는다. 사람이 환자를 여는 곳(HTTP 상세 조회)이 남긴다.
 */
export class ChartSystem extends Context.Service<
  ChartSystem,
  {
    /** 이름, ID 순. `q`는 chart.md "0단계 엔드포인트"의 검색어. */
    findPatients(input: { q?: string; limit: number; cursor?: string }): Effect.Effect<PatientPage, InvalidCursor>
    getPatient(id: string): Effect.Effect<Patient, PatientNotFound>
    /** `from` 이상 `to` 미만(ISO 8601)에 시작하는 예약. */
    getAppointments(range: { from: string; to: string }): Effect.Effect<ReadonlyArray<Appointment>>
    getTreatmentPlans(patientId: Id<'patient'>): Effect.Effect<ReadonlyArray<TreatmentPlan>>
  }
>()('dlude/chart/ChartSystem') {
  /** InternalChart: 같은 DO SQLite의 미니 EMR 표. */
  static readonly internal = Layer.effect(
    ChartSystem,
    Effect.gen(function* () {
      const repository = yield* PatientRepository

      const findPatients = Effect.fn('ChartSystem.findPatients')(function* (input: {
        q?: string
        limit: number
        cursor?: string
      }) {
        let after: { name: string; id: string } | null = null
        if (input.cursor !== undefined) {
          const cursor = isId('patient', input.cursor) ? yield* repository.findPatient(input.cursor) : Option.none()
          if (Option.isNone(cursor)) return yield* new InvalidCursor()
          after = { name: cursor.value.name, id: cursor.value.id }
        }
        // 하나 더 읽어 다음 쪽이 있는지 안다
        const rows = yield* repository.searchPatients({ query: classifyQuery(input.q), after, limit: input.limit + 1 })
        const items = rows.slice(0, input.limit)
        return {
          items,
          nextCursor: rows.length > input.limit ? items[items.length - 1]!.id : null,
        } satisfies PatientPage
      })

      return ChartSystem.of({
        findPatients,
        getPatient: (id) =>
          (isId('patient', id) ? repository.findPatient(id) : Effect.succeed(Option.none<Patient>())).pipe(
            Effect.flatMap(
              Option.match({ onNone: () => Effect.fail(new PatientNotFound({})), onSome: Effect.succeed }),
            ),
          ),
        getAppointments: (range) => repository.appointmentsBetween(range.from, range.to),
        getTreatmentPlans: (patientId) => repository.treatmentPlansOf(patientId),
      })
    }),
  ).pipe(Layer.provide(PatientRepository.layer))
}
