import { Duration, Effect } from 'effect'
import { AI_APOLOGY, AiUnavailable, ProviderFailed } from './errors.ts'
import type { AiError } from './errors.ts'
import type { AiProvider, EmbeddingProvider, LlmProvider, SttProvider } from './ports.ts'

export interface FallbackOptions {
  /** 공급자 하나에 주는 시간. 넘으면 그 공급자는 `TIMEOUT`으로 보고 다음으로 넘어간다. */
  timeout: Duration.Input
}

/** 실패 사유를 로그용 짧은 문자열로. 본문은 넣지 않는다(P7). */
function reasonOf(error: AiError): string {
  switch (error._tag) {
    case 'ProviderFailed':
      return error.reason
    case 'SchemaMismatch':
      return 'SCHEMA_MISMATCH'
    case 'PhiPolicyViolation':
      return error.code
    case 'AiUnavailable':
      return 'ALL_FAILED'
  }
}

/** 공급자를 앞에서부터 불러 처음 성공한 결과를 준다. 모두 실패하면 `AiUnavailable`. */
function firstSuccess<P extends AiProvider, A, R>(
  providers: ReadonlyArray<P>,
  options: FallbackOptions,
  call: (provider: P) => Effect.Effect<A, AiError, R>,
): Effect.Effect<A, AiUnavailable, R> {
  const attempts: Array<{ providerId: string; reason: string }> = []
  const tryFrom = (index: number): Effect.Effect<A, AiUnavailable, R> => {
    const provider = providers[index]
    if (provider === undefined) {
      return Effect.fail(new AiUnavailable({ message: AI_APOLOGY, attempts: [...attempts] }))
    }
    return call(provider).pipe(
      Effect.timeoutOrElse({
        duration: options.timeout,
        orElse: () =>
          Effect.fail(
            new ProviderFailed({
              providerId: provider.id,
              reason: 'TIMEOUT',
              detail: `no response within ${Duration.format(Duration.fromInputUnsafe(options.timeout))}`,
            }),
          ),
      }),
      Effect.catch((error: AiError) => {
        const reason = reasonOf(error)
        attempts.push({ providerId: provider.id, reason })
        const next = providers[index + 1]
        return Effect.logWarning('ai provider failed', { provider: provider.id, reason, next: next?.id ?? null }).pipe(
          Effect.andThen(tryFrom(index + 1)),
        )
      }),
    )
  }
  return Effect.suspend(() => {
    attempts.length = 0
    return tryFrom(0)
  })
}

/**
 * 폴백 체인(P8). 앞 공급자가 실패하거나 시간을 넘기면 다음으로 넘어가고, 넘어간 사유를 로그에 남긴다. 모두 실패하면
 * 사과 문구를 담은 `AiUnavailable`. 위치는 하나라도 CLOUD면 CLOUD다.
 */
export function withFallback<P extends AiProvider>(providers: readonly [P, ...P[]], options: FallbackOptions): P {
  const id = `fallback(${providers.map((each) => each.id).join(',')})`
  const locality = providers.some((each) => each.locality === 'CLOUD') ? 'CLOUD' : 'LOCAL'
  const first = providers[0]
  switch (first.kind) {
    case 'llm': {
      const llms = providers as ReadonlyArray<P & LlmProvider>
      return {
        kind: 'llm',
        id,
        locality,
        chat: (request) => firstSuccess(llms, options, (each) => each.chat(request)),
        structured: (request, schema) => firstSuccess(llms, options, (each) => each.structured(request, schema)),
      } satisfies LlmProvider as unknown as P
    }
    case 'stt': {
      const stts = providers as ReadonlyArray<P & SttProvider>
      return {
        kind: 'stt',
        id,
        locality,
        transcribe: (request) => firstSuccess(stts, options, (each) => each.transcribe(request)),
      } satisfies SttProvider as unknown as P
    }
    case 'embedding': {
      const embedders = providers as ReadonlyArray<P & EmbeddingProvider>
      return {
        kind: 'embedding',
        id,
        locality,
        embed: (request) => firstSuccess(embedders, options, (each) => each.embed(request)),
      } satisfies EmbeddingProvider as unknown as P
    }
  }
}
