// hemr@0c4b7e8 src/modules/identity/auth/auth-config.ts를 바탕으로 함. 값은 Worker env(Effect Config)에서 읽는다
import { Config, Context, Effect, Layer, Redacted } from 'effect'
import { PBKDF2_ITERATIONS } from './password.ts'
import { generateDataKey } from './secret-box.ts'

export interface AuthSettings {
  /** access token 서명 키. */
  jwtSecret: Redacted.Redacted<string>
  /** TOTP 비밀 값 봉인 키(16진 64자). */
  dataKey: Redacted.Redacted<string>
  /** 시드 직원 비밀번호. */
  devPassword: Redacted.Redacted<string>
  /** 비밀번호 해시 반복 횟수. 테스트만 낮춘다. */
  passwordIterations: number
}

export const DEFAULT_DEV_PASSWORD = 'dlude-dev-password'

export class AuthConfig extends Context.Service<AuthConfig, AuthSettings>()('dlude/identity/AuthConfig') {
  /**
   * Worker env에서 읽는다. `JWT_SECRET`·`DATA_KEY`는 `alchemy.run.ts`가 `Alchemy.makeRandom`으로 단계마다 한 번 만들어
   * 바인딩한다. `DEV_PASSWORD`가 없으면 `dlude-dev-password`.
   */
  static readonly layerFromEnv = Layer.effect(
    AuthConfig,
    Effect.gen(function* () {
      const jwtSecret = yield* Config.Redacted('JWT_SECRET')
      const dataKey = yield* Config.Redacted('DATA_KEY')
      const devPassword = yield* Config.Redacted('DEV_PASSWORD').pipe(
        Config.withDefault(Redacted.make(DEFAULT_DEV_PASSWORD)),
      )
      if (Redacted.value(jwtSecret).length < 32) return yield* Effect.die('JWT_SECRET은 32자 이상이어야 한다')
      return { jwtSecret, dataKey, devPassword, passwordIterations: PBKDF2_ITERATIONS }
    }).pipe(Effect.orDie),
  )
}

/** 테스트 키. 테스트가 로그인 없이 access token을 만들 때(`testing.ts`) 쓴다. */
export const TEST_JWT_SECRET = Redacted.make('test-jwt-secret-test-jwt-secret-0000')

/** 고정 키를 쓰는 테스트 설정. 해시 반복을 낮춰 테스트를 빠르게 한다. */
export const TestAuthConfig = Layer.sync(AuthConfig, () => ({
  jwtSecret: TEST_JWT_SECRET,
  // 모듈을 읽을 때가 아니라 레이어를 만들 때 난수를 만든다(workerd는 전역 범위의 난수 생성을 막는다)
  dataKey: Redacted.make(generateDataKey()),
  devPassword: Redacted.make(DEFAULT_DEV_PASSWORD),
  passwordIterations: 1_000,
}))
