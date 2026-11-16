// from hemr@0c4b7e8 src/shared/events/policy.ts — 메모리 커서(F2)와 1초 폴링 워커를 빼고, DO alarm이 부르는
// `drainPolicies`·`hasPendingEvents`로 바꿈(conventions.md "outbox 릴레이·정책")
import { Context, DateTime, Effect, Exit, Layer } from 'effect'
import { SqlClient } from 'effect/sql'
import { Transaction } from '../db/transaction.ts'
import type { RecordedEvent } from './domain-event.ts'
import { Outbox } from './outbox.ts'

/**
 * 정책. 다른 컨텍스트의 이벤트를 받아 할지 말지 정하고 자기 쪽 커맨드를 보낸다. 이미 일어난 일을 거부하지 않는다.
 *
 * `handle`은 모든 이벤트를 받는다. 관심 없는 이벤트는 아무것도 하지 않고 성공한다. 실패(`E`)는 받는 쪽 커맨드의
 * 거부이고, 실행기가 기록만 하고 다음 이벤트로 넘어간다. 결함은 그 이벤트에서 멈추고 다음 alarm에 다시 시도한다.
 */
export interface Policy<E extends { readonly _tag: string }, R> {
  /** 커서의 키. 바꾸면 처음부터 다시 처리하므로 한 번 정하면 바꾸지 않는다. */
  readonly name: string
  readonly handle: (event: RecordedEvent) => Effect.Effect<void, E, R>
}

export type AnyPolicy<R = any> = Policy<{ readonly _tag: string }, R>

/** 정책마다 마지막으로 처리한 outbox `seq`. 처음이면 0. */
export class PolicyCursor extends Context.Service<
  PolicyCursor,
  {
    get(policy: string): Effect.Effect<number>
    /** 호출한 쪽의 트랜잭션에 함께 들어간다. */
    advance(policy: string, seq: number, at: string): Effect.Effect<void>
  }
>()('dlude/shared/PolicyCursor') {
  static readonly layer = Layer.effect(
    PolicyCursor,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return PolicyCursor.of({
        get: (policy) =>
          sql<{ lastSeq: number }>`SELECT last_seq AS lastSeq FROM policy_cursors WHERE policy = ${policy}`.pipe(
            Effect.map((rows) => rows[0]?.lastSeq ?? 0),
            Effect.orDie,
          ),
        advance: (policy, seq, at) =>
          sql`
            INSERT INTO policy_cursors (policy, last_seq, updated_at) VALUES (${policy}, ${seq}, ${at})
            ON CONFLICT (policy) DO UPDATE SET last_seq = excluded.last_seq, updated_at = excluded.updated_at
          `.pipe(Effect.asVoid, Effect.orDie),
      })
    }),
  )
}

/** 한 회차에 읽는 이벤트 수. */
export const POLICY_BATCH_SIZE = 100

/** 정책 한 회차의 결과. `stalled`면 결함으로 멈춘 것이다. */
export interface PolicyRun {
  handled: number
  stalled: boolean
}

/**
 * 정책 하나를 한 회차 돌린다. 커서 다음 이벤트부터 `seq` 순서로 처리한다.
 *
 * 이벤트마다 정책의 쓰기와 커서 올리기를 한 트랜잭션에서 한다. 거부되면 정책의 쓰기는 되돌리고 커서는 올린다. 그래서
 * 같은 이벤트를 두 번 처리하지 않는다. 결함이 나면 그 이벤트의 쓰기를 되돌리고 회차를 멈춘다. 뒤 이벤트를 먼저
 * 처리하면 같은 리소스의 순서가 뒤바뀌기 때문이다.
 */
export const runPolicyOnce = <E extends { readonly _tag: string }, R>(
  policy: Policy<E, R>,
  batchSize: number = POLICY_BATCH_SIZE,
) =>
  Effect.gen(function* () {
    const outbox = yield* Outbox
    const cursor = yield* PolicyCursor
    const transaction = yield* Transaction
    const events = yield* outbox.after(yield* cursor.get(policy.name), batchSize)
    let handled = 0
    for (const event of events) {
      const at = DateTime.formatIso(yield* DateTime.now)
      const exit = yield* Effect.exit(
        transaction.run(
          Effect.gen(function* () {
            // 정책의 처리는 안쪽 트랜잭션이라, 거부되면 거부 전에 쓴 것을 되돌리고 커서만 올린다
            yield* transaction.run(policy.handle(event)).pipe(
              Effect.catch((rejection) =>
                Effect.logWarning('policy rejected', {
                  policy: policy.name,
                  seq: event.seq,
                  type: event.type,
                  subject: event.subject,
                  rejection: rejection._tag,
                }),
              ),
            )
            yield* cursor.advance(policy.name, event.seq, at)
          }),
        ),
      )
      if (Exit.isFailure(exit)) {
        yield* Effect.logError('policy failed', { policy: policy.name, seq: event.seq, type: event.type }, exit.cause)
        return { handled, stalled: true } satisfies PolicyRun
      }
      handled++
    }
    return { handled, stalled: false } satisfies PolicyRun
  }).pipe(Effect.withSpan('Policy.runOnce', { attributes: { policy: policy.name } }))

/**
 * DO alarm 한 번에 할 일. 정책마다 밀린 이벤트가 없을 때까지 돌린다. 한 정책이 결함으로 멈춰도 다른 정책은 계속한다.
 *
 * `'retry'`면 결함으로 멈춘 정책이 있으니 잠시 뒤 alarm을 다시 건다. `'idle'`이면 할 일이 없다.
 */
export const drainPolicies = <R>(policies: ReadonlyArray<AnyPolicy<R>>, batchSize: number = POLICY_BATCH_SIZE) =>
  Effect.gen(function* () {
    let stalled = false
    for (const policy of policies) {
      let run: PolicyRun
      do {
        run = yield* runPolicyOnce(policy, batchSize)
      } while (!run.stalled && run.handled === batchSize)
      stalled ||= run.stalled
    }
    return stalled ? ('retry' as const) : ('idle' as const)
  })

/** 커서보다 뒤 이벤트가 남은 정책이 있는지. 요청을 처리한 뒤 alarm을 걸지 정할 때 쓴다. */
export const hasPendingEvents = (policies: ReadonlyArray<AnyPolicy>) =>
  Effect.gen(function* () {
    const outbox = yield* Outbox
    const cursor = yield* PolicyCursor
    for (const policy of policies) {
      if ((yield* outbox.after(yield* cursor.get(policy.name), 1)).length > 0) return true
    }
    return false
  })
