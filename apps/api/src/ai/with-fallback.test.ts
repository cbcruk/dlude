import { Effect, Fiber, Logger, Schema } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'
import { fakeEmbedding, fakeLlm } from './adapters/fake.ts'
import { AI_APOLOGY } from './errors.ts'
import type { ChatRequest } from './ports.ts'
import { withFallback } from './with-fallback.ts'

const request: ChatRequest = { messages: [{ role: 'user', content: '안녕' }], subjects: [] }

/** 경고 로그를 모으고 TestClock 아래에서 돌린다. */
function run<A, E>(effect: Effect.Effect<A, E>) {
  const logs: unknown[] = []
  const logger = Logger.make((options) => {
    logs.push(options.message)
  })
  return Effect.runPromise(
    effect.pipe(Effect.result, Effect.provide([Logger.layer([logger]), TestClock.layer()])),
  ).then((result) => ({ result, logs }))
}

describe('withFallback', () => {
  it('앞이 성공하면 뒤는 부르지 않는다', async () => {
    const a = fakeLlm({ id: 'a', reply: 'from a' })
    const b = fakeLlm({ id: 'b', reply: 'from b' })
    const { result, logs } = await run(withFallback([a, b], { timeout: '5 seconds' }).chat(request))
    expect(result).toMatchObject({ _tag: 'Success', success: { content: 'from a', providerId: 'a' } })
    expect(b.calls).toHaveLength(0)
    expect(logs).toEqual([])
  })

  it('앞이 실패하면 다음으로 넘어가고 사유를 로그에 남긴다', async () => {
    const a = fakeLlm({ id: 'a', reply: '', fail: 'UNAVAILABLE' })
    const b = fakeLlm({ id: 'b', reply: 'from b' })
    const { result, logs } = await run(withFallback([a, b], { timeout: '5 seconds' }).chat(request))
    expect(result).toMatchObject({ _tag: 'Success', success: { content: 'from b', providerId: 'b' } })
    expect(logs).toEqual([['ai provider failed', { provider: 'a', reason: 'UNAVAILABLE', next: 'b' }]])
  })

  it('시간을 넘긴 공급자는 TIMEOUT으로 보고 다음으로 넘어간다', async () => {
    const slow = fakeLlm({ id: 'slow', reply: 'late', delay: '1 minute' })
    const fast = fakeLlm({ id: 'fast', reply: 'from fast' })
    const chain = withFallback([slow, fast], { timeout: '5 seconds' })
    const { result, logs } = await run(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(chain.chat(request))
        yield* TestClock.adjust('5 seconds')
        return yield* Fiber.join(fiber)
      }),
    )
    expect(result).toMatchObject({ _tag: 'Success', success: { providerId: 'fast' } })
    expect(logs).toEqual([['ai provider failed', { provider: 'slow', reason: 'TIMEOUT', next: 'fast' }]])
  })

  it('모두 실패하면 사과 문구를 담은 AiUnavailable', async () => {
    const chain = withFallback(
      [
        fakeLlm({ id: 'a', reply: '', fail: 'UNAVAILABLE' }),
        fakeLlm({ id: 'b', reply: '', fail: 'RATE_LIMITED' }),
        fakeLlm({ id: 'c', reply: 'not json' }),
      ],
      { timeout: '5 seconds' },
    )
    const { result, logs } = await run(chain.structured(request, Schema.Struct({ ok: Schema.Boolean })))
    expect(result).toMatchObject({
      _tag: 'Failure',
      failure: {
        _tag: 'AiUnavailable',
        message: AI_APOLOGY,
        attempts: [
          { providerId: 'a', reason: 'UNAVAILABLE' },
          { providerId: 'b', reason: 'RATE_LIMITED' },
          { providerId: 'c', reason: 'SCHEMA_MISMATCH' },
        ],
      },
    })
    expect(logs).toHaveLength(3)
  })

  it('하나라도 CLOUD면 체인도 CLOUD. 임베딩도 같은 규칙', async () => {
    const chain = withFallback(
      [fakeEmbedding({ id: 'e1', fail: 'UNAVAILABLE' }), fakeEmbedding({ id: 'e2', locality: 'CLOUD' })],
      { timeout: '1 second' },
    )
    expect(chain.locality).toBe('CLOUD')
    expect(chain.id).toBe('fallback(e1,e2)')
    const { result } = await run(chain.embed({ texts: ['a', 'b'], subjects: [] }))
    expect(result).toMatchObject({ _tag: 'Success' })
  })
})
