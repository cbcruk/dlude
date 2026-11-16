// from hemr@0c4b7e8 src/shared/http/idempotency.ts — 테넌트와 메모리 저장소(F2)를 빼고, 지문을 WebCrypto로 바꿈
// (workerd에서도 돌아야 함). 표는 `createIdempotencyTable`이 만들고, 작업 4의 마이그레이션 목록이 부른다.
import { Context, Effect, Layer, Option, Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { SqlClient } from 'effect/sql'
import { problemType } from '../problem/problem.ts'

/** 같은 키로 다시 온 요청에 처음 응답을 돌려주는 기간 (hemr conventions.md 멱등성). */
export const IDEMPOTENCY_WINDOW_MILLIS = 24 * 60 * 60 * 1000

export const IdempotencyKey = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)).annotate({
  description:
    '`Idempotency-Key` 헤더. 클라이언트가 만든 1–255자 문자열이고 필수다. 24시간 안에 같은 키로 같은 요청을 다시 보내면 처음 성공 응답을 그대로 돌려주고, 다른 요청에 쓰면 422 `IDEMPOTENCY_KEY_REUSED`다. 실패한 요청은 남기지 않아 고쳐서 같은 키로 다시 보낼 수 있다.',
})

export class IdempotencyKeyReused extends HttpApiError.Problem<IdempotencyKeyReused>()(
  'IdempotencyKeyReused',
  {
    type: problemType('IDEMPOTENCY_KEY_REUSED'),
    status: 422,
    title: 'Idempotency key was used for a different request',
  },
  { code: Schema.tag('IDEMPOTENCY_KEY_REUSED') },
  { description: '`IDEMPOTENCY_KEY_REUSED`: 같은 키를 다른 요청에 썼다. 처음 요청과 경로·본문이 다르다.' },
) {}

/** 저장한 처음 응답. */
export interface IdempotencyRecord {
  /** 요청(커맨드·본문)의 해시. 같은 키의 다른 요청을 알아본다. */
  fingerprint: string
  /** 처음 성공 응답 본문(JSON). */
  response: string
  createdAt: string
}

/** 멱등성 키 표를 만든다. 마이그레이션 목록에서 부른다. */
export const createIdempotencyTable = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    CREATE TABLE idempotency_keys (
      key TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      response TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT
  `
})

/** 멱등성 키 저장소. 키 하나에 처음 성공 응답 하나. 병원이 DO 하나라 테넌트 열이 없다. */
export class IdempotencyStore extends Context.Service<
  IdempotencyStore,
  {
    find(key: string): Effect.Effect<Option.Option<IdempotencyRecord>>
    /** 키의 응답을 남긴다. 기간이 지난 같은 키는 덮어쓴다. */
    save(key: string, record: IdempotencyRecord): Effect.Effect<void>
  }
>()('dlude/shared/IdempotencyStore') {
  static readonly layer = Layer.effect(
    IdempotencyStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return IdempotencyStore.of({
        find: (key) =>
          sql<IdempotencyRecord>`
            SELECT fingerprint, response, created_at AS createdAt FROM idempotency_keys WHERE key = ${key}
          `.pipe(
            Effect.map((rows) => Option.fromNullishOr(rows[0])),
            Effect.orDie,
          ),
        save: (key, record) =>
          sql`
            INSERT INTO idempotency_keys ${sql.insert({
              key,
              fingerprint: record.fingerprint,
              response: record.response,
              created_at: record.createdAt,
            })}
            ON CONFLICT (key) DO UPDATE SET
              fingerprint = excluded.fingerprint, response = excluded.response, created_at = excluded.created_at
          `.pipe(Effect.asVoid, Effect.orDie),
      })
    }),
  )
}

/** 요청의 SHA-256 해시(16진). 같은 키로 온 요청이 처음과 같은지 비교한다. */
export const requestFingerprint = (request: unknown): Effect.Effect<string> =>
  Effect.promise(async () => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(request)))
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  })

/**
 * `effect`를 멱등하게 실행한다. 같은 키로 24시간 안에 같은 요청이 다시 오면 `effect`를 실행하지 않고 처음 응답을
 * `schema`로 읽어 돌려준다. 커맨드(`operation`)나 요청이 다르면 422 `IDEMPOTENCY_KEY_REUSED`다.
 *
 * 응답은 `effect`가 성공한 뒤 남긴다. 같은 트랜잭션 안에서 부르면 쓰기와 응답 기록이 함께 커밋·롤백된다.
 * DO는 요청을 하나씩 처리하므로 같은 키로 동시에 와도 뒤 요청은 앞 요청의 응답을 본다.
 */
export const idempotent = <A, I, E, R>(
  input: {
    key: string
    /** 커맨드 이름. 같은 키를 다른 커맨드에 쓰면 본문이 같아도 다른 요청이다. */
    operation: string
    request: unknown
    now: string
    schema: Schema.Codec<A, I>
  },
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | IdempotencyKeyReused, R | IdempotencyStore> =>
  Effect.gen(function* () {
    const store = yield* IdempotencyStore
    const fingerprint = yield* requestFingerprint({ operation: input.operation, request: input.request })
    const found = Option.filter(
      yield* store.find(input.key),
      (record) => Date.parse(input.now) - Date.parse(record.createdAt) < IDEMPOTENCY_WINDOW_MILLIS,
    )
    if (Option.isSome(found)) {
      if (found.value.fingerprint !== fingerprint) return yield* new IdempotencyKeyReused({})
      return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(input.schema))(found.value.response).pipe(
        Effect.orDie,
      )
    }
    const result = yield* effect
    const response = yield* Schema.encodeEffect(Schema.fromJsonString(input.schema))(result).pipe(Effect.orDie)
    yield* store.save(input.key, { fingerprint, response, createdAt: input.now })
    return result
  })
