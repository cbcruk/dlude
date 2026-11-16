# Chart (InternalChart)

실제 EMR 대신 쓰는 미니 EMR이다. 가상 환자·예약·치료계획·시술 코드를 갖고, 다른 컨텍스트에는 `ChartSystem` 포트([architecture.md 7절](../architecture.md#7-차트emr-추상화-moduleschart))로만 보인다. 예약 상태 전이는 hemr [front-desk.md](../../../hemr/docs/design/front-desk.md)의 내원 전이표를 참고해 3단계(후속 관리)에서 정한다.

## 용어

| 업무 용어 | 영문 | 설명 |
|---|---|---|
| 환자 | `Patient` (`pat_`) | 이름, 차트번호, 생년월일, 성별, 전화번호, `synthetic`. 목록(`PatientSummary`)에는 전화번호를 뒤 4자리만 |
| 차트번호 | `chartNumber` | 병원 안에서 유일한 숫자 문자열 |
| 가상 데이터 표시 | `synthetic` | 시드가 만든 레코드면 `true`. CLOUD AI 어댑터는 `true`인 환자만 받음(P6) |
| 예약 | `Appointment` (`apt_`) | 0단계는 시드만. 상태·커맨드는 3단계 |
| 치료계획 | `TreatmentPlan` (`tpl_`) | 0단계는 시드만 |
| 시술 코드 | `ProcedureCode` | 참조 데이터. 가상의 코드와 이름 |

## 0단계 엔드포인트

```
GET /patients?q=&limit=&cursor=     → { items: [PatientSummary], nextCursor }
GET /patients/{patientId}           → Patient
```

- `q`는 이름 부분 일치, 초성, 차트번호, 전화번호 뒤 4자리(hemr 검색과 같음)
  - 숫자 4자리면 전화번호 뒤 4자리이거나 차트번호 앞부분, 그 밖의 숫자(`-` 허용)는 차트번호 앞부분, 초성만이면 이름 초성 부분 일치, 그 밖은 이름 부분 일치(대소문자 무시)
  - 정렬은 이름, ID. 커서는 앞 쪽의 마지막 환자 ID이고, 모르는 커서는 400 `VALIDATION_FAILED`(`cursor`). `limit`은 1–200, 기본 50
- 없는 `patientId`는 형식이 틀려도 404 `PATIENT_NOT_FOUND`(존재 여부만 알리고 형식 오류로 나누지 않음)
- 권한은 `patient:read`
- **주민등록번호를 두지 않는다.** 생년월일만 둔다. 학습 범위에서 주민등록번호가 필요한 기능이 없고, 없으면 지킬 것도 없다
- 상세 조회(`GET /patients/{id}`)는 hemr `AccessLog`로 열람 기록을 남긴다. 목록은 남기지 않는다
  - 대안: 목록도 기록. 직원이 하루에 수백 번 보는 화면이라 기록이 의미를 잃어 버렸다. 되돌릴 조건: 목록에 연락처 전체가 나가게 되면 기록한다

## 오류 코드

| code | HTTP | 뜻 |
|---|---|---|
| `PATIENT_NOT_FOUND` | 404 | 없는 환자 |

## 시드

가상 환자 약 200명. 이름은 흔한 성 + 이름 조합에서 결정적 난수로 만들고, 전화번호는 `010-0000-xxxx`처럼 실제로 쓰이지 않는 대역을 쓴다. 각 환자에 지난 1년 예약 0~6건과 치료계획 0~2건을 붙인다. 시드는 `synthetic: true`이고, 같은 시드 값이면 같은 데이터가 나와 테스트가 기댈 수 있다.

- 시드 값은 `CHART_SEED`로 고정한다. 예약·치료계획 날짜만 시드를 넣는 날(병원 날짜)을 기준으로 지난 1년에 놓는다
- 차트번호는 `10001`부터 차례로, 전화번호 뒤 4자리는 환자마다 다르다
- 시술 코드는 가상의 `V-` 코드 8개(정기 검진, 스케일링, 파노라마 촬영, 레진 충전, 신경치료, 크라운, 발치, 임플란트)

## 표

`chart_patients`(검색용 `name_folded`·`name_initials`·`phone_digits` 포함), `chart_procedure_codes`, `chart_appointments`, `chart_treatment_plans`. 마이그레이션은 `0003_chart`.

## ChartSystem (0단계)

`findPatients`, `getPatient`, `getAppointments({from, to})`, `getTreatmentPlans(patientId)`. 구현은 같은 DO SQLite를 읽는 `ChartSystem.internal` 하나다. 포트는 열람 기록을 남기지 않고, 사람이 환자를 여는 HTTP 상세 조회가 남긴다.
