import { Effect } from 'effect'
import { IdentityRepository } from './modules/identity/identity-repository.ts'
import { seedIdentity } from './modules/identity/seed.ts'

/**
 * 가상 데이터 시드(plan "이 plan에서 정한 것"). 모든 단계가 가상 데이터로만 돌기 때문에 단계별로 나누지 않고, 각
 * 컨텍스트 표가 비어 있을 때만 넣는다. 다시 넣으려면 로컬은 `pnpm dev:reset`.
 */
export const seed = Effect.gen(function* () {
  yield* seedIdentity
}).pipe(Effect.provide(IdentityRepository.layer))
