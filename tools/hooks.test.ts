import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const HOOK = resolve(import.meta.dirname, '../.claude/hooks/guard-paths.mjs')

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'dlude-hooks-'))
  mkdirSync(join(root, 'docs/features/00-x'), { recursive: true })
  writeFileSync(join(root, 'docs/features/00-x/spec.md'), '---\nstatus: approved\napproved_on: 2026-11-16\n---\n# x\n')
  writeFileSync(join(root, 'docs/features/00-x/plan.md'), '---\nstatus: draft\napproved_on:\n---\n# x\n')
  writeFileSync(join(root, 'docs/features/00-x/notes.md'), '# 본문에만 status: approved 가 있음\n')
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

function run(tool_name: string, tool_input: Record<string, unknown>) {
  const result = spawnSync('node', [HOOK], {
    input: JSON.stringify({ tool_name, tool_input, cwd: root }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: 'utf8',
  })
  return { code: result.status, stderr: result.stderr }
}

describe('guard-paths 후크', () => {
  describe('승인된 기능 문서', () => {
    it('status: approved인 문서를 Edit하면 막는다', () => {
      const r = run('Edit', { file_path: join(root, 'docs/features/00-x/spec.md') })
      expect(r.code).toBe(2)
      expect(r.stderr).toContain('승인된 문서')
    })

    it('상대 경로로 Write해도 막는다', () => {
      expect(run('Write', { file_path: 'docs/features/00-x/spec.md' }).code).toBe(2)
    })

    it('draft 문서는 고칠 수 있다', () => {
      expect(run('Edit', { file_path: join(root, 'docs/features/00-x/plan.md') }).code).toBe(0)
    })

    it('frontmatter가 아닌 본문의 status 글자는 승인으로 보지 않는다', () => {
      expect(run('Edit', { file_path: join(root, 'docs/features/00-x/notes.md') }).code).toBe(0)
    })

    it('승인된 문서도 읽기는 막지 않는다', () => {
      expect(run('Read', { file_path: join(root, 'docs/features/00-x/spec.md') }).code).toBe(0)
    })

    it('새 문서(spec.r2.md)를 쓰는 것은 막지 않는다', () => {
      expect(run('Write', { file_path: join(root, 'docs/features/00-x/spec.r2.md') }).code).toBe(0)
    })
  })

  describe('생성물', () => {
    it('규칙 픽스처 편집을 막는다', () => {
      expect(run('Write', { file_path: join(root, 'test/fixtures/rules/a.json') }).code).toBe(2)
      expect(run('Edit', { file_path: join(root, 'apps/api/test/fixtures/rules/a.json') }).code).toBe(2)
    })

    it('OpenAPI 저장본 편집을 막는다', () => {
      const r = run('Edit', { file_path: join(root, 'docs/reference/openapi.json') })
      expect(r.code).toBe(2)
      expect(r.stderr).toContain('pnpm openapi')
    })

    it('생성물을 읽는 것은 막지 않는다', () => {
      expect(run('Read', { file_path: join(root, 'docs/reference/openapi.json') }).code).toBe(0)
    })
  })

  describe('비밀 값', () => {
    it.each(['.env', '.env.local', 'apps/api/.env.production', '.alchemy/state.json', 'apps/api/.alchemy/x'])(
      '%s 읽기를 막는다',
      (p) => {
        expect(run('Read', { file_path: join(root, p) }).code).toBe(2)
      },
    )

    it('.env.example은 읽을 수 있다', () => {
      expect(run('Read', { file_path: join(root, '.env.example') }).code).toBe(0)
    })

    it('Grep으로 .alchemy를 뒤지는 것도 막는다', () => {
      expect(run('Grep', { pattern: 'x', path: join(root, '.alchemy') }).code).toBe(2)
    })

    it.each(['cat .env', 'cat .env.local', 'grep KEY apps/api/.env', 'ls .alchemy/', 'cp x .alchemy/y'])(
      'Bash `%s`를 막는다',
      (command) => {
        expect(run('Bash', { command }).code).toBe(2)
      },
    )

    it.each(['cat .env.example', 'git status', 'pnpm verify', 'cat README.md'])('Bash `%s`는 통과시킨다', (command) => {
      expect(run('Bash', { command }).code).toBe(0)
    })
  })

  describe('demo 배포', () => {
    it.each([
      'alchemy deploy --stage demo',
      'pnpm alchemy deploy --stage=demo',
      'pnpm exec alchemy deploy --yes --stage "demo"',
      'alchemy destroy --stage demo',
    ])('`%s`를 막는다', (command) => {
      const r = run('Bash', { command })
      expect(r.code).toBe(2)
      expect(r.stderr).toContain('사람만')
    })

    it.each(['alchemy deploy --stage $USER', 'alchemy deploy --stage demo-alice', 'alchemy dev'])(
      '`%s`는 통과시킨다',
      (command) => {
        expect(run('Bash', { command }).code).toBe(0)
      },
    )
  })
})
