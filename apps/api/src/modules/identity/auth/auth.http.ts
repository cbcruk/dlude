// hemr@0c4b7e8 src/modules/identity/auth/auth.http.ts를 바탕으로 함
import { Effect } from 'effect'
import { HttpEffect, HttpServerRequest, HttpServerResponse } from 'effect/http'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { CurrentSession } from './access.ts'
import { Auth } from './auth.ts'
import { SESSION_TTL_MILLIS } from '../session.aggregate.ts'

/** refresh token 쿠키 (identity-access.md). 인증 경로에만 보낸다. */
export const REFRESH_COOKIE = 'dlude_refresh'
const COOKIE_PATH = '/v1/auth'

/** 응답에 refresh 쿠키를 넣는다(`token`이 `null`이면 지운다). 실패 응답에도 붙는다. */
const setRefreshCookie = (token: string | null) =>
  HttpEffect.appendPreResponseHandler((_request, response) => {
    const options = { httpOnly: true, secure: true, sameSite: 'strict', path: COOKIE_PATH } as const
    return token === null
      ? Effect.succeed(HttpServerResponse.expireCookieUnsafe(response, REFRESH_COOKIE, options))
      : Effect.orDie(
          HttpServerResponse.setCookie(response, REFRESH_COOKIE, token, {
            ...options,
            maxAge: `${SESSION_TTL_MILLIS / 1000} seconds`,
          }),
        )
  })

const bearerToken = Effect.map(HttpServerRequest.HttpServerRequest, (request) => {
  const match = /^bearer +(\S+)$/i.exec(request.headers['authorization'] ?? '')
  return match?.[1]
})

const refreshCookie = Effect.map(HttpServerRequest.HttpServerRequest, (request) => request.cookies[REFRESH_COOKIE])

export const AuthHttpLive = HttpApiBuilder.group(
  Api,
  'auth',
  Effect.fn(function* (handlers) {
    const auth = yield* Auth
    return handlers.handleAll({
      login: ({ payload }) => auth.login(payload),
      verifyTotp: ({ payload }) =>
        Effect.gen(function* () {
          const { refreshToken, ...body } = yield* auth.verifyTotp(payload)
          yield* setRefreshCookie(refreshToken)
          return body
        }),
      refresh: () =>
        Effect.gen(function* () {
          const result = yield* auth
            .refresh({ refreshToken: yield* refreshCookie })
            .pipe(Effect.tapError(() => setRefreshCookie(null)))
          if (result.refreshToken !== null) yield* setRefreshCookie(result.refreshToken)
          return { accessToken: result.accessToken, expiresIn: result.expiresIn }
        }),
      logout: () =>
        Effect.gen(function* () {
          yield* auth.logout({ refreshToken: yield* refreshCookie, accessToken: yield* bearerToken })
          yield* setRefreshCookie(null)
        }),
    })
  }),
)

export const MeHttpLive = HttpApiBuilder.group(
  Api,
  'me',
  Effect.fn(function* (handlers) {
    const auth = yield* Auth
    return handlers.handleAll({
      me: () => Effect.flatMap(CurrentSession, auth.me),
      disableTotp: ({ payload }) =>
        Effect.flatMap(CurrentSession, (session) => auth.disableTotp(session, payload.code)),
    })
  }),
)
