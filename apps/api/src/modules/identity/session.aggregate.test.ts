import { describe, expect, it } from 'vitest'
import type { Id } from '../../shared/ids/ids.types.ts'
import { decideLogout, decideRefresh, isSessionActive, newSession, revokeSession } from './session.aggregate.ts'

// spec "상태" 표: 세션 ACTIVE → REVOKED (로그아웃, refresh 재사용 감지, 잠금)

const AT = '2026-11-16T09:00:00.000Z'
const later = (millis: number) => new Date(Date.parse(AT) + millis).toISOString()
const session = newSession(
  'ses_01JBQ000000000000000000001' as Id<'session'>,
  'stf_01JBQ000000000000000000001' as Id<'staff'>,
  'h0',
  AT,
)

const refresh = (given: typeof session | null, presentedHash: string, at: string) =>
  decideRefresh({ session: given, presentedHash, nextHash: 'h-next' }, { at })

describe('newSession', () => {
  it('ACTIVE로 만들고 12시간 뒤 끝난다', () => {
    expect(session).toMatchObject({
      status: 'ACTIVE',
      expiresAt: '2026-11-16T21:00:00.000Z',
      previousRefreshHash: null,
    })
    expect(isSessionActive(session, later(12 * 3600_000 - 1))).toBe(true)
    expect(isSessionActive(session, later(12 * 3600_000))).toBe(false)
  })
})

describe('decideRefresh', () => {
  it('지금 토큰이면 회전한다', () => {
    expect(refresh(session, 'h0', later(60_000))).toEqual({
      _tag: 'Rotated',
      session: { ...session, refreshHash: 'h-next', previousRefreshHash: 'h0', rotatedAt: later(60_000) },
    })
  })

  it('회전 뒤 10초 안에 직전 토큰이 오면 동시 refresh로 보고 세션을 그대로 둔다', () => {
    const rotated = { ...session, refreshHash: 'h1', previousRefreshHash: 'h0', rotatedAt: AT }
    expect(refresh(rotated, 'h0', later(10_000))).toEqual({ _tag: 'Concurrent', session: rotated })
  })

  it('10초 밖에 직전 토큰이 오면 세션을 폐기하고 REFRESH_TOKEN_REUSED', () => {
    const rotated = { ...session, refreshHash: 'h1', previousRefreshHash: 'h0', rotatedAt: AT }
    const then = refresh(rotated, 'h0', later(10_001))
    expect(then).toMatchObject({
      _tag: 'Rejected',
      session: { status: 'REVOKED', revokeReason: 'REFRESH_TOKEN_REUSED', revokedAt: later(10_001) },
      events: [{ type: 'REFRESH_TOKEN_REUSED', staffId: session.staffId, sessionId: session.id }],
    })
    expect(then._tag === 'Rejected' && then.error.code).toBe('REFRESH_TOKEN_REUSED')
  })

  it('세션이 없거나, 폐기됐거나, 12시간이 지났거나, 모르는 토큰이면 REFRESH_TOKEN_INVALID', () => {
    const cases: Array<[typeof session | null, string, string]> = [
      [null, 'h0', AT],
      [revokeSession(session, 'LOGOUT', AT), 'h0', AT],
      [session, 'h0', later(12 * 3600_000)],
      [session, 'unknown', AT],
    ]
    for (const [given, presented, at] of cases) {
      const then = refresh(given, presented, at)
      expect(then).toMatchObject({ _tag: 'Rejected', session: null, events: [] })
      expect(then._tag === 'Rejected' && then.error.code).toBe('REFRESH_TOKEN_INVALID')
    }
  })
})

describe('decideLogout', () => {
  it('세션을 폐기하고 LOGGED_OUT을 남긴다', () => {
    expect(decideLogout(session, { at: later(1) })).toEqual({
      session: { ...session, status: 'REVOKED', revokedAt: later(1), revokeReason: 'LOGOUT' },
      events: [{ type: 'LOGGED_OUT', staffId: session.staffId, sessionId: session.id }],
    })
  })

  it('이미 끝난 세션이면 그대로 두고 기록도 남기지 않는다', () => {
    const revoked = revokeSession(session, 'REFRESH_TOKEN_REUSED', AT)
    expect(decideLogout(revoked, { at: later(1) })).toEqual({ session: revoked, events: [] })
  })
})
