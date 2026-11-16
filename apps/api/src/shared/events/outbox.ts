// from hemr@0c4b7e8 src/shared/events/outbox.ts — 메모리 구현(F2)과 릴레이용 메서드(pending·mark*)를 뺌.
// 0단계에는 이벤트 버스가 없고, 소비자는 커서로 읽는 정책뿐이다.
import { Context, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'
import type { Id } from '../ids/ids.types.ts'
import type { DomainEvent, RecordedEvent } from './domain-event.ts'

/** 이벤트 outbox. 모듈은 상태 변경과 같은 트랜잭션에서 `append`하고, 정책이 `after`로 읽는다. */
export class Outbox extends Context.Service<
  Outbox,
  {
    /** 이벤트를 기록한다. 호출한 쪽의 트랜잭션에 함께 들어간다. */
    append(events: ReadonlyArray<DomainEvent>): Effect.Effect<void>
    /** `seq`가 `afterSeq`보다 큰 이벤트를 `seq` 순서로 `limit`개까지 읽는다. */
    after(afterSeq: number, limit: number): Effect.Effect<ReadonlyArray<RecordedEvent>>
  }
>()('dlude/shared/Outbox') {
  static readonly layer = Layer.effect(
    Outbox,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      interface Row {
        seq: number
        id: string
        type: string
        time: string
        subject: string
        actor: string | null
        data: string
      }

      const toEvent = (row: Row): RecordedEvent => ({
        seq: row.seq,
        id: row.id as Id<'event'>,
        type: row.type,
        time: row.time,
        subject: row.subject,
        ...(row.actor === null ? {} : { actor: JSON.parse(row.actor) }),
        data: JSON.parse(row.data),
      })

      return Outbox.of({
        append: (events) =>
          Effect.forEach(
            events,
            (event) => sql`
              INSERT INTO outbox (id, type, time, subject, actor, data)
              VALUES (${event.id}, ${event.type}, ${event.time}, ${event.subject},
                ${event.actor === undefined ? null : JSON.stringify(event.actor)}, ${JSON.stringify(event.data)})
            `,
            { discard: true },
          ).pipe(Effect.orDie),
        after: (afterSeq, limit) =>
          sql<Row>`
            SELECT seq, id, type, time, subject, actor, data FROM outbox
            WHERE seq > ${afterSeq} ORDER BY seq LIMIT ${limit}
          `.pipe(
            Effect.map((rows) => rows.map(toEvent)),
            Effect.orDie,
          ),
      })
    }),
  )
}
