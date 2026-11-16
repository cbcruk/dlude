import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'
import { identityMigrations } from './modules/identity/identity.migrations.ts'
import { AccessLog } from './shared/audit/access-log.ts'
import { AuditLog } from './shared/audit/audit-log.ts'
import { runMigrations, sharedMigrations, type Migrations } from './shared/db/migrations.ts'
import { Transaction } from './shared/db/transaction.ts'
import { Outbox } from './shared/events/outbox.ts'
import { PolicyCursor } from './shared/events/policy.ts'
import { IdempotencyStore } from './shared/http/idempotency.ts'

/** 앱 전체 마이그레이션. 모듈 마이그레이션은 여기 이어 붙인다(번호는 shared/db/migrations.ts). */
export const migrations: Migrations = { ...sharedMigrations, ...identityMigrations }

/** 마이그레이션을 적용한다. DO 생성자와 테스트가 부른다. */
export const migrate = runMigrations(migrations).pipe(Effect.orDie)

/**
 * 공유 저장 서비스. `SqlClient`는 런타임이 넣는다: DO는 `@effect/sql-sqlite-do`, 테스트는 `testing/sql.ts`.
 * 저장소 구현은 SQL 하나다(F2).
 */
export const PersistenceLive: Layer.Layer<
  Transaction | Outbox | PolicyCursor | IdempotencyStore | AccessLog | AuditLog,
  never,
  SqlClient.SqlClient
> = Layer.mergeAll(
  Transaction.layer,
  Outbox.layer,
  PolicyCursor.layer,
  IdempotencyStore.layer,
  AccessLog.layer,
  AuditLog.layer,
)
