import * as Cloudflare from '@alchemy.run/cloudflare'
import { Effect } from 'effect'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import ClinicDO from './clinic-do.ts'

/** 병원이 하나라 DO 이름을 고정한다(spec "요청 경로"). */
export const CLINIC_NAME = 'clinic-demo'

/**
 * Worker는 경로만 나눈다(F4). `/v1/*`는 `runWorkerFirst`로 여기 오고 병원 DO로 넘긴다.
 * 그 밖의 경로는 정적 파일 층이 웹(SPA)으로 답하고 Worker까지 오지 않는다.
 */
export default Cloudflare.Worker(
  'Api',
  {
    main: import.meta.url,
    assets: {
      directory: new URL('../../web/dist', import.meta.url).pathname,
      notFoundHandling: 'single-page-application',
      runWorkerFirst: ['/v1/*'],
    },
  },
  Effect.gen(function* () {
    const clinics = yield* ClinicDO
    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest
        return yield* clinics.getByName(CLINIC_NAME).fetch(request)
      }).pipe(Effect.orDie),
    }
  }),
)
