import { Context, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'
import type { SecurityEventDraft, SecurityEventType } from '../security-event.ts'

export interface SecurityEventRecord {
  time: string
  type: SecurityEventType
  staffId: string | null
  sessionId: string | null
  reason: string | null
}

/**
 * 보안 기록 (identity-access.md "보안 기록"). 업무 트랜잭션과 따로 쓴다. 로그인 실패처럼 응답이 실패여도 남아야 하기
 * 때문이다(DO SQLite는 트랜잭션 밖 문장이 바로 커밋됨: spike.md 작업 2). 비밀번호·코드·토큰 값은 남기지 않는다(P7).
 */
export class SecurityLog extends Context.Service<
  SecurityLog,
  {
    record(time: string, events: ReadonlyArray<SecurityEventDraft>): Effect.Effect<void>
    /** 쓴 순서대로. 조회 API가 생기기 전까지 테스트에서 쓴다. */
    list(): Effect.Effect<ReadonlyArray<SecurityEventRecord>>
  }
>()('dlude/identity/SecurityLog') {
  static readonly layer = Layer.effect(
    SecurityLog,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return SecurityLog.of({
        record: (time, events) =>
          Effect.forEach(
            events,
            (event) => sql`
              INSERT INTO security_events ${sql.insert({
                time,
                type: event.type,
                staff_id: event.staffId,
                session_id: event.sessionId ?? null,
                reason: event.reason ?? null,
              })}
            `,
            { discard: true },
          ).pipe(Effect.orDie),
        list: () =>
          sql<SecurityEventRecord>`
            SELECT time, type, staff_id AS staffId, session_id AS sessionId, reason FROM security_events ORDER BY seq
          `.pipe(Effect.orDie),
      })
    }),
  )
}
