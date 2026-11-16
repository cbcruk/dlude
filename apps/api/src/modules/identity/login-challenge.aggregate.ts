import type { Id } from '../../shared/ids/ids.types.ts'
import {
  AccountLocked,
  ChallengeInvalid,
  InvalidCredentials,
  TotpInvalid,
  TotpRequiredForRole,
} from './auth/auth-errors.ts'
import type { SecurityEventDraft } from './security-event.ts'
import { newSession, type Session } from './session.aggregate.ts'
import type { StaffCredential, StaffRole } from './staff.ts'

/**
 * 로그인 도전과 TOTP 등록·해제 판정 (identity-access.md "로그인", spec "상태").
 *
 * 비밀번호를 맞히면 도전(`PENDING`)이 생기고, TOTP 코드를 맞히면 도전이 `USED`가 되며 세션이 생긴다. 비밀번호만으로는
 * 세션이 나오지 않는다(F7). 판정은 거부도 저장할 것(실패 횟수, 잠금, 보안 기록)을 함께 돌려주므로 `Result` 대신
 * 결과 태그를 쓴다.
 */

/** 비밀번호 연속 실패 몇 번에 잠그는지. */
export const LOCK_AFTER_FAILURES = 5
/** 로그인 도전 유효 시간. */
export const CHALLENGE_TTL_MILLIS = 5 * 60 * 1000
/** 코드 몇 번 틀리면 도전을 폐기하는지. 비밀번호 실패 횟수와 따로 센다. */
export const MAX_CODE_FAILURES = 5

export type LoginNext = 'TOTP' | 'TOTP_ENROLL'

export interface LoginChallenge {
  id: Id<'loginChallenge'>
  staffId: Id<'staff'>
  next: LoginNext
  /** `TOTP_ENROLL`이면 이번에 등록할 비밀 값(봉인). 첫 코드를 맞히면 직원의 비밀 값이 된다. */
  enrollSecret: string | null
  status: 'PENDING' | 'USED' | 'EXPIRED'
  failedCodes: number
  createdAt: string
  expiresAt: string
}

export interface Clock {
  /** 판정 시각. ISO 8601. */
  at: string
}

export type PasswordLoginDecision =
  | {
      _tag: 'Rejected'
      error: InvalidCredentials | AccountLocked
      /** 저장할 인증 상태. 없는 아이디면 `null`. */
      credential: StaffCredential | null
      /** 이번 실패로 잠갔으면 그 직원의 세션을 모두 끝낸다. */
      revokeSessions: boolean
      events: SecurityEventDraft[]
    }
  | { _tag: 'Challenged'; credential: StaffCredential; challenge: LoginChallenge; events: SecurityEventDraft[] }

/**
 * 비밀번호 확인 결과로 로그인을 판정한다.
 *
 * - 없는 아이디 → `INVALID_CREDENTIALS` (서비스가 고정 해시로 검증 시간을 맞춘 뒤 부른다)
 * - 이미 잠김 → `ACCOUNT_LOCKED`
 * - 틀림 → 실패 횟수 +1. 5번째면 잠그고 `ACCOUNT_LOCKED`, 아니면 `INVALID_CREDENTIALS`
 * - 맞음 → 실패 횟수 0, 도전 `PENDING`. TOTP를 등록했으면 `TOTP`, 아니면 `TOTP_ENROLL`
 */
export function decidePasswordLogin(
  input: {
    credential: StaffCredential | null
    passwordMatches: boolean
    challengeId: Id<'loginChallenge'>
    /** 등록하지 않은 직원에게 줄 새 비밀 값(봉인). 등록한 직원이면 쓰지 않는다. */
    enrollSecret: string
  },
  clock: Clock,
): PasswordLoginDecision {
  const { credential } = input
  if (credential === null) {
    return {
      _tag: 'Rejected',
      error: new InvalidCredentials({}),
      credential: null,
      revokeSessions: false,
      events: [{ type: 'LOGIN_FAILED', staffId: null, reason: 'UNKNOWN_LOGIN_ID' }],
    }
  }
  const staffId = credential.staffId
  if (credential.lockedAt !== null) {
    return {
      _tag: 'Rejected',
      error: new AccountLocked({}),
      credential,
      revokeSessions: false,
      events: [{ type: 'LOGIN_FAILED', staffId, reason: 'LOCKED' }],
    }
  }
  if (!input.passwordMatches) {
    const failedAttempts = credential.failedAttempts + 1
    const locks = failedAttempts >= LOCK_AFTER_FAILURES
    return {
      _tag: 'Rejected',
      error: locks ? new AccountLocked({}) : new InvalidCredentials({}),
      credential: { ...credential, failedAttempts, lockedAt: locks ? clock.at : null },
      revokeSessions: locks,
      events: [
        { type: 'LOGIN_FAILED', staffId, reason: 'PASSWORD_MISMATCH' },
        ...(locks ? [{ type: 'ACCOUNT_LOCKED' as const, staffId }] : []),
      ],
    }
  }
  const enrolled = credential.totpSecret !== null
  return {
    _tag: 'Challenged',
    credential: { ...credential, failedAttempts: 0 },
    challenge: {
      id: input.challengeId,
      staffId,
      next: enrolled ? 'TOTP' : 'TOTP_ENROLL',
      enrollSecret: enrolled ? null : input.enrollSecret,
      status: 'PENDING',
      failedCodes: 0,
      createdAt: clock.at,
      expiresAt: new Date(Date.parse(clock.at) + CHALLENGE_TTL_MILLIS).toISOString(),
    },
    events: [],
  }
}

