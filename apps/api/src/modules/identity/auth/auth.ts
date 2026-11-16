import { Clock, Context, Effect, Layer, Option } from 'effect'
import { newId, isId } from '../../../shared/ids/ids.ts'
import { Transaction } from '../../../shared/db/transaction.ts'
import { IdentityRepository } from '../identity-repository.ts'
import {
  decideDisableTotp,
  decidePasswordLogin,
  decideVerifyTotp,
  totpSecretFor,
} from '../login-challenge.aggregate.ts'
import type { LoginNext } from '../login-challenge.aggregate.ts'
import { permissionsOf } from '../permissions.ts'
import type { Permission } from '../permissions.ts'
import { decideLogout, decideRefresh, isSessionActive } from '../session.aggregate.ts'
import type { Session } from '../session.aggregate.ts'
import type { Staff } from '../staff.ts'
import { ACCESS_TOKEN_TTL_SECONDS, signAccessToken, verifyAccessToken } from './access-token.ts'
import { requirePermissions } from './access.ts'
import type { CurrentSession } from './access.ts'
import { AuthConfig } from './auth-config.ts'
import {
  AccountLocked,
  ChallengeInvalid,
  InvalidCredentials,
  PermissionDenied,
  RefreshTokenInvalid,
  RefreshTokenReused,
  TotpInvalid,
  TotpRequiredForRole,
  Unauthenticated,
} from './auth-errors.ts'
import { DUMMY_PASSWORD_HASH, verifyPassword } from './password.ts'
import { newRefreshToken, refreshTokenHash } from './refresh-token.ts'
import { open, seal } from './secret-box.ts'
import { SecurityLog } from './security-log.ts'
import { generateTotpSecret, matchTotp, otpauthUri } from './totp.ts'

export interface LoginStarted {
  next: LoginNext
  /** `:verify-totp`에 보내는 값. 로그인 도전 ID다(5분, 코드 5회까지, TOTP 없이는 쓸모없음). */
  challengeToken: string
  expiresIn: number
  /** `TOTP_ENROLL`이면 인증 앱에 등록할 URI. */
  otpauthUri?: string
}

export interface SessionIssued {
  accessToken: string
  expiresIn: number
  staff: Staff
  /** 새 refresh token. 응답 쿠키로만 낸다. */
  refreshToken: string
}

export interface Refreshed {
  accessToken: string
  expiresIn: number
  /** 새 refresh token. 동시 refresh(유예 안)면 앞 응답이 이미 쿠키를 바꿨으므로 `null`. */
  refreshToken: string | null
}

export interface Me {
  staff: Staff
  permissions: Permission[]
  totpEnrolled: boolean
}

/**
 * 로그인·세션 서비스. 읽기 → 판정(`*.aggregate.ts`) → 저장만 한다.
 *
 * 보안 기록과 실패 횟수·잠금은 업무 트랜잭션과 따로 바로 쓴다. 실패 응답이어도 남아야 하기 때문이다.
 */
export class Auth extends Context.Service<
  Auth,
  {
    login(input: { loginId: string; password: string }): Effect.Effect<LoginStarted, InvalidCredentials | AccountLocked>
    verifyTotp(input: {
      challengeToken: string
      code: string
    }): Effect.Effect<SessionIssued, ChallengeInvalid | TotpInvalid>
    refresh(input: {
      refreshToken: string | undefined
    }): Effect.Effect<Refreshed, RefreshTokenInvalid | RefreshTokenReused>
    logout(input: { refreshToken: string | undefined; accessToken: string | undefined }): Effect.Effect<void>
    /** access token을 확인한다. 서명·만료와 함께 세션이 살아 있는지 저장소에서 본다. */
    authenticate(accessToken: string): Effect.Effect<CurrentSession['Service'], Unauthenticated>
    me(session: CurrentSession['Service']): Effect.Effect<Me, Unauthenticated>
    disableTotp(
      session: CurrentSession['Service'],
      code: string,
    ): Effect.Effect<void, TotpRequiredForRole | TotpInvalid | PermissionDenied | Unauthenticated>
  }
