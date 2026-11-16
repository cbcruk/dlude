import { Clock, Effect, Layer } from 'effect'

/** 앞으로 감을 수 있는 시계. 실제 시각에 `advance`한 만큼 더한다. 잠자기(`sleep`)는 실제 시계를 쓴다. */
export function adjustableClock() {
  const base = Clock.Clock.defaultValue()
  let offset = 0
  const millis = () => base.currentTimeMillisUnsafe() + offset
  const nanos = () => base.currentTimeNanosUnsafe() + BigInt(offset) * 1_000_000n
  const clock: Clock.Clock = {
    currentTimeMillisUnsafe: millis,
    currentTimeMillis: Effect.sync(millis),
    currentTimeNanosUnsafe: nanos,
    currentTimeNanos: Effect.sync(nanos),
    monotonicTimeNanosUnsafe: () => base.monotonicTimeNanosUnsafe(),
    monotonicTimeNanos: base.monotonicTimeNanos,
    sleep: (duration) => base.sleep(duration),
  }
  return {
    layer: Layer.succeed(Clock.Clock, clock),
    now: millis,
    advance: (ms: number) => {
      offset += ms
    },
  }
}
