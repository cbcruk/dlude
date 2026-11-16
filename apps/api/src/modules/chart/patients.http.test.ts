import { Effect, Layer, Option } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Api } from '../../api.ts'
import { AccessLog } from '../../shared/audit/access-log.ts'
import { testApp } from '../../testing/app.ts'
import { accessRuleOf } from '../identity/auth/access.ts'
import { SeededIdentity, signIn } from '../identity/auth/testing.ts'
import { SeededChart } from './testing.ts'

const app = testApp(Layer.mergeAll(SeededIdentity, SeededChart))
afterAll(() => app.dispose())

let token = ''
beforeAll(async () => {
  token = (await signIn(app, 'desk', Date.now())).accessToken
})

interface Summary {
  id: string
  name: string
  phoneLast4: string
  phone?: string
  synthetic: boolean
}
const list = async (query = '') => {
  const response = await app.request('GET', `/patients${query}`, { token })
  return { status: response.status, body: (await response.json()) as { items: Summary[]; nextCursor: string | null } }
}
const accessLogs = () => app.run(AccessLog.use((log) => log.list()).pipe(Effect.provide(AccessLog.layer)))

describe('GET /patients', () => {
  it('전화번호는 뒤 4자리만 싣고 기본 50명', async () => {
    const { status, body } = await list()
    expect(status).toBe(200)
    expect(body.items).toHaveLength(50)
    for (const each of body.items) {
      expect(each).not.toHaveProperty('phone')
      expect(each.phoneLast4).toMatch(/^\d{4}$/)
      expect(each.synthetic).toBe(true)
    }
    expect(body.nextCursor).toBe(body.items[49]!.id)
  })

  it('커서로 끝까지 넘기면 200명을 이름 순서로 한 번씩', async () => {
    const seen: Summary[] = []
    let cursor: string | null = null
    do {
      const { body } = await list(`?limit=70${cursor === null ? '' : `&cursor=${cursor}`}`)
      seen.push(...body.items)
      cursor = body.nextCursor
    } while (cursor !== null)
    expect(seen).toHaveLength(200)
    expect(new Set(seen.map((each) => each.id)).size).toBe(200)
    const names = seen.map((each) => each.name)
    expect(names).toEqual([...names].sort())
  })

  it('검색: 이름, 초성, 전화 뒤 4자리', async () => {
    const byName = (await list(`?q=${encodeURIComponent('김')}`)).body.items
    expect(byName.length).toBeGreaterThan(0)
    expect(byName.every((each) => each.name.includes('김'))).toBe(true)

    const byInitials = (await list(`?q=${encodeURIComponent('ㄱ')}&limit=200`)).body.items
    expect(byInitials.length).toBeGreaterThanOrEqual(byName.length)

    const target = byName[0]!
    const byPhone = (await list(`?q=${target.phoneLast4}`)).body.items
    expect(byPhone.map((each) => each.id)).toContain(target.id)
  })

  it('모르는 커서와 범위 밖 limit은 400 VALIDATION_FAILED', async () => {
    const cursor = await list('?cursor=pat_01JBQ000000000000000000001')
    expect(cursor.status).toBe(400)
    expect(cursor.body).toMatchObject({ violations: [{ field: 'cursor', code: 'INVALID_VALUE' }] })
    expect((await list('?limit=201')).status).toBe(400)
  })

  it('목록은 열람 기록을 남기지 않는다', async () => {
    const before = (await accessLogs()).length
    await list()
    expect(await accessLogs()).toHaveLength(before)
  })
})

describe('GET /patients/{patientId}', () => {
  it('전체 전화번호를 주고 열람 기록을 한 행 남긴다', async () => {
    const target = (await list()).body.items[0]!
    const before = await accessLogs()
    const response = await app.request('GET', `/patients/${target.id}`, { token })
    expect(response.status).toBe(200)
    const patient = await response.json()
    expect(patient).toMatchObject({ id: target.id, name: target.name, synthetic: true })
    expect(patient.phone).toMatch(new RegExp(`^010-0000-${target.phoneLast4}$`))

    const after = await accessLogs()
    expect(after.slice(before.length)).toEqual([
      expect.objectContaining({ action: 'READ', resource: 'patient', resourceId: target.id, reason: null }),
    ])
    expect(after.at(-1)!.staffId).toMatch(/^stf_/)
  })

  it('없거나 형식이 틀린 id는 404 PATIENT_NOT_FOUND이고 기록을 남기지 않는다', async () => {
    const before = (await accessLogs()).length
    for (const id of ['pat_01JBQ000000000000000000001', 'nope']) {
      const response = await app.request('GET', `/patients/${id}`, { token })
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({ code: 'PATIENT_NOT_FOUND' })
    }
    expect(await accessLogs()).toHaveLength(before)
  })
})

describe('권한', () => {
  it('두 엔드포인트 모두 patient:read를 요구한다(403은 authorization.test.ts)', () => {
    // 그룹 타입이 넓은 Top과 맞지 않아 넓혀 넘긴다
    const group = Api.groups.patients as unknown as Parameters<typeof accessRuleOf>[0]
    for (const endpoint of Object.values(group.endpoints) as Array<Parameters<typeof accessRuleOf>[1]>) {
      expect(Option.getOrNull(accessRuleOf(group, endpoint))).toEqual({
        kind: 'PERMISSIONS',
        permissions: ['patient:read'],
      })
    }
  })

  it('토큰이 없으면 401 UNAUTHENTICATED', async () => {
    const response = await app.request('GET', '/patients')
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ code: 'UNAUTHENTICATED' })
  })
})
