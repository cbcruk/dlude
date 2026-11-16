import { Schema } from 'effect'
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from 'effect/http-api'
import { Access } from './modules/identity/auth/access.ts'
import { PatientsApi } from './modules/chart/patients.api.ts'
import { AuthApi, MeApi } from './modules/identity/auth/auth.api.ts'
import { RequestValidation } from './shared/problem/request-validation.ts'

// from hemr@0c4b7e8 src/api.ts (SystemApi)
export class SystemApi extends HttpApiGroup.make('system')
  .add(
    HttpApiEndpoint.get('health', '/health', {
      success: Schema.Struct({ status: Schema.Literal('ok') }).annotate({
        description: '서버가 요청을 받을 수 있다.',
      }),
    })
      .annotate(Access, Access.public)
      .annotate(OpenApi.Summary, '생존 확인'),
  )
  .annotate(OpenApi.Description, '로컬 개발과 배포 확인에서 쓰는 생존 확인.') {}

/**
 * dlude의 HTTP 계약. 모든 경로는 `/v1` 아래에 있다.
 *
 * Worker는 `/v1/*`를 병원 Durable Object(`ClinicDO`)로 넘기고, 그 안에서 이 계약을 처리한다(F4).
 * 엔드포인트마다 접근 규칙(`Access`)을 선언한다. 빠뜨리면 서버가 뜨지 않는다(`accessCheck`).
 * 요청 디코딩 실패는 모든 위반을 모아 `VALIDATION_FAILED`(RFC 9457)로 응답한다.
 */
export class Api extends HttpApi.make('dlude')
  .add(SystemApi)
  .add(AuthApi)
  .add(MeApi)
  .add(PatientsApi)
  .middleware(RequestValidation)
  .annotate(HttpApi.ParseOptions, { errors: 'all' })
  .prefix('/v1') {}
