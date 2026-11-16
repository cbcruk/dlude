// hemr@0c4b7e8 src/openapi.test.ts를 바탕으로 함(Schema title 검사는 뺌: dlude는 title을 쓰지 않음)
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { openApiDocument, openApiJson } from './openapi.ts'

type Operations = Record<
  string,
  { operationId?: string; responses?: Record<string, { description?: string; content?: object }> }
>

const operations = () =>
  Object.entries(openApiDocument().paths).flatMap(([path, item]) =>
    Object.entries(item as Operations).map(([method, operation]) => ({ path, method, operation })),
  )

describe('OpenAPI 문서', () => {
  it('저장한 docs/reference/openapi.json이 HTTP 계약과 같다 (다르면 pnpm openapi)', () => {
    const saved = readFileSync(new URL('../../../docs/reference/openapi.json', import.meta.url), 'utf8')
    expect(saved).toBe(openApiJson())
  })

  it('0단계 엔드포인트 9개가 모두 있다', () => {
    expect(
      operations()
        .map(({ method, path }) => `${method.toUpperCase()} ${path}`)
        .sort(),
    ).toEqual([
      'DELETE /v1/auth/sessions/current',
      'GET /v1/health',
      'GET /v1/me',
      'GET /v1/patients',
      'GET /v1/patients/{patientId}',
      'POST /v1/auth/sessions',
      'POST /v1/auth/sessions:refresh',
      'POST /v1/auth/sessions:verify-totp',
      'POST /v1/me/totp:disable',
    ])
  })

  it('이름 있는 Schema가 사본(`_1`)으로 갈라지지 않는다', () => {
    const names = Object.keys(openApiDocument().components.schemas)
    expect(names.filter((name) => /_\d+$/.test(name))).toEqual([])
  })

  it('오류 응답은 모두 문제 응답(`application/problem+json`)이다', () => {
    const strays = operations().flatMap(({ path, method, operation }) =>
      Object.entries(operation.responses ?? {})
        .filter(([status, response]) => Number(status) >= 400 && response.content !== undefined)
        .filter(([, response]) => Object.keys(response.content!).some((type) => type !== 'application/problem+json'))
        .map(([status]) => `${method} ${path} ${status}`),
    )
    expect(strays).toEqual([])
  })

  it('오류 응답의 설명은 오류 코드로 시작하는 한글이다', () => {
    // 같은 상태 코드의 설명은 ` | `로 이어 붙으므로 조각마다 본다
    const english = operations().flatMap(({ path, method, operation }) =>
      Object.entries(operation.responses ?? {})
        .filter(
          ([status, response]) =>
            Number(status) >= 400 &&
            (response.description ?? '').split(' | ').some((part) => !/^`[A-Z_]+`: .*[가-힣]/.test(part)),
        )
        .map(([status, response]) => `${method} ${path} ${status}: ${response.description}`),
    )
    expect(english).toEqual([])
  })

  it('성공 응답에 영문 기본 설명(`Success`, `<No Content>`)이 남지 않는다', () => {
    const defaults = operations().flatMap(({ path, method, operation }) =>
      Object.entries(operation.responses ?? {})
        .filter(([status, response]) => Number(status) < 400 && !/[가-힣]/.test(response.description ?? ''))
        .map(([status, response]) => `${method} ${path} ${status}: ${response.description}`),
    )
    expect(defaults).toEqual([])
  })
})
