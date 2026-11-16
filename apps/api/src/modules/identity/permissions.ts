// from hemr@0c4b7e8 src/modules/identity/permissions.ts — 카탈로그를 dlude 0단계 권한으로 줄이고, 병원별 조정·면허를 뺌
import type { StaffRole } from './staff.ts'

/**
 * 서버가 아는 권한 전체 (identity-access.md "역할과 권한"). `resource:action` 문자열이고, 역할은 권한 묶음 프리셋이다.
 * 뒤 단계가 권한을 더할 때 이 목록과 identity-access.md 표를 함께 고친다.
 */
export const PERMISSIONS = ['patient:read', 'staff:read', 'totp:disable_own'] as const

export type Permission = (typeof PERMISSIONS)[number]

// 프리셋은 목록으로 직접 적는다. 카탈로그에 권한을 더해도 프리셋에 저절로 들어가지 않게 하기 위해서다
export const ROLE_PERMISSIONS: Record<StaffRole, ReadonlySet<Permission>> = {
  // 원장은 TOTP를 끌 수 없다(F7). 그래서 `totp:disable_own`이 없다
  DIRECTOR: new Set(['patient:read', 'staff:read']),
  MANAGER: new Set(['patient:read', 'staff:read', 'totp:disable_own']),
  HYGIENIST: new Set(['patient:read', 'totp:disable_own']),
  DESK: new Set(['patient:read', 'totp:disable_own']),
}

/** 역할의 권한. 권한은 토큰에 넣지 않고 요청마다 이것으로 계산한다. */
export const permissionsOf = (role: StaffRole): ReadonlySet<Permission> => ROLE_PERMISSIONS[role]
