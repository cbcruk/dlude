# 규약

**기본은 hemr [`docs/design/conventions.md`](../../../hemr/docs/design/conventions.md)를 그대로 따른다.** 경로, 필드와 값, 응답 형태, 페이지네이션, 오류(RFC 9457), 커맨드, 멱등성, 동시성, 비동기 작업, 코드의 용어, API 문서 규칙이 모두 해당한다. 이 문서는 dlude가 **다르게 하는 것**만 적는다.

## 다른 점

| 항목 | hemr | dlude | 이유 |
|---|---|---|---|
| 테넌트 | 병원 여럿, 토큰에 `tid`, 병원 전환 | 병원 하나 = Durable Object 하나. 토큰과 표에 테넌트 열이 없음 | 저장소 경계가 곧 테넌트 경계 ([architecture.md 3.2](../architecture.md#32-병원-하나--durable-object-하나)) |
| 런타임 | Node 프로세스, `@effect/sql-sqlite-node` | Durable Object, `@effect/sql-sqlite-do`. 테스트만 `@effect/sql-sqlite-node` | Cloudflare 배포 |
| 저장소 구현 | 메모리 구현 + SQL 구현, 같은 케이스를 둘 다에 | **SQL 구현 하나.** 테스트는 인메모리 SQLite | [F2](../features/00-foundation/spec.md#결정) |
| outbox 릴레이·정책 | 프로세스 안 1초 루프 | 커밋 뒤 DO alarm을 걸고, alarm이 정책을 돌림 | 상주 프로세스가 없음 |
| 비밀번호 해시 | Node `scrypt` | WebCrypto PBKDF2-SHA256 | workerd와 Node 둘 다에서 같은 코드 ([F5](../features/00-foundation/spec.md#결정)) |
| 오류 type URN | `urn:hemr:problem:<code>` | `urn:dlude:problem:<code>` | |
| 가상 데이터 표시 | 없음 | 환자·직원 레코드에 `synthetic: true`. CLOUD AI 어댑터는 이 표시가 있는 데이터만 받음 | P6 |
| 감사 기록 | `before/after 해시`, `ip`, `device` | `actor, action, resourceType, resourceId, at, beforeHash, afterHash`. 본문 없음 | P7 |

## ID 접두사

hemr `ids.ts`의 방식(접두사 + ULID)을 쓴다. 0단계에서 쓰는 것:

| 종류 | 접두사 |
|---|---|
| 직원 | `stf` |
| 세션 | `ses` |
| 로그인 도전 | `chl` |
| 환자 | `pat` |
| 예약 | `apt` |
| 치료계획 | `tpl` |
| 이벤트 | `evt` |
| 작업 | `job` |

새 접두사는 그 컨텍스트 문서의 용어 표에 먼저 올린다.
