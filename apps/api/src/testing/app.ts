import { Effect, Layer, ManagedRuntime } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import type { SqlClient } from 'effect/sql'
import { AppLive } from '../app.ts'
import { AuthConfig, TestAuthConfig } from '../modules/identity/auth/auth-config.ts'
import type { Transaction } from '../shared/db/transaction.ts'
import { TestSql } from './sql.ts'

export interface TestRequest {
  body?: unknown
  token?: string
  cookie?: string
}

type Dependencies = SqlClient.SqlClient | Transaction | AuthConfig

/**
 * 인메모리 SQLite 위의 앱 전체. 부를 때마다 새 DB다. 돌려준 `dispose`를 테스트 끝에 부른다.
 *
 * - `setup`: 같은 DB에 먼저 돌릴 레이어(시드 등)
 * - `clock`: 시계를 바꿀 때(`testing/clock.ts`)
 * - `run`: 같은 DB에서 Effect를 돌린다. 저장된 행을 직접 볼 때
 */
export function testApp(
  setup: Layer.Layer<never, never, Dependencies> = Layer.empty,
  clock: Layer.Layer<never> = Layer.empty,
) {
  const runtime = ManagedRuntime.make(
    setup.pipe(Layer.provideMerge(Layer.mergeAll(TestSql(), TestAuthConfig)), Layer.provideMerge(clock)),
  )
  const web = HttpRouter.toWebHandler(
    AppLive.pipe(
      Layer.provide(Layer.effectContext(runtime.contextEffect)),
      Layer.provide(HttpServer.layerServices),
      Layer.provideMerge(clock),
    ),
    { disableLogger: true },
  )
  const request = (method: string, path: string, init: TestRequest = {}) => {
    const headers: Record<string, string> = {}
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    if (init.token !== undefined) headers['authorization'] = `Bearer ${init.token}`
    if (init.cookie !== undefined) headers['cookie'] = init.cookie
    const options: RequestInit = { method, headers }
    if (init.body !== undefined) options.body = JSON.stringify(init.body)
    return web.handler(new Request(`http://localhost/v1${path}`, options))
  }
  const run = <A>(effect: Effect.Effect<A, never, Dependencies>) => runtime.runPromise(effect)
  const dispose = async () => {
    await web.dispose()
    await runtime.dispose()
  }
  return { request, run, dispose }
}
