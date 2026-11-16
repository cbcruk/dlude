import * as Cloudflare from '@alchemy.run/cloudflare'
import * as Alchemy from 'alchemy'
import { Effect } from 'effect'
import Api from './apps/api/src/worker.ts'

/**
 * dlude 스택. 단계는 `--stage`로 정한다: 개인 단계(`$USER`)는 에이전트도 배포하고, `demo`는 사람만 배포한다.
 * 웹은 먼저 `pnpm --filter @dlude/web build`로 `apps/web/dist`를 만든다.
 */
export default Alchemy.Stack(
  'Dlude',
  { providers: Cloudflare.providers(), state: Alchemy.localState() },
  Effect.gen(function* () {
    const api = yield* Api
    return { url: api.url }
  }),
)
