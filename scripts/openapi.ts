import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openApiJson } from '../apps/api/src/openapi.ts'

// HTTP 계약에서 OpenAPI 문서를 다시 만들어 저장한다. apps/api/src/openapi.test.ts가 저장본과 비교한다
writeFileSync(join(import.meta.dirname, '..', 'docs', 'reference', 'openapi.json'), openApiJson())
