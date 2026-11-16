import { Data, Effect, Ref } from 'effect'
import { describe, expect, it } from 'vitest'
import { TestSql } from '../../testing/sql.ts'
import { domainEvent } from './domain-event.ts'
import type { RecordedEvent } from './domain-event.ts'
import { Outbox } from './outbox.ts'
import { drainPolicies, hasPendingEvents, PolicyCursor, runPolicyOnce } from './policy.ts'
import type { Policy } from './policy.ts'

class Refused extends Data.TaggedError('Refused')<{}> {}

const happened = (subjects: ReadonlyArray<string>) =>
  subjects.map((subject, index) => domainEvent('test.happened', subject, `2026-11-05T00:00:0${index}.000Z`, { index }))

/** 받은 이벤트의 `subject`를 모으는 정책. `refuse`는 거부하고 `crash`는 결함을 낸다. */
const collecting = (name: string, seen: Ref.Ref<ReadonlyArray<string>>): Policy<Refused, never> => ({
  name,
  handle: (event: RecordedEvent) =>
    Effect.gen(function* () {
      if (event.subject === 'refuse') return yield* new Refused()
      if (event.subject === 'crash') return yield* Effect.die('boom')
      yield* Ref.update(seen, (all) => [...all, event.subject])
    }),
})

const run = <A, E, R>(program: Effect.Effect<A, E, R>) =>
  Effect.runPromise(program.pipe(Effect.provide(TestSql())) as Effect.Effect<A, E, never>)

describe('runPolicyOnce', () => {
  it('커서 다음 이벤트부터 seq 순서로 한 번씩 처리한다', async () => {
    const result = await run(
      Effect.gen(function* () {
        const seen = yield* Ref.make<ReadonlyArray<string>>([])
        const policy = collecting('test-policy', seen)
        yield* (yield* Outbox).append(happened(['a', 'b']))
        const first = yield* runPolicyOnce(policy)
        yield* (yield* Outbox).append(happened(['c']))
        const second = yield* runPolicyOnce(policy)
        const third = yield* runPolicyOnce(policy)
        return {
          first,
          second,
          third,
          seen: yield* Ref.get(seen),
          cursor: yield* (yield* PolicyCursor).get('test-policy'),
        }
      }),
    )
    expect(result).toEqual({
      first: { handled: 2, stalled: false },
      second: { handled: 1, stalled: false },
      third: { handled: 0, stalled: false },
      seen: ['a', 'b', 'c'],
      cursor: 3,
    })
  })

  it('받는 쪽이 거부하면 정책의 쓰기는 되돌리고 커서는 올린다', async () => {
    const result = await run(
      Effect.gen(function* () {
        const outbox = yield* Outbox
        yield* outbox.append(happened(['refuse']))
        const writesThenRefuses: Policy<Refused, never> = {
          name: 'test-policy',
          handle: (event) =>
            event.type === 'test.happened'
              ? outbox
                  .append([domainEvent('test.reacted', event.subject, event.time, {})])
                  .pipe(Effect.andThen(Effect.fail(new Refused())))
              : Effect.void,
        }
        const handled = yield* runPolicyOnce(writesThenRefuses)
        return {
          handled,
          types: (yield* outbox.after(0, 10)).map((event) => event.type),
          cursor: yield* (yield* PolicyCursor).get('test-policy'),
        }
      }),
    )
    expect(result).toEqual({ handled: { handled: 1, stalled: false }, types: ['test.happened'], cursor: 1 })
  })

  it('결함이 나면 그 이벤트의 쓰기와 커서를 되돌리고 멈춘다', async () => {
    const result = await run(
      Effect.gen(function* () {
        const outbox = yield* Outbox
        yield* outbox.append(happened(['crash']))
        const writesThenCrashes: Policy<never, never> = {
          name: 'test-policy',
          handle: (event) =>
            event.type === 'test.happened'
              ? outbox
                  .append([domainEvent('test.reacted', event.subject, event.time, {})])
                  .pipe(Effect.andThen(Effect.die('boom')))
              : Effect.void,
        }
        const run = yield* runPolicyOnce(writesThenCrashes)
        return {
          run,
          types: (yield* outbox.after(0, 10)).map((event) => event.type),
          cursor: yield* (yield* PolicyCursor).get('test-policy'),
        }
      }),
    )
    expect(result).toEqual({ run: { handled: 0, stalled: true }, types: ['test.happened'], cursor: 0 })
  })
})

describe('drainPolicies (DO alarm 한 번)', () => {
  it('밀린 이벤트를 배치 크기와 상관없이 모두 처리하고 idle을 돌려준다', async () => {
    const result = await run(
      Effect.gen(function* () {
        const seen = yield* Ref.make<ReadonlyArray<string>>([])
        yield* (yield* Outbox).append(happened(['a', 'b', 'c', 'd', 'e']))
        const next = yield* drainPolicies([collecting('test-policy', seen)], 2)
        return { next, seen: yield* Ref.get(seen) }
      }),
    )
    expect(result).toEqual({ next: 'idle', seen: ['a', 'b', 'c', 'd', 'e'] })
  })

  it('결함이 난 정책은 그 이벤트에서 멈추고 retry를 돌려주며, 다른 정책은 계속한다', async () => {
    const result = await run(
      Effect.gen(function* () {
        const first = yield* Ref.make<ReadonlyArray<string>>([])
        const second = yield* Ref.make<ReadonlyArray<string>>([])
        yield* (yield* Outbox).append(happened(['a', 'crash', 'b']))
        const stuck = collecting('stuck', first)
        const fine: Policy<never, never> = {
          name: 'fine',
          handle: (event) => Ref.update(second, (all) => [...all, event.subject]),
        }
        const next = yield* drainPolicies([stuck, fine])
        // 다음 alarm에 다시 시도해도 같은 이벤트에서 멈춘다(커서가 그대로)
        const again = yield* drainPolicies([stuck])
        return {
          next,
          again,
          stuck: yield* Ref.get(first),
          fine: yield* Ref.get(second),
          cursor: yield* (yield* PolicyCursor).get('stuck'),
        }
      }),
    )
    expect(result).toEqual({
      next: 'retry',
      again: 'retry',
      stuck: ['a'],
      fine: ['a', 'crash', 'b'],
      cursor: 1,
    })
  })
})

describe('hasPendingEvents (요청 뒤 alarm을 걸지)', () => {
  it('정책이 아직 읽지 않은 이벤트가 있을 때만 true다', async () => {
    const result = await run(
      Effect.gen(function* () {
        const seen = yield* Ref.make<ReadonlyArray<string>>([])
        const policy = collecting('test-policy', seen)
        const empty = yield* hasPendingEvents([policy])
        yield* (yield* Outbox).append(happened(['a']))
        const pending = yield* hasPendingEvents([policy])
        yield* drainPolicies([policy])
        const drained = yield* hasPendingEvents([policy])
        const noPolicies = yield* hasPendingEvents([])
        return { empty, pending, drained, noPolicies }
      }),
    )
    expect(result).toEqual({ empty: false, pending: true, drained: false, noPolicies: false })
  })
})
