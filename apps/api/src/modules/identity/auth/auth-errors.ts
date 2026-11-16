import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { problemType } from '../../../shared/problem/problem.ts'

// identity-access.md "오류 코드" 표와 같아야 한다. 코드를 더하면 표도 고친다

export class Unauthenticated extends HttpApiError.Problem<Unauthenticated>()(
  'Unauthenticated',
  { type: problemType('UNAUTHENTICATED'), status: 401, title: 'Authentication required' },
  { code: Schema.tag('UNAUTHENTICATED') },
  { description: '`UNAUTHENTICATED`: access token이 없거나 만료·폐기됐다.' },
) {}

export class InvalidCredentials extends HttpApiError.Problem<InvalidCredentials>()(
  'InvalidCredentials',
  { type: problemType('INVALID_CREDENTIALS'), status: 401, title: 'Invalid login ID or password' },
  { code: Schema.tag('INVALID_CREDENTIALS') },
  { description: '`INVALID_CREDENTIALS`: 아이디 또는 비밀번호가 틀렸다. 어느 쪽인지 말하지 않는다.' },
) {}

export class AccountLocked extends HttpApiError.Problem<AccountLocked>()(
  'AccountLocked',
  { type: problemType('ACCOUNT_LOCKED'), status: 423, title: 'Account is locked' },
  { code: Schema.tag('ACCOUNT_LOCKED') },
  { description: '`ACCOUNT_LOCKED`: 비밀번호를 5회 연속 틀려 잠겼다. 0단계에는 해제 API가 없다.' },
) {}

export class ChallengeInvalid extends HttpApiError.Problem<ChallengeInvalid>()(
  'ChallengeInvalid',
  { type: problemType('CHALLENGE_INVALID'), status: 401, title: 'Login challenge is invalid' },
  { code: Schema.tag('CHALLENGE_INVALID') },
  { description: '`CHALLENGE_INVALID`: 로그인 도전이 없거나 만료·폐기됐다. 처음부터 다시 로그인한다.' },
) {}

export class TotpInvalid extends HttpApiError.Problem<TotpInvalid>()(
  'TotpInvalid',
  { type: problemType('TOTP_INVALID'), status: 401, title: 'TOTP code is invalid' },
  { code: Schema.tag('TOTP_INVALID') },
  { description: '`TOTP_INVALID`: 코드가 틀리거나 이미 쓴 30초 구간의 코드다.' },
) {}

export class TotpRequiredForRole extends HttpApiError.Problem<TotpRequiredForRole>()(
  'TotpRequiredForRole',
  { type: problemType('TOTP_REQUIRED_FOR_ROLE'), status: 409, title: 'TOTP cannot be disabled for this role' },
  { code: Schema.tag('TOTP_REQUIRED_FOR_ROLE') },
  { description: '`TOTP_REQUIRED_FOR_ROLE`: 원장은 TOTP를 끌 수 없다.' },
) {}

export class RefreshTokenInvalid extends HttpApiError.Problem<RefreshTokenInvalid>()(
  'RefreshTokenInvalid',
  { type: problemType('REFRESH_TOKEN_INVALID'), status: 401, title: 'Refresh token is invalid' },
  { code: Schema.tag('REFRESH_TOKEN_INVALID') },
  { description: '`REFRESH_TOKEN_INVALID`: refresh 쿠키가 없거나, 모르는 값이거나, 세션이 끝났다.' },
) {}

export class RefreshTokenReused extends HttpApiError.Problem<RefreshTokenReused>()(
  'RefreshTokenReused',
  { type: problemType('REFRESH_TOKEN_REUSED'), status: 401, title: 'Refresh token was reused' },
  { code: Schema.tag('REFRESH_TOKEN_REUSED') },
  { description: '`REFRESH_TOKEN_REUSED`: 이미 회전한 refresh token이 유예 시간 밖에 다시 왔다. 세션을 폐기했다.' },
) {}

export class PermissionDenied extends HttpApiError.Problem<PermissionDenied>()(
  'PermissionDenied',
  { type: problemType('PERMISSION_DENIED'), status: 403, title: 'Permission denied' },
  { code: Schema.tag('PERMISSION_DENIED') },
  { description: '`PERMISSION_DENIED`: 역할에 이 요청의 권한이 없다.' },
) {}
