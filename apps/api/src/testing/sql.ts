import { SqliteClient } from '@effect/sql-sqlite-node'
import { Layer } from 'effect'
import { migrate, PersistenceLive } from '../persistence.ts'

/**
 * 테스트용 인메모리 SQLite(F2). 마이그레이션을 모두 적용하고 공유 저장 서비스와 `SqlClient`를 준다.
 * 부를 때마다 새 DB다.
 */
export const TestSql = () =>
  PersistenceLive.pipe(
    Layer.provideMerge(Layer.effectDiscard(migrate)),
    Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
    Layer.fresh,
  )
