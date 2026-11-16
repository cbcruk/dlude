// hemr@0c4b7e8 src/modules/patients/patients.api.ts의 search·get을 바탕으로 함
import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from 'effect/http-api'
import { Page, PageCursor, PageLimit } from '../../shared/http/paging.ts'
import { ValidationFailed } from '../../shared/problem/problem.ts'
import { Access } from '../identity/auth/access.ts'
import { Authorization } from '../identity/auth/authorization.ts'
import { PatientNotFound, PatientSchema, PatientSummarySchema } from './patient.ts'

export class PatientsApi extends HttpApiGroup.make('patients')
  .add(
    HttpApiEndpoint.get('list', '/patients', {
      query: {
        q: Schema.optionalKey(
          Schema.String.check(Schema.isMaxLength(50)).annotate({
            description:
              '검색어. 숫자 4자리면 전화번호 뒤 4자리나 차트번호 앞부분, 그 밖의 숫자(`-` 허용)면 차트번호 앞부분, 초성만이면 이름 초성, 그 밖이면 이름 일부(대소문자 무시).',
          }),
        ),
        limit: Schema.optionalKey(PageLimit),
        cursor: Schema.optionalKey(PageCursor(64)),
      },
      success: Page(PatientSummarySchema, '찾은 환자의 한 쪽. 이름 순서.'),
      error: ValidationFailed,
    })
      .annotate(Access, Access.requires('patient:read'))
      .annotate(OpenApi.Summary, '환자 목록·검색')
      .annotate(OpenApi.Description, '전화번호는 뒤 4자리만 싣는다. 목록은 열람 기록을 남기지 않는다.'),
    HttpApiEndpoint.get('get', '/patients/:patientId', {
      params: { patientId: Schema.String.check(Schema.isMaxLength(64)) },
      success: PatientSchema,
      error: PatientNotFound,
    })
      .annotate(Access, Access.requires('patient:read'))
      .annotate(OpenApi.Summary, '환자 상세')
      .annotate(
        OpenApi.Description,
        '응답을 주기 전에 열람 기록(`READ patient`)을 남긴다. 기록이 실패하면 응답도 없다.',
      ),
  )
  .middleware(Authorization)
  .annotate(OpenApi.Description, '가상 환자(InternalChart). 주민등록번호는 두지 않는다.') {}
