# 0. 기반: 스파이크 결과 (2026-11-15)

[intent.md](intent.md)의 "가정" 중 앞의 셋을 버릴 코드로 확인했다. 코드는 저장소에 넣지 않았고, 핵심 조각만 아래에 남긴다.

## 환경

| 패키지 | 버전 |
|---|---|
| `alchemy`, `@alchemy.run/cloudflare` | 2.0.0-beta.87 |
| `effect`, `@effect/platform-node`, `@effect/sql-sqlite-do` | 4.1.4 |
| `workerd` | 1.20261026.1 (`alchemy dev`의 로컬 런타임) |
| Node / pnpm | 24.22.1 / 12.15.0 |

pnpm 12에서는 `workerd`의 설치 스크립트가 기본으로 막힌다. `pnpm-workspace.yaml`에 `allowBuilds: { workerd: true }`가 필요하다.

## 결과

| # | 가정 | 결과 | 근거 |
|---|---|---|---|
| 1 | Alchemy v2가 Effect 4와 같은 의존 그래프에서 동작 | **맞음** | `alchemy`·`@alchemy.run/cloudflare`의 peer가 `effect ^4.1.4`. semu·hemr의 `4.1.2`는 `4.1.4`로 올려야 한다 |
| 2 | `effect/http-api`를 Durable Object의 `fetch`에 붙일 수 있음 | **맞음** | `HttpApiBuilder.layer(Api) → HttpRouter.toHttpEffect`를 DO의 `fetch`로 돌려주고, Worker는 `clinics.getByName("clinic-demo").fetch(request)`로 넘김. Alchemy의 상태 저장소 Worker도 같은 방식(`StateStore/Api.ts`) |
| 3 | DO SQLite가 FTS5를 지원 | **로컬 workerd에서 맞음** | `CREATE VIRTUAL TABLE … USING fts5` + `MATCH … ORDER BY rank` 동작. 배포된 환경은 0단계 첫 개인 단계 배포 때 다시 확인 |
| 4 | 요청 하나 = 트랜잭션 하나, 롤백 | **맞음** | `@effect/sql-sqlite-do`의 `SqliteClient.layer({ storage })` + `sql.withTransaction`. 상태 행과 outbox 행을 같이 쓰고, 도중에 Problem 오류로 실패하면 둘 다 되돌아감 |
| 5 | 읽은 사실이 판정과 저장 사이에 바뀌지 않음 (semu M3) | **맞음** | 트랜잭션 안에서 앱 코드로 읽기 → 계산 → 쓰기(중간에 `Effect.yieldNow`)를 동시 요청 50개로 보냄. 결과 50, 유실 없음 |
| 6 | hemr 규약의 형태 | **맞음** | 커맨드 경로 `/counters/:id::increment` → 실제 `/counters/a:increment`, `HttpApiError.Problem` → 409 `application/problem+json` 본문 `{code, type, status, title}`, 없는 경로 404 |

```
GET  /v1/counters/a              → {"value":0,"outbox":0}
POST /v1/counters/a:increment ×2 → {"value":2,"outbox":2}
POST /v1/counters/a:fail         → 409 {"code":"BOOM",…}
GET  /v1/counters/a              → {"value":2,"outbox":2}   # 롤백됨
GET  /v1/search?q=implant        → 2건
50 × POST /v1/counters/race:increment (동시) → {"value":50}
```

## 핵심 조각

```ts
// Durable Object (Alchemy 2단계 패턴: 바깥 = 바인딩, 안 = 인스턴스)
export default class Clinic extends Cloudflare.DurableObject<Clinic>()(
  "Clinic",
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState
    return Effect.gen(function* () {
      const SqlLive = SqliteClient.layer({ storage: state.raw.storage })
      const fetch = HttpApiBuilder.layer(Api).pipe(
        Layer.provide(Handlers),
        Layer.provide(SqlLive),
        Layer.provide([Etag.layer, HttpPlatformStub, Path.layer]), // 파일 응답 없음 → 스텁
        HttpRouter.toHttpEffect,
      )
      return { fetch: Effect.flatten(fetch) }
    })
  }),
) {}
```

## spec에 넘길 것

- **저장 계층:** semu `TableFactory`의 SQLite 구현을 `node:sqlite` 대신 `effect/sql`의 `SqlClient`로 쓰면 Node(테스트)와 DO(런타임)가 같은 코드를 쓴다. 테스트는 `@effect/sql-sqlite-node`, 런타임은 `@effect/sql-sqlite-do`
- **UnitOfWork:** semu의 `UnitOfWorkMiddleware`(4xx·5xx면 되돌림)를 `sql.withTransaction`으로 구현. `keepChanges`(실패 응답과 함께 남길 쓰기)는 트랜잭션 중첩(savepoint)으로 되는지 확인 필요
- **타입:** 스파이크는 `as any` 두 곳(`state.raw.storage`의 타입 선언 차이, `fetch`의 Effect 요구 타입)으로 넘겼다. spec 단계에서 `tsc`로 정리할 것
- **아직 확인하지 않은 것:** DO alarm으로 outbox 정책 돌리기, WebSocket Hibernation, Cron → DO, R2 서명 URL, 배포 환경 FTS5, `HttpPlatformStub` 대신 공식 웹 플랫폼 레이어가 있는지
