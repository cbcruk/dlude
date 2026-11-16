import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'
import { describe, expect, it } from 'vitest'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { Exit } from 'effect'
import * as Migrator from 'effect/sql/Migrator'
import { migrate, migrations } from '../../persistence.ts'
import { TestSql } from '../../testing/sql.ts'

describe('migrations', () => {
  it('키가 `{번호}_{이름}` 형식이고 번호가 겹치지 않는다', () => {
    const ids = Object.keys(migrations).map((key) => {
      expect(key).toMatch(/^\d{4}_[a-z_]+$/)
      return Number(key.slice(0, 4))
    })
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('두 번 적용해도 다시 적용하지 않는다(DO 인스턴스를 다시 띄울 때)', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const again = yield* migrate
        const sql = yield* SqlClient.SqlClient
        const applied = yield* sql<{ name: string }>`SELECT name FROM effect_sql_migrations ORDER BY migration_id`
        return { again, applied: applied.map((row) => row.name) }
      }).pipe(Effect.provide(TestSql())),
    )
    expect(result.again).toEqual([])
    expect(result.applied).toEqual(Object.keys(migrations).map((key) => key.slice(5)))
  })

  it('같은 번호에 다른 이름이 기록된 DB면 멈춘다(지운 시험 마이그레이션이 남은 로컬 DB)', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* Migrator.make({})({
          loader: Migrator.fromRecord({ '0001_check': sql`CREATE TABLE check_rows (x TEXT)`.pipe(Effect.asVoid) }),
        })
        yield* migrate
      }).pipe(Effect.provide(SqliteClient.layer({ filename: ':memory:' }))),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(String(Exit.isFailure(exit) ? exit.cause : '')).toContain('0001_check')
  })
})
