import * as Cloudflare from '@alchemy.run/cloudflare'
import * as SqliteClient from '@effect/sql-sqlite-do/SqliteClient'
import { Effect, Layer, Scope } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { AppLive } from './app.ts'

/**
 * 병원 하나 = Durable Object 하나 (architecture.md 3.2). 이 안에서 모든 API를 처리한다(F4).
 *
 * 생성자(안쪽 Effect)는 인스턴스마다 한 번, `blockConcurrencyWhile` 아래에서 돈다. 그래서 HTTP 처리기와
 * 마이그레이션은 여기서 한 번만 만들고, 요청은 만들어 둔 처리기를 쓴다.
 */
export default class ClinicDO extends Cloudflare.DurableObject<ClinicDO>()(
  'ClinicDO',
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState
    return Effect.gen(function* () {
      const SqlLive = SqliteClient.layer({ storage: state.raw.storage })
      // 인스턴스 수명 동안 열려 있는 스코프. 요청마다 레이어를 다시 만들지 않으려고 둔다
      const scope = yield* Scope.make()
      const handler = yield* HttpRouter.toHttpEffect(
        AppLive.pipe(Layer.provide(SqlLive), Layer.provide(HttpServer.layerServices)),
      ).pipe(Scope.provide(scope), Effect.orDie)
      return { fetch: handler }
    })
  }),
) {}
