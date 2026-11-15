# Identity & Access

직원 계정, 역할·권한, 로그인 + TOTP 2단계 인증, 세션, 보안 기록을 맡는다. hemr [identity-access.md](../../../hemr/docs/design/identity-access.md)의 세션 설계(짧은 access token + 회전하는 refresh token, 재사용 감지, 잠금)를 따르고, 테넌트를 빼고 TOTP를 더했다.

## 용어

| 업무 용어 | 영문 | 설명 |
|---|---|---|
| 직원 | `Staff` (`stf_`) | 로그인하는 사람. 이름, 역할, 이모지 |
| 역할 | `StaffRole` | `DIRECTOR`(원장), `MANAGER`(실장), `HYGIENIST`(위생사), `DESK`(데스크) |
| 권한 | `Permission` | `resource:action`. 역할이 권한 묶음 프리셋 |
| 세션 | `Session` (`ses_`) | 로그인 한 번. refresh token 계열 하나 |
| 로그인 도전 | `LoginChallenge` (`chl_`) | 비밀번호를 맞힌 뒤 TOTP를 기다리는 상태. 5분 |
| 다음 단계 | `LoginNext` | `TOTP`(코드 입력), `TOTP_ENROLL`(등록 후 코드 입력), `DONE`(세션 발급) |
| 2단계 인증 | TOTP | RFC 6238, HMAC-SHA1, 30초, 6자리 |
| 보안 기록 | `SecurityEvent` | 로그인 성공·실패, 잠금, refresh 재사용, 로그아웃, TOTP 등록·해제 |

## 역할과 권한 (0단계)

| 권한 | DIRECTOR | MANAGER | HYGIENIST | DESK |
|---|:-:|:-:|:-:|:-:|
| `patient:read` | ✓ | ✓ | ✓ | ✓ |
| `staff:read` | ✓ | ✓ | | |
| `totp:disable_own` | | ✓ | ✓ | ✓ |

- 엔드포인트마다 필요한 권한을 선언하고, 선언이 없으면 서버가 뜨지 않는다(hemr와 같음)
- 권한은 토큰에 넣지 않고 요청마다 역할에서 계산한다
- 뒤 단계가 권한을 더할 때 이 표를 고친다

## 로그인

```
POST   /auth/sessions                  { loginId, password }
       → 200 { next: "TOTP", challengeToken, expiresIn }
       → 200 { next: "TOTP_ENROLL", challengeToken, expiresIn, otpauthUri }
POST   /auth/sessions:verify-totp      { challengeToken, code }
       → 200 { accessToken, expiresIn, staff }   Set-Cookie: dlude_refresh=…
POST   /auth/sessions:refresh          (쿠키) → 200 { accessToken, expiresIn }
DELETE /auth/sessions/current          → 204
GET    /me                             → { staff, permissions, totpEnrolled }
POST   /me/totp:disable                { code } → 204
```

- **모든 직원이 TOTP를 거친다.** 비밀번호만으로는 세션이 나오지 않는다. 등록하지 않은 직원은 `TOTP_ENROLL`로 비밀 값을 받고, 첫 코드를 맞히는 순간 등록과 세션 발급이 함께 된다
- **원장(`DIRECTOR`)은 TOTP를 끌 수 없다.** 다른 역할은 `:disable`로 끌 수 있고, 끈 직원은 다음 로그인에서 다시 `TOTP_ENROLL`을 받는다. "끈다"는 비밀 값을 지워 다시 등록하게 하는 것이고 2단계를 건너뛰게 하는 것이 아니다
  - 대안: 원장 외 역할은 TOTP 없이 로그인. 원작은 "관리자는 끌 수 없음"만 말했고, 진료실 공용 단말에서 비밀번호만으로 들어오는 경로를 남길 이유가 없어 버렸다
- 같은 30초 구간의 코드는 한 번만 받는다(마지막으로 받은 구간 번호를 저장). 앞뒤 한 구간까지 허용한다
- TOTP 비밀 값은 `DATA_KEY`로 AES-GCM 암호화해 저장한다
- 로그인 도전은 5분, 코드 5회 실패면 도전을 폐기한다. 비밀번호 실패 횟수와 따로 센다
- access token은 HS256 JWT(`sub` 직원, `sid` 세션, `exp`)이고 10분. 검증할 때 세션 폐기 여부를 본다
- refresh token은 256비트 난수, 저장은 SHA-256, 쿠키 `dlude_refresh`(`HttpOnly; Secure; SameSite=Strict; Path=/v1/auth`). 12시간, 회전, 10초 유예, 유예 밖 재사용이면 세션 폐기(hemr와 같음)
- 비밀번호 5회 연속 실패면 잠금(423). 0단계에는 잠금 해제 API가 없다. 시드를 다시 넣어 푼다
- 없는 아이디도 고정 해시로 검증해 응답 시간으로 존재 여부가 드러나지 않게 한다

## 오류 코드

| code | HTTP | 뜻 |
|---|---|---|
| `UNAUTHENTICATED` | 401 | access token이 없거나 만료·폐기됨 |
| `INVALID_CREDENTIALS` | 401 | 아이디 또는 비밀번호가 틀림. 어느 쪽인지 말하지 않음 |
| `ACCOUNT_LOCKED` | 423 | 비밀번호 5회 실패로 잠김 |
| `CHALLENGE_INVALID` | 401 | 로그인 도전이 없거나 만료·폐기됨. 처음부터 다시 로그인 |
| `TOTP_INVALID` | 401 | 코드가 틀리거나 이미 쓴 구간 |
| `TOTP_REQUIRED_FOR_ROLE` | 409 | 원장은 TOTP를 끌 수 없음 |
| `REFRESH_TOKEN_INVALID` | 401 | refresh 쿠키가 없거나 모름 |
| `REFRESH_TOKEN_REUSED` | 401 | 유예 밖 재사용. 세션을 폐기함 |
| `PERMISSION_DENIED` | 403 | 역할에 권한이 없음 |

## 보안 기록

hemr처럼 `security_events` 표에 남기고 업무 트랜잭션과 따로 쓴다(실패도 남아야 하므로). 기록하는 것: `LOGIN_SUCCEEDED`, `LOGIN_FAILED`(사유 `UNKNOWN_LOGIN_ID`·`PASSWORD_MISMATCH`·`LOCKED`), `ACCOUNT_LOCKED`, `TOTP_FAILED`, `TOTP_ENROLLED`, `TOTP_DISABLED`, `REFRESH_TOKEN_REUSED`, `LOGGED_OUT`. 비밀번호·코드·토큰 값은 남기지 않는다(P7).

## 시드 (개발·데모)

가상 직원 4명, 역할마다 한 명. 아이디는 `director`, `manager`, `hygienist`, `desk`이고 비밀번호는 `DEV_PASSWORD`(기본 `dlude-dev-password`). 원장 계정은 TOTP 비밀 값을 시드에 고정해 README에 적는다(데모에서 인증 앱에 등록). 나머지는 첫 로그인에서 등록한다. 모두 `synthetic: true`.
