// from hemr@0c4b7e8 src/shared/db/transaction.ts — 메모리 구현을 뺌(F2)
import { Context, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * 여러 저장소에 걸친 쓰기를 한 트랜잭션으로 묶는다. 저장소 쓰기는 저마다 트랜잭션을 열지만, 바깥 트랜잭션 안에서는
 * 안쪽 트랜잭션이 되어 바깥과 함께 커밋·롤백된다. 안쪽만 실패하면 안쪽만 되돌린다(DO에서 확인: spike.md 작업 2).
 */
export class Transaction extends Context.Service<
  Transaction,
  {
    /** `effect`를 한 트랜잭션에서 실행한다. 실패하면 그 안의 쓰기를 모두 되돌린다. */
    run<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>
  }
>()('dlude/shared/Transaction') {
  static readonly layer = Layer.effect(
    Transaction,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return Transaction.of({
        run: (effect) => effect.pipe(sql.withTransaction, Effect.catchTag('SqlError', Effect.die)),
      })
    }),
  )
}
