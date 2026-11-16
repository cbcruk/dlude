import { describe, expect, it } from 'vitest'
import type { Id } from '../../shared/ids/ids.types.ts'
import {
  CHALLENGE_TTL_MILLIS,
  decideDisableTotp,
  decidePasswordLogin,
  decideVerifyTotp,
  LOCK_AFTER_FAILURES,
  MAX_CODE_FAILURES,
  totpSecretFor,
} from './login-challenge.aggregate.ts'
import type { LoginChallenge } from './login-challenge.aggregate.ts'
import type { StaffCredential } from './staff.ts'

// spec "상태" 표의 줄마다 given(지금 상태) / when(판정) / then(다음 상태, 거부 코드, 보안 기록)

const AT = '2026-11-16T09:00:00.000Z'
const STAFF = 'stf_01JBQ000000000000000000001' as Id<'staff'>
const CHALLENGE = 'chl_01JBQ000000000000000000001' as Id<'loginChallenge'>
const SESSION = 'ses_01JBQ000000000000000000001' as Id<'session'>

const credential = (patch: Partial<StaffCredential> = {}): StaffCredential => ({
  staffId: STAFF,
  passwordHash: 'hash',
  failedAttempts: 0,
  lockedAt: null,
  totpSecret: 'sealed-secret',
  totpLastStep: 100,
  ...patch,
})

const challenge = (patch: Partial<LoginChallenge> = {}): LoginChallenge => ({
  id: CHALLENGE,
  staffId: STAFF,
  next: 'TOTP',
  enrollSecret: null,
  status: 'PENDING',
  failedCodes: 0,
  createdAt: AT,
  expiresAt: new Date(Date.parse(AT) + CHALLENGE_TTL_MILLIS).toISOString(),
  ...patch,
})

const login = (given: StaffCredential | null, passwordMatches: boolean) =>
  decidePasswordLogin(
    { credential: given, passwordMatches, challengeId: CHALLENGE, enrollSecret: 'sealed-new' },
    { at: AT },
  )

const verify = (
  given: { challenge: LoginChallenge | null; credential?: StaffCredential },
  matchedStep: number | null,
  at = AT,
) =>
  decideVerifyTotp(
    {
      challenge: given.challenge,
      credential: given.credential ?? credential(),
      matchedStep,
      sessionId: SESSION,
      refreshHash: 'rh',
    },
    { at },
  )

describe('decidePasswordLogin: (없음) → 도전 PENDING', () => {
  it('비밀번호가 맞고 TOTP를 등록했으면 TOTP 도전을 만들고 실패 횟수를 지운다', () => {
    const then = login(credential({ failedAttempts: 3 }), true)
    expect(then).toMatchObject({
      _tag: 'Challenged',
      credential: { failedAttempts: 0 },
      challenge: { next: 'TOTP', enrollSecret: null, status: 'PENDING', expiresAt: '2026-11-16T09:05:00.000Z' },
      events: [],
    })
  })

  it('TOTP를 등록하지 않았으면 새 비밀 값을 담은 TOTP_ENROLL 도전을 만든다', () => {
    const then = login(credential({ totpSecret: null, totpLastStep: null }), true)
    expect(then).toMatchObject({ _tag: 'Challenged', challenge: { next: 'TOTP_ENROLL', enrollSecret: 'sealed-new' } })
  })

  it('없는 아이디면 INVALID_CREDENTIALS, 사유 UNKNOWN_LOGIN_ID', () => {
    const then = login(null, false)
    expect(then._tag).toBe('Rejected')
    if (then._tag !== 'Rejected') return
    expect(then.error.code).toBe('INVALID_CREDENTIALS')
    expect(then.events).toEqual([{ type: 'LOGIN_FAILED', staffId: null, reason: 'UNKNOWN_LOGIN_ID' }])
  })

  it('비밀번호가 틀리면 INVALID_CREDENTIALS, 실패 횟수 +1', () => {
    const then = login(credential({ failedAttempts: 1 }), false)
    expect(then).toMatchObject({
      _tag: 'Rejected',
      credential: { failedAttempts: 2, lockedAt: null },
      revokeSessions: false,
    })
    if (then._tag === 'Rejected') {
      expect(then.error.code).toBe('INVALID_CREDENTIALS')
      expect(then.events).toEqual([{ type: 'LOGIN_FAILED', staffId: STAFF, reason: 'PASSWORD_MISMATCH' }])
    }
  })

  it(`${LOCK_AFTER_FAILURES}번째로 틀리면 잠그고 ACCOUNT_LOCKED, 세션을 모두 끝낸다`, () => {
    const then = login(credential({ failedAttempts: LOCK_AFTER_FAILURES - 1 }), false)
    expect(then).toMatchObject({
      _tag: 'Rejected',
      credential: { failedAttempts: 5, lockedAt: AT },
      revokeSessions: true,
    })
    if (then._tag === 'Rejected') {
      expect(then.error.code).toBe('ACCOUNT_LOCKED')
      expect(then.events.map((event) => event.type)).toEqual(['LOGIN_FAILED', 'ACCOUNT_LOCKED'])
    }
  })

  it('잠긴 계정은 비밀번호가 맞아도 ACCOUNT_LOCKED, 사유 LOCKED', () => {
    const then = login(credential({ lockedAt: AT, failedAttempts: 5 }), true)
    expect(then).toMatchObject({ _tag: 'Rejected', revokeSessions: false })
    if (then._tag === 'Rejected') {
      expect(then.error.code).toBe('ACCOUNT_LOCKED')
      expect(then.events).toEqual([{ type: 'LOGIN_FAILED', staffId: STAFF, reason: 'LOCKED' }])
    }
  })
})

