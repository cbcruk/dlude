import { Duration, Effect } from 'effect'
import { ProviderFailed } from '../errors.ts'
import type { ProviderFailureReason } from '../errors.ts'
import type { ChatRequest, EmbeddingProvider, LlmProvider, Locality, SttProvider, TranscribeRequest } from '../ports.ts'
import { decodeStructured } from '../structured.ts'

/** 테스트용 공급자의 행동. 지연은 Effect 시계를 따르므로 `TestClock`으로 앞당길 수 있다. */
export interface FakeBehavior {
  id?: string
  locality?: Locality
  /** 응답 전에 기다리는 시간. */
  delay?: Duration.Input
  /** 주면 이 사유로 실패한다. */
  fail?: ProviderFailureReason
}

const behave = <A>(id: string, behavior: FakeBehavior, result: () => A) =>
  Effect.gen(function* () {
    if (behavior.delay !== undefined) yield* Effect.sleep(behavior.delay)
    if (behavior.fail !== undefined) {
      return yield* new ProviderFailed({ providerId: id, reason: behavior.fail, detail: 'fake failure' })
    }
    return result()
  })

/**
 * 미리 정한 응답을 주는 LLM. `reply`는 문자열이거나 요청을 받아 문자열을 만드는 함수. 받은 요청은 `calls`에 쌓인다.
 */
export function fakeLlm(behavior: FakeBehavior & { reply: string | ((request: ChatRequest) => string) }) {
  const id = behavior.id ?? 'fake-llm'
  const calls: ChatRequest[] = []
  const content = (request: ChatRequest) => {
    calls.push(request)
    return typeof behavior.reply === 'string' ? behavior.reply : behavior.reply(request)
  }
  const provider: LlmProvider = {
    kind: 'llm',
    id,
    locality: behavior.locality ?? 'LOCAL',
    chat: (request) => behave(id, behavior, () => ({ content: content(request), providerId: id, model: 'fake' })),
    structured: (request, schema) =>
      behave(id, behavior, () => content(request)).pipe(Effect.flatMap((text) => decodeStructured(id, text, schema))),
  }
  return Object.assign(provider, { calls })
}

/** 미리 정한 받아쓰기를 주는 STT. */
export function fakeStt(behavior: FakeBehavior & { text: string }) {
  const id = behavior.id ?? 'fake-stt'
  const calls: TranscribeRequest[] = []
  const provider: SttProvider = {
    kind: 'stt',
    id,
    locality: behavior.locality ?? 'LOCAL',
    transcribe: (request) =>
      behave(id, behavior, () => {
        calls.push(request)
        return {
          text: behavior.text,
          segments: [{ startSeconds: 0, endSeconds: 1, speaker: request.diarize ? 'A' : null, text: behavior.text }],
          providerId: id,
        }
      }),
  }
  return Object.assign(provider, { calls })
}

/** 글자에서 결정적으로 만든 벡터를 주는 임베딩. 같은 글이면 같은 벡터다. */
export function fakeEmbedding(behavior: FakeBehavior & { dimensions?: number } = {}) {
  const id = behavior.id ?? 'fake-embedding'
  const dimensions = behavior.dimensions ?? 8
  const vectorOf = (text: string) => {
    const vector = Array.from({ length: dimensions }, () => 0)
    for (const [index, char] of [...text].entries()) vector[index % dimensions]! += (char.codePointAt(0)! % 97) / 97
    const norm = Math.hypot(...vector) || 1
    return vector.map((each) => each / norm)
  }
  const provider: EmbeddingProvider = {
    kind: 'embedding',
    id,
    locality: behavior.locality ?? 'LOCAL',
    embed: (request) => behave(id, behavior, () => request.texts.map(vectorOf)),
  }
  return provider
}
