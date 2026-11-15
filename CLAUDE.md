# dlude

치과 AX 재구현(학습·포트폴리오). **가상 데이터로만 동작한다.** 전체 설계는 [docs/architecture.md](docs/architecture.md), 개발 절차는 [docs/process.md](docs/process.md).

## 작업 순서

- 기능은 `docs/features/<번호>-<이름>/`의 `intent.md → spec.md → plan.md` 순서로 진행한다. 앞 문서가 `status: approved`가 아니면 다음 단계로 가지 않는다
- `approved` 문서는 고치지 않는다. 바꿔야 하면 멈추고 묻거나 개정 초안(`spec.r2.md`)을 쓴다. 문서를 `approved`로 바꾸는 것은 사람뿐이다
- 구현은 승인된 `plan.md`대로 한다. plan에 없는 파일을 고쳐야 하면 먼저 말한다
- 버그 수정은 실패하는 테스트부터. 테스트를 통과시키려고 테스트를 고치지 않는다
- **`pnpm verify` 출력을 붙이기 전에는 완료라고 보고하지 않는다.** 실패하면 실패라고 쓴다

## 설계 규약 (semu·hemr를 따름)

- 판정은 `*.aggregate.ts`의 순수 함수 `decide…`. 서비스는 읽기 → 권한 → 판정 → 저장만. 판정 테스트는 저장소 없이 given/when/then
- 다른 컨텍스트 저장소를 직접 읽지 않는다. `<context>.public.ts` + `src/wiring/` 어댑터. 컨텍스트 간 영향은 outbox 정책
- 경로·필드·오류·멱등성·동시성은 hemr `docs/design/conventions.md`. dlude만의 차이는 `docs/design/conventions.md`에 적는다
- AI 출력은 모두 `AiDraft`를 거치고 `assumptions[]`를 가진다. CLOUD 어댑터에는 가상 데이터 표시가 있는 환자만 보낸다(P6)
- 감사 기록에 본문을 남기지 않는다(P7)
- 동작을 바꾸면 같은 PR에서 `docs/design/<context>.md`의 용어·상태·오류 코드 표를 고친다

## 언어

문서, 테스트 설명(`describe`·`it`), PR, 리뷰는 한국어. 식별자, HTTP 필드, 오류 코드, 이벤트 타입, 표·파일 이름은 영어. 한글 식별자는 규칙 계산 모듈의 내보내지 않는 이름에만.

## 하지 않는 것

- `demo` 단계 배포, main 푸시, `.env*`·`.alchemy/` 읽기
- `test/fixtures/rules/**`, `docs/reference/openapi.json` 손 편집 (`pnpm openapi`로만)
- 실제 환자·직원 정보처럼 보이는 데이터 생성

## 리뷰

[REVIEW.md](REVIEW.md) 기준. 지적마다 **막음** 또는 **후속**.
