import { HttpRouter, HttpServer } from 'effect/http'
import { Layer } from 'effect'
import { afterAll, describe, expect, it } from 'vitest'
import { AppLive } from './app.ts'

const app = HttpRouter.toWebHandler(AppLive.pipe(Layer.provide(HttpServer.layerServices)), { disableLogger: true })

afterAll(() => app.dispose())

describe('AppLive', () => {
  it('/v1/health에 200과 status ok로 답한다', async () => {
    const response = await app.handler(new Request('http://localhost/v1/health'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })
})
