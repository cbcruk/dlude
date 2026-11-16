import { Effect, Redacted } from 'effect'
import { newId } from '../../shared/ids/ids.ts'
import { AuthConfig } from './auth/auth-config.ts'
import { hashPassword } from './auth/password.ts'
import { seal } from './auth/secret-box.ts'
import { IdentityRepository } from './identity-repository.ts'
import type { StaffRole } from './staff.ts'

/**
 * 원장 시드 계정의 TOTP 비밀 값. 데모에서 인증 앱에 미리 등록하려고 고정하고 README에 적는다(identity-access.md
 * "시드"). 가상 데이터로만 도는 저장소라 비밀이 아니다.
 */
export const DIRECTOR_TOTP_SECRET = 'DLUDEDEMODIRECTORTOTPSECRET23456'

const SEED_STAFF: ReadonlyArray<{ loginId: string; name: string; role: StaffRole; emoji: string }> = [
  { loginId: 'director', name: '가상 원장', role: 'DIRECTOR', emoji: '🦷' },
  { loginId: 'manager', name: '가상 실장', role: 'MANAGER', emoji: '📋' },
  { loginId: 'hygienist', name: '가상 위생사', role: 'HYGIENIST', emoji: '🪥' },
  { loginId: 'desk', name: '가상 데스크', role: 'DESK', emoji: '☎️' },
]

/**
 * 가상 직원 4명을 넣는다. 직원 표가 비어 있을 때만 넣으므로 DO가 다시 떠도 덮어쓰지 않는다. 모두 `synthetic: true`.
 * 비밀번호는 `DEV_PASSWORD`(기본 `dlude-dev-password`). 원장만 TOTP를 미리 등록하고 나머지는 첫 로그인에서 등록한다.
 */
export const seedIdentity = Effect.gen(function* () {
  const repository = yield* IdentityRepository
  if ((yield* repository.countStaff()) > 0) return
  const config = yield* AuthConfig
  const passwordHash = yield* hashPassword(Redacted.value(config.devPassword), config.passwordIterations)
  for (const each of SEED_STAFF) {
    const id = newId('staff')
    yield* repository.saveStaff({ id, ...each, synthetic: true })
    yield* repository.saveCredential({
      staffId: id,
      passwordHash,
      failedAttempts: 0,
      lockedAt: null,
      totpSecret: each.role === 'DIRECTOR' ? yield* seal(config.dataKey, DIRECTOR_TOTP_SECRET) : null,
      totpLastStep: null,
    })
  }
})
