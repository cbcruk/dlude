// from hemr@0c4b7e8 src/modules/identity/auth/access.ts — 테넌트를 빼고 행위자를 직원으로 바꿈
import { Context, Effect, Option } from 'effect'
import type { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { Permission } from '../permissions.ts'
import type { StaffRole } from '../staff.ts'
import { PermissionDenied } from './auth-errors.ts'

/**
 * 엔드포인트가 선언하는 접근 규칙.
 *
 * - `PUBLIC`: 로그인 없이 부른다. 생존 확인과 로그인·refresh·로그아웃만
 * - `SIGNED_IN`: 로그인만 필요하다. `/me`처럼 자기 자신에 대한 것
 * - `PERMISSIONS`: 나열한 권한을 모두 가져야 한다. 업무 엔드포인트는 모두 이것
 */
export type AccessRule =
  | { readonly kind: 'PUBLIC' }
  | { readonly kind: 'SIGNED_IN' }
  | { readonly kind: 'PERMISSIONS'; readonly permissions: ReadonlyArray<Permission> }

/**
 * 접근 규칙 annotation. 엔드포인트마다 `.annotate(Access, Access.requires('patient:read'))`처럼 붙인다. 붙이지 않은
 * 엔드포인트가 있으면 서버가 뜨지 않는다(`accessCheck`).
 */
export class Access extends Context.Service<Access, AccessRule>()('dlude/identity/Access') {
  static readonly public: AccessRule = { kind: 'PUBLIC' }
  static readonly signedIn: AccessRule = { kind: 'SIGNED_IN' }
  static requires(...permissions: [Permission, ...Permission[]]): AccessRule {
    return { kind: 'PERMISSIONS', permissions }
  }
}

/** 엔드포인트의 접근 규칙. 그룹에 붙인 규칙보다 엔드포인트에 붙인 규칙이 이긴다. */
export function accessRuleOf(group: HttpApiGroup.Top, endpoint: HttpApiEndpoint.Top): Option.Option<AccessRule> {
  return Context.getOption(Context.merge(group.annotations, endpoint.annotations), Access)
}

/** 인증 미들웨어가 요청에 넣는 지금 세션. */
export class CurrentSession extends Context.Service<
  CurrentSession,
  { staffId: Id<'staff'>; sessionId: Id<'session'>; role: StaffRole }
>()('dlude/identity/CurrentSession') {}

/** 권한 미들웨어가 요청에 넣는 지금 직원의 권한. 요청마다 역할에서 계산한다. */
export class CurrentAccess extends Context.Service<
  CurrentAccess,
  { staffId: Id<'staff'>; role: StaffRole; permissions: ReadonlySet<Permission> }
>()('dlude/identity/CurrentAccess') {}

/** 지금 직원이 `permissions`를 모두 가졌는지 확인한다. 엔드포인트 선언만으로 정할 수 없는 권한에 쓴다. */
export const requirePermissions = (
  access: { permissions: ReadonlySet<Permission> },
  ...permissions: [Permission, ...Permission[]]
): Effect.Effect<void, PermissionDenied> =>
  permissions.every((each) => access.permissions.has(each)) ? Effect.void : Effect.fail(new PermissionDenied({}))