describe('decideVerifyTotp: 도전 PENDING → 도전 USED, 세션 ACTIVE', () => {
  it('코드가 맞으면 도전을 쓰고 세션을 만들며 받은 구간을 남긴다', () => {
    const then = verify({ challenge: challenge() }, 101)
    expect(then).toMatchObject({
      _tag: 'Accepted',
      challenge: { status: 'USED' },
      credential: { totpSecret: 'sealed-secret', totpLastStep: 101 },
      session: { id: SESSION, staffId: STAFF, status: 'ACTIVE', refreshHash: 'rh' },
      events: [{ type: 'LOGIN_SUCCEEDED', staffId: STAFF, sessionId: SESSION }],
    })
  })

  it('등록 도전이면 비밀 값을 직원에게 옮기고 TOTP_ENROLLED를 남긴다', () => {
    const given = {
      challenge: challenge({ next: 'TOTP_ENROLL', enrollSecret: 'sealed-new' }),
      credential: credential({ totpSecret: null, totpLastStep: null }),
    }
    const then = verify(given, 101)
    expect(then).toMatchObject({ _tag: 'Accepted', credential: { totpSecret: 'sealed-new', totpLastStep: 101 } })
    expect(then.events.map((event) => event.type)).toEqual(['TOTP_ENROLLED', 'LOGIN_SUCCEEDED'])
  })

  it('코드가 틀리면 TOTP_INVALID, 틀린 횟수 +1, 도전은 PENDING 그대로', () => {
    const then = verify({ challenge: challenge({ failedCodes: 2 }) }, null)
    expect(then).toMatchObject({ _tag: 'Rejected', challenge: { failedCodes: 3, status: 'PENDING' } })
    if (then._tag === 'Rejected') {
      expect(then.error.code).toBe('TOTP_INVALID')
      expect(then.events).toEqual([{ type: 'TOTP_FAILED', staffId: STAFF }])
    }
  })

  it('이미 받은 구간(이하)의 코드는 맞아도 TOTP_INVALID', () => {
    for (const step of [100, 99]) {
      const then = verify({ challenge: challenge() }, step)
      expect(then._tag === 'Rejected' && then.error.code).toBe('TOTP_INVALID')
    }
  })

  it(`코드를 ${MAX_CODE_FAILURES}번 틀리면 도전을 EXPIRED로`, () => {
    const then = verify({ challenge: challenge({ failedCodes: MAX_CODE_FAILURES - 1 }) }, null)
    expect(then).toMatchObject({ _tag: 'Rejected', challenge: { status: 'EXPIRED', failedCodes: 5 } })
  })
})

describe('decideVerifyTotp: 도전 PENDING → EXPIRED (5분)', () => {
  it('5분이 지나면 코드가 맞아도 CHALLENGE_INVALID, 도전은 EXPIRED', () => {
    const then = verify({ challenge: challenge() }, 101, '2026-11-16T09:05:00.000Z')
    expect(then).toMatchObject({ _tag: 'Rejected', challenge: { status: 'EXPIRED' }, events: [] })
    expect(then._tag === 'Rejected' && then.error.code).toBe('CHALLENGE_INVALID')
  })

  it('없거나 이미 쓰거나 만료된 도전은 CHALLENGE_INVALID', () => {
    for (const given of [null, challenge({ status: 'USED' }), challenge({ status: 'EXPIRED' })]) {
      const then = verify({ challenge: given }, 101)
      expect(then._tag === 'Rejected' && then.error.code).toBe('CHALLENGE_INVALID')
    }
  })

  it('도전 중 계정이 잠겼으면 CHALLENGE_INVALID', () => {
    const then = verify({ challenge: challenge(), credential: credential({ lockedAt: AT }) }, 101)
    expect(then._tag === 'Rejected' && then.error.code).toBe('CHALLENGE_INVALID')
  })
})

describe('totpSecretFor', () => {
  it('등록 도전이면 도전의 새 비밀 값, 아니면 직원의 비밀 값', () => {
    expect(totpSecretFor(challenge({ next: 'TOTP_ENROLL', enrollSecret: 'new' }), credential())).toBe('new')
    expect(totpSecretFor(challenge(), credential())).toBe('sealed-secret')
  })
})

describe('decideDisableTotp: TOTP ENROLLED → 없음', () => {
  it('원장이 아니고 코드가 맞으면 비밀 값과 구간을 지운다', () => {
    const then = decideDisableTotp({ role: 'DESK', credential: credential(), matchedStep: 101 })
    expect(then).toEqual({
      _tag: 'Disabled',
      credential: credential({ totpSecret: null, totpLastStep: null }),
      events: [{ type: 'TOTP_DISABLED', staffId: STAFF }],
    })
  })

  it('원장은 TOTP_REQUIRED_FOR_ROLE', () => {
    const then = decideDisableTotp({ role: 'DIRECTOR', credential: credential(), matchedStep: 101 })
    expect(then._tag === 'Rejected' && then.error.code).toBe('TOTP_REQUIRED_FOR_ROLE')
  })

  it('코드가 틀리거나 이미 받은 구간이면 TOTP_INVALID', () => {
    for (const matchedStep of [null, 100]) {
      const then = decideDisableTotp({ role: 'MANAGER', credential: credential(), matchedStep })
      expect(then._tag === 'Rejected' && then.error.code).toBe('TOTP_INVALID')
    }
  })
})
