import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'
import * as Migrator from 'effect/sql/Migrator'
import { createIdempotencyTable } from '../http/idempotency.ts'

/**
 * 마이그레이션 목록. 키는 `{번호}_{이름}`이고 번호 순서대로 한 번씩 적용한다(F3). 적용한 번호는
 * `effect_sql_migrations` 표에 남는다. 이미 배포한 마이그레이션은 고치지 않고 새 번호를 더한다.
 *
 * 번호는 모듈마다 나눠 쓴다: 0001 공유, 0002 Identity & Access, 0003 Chart. 다음 단계는 이어서 붙인다.
 * 표는 SQLite `STRICT`. 시각은 UTC ISO 8601 문자열, 불리언은 0/1.
 */
export type Migrations = Record<string, Effect.Effect<void, unknown, SqlClient.SqlClient>>

export const sharedMigrations: Migrations = {
  '0001_shared': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    // AUTOINCREMENT라 지운 번호를 다시 쓰지 않는다. 정책 커서가 이 번호에 기댄다
    yield* sql`
      CREATE TABLE outbox (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        time TEXT NOT NULL,
        subject TEXT NOT NULL,
        actor TEXT,
        data TEXT NOT NULL
      ) STRICT
    `
    yield* sql`
      CREATE TABLE policy_cursors (
        policy TEXT PRIMARY KEY,
        last_seq INTEGER NOT NULL CHECK (last_seq >= 0),
        updated_at TEXT NOT NULL
      ) STRICT
    `
    yield* createIdempotencyTable
    // 감사·열람 기록에는 본문을 두지 않는다(P7). 열 목록은 audit.test.ts가 고정한다
    yield* sql`
      CREATE TABLE access_logs (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        time TEXT NOT NULL,
        staff_id TEXT NOT NULL,
        action TEXT NOT NULL,
        resource TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        reason TEXT
      ) STRICT
    `
    yield* sql`
      CREATE TABLE audit_logs (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        before_hash TEXT,
        after_hash TEXT
      ) STRICT
    `
  }),
}

/**
 * 마이그레이션을 적용하고 이번에 적용한 것을 돌려준다. 런타임과 상관없는 `effect/sql/Migrator`라 Node 테스트와 DO
 * 생성자가 같은 코드를 쓴다.
 *
 * Migrator는 번호만 보고 적용 여부를 정한다. 같은 번호에 다른 이름이 기록된 DB(지운 시험 마이그레이션이 남은 로컬
 * DB 등)면 표 없이 뜨게 되므로, 적용 뒤 기록된 이름이 목록과 같은지 확인하고 다르면 멈춘다.
 */
export const runMigrations = (migrations: Migrations) =>
  Effect.gen(function* () {
    const applied = yield* Migrator.make({})({ loader: Migrator.fromRecord(migrations) })
    const sql = yield* SqlClient.SqlClient
    const recorded = yield* sql<{ id: number; name: string }>`
      SELECT migration_id AS id, name FROM effect_sql_migrations ORDER BY migration_id
    `
    const expected = new Map(Object.keys(migrations).map((key) => [Number(key.slice(0, 4)), key.slice(5)]))
    const mismatched = recorded.filter((row) => expected.get(row.id) !== row.name)
    if (mismatched.length > 0) {
      return yield* Effect.die(
        new Error(
          `DB의 마이그레이션 이력이 코드와 다르다: ${mismatched.map((row) => `${String(row.id).padStart(4, '0')}_${row.name}`).join(', ')}. ` +
            '로컬이면 `pnpm dev:reset`으로 DB를 지운다.',
        ),
      )
    }
    return applied
  })
