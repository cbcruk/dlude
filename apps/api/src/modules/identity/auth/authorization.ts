// from hemr@0c4b7e8 src/modules/identity/auth/authorization.ts — 테넌트 판정을 빼고 권한을 역할에서 계산
import { Effect, Layer, Option, Redacted } from 'effect'
import { HttpApi, HttpApiMiddleware, HttpApiSecurity } from 'effect/http-api'
import type { HttpApiGroup } from 'effect/http-api'
import { permissionsOf } from '../permissions.ts'
import { CurrentAccess, CurrentSession, accessRuleOf } from './access.ts'
import type { AccessRule } from './access.ts'
import { Auth } from './auth.ts'
import { PermissionDenied, Unauthenticated } from './auth-errors.ts'
import { Authentication } from './authentication.ts'

/**
 * 업무 엔드포인트의 권한 미들웨어. access token을 확인하고, 역할로 권한을 계산해, 엔드포인트가 선언한 권한
 * (`Access.requires`)을 모두 가졌을 때만 핸들러를 부른다. 권한은 토큰에 담지 않고 요청마다 계산한다.
 *
 * - 토큰이 없거나 틀림: 401 `UNAUTHENTICATED`
 * - 권한이 모자람: 403 `PERMISSION_DENIED`
 */
export class Authorization extends HttpApiMiddleware.Service<
  Authorization,
  { provides: CurrentSession | CurrentAccess }
>()('dlude/identity/Authorization', {
  error: [Unauthenticated, PermissionDenied],
  security: { bearer: HttpApiSecurity.bearer },
}) {}

export const AuthorizationLive = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const auth = yield* Auth
    return Authorization.of({
      bearer: (httpEffect, { credential, group, endpoint }) =>
        Effect.gen(function* () {
          const rule = accessRuleOf(group, endpoint)
          // 부팅 검사(`accessCheck`)가 막는 경우지만, 규칙을 못 찾으면 열지 않고 요청을 실패시킨다
          if (Option.isNone(rule) || rule.value.kind !== 'PERMISSIONS') {
            return yield* Effect.die(new Error(`${group.identifier}.${endpoint.identifier}: no permission rule`))
          }
          const session = yield* auth.authenticate(Redacted.value(credential))
          const permissions = permissionsOf(session.role)
          if (!rule.value.permissions.every((each) => permissions.has(each))) return yield* new PermissionDenied({})
          return yield* httpEffect.pipe(
            Effect.provideService(CurrentSession, session),
            Effect.provideService(CurrentAccess, { staffId: session.staffId, role: session.role, permissions }),
          )
        }),
    })
  }),
)

/** 접근 규칙과 미들웨어가 맞지 않는 엔드포인트. */
export interface AccessViolation {
  /** `그룹.엔드포인트`. 예: `patients.list` */
  endpoint: string
  problem:
    | 'NOT_DECLARED'
    | 'PUBLIC_WITH_AUTHENTICATION'
    | 'SIGNED_IN_WITHOUT_AUTHENTICATION'
    | 'PERMISSIONS_WITHOUT_AUTHORIZATION'
    | 'AUTHORIZATION_WITHOUT_PERMISSIONS'
}

/**
 * API의 모든 엔드포인트가 접근 규칙을 선언했고, 규칙에 맞는 미들웨어를 달았는지 검사한다. 규칙만 선언하고
 * 미들웨어를 빠뜨리면 아무도 규칙을 검사하지 않으므로 둘이 맞는지도 본다.
 */
export function accessViolations<Groups extends HttpApiGroup.Constraint>(
  api: HttpApi.HttpApi<string, Groups>,
): AccessViolation[] {
  const violations: AccessViolation[] = []
  HttpApi.reflect(api, {
    onGroup: () => {},
    onEndpoint: ({ group, endpoint, middleware }) => {
      const name = `${group.identifier}.${endpoint.identifier}`
      // 미들웨어 집합의 원소 타입이 두 미들웨어의 클래스 타입과 맞지 않아 넓혀서 찾는다
      const keys: ReadonlySet<unknown> = middleware
      const authorizes = keys.has(Authorization)
      const authenticates = authorizes || keys.has(Authentication)
      const problem = violationOf(accessRuleOf(group, endpoint), authenticates, authorizes)
      if (problem !== null) violations.push({ endpoint: name, problem })
    },
  })
  return violations
}

/**
 * `accessViolations`가 하나라도 있으면 만들어지지 않는 Layer. 앱 Layer에 넣어 서버가 뜨지 않게 한다. 검사하지 않은
 * 엔드포인트가 열린 채로 배포되는 것보다 뜨지 않는 편이 낫다.
 */
export const accessCheck = <Groups extends HttpApiGroup.Constraint>(api: HttpApi.HttpApi<string, Groups>) =>
  Layer.effectDiscard(
    Effect.suspend(() => {
      const violations = accessViolations(api)
      if (violations.length === 0) return Effect.void
      const list = violations.map((each) => `${each.endpoint} ${each.problem}`).join(', ')
      return Effect.die(new Error(`endpoint access rules are invalid: ${list}`))
    }),
  )

function violationOf(
  rule: Option.Option<AccessRule>,
  authenticates: boolean,
  authorizes: boolean,
): AccessViolation['problem'] | null {
  if (Option.isNone(rule)) return 'NOT_DECLARED'
  switch (rule.value.kind) {
    case 'PUBLIC':
      return authenticates ? 'PUBLIC_WITH_AUTHENTICATION' : null
    case 'SIGNED_IN':
      if (authorizes) return 'AUTHORIZATION_WITHOUT_PERMISSIONS'
      return authenticates ? null : 'SIGNED_IN_WITHOUT_AUTHENTICATION'
    case 'PERMISSIONS':
      return authorizes ? null : 'PERMISSIONS_WITHOUT_AUTHORIZATION'
  }
}
