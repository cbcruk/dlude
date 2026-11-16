// from hemr@0c4b7e8 src/shared/decision/decision-context.ts — 테넌트를 빼고 행위자를 직원(`staff`)으로 바꿈.
// 이벤트 행위자를 만드는 `eventContext`는 이벤트(`shared/events`)와 함께 작업 4에서 더한다.
import { DateTime } from 'effect'
import type { Id } from '../ids/ids.types.ts'
import { clinicDate } from '../time/clinic-date.ts'

/** 판정 함수(`decide…`)가 받는 시각과 행위자. */
export interface DecisionContext {
  /** 커맨드를 처리하는 시각. ISO 8601. */
  at: string
  /** 병원 시간대의 오늘. 지난 날짜 판정에 쓴다. */
  today: string
  staffId: Id<'staff'>
}

/** 커맨드를 처리하는 직원과 지금 시각으로 판정 문맥을 만든다. */
export function decisionContext(access: { staffId: Id<'staff'> }, now: DateTime.Utc): DecisionContext {
  return {
    at: DateTime.formatIso(now),
    today: clinicDate(DateTime.toEpochMillis(now)),
    staffId: access.staffId,
  }
}
