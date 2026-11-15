# 치과 AX 재구현: 전체 골격 설계

> 참고 출처: dentaldev.tistory.com 1~4편 (한 치과 원장의 AX 전환기).
> 목적: 학습·포트폴리오. **실제 환자 데이터 없이 가상 데이터로만 동작**한다.
> 설계 출처: 같은 작성자의 [semu](../../semu)(세무·인사·급여·경리 백엔드)와 [hemr](../../hemr)(한의원 EMR 백엔드). 두 저장소의 도메인 모델·API 규약·이벤트 전달 방식을 가져온다(2절).

## 1. 원작에서 가져오는 설계 원칙

원작의 성과 수치는 작성자가 직접 잰 값이라 검증할 수 없다. 이 프로젝트가 가져오는 것은 설계 원칙이다.
아래 원칙은 권고가 아니라 **코드로 강제하는 불변식**으로 다룬다.

| # | 원칙 | 코드에서의 형태 |
|---|---|---|
| P1 | **진료는 사람이, 기록은 AI가.** AI 출력은 무조건 초안 | `AiDraft` 애그리거트. `DRAFT → REVIEWED → COMMITTED`(또는 `REJECTED`). 전이는 `decideAiDraft…` 순수 함수가 판정하고, 차트 반영 커맨드 `POST /ai-drafts/{id}:commit`은 `REVIEWED`만 받는다. 반영된 노트는 정정 이력에 `source: AI_ASSISTED`로 남는다(hemr `:apply`) |
| P2 | **추측은 따로 표시** | 모든 AI 결과 Schema에 `assumptions: string[]` 필수. 비어 있지 않으면 응답 `warnings`에 `AI_ASSUMPTIONS_PRESENT`를 넣고 UI가 강조 |
| P3 | **숫자는 코드가 계산, AI는 해석만** | 지표는 Effect에 의존하지 않는 규칙 파일의 순수 함수로 계산해 야간 Cron이 스냅샷 저장. LLM 프롬프트에는 계산된 값만 넣고 `[추정]` 태그 규칙을 적용 |
| P4 | **두 모델이 엇갈리면 사람이 본다** | `crossValidate(a, b)`: 일치하면 자동 확정, 불일치하면 `review` 컨텍스트에 `ReviewItem`을 만듦. 사람 판정은 정답지(`Label`)로 쌓는다 |
| P5 | **실패를 성공처럼 말하지 않기** | 실패는 Effect의 타입 있는 오류 채널(`Effect<A, E>`)로 흐르고, HTTP에서는 RFC 9457 Problem Details로 나간다. 응답 템플릿은 성공 타입에서만 "완료" 문구를 만든다 |
| P6 | **데이터는 병원 밖으로 나가지 않는다** | AI 어댑터에 `locality: 'LOCAL' \| 'CLOUD'` 표시. `PHI_POLICY=LOCAL_ONLY`이면 `guardPhi`가 CLOUD 어댑터 호출을 오류로 막음. 저장은 병원마다 Durable Object 하나(3.2절) |
| P7 | **감사 로그에는 개인정보를 남기지 않음** | 감사 기록은 `actor, action, resourceType, resourceId, at`과 before/after **해시**만 남기고 본문은 남기지 않음. 커맨드와 같은 트랜잭션에 쓴다(semu 일관성 규칙 4) |
| P8 | **폴백 체인** | 주 모델 → 예비 1 → 예비 2 → 정해진 사과 문구. `Effect.timeout` + `Effect.orElse`로 엮고 전환 사유를 로그와 `ai_call` 기록에 남김 |

## 2. semu·hemr에서 가져오는 설계

두 저장소는 같은 뼈대(Effect 4, `effect/http-api`, SQLite, 모듈러 모놀리스, outbox)를 쓴다. 이 프로젝트는 그 뼈대와 규약을 그대로 따르고, 문서를 다시 쓰지 않고 원본을 가리킨다.

