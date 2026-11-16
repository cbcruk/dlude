import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PERMISSIONS, permissionsOf } from './permissions.ts'
import { STAFF_ROLES } from './staff.ts'

/** identity-access.md "역할과 권한" 표를 읽는다. 문서와 코드가 어긋나면 이 테스트가 실패한다. */
function documentedTable(): Record<string, string[]> {
  const doc = readFileSync(new URL('../../../../../docs/design/identity-access.md', import.meta.url), 'utf8')
  const section = doc.split('## 역할과 권한')[1]!.split('\n## ')[0]!
  const rows = section.split('\n').filter((line) => line.startsWith('| `'))
  const table: Record<string, string[]> = Object.fromEntries(STAFF_ROLES.map((role) => [role, []]))
  for (const row of rows) {
    const cells = row
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim())
    const permission = cells[0]!.replaceAll('`', '')
    STAFF_ROLES.forEach((role, index) => {
      if (cells[index + 1] === '✓') table[role]!.push(permission)
    })
  }
  return table
}

describe('역할 권한', () => {
  it('identity-access.md 표와 같다', () => {
    const fromCode = Object.fromEntries(STAFF_ROLES.map((role) => [role, [...permissionsOf(role)].sort()]))
    const fromDoc = Object.fromEntries(Object.entries(documentedTable()).map(([role, list]) => [role, list.sort()]))
    expect(fromCode).toEqual(fromDoc)
  })

  it('표의 권한은 모두 카탈로그에 있다', () => {
    const documented = Object.values(documentedTable()).flat()
    expect(documented.length).toBeGreaterThan(0)
    for (const permission of documented) expect(PERMISSIONS as readonly string[]).toContain(permission)
  })

  it('원장은 TOTP를 끌 권한이 없다(F7)', () => {
    expect(permissionsOf('DIRECTOR').has('totp:disable_own')).toBe(false)
  })
})
