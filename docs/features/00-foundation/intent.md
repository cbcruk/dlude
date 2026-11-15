---
status: approved
approved_on: 2026-11-15
---

# 0. 기반: intent

## 문제
dlude에는 설계 문서만 있고 코드·저장소·검증 장치가 없다. 이후 모든 기능(포털, 음성 차팅, 후속 관리…)이 같은 뼈대 위에 서야 하는데, 뼈대가 정해지지 않으면 기능마다 저장·이벤트·오류 처리를 따로 만들게 된다. 또 기술 스택(Alchemy v2 + Effect 4 + Durable Object SQLite)의 핵심 가정 몇 개가 확인되지 않았다([architecture.md 10절](../../architecture.md#10-결정이-필요한-열린-질문)).

## 원하는 결과
- `alchemy dev`로 띄워 가상 직원 계정으로 로그인(+TOTP)하면 가상 환자 목록이 보인다
- 저장소 테스트가 메모리 구현과 DO SQLite 구현 둘 다에서 통과한다
- AI 포트의 `fake` 어댑터 테스트가 통과한다(`withFallback`, `guardPhi` 포함)
- `docs/reference/openapi.json` 저장본 테스트가 돈다
- `pnpm verify` 하나로 검증되고, [process.md 5절](../../process.md#5-강제-장치)의 후크·CI가 켜져 있다

## 영향
- 새로 생김: git 저장소, `alchemy.run.ts`, `apps/api`(shared, identity-access, chart, ai), `apps/web`(로그인·환자 목록), `.claude/settings.json`, CI
- 사용자: 데모용 가상 직원 4역할(원장/실장/위생사/데스크)

## 제약
- 가상 데이터만. 시드 환자 약 200명
- semu·hemr의 `shared/` 설계를 따른다. 코드를 복사할지 공유 패키지로 뽑을지는 spec에서 정한다
- `demo` 단계 배포는 하지 않는다(개인 단계까지만)

## 가정
- Alchemy v2가 Effect 4와 같은 의존 그래프에서 동작한다 — **미확인. 가장 먼저 확인할 것**
- `effect/http-api` 핸들러를 Durable Object의 `fetch`에 붙일 수 있다 — 미확인
- DO SQLite가 FTS5를 지원한다 — 미확인(6단계 전까지만 확인하면 됨)
- semu `TableFactory`에 DO 구현을 더하는 것으로 저장 계층이 옮겨진다 — `transactionSync`가 동기 API라 Effect 저장소와 맞물리는 방식은 spec에서 정한다

## 열린 질문
1. 위 첫 두 가정이 틀리면: 스택 파일만 Alchemy의 Effect를 쓰고 앱은 따로 둘지, 아니면 런타임을 Node(semu·hemr 그대로) + Alchemy Docker 배포로 바꿀지
2. semu·hemr `shared/` 재사용: 복사 / 공유 패키지
3. GitHub 원격 저장소를 공개로 둘지 (포트폴리오 목적)
4. UI 컴포넌트 라이브러리 (shadcn/ui 권장)
