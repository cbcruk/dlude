import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { fakeLlm, fakeStt } from './adapters/fake.ts'
import { guardPhi } from './guard-phi.ts'
import type { ChatRequest, DataSubject } from './ports.ts'
import { withFallback } from './with-fallback.ts'

const patient = (synthetic: boolean): DataSubject => ({ kind: 'patient', id: 'pat_x', synthetic })
const chat = (subjects: DataSubject[]): ChatRequest => ({ messages: [{ role: 'user', content: '요약' }], subjects })
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.result(effect))

describe('guardPhi', () => {
  it('LOCAL_ONLY + CLOUD → PHI_POLICY_VIOLATION, 공급자를 부르지 않는다', async () => {
    const cloud = fakeLlm({ id: 'cloud', locality: 'CLOUD', reply: 'x' })
    const result = await run(guardPhi(cloud, 'LOCAL_ONLY').chat(chat([patient(true)])))
    expect(result).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'PhiPolicyViolation', code: 'PHI_POLICY_VIOLATION', providerId: 'cloud', policy: 'LOCAL_ONLY' },
    })
    expect(cloud.calls).toHaveLength(0)
  })

  it('VIRTUAL_DATA_ONLY + CLOUD: synthetic: false가 하나라도 있으면 막고, 모두 true면 통과', async () => {
    const cloud = guardPhi(fakeLlm({ id: 'cloud', locality: 'CLOUD', reply: 'ok' }), 'VIRTUAL_DATA_ONLY')
    expect(await run(cloud.chat(chat([patient(true), patient(false)])))).toMatchObject({
      _tag: 'Failure',
      failure: { code: 'PHI_POLICY_VIOLATION' },
    })
    expect(await run(cloud.chat(chat([patient(true)])))).toMatchObject({ _tag: 'Success', success: { content: 'ok' } })
    expect(await run(cloud.chat(chat([])))).toMatchObject({ _tag: 'Success' })
  })

  it('LOCAL 공급자는 정책과 관계없이 통과', async () => {
    const local = guardPhi(fakeLlm({ id: 'local', reply: 'ok' }), 'LOCAL_ONLY')
    expect(await run(local.chat(chat([patient(false)])))).toMatchObject({ _tag: 'Success' })
  })

  it('STT도 같은 규칙', async () => {
    const stt = guardPhi(fakeStt({ id: 'cloud-stt', locality: 'CLOUD', text: '...' }), 'VIRTUAL_DATA_ONLY')
    const request = { audio: new Uint8Array(), mediaType: 'audio/webm', language: 'ko', diarize: true }
    expect(await run(stt.transcribe({ ...request, subjects: [patient(false)] }))).toMatchObject({ _tag: 'Failure' })
    expect(await run(stt.transcribe({ ...request, subjects: [patient(true)] }))).toMatchObject({ _tag: 'Success' })
  })

  it('폴백 체인 안에서 막힌 CLOUD는 건너뛰고 LOCAL로 넘어간다', async () => {
    const chain = withFallback(
      [
        guardPhi(fakeLlm({ id: 'cloud', locality: 'CLOUD', reply: 'cloud' }), 'LOCAL_ONLY'),
        fakeLlm({ id: 'local', reply: 'local' }),
      ],
      { timeout: '5 seconds' },
    )
    expect(await run(chain.chat(chat([patient(false)])))).toMatchObject({
      _tag: 'Success',
      success: { providerId: 'local' },
    })
  })
})
