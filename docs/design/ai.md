# AI 포트

모든 AI 호출은 이 포트를 거친다([architecture.md 6절](../architecture.md#6-ai-추상화-appsapisrcai)). 0단계는 포트, 조합기 두 개(`withFallback`, `guardPhi`), 어댑터 두 개(`fake`, `openai-compatible`)만 있고 HTTP 엔드포인트는 없다. `AiDraft`는 2단계, `crossValidate`는 6단계.

## 용어

| 업무 용어 | 영문 | 설명 |
|---|---|---|
| 공급자 | `LlmProvider` / `SttProvider` / `EmbeddingProvider` | 어댑터가 만드는 값. `id`, `locality`, 호출 메서드 |
| 위치 | `locality` | `LOCAL`(병원 안) 또는 `CLOUD`(밖의 서비스) |
| 데이터 주인 | `DataSubject` | 요청에 담긴 환자·직원과 `synthetic` 여부. 모든 요청의 필수 필드 `subjects`이고, 개인 데이터가 없으면 빈 배열 |
| 환자 정보 정책 | `PhiPolicy` | `LOCAL_ONLY` 또는 `VIRTUAL_DATA_ONLY` |
| 폴백 체인 | `withFallback` | 앞 공급자가 실패·시간 초과면 다음으로(P8) |

앱은 조합한 공급자를 `Llm`·`Stt`·`Embedding` 서비스로 받는다.

## 정책 (P6)

| 정책 | LOCAL 공급자 | CLOUD 공급자 |
|---|---|---|
| `LOCAL_ONLY` | 통과 | 늘 막음 |
| `VIRTUAL_DATA_ONLY` | 통과 | `subjects`가 모두 `synthetic: true`일 때만 통과 |

- 막으면 공급자를 부르지 않는다. `guardPhi`는 공급자마다 감싼다: `withFallback([guardPhi(cloud, policy), local], …)`. 막힌 CLOUD는 폴백 체인에서 실패로 보고 다음으로 넘어간다
- 폴백 체인의 위치는 하나라도 CLOUD면 CLOUD다

## 폴백

- 공급자마다 `timeout`을 준다. 넘으면 그 호출을 끊고 `TIMEOUT`
- 넘어갈 때마다 경고 로그 `ai provider failed { provider, reason, next }`. 요청·응답 본문은 남기지 않는다(P7)
- 모두 실패하면 `AiUnavailable`. `message`는 사용자에게 보이는 사과 문구, `attempts`는 공급자별 사유

## 오류

HTTP 엔드포인트가 아직 없어 Problem 코드가 아니라 Effect 오류다. 엔드포인트가 생기면 이 표에 HTTP 상태를 더한다.

| 오류 | 사유 | 뜻 |
|---|---|---|
| `ProviderFailed` | `UNAVAILABLE` | 연결 실패, 5xx |
| | `RATE_LIMITED` | 429 |
| | `TIMEOUT` | 폴백 체인의 시간 제한을 넘김 |
| | `BAD_RESPONSE` | 4xx, JSON 아님, 기대한 필드 없음 |
| `SchemaMismatch` | | 구조화 응답이 스키마와 맞지 않음 |
| `PhiPolicyViolation` | `PHI_POLICY_VIOLATION` | 정책이 이 공급자로 보내는 것을 막음 |
| `AiUnavailable` | | 폴백 체인 전부 실패 |

## 어댑터

| 어댑터 | 위치 | 메서드 | 비고 |
|---|---|---|---|
| `fake` | 기본 LOCAL | LLM·STT·임베딩 | 정한 응답, 지연(Effect 시계), 실패 주입. 받은 요청을 `calls`에 쌓음 |
| `openai-compatible` | 기본 LOCAL | LLM·임베딩 | `/chat/completions`, `/embeddings`. 구조화 응답은 `response_format: json_schema`로 요청하고, 코드 블록으로 감싼 JSON도 받음 |
