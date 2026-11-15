# 도메인 설계

컨텍스트마다 문서 하나를 둔다. 각 문서는 **용어 표**(업무 용어 ↔ 영문 키의 단일 출처), 리소스·커맨드, 상태 표, 오류 코드 표, 결정(대안·대가·되돌릴 조건)을 가진다. 동작을 바꾸면 같은 PR에서 이 문서를 고친다.

전체 구조는 [architecture.md](../architecture.md), 개발 절차는 [process.md](../process.md).

| 문서 | 내용 | 생긴 단계 |
|---|---|---|
| [conventions.md](conventions.md) | API·코드 규약. hemr 규약을 따르고 dlude만의 차이를 적음 | 0 |
| [identity-access.md](identity-access.md) | 직원 계정, 역할·권한, 로그인 + TOTP, 세션, 보안 기록 | 0 |
| [chart.md](chart.md) | InternalChart: 가상 환자·예약·치료계획, `ChartSystem` 포트 | 0 |
