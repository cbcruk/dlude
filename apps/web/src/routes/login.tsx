import { useState, type FormEvent } from 'react'
import type { DludeApi } from '@/api-client'
import { messageOf } from '@/auth/messages'
import { TotpQr } from '@/auth/totp-qr'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Step = { kind: 'password' } | { kind: 'totp'; challengeToken: string; otpauthUri?: string }

/** 로그인: 비밀번호 → TOTP(등록이 필요하면 QR). 끝나면 access token을 넘긴다. */
export function LoginRoute({ api, onSignedIn }: { api: DludeApi; onSignedIn: (accessToken: string) => void }) {
  const [step, setStep] = useState<Step>({ kind: 'password' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submitPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    const result = await api.login({ loginId: String(form.get('loginId')), password: String(form.get('password')) })
    setBusy(false)
    if (!result.ok) return setError(messageOf(result.code))
    setError(null)
    const { challengeToken, otpauthUri } = result.value
    setStep(otpauthUri === undefined ? { kind: 'totp', challengeToken } : { kind: 'totp', challengeToken, otpauthUri })
  }

  const submitCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (step.kind !== 'totp') return
    const code = String(new FormData(event.currentTarget).get('code')).replace(/\s/g, '')
    setBusy(true)
    const result = await api.verifyTotp({ challengeToken: step.challengeToken, code })
    setBusy(false)
    if (result.ok) return onSignedIn(result.value.accessToken)
    setError(messageOf(result.code))
    if (result.code === 'CHALLENGE_INVALID') setStep({ kind: 'password' })
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>dlude</CardTitle>
          <CardDescription>
            {step.kind === 'password'
              ? '가상 데이터로만 동작하는 데모입니다.'
              : step.otpauthUri === undefined
                ? '인증 앱의 6자리 코드를 넣어 주세요.'
                : '인증 앱으로 QR을 찍어 등록한 뒤, 앱에 나온 6자리 코드를 넣어 주세요.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error !== null && <Alert>{error}</Alert>}
          {step.kind === 'password' ? (
            <form className="flex flex-col gap-4" onSubmit={submitPassword}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="loginId">아이디</Label>
                <Input id="loginId" name="loginId" autoComplete="username" required autoFocus />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">비밀번호</Label>
                <Input id="password" name="password" type="password" autoComplete="current-password" required />
              </div>
              <Button type="submit" disabled={busy}>
                다음
              </Button>
            </form>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={submitCode}>
              {step.otpauthUri !== undefined && <TotpQr otpauthUri={step.otpauthUri} />}
              <div className="flex flex-col gap-2">
                <Label htmlFor="code">인증 코드</Label>
                <Input
                  id="code"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\s*(\d\s*){6}"
                  required
                  autoFocus
                />
              </div>
              <Button type="submit" disabled={busy}>
                로그인
              </Button>
              <Button type="button" variant="link" onClick={() => setStep({ kind: 'password' })}>
                처음으로
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
