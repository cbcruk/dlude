import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'
import { describe, expect, it } from 'vitest'
import { TestSql } from '../../testing/sql.ts'
import { AccessLog } from './access-log.ts'
import { AuditLog } from './audit-log.ts'
import { contentHash } from './content-hash.ts'

const run = <A, E, R>(program: Effect.Effect<A, E, R>) =>
  Effect.runPromise(program.pipe(Effect.provide(TestSql())) as Effect.Effect<A, E, never>)

const columns = (table: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ name: string }>`SELECT name FROM pragma_table_info(${table}) ORDER BY cid`
    return rows.map((row) => row.name)
  })

/**
 * P7 허용 목록. 감사·열람 기록에 본문(환자 정보, 요청·응답 본문, 비밀번호·코드·토큰)을 담을 열이 생기면 이 테스트가
 * 실패한다. 열을 더하려면 이 목록을 고치는 것이 리뷰에 드러나야 한다.
 */
describe('감사·열람 기록 표 (P7)', () => {
  it('audit_logs 열은 행위자·대상·시각·전후 해시뿐이다', async () => {
    expect(await run(columns('audit_logs'))).toEqual([
      'seq',
      'at',
      'actor',
      'action',
      'resource_type',
      'resource_id',
      'before_hash',
      'after_hash',
    ])
  })

  it('access_logs 열은 누가·언제·무엇을·왜 열람했는지뿐이다', async () => {
    expect(await run(columns('access_logs'))).toEqual([
      'seq',
      'time',
      'staff_id',
      'action',
      'resource',
      'resource_id',
      'reason',
    ])
  })
})

describe('AuditLog', () => {
  it('전후 내용은 해시로만 남는다', async () => {
    const result = await run(
      Effect.gen(function* () {
        const before = { name: '가상환자', phone: '010-0000-0001' }
        const after = { ...before, phone: '010-0000-0002' }
        const log = yield* AuditLog
        yield* log.record({
          at: '2026-11-16T00:00:00.000Z',
          actor: 'stf_01JBQ000000000000000000001',
          action: 'patient.updated',
          resourceType: 'patient',
          resourceId: 'pat_01JBQ000000000000000000001',
          beforeHash: yield* contentHash(before),
          afterHash: yield* contentHash(after),
        })
        return yield* log.list()
      }),
    )
    expect(result).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain('가상환자')
    expect(result[0]!.beforeHash).toMatch(/^[0-9a-f]{64}$/)
    expect(result[0]!.beforeHash).not.toBe(result[0]!.afterHash)
  })
})

describe('AccessLog', () => {
  it('쓴 순서대로 돌려준다', async () => {
    const result = await run(
      Effect.gen(function* () {
        const log = yield* AccessLog
        for (const resourceId of ['pat_1', 'pat_2']) {
          yield* log.record({
            time: '2026-11-16T00:00:00.000Z',
            staffId: 'stf_1',
            action: 'READ',
            resource: 'patient',
            resourceId,
            reason: null,
          })
        }
        return (yield* log.list()).map((entry) => entry.resourceId)
      }),
    )
    expect(result).toEqual(['pat_1', 'pat_2'])
  })
})

describe('contentHash', () => {
  it('키 순서와 상관없이 같은 값이면 같은 해시다', async () => {
    const [a, b] = await Effect.runPromise(
      Effect.all([contentHash({ x: 1, y: { p: 1, q: 2 } }), contentHash({ y: { q: 2, p: 1 }, x: 1 })]),
    )
    expect(a).toBe(b)
  })
})
