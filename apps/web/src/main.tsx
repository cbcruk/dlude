import { StrictMode, useEffect, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { createApi } from './api-client.ts'
import { createSession } from './auth/session.ts'
import './index.css'
import { LoginRoute } from './routes/login.tsx'
import { PatientsRoute } from './routes/patients.tsx'

// access token은 세션이 갖고, API 클라이언트는 매 요청에 세션의 토큰을 붙인다
let readToken: () => string | null = () => null
const api = createApi(() => readToken())
const session = createSession({ refresh: api.refresh })
readToken = () => session.token

function App() {
  const state = useSyncExternalStore(session.subscribe, () => session.state)
  useEffect(() => {
    if (session.state === 'unknown') void session.restore()
  }, [])
  switch (state) {
    case 'unknown':
      return <p className="text-muted-foreground p-4 text-sm">불러오는 중…</p>
    case 'signedOut':
      return <LoginRoute api={api} onSignedIn={session.signIn} />
    case 'signedIn':
      return <PatientsRoute api={api} session={session} />
  }
}

const root = document.getElementById('root')
if (root === null) throw new Error('#root가 없다')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
