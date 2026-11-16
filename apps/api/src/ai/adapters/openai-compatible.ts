import { Effect, Redacted } from 'effect'
import { ProviderFailed } from '../errors.ts'
import type { ProviderFailureReason } from '../errors.ts'
import type { ChatRequest, ChatResponse, EmbeddingProvider, LlmProvider, Locality } from '../ports.ts'
import { decodeStructured, jsonSchemaOf } from '../structured.ts'

/**
 * OpenAI 호환 API(Ollama, vLLM, LM Studio, llama.cpp server) 설정. 기본 위치는 LOCAL이다(architecture.md 6절).
 * 예: Ollama는 `baseUrl: 'http://localhost:11434/v1'`.
 */
export interface OpenAiCompatibleConfig {
  id: string
  baseUrl: string
  model: string
  embeddingModel?: string
  apiKey?: Redacted.Redacted<string>
  locality?: Locality
}

interface ChatCompletion {
  model?: string
  choices?: Array<{ message?: { content?: string | null } }>
}

interface Embeddings {
  data?: Array<{ index?: number; embedding?: number[] }>
}

function reasonOf(status: number): ProviderFailureReason {
  if (status === 429) return 'RATE_LIMITED'
  return status >= 500 ? 'UNAVAILABLE' : 'BAD_RESPONSE'
}

export function openAiCompatible(config: OpenAiCompatibleConfig) {
  const locality = config.locality ?? 'LOCAL'
  const fail = (reason: ProviderFailureReason, detail: string) =>
    new ProviderFailed({ providerId: config.id, reason, detail })

  const post = <A>(path: string, body: unknown) =>
    Effect.tryPromise({
      try: (signal) =>
        fetch(`${config.baseUrl.replace(/\/$/, '')}${path}`, {
          method: 'POST',
          signal,
          headers: {
            'content-type': 'application/json',
            ...(config.apiKey === undefined ? {} : { authorization: `Bearer ${Redacted.value(config.apiKey)}` }),
          },
          body: JSON.stringify(body),
        }),
      catch: (error) => fail('UNAVAILABLE', `request failed: ${String(error).slice(0, 200)}`),
    }).pipe(
      Effect.flatMap((response) =>
        response.ok
          ? Effect.tryPromise({
              try: () => response.json() as Promise<A>,
              catch: () => fail('BAD_RESPONSE', 'response is not JSON'),
            })
          : Effect.fail(fail(reasonOf(response.status), `HTTP ${response.status}`)),
      ),
    )

  const complete = (request: ChatRequest, extra: Record<string, unknown> = {}) =>
    post<ChatCompletion>('/chat/completions', {
      model: config.model,
      messages: request.messages,
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
      stream: false,
      ...extra,
    }).pipe(
      Effect.flatMap((body) => {
        const content = body.choices?.[0]?.message?.content
        return typeof content === 'string'
          ? Effect.succeed({ content, providerId: config.id, model: body.model ?? config.model } satisfies ChatResponse)
          : Effect.fail(fail('BAD_RESPONSE', 'no choices[0].message.content'))
      }),
    )

  const llm: LlmProvider = {
    kind: 'llm',
    id: config.id,
    locality,
    chat: (request) => complete(request),
    structured: (request, schema) =>
      complete(request, {
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'response', strict: true, schema: jsonSchemaOf(schema) },
        },
      }).pipe(Effect.flatMap((response) => decodeStructured(config.id, response.content, schema))),
  }

  const embedding: EmbeddingProvider = {
    kind: 'embedding',
    id: config.id,
    locality,
    embed: (request) =>
      post<Embeddings>('/embeddings', { model: config.embeddingModel ?? config.model, input: request.texts }).pipe(
        Effect.flatMap((body) => {
          const data = [...(body.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
          const vectors = data.map((each) => each.embedding)
          return vectors.length === request.texts.length && vectors.every(Array.isArray)
            ? Effect.succeed(vectors as number[][])
            : Effect.fail(fail('BAD_RESPONSE', `expected ${request.texts.length} embeddings, got ${vectors.length}`))
        }),
      ),
  }

  return { llm, embedding }
}
