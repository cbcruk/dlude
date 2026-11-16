#!/usr/bin/env node
// PreToolUse 후크. docs/process.md 5절의 "강제 장치"를 막는다. 막으면 종료 코드 2와 stderr 사유.
// pnpm install 전에도 돌아야 하므로 Node 내장 모듈만 쓴다.
import { readFileSync, existsSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** @param {string} message */
function block(message) {
  process.stderr.write(`${message}\n`)
  process.exit(2)
}

/** @param {string} root @param {string} p */
function toRelative(root, p) {
  const abs = isAbsolute(p) ? p : resolve(root, p)
  return relative(root, abs).split(sep).join('/')
}

/** @param {string} rel */
function isSecretPath(rel) {
  const parts = rel.split('/')
  if (parts.includes('.alchemy')) return true
  const name = parts.at(-1) ?? ''
  return name.startsWith('.env') && name !== '.env.example'
}

/** @param {string} abs */
function isApprovedDoc(abs) {
  if (!existsSync(abs)) return false
  const text = readFileSync(abs, 'utf8')
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  return front !== null && /^status:\s*approved\s*$/m.test(front[1] ?? '')
}

/** @param {string} command */
function checkCommand(command) {
  if (/(^|[\s'"=/:<>|;&(])\.env(?!\.example\b)[\w.-]*/.test(command)) {
    block('`.env*` 파일은 에이전트가 읽거나 쓰지 않는다 (CLAUDE.md "하지 않는 것").')
  }
  if (/(^|[\s'"=/:<>|;&(])\.alchemy(\/|\b)/.test(command)) {
    block('`.alchemy/`는 에이전트가 읽거나 쓰지 않는다 (CLAUDE.md "하지 않는 것").')
  }
  if (/\balchemy\b[^;&|]*\b(deploy|destroy)\b[^;&|]*--stage(=|\s+)['"]?demo(?![\w-])/.test(command)) {
    block('`demo` 단계 배포는 사람만 한다 (docs/process.md 5절).')
  }
}

const input = JSON.parse(readFileSync(0, 'utf8'))
const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd()
const tool = input.tool_name
const args = input.tool_input ?? {}

if (tool === 'Bash') {
  checkCommand(String(args.command ?? ''))
  process.exit(0)
}

const target = args.file_path ?? args.notebook_path ?? args.path
if (typeof target !== 'string') process.exit(0)
const rel = toRelative(root, target)

if (isSecretPath(rel)) {
  block(`${rel}: 비밀 값 파일은 에이전트가 읽거나 쓰지 않는다 (CLAUDE.md "하지 않는 것").`)
}

if (EDIT_TOOLS.has(tool)) {
  if (rel.startsWith('test/fixtures/rules/') || rel.includes('/test/fixtures/rules/')) {
    block(`${rel}: 규칙 픽스처는 손으로 고치지 않는다.`)
  }
  if (rel === 'docs/reference/openapi.json') {
    block(`${rel}: OpenAPI 저장본은 \`pnpm openapi\`로만 만든다.`)
  }
  if (rel.startsWith('docs/features/') && rel.endsWith('.md') && isApprovedDoc(resolve(root, rel))) {
    block(`${rel}: 승인된 문서는 고치지 않는다. 멈추고 묻거나 개정 초안(spec.r2.md 등)을 쓴다.`)
  }
}

process.exit(0)
