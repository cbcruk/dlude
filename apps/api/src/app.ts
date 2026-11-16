import { Layer } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from './api.ts'
import { HealthHttpLive } from './health.http.ts'

/**
 * API 전체 경로. 런타임(DO의 SQLite, Node 테스트의 인메모리 SQLite)과 HTTP 플랫폼은 호출하는 쪽이 넣는다.
 */
export const AppLive = HttpApiBuilder.layer(Api).pipe(Layer.provide(HealthHttpLive))
