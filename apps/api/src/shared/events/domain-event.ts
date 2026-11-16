// from hemr@0c4b7e8 src/shared/events/domain-event.ts — 테넌트를 빼고 행위자를 직원으로 바꿈
import { newId } from '../ids/ids.ts'
import type { Id } from '../ids/ids.types.ts'

/**
 * 도메인 이벤트 envelope. 필드 이름은 CloudEvents를 따른다. `seq`는 outbox에 쓸 때 붙으므로 여기에는 없다.
 */
export interface DomainEvent {
  id: Id<'event'>
  /** 예: `appointment.canceled` */
  type: string
  /** 발생 시각. ISO 8601. */
  time: string
  /** 주 리소스 ID. */
  subject: string
  actor?: { kind: 'STAFF' | 'SYSTEM'; id: string }
  /** 화면이 바로 반응하는 데 필요한 최소 필드. 환자 본문 같은 민감 정보는 넣지 않는다(P7). */
  data: Record<string, unknown>
}

/** outbox에 기록된 이벤트. `seq`는 기록 순서대로 오르는 번호. */
export interface RecordedEvent extends DomainEvent {
  seq: number
}

/** 새 이벤트를 만든다. ID는 발생 시각의 ULID. */
export function domainEvent(
  type: string,
  subject: string,
  time: string,
  data: Record<string, unknown>,
  context: Pick<DomainEvent, 'actor'> = {},
): DomainEvent {
  return { id: newId('event', Date.parse(time)), type, time, subject, ...context, data }
}
