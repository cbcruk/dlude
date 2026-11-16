import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Effect, Redacted, Schema } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openAiCompatible } from './openai-compatible.ts'

interface Received {
  path: string
  authorization: string | undefined
  body: Record<string, unknown>
}

const received: Received[] = []
let reply: { status: number; body: unknown } = { status: 200, body: {} }
const server = createServer((request, response) => {
  let raw = ''
  request.on('data', (chunk) => (raw += chunk))
  request.on('end', () => {
    received.push({ path: request.url ?? '', authorization: request.headers.authorization, body: JSON.parse(raw) })
    response.writeHead(reply.status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(reply.body))
  })
})
let baseUrl = ''
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
})
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.result(effect))
const adapter = () =>
  openAiCompatible({ id: 'ollama', baseUrl, model: 'qwen3:14b', embeddingModel: 'bge-m3', apiKey: Redacted.make('k') })
const request = {
  messages: [
    { role: 'system' as const, content: '너는 치과 직원을 돕는다' },
    { role: 'user' as const, content: '안녕' },
  ],
  subjects: [],
  temperature: 0.2,
  maxTokens: 100,
}

describe('openai-compatible', () => {
  it('chat: /chat/completions에 모델·메시지·설정을 보내고 첫 선택지를 읽는다', async () => {
    received.length = 0
    reply = {
      status: 200,
      body: { model: 'qwen3:14b', choices: [{ message: { role: 'assistant', content: '안녕하세요' } }] },
    }
    const { llm } = adapter()
    expect(llm.locality).toBe('LOCAL')
    expect(await run(llm.chat(request))).toMatchObject({
      _tag: 'Success',
      success: { content: '안녕하세요', providerId: 'ollama', model: 'qwen3:14b' },
    })
    expect(received).toEqual([
      {
        path: '/v1/chat/completions',
        authorization: 'Bearer k',
        body: { model: 'qwen3:14b', messages: request.messages, temperature: 0.2, max_tokens: 100, stream: false },
      },
    ])
  })

  it('structured: JSON Schema를 response_format으로 보내고 응답을 스키마로 해석한다', async () => {
    received.length = 0
    reply = {
      status: 200,
      body: { choices: [{ message: { content: '```json\n{"summary":"스케일링","teeth":[16]}\n```' } }] },
    }
    const schema = Schema.Struct({ summary: Schema.String, teeth: Schema.Array(Schema.Int) })
    expect(await run(adapter().llm.structured(request, schema))).toMatchObject({
      _tag: 'Success',
      success: { summary: '스케일링', teeth: [16] },
    })
    expect(received[0]!.body['response_format']).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'response', schema: { type: 'object', required: ['summary', 'teeth'] } },
    })

    reply = { status: 200, body: { choices: [{ message: { content: '{"summary":1}' } }] } }
    expect(await run(adapter().llm.structured(request, schema))).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'SchemaMismatch', providerId: 'ollama' },
    })
  })

  it('embed: /embeddings의 data를 index 순서로', async () => {
    received.length = 0
    reply = {
      status: 200,
      body: {
        data: [
          { index: 1, embedding: [0, 1] },
          { index: 0, embedding: [1, 0] },
        ],
      },
    }
    expect(await run(adapter().embedding.embed({ texts: ['a', 'b'], subjects: [] }))).toMatchObject({
      _tag: 'Success',
      success: [
        [1, 0],
        [0, 1],
      ],
    })
    expect(received[0]).toMatchObject({ path: '/v1/embeddings', body: { model: 'bge-m3', input: ['a', 'b'] } })
  })

  it('HTTP 상태로 실패 사유를 나눈다: 429 RATE_LIMITED, 5xx UNAVAILABLE, 형식 오류 BAD_RESPONSE', async () => {
    const cases: Array<[number, unknown, string]> = [
      [429, {}, 'RATE_LIMITED'],
      [503, {}, 'UNAVAILABLE'],
      [400, {}, 'BAD_RESPONSE'],
      [200, { choices: [] }, 'BAD_RESPONSE'],
    ]
    for (const [status, body, reason] of cases) {
      reply = { status, body }
      expect(await run(adapter().llm.chat(request))).toMatchObject({
        _tag: 'Failure',
        failure: { _tag: 'ProviderFailed', reason },
      })
    }
  })

  it('서버가 없으면 UNAVAILABLE', async () => {
    const { llm } = openAiCompatible({ id: 'down', baseUrl: 'http://127.0.0.1:1/v1', model: 'm' })
    expect(await run(llm.chat(request))).toMatchObject({ _tag: 'Failure', failure: { reason: 'UNAVAILABLE' } })
  })
})
