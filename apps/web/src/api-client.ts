import { Effect, Exit } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http'
import { HttpApiClient } from 'effect/http-api'
import { Api } from '../../api/src/api.ts'
import type { ApiResult } from './auth/session.ts'

/** 실패 값에서 서버 오류 코드를 꺼낸다. 서버 Problem은 `code`를 갖고, 그 밖은 네트워크·해석 오류다. */
function codeOf(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    if ('code' in error && typeof error.code === 'string') return error.code
    // 연결 자체가 안 된 것만 NETWORK. 알 수 없는 상태 코드·해석 실패는 UNEXPECTED
    if ('reason' in error && typeof error.reason === 'object' && error.reason !== null) {
      if ('_tag' in error.reason && error.reason._tag === 'TransportError') return 'NETWORK'
    }
  }
  return 'UNEXPECTED'
}

/**
 * `api.ts`(서버의 HTTP 계약)를 그대로 쓰는 클라이언트. 요청 형태와 응답 해석을 서버와 같은 Schema로 한다.
 * `token()`이 주는 access token을 `Authorization: Bearer`로 붙인다. refresh 쿠키는 같은 출처라 브라우저가 붙인다.
 */
export function createApi(token: () => string | null) {
  const client = HttpApiClient.make(Api, {
    baseUrl: globalThis.location?.origin,
    transformClient: HttpClient.mapRequest((request) => {
      // 서버 라우터는 커맨드 경로의 콜론을 `::`로 적는다(`/sessions::verify-totp`). 실제 경로는 `:` 하나다
      const routed = HttpClientRequest.setUrl(request, request.url.replaceAll('::', ':'))
      const current = token()
      return current === null ? routed : HttpClientRequest.bearerToken(routed, current)
    }),
  }).pipe(Effect.provide(FetchHttpClient.layer))

  const run = async <A, E>(
    call: (api: Effect.Success<typeof client>) => Effect.Effect<A, E>,
  ): Promise<ApiResult<A>> => {
    const exit = await Effect.runPromiseExit(Effect.flatMap(client, call))
    if (Exit.isSuccess(exit)) return { ok: true, value: exit.value }
    const failure = exit.cause.reasons.find((reason) => reason._tag === 'Fail')
    return { ok: false, code: failure === undefined ? 'UNEXPECTED' : codeOf(failure.error) }
  }

  return {
    login: (payload: { loginId: string; password: string }) => run((api) => api.auth.login({ payload })),
    verifyTotp: (payload: { challengeToken: string; code: string }) => run((api) => api.auth.verifyTotp({ payload })),
    refresh: () => run((api) => api.auth.refresh()),
    logout: () => run((api) => api.auth.logout()),
    me: () => run((api) => api.me.me()),
    listPatients: (query: { q?: string; cursor?: string }) =>
      run((api) => api.patients.list({ query: { ...query, limit: 50 } })),
  }
}

export type DludeApi = ReturnType<typeof createApi>
