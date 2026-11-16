import { Schema } from 'effect'
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from 'effect/http-api'

// from hemr@0c4b7e8 src/api.ts (SystemApi). 접근 규칙(Access) 선언은 작업 6에서 더한다.
export class SystemApi extends HttpApiGroup.make('system')
  .add(
    HttpApiEndpoint.get('health', '/health', {
      success: Schema.Struct({ status: Schema.Literal('ok') }).annotate({
        description: '서버가 요청을 받을 수 있다.',
      }),
    }).annotate(OpenApi.Summary, '생존 확인'),
  )
  .annotate(OpenApi.Description, '로컬 개발과 배포 확인에서 쓰는 생존 확인.') {}

/**
 * dlude의 HTTP 계약. 모든 경로는 `/v1` 아래에 있다.
 *
 * Worker는 `/v1/*`를 병원 Durable Object(`ClinicDO`)로 넘기고, 그 안에서 이 계약을 처리한다.
 */
export class Api extends HttpApi.make('dlude').add(SystemApi).prefix('/v1') {}
