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
