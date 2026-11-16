// from hemr@0c4b7e8 src/openapi.ts
import { OpenApi } from 'effect/http-api'
import { Api } from './api.ts'

/**
 * HTTP 계약(`Api`)에서 만든 OpenAPI 3.1 문서. 저장한 사본은 `docs/reference/openapi.json`이고 `pnpm openapi`로만
 * 다시 만든다(손으로 고치지 않음).
 */
export function openApiDocument(): OpenApi.OpenAPISpec {
  const spec = OpenApi.fromApi(Api)
  // 라우터는 커맨드 경로의 콜론을 `::`로 적는다(`/sessions::refresh`). 문서에는 실제 경로(`/sessions:refresh`)를 쓴다
  const paths = Object.fromEntries(Object.entries(spec.paths).map(([path, item]) => [path.replaceAll('::', ':'), item]))
  return { ...spec, paths }
}

/** 저장하는 형태. 두 칸 들여쓰기와 마지막 줄바꿈. */
export const openApiJson = (): string => `${JSON.stringify(openApiDocument(), null, 2)}\n`
