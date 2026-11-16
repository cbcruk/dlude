// from hemr@0c4b7e8 src/shared/problem/problem.ts — URN을 dlude로, VALIDATION_FAILED 설명에서 hemr 전용 코드를 뺌
import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'

/** 오류 코드로 `type` URI를 만든다. 예: `urn:dlude:problem:account-locked` */
export function problemType(code: string): string {
  return `urn:dlude:problem:${code.toLowerCase().replaceAll('_', '-')}`
}

export class NotFound extends HttpApiError.Problem<NotFound>()(
  'NotFound',
  { type: problemType('NOT_FOUND'), status: 404, title: 'Resource not found' },
  { code: Schema.tag('NOT_FOUND') },
  { description: '`NOT_FOUND`: 요청 경로와 메서드에 맞는 경로가 없다.' },
) {}

export class Internal extends HttpApiError.Problem<Internal>()(
  'Internal',
  { type: problemType('INTERNAL'), status: 500, title: 'Internal server error' },
  { code: Schema.tag('INTERNAL') },
  { description: '`INTERNAL`: 예상 밖의 서버 오류. 원인은 응답에 싣지 않고 로그에만 남긴다(P5).' },
) {}

export class ValidationFailed extends HttpApiError.Problem<ValidationFailed>()(
  'ValidationFailed',
  { type: problemType('VALIDATION_FAILED'), status: 400, title: 'Request validation failed' },
  {
    code: Schema.tag('VALIDATION_FAILED'),
    violations: Schema.Array(Schema.Struct({ field: Schema.String, code: Schema.String })),
  },
  {
    description:
      '`VALIDATION_FAILED`: 요청이 받을 수 없는 값이다. 경로·쿼리·헤더·본문이 스키마를 통과하지 못했거나 서비스의 입력 규칙에 맞지 않는다. `violations`는 첫 오류에서 멈추지 않고 모은 모든 위반의 필드와 코드다.',
  },
) {}

export class VersionMismatch extends HttpApiError.Problem<VersionMismatch>()(
  'VersionMismatch',
  { type: problemType('VERSION_MISMATCH'), status: 412, title: 'Resource was changed by someone else' },
  { code: Schema.tag('VERSION_MISMATCH'), currentVersion: Schema.Int },
  {
    description:
      '`VERSION_MISMATCH`: `If-Match`로 보낸 버전이 저장된 버전과 다르다. 다른 사람이 먼저 고쳤다. `currentVersion`은 지금 버전이고(0이면 그사이 지워짐), 다시 읽어 고친 뒤 보낸다.',
  },
) {}
