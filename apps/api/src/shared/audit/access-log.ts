// from hemr@0c4b7e8 src/shared/audit/access-log.ts — 테넌트와 메모리 구현(F2)을 빼고 행위자를 직원으로 바꿈
import { Context, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

/** 개인정보 열람 기록 하나. 예: 환자 상세 조회 `{ action: 'READ', resource: 'patient', resourceId: 'pat_...' }` */
export interface AccessLogEntry {
  time: string
  staffId: string
  action: string
  resource: string
  resourceId: string
  /** 열람 사유. 사유가 필요 없는 열람이면 `null`. */
  reason: string | null
}

/**
 * 개인정보 열람 기록. 업무 트랜잭션과 따로 쓴다. 열람은 데이터를 바꾸지 않아 함께 되돌릴 것이 없고, 응답을 주기 전에
 * 써서 기록 없이 개인정보가 나가지 않게 한다. 본문은 남기지 않는다(P7).
 */
export class AccessLog extends Context.Service<
  AccessLog,
  {
    record(entry: AccessLogEntry): Effect.Effect<void>
    /** 쓴 순서대로 준다. 조회 API가 생기기 전까지 테스트에서 쓴다. */
    list(): Effect.Effect<ReadonlyArray<AccessLogEntry>>
  }
>()('dlude/shared/AccessLog') {
  static readonly layer = Layer.effect(
    AccessLog,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return AccessLog.of({
        record: (entry) =>
          sql`
            INSERT INTO access_logs ${sql.insert({
              time: entry.time,
              staff_id: entry.staffId,
              action: entry.action,
              resource: entry.resource,
              resource_id: entry.resourceId,
              reason: entry.reason,
            })}
          `.pipe(Effect.asVoid, Effect.orDie),
        list: () =>
          sql<AccessLogEntry>`
            SELECT time, staff_id AS staffId, action, resource, resource_id AS resourceId, reason
            FROM access_logs ORDER BY seq
          `.pipe(Effect.orDie),
      })
    }),
  )
}