/** 이 도전의 코드를 검증할 비밀 값(봉인). 등록 중이면 도전의 새 비밀 값, 아니면 직원의 비밀 값. */
export function totpSecretFor(challenge: LoginChallenge, credential: StaffCredential): string | null {
  return challenge.next === 'TOTP_ENROLL' ? challenge.enrollSecret : credential.totpSecret
}

export type VerifyTotpDecision =
  | {
      _tag: 'Rejected'
      error: ChallengeInvalid | TotpInvalid
      /** 저장할 도전. 도전이 없었으면 `null`. */
      challenge: LoginChallenge | null
      events: SecurityEventDraft[]
    }
  | {
      _tag: 'Accepted'
      challenge: LoginChallenge
      credential: StaffCredential
      session: Session
      events: SecurityEventDraft[]
    }

/**
 * TOTP 코드로 로그인 도전을 판정한다. `matchedStep`은 코드가 맞은 30초 구간(서비스가 `matchTotp`로 계산), 틀렸으면
 * `null`.
 *
 * - 도전이 없거나 `PENDING`이 아니거나 만료 → `CHALLENGE_INVALID` (만료면 `EXPIRED`로 저장)
 * - 직원이 잠김 → `CHALLENGE_INVALID` (도전 중 다른 곳에서 잠긴 경우)
 * - 코드가 틀리거나 이미 받은 구간 이하 → `TOTP_INVALID`, 틀린 횟수 +1. 5번째면 도전을 `EXPIRED`로
 * - 맞음 → 도전 `USED`, 세션 `ACTIVE`. 등록 중이었으면 비밀 값을 직원에게 옮긴다. 받은 구간 번호를 남긴다
 */
export function decideVerifyTotp(
  input: {
    challenge: LoginChallenge | null
    credential: StaffCredential
    matchedStep: number | null
    sessionId: Id<'session'>
    refreshHash: string
  },
  clock: Clock,
): VerifyTotpDecision {
  const { challenge, credential } = input
  if (challenge === null || challenge.status !== 'PENDING' || credential.lockedAt !== null) {
    return { _tag: 'Rejected', error: new ChallengeInvalid({}), challenge, events: [] }
  }
  if (challenge.expiresAt <= clock.at) {
    return {
      _tag: 'Rejected',
      error: new ChallengeInvalid({}),
      challenge: { ...challenge, status: 'EXPIRED' },
      events: [],
    }
  }
  const replayed =
    input.matchedStep !== null && credential.totpLastStep !== null && input.matchedStep <= credential.totpLastStep
  if (input.matchedStep === null || replayed) {
    const failedCodes = challenge.failedCodes + 1
    return {
      _tag: 'Rejected',
      error: new TotpInvalid({}),
      challenge: { ...challenge, failedCodes, status: failedCodes >= MAX_CODE_FAILURES ? 'EXPIRED' : 'PENDING' },
      events: [{ type: 'TOTP_FAILED', staffId: challenge.staffId }],
    }
  }
  const enrolling = challenge.next === 'TOTP_ENROLL'
  const session = newSession(input.sessionId, challenge.staffId, input.refreshHash, clock.at)
  return {
    _tag: 'Accepted',
    challenge: { ...challenge, status: 'USED' },
    credential: {
      ...credential,
      totpSecret: enrolling ? challenge.enrollSecret : credential.totpSecret,
      totpLastStep: input.matchedStep,
    },
    session,
    events: [
      ...(enrolling ? [{ type: 'TOTP_ENROLLED' as const, staffId: challenge.staffId }] : []),
      { type: 'LOGIN_SUCCEEDED', staffId: challenge.staffId, sessionId: session.id },
    ],
  }
}

export type DisableTotpDecision =
  | { _tag: 'Rejected'; error: TotpRequiredForRole | TotpInvalid; events: SecurityEventDraft[] }
  | { _tag: 'Disabled'; credential: StaffCredential; events: SecurityEventDraft[] }

/**
 * 내 TOTP 해제를 판정한다. "해제"는 비밀 값을 지워 다음 로그인에서 다시 등록하게 하는 것이고, 2단계를 건너뛰게 하는
 * 것이 아니다(identity-access.md).
 *
 * - 원장 → `TOTP_REQUIRED_FOR_ROLE` (권한 검사보다 먼저 보는 업무 규칙. 원장은 `totp:disable_own`도 없다)
 * - 코드가 틀리거나 이미 받은 구간 이하 → `TOTP_INVALID`
 * - 맞음 → 비밀 값과 구간 번호를 지운다
 */
export function decideDisableTotp(input: {
  role: StaffRole
  credential: StaffCredential
  matchedStep: number | null
}): DisableTotpDecision {
  const { credential } = input
  if (input.role === 'DIRECTOR') {
    return { _tag: 'Rejected', error: new TotpRequiredForRole({}), events: [] }
  }
  const replayed =
    input.matchedStep !== null && credential.totpLastStep !== null && input.matchedStep <= credential.totpLastStep
  if (credential.totpSecret === null || input.matchedStep === null || replayed) {
    return {
      _tag: 'Rejected',
      error: new TotpInvalid({}),
      events: [{ type: 'TOTP_FAILED', staffId: credential.staffId }],
    }
  }
  return {
    _tag: 'Disabled',
    credential: { ...credential, totpSecret: null, totpLastStep: null },
    events: [{ type: 'TOTP_DISABLED', staffId: credential.staffId }],
  }
}
