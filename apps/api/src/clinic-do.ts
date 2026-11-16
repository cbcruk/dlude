import * as Cloudflare from '@alchemy.run/cloudflare'
import * as SqliteClient from '@effect/sql-sqlite-do/SqliteClient'
import { Effect, Layer, Scope } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { AppLive } from './app.ts'
import { migrate, PersistenceLive } from './persistence.ts'
import { drainPolicies, hasPendingEvents } from './shared/events/policy.ts'
import { policies } from './wiring/policies.ts'

/** 정책이 결함으로 멈췄을 때 다음 alarm까지 기다리는 시간. */
const POLICY_RETRY_DELAY_MILLIS = 10_000

/**
 * 병원 하나 = Durable Object 하나 (architecture.md 3.2). 이 안에서 모든 API를 처리한다(F4).
 *
 * 생성자(안쪽 Effect)는 인스턴스마다 한 번, `blockConcurrencyWhile` 아래에서 돈다. 그래서 마이그레이션, 저장 서비스,
 * HTTP 처리기를 여기서 한 번만 만들고, 첫 요청은 마이그레이션이 끝난 뒤에 받는다(spike.md 작업 2).
 *
 * 정책은 상주 루프 대신 alarm으로 돈다(conventions.md). 요청을 처리한 뒤 정책이 읽지 않은 이벤트가 있으면 alarm을
 * 바로 걸고, alarm은 밀린 이벤트를 모두 처리한다. 결함으로 멈춘 정책이 있으면 잠시 뒤 다시 건다.
 */
export default class ClinicDO extends Cloudflare.DurableObject<ClinicDO>()(
  'ClinicDO',
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState
    return Effect.gen(function* () {
      // 인스턴스 수명 동안 열려 있는 스코프. 요청마다 레이어를 다시 만들지 않으려고 둔다
      const scope = yield* Scope.make()
      const persistence = yield* Layer.build(
        PersistenceLive.pipe(
          Layer.provideMerge(Layer.effectDiscard(migrate)),
          Layer.provideMerge(SqliteClient.layer({ storage: state.raw.storage })),
        ),
      ).pipe(Scope.provide(scope), Effect.orDie)

      const handler = yield* HttpRouter.toHttpEffect(
        AppLive.pipe(Layer.provide(Layer.succeedContext(persistence)), Layer.provide(HttpServer.layerServices)),
      ).pipe(Scope.provide(scope), Effect.orDie)

      const setAlarm = (delayMillis: number) =>
        Effect.promise(() => state.raw.storage.setAlarm(Date.now() + delayMillis))

      const wakeIfPending = hasPendingEvents(policies).pipe(
        Effect.flatMap((pending) => (pending ? setAlarm(0) : Effect.void)),
        Effect.provide(persistence),
        Effect.catchCause((cause) => Effect.logError('policy wake failed', cause)),
      )

      return {
        fetch: handler.pipe(Effect.ensuring(wakeIfPending)),
        alarm: () =>
          drainPolicies(policies).pipe(
            Effect.flatMap((next) => (next === 'retry' ? setAlarm(POLICY_RETRY_DELAY_MILLIS) : Effect.void)),
            Effect.provide(persistence),
            Effect.catchCause((cause) => Effect.logError('policy alarm failed', cause)),
          ),
      }
    })
  }),
) {}
