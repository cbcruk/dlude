import { Effect } from 'effect'
import { PhiPolicyViolation } from './errors.ts'
import type { PhiPolicy } from './errors.ts'
import type { AiProvider, DataSubject } from './ports.ts'

/** 이 공급자에 이 데이터를 보내도 되는지(P6). LOCAL 공급자는 늘 된다. */
export function phiAllows(policy: PhiPolicy, locality: AiProvider['locality'], subjects: ReadonlyArray<DataSubject>) {
  if (locality === 'LOCAL') return true
  switch (policy) {
    case 'LOCAL_ONLY':
      return false
    case 'VIRTUAL_DATA_ONLY':
      return subjects.every((each) => each.synthetic)
  }
}

/**
 * 공급자를 P6 정책으로 감싼다. 막으면 공급자를 부르지 않고 `PhiPolicyViolation`(`PHI_POLICY_VIOLATION`).
 * 폴백 체인에서는 공급자마다 감싼다: `withFallback([guardPhi(cloud, policy), local])`.
 */
export function guardPhi<P extends AiProvider>(provider: P, policy: PhiPolicy): P {
  const check = (subjects: ReadonlyArray<DataSubject>) =>
    phiAllows(policy, provider.locality, subjects)
      ? Effect.void
      : Effect.fail(new PhiPolicyViolation({ providerId: provider.id, policy, code: 'PHI_POLICY_VIOLATION' }))
  const guarded = (() => {
    switch (provider.kind) {
      case 'llm':
        return {
          ...provider,
          chat: (request) => Effect.andThen(check(request.subjects), provider.chat(request)),
          structured: (request, schema) =>
            Effect.andThen(check(request.subjects), provider.structured(request, schema)),
        } satisfies typeof provider
      case 'stt':
        return {
          ...provider,
          transcribe: (request) => Effect.andThen(check(request.subjects), provider.transcribe(request)),
        } satisfies typeof provider
      case 'embedding':
        return {
          ...provider,
          embed: (request) => Effect.andThen(check(request.subjects), provider.embed(request)),
        } satisfies typeof provider
    }
  })()
  return guarded as P
}
