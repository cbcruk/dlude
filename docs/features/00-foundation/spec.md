---
status: draft
approved_on:
intent: ./intent.md
---

# 0. 기반: spec

[intent](intent.md)의 "원하는 결과"를 만들기 위해 무엇을 만드는지 정한다. 컨텍스트 설계는 [identity-access.md](../../design/identity-access.md), [chart.md](../../design/chart.md), 규약 차이는 [conventions.md](../../design/conventions.md)에 있고 여기서는 범위와 결정만 적는다. 스택 가정은 [스파이크](spike.md)에서 확인했다.

## 범위

| 영역 | 만드는 것 | 만들지 않는 것 |
|---|---|---|
| 저장소 | pnpm workspace(`apps/api`, `apps/web`), `alchemy.run.ts`, `.nvmrc`, prettier, `pnpm verify` | |
| 배포 | `alchemy dev`(로컬), 개인 단계(`$USER`) 배포 1회로 FTS5·CPU 시간 확인 | `demo` 단계 |
| 공유 인프라 (`apps/api/src/shared/`) | hemr에서 옮김: `ids`, `problem`(Problem·검증 오류·예상 밖 오류), `http`(paging·etag·idempotency), `db`(마이그레이션·`Transaction`), `events`(outbox·policy, DO alarm 실행기), `audit`(감사 기록·열람 기록), `time` | `jobs`의 실행기(4단계 이전에 필요 없음. 타입만) |
| Identity & Access | 로그인 + TOTP, refresh, 로그아웃, `/me`, TOTP 해제, 보안 기록, 권한 선언 강제 | 직원 관리 API(1단계), 잠금 해제 |
| Chart | 환자 목록·검색·상세, 시드(환자 약 200명 + 예약·치료계획), `ChartSystem` 포트의 읽기 메서드 | 예약 커맨드(3단계), `appendNote`·`attachDocument`(2·4단계) |
| AI | `LlmProvider`·`SttProvider`·`EmbeddingProvider` 포트, `fake`·`openai-compatible` 어댑터, `withFallback`, `guardPhi` | `crossValidate`(6단계), `workers-ai`·`anthropic`·`whisper-http`(쓸 단계에서) |
| 웹 | 로그인 → TOTP(등록 시 QR) → 환자 목록·검색 | 디자인 시스템 선택은 열린 질문 |
| 강제 장치 | [process.md 5절](../../process.md#5-강제-장치)의 후크, CI(`pnpm verify`), Claude 리뷰 워크플로(hemr 것을 옮김), `main` 브랜치 보호 | 개발 에이전트 평가(`evals/agent/`) |
| 문서 | `README.md`(실행 방법, 시드 계정), `docs/reference/openapi.json` 저장본 | |

## 리소스와 커맨드

자세한 것은 컨텍스트 문서. 0단계에서 생기는 엔드포인트 전부:

| 메서드·경로 | 하는 일 | 권한 | 멱등성·`If-Match` |
|---|---|---|---|
| `GET /health` | 살아 있음 | 없음 | |
| `POST /auth/sessions` | 비밀번호 확인 → 로그인 도전 | 없음 | |
| `POST /auth/sessions:verify-totp` | TOTP 확인(등록) → 세션 | 없음 | |
| `POST /auth/sessions:refresh` | access token 재발급 | 쿠키 | |
| `DELETE /auth/sessions/current` | 로그아웃 | 없음 | |
| `GET /me` | 내 정보·권한 | 로그인 | |
| `POST /me/totp:disable` | TOTP 해제(재등록하게 함) | `totp:disable_own` | |
| `GET /patients` | 환자 목록·검색 | `patient:read` | |
| `GET /patients/{patientId}` | 환자 상세 + 열람 기록 | `patient:read` | |

멱등성·`If-Match`는 0단계 엔드포인트에 쓰는 곳이 없다. 인프라와 그 테스트만 hemr에서 옮긴다.

## 요청 경로

```
브라우저 ─ 같은 출처 ─▶ Worker
                         ├─ /v1/*  → ClinicDO("clinic-demo").fetch(request)
                         └─ 그 밖  → 웹 정적 파일 (SPA)
```

- **인증을 포함한 모든 API는 DO 안에서 돈다.** Worker는 경로만 나눈다. ([F4](#결정))
- 웹과 API는 같은 출처다. refresh 쿠키가 `SameSite=Strict`로 동작한다 ([F6](#결정))
- DO 이름은 `clinic-demo` 하나로 고정한다. 병원 여럿은 범위 밖

## 상태

| 현재 | 커맨드 | 다음 | 거부 코드 |
|---|---|---|---|
| (없음) | `POST /auth/sessions`, 비밀번호 맞음 | 도전 `PENDING` | `INVALID_CREDENTIALS`, `ACCOUNT_LOCKED` |
| 도전 `PENDING` | `:verify-totp`, 코드 맞음 | 도전 `USED`, 세션 `ACTIVE` | `TOTP_INVALID`, `CHALLENGE_INVALID` |
| 도전 `PENDING` | 5분 지남 또는 코드 5회 실패 | 도전 `EXPIRED` | |
| 세션 `ACTIVE` | 로그아웃, refresh 재사용 감지, 잠금 | 세션 `REVOKED` | |
| TOTP `ENROLLED` | `:disable` (원장 아님) | TOTP 없음 | `TOTP_REQUIRED_FOR_ROLE` |

판정은 `session.aggregate.ts`·`login-challenge.aggregate.ts`의 `decide…` 순수 함수가 하고, given/when/then 테스트를 둔다.

## 오류 코드

[identity-access.md](../../design/identity-access.md#오류-코드)와 [chart.md](../../design/chart.md#오류-코드), 공통은 hemr와 같음(`VALIDATION_FAILED` 400, `NOT_FOUND` 404, `INTERNAL` 500).

## 이벤트와 정책

0단계에는 컨텍스트 사이 이벤트가 없다. outbox와 정책 실행기는 시험용 정책 하나로 검증한다.

| 확인할 동작 | 방법 |
|---|---|
| 커맨드의 상태 변경과 outbox 행이 한 트랜잭션 | 실패하는 커맨드 뒤 둘 다 없음 (스파이크와 같은 시험을 테스트로) |
| 커밋 뒤 DO alarm이 정책을 돌림 | 시험용 정책이 커서를 올리는지 `alchemy dev`에서 확인 |
| 정책 결함이면 그 이벤트에서 멈추고 다음 alarm에 재시도 | Node 테스트(실행기를 alarm 없이 직접 호출) |

## AI 포트

[architecture.md 6절](../../architecture.md#6-ai-추상화-appsapisrcai)의 포트를 Effect 서비스로 만든다. 0단계 완료 기준:

- `fake` 어댑터: 정해 둔 응답, 지연, 실패를 주입
- `withFallback([a, b, c], { timeout })`: 앞이 실패·시간 초과면 다음으로, 모두 실패하면 정해진 사과 문구를 담은 오류. 전환 사유를 로그에 남김
- `guardPhi(provider, policy)`: `LOCAL_ONLY`면 CLOUD 어댑터 호출을 `PHI_POLICY_VIOLATION`으로 막음. `VIRTUAL_DATA_ONLY`면 요청에 `synthetic: false`인 데이터가 있을 때 막음
- `openai-compatible` 어댑터: 컴파일과 fake HTTP 서버 대상 테스트. 실제 Ollama 연결은 수동 확인

## 원칙 점검

| 원칙 | 0단계에서 |
|---|---|
| P1 (AI는 초안) | 해당 없음. `AiDraft`는 2단계 |
| P2 (가정 표시) | 해당 없음 |
| P3 (숫자는 코드) | 해당 없음 |
| P4 (교차 검증) | 해당 없음 |
| P5 (실패를 성공처럼 말하지 않기) | 모든 오류가 Problem Details. 예상 밖 오류는 500 `INTERNAL`이고 원인은 로그에만 |
| P6 (데이터는 병원 밖으로 나가지 않음) | `guardPhi`, 환자·직원 `synthetic` 표시, 주민등록번호 없음 |
| P7 (감사 기록에 본문 없음) | 보안 기록·열람 기록·감사 기록에 비밀번호·코드·토큰·환자 본문 없음. 테스트로 열 목록 확인 |
| P8 (폴백 체인) | `withFallback` |

## 결정

| # | 질문 | 대안 | 결정·대가·되돌릴 조건 |
|---|---|---|---|
| F1 | 저장 계층을 무엇에서 가져오나 | semu `TableFactory`(JSON 레코드 표) / hemr `shared/db`(`effect/sql` + 마이그레이션 + `Transaction`) | **hemr.** 이미 `effect/sql` 위에 있어 `@effect/sql-sqlite-do`로 바꾸기만 하면 된다. 표가 SQL 열이라 FTS5·인덱스를 바로 쓴다. 스파이크 문서의 "semu TableFactory" 제안은 이것으로 바꾼다. 대가: semu의 JSON 레코드처럼 스키마를 자유롭게 바꾸지 못하고 마이그레이션을 써야 함 |
| F2 | 메모리 저장소 구현을 두나 | hemr처럼 메모리 + SQL / SQL 하나 | **SQL 하나.** 테스트는 `@effect/sql-sqlite-node`의 `:memory:`. 메모리 구현은 트랜잭션을 되돌리지 못해 hemr도 쓰는 순서를 조심해야 했고, 저장소 코드가 두 벌이 된다. 대가: 판정이 아닌 서비스 테스트가 SQLite를 띄워 조금 느림. 되돌릴 조건: 테스트 한 번이 30초를 넘으면 |
| F3 | 마이그레이션 형식 | Alchemy `SqlMigrations`(.sql 파일) / Effect `SqliteMigrator`(TS) | **Effect `SqliteMigrator`.** Node 테스트와 DO가 같은 마이그레이션 코드를 쓴다(`@effect/sql-sqlite-node`·`-do` 둘 다 Migrator가 있음). DO는 인스턴스가 처음 뜰 때 적용 |
| F4 | 인증을 Worker에서 하나 DO에서 하나 | Worker가 JWT 검증 후 DO로 / 모두 DO | **모두 DO.** 세션 폐기 확인에 DB 조회가 필요한데 DB가 DO에 있다. 병원이 하나라 Worker에서 거를 이유가 없다. architecture.md 3.2의 "Worker는 인증과 라우팅"을 고친다. 되돌릴 조건: 병원이 여럿이 되어 Worker가 어느 DO로 보낼지 토큰에서 알아야 할 때 |
| F5 | 비밀번호 해시 | Node `scrypt` / WebCrypto PBKDF2-SHA256 | **PBKDF2-SHA256.** workerd와 Node에서 같은 코드가 돈다. 반복 횟수는 해시 문자열에 저장해 나중에 올린다. 시작 값은 개인 단계 배포에서 CPU 시간을 재서 정한다(Workers 무료 요금제의 CPU 한도에 걸리면 반복을 낮추고 기록) |
| F6 | 웹과 API의 출처 | 다른 출처 + CORS / 같은 출처 | **같은 출처.** refresh 쿠키를 `SameSite=Strict`로 둘 수 있다. Worker의 정적 파일 제공으로 SPA를 낸다. 방법(Alchemy `Website.Vite` + 라우트 / Worker `assets`)은 plan에서 정한다 |
| F7 | TOTP를 누구에게 강제하나 | 원장만 / 모두 | **모두, 원장만 끌 수 없음.** [identity-access.md](../../design/identity-access.md#로그인) 참고 |
| F8 | 주민등록번호를 저장하나 | hemr처럼 암호화 저장 / 저장 안 함 | **저장 안 함.** 필요한 기능이 없다. 되돌릴 조건: 보험 청구류 기능을 범위에 넣을 때 |
| F9 | semu·hemr 코드 재사용 방식 | 복사 / 공유 패키지 | **복사.** 출처 커밋을 파일 머리 주석에 남긴다. 런타임(Node·DO)과 테넌트 유무가 달라 공유 패키지로 뽑으면 일반화 비용이 더 크다. 되돌릴 조건: 같은 버그를 세 저장소에서 따로 고치는 일이 두 번 생기면 |
| F10 | `effect` 버전 | 4.1.2(semu·hemr) / 4.1.4 | **4.1.4 고정.** Alchemy peer 요구. 정확한 버전으로 고정하고 Alchemy와 함께 올린다 |

## semu·hemr와 다른 점

[conventions.md](../../design/conventions.md#다른-점)에 표로 있다. 요약: 테넌트 없음, DO 런타임, 메모리 저장소 없음, alarm 기반 정책, PBKDF2, `synthetic` 표시, 주민등록번호 없음, TOTP.

## 가정

- `@effect/sql-sqlite-do`의 `SqliteMigrator`가 DO 첫 요청 전에 돌릴 수 있다 — 스파이크에서 마이그레이션은 시험하지 않았다
- 트랜잭션 중첩(savepoint)이 `@effect/sql-sqlite-do`에서 동작한다 — hemr `Transaction`과 정책 실행기가 기대는 동작. 문서 주석에는 "중첩 트랜잭션은 자기만 되돌림"이라고 되어 있으나 실행으로 확인하지 않았다
- 실패 응답과 함께 남아야 하는 기록(비밀번호 실패 횟수, 보안 기록)은 트랜잭션 밖에서 쓰면 된다 — DO SQLite는 트랜잭션 밖 문장이 바로 커밋된다
- PBKDF2 반복이 Workers CPU 한도 안에 든다
- Alchemy가 같은 Worker에서 정적 파일과 DO 라우팅을 함께 할 수 있다

## 열린 질문

1. UI 컴포넌트 라이브러리: shadcn/ui(권장) / 다른 것
2. 개인 단계 배포에 쓸 Cloudflare 계정과 요금제 (무료 요금제면 CPU 한도 때문에 F5가 영향을 받음)
3. Claude 리뷰 워크플로에 쓸 인증(hemr와 같은 방식이면 저장소 비밀 값 설정을 저장소 주인이 해야 함)
