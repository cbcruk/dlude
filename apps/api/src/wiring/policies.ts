import type { AnyPolicy } from '../shared/events/policy.ts'

/**
 * DO alarm이 돌리는 정책 목록. 컨텍스트 사이 영향은 여기 등록한 정책으로만 흐른다. 0단계에는 없다(spec "이벤트와
 * 정책"). 3단계(후속 관리)부터 더한다.
 */
export const policies: ReadonlyArray<AnyPolicy<never>> = []
