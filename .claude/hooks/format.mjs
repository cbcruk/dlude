#!/usr/bin/env node
// PostToolUse 후크. 편집한 파일 하나를 prettier로 정리한다. prettier가 아직 없거나 실패해도 작업을 막지 않는다.
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const input = JSON.parse(readFileSync(0, 'utf8'))
const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd()
const file = input.tool_input?.file_path
const prettier = join(root, 'node_modules', '.bin', 'prettier')

if (typeof file === 'string' && existsSync(prettier)) {
  spawnSync(prettier, ['--write', '--ignore-unknown', '--log-level', 'silent', file], { cwd: root, stdio: 'ignore' })
}
process.exit(0)