>()('dlude/identity/Auth') {
  static readonly layer = Layer.effect(
    Auth,
    Effect.gen(function* () {
      const repository = yield* IdentityRepository
      const transaction = yield* Transaction
      const securityLog = yield* SecurityLog
      const config = yield* AuthConfig

      const now = Effect.map(Clock.currentTimeMillis, (millis) => ({ millis, at: new Date(millis).toISOString() }))

      const issueAccessToken = (
        staffId: Staff['id'],
        sessionId: Parameters<typeof signAccessToken>[1]['sid'],
        nowMillis: number,
      ) =>
        signAccessToken(config.jwtSecret, {
          sub: staffId,
          sid: sessionId,
          iat: Math.floor(nowMillis / 1000),
          exp: Math.floor(nowMillis / 1000) + ACCESS_TOKEN_TTL_SECONDS,
        })

      /** 봉인한 TOTP 비밀 값으로 코드가 맞은 구간. 비밀 값이 없거나 열리지 않으면 `null`. */
      const matchSealed = (sealed: string | null, code: string, nowMillis: number) =>
        Effect.gen(function* () {
          if (sealed === null) return null
          const secret = yield* open(config.dataKey, sealed)
          return Option.isNone(secret) ? null : yield* matchTotp(secret.value, code, nowMillis)
        })

      const login = Effect.fn('Auth.login')(function* (input: { loginId: string; password: string }) {
        const { millis, at } = yield* now
        const staff = yield* repository.findStaffByLoginId(input.loginId)
        const credential = Option.isSome(staff) ? yield* repository.findCredential(staff.value.id) : Option.none()
        // 없는 아이디도 같은 시간이 걸리게 고정 해시로 검증한다
        const passwordMatches = yield* verifyPassword(
          input.password,
          Option.match(credential, { onNone: () => DUMMY_PASSWORD_HASH, onSome: (c) => c.passwordHash }),
        )
        const enrollPlain = generateTotpSecret()
        const decision = decidePasswordLogin(
          {
            credential: Option.getOrNull(credential),
            passwordMatches: Option.isSome(credential) && passwordMatches,
            challengeId: newId('loginChallenge', millis),
            enrollSecret: yield* seal(config.dataKey, enrollPlain),
          },
          { at },
        )
        yield* securityLog.record(at, decision.events)
        if (decision._tag === 'Rejected') {
          if (decision.credential !== null) yield* repository.saveCredential(decision.credential)
          if (decision.revokeSessions && decision.credential !== null) {
            yield* repository.revokeSessionsOf(decision.credential.staffId, at)
          }
          return yield* Effect.fail(decision.error)
        }
        yield* transaction.run(
          Effect.all([repository.saveCredential(decision.credential), repository.saveChallenge(decision.challenge)]),
        )
        const { challenge } = decision
        return {
          next: challenge.next,
          challengeToken: challenge.id,
          expiresIn: Math.round((Date.parse(challenge.expiresAt) - millis) / 1000),
          ...(challenge.next === 'TOTP_ENROLL' && Option.isSome(staff)
            ? { otpauthUri: otpauthUri(enrollPlain, staff.value.loginId) }
            : {}),
        } satisfies LoginStarted
      })

      const verifyTotp = Effect.fn('Auth.verifyTotp')(function* (input: { challengeToken: string; code: string }) {
        const { millis, at } = yield* now
        const challenge = isId('loginChallenge', input.challengeToken)
          ? yield* repository.findChallenge(input.challengeToken)
          : Option.none()
        if (Option.isNone(challenge)) return yield* new ChallengeInvalid({})
        const credential = yield* repository.findCredential(challenge.value.staffId)
        const staff = yield* repository.findStaff(challenge.value.staffId)
        if (Option.isNone(credential) || Option.isNone(staff)) return yield* new ChallengeInvalid({})

        const refreshToken = newRefreshToken()
        const decision = decideVerifyTotp(
          {
            challenge: challenge.value,
            credential: credential.value,
            matchedStep: yield* matchSealed(totpSecretFor(challenge.value, credential.value), input.code, millis),
            sessionId: newId('session', millis),
            refreshHash: yield* refreshTokenHash(refreshToken),
          },
          { at },
        )
        yield* securityLog.record(at, decision.events)
        if (decision._tag === 'Rejected') {
          if (decision.challenge !== null) yield* repository.saveChallenge(decision.challenge)
          return yield* Effect.fail(decision.error)
        }
        yield* transaction.run(
          Effect.all([
            repository.saveChallenge(decision.challenge),
            repository.saveCredential(decision.credential),
            repository.saveSession(decision.session),
          ]),
        )
        return {
          accessToken: yield* issueAccessToken(staff.value.id, decision.session.id, millis),
          expiresIn: ACCESS_TOKEN_TTL_SECONDS,
          staff: staff.value,
          refreshToken,
        } satisfies SessionIssued
      })

      const refresh = Effect.fn('Auth.refresh')(function* (input: { refreshToken: string | undefined }) {
        if (input.refreshToken === undefined || input.refreshToken === '') return yield* new RefreshTokenInvalid({})
        const { millis, at } = yield* now
        const presentedHash = yield* refreshTokenHash(input.refreshToken)
        const session = yield* repository.findSessionByRefreshHash(presentedHash)
        const nextToken = newRefreshToken()
        const decision = decideRefresh(
          { session: Option.getOrNull(session), presentedHash, nextHash: yield* refreshTokenHash(nextToken) },
          { at },
        )
        if (decision._tag === 'Rejected') {
          yield* securityLog.record(at, decision.events)
          if (decision.session !== null) yield* repository.saveSession(decision.session)
          return yield* Effect.fail(decision.error)
        }
        if (decision._tag === 'Rotated') yield* repository.saveSession(decision.session)
        return {
          accessToken: yield* issueAccessToken(decision.session.staffId, decision.session.id, millis),
          expiresIn: ACCESS_TOKEN_TTL_SECONDS,
          refreshToken: decision._tag === 'Rotated' ? nextToken : null,
        } satisfies Refreshed
      })

      const logout = Effect.fn('Auth.logout')(function* (input: {
        refreshToken: string | undefined
        accessToken: string | undefined
      }) {
        const { at } = yield* now
        let session = Option.none<Session>()
        if (input.refreshToken !== undefined && input.refreshToken !== '') {
          session = yield* repository.findSessionByRefreshHash(yield* refreshTokenHash(input.refreshToken))
        }
        if (Option.isNone(session) && input.accessToken !== undefined) {
          // 서명만 확인한다. 만료된 access token으로도 로그아웃은 된다
          const claims = yield* verifyAccessToken(config.jwtSecret, input.accessToken, 0)
          if (Option.isSome(claims)) session = yield* repository.findSession(claims.value.sid)
        }
        if (Option.isNone(session)) return
        const decision = decideLogout(session.value, { at })
        yield* repository.saveSession(decision.session)
        yield* securityLog.record(at, decision.events)
      })

      const authenticate = Effect.fn('Auth.authenticate')(function* (accessToken: string) {
        const { millis, at } = yield* now
        const claims = yield* verifyAccessToken(config.jwtSecret, accessToken, millis)
        if (Option.isNone(claims)) return yield* new Unauthenticated({})
        const session = yield* repository.findSession(claims.value.sid)
        if (
          Option.isNone(session) ||
          !isSessionActive(session.value, at) ||
          session.value.staffId !== claims.value.sub
        ) {
          return yield* new Unauthenticated({})
        }
        const staff = yield* repository.findStaff(claims.value.sub)
        if (Option.isNone(staff)) return yield* new Unauthenticated({})
        return { staffId: staff.value.id, sessionId: session.value.id, role: staff.value.role }
      })

      const me = Effect.fn('Auth.me')(function* (session: CurrentSession['Service']) {
        const staff = yield* repository.findStaff(session.staffId)
        const credential = yield* repository.findCredential(session.staffId)
        if (Option.isNone(staff)) return yield* new Unauthenticated({})
        return {
          staff: staff.value,
          permissions: [...permissionsOf(staff.value.role)].sort(),
          totpEnrolled: Option.isSome(credential) && credential.value.totpSecret !== null,
        } satisfies Me
      })

      const disableTotp = Effect.fn('Auth.disableTotp')(function* (session: CurrentSession['Service'], code: string) {
        const { millis, at } = yield* now
        const staff = yield* repository.findStaff(session.staffId)
        const credential = yield* repository.findCredential(session.staffId)
        if (Option.isNone(staff) || Option.isNone(credential)) return yield* new Unauthenticated({})
        // 원장은 권한 검사보다 먼저 409로 이유를 알린다. 그 밖의 역할은 `totp:disable_own`을 확인한다
        if (staff.value.role !== 'DIRECTOR') {
          yield* requirePermissions({ permissions: permissionsOf(staff.value.role) }, 'totp:disable_own')
        }
        const decision = decideDisableTotp({
          role: staff.value.role,
          credential: credential.value,
          matchedStep: yield* matchSealed(credential.value.totpSecret, code, millis),
        })
        yield* securityLog.record(at, decision.events)
        if (decision._tag === 'Rejected') return yield* Effect.fail(decision.error)
        yield* repository.saveCredential(decision.credential)
      })

      return Auth.of({ login, verifyTotp, refresh, logout, authenticate, me, disableTotp })
    }),
  )
}
