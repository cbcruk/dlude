import { Effect, Exit, Layer, Schema } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { afterAll, describe, expect, it } from 'vitest'
import { Api } from '../../../api.ts'
import { IdentityLive } from '../../../app.ts'
import { RequestValidationLive } from '../../../shared/problem/request-validation.ts'
import { TestSql } from '../../../testing/sql.ts'
import { Access, CurrentAccess } from './access.ts'
import { TestAuthConfig } from './auth-config.ts'
import { AuthHttpLive } from './auth.http.ts'
import { Authentication } from './authentication.ts'
import { Authorization, accessCheck, accessViolations } from './authorization.ts'
import { SeededIdentity, signIn } from './testing.ts'

const ok = { success: Schema.Struct({ ok: Schema.Boolean }) }

describe('accessViolations', () => {
  it('지금 API에는 위반이 없다', () => {
    expect(accessViolations(Api)).toEqual([])
  })

  it('규칙이 없거나 미들웨어와 맞지 않는 엔드포인트를 모두 찾는다', () => {
    const api = HttpApi.make('test').add(
      HttpApiGroup.make('cases')
        .add(HttpApiEndpoint.get('undeclared', '/a', ok))
        .add(HttpApiEndpoint.get('publicWithAuth', '/b', ok).middleware(Authentication).annotate(Access, Access.public))
        .add(HttpApiEndpoint.get('signedInBare', '/c', ok).annotate(Access, Access.signedIn))
        .add(HttpApiEndpoint.get('permissionsBare', '/d', ok).annotate(Access, Access.requires('patient:read')))
        .add(
          HttpApiEndpoint.get('signedInWithAuthorization', '/e', ok)
            .middleware(Authorization)
            .annotate(Access, Access.signedIn),
        )
        .add(
          HttpApiEndpoint.get('fine', '/f', ok)
            .middleware(Authorization)
            .annotate(Access, Access.requires('patient:read')),
        ),
    )
    expect(accessViolations(api)).toEqual([
      { endpoint: 'cases.undeclared', problem: 'NOT_DECLARED' },
      { endpoint: 'cases.publicWithAuth', problem: 'PUBLIC_WITH_AUTHENTICATION' },
      { endpoint: 'cases.signedInBare', problem: 'SIGNED_IN_WITHOUT_AUTHENTICATION' },
      { endpoint: 'cases.permissionsBare', problem: 'PERMISSIONS_WITHOUT_AUTHORIZATION' },
      { endpoint: 'cases.signedInWithAuthorization', problem: 'AUTHORIZATION_WITHOUT_PERMISSIONS' },
    ])
  })

  it('접근 규칙을 빠뜨린 엔드포인트가 있으면 앱 Layer가 만들어지지 않는다', async () => {
    const api = HttpApi.make('test').add(HttpApiGroup.make('cases').add(HttpApiEndpoint.get('undeclared', '/a', ok)))
    const exit = await Effect.runPromiseExit(Layer.build(accessCheck(api)).pipe(Effect.scoped))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(String(Exit.isFailure(exit) && exit.cause)).toContain('cases.undeclared NOT_DECLARED')
  })
})

describe('Authorization', () => {
  // 실장만 가진 `staff:read`를 요구하는 시험용 엔드포인트
  class StaffOnlyApi extends HttpApiGroup.make('staffOnly').add(
    HttpApiEndpoint.get('read', '/staff-only', { success: Schema.Struct({ role: Schema.String }) })
      .middleware(Authorization)
      .annotate(Access, Access.requires('staff:read')),
  ) {}
  class TestApi extends HttpApi.make('dlude').add(Api.groups.auth).add(StaffOnlyApi).prefix('/v1') {}

  const StaffOnlyLive = HttpApiBuilder.group(TestApi, 'staffOnly', (handlers) =>
    handlers.handle('read', () => Effect.map(CurrentAccess, (access) => ({ role: access.role }))),
  )
  const web = HttpRouter.toWebHandler(
    HttpApiBuilder.layer(TestApi).pipe(
      Layer.provide(Layer.mergeAll(StaffOnlyLive, AuthHttpLive)),
      Layer.provide(IdentityLive),
      Layer.provide(RequestValidationLive),
      Layer.provide(SeededIdentity),
      Layer.provideMerge(Layer.mergeAll(TestSql(), TestAuthConfig)),
      Layer.provide(HttpServer.layerServices),
    ),
    { disableLogger: true },
  )
  afterAll(() => web.dispose())

  const app = {
    request: (method: string, path: string, init: { body?: unknown; token?: string } = {}) =>
      web.handler(
        new Request(`http://localhost/v1${path}`, {
          method,
          headers: {
            ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
            ...(init.token === undefined ? {} : { authorization: `Bearer ${init.token}` }),
          },
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        }),
      ),
  }

  it('권한이 있으면 핸들러에 CurrentAccess를 넣는다', async () => {
    const { accessToken } = await signIn(app, 'manager', Date.now())
    const response = await app.request('GET', '/staff-only', { token: accessToken })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ role: 'MANAGER' })
  })

  it('권한이 모자라면 403 PERMISSION_DENIED, 토큰이 없으면 401 UNAUTHENTICATED', async () => {
    const { accessToken } = await signIn(app, 'desk', Date.now())
    const denied = await app.request('GET', '/staff-only', { token: accessToken })
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ code: 'PERMISSION_DENIED' })

    const anonymous = await app.request('GET', '/staff-only')
    expect(anonymous.status).toBe(401)
    expect(await anonymous.json()).toMatchObject({ code: 'UNAUTHENTICATED' })
  })
})