| 가져오는 것 | 내용 | 원본 |
|---|---|---|
| 모듈러 모놀리스 | 바운디드 컨텍스트 하나 = `src/modules/<context>/` 폴더 하나. 다른 컨텍스트 저장소를 직접 읽지 않고, 포트 + `<context>.public.ts` + `src/wiring/<consumer>-<provider>.ts` 어댑터로 잇는다 | semu `conventions.md#코드-구조` |
| 커맨드·애그리거트·이벤트·뷰·정책 | 판정은 `*.aggregate.ts`의 순수 함수 `decide…`가 하고 다음 상태와 이벤트를 돌려준다. 서비스는 읽기 → 권한 → 판정 → 저장만 한다. 판정 테스트는 저장소 없이 given/when/then | semu·hemr `domain-model.md` |
| 일관성 규칙 | 커맨드 하나는 일관성 경계 하나. 두 애그리거트에 걸친 불변식이 있을 때만 묶고, 나머지 영향은 정책으로 전한다. 받는 쪽이 거부해도 보낸 쪽을 되돌리지 않는다 | semu `domain-model.md#일관성-규칙` |
| outbox + 정책 커서 | 상태 변경과 이벤트를 한 트랜잭션에 쓰고, 정책마다 `seq` 커서로 outbox를 읽는다. 정책의 쓰기와 커서 올리기는 한 트랜잭션. 결함이면 그 이벤트에서 멈춘다 | hemr `events.md#정책과-사가`, semu M2 |
| API 규약 | `/v1`, kebab-case 복수형 리소스, 커맨드 `POST /{resource}/{id}:{command}`, 접두사 ULID ID(`pat_`, `drf_`), camelCase 키, `SCREAMING_SNAKE_CASE` enum, 커서 페이지네이션, 상세 응답의 `allowedActions`·`warnings` | hemr `conventions.md` |
| 오류·멱등성·동시성 | Problem Details + `code`, 400 `VALIDATION_FAILED`에 위반 전부, 돈·외부 발송 POST는 `Idempotency-Key`, 수정 가능한 리소스는 `version` + `ETag`/`If-Match`(412) | hemr `conventions.md` |
| 비동기 작업 | 전사·요약·CSV 가져오기처럼 오래 걸리는 일은 `Job`(`QUEUED → RUNNING → SUCCEEDED/FAILED…`), 끝나면 `job.completed` 이벤트 | hemr `conventions.md#비동기-작업`, semu M7 |
| 실시간 | 서버→단말 알림만 실시간 채널로, 단말→서버는 일반 HTTP 커맨드. 1회용 티켓으로 연결, `since=<seq>`로 유실 보정 | hemr `events.md#단말-실시간` |
| 개인정보 | 목록·상세에는 마스킹 값만, 원문은 `X-Access-Reason` 헤더를 받는 별도 엔드포인트. 열람 기록도 같은 트랜잭션 | hemr `compliance.md`, semu `personal-data` |
| 규칙 모듈과 픽스처 | 계산 규칙은 Effect 없는 파일 + `test/fixtures/rules/` 입력·출력 케이스. 내보내지 않는 이름은 한글 식별자 허용 | hemr `conventions.md#코드의-용어` |
| 문서 규약 | 컨텍스트마다 `docs/design/<context>.md`에 **용어 표**(번역의 단일 출처), 상태 표, 오류 코드 표, "정함" 항목. 결정은 대안·대가·되돌릴 조건과 함께 `docs/design/review.md` 표에 | 두 저장소 공통 |
| OpenAPI | 손으로 쓰지 않고 HTTP 계약에서 만들어 `docs/reference/openapi.json`으로 저장, 테스트가 저장본과 비교 | hemr `conventions.md#api-문서` |

가져오지 않는 것:

