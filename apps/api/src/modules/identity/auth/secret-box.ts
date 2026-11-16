import { Effect, Option, Redacted } from 'effect'
import { fromBase64Url, randomBytes, toBase64Url, utf8 } from './bytes.ts'

/**
 * TOTP 비밀 값처럼 저장해야 하지만 원문이 새면 안 되는 값을 봉인한다. `DATA_KEY`(32바이트, 16진 64자. 배포에서는
 * `Alchemy.makeRandom`이 만든다)로 AES-256-GCM.
 * 형식은 `v1.iv.ciphertext`. 키를 바꾸면 버전을 올린다.
 */
const importKey = (dataKey: Redacted.Redacted<string>) =>
  Effect.promise(async () => {
    const hex = Redacted.value(dataKey)
    if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('DATA_KEY는 32바이트(16진 64자)여야 한다')
    const raw = Uint8Array.from(hex.match(/../g)!, (pair) => parseInt(pair, 16))
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
  })

export const seal = (dataKey: Redacted.Redacted<string>, plaintext: string) =>
  Effect.gen(function* () {
    const key = yield* importKey(dataKey)
    const iv = randomBytes(12)
    const sealed = yield* Effect.promise(() => crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8(plaintext)))
    return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(sealed))}`
  })

/** 형식이 틀리거나 키가 다르거나 내용이 바뀌었으면 `none`. */
export const open = (dataKey: Redacted.Redacted<string>, sealed: string) =>
  Effect.gen(function* () {
    const [version, rawIv, rawData, ...rest] = sealed.split('.')
    const iv = fromBase64Url(rawIv ?? '')
    const data = fromBase64Url(rawData ?? '')
    if (version !== 'v1' || rest.length > 0 || iv === null || data === null) return Option.none<string>()
    const key = yield* importKey(dataKey)
    return yield* Effect.tryPromise(() => crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)).pipe(
      Effect.map((plain) => Option.some(new TextDecoder().decode(plain))),
      Effect.orElseSucceed(() => Option.none<string>()),
    )
  })

/** 새 `DATA_KEY`. 개발·테스트 설정을 만들 때 쓴다. */
export const generateDataKey = (): string =>
  Array.from(randomBytes(32), (byte) => byte.toString(16).padStart(2, '0')).join('')
