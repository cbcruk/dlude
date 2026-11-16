// hemr@0c4b7e8 src/app.ts를 바탕으로 함
import { Cause, Effect, Layer } from 'effect'
import { HttpRouter, HttpServerError, HttpServerRespondable } from 'effect/http'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from './api.ts'
import { HealthHttpLive } from './health.http.ts'
import { ChartSystem } from './modules/chart/chart.public.ts'
import { PatientsHttpLive } from './modules/chart/patients.http.ts'
import { IdentityRepository } from './modules/identity/identity-repository.ts'
import { Auth } from './modules/identity/auth/auth.ts'
import { AuthHttpLive, MeHttpLive } from './modules/identity/auth/auth.http.ts'
import { AuthenticationLive } from './modules/identity/auth/authentication.ts'
import { AuthorizationLive, accessCheck } from './modules/identity/auth/authorization.ts'
import { SecurityLog } from './modules/identity/auth/security-log.ts'
import { NotFound } from './shared/problem/problem.ts'
import { RequestValidationLive } from './shared/problem/request-validation.ts'
import { respondUnexpected } from './shared/problem/unexpected-error.ts'

/**
 * 일치하는 경로가 없거나 예상하지 못한 오류(defect)가 나면 Problem Details로 응답한다. 예상 밖 오류는 원인을 로그에만
 * 남기고 본문에는 싣지 않는다(P5).
 */
const ProblemFallback = HttpRouter.middleware(
  (httpEffect) =>
    httpEffect.pipe(
      Effect.catchIf(isRouteNotFound, () => HttpServerRespondable.toResponse(new NotFound({}))),
      Effect.catchCauseIf(Cause.hasDies, respondUnexpected),
    ),
  { global: true },
)

function isRouteNotFound(error: unknown): boolean {
  return error instanceof HttpServerError.HttpServerError && error.reason._tag === 'RouteNotFound'
}

/** 인증·권한 미들웨어와 그 아래 서비스. */
export const IdentityLive = Layer.mergeAll(AuthenticationLive, AuthorizationLive).pipe(
  Layer.provideMerge(Auth.layer),
  Layer.provideMerge(Layer.mergeAll(IdentityRepository.layer, SecurityLog.layer)),
)

/**
 * API 전체 경로. 저장 서비스(`persistence.ts`)와 인증 설정(`AuthConfig`)은 호출하는 쪽이 넣는다:
 * DO는 DO SQLite와 Worker env, 테스트는 인메모리 SQLite와 테스트 설정.
 */
export const AppLive = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(HealthHttpLive),
  Layer.provide(Layer.mergeAll(AuthHttpLive, MeHttpLive)),
  Layer.provide(PatientsHttpLive.pipe(Layer.provide(ChartSystem.internal))),
  Layer.provide(IdentityLive),
  Layer.provide(RequestValidationLive),
  Layer.provide(accessCheck(Api)),
  Layer.merge(ProblemFallback),
)
