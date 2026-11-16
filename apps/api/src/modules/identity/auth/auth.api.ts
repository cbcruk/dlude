import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from 'effect/http-api'
import { PERMISSIONS } from '../permissions.ts'
import { STAFF_ROLES } from '../staff.ts'
import { Access } from './access.ts'
import {
  AccountLocked,
  ChallengeInvalid,
  InvalidCredentials,
  PermissionDenied,
  RefreshTokenInvalid,
  RefreshTokenReused,
  TotpInvalid,
  TotpRequiredForRole,
} from './auth-errors.ts'
import { Authentication } from './authentication.ts'

const AccessToken = {
  accessToken: Schema.String.annotate({ description: '`Authorization: Bearer`로 보내는 access token. 10분.' }),
  expiresIn: Schema.Int.annotate({ description: 'access token 수명(초).' }),
}

const TotpCode = Schema.String.check(Schema.isPattern(/^\d{6}$/)).annotate({
  description: '인증 앱의 6자리 코드.',
})

export const StaffRole = Schema.Literals(STAFF_ROLES).annotate({
  identifier: 'StaffRole',
  description: '역할. 원장(`DIRECTOR`), 실장(`MANAGER`), 위생사(`HYGIENIST`), 데스크(`DESK`).',
})

export const StaffSummary = Schema.Struct({
  id: Schema.String,
  loginId: Schema.String,
  name: Schema.String,
  role: StaffRole,
  emoji: Schema.String,
  synthetic: Schema.Boolean.annotate({ description: '시드가 만든 가상 직원이면 `true`.' }),
}).annotate({ identifier: 'StaffSummary', description: '직원.' })

export const LoginStartedResponse = Schema.Struct({
  next: Schema.Literals(['TOTP', 'TOTP_ENROLL']).annotate({
    description:
      '다음 단계. `TOTP`면 인증 앱 코드를, `TOTP_ENROLL`이면 `otpauthUri`를 인증 앱에 등록한 뒤 첫 코드를 `:verify-totp`로 보낸다.',
  }),
  challengeToken: Schema.String.annotate({ description: '`:verify-totp`에 보내는 로그인 도전. 5분.' }),
  expiresIn: Schema.Int.annotate({ description: '로그인 도전 수명(초).' }),
  otpauthUri: Schema.optionalKey(Schema.String).annotate({
    description: '`TOTP_ENROLL`일 때만. QR로 보여 줄 `otpauth://` URI.',
  }),
}).annotate({ description: '비밀번호가 맞았다. 세션은 아직 없고 TOTP를 거쳐야 한다.' })

export const SessionResponse = Schema.Struct({ ...AccessToken, staff: StaffSummary }).annotate({
  description: '로그인했다. refresh token은 본문에 싣지 않고 `HttpOnly` 쿠키 `dlude_refresh`로 준다.',
})

export const MeResponse = Schema.Struct({
  staff: StaffSummary,
  permissions: Schema.Array(Schema.Literals(PERMISSIONS)).annotate({
    description: '역할에서 계산한 권한. 클라이언트는 메뉴를 거르는 데만 쓰고, 판정은 서버가 한다.',
  }),
  totpEnrolled: Schema.Boolean.annotate({ description: 'TOTP를 등록했는지.' }),
}).annotate({ description: '로그인한 직원 자신.' })

export class AuthApi extends HttpApiGroup.make('auth')
  .add(
    HttpApiEndpoint.post('login', '/sessions', {
      payload: Schema.Struct({
        loginId: Schema.NonEmptyString.check(Schema.isMaxLength(64)).annotate({
          description: '로그인 아이디. 대소문자를 가리지 않는다.',
        }),
        // 매우 긴 입력으로 해시 계산에 시간을 쓰게 하지 않도록 길이를 제한한다
        password: Schema.NonEmptyString.check(Schema.isMaxLength(256)).annotate({
          description: '비밀번호. 256자까지.',
        }),
      }),
      success: LoginStartedResponse,
      error: [InvalidCredentials, AccountLocked],
    })
      .annotate(Access, Access.public)
      .annotate(OpenApi.Summary, '로그인 시작(비밀번호)'),
    HttpApiEndpoint.post('verifyTotp', '/sessions::verify-totp', {
      payload: Schema.Struct({ challengeToken: Schema.String.check(Schema.isMaxLength(64)), code: TotpCode }),
      success: SessionResponse,
      error: [ChallengeInvalid, TotpInvalid],
    })
      .annotate(Access, Access.public)
      .annotate(OpenApi.Summary, '로그인 완료(TOTP)')
      .annotate(
        OpenApi.Description,
        '로그인 도전의 TOTP 코드를 확인하고 세션을 만든다. `TOTP_ENROLL` 도전이면 첫 코드를 맞히는 순간 등록도 된다. 같은 30초 구간의 코드는 한 번만 받는다.',
      ),
    HttpApiEndpoint.post('refresh', '/sessions::refresh', {
      success: Schema.Struct(AccessToken).annotate({
        description: '새 access token. refresh token을 회전했으면 쿠키도 새로 준다.',
      }),
      error: [RefreshTokenInvalid, RefreshTokenReused],
    })
      .annotate(Access, Access.public)
      .annotate(OpenApi.Summary, 'access token 새로 받기'),
    HttpApiEndpoint.delete('logout', '/sessions/current', {
      success: HttpApiSchema.NoContent.annotate({ description: '로그아웃했다. refresh 쿠키를 지운다.' }),
    })
      .annotate(Access, Access.public)
      .annotate(OpenApi.Summary, '로그아웃')
      .annotate(
        OpenApi.Description,
        '로그인하지 않아도 부를 수 있다. refresh 쿠키나 access token이 가리키는 세션이 있으면 끝낸다.',
      ),
  )
  .prefix('/auth')
  .annotate(
    OpenApi.Description,
    '로그인 세션. 비밀번호 → TOTP 두 단계를 모든 직원이 거친다. access token은 본문으로, refresh token은 `HttpOnly` 쿠키로 준다.',
  ) {}

export class MeApi extends HttpApiGroup.make('me')
  .add(
    HttpApiEndpoint.get('me', '/me', { success: MeResponse })
      .middleware(Authentication)
      .annotate(Access, Access.signedIn)
      .annotate(OpenApi.Summary, '내 정보와 권한'),
    HttpApiEndpoint.post('disableTotp', '/me/totp::disable', {
      payload: Schema.Struct({ code: TotpCode }),
      success: HttpApiSchema.NoContent.annotate({
        description: 'TOTP 비밀 값을 지웠다. 다음 로그인에서 다시 등록한다.',
      }),
      error: [TotpRequiredForRole, TotpInvalid, PermissionDenied],
    })
      .middleware(Authentication)
      .annotate(Access, Access.signedIn)
      .annotate(OpenApi.Summary, '내 TOTP 해제')
      .annotate(
        OpenApi.Description,
        '원장은 409 `TOTP_REQUIRED_FOR_ROLE`. 그 밖의 역할은 `totp:disable_own` 권한을 서비스가 확인한다(원장에게 이유를 알리려고 엔드포인트 선언이 아니라 서비스에서 본다). 해제는 2단계를 건너뛰는 것이 아니라 다음 로그인에서 다시 등록하게 하는 것이다.',
      ),
  )
  .annotate(OpenApi.Description, '로그인한 직원 자신.') {}
