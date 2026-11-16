import { Data } from 'effect'

/** 모든 공급자가 실패했을 때 사용자에게 보이는 문구(P8). */
export const AI_APOLOGY = '지금은 AI가 답할 수 없습니다. 잠시 뒤 다시 시도하거나 직접 작성해 주세요.'

export type ProviderFailureReason = 'UNAVAILABLE' | 'TIMEOUT' | 'RATE_LIMITED' | 'BAD_RESPONSE'

/** 공급자 하나의 실패. 폴백 체인은 이것을 보고 다음 공급자로 넘어간다. */
export class ProviderFailed extends Data.TaggedError('ProviderFailed')<{
  providerId: string
  reason: ProviderFailureReason
  /** 로그용 설명. 요청·응답 본문은 넣지 않는다(P7). */
  detail: string
}> {}

/** 구조화 응답이 스키마와 맞지 않는다. */
export class SchemaMismatch extends Data.TaggedError('SchemaMismatch')<{
  providerId: string
  detail: string
}> {}

/** P6 정책이 이 공급자에 이 요청을 보내는 것을 막았다. */
export class PhiPolicyViolation extends Data.TaggedError('PhiPolicyViolation')<{
  providerId: string
  policy: PhiPolicy
  code: 'PHI_POLICY_VIOLATION'
}> {}

/** 폴백 체인의 공급자가 모두 실패했다. `message`는 사용자에게 보이는 사과 문구다. */
export class AiUnavailable extends Data.TaggedError('AiUnavailable')<{
  message: string
  attempts: ReadonlyArray<{ providerId: string; reason: string }>
}> {}

/**
 * 환자 정보 정책(architecture.md P6).
 *
 * - `LOCAL_ONLY`: CLOUD 공급자는 어떤 요청도 받지 않는다
 * - `VIRTUAL_DATA_ONLY`: CLOUD 공급자는 가상 데이터(`synthetic: true`)만 담은 요청만 받는다. 배포 단계의 기본값
 */
export type PhiPolicy = 'LOCAL_ONLY' | 'VIRTUAL_DATA_ONLY'

export type AiError = ProviderFailed | SchemaMismatch | PhiPolicyViolation | AiUnavailable
