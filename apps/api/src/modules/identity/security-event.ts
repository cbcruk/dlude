import type { Id } from '../../shared/ids/ids.types.ts'

/** 보안 기록 종류 (identity-access.md "보안 기록"). */
export type SecurityEventType =
  | 'LOGIN_SUCCEEDED'
  | 'LOGIN_FAILED'
  | 'ACCOUNT_LOCKED'
  | 'TOTP_FAILED'
  | 'TOTP_ENROLLED'
  | 'TOTP_DISABLED'
  | 'REFRESH_TOKEN_REUSED'
  | 'LOGGED_OUT'

export type LoginFailureReason = 'UNKNOWN_LOGIN_ID' | 'PASSWORD_MISMATCH' | 'LOCKED'

/**
 * 판정 함수가 내는 보안 기록. 시각은 판정 문맥의 시각이고, 저장은 서비스가 업무 트랜잭션과 따로 한다(실패도 남아야
 * 하므로). 비밀번호·코드·토큰 값은 담지 않는다(P7).
 */
export interface SecurityEventDraft {
  type: SecurityEventType
  staffId: Id<'staff'> | null
  sessionId?: Id<'session'>
  reason?: LoginFailureReason
}
