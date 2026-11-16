import type { Id } from '../../shared/ids/ids.types.ts'

/** 직원 역할 (identity-access.md 용어). */
export const STAFF_ROLES = ['DIRECTOR', 'MANAGER', 'HYGIENIST', 'DESK'] as const
export type StaffRole = (typeof STAFF_ROLES)[number]

/** 로그인하는 사람. */
export interface Staff {
  id: Id<'staff'>
  loginId: string
  name: string
  role: StaffRole
  emoji: string
  /** 시드가 만든 가상 직원이면 `true`(P6). */
  synthetic: boolean
}

/**
 * 직원의 인증 상태. 비밀번호·TOTP 비밀 값은 원문으로 두지 않는다.
 *
 * - `totpSecret`: `DATA_KEY`로 AES-GCM 봉인한 값. `null`이면 아직 등록하지 않았거나 해제했다
 * - `totpLastStep`: 마지막으로 받은 30초 구간 번호. 같은 구간 코드를 두 번 받지 않으려고 둔다
 */
export interface StaffCredential {
  staffId: Id<'staff'>
  passwordHash: string
  failedAttempts: number
  lockedAt: string | null
  totpSecret: string | null
  totpLastStep: number | null
}
