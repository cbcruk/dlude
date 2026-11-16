import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from './api.ts'

export const HealthHttpLive = HttpApiBuilder.group(Api, 'system', (handlers) =>
  handlers.handle('health', () => Effect.succeed({ status: 'ok' as const })),
)
