---
status: approved
approved_on: 2026-11-16
spec: ./spec.md
---

# 0. 기반: plan

[spec](spec.md)을 만드는 순서. 작업 하나가 PR 하나다. 앞 작업이 병합돼야 다음 작업을 시작한다. 확인되지 않은 가정은 작업 2에서 먼저 확인하고, 틀리면 멈추고 spec 개정(`spec.r2.md`)을 묻는다.

hemr·semu에서 옮기는 파일은 머리 주석에 출처를 남긴다(F9): `// from hemr@0c4b7e8 src/shared/ids/ids.ts`. 기준 커밋은 hemr `0c4b7e8`, semu `5b0fffc`.

## 작업

| # | 작업 | 바꿀 파일 | 증명하는 테스트 |
|---|---|---|---|
| 1 | **저장소 뼈대와 강제 장치.** pnpm workspace, `effect` 4.1.4 고정(F10), `pnpm verify` = typecheck + format:check + test. 후크와 CI | `package.json`, `pnpm-workspace.yaml`(`allowBuilds: { workerd: true }`), `.nvmrc`, `.prettierrc`, `tsconfig.base.json`, `vitest.config.ts`(projects), `apps/api/package.json`, `apps/web/package.json`, `.claude/settings.json`, `.claude/hooks/guard-paths.mjs`, `.claude/hooks/format.mjs`, `tools/hooks.test.ts`, `.github/workflows/ci.yml`, `.github/workflows/claude-code-review.yml`, `.github/workflows/claude.yml` | `tools/hooks.test.ts`: 후크에 도구 입력 JSON을 넣어 종료 코드 확인. `status: approved`인 `docs/features/**` 편집 → 2, `draft` → 0. `test/fixtures/rules/**`·`docs/reference/openapi.json` 편집 → 2. `.env`·`.env.local`·`.alchemy/x` 읽기 → 2, `.env.example` → 0. `alchemy deploy --stage demo` 명령 → 2. CI에서 `pnpm verify` 통과 |
| 2 | **스택 뼈대와 가정 확인.** Worker + ClinicDO + 정적 파일, `GET /v1/health`. spec "가정" 다섯 개 중 넷을 여기서 확인 | `alchemy.run.ts`, `apps/api/src/worker.ts`, `apps/api/src/clinic-do.ts`, `apps/api/src/api.ts`, `apps/api/src/health.http.ts`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/vite.config.ts`, `docs/features/00-foundation/spike.md`(확인 결과 절 추가) | `apps/api/src/app.test.ts`: Node에서 `GET /v1/health` 200. 수동(`alchemy dev`): `/` → 웹, `/v1/health` → DO 응답(F6 방법 결정). 임시 마이그레이션 하나가 DO 첫 요청 전에 적용됨. 중첩 트랜잭션 안쪽 실패가 안쪽만 되돌림. 결과는 spike.md에 적고 시험 코드는 지운다 |
| 3 | **공유 기초.** hemr에서 `ids`, `problem`, `time`, `http`(paging·etag·idempotency), `jobs` 타입, `decision`(given/when/then 도우미) 복사. 테넌트 제거, URN `urn:dlude:problem:` | `apps/api/src/shared/{ids,problem,time,http,jobs,decision}/**` | hemr 테스트를 함께 옮긴다: `ids.test.ts`(접두사 `stf`·`ses`·`chl`·`pat`·`apt`·`tpl`·`evt`·`job`), `problem.test.ts`(type URN, 500은 원인을 본문에 넣지 않음), `request-validation.test.ts`, `idempotency.test.ts`, `clinic-date.test.ts` |
| 4 | **저장·이벤트·감사.** `db`(Migrator, `Transaction`), `events`(outbox, policy, DO alarm 실행기), `audit`(감사 기록, 열람 기록). 테스트 런타임은 `@effect/sql-sqlite-node` `:memory:`(F2) | `apps/api/src/shared/{db,events,audit}/**`, `apps/api/src/persistence.ts`(Node·DO 레이어 둘), `apps/api/src/testing/sql.ts`, `apps/api/src/clinic-do.ts`(alarm 연결) | `transaction.test.ts`: 실패한 커맨드 뒤 상태 행과 outbox 행이 둘 다 없음. `policy.test.ts`: 정책이 커서를 올림, 결함이면 그 이벤트에서 멈추고 다음 실행에서 재시도. `audit.test.ts`: 감사·열람 기록 표의 열 목록이 P7 허용 목록과 같음. 수동(`alchemy dev`): 시험용 정책이 alarm으로 커서를 올림 |
| 5 | **Identity & Access 판정과 암호.** 집계, PBKDF2(F5), TOTP(RFC 6238), access·refresh token, TOTP 비밀 값 암호화, 권한 표 | `apps/api/src/modules/identity/{staff.ts,permissions.ts,login-challenge.aggregate.ts,session.aggregate.ts}`, `apps/api/src/modules/identity/auth/{password.ts,totp.ts,access-token.ts,refresh-token.ts,secret-box.ts}` | `login-challenge.aggregate.test.ts`·`session.aggregate.test.ts`: spec 상태 표의 줄마다 given/when/then(코드 5회 실패 → `EXPIRED`, 원장 `:disable` → `TOTP_REQUIRED_FOR_ROLE` 등). `totp.test.ts`: RFC 6238 부록 B 벡터, 앞뒤 한 구간 허용, 쓴 구간 거부. `password.test.ts`: 반복 횟수가 해시 문자열에 들어가고 다른 횟수의 해시도 검증됨. `permissions.test.ts`: identity-access.md 표와 같음 |
| 6 | **Identity & Access HTTP.** 엔드포인트 6개, 권한 선언 강제, 보안 기록, 잠금, 시드 직원 4명 | `apps/api/src/modules/identity/{identity-repository.ts,identity.migrations.ts,seed.ts}`, `apps/api/src/modules/identity/auth/{auth.api.ts,auth.http.ts,auth.ts,authentication.ts,authorization.ts,security-log.ts,testing.ts}`, `apps/api/src/api.ts`, `docs/design/identity-access.md`(바뀐 것이 있으면) | `auth.http.test.ts`: 로그인 → `TOTP_ENROLL` → 코드 → 세션 → `/me` 흐름. 오류 코드 9개 각각 한 번 이상. 비밀번호 5회 실패 → 423, 실패가 트랜잭션 밖이라 남음. refresh 회전, 10초 유예 안 재사용은 통과, 밖이면 세션 폐기. 없는 아이디와 틀린 비밀번호가 같은 코드. `authorization.test.ts`: 권한 선언이 빠진 엔드포인트가 있으면 앱 구성이 실패. `security-log.test.ts`: 비밀번호·코드·토큰 값이 행에 없음 |
| 7 | **Chart.** 환자 목록·검색·상세, 열람 기록, 결정적 시드, `ChartSystem` 읽기 메서드 | `apps/api/src/modules/chart/{patient.ts,patient-repository.ts,patient-search.ts,chart.migrations.ts,patients.api.ts,patients.http.ts,seed.ts,chart.public.ts}`, `apps/api/src/api.ts` | `patient-search.test.ts`: 이름 부분 일치, 초성, 차트번호, 전화 뒤 4자리. `patients.http.test.ts`: 목록은 전화 뒤 4자리만, 커서 페이지, 상세는 열람 기록 한 행, 없는 id → `PATIENT_NOT_FOUND`, `patient:read` 없음 → 403. `seed.test.ts`: 같은 시드 값이면 같은 결과, 약 200명, 전부 `synthetic: true`, 전화가 `010-0000-` 대역, 주민등록번호 형식(`\d{6}-\d{7}`) 문자열이 어떤 열에도 없음 |
| 8 | **AI 포트.** `LlmProvider`·`SttProvider`·`EmbeddingProvider`, `fake`, `openai-compatible`, `withFallback`, `guardPhi` | `apps/api/src/ai/{ports.ts,errors.ts,with-fallback.ts,guard-phi.ts}`, `apps/api/src/ai/adapters/{fake.ts,openai-compatible.ts}` | `with-fallback.test.ts`: 앞 실패·시간 초과 → 다음, 전부 실패 → 사과 문구 오류, 전환 사유 로그(`TestClock`으로 시간 초과). `guard-phi.test.ts`: `LOCAL_ONLY` + CLOUD → `PHI_POLICY_VIOLATION`, `VIRTUAL_DATA_ONLY` + `synthetic: false` → 막음, `synthetic: true` → 통과. `openai-compatible.test.ts`: Node HTTP 서버를 띄워 요청 형태와 응답 해석 |
| 9 | **OpenAPI 저장본.** hemr처럼 생성 스크립트와 비교 테스트 | `scripts/openapi.ts`, `apps/api/src/openapi.ts`, `apps/api/src/openapi.test.ts`, `docs/reference/openapi.json`(`pnpm openapi`로만 생성) | `openapi.test.ts`: 생성 결과와 저장본이 다르면 실패. 엔드포인트 9개가 모두 있음 |
| 10 | **웹.** 로그인 → TOTP(등록이면 QR) → 환자 목록·검색. `HttpApiClient`로 `api.ts`를 그대로 씀. 열린 질문 1의 답에 따름(답이 없으면 shadcn/ui) | `apps/web/src/{main.tsx,api-client.ts,auth/*,routes/*,patients/*}`, `apps/web/components.json`(shadcn을 고르면) | `apps/web/src/auth/session.test.ts`: access token 만료 시 refresh 한 번 후 재시도, refresh 실패면 로그인 화면. 화면 동작은 아래 "검증"에서 사람이 봄 |
| 11 | **개인 단계 배포와 README.** `alchemy deploy`(stage `$USER`) 한 번. 배포 환경에서 FTS5, PBKDF2 CPU 시간 측정 → F5 반복 횟수 확정. 열린 질문 2의 답이 필요 | `README.md`(실행 방법, 시드 계정, 원장 TOTP 비밀 값), `apps/api/src/modules/identity/auth/password.ts`(반복 횟수), `docs/features/00-foundation/spike.md`(측정 결과) | 배포 URL에서 `GET /v1/health` 200, 로그인 → 환자 목록. 측정 값을 spike.md에 기록 |

`main` 브랜치 보호는 작업 1 병합 직후 저장소 주인이 켠다(에이전트가 바꾸지 않음).

### 이 plan에서 정한 것

- **시드는 표가 비어 있을 때 마이그레이션 직후에 넣는다.** 모든 단계(로컬·개인·`demo`)가 가상 데이터로만 돌기 때문에 단계별로 나누지 않는다. 로컬에서 다시 넣으려면 `pnpm dev:reset`(로컬 DO 데이터 디렉터리를 지우고 다시 띄움). 잠금 해제도 이것으로 한다(spec: 0단계 잠금 해제 API 없음)
- **`shared/decision`을 옮긴다.** spec의 공유 인프라 목록에는 없지만 작업 5의 given/when/then 테스트가 hemr의 이 도우미를 쓴다
- **후크는 의존성 없는 `.mjs`로 쓴다.** `pnpm install` 전에도 돌아야 한다
- **architecture.md 9절 0단계 완료 기준을 F2에 맞게 고쳤다**("메모리·SQLite 둘 다" → 인메모리 SQLite). 이 PR에 들어 있다

## 검증

`pnpm verify` 외에 사람이 볼 것:

1. `pnpm dev`(`alchemy dev`) → 브라우저에서 `director`로 로그인 → README의 TOTP 비밀 값으로 등록한 인증 앱 코드 입력 → 환자 목록이 보이고 "김"·"ㄱㅁ"·전화 뒤 4자리로 검색됨
2. `desk`로 첫 로그인 → QR이 나옴 → 등록 후 들어감 → 로그아웃 → 다시 로그인하면 QR 없이 코드만 물음
3. 비밀번호를 5번 틀리면 잠김 메시지가 나옴 → `pnpm dev:reset`으로 풀림
4. 10분 넘게 둔 뒤 목록을 새로 고쳐도 로그아웃되지 않음(refresh)
5. 개인 단계 배포 URL에서 1번 반복

## 위험

| 위험 | 깨지는 것 | 대응 |
|---|---|---|
| `SqliteMigrator`가 DO에서 동작하지 않음(작업 2) | 작업 4~7의 표 생성 | `blockConcurrencyWhile` 안에서 마이그레이션 SQL을 직접 실행하는 작은 실행기를 쓴다. F3 개정이므로 `spec.r2.md`로 묻는다 |
| 중첩 트랜잭션이 DO에서 안쪽만 되돌리지 않음(작업 2) | hemr `Transaction`·정책 실행기 | 정책 실행기가 이벤트마다 바깥 트랜잭션을 따로 연다. 개정 필요 여부를 묻는다 |
| 정적 파일과 DO 라우팅을 한 Worker에서 못 함(작업 2) | F6 같은 출처, refresh 쿠키 `SameSite=Strict` | Worker가 웹 Worker로 서비스 바인딩해 넘긴다(출처는 그대로). 그것도 안 되면 F6 개정 |
| PBKDF2가 무료 요금제 CPU 한도를 넘음(작업 11) | 로그인 응답이 실패 | 반복 횟수를 낮추고 spike.md에 기록(F5에 이미 적힌 대응). 반복 횟수가 해시에 저장되므로 나중에 올릴 수 있음 |
| `effect` 4.1.4와 hemr 코드(4.1.2) 사이 API 차이 | 작업 3·4 복사 | 차이를 출처 주석 옆에 적는다. 작업 단위가 PR이라 되돌리기 쉬움 |
| Claude 리뷰 워크플로 인증이 없음(열린 질문 3) | 작업 1의 리뷰 워크플로가 실패 | 비밀 값이 없으면 잡을 건너뛰게(`if: secrets…` 대신 첫 단계에서 확인 후 종료) 만들어 CI를 막지 않는다 |

되돌리기: 작업마다 PR 하나라 squash 커밋 하나를 revert한다. 배포는 `alchemy destroy --stage $USER`.

## 회고 (병합 뒤 작성)
- 계획 밖에서 고친 파일:
- 리뷰 막음 수:
- CLAUDE.md에 더한 줄:
- spec 승인 뒤 다시 고친 요구사항:
