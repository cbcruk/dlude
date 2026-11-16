import { Effect, Ref, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { TestSql } from '../../testing/sql.ts'
import { idempotent, requestFingerprint } from './idempotency.ts'

const Result = Schema.Struct({ n: Schema.Int })

describe('idempotent', () => {
  it('하루 안에는 처음 응답을 다시 주고, 다른 요청은 거부하고, 하루가 지나면 새로 실행한다', async () => {
    const times = ['2026-11-06T00:00:00.000Z', '2026-11-06T23:59:59.000Z', '2026-11-07T00:00:00.000Z']
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const calls = yield* Ref.make(0)
        const call = (request: unknown, at: string) =>
          idempotent(
            { key: 'k', operation: 'test', request, now: at, schema: Result },
            Ref.updateAndGet(calls, (n) => n + 1).pipe(Effect.map((n) => ({ n }))),
          )
        const first = yield* call({ a: 1 }, times[0]!)
        const replay = yield* call({ a: 1 }, times[1]!)
        const reused = yield* Effect.flip(call({ a: 2 }, times[1]!))
        const late = yield* call({ a: 2 }, times[2]!)
        return { first, replay, reused: reused._tag, late, calls: yield* Ref.get(calls) }
      }).pipe(Effect.provide(TestSql())),
    )
    expect(result).toEqual({
      first: { n: 1 },
      replay: { n: 1 },
      reused: 'IdempotencyKeyReused',
      late: { n: 2 },
      calls: 2,
    })
  })

  it('실패한 요청은 남기지 않아 같은 키로 다시 보낼 수 있다', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const input = { key: 'k', operation: 'test', request: {}, now: '2026-11-06T00:00:00.000Z', schema: Result }
        yield* Effect.flip(idempotent(input, Effect.fail('boom' as const)))
        return yield* idempotent(input, Effect.succeed({ n: 7 }))
      }).pipe(Effect.provide(TestSql())),
    )
    expect(result).toEqual({ n: 7 })
  })
})

describe('requestFingerprint', () => {
  it('SHA-256 16진 문자열이고 같은 요청이면 같다', async () => {
    const [a, b, c] = await Effect.runPromise(
      Effect.all([requestFingerprint({ x: 1 }), requestFingerprint({ x: 1 }), requestFingerprint({ x: 2 })]),
    )
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})
