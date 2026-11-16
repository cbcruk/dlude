import { Context, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * 감사 기록 하나(conventions.md "감사 기록"). 누가 무엇을 바꿨는지와 전후 내용 해시만 남긴다. 본문은 없다(P7).
 * 해시는 `contentHash`로 만든다. 새로 만들면 `beforeHash`가, 지우면 `afterHash`가 `null`이다.
 */
export interface AuditEntry {
  at: string
  /** `stf_…` 또는 `system` */
  actor: string
  action: string
  resourceType: string
  resourceId: string
  beforeHash: string | null
  afterHash: string | null
}

/** 감사 기록. 상태 변경과 같은 트랜잭션에서 쓴다. 변경이 되돌아가면 기록도 되돌아간다. */
export class AuditLog extends Context.Service<
  AuditLog,
  {
    record(entry: AuditEntry): Effect.Effect<void>
    /** 쓴 순서대로 준다. 조회 API가 생기기 전까지 테스트에서 쓴다. */
    list(): Effect.Effect<ReadonlyArray<AuditEntry>>
  }
>()('dlude/shared/AuditLog') {
  static readonly layer = Layer.effect(
    AuditLog,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return AuditLog.of({
        record: (entry) =>
          sql`
            INSERT INTO audit_logs ${sql.insert({
              at: entry.at,
              actor: entry.actor,
              action: entry.action,
              resource_type: entry.resourceType,
              resource_id: entry.resourceId,
              before_hash: entry.beforeHash,
              after_hash: entry.afterHash,
            })}
          `.pipe(Effect.asVoid, Effect.orDie),
        list: () =>
          sql<AuditEntry>`
            SELECT at, actor, action, resource_type AS resourceType, resource_id AS resourceId,
              before_hash AS beforeHash, after_hash AS afterHash
            FROM audit_logs ORDER BY seq
          `.pipe(Effect.orDie),
      })
    }),
  )
}
