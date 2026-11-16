#!/usr/bin/env node
// 로컬 `alchemy dev`의 DO 데이터(SQLite)를 지운다. 다음 `pnpm dev`에서 마이그레이션과 시드가 처음부터 들어간다.
// 잠금 해제(0단계에는 API가 없음)와 마이그레이션 이력이 꼬였을 때 쓴다. 로컬 런타임 폴더(local)만 지우고 배포 상태는
// 건드리지 않는다. 비밀 값을 다루는 폴더 옆이라 에이전트는 이 스크립트를 실행하지 않고 사람이 실행한다.
import { rmSync } from 'node:fs'
import { join } from 'node:path'

const target = join(import.meta.dirname, '..', '.alchemy', 'local')
rmSync(target, { recursive: true, force: true })
console.log(`지움: ${target}`)
