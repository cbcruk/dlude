import { Data, Effect, Exit } from 'effect'
import { SqlClient } from 'effect/sql'
import { describe, expect, it } from 'vitest'
import { TestSql } from '../../testing/sql.ts'
import { domainEvent } from '../events/domain-event.ts'
import { Outbox } from '../events/outbox.ts'
import { Transaction } from './transaction.ts'

class Refused extends Data.TaggedError('Refused')<{}> {}

const run = <A, E>(program: Effect.Effect<A, E, SqlClient.SqlClient | Transaction | Outbox>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE things (id TEXT PRIMARY KEY, value INTEGER NOT NULL) STRICT`
      return yield* program
    }).pipe(Effect.provide(TestSql())),
  )

const counts = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [things] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM things`
  const [events] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM outbox`
  return { things: things!.n, outbox: events!.n }
})

/** 상태 행과 outbox 행을 쓰는 커맨드. `refuse`면 둘 다 쓴 뒤 거부한다. */
const command = (id: string, refuse: boolean) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`INSERT INTO things (id, value) VALUES (${id}, 1)`
    yield* (yield* Outbox).append([domainEvent('thing.created', id, '2026-11-16T00:00:00.000Z', {})])
    if (refuse) return yield* new Refused()
  })

describe('Transaction', () => {
  it('커맨드가 성공하면 상태 행과 outbox 행이 함께 남는다', async () => {
    const result = await run(
      Effect.gen(function* () {
        yield* (yield* Transaction).run(command('a', false))
        return yield* counts
      }),
    )
    expect(result).toEqual({ things: 1, outbox: 1 })
  })

  it('커맨드가 실패하면 상태 행도 outbox 행도 남지 않는다', async () => {
    const result = await run(
      Effect.gen(function* () {
        const exit = yield* Effect.exit((yield* Transaction).run(command('a', true)))
        return { failed: Exit.isFailure(exit), ...(yield* counts) }
      }),
    )
    expect(result).toEqual({ failed: true, things: 0, outbox: 0 })
  })

  it('안쪽 트랜잭션이 실패하면 안쪽 쓰기만 되돌린다', async () => {
    const result = await run(
      Effect.gen(function* () {
        const transaction = yield* Transaction
        yield* transaction.run(
          Effect.gen(function* () {
            yield* command('outer', false)
            yield* Effect.exit(transaction.run(command('inner', true)))
          }),
        )
        return yield* counts
      }),
    )
    expect(result).toEqual({ things: 1, outbox: 1 })
  })
})
