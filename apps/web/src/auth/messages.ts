/** 서버 오류 코드를 화면 문구로. 모르는 코드는 일반 문구. */
export function messageOf(code: string): string {
  switch (code) {
    case 'INVALID_CREDENTIALS':
      return '아이디 또는 비밀번호가 맞지 않습니다.'
    case 'ACCOUNT_LOCKED':
      return '비밀번호를 5번 틀려 계정이 잠겼습니다. 로컬 개발이면 pnpm dev:reset으로 풉니다.'
    case 'CHALLENGE_INVALID':
      return '로그인 시간이 지났습니다. 처음부터 다시 로그인해 주세요.'
    case 'TOTP_INVALID':
      return '인증 코드가 맞지 않습니다. 앱의 새 코드를 넣어 주세요.'
    case 'VALIDATION_FAILED':
      return '입력한 값을 다시 확인해 주세요.'
    case 'NETWORK':
      return '서버에 연결하지 못했습니다.'
    default:
      return '요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.'
  }
}