- **역공학 근거 체계**(`docs/reference/spec/`, 현행 대비 매핑). 이 프로젝트에는 분석할 현행 시스템이 없고, 근거는 원작 블로그 글이다
- **Node 프로세스 전제**(`node:sqlite` 파일, 프로세스 안 1초 릴레이 워커). Cloudflare 런타임에 맞게 바꾼다(3.2절)
- **멀티 테넌트 권한 모델 전체**(hemr 병원 전환, semu 세무 대리인). 병원 하나 = Durable Object 하나라 테넌트 경계가 저장소 경계와 같다

### 컨텍스트 대응

| dlude 컨텍스트 | 참고할 곳 |
|---|---|
| identity-access, staff | semu `identity-access.md`·`hr.md`·`payroll.md`, hemr `identity-access.md` |
| consent | hemr `documents.md`(서식·전자서명), semu `documents.md` |
| clinical-notes | hemr `clinical.md#ai-차팅`, `#진료-encounter`(판·정정·고정) |
| chart(InternalChart) | hemr `patients.md`·`front-desk.md`(내원 상태 전이) |
| recall | hemr `crm.md`(연락 자동화, 야간 발송 제한) |
| finance | semu `bookkeeping.md`(입출금·대조) |
| knowledge | semu `assistant.md`(비서는 제안만, 쓰기는 확인 후 일반 API로) |

## 3. 기술 스택

### 3.1 선택

