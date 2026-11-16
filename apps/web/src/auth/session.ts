/** API 호출 결과. 실패는 서버 오류 코드(`UNAUTHENTICATED` 등)나 `NETWORK`·`UNEXPECTED`. */
export type ApiResult<A> = { ok: true; value: A } | { ok: false; code: string }

export type SessionState = 'unknown' | 'signedIn' | 'signedOut'

export interface SessionDeps {
  /** refresh 쿠키로 새 access token을 받는다. */
  refresh(): Promise<ApiResult<{ accessToken: string }>>
}

/**
 * 브라우저의 로그인 상태. access token은 메모리에만 두고(새로 고치면 refresh 쿠키로 다시 받음), refresh token은
 * 서버가 `HttpOnly` 쿠키로 다룬다.
 *
 * `call`은 401 `UNAUTHENTICATED`(access token 만료)면 refresh를 한 번 하고 다시 부른다. 동시에 여러 요청이
 * 만료되어도 refresh는 한 번만 한다(서버의 회전 유예에 기대지 않음). refresh가 실패하면 로그아웃 상태가 된다.
 */
export function createSession(deps: SessionDeps) {
  let accessToken: string | null = null
  let state: SessionState = 'unknown'
  let refreshing: Promise<boolean> | null = null
  const listeners = new Set<() => void>()

  const set = (token: string | null, next: SessionState) => {
    accessToken = token
    if (state !== next) {
      state = next
      listeners.forEach((listener) => listener())
    }
  }

  const refreshOnce = (): Promise<boolean> => {
    refreshing ??= deps
      .refresh()
      .then((result) => {
        if (result.ok) set(result.value.accessToken, 'signedIn')
        else set(null, 'signedOut')
        return result.ok
      })
      .finally(() => {
        refreshing = null
      })
    return refreshing
  }

  return {
    get token() {
      return accessToken
    },
    get state() {
      return state
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    signIn(token: string) {
      set(token, 'signedIn')
    },
    signOut() {
      set(null, 'signedOut')
    },
    /** 처음 열 때 refresh 쿠키로 로그인 상태를 되살린다. */
    restore: refreshOnce,
    async call<A>(request: (token: string | null) => Promise<ApiResult<A>>): Promise<ApiResult<A>> {
      const first = await request(accessToken)
      if (first.ok || first.code !== 'UNAUTHENTICATED') return first
      if (!(await refreshOnce())) return first
      return request(accessToken)
    },
  }
}

export type Session = ReturnType<typeof createSession>
