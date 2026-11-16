import type { Id } from '../../shared/ids/ids.types.ts'
import { RefreshTokenInvalid, RefreshTokenReused } from './auth/auth-errors.ts'
import type { SecurityEventDraft } from './security-event.ts'

/**
 * 세션 판정 (identity-access.md "로그인", hemr 세션 설계).
 *
 * 세션은 로그인 한 번이고 refresh token 계열 하나다. refresh할 때마다 토큰을 회전하고, 직전 토큰은 10초 동안만
 * 받는다(탭 여러 개가 동시에 refresh). 그 밖에 직전 토큰이 다시 오면 탈취로 보고 세션을 폐기한다.
 * 세션은 만든 뒤 12시간에 끝난다. 회전해도 늘어나지 않는다(진료일 하루).
 */

export const SESSION_TTL_MILLIS = 12 * 60 * 60 * 1000
export const REFRESH_GRACE_MILLIS = 10 * 1000

export type SessionRevokeReason = 'LOGOUT' | 'REFRESH_TOKEN_REUSED' | 'ACCOUNT_LOCKED'

export interface Session {
  id: Id<'session'>
  staffId: Id<'staff'>
  status: 'ACTIVE' | 'REVOKED'
  /** 지금 refresh token의 SHA-256. */
  refreshHash: string
  /** 직전 refresh token의 SHA-256. 유예와 재사용 감지에 쓴다. */
  previousRefreshHash: string | null
  rotatedAt: string | null
  createdAt: string
  expiresAt: string
  revokedAt: string | null
  revokeReason: SessionRevokeReason | null
}

export function newSession(id: Id<'session'>, staffId: Id<'staff'>, refreshHash: string, at: string): Session {
  return {
    id,
    staffId,
    status: 'ACTIVE',
    refreshHash,
    previousRefreshHash: null,
    rotatedAt: null,
    createdAt: at,
    expiresAt: new Date(Date.parse(at) + SESSION_TTL_MILLIS).toISOString(),
    revokedAt: null,
    revokeReason: null,
  }
}

/** access token 검증과 refresh에서 세션을 쓸 수 있는지. */
export const isSessionActive = (session: Session, at: string): boolean =>
  session.status === 'ACTIVE' && at < session.expiresAt

export function revokeSession(session: Session, reason: SessionRevokeReason, at: string): Session {
  return session.status === 'REVOKED' ? session : { ...session, status: 'REVOKED', revokedAt: at, revokeReason: reason }
}

export type RefreshDecision =
  /** 회전했다. 새 refresh 쿠키를 낸다. */
  | { _tag: 'Rotated'; session: Session }
  /** 유예 안의 직전 토큰. access token만 새로 주고 쿠키는 그대로 둔다(앞 응답이 이미 바꿨다). */
  | { _tag: 'Concurrent'; session: Session }
  | {
      _tag: 'Rejected'
      error: RefreshTokenInvalid | RefreshTokenReused
      /** 재사용으로 폐기했으면 저장할 세션. */
      session: Session | null
      events: SecurityEventDraft[]
    }

/**
 * refresh를 판정한다. `session`은 받은 토큰 해시가 지금 또는 직전 토큰인 세션(없으면 `null`).
 *
 * - 세션이 없거나, 폐기됐거나, 12시간이 지났으면 → `REFRESH_TOKEN_INVALID`
 * - 지금 토큰 → 회전
 * - 직전 토큰, 회전 뒤 10초 안 → 동시 refresh
 * - 직전 토큰, 10초 밖 → 세션 폐기, `REFRESH_TOKEN_REUSED`
 */
export function decideRefresh(
  input: { session: Session | null; presentedHash: string; nextHash: string },
  clock: { at: string },
): RefreshDecision {
  const { session } = input
  if (session === null || !isSessionActive(session, clock.at)) {
    return { _tag: 'Rejected', error: new RefreshTokenInvalid({}), session: null, events: [] }
  }
  if (input.presentedHash === session.refreshHash) {
    return {
      _tag: 'Rotated',
      session: {
        ...session,
        refreshHash: input.nextHash,
        previousRefreshHash: session.refreshHash,
        rotatedAt: clock.at,
      },
    }
  }
  if (input.presentedHash === session.previousRefreshHash && session.rotatedAt !== null) {
    if (Date.parse(clock.at) - Date.parse(session.rotatedAt) <= REFRESH_GRACE_MILLIS) {
      return { _tag: 'Concurrent', session }
    }
    return {
      _tag: 'Rejected',
      error: new RefreshTokenReused({}),
      session: revokeSession(session, 'REFRESH_TOKEN_REUSED', clock.at),
      events: [{ type: 'REFRESH_TOKEN_REUSED', staffId: session.staffId, sessionId: session.id }],
    }
  }
  return { _tag: 'Rejected', error: new RefreshTokenInvalid({}), session: null, events: [] }
}

/** 로그아웃. 이미 끝난 세션이면 그대로 두고 기록도 남기지 않는다(같은 요청을 다시 보내도 204). */
export function decideLogout(
  session: Session,
  clock: { at: string },
): { session: Session; events: SecurityEventDraft[] } {
  if (session.status === 'REVOKED') return { session, events: [] }
  return {
    session: revokeSession(session, 'LOGOUT', clock.at),
    events: [{ type: 'LOGGED_OUT', staffId: session.staffId, sessionId: session.id }],
  }
}
