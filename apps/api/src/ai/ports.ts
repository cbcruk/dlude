import { Context } from 'effect'
import type { Effect, Schema } from 'effect'
import type { AiError } from './errors.ts'

/** 공급자가 병원 안에서 도는지(LOCAL), 밖의 서비스인지(CLOUD). P6 판단에 쓴다. */
export type Locality = 'LOCAL' | 'CLOUD'

/**
 * 요청에 담긴 데이터의 주인. 환자·직원 데이터를 담은 요청은 반드시 적는다. `guardPhi`가 이것으로 CLOUD에 보낼 수
 * 있는지 정한다. 빈 배열은 "개인 데이터 없음"이다.
 */
export interface DataSubject {
  kind: 'patient' | 'staff'
  id: string
  synthetic: boolean
}

interface Request {
  subjects: ReadonlyArray<DataSubject>
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatRequest extends Request {
  messages: ReadonlyArray<ChatMessage>
  temperature?: number
  maxTokens?: number
}

export interface ChatResponse {
  content: string
  /** 답한 공급자. 폴백 체인이면 실제로 답한 쪽이다. */
  providerId: string
  model: string
}

interface ProviderBase {
  readonly id: string
  readonly locality: Locality
}

export interface LlmProvider extends ProviderBase {
  readonly kind: 'llm'
  chat(request: ChatRequest): Effect.Effect<ChatResponse, AiError>
  /** 응답을 `schema`로 해석한다. 맞지 않으면 `SchemaMismatch`. */
  structured<S extends Schema.Top>(
    request: ChatRequest,
    schema: S,
  ): Effect.Effect<S['Type'], AiError, S['DecodingServices']>
}

export interface TranscribeRequest extends Request {
  audio: Uint8Array
  /** MIME 형식. 예: `audio/webm` */
  mediaType: string
  language: string
  diarize: boolean
}

export interface Transcript {
  text: string
  segments: ReadonlyArray<{ startSeconds: number; endSeconds: number; speaker: string | null; text: string }>
  providerId: string
}

export interface SttProvider extends ProviderBase {
  readonly kind: 'stt'
  transcribe(request: TranscribeRequest): Effect.Effect<Transcript, AiError>
}

export interface EmbedRequest extends Request {
  texts: ReadonlyArray<string>
}

export interface EmbeddingProvider extends ProviderBase {
  readonly kind: 'embedding'
  /** 입력 순서대로의 벡터. */
  embed(request: EmbedRequest): Effect.Effect<ReadonlyArray<ReadonlyArray<number>>, AiError>
}

export type AiProvider = LlmProvider | SttProvider | EmbeddingProvider

/** 앱이 쓰는 LLM. 어댑터·폴백·정책을 조합한 결과를 Layer로 넣는다. */
export class Llm extends Context.Service<Llm, LlmProvider>()('dlude/ai/Llm') {}
export class Stt extends Context.Service<Stt, SttProvider>()('dlude/ai/Stt') {}
export class Embedding extends Context.Service<Embedding, EmbeddingProvider>()('dlude/ai/Embedding') {}
