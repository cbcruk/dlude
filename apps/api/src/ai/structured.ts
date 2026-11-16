import { Effect, Schema } from 'effect'
import { SchemaMismatch } from './errors.ts'

/** 모델이 낸 JSON 문자열을 `schema`로 해석한다. 코드 블록(```json)으로 감싼 응답도 받는다. */
export function decodeStructured<S extends Schema.Top>(
  providerId: string,
  content: string,
  schema: S,
): Effect.Effect<S['Type'], SchemaMismatch, S['DecodingServices']> {
  const json = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  return Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(json).pipe(
    Effect.mapError((issue) => new SchemaMismatch({ providerId, detail: String(issue).slice(0, 500) })),
  )
}

/** OpenAI 호환 `response_format`에 싣는 JSON Schema. */
export function jsonSchemaOf(schema: Schema.Top): Record<string, unknown> {
  const document = Schema.toJsonSchemaDocument(schema)
  return Object.keys(document.definitions).length === 0
    ? { ...document.schema }
    : { ...document.schema, $defs: document.definitions }
}
