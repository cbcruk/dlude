import { Clock, Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../api.ts'
import { AccessLog } from '../../shared/audit/access-log.ts'
import { ValidationFailed } from '../../shared/problem/problem.ts'
import { CurrentAccess } from '../identity/auth/access.ts'
import { ChartSystem } from './chart.public.ts'
import { summaryOf } from './patient.ts'

export const PatientsHttpLive = HttpApiBuilder.group(
  Api,
  'patients',
  Effect.fn(function* (handlers) {
    const chart = yield* ChartSystem
    const accessLog = yield* AccessLog
    return handlers.handleAll({
      list: ({ query }) =>
        chart.findPatients({ ...query, limit: query.limit ?? 50 }).pipe(
          Effect.map((page) => ({ items: page.items.map(summaryOf), nextCursor: page.nextCursor })),
          Effect.catchTag('InvalidCursor', () =>
            Effect.fail(new ValidationFailed({ violations: [{ field: 'cursor', code: 'INVALID_VALUE' }] })),
          ),
        ),
      get: ({ params }) =>
        Effect.gen(function* () {
          const patient = yield* chart.getPatient(params.patientId)
          const access = yield* CurrentAccess
          // 응답 전에 남긴다. 기록 없이 개인정보가 나가지 않게
          yield* accessLog.record({
            time: new Date(yield* Clock.currentTimeMillis).toISOString(),
            staffId: access.staffId,
            action: 'READ',
            resource: 'patient',
            resourceId: patient.id,
            reason: null,
          })
          return patient
        }),
    })
  }),
)
