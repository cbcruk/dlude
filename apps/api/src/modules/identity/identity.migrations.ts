import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'
import type { Migrations } from '../../shared/db/migrations.ts'

/** Identity & Access 표. 번호 0002는 이 컨텍스트 몫이다(shared/db/migrations.ts). */
export const identityMigrations: Migrations = {
  '0002_identity': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      CREATE TABLE staff (
        id TEXT PRIMARY KEY,
        login_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('DIRECTOR', 'MANAGER', 'HYGIENIST', 'DESK')),
        emoji TEXT NOT NULL,
        synthetic INTEGER NOT NULL CHECK (synthetic IN (0, 1))
      ) STRICT
    `
    yield* sql`
      CREATE TABLE staff_credentials (
        staff_id TEXT PRIMARY KEY REFERENCES staff (id),
        password_hash TEXT NOT NULL,
        failed_attempts INTEGER NOT NULL CHECK (failed_attempts >= 0),
        locked_at TEXT,
        totp_secret TEXT,
        totp_last_step INTEGER
      ) STRICT
    `
    yield* sql`
      CREATE TABLE login_challenges (
        id TEXT PRIMARY KEY,
        staff_id TEXT NOT NULL REFERENCES staff (id),
        next TEXT NOT NULL CHECK (next IN ('TOTP', 'TOTP_ENROLL')),
        enroll_secret TEXT,
        status TEXT NOT NULL CHECK (status IN ('PENDING', 'USED', 'EXPIRED')),
        failed_codes INTEGER NOT NULL CHECK (failed_codes >= 0),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      ) STRICT
    `
    yield* sql`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        staff_id TEXT NOT NULL REFERENCES staff (id),
        status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
        refresh_hash TEXT NOT NULL UNIQUE,
        previous_refresh_hash TEXT,
        rotated_at TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        revoke_reason TEXT
      ) STRICT
    `
    yield* sql`CREATE INDEX sessions_previous_refresh_hash ON sessions (previous_refresh_hash)`
    yield* sql`CREATE INDEX sessions_staff ON sessions (staff_id, status)`
    // 비밀번호·코드·토큰 값을 담을 열이 없다(P7). 열 목록은 security-log.test.ts가 고정한다
    yield* sql`
      CREATE TABLE security_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        time TEXT NOT NULL,
        type TEXT NOT NULL,
        staff_id TEXT,
        session_id TEXT,
        reason TEXT
      ) STRICT
    `
  }),
}
