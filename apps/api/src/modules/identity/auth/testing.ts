import { Effect, Layer } from 'effect'
import type { testApp } from '../../../testing/app.ts'
import { DEFAULT_DEV_PASSWORD } from './auth-config.ts'
import { DIRECTOR_TOTP_SECRET, seedIdentity } from '../seed.ts'
import { IdentityRepository } from '../identity-repository.ts'
import { base32Decode, hotp, totpStep } from './totp.ts'

/** 가상 직원 4명을 넣는 테스트 setup(`testApp(SeededIdentity)`). */
export const SeededIdentity = Layer.effectDiscard(seedIdentity).pipe(Layer.provide(IdentityRepository.layer))

/** `secret`(base32)의 `now` 시각 TOTP 코드. */
export const totpCode = (secret: string, now: number, stepOffset = 0) =>
  Effect.runPromise(hotp(base32Decode(secret)!, totpStep(now) + stepOffset))

/** `otpauth://` URI의 비밀 값. */
export const secretOf = (otpauthUri: string) => new URL(otpauthUri).searchParams.get('secret')!

/** 응답의 `dlude_refresh` 쿠키 값. 지우는 쿠키면 `''`, 없으면 `undefined`. */
export function refreshCookieOf(response: Response): string | undefined {
  const header = response.headers.getSetCookie().find((each) => each.startsWith('dlude_refresh='))
  return header === undefined ? undefined : header.split(';')[0]!.slice('dlude_refresh='.length)
}

type App = Pick<ReturnType<typeof testApp>, 'request'>

/**
 * 비밀번호 → TOTP 로그인을 끝까지 한다. 원장은 시드의 고정 비밀 값, 그 밖의 역할은 첫 로그인에서 등록한다.
 * 같은 30초 구간의 코드는 한 번만 받으므로 한 직원으로 두 번 로그인하려면 시계를 30초 넘게 감는다.
 */
export async function signIn(app: App, loginId: string, now: number) {
  const started = await app.request('POST', '/auth/sessions', {
    body: { loginId, password: DEFAULT_DEV_PASSWORD },
  })
  if (started.status !== 200) throw new Error(`login ${loginId}: ${started.status} ${await started.text()}`)
  const challenge = (await started.json()) as { next: string; challengeToken: string; otpauthUri?: string }
  const secret = challenge.otpauthUri === undefined ? DIRECTOR_TOTP_SECRET : secretOf(challenge.otpauthUri)
  const verified = await app.request('POST', '/auth/sessions:verify-totp', {
    body: { challengeToken: challenge.challengeToken, code: await totpCode(secret, now) },
  })
  if (verified.status !== 200) throw new Error(`verify ${loginId}: ${verified.status} ${await verified.text()}`)
  const body = (await verified.json()) as { accessToken: string; staff: { id: string } }
  return { accessToken: body.accessToken, staffId: body.staff.id, refresh: refreshCookieOf(verified)!, secret }
}
