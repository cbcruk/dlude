import { Context, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'
import type { Id } from '../../shared/ids/ids.types.ts'
import type { LoginChallenge } from './login-challenge.aggregate.ts'
import type { Session } from './session.aggregate.ts'
import type { Staff, StaffCredential } from './staff.ts'

/**
 * Identity & Access 저장소. SQL 구현 하나(F2). 쓰기는 호출한 쪽의 트랜잭션에 함께 들어간다.
 */
export class IdentityRepository extends Context.Service<
  IdentityRepository,
  {
    countStaff(): Effect.Effect<number>
    saveStaff(staff: Staff): Effect.Effect<void>
    findStaff(id: Id<'staff'>): Effect.Effect<Option.Option<Staff>>
    /** 아이디는 소문자로 바꿔 찾는다. */
    findStaffByLoginId(loginId: string): Effect.Effect<Option.Option<Staff>>
    findCredential(staffId: Id<'staff'>): Effect.Effect<Option.Option<StaffCredential>>
    saveCredential(credential: StaffCredential): Effect.Effect<void>
    findChallenge(id: Id<'loginChallenge'>): Effect.Effect<Option.Option<LoginChallenge>>
    saveChallenge(challenge: LoginChallenge): Effect.Effect<void>
    findSession(id: Id<'session'>): Effect.Effect<Option.Option<Session>>
    /** 받은 refresh token 해시가 지금 또는 직전 토큰인 세션. */
    findSessionByRefreshHash(hash: string): Effect.Effect<Option.Option<Session>>
    saveSession(session: Session): Effect.Effect<void>
    /** 직원의 쓸 수 있는 세션을 모두 끝낸다. 계정을 잠글 때 쓴다. */
    revokeSessionsOf(staffId: Id<'staff'>, at: string): Effect.Effect<void>
  }
>()('dlude/identity/IdentityRepository') {
  static readonly layer = Layer.effect(
    IdentityRepository,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      interface StaffRow extends Omit<Staff, 'synthetic'> {
        synthetic: number
      }
      const toStaff = (row: StaffRow): Staff => ({ ...row, synthetic: row.synthetic === 1 })
      const first = <A, B>(rows: ReadonlyArray<A>, map: (row: A) => B) => Option.map(Option.fromNullishOr(rows[0]), map)
      const same = <A>(row: A) => row

      return IdentityRepository.of({
        countStaff: () =>
          sql<{ n: number }>`SELECT count(*) AS n FROM staff`.pipe(
            Effect.map((rows) => rows[0]?.n ?? 0),
            Effect.orDie,
          ),
        saveStaff: (staff) =>
          sql`
            INSERT INTO staff ${sql.insert({
              id: staff.id,
              login_id: staff.loginId.toLowerCase(),
              name: staff.name,
              role: staff.role,
              emoji: staff.emoji,
              synthetic: staff.synthetic ? 1 : 0,
            })}
            ON CONFLICT (id) DO UPDATE SET
              login_id = excluded.login_id, name = excluded.name, role = excluded.role, emoji = excluded.emoji
          `.pipe(Effect.asVoid, Effect.orDie),
        findStaff: (id) =>
          sql<StaffRow>`
            SELECT id, login_id AS loginId, name, role, emoji, synthetic FROM staff WHERE id = ${id}
          `.pipe(
            Effect.map((rows) => first(rows, toStaff)),
            Effect.orDie,
          ),
        findStaffByLoginId: (loginId) =>
          sql<StaffRow>`
            SELECT id, login_id AS loginId, name, role, emoji, synthetic FROM staff WHERE login_id = ${loginId.toLowerCase()}
          `.pipe(
            Effect.map((rows) => first(rows, toStaff)),
            Effect.orDie,
          ),
        findCredential: (staffId) =>
          sql<StaffCredential>`
            SELECT staff_id AS staffId, password_hash AS passwordHash, failed_attempts AS failedAttempts,
              locked_at AS lockedAt, totp_secret AS totpSecret, totp_last_step AS totpLastStep
            FROM staff_credentials WHERE staff_id = ${staffId}
          `.pipe(
            Effect.map((rows) => first(rows, same)),
            Effect.orDie,
          ),
        saveCredential: (credential) =>
          sql`
            INSERT INTO staff_credentials ${sql.insert({
              staff_id: credential.staffId,
              password_hash: credential.passwordHash,
              failed_attempts: credential.failedAttempts,
              locked_at: credential.lockedAt,
              totp_secret: credential.totpSecret,
              totp_last_step: credential.totpLastStep,
            })}
            ON CONFLICT (staff_id) DO UPDATE SET
              password_hash = excluded.password_hash, failed_attempts = excluded.failed_attempts,
              locked_at = excluded.locked_at, totp_secret = excluded.totp_secret, totp_last_step = excluded.totp_last_step
          `.pipe(Effect.asVoid, Effect.orDie),
        findChallenge: (id) =>
          sql<LoginChallenge>`
            SELECT id, staff_id AS staffId, next, enroll_secret AS enrollSecret, status, failed_codes AS failedCodes,
              created_at AS createdAt, expires_at AS expiresAt
            FROM login_challenges WHERE id = ${id}
          `.pipe(
            Effect.map((rows) => first(rows, same)),
            Effect.orDie,
          ),
        saveChallenge: (challenge) =>
          sql`
            INSERT INTO login_challenges ${sql.insert({
              id: challenge.id,
              staff_id: challenge.staffId,
              next: challenge.next,
              enroll_secret: challenge.enrollSecret,
              status: challenge.status,
              failed_codes: challenge.failedCodes,
              created_at: challenge.createdAt,
              expires_at: challenge.expiresAt,
            })}
            ON CONFLICT (id) DO UPDATE SET status = excluded.status, failed_codes = excluded.failed_codes
          `.pipe(Effect.asVoid, Effect.orDie),
        findSession: (id) =>
          sql<Session>`
            SELECT id, staff_id AS staffId, status, refresh_hash AS refreshHash,
              previous_refresh_hash AS previousRefreshHash, rotated_at AS rotatedAt, created_at AS createdAt,
              expires_at AS expiresAt, revoked_at AS revokedAt, revoke_reason AS revokeReason
            FROM sessions WHERE id = ${id}
          `.pipe(
            Effect.map((rows) => first(rows, same)),
            Effect.orDie,
          ),
        findSessionByRefreshHash: (hash) =>
          sql<Session>`
            SELECT id, staff_id AS staffId, status, refresh_hash AS refreshHash,
              previous_refresh_hash AS previousRefreshHash, rotated_at AS rotatedAt, created_at AS createdAt,
              expires_at AS expiresAt, revoked_at AS revokedAt, revoke_reason AS revokeReason
            FROM sessions WHERE refresh_hash = ${hash} OR previous_refresh_hash = ${hash}
          `.pipe(
            Effect.map((rows) => first(rows, same)),
            Effect.orDie,
          ),
        saveSession: (session) =>
          sql`
            INSERT INTO sessions ${sql.insert({
              id: session.id,
              staff_id: session.staffId,
              status: session.status,
              refresh_hash: session.refreshHash,
              previous_refresh_hash: session.previousRefreshHash,
              rotated_at: session.rotatedAt,
              created_at: session.createdAt,
              expires_at: session.expiresAt,
              revoked_at: session.revokedAt,
              revoke_reason: session.revokeReason,
            })}
            ON CONFLICT (id) DO UPDATE SET
              status = excluded.status, refresh_hash = excluded.refresh_hash,
              previous_refresh_hash = excluded.previous_refresh_hash, rotated_at = excluded.rotated_at,
              revoked_at = excluded.revoked_at, revoke_reason = excluded.revoke_reason
          `.pipe(Effect.asVoid, Effect.orDie),
        revokeSessionsOf: (staffId, at) =>
          sql`
            UPDATE sessions SET status = 'REVOKED', revoked_at = ${at}, revoke_reason = 'ACCOUNT_LOCKED'
            WHERE staff_id = ${staffId} AND status = 'ACTIVE'
          `.pipe(Effect.asVoid, Effect.orDie),
      })
    }),
  )
}