| 영역 | 선택 | 이유 |
|---|---|---|
| 인프라·배포 | **[Alchemy](https://alchemy.run) v2** (`alchemy`, `@alchemy.run/cloudflare`) | TypeScript·Effect로 쓴 IaC. 리소스 정의(`alchemy.run.ts`)와 Worker 코드가 같은 Effect 프로그램이라 서버 코드와 한 언어·한 타입 체계. `alchemy dev`가 workerd로 로컬 실행 |
| 런타임 | Cloudflare Workers + Durable Objects | 병원 하나 = Durable Object 하나(3.2절) |
| 서버 프레임워크 | **Effect 4 + `effect/http-api`** | semu·hemr와 같음. HTTP 계약 하나에서 핸들러·클라이언트·OpenAPI를 만든다. Hono를 대체 |
| 검증·스키마 | **Effect Schema** | API, AI 구조화 출력, 폼 검증에 같은 Schema 사용. Zod를 대체 |
| 저장 | Durable Object 내장 SQLite + `effect/sql` (`@effect/sql-sqlite-do`, 테스트는 `@effect/sql-sqlite-node`) | 단일 작성자라 "요청 하나 = 트랜잭션 하나"와 "읽은 사실이 판정과 저장 사이에 바뀌지 않음"(semu M3)이 그대로 성립(스파이크에서 동시 요청 50개로 확인). 저장 계층은 hemr `shared/db`(마이그레이션 + `Transaction`)를 옮긴다([F1](features/00-foundation/spec.md#결정)). Drizzle 대신 |
| 파일 | R2 | 녹음, 동의서·급여명세서 PDF. 업로드는 서명된 URL(hemr `audioUploadId` 방식) |
| 정기 작업 | Worker Cron Trigger → 병원 DO | 야간 지표 스냅샷, 아침 후속 관리 목록 |
| outbox 릴레이·정책 | DO alarm | 커밋 직후 alarm을 걸어 정책을 돌린다. 프로세스 안 1초 루프를 대체 |
| 실시간 | 병원 DO의 WebSocket(Hibernation API) | 진료실 호출, 메신저, `job.completed`. 단말→서버는 HTTP 커맨드. hemr의 티켓·`since` 규약을 따른다 |
| 웹 | **React + Vite + TanStack Router/Query**, `Cloudflare.Website.Vite`로 배포 | API 클라이언트는 `HttpApiClient`로 같은 계약에서 만든다(`hc` 대체) |
| PDF | pdf-lib | Workers에서 동작 |
| 검색 | DO SQLite FTS5 + 벡터는 DO 안 브루트포스 코사인 | 위키 수백 쪽 규모라 충분. Vectorize는 로컬 에뮬레이션이 없어 MVP에서 뺀다 |
| 테스트 | Vitest. 저장소 테스트는 메모리 구현과 SQLite에 같은 케이스(semu·hemr 방식), AI는 `fake` 어댑터 | 통합 테스트는 `@alchemy.run/test`로 로컬 workerd에 띄운다 |

### 3.2 병원 하나 = Durable Object 하나

```
브라우저 ──HTTP──▶ Worker(api) ──인증·라우팅──▶ ClinicDO("clinic-demo")
                                                ├─ SQLite: 모든 컨텍스트의 표 + outbox + policy_cursor + audit_log
                                                ├─ alarm: outbox 정책 실행
                                                └─ WebSocket: 단말 알림
          Cron ──▶ Worker(scheduler) ─────────▶ ClinicDO:runDaily
          R2(recordings, documents)   Workers AI / 외부 LLM (CLOUD 어댑터)
```

- **왜 D1이 아닌가:** D1은 대화형 트랜잭션(`BEGIN … 읽기 … 판정 … COMMIT`)이 없고 `batch`만 있다. semu·hemr의 서비스 흐름(읽기 → 판정 → 저장을 한 트랜잭션)을 그대로 옮기려면 단일 작성자 SQLite가 필요하다. 대가: 병원 간 집계(여러 병원 대시보드)는 DO마다 물어 모아야 한다. 학습 범위에서는 병원 하나라 문제없다
- **되돌릴 조건:** 한 병원의 요청이 DO 하나의 처리량을 넘거나, 병원 간 조회가 필수 기능이 되면 컨텍스트 단위로 DO를 나누거나 D1 + 낙관적 잠금으로 옮긴다
- 인증을 포함한 모든 HTTP 핸들러는 DO 안에서 돈다. Worker는 경로만 나눈다(`/v1/*` → DO, 그 밖 → 웹 정적 파일, [F4·F6](features/00-foundation/spec.md#결정))

### 3.3 Alchemy 스택

```ts
// alchemy.run.ts (개략. 정확한 리소스 이름은 0단계에서 확인)
export default Alchemy.Stack(
  "dlude",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const files = yield* Cloudflare.R2.Bucket("Files")
    const api = yield* ApiWorker            // apps/api/src/worker.ts: Worker + ClinicDO + Cron
    const web = yield* Cloudflare.Website.Vite("Web", { /* apps/web */ })
    return { api: api.url, web: web.url }
  }),
)
```

- 단계(stage)는 개인 개발(`$USER`), PR 미리보기, `demo` 셋. 비밀 값(`AUTH_SECRET`, `PATIENT_DATA_KEY`, 외부 LLM 키)은 Alchemy 비밀로 넘긴다
- `alchemy dev`에서는 R2·DO·Cron이 로컬 시뮬레이터로 돈다

## 4. 저장소 구조

semu·hemr처럼 앱 안의 모듈러 모놀리스로 둔다. 모듈을 패키지로 쪼개지 않는다(경계는 `public.ts`·`wiring/`과 리뷰로 지킨다).

```
dlude/
├─ alchemy.run.ts
├─ apps/
│  ├─ api/
│  │  ├─ src/
│  │  │  ├─ api.ts              # 모든 *.api.ts를 모은 HTTP 계약 (web이 import)
│  │  │  ├─ worker.ts           # Worker 진입점: 인증·DO 라우팅·Cron
│  │  │  ├─ clinic-do.ts        # ClinicDO: HttpApi 핸들러, alarm, WebSocket
│  │  │  ├─ modules/
│  │  │  │  ├─ identity-access/ # 로그인·TOTP·역할·권한
│  │  │  │  ├─ staff/           # A. 근태·스케줄·만료일 대장 (급여는 나중)
│  │  │  │  ├─ messenger/       # B. 채널·진료실 호출
│  │  │  │  ├─ consent/         # C. 전자 동의서
│  │  │  │  ├─ clinical-notes/  # D. 녹음·전사·요약 초안·차팅 도우미
│  │  │  │  ├─ recall/          # E. 후속 관리·대기자
│  │  │  │  ├─ finance/         # F. 가져오기·대조·스냅샷
│  │  │  │  ├─ knowledge/       # G. 위키·검색·질의
│  │  │  │  ├─ chart/           # InternalChart: 환자·예약·치료계획·시술 코드
│  │  │  │  └─ review/          # 사람 판정 큐·블라인드 A/B·정답지
│  │  │  ├─ ai/                 # AI 포트·어댑터·조합기 (5절)
│  │  │  ├─ wiring/             # <consumer>-<provider>.ts 어댑터
│  │  │  └─ shared/             # ids, problem, http(paging·etag·idempotency), db(마이그레이션·Transaction),
│  │  │                         # events(outbox·policy), jobs, audit, personal-data, time, money
│  │  └─ test/fixtures/rules/
│  └─ web/                      # React SPA (포털·메신저·상담·동의서·원장 대시보드)
└─ docs/
   ├─ architecture.md           # 이 문서
   └─ design/                   # README, conventions(→ hemr 링크 + 차이만), domain-model, events, <context>.md, review.md
```

- `audit`은 컨텍스트가 아니라 공유 인프라다(`shared/audit`). 커맨드와 같은 트랜잭션에 쓴다
- `chart`는 다른 컨텍스트와 똑같은 모듈이고, 바깥에는 `chart.public.ts`(`ChartSystem` 포트, 6절)로만 보인다
- 컨텍스트 간 연동은 outbox 정책이다. 예: `chart`의 `appointment.canceled` → `recall`의 정책 `matchWaitlistOnCancel` → 대기자 매칭 → `messenger`에 프런트 알림 커맨드

## 5. 모듈별 범위

각 모듈에 대해 원작 기능 중 **MVP에 넣을 것**과 **나중으로 미룰 것**을 나눈다.

### A. staff (사내 포털 기반)
- MVP: 직원 계정·역할(원장/실장/위생사/데스크), 로그인 + TOTP 2단계 인증(관리자는 끌 수 없음), 출퇴근 기록(NFC 대신 웹 버튼), 근무시간 계산(규칙 모듈), 주간 스케줄(지난주 복사), **만료일 대장**(90일 전 노랑, 30일 전 빨강, 지나면 회색. 뷰가 읽을 때 계산)
- 나중: 급여 계산(주휴·연장 수당. semu `payroll` 규칙 참고), 급여명세서 PDF와 열람 확인, 실제 NFC 리더

### B. messenger
- MVP: 채널 채팅, **진료실 호출 버튼 4종**(`NEXT_PATIENT`/`CALL_DOCTOR`/`FRONT_DESK`/`EMERGENCY`)과 응답 3종(`ACK`/`ON_MY_WAY`/`HOLD`), 미응답 호출 에스컬레이션(DO alarm)
- 나중: TTS 원내 방송, 아침 브리핑 자동 게시, 데스크톱 앱

### C. consent (전자 동의서)
- MVP: 템플릿(한·영 병기) → 직원 설명·서명 → `:handOver`("환자에게 전달") → 환자 서명(캔버스) → PDF 생성(R2) → `ChartSystem.attachDocument`
- 나중: 펜 그림(색·굵기) 첨부, 상담 녹음 연결

### D. clinical-notes (AI가 가장 많이 쓰이는 모듈)
- MVP:
  1. 녹음 업로드(서명 URL) → `Job` → `Stt.transcribe(diarize)` → 화자별 전사
  2. `Llm.structured(NoteSummary)` → `{ visitReason, patientRequest, findings, treatment, nextPlan, assumptions[] }`, 한·영 병기 → `AiDraft(DRAFT)`
  3. **검토 화면**: 원문 전사와 요약을 나란히 보여 주고, assumptions를 강조하고, `:review`("검토 확인")를 거쳐야 `:commit`이 허용됨(`allowedActions`로 드러남)
  4. 차팅 도우미: 시술 코드 → 노트 초안 (같은 Draft 흐름)
  5. 요약 프롬프트를 화면에서 편집하고 버전 관리(`AiDraft`에 `promptVersion` 기록)
- 나중: 브라우저 실시간 받아쓰기, 사진·엑스레이·STL 뷰어

### E. recall (후속 관리·대기자)
- MVP: 매일 아침 목록 생성(Cron. 치료계획은 있는데 미예약 / 리콜 기한 경과 / 연간 보험 한도 잔여), 우선순위 점수(가중치를 설정할 수 있는 규칙 모듈 + 픽스처), 문자 초안("가장 급한 것 하나" 전략), **취소 이벤트 → 대기자 매칭 → 프런트 알림**(정책)
- 나중: 예약 확인 문자 회신("1"/"YES") 자동 확정, 실제 SMS 발송(`Idempotency-Key`)과 **발송 실패 모니터링**(원작의 노쇼 증가 원인을 교훈으로 반영. hemr `crm.md`의 야간 발송 제한도 참고)

### F. finance
- MVP: CSV 가져오기(`Job`. 은행·카드·보험 입금), **자동 대조 엔진**(금액·날짜 허용 오차·상대방 규칙. 규칙 모듈), 매칭되지 않은 건 목록, 사람이 확정한 규칙 기억, 계정과목 추천(LLM, assumptions 포함), 일일 수납 스냅샷
- 나중: 영수증 메일 파싱, 구매 품목 단가 5% 초과 상승 경고(비율은 ppm 정수), 월간 리포트(두 모델 교차)

### G. knowledge
- MVP: 위키(마크다운, 메타데이터: 요약/분야/수정일/확인일/출처) + "말로 고치기" → diff → 승인 후 저장(같은 Draft 흐름), 하이브리드 검색(FTS5 + 벡터 + RRF + 선택적 리랭커), 답변에 근거 표기, 위키에 없으면 "위키에 없음". 질의 응답은 semu 비서처럼 **제안만** 하고 쓰기는 사용자가 일반 API로 실행
- 나중: 한국어 형태소 토크나이저, 질의를 필터로 자동 변환, 매일 시험 질문으로 자동 채점, 90일 미확인 알림

### review (공통)
- 사람 판정 큐: 숫자키 단축키로 분류, 모델 결과가 엇갈린 건을 먼저 표시
- 블라인드 A/B: 모델 이름을 가리고 `FIRST_BETTER / SECOND_BETTER / TIE / BOTH_WRONG`
- 판정 결과를 `Label`로 쌓아 모델별 정확도를 집계(뷰)

### H. 전화 (범위 밖, 추후 검토)
FreePBX, SIP 트렁크, 음성봇은 하드웨어와 통신사 계약이 필요해 학습용 범위를 넘는다.
대신 **음성봇의 "안전장치 계층"만 텍스트 시뮬레이터로 구현**하는 방안을 고려한다.
원작의 시험 기준은 확인 없이 예약 실행 0건, 불필요한 직원 연결 0건이었다.

## 6. AI 추상화 (apps/api/src/ai)

포트는 Effect 서비스(`Context.Service`)로 두고, 어댑터는 Layer로 바꿔 끼운다.

```ts
// 포트
interface LlmProvider {
  readonly id: string; readonly locality: 'LOCAL' | 'CLOUD'
  chat(req: ChatRequest): Effect<ChatResponse, LlmError>
  structured<A>(req: ChatRequest, schema: Schema<A>): Effect<A, LlmError | SchemaMismatch>
}
interface SttProvider { transcribe(audio, { diarize, language }): Effect<Transcript, SttError> }
interface EmbeddingProvider { embed(texts: string[]): Effect<number[][], EmbeddingError> }
interface RerankProvider { rerank(query, docs): Effect<number[], RerankError> }

// 조합기 (원칙을 코드로 표현)
withFallback([primary, backup1, backup2], { timeout })   // P8
crossValidate(llmA, llmB, schema, equals)                 // P4 → AGREE | DISAGREE
guardPhi(provider, policy)                                // P6
```

| 어댑터 | 대상 | locality | 비고 |
|---|---|---|---|
| `openai-compatible` | Ollama, vLLM, LM Studio, llama.cpp server | LOCAL | `alchemy dev`(로컬 workerd)에서 기본값. 배포된 Worker에서는 터널 없이는 닿지 않는다 |
| `workers-ai` | Cloudflare Workers AI (LLM, Whisper, 임베딩, 리랭커) | CLOUD | 배포 데모 기본값. 가상 데이터에만 사용 |
| `anthropic` | Claude API | CLOUD | 개발·비교용. 가상 데이터에만 사용 |
| `whisper-http` | faster-whisper / whisper.cpp 서버 | LOCAL | 화자 분리는 pyannote 등 외부 서비스 (선택) |
| `fake` | 테스트 | LOCAL | 미리 정한 응답을 돌려주고 지연·실패를 주입할 수 있음 |

설정은 `AI_LLM_PRIMARY=ollama:qwen3:14b` 같은 형식으로 지정한다. 배포 단계는 `PHI_POLICY=VIRTUAL_DATA_ONLY`로 두고 시드 표시가 없는 환자 데이터는 CLOUD로 보내지 않는다.

## 7. 차트(EMR) 추상화 (modules/chart)

원작은 어떤 EMR을 쓰는지, 어떻게 연동했는지 공개하지 않았다. 실제 덴트웹/하나로 연동은 이 프로젝트 범위 밖이다.

```ts
// chart.public.ts
interface ChartSystem {
  findPatients(q): Effect<Page<Patient>>
  getAppointments(range): Effect<Appointment[]>
  getTreatmentPlans(patientId): Effect<TreatmentPlan[]>
  appendNote(patientId, note: ReviewedNote): Effect<void, ChartError>  // ReviewedNote는 REVIEWED 초안에서만 만들 수 있는 브랜드 타입 (P1)
  attachDocument(patientId, fileRef): Effect<void, ChartError>
}
// 예약 변경 알림은 콜백이 아니라 outbox 이벤트(appointment.*)로 낸다
```

- `InternalChart`는 같은 DO SQLite에 미니 EMR 표(환자/예약/치료계획/시술 코드)를 두고 시드로 가상 환자 약 200명을 만든다. 예약 상태 전이는 hemr 내원 전이표를 참고한다
- 실제 EMR을 붙인다면 `wiring/`의 어댑터 하나만 바꾸면 된다

## 8. 핵심 데이터 모델 (요약)

표 이름은 `<context>_<collection>`(semu 규칙). ID는 접두사 ULID.

```
identity_staff(stf_: name, role, totp_secret_enc, emoji)
staff_attendance(att_: staff_id, clock_in, clock_out)
staff_credential_expiry(cex_: owner, kind, expires_on, note)         # 면허·허가·보험·교육
messenger_channel / messenger_message / messenger_page_call(pgc_: room, kind, status, responded_by, responded_at)
consent_template / consent_consent(cns_: patient_id, template_id, staff_sig, patient_sig, file_ref, status, version)
notes_recording(rec_: patient_id, file_ref, transcript_json)
notes_ai_draft(drf_: kind, source_id, model_id, prompt_version, output_json, assumptions_json,
               status[DRAFT|REVIEWED|COMMITTED|REJECTED], reviewed_by, reviewed_at, version)
review_item(rvi_: kind, payload_json, model_a, model_b, out_a, out_b, agreed) / review_label(lbl_: item_id, verdict, labeler, at)
recall_candidate(rcl_: patient_id, reason, score, generated_on, status)
finance_bank_tx / finance_ledger_entry / finance_match(mat_: tx_id, entry_id, rule_id, confirmed_by)
knowledge_page(wik_: slug, title, summary, area, body_md, verified_on, source) + knowledge_revision
knowledge_search_doc(source_type, source_id, chunk, embedding_blob, meta_json) + FTS5
metric_snapshot(date, key, value)                                   # P3: 야간 계산값
--- 공유 인프라 ---
outbox(seq, id, type, payload_json, created_at) / policy_cursor(policy, seq)
job(job_: kind, status, progress, result_json, error_json)
idempotency_key(key, request_hash, response_json, expires_at)
audit_log(actor, action, resource_type, resource_id, before_hash, after_hash, at)  # P7: 본문 없음
personal_data_access(actor, resource, reason, at)
--- InternalChart ---
chart_patient(pat_) / chart_appointment(apt_) / chart_treatment_plan(tpl_) / chart_procedure_code
```

## 9. 로드맵

단계 하나가 기능 폴더 하나(`docs/features/<번호>-<이름>/`)이고, `intent → spec → plan → PR` 게이트를 거친다([process.md](process.md)). 아래 "완료 기준"은 각 intent의 "원하는 결과"가 된다.

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| **0. 기반** | git·CI·후크·`pnpm verify`([process.md 5절](process.md#5-강제-장치)), Alchemy 스택(Worker + ClinicDO + R2 + Vite 웹), Effect HttpApi 뼈대, semu·hemr `shared/`(ids·problem·http·events·jobs·audit)를 DO SQLite 위로 옮김, 로그인 + TOTP, InternalChart + 가상 데이터 시드, `ai` 포트(openai-compatible + fake) | `alchemy dev`로 로그인하면 가상 환자 목록이 보임. 저장소 테스트가 인메모리 SQLite로 통과([F2](features/00-foundation/spec.md#결정)). ai fake 테스트 통과. `openapi.json` 저장본 테스트 |
| **1. 포털 + 메신저** | A(MVP), B(MVP), DO WebSocket | 두 브라우저에서 진료실 호출을 보내고 받음, 만료일 색상 표시 |
| **2. 음성 차팅** | D(MVP), review 큐 | 샘플 음성 → 전사 → 요약 초안 → `:review` 없이는 `:commit`이 409 (판정 테스트로 보장) |
| **3. 후속 관리** | E(MVP), outbox 정책 | 예약 취소 → 대기자 알림까지 통합 테스트(`@alchemy.run/test`) |
| **4. 동의서** | C(MVP) | 태블릿 크기 화면에서 서명 → PDF가 차트에 첨부됨 |
| **5. 재무** | F(MVP), metric_snapshot Cron | 샘플 CSV 대조율 표시, 미매칭 건 확정 시 규칙 저장 |
| **6. 지식** | G(MVP), crossValidate 적용 | 시험 질문 세트 자동 채점 스크립트 |
| 이후 | 음성봇 안전장치 시뮬레이터, 원장 대시보드(자동 처리한 일 / 사람이 볼 일), 데모 단계 배포 | |

## 10. 결정이 필요한 열린 질문

- ~~Alchemy v2와 Effect 버전 맞춤, DO에서 `effect/http-api`, DO SQLite FTS5·트랜잭션~~ → **확인함** ([스파이크](features/00-foundation/spike.md)). Alchemy 2.0.0-beta.87은 `effect ^4.1.4`를 요구하므로 semu·hemr의 `4.1.2`보다 올린다. 트랜잭션은 `@effect/sql-sqlite-do`의 `withTransaction`(내부 `storage.transaction()`)을 쓴다. 남은 것: 배포 환경 FTS5, DO 저장 용량 한도
- **배포된 데모에서 P6를 어떻게 보일지:** 로컬 모델을 Cloudflare Tunnel로 붙일지, 배포 데모는 가상 데이터 + CLOUD 어댑터로만 둘지
- **semu·hemr 코드 재사용 방식:** `shared/`를 복사해 시작할지, 세 저장소가 함께 쓰는 패키지로 뽑을지 (뽑으면 저장 계층을 Node SQLite·DO SQLite 둘 다 받게 일반화해야 함)
- 화자 분리를 쓸지, 쓴다면 어떤 서비스로 할지 (로컬 pyannote는 Python 사이드카가 필요함)
- UI 컴포넌트 라이브러리 (shadcn/ui 권장)
