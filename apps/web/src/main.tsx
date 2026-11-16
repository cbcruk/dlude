import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

// 작업 2의 뼈대: 같은 출처의 /v1/health를 불러 API까지 이어졌는지 보여 준다. 로그인 화면은 작업 10.
function App() {
  const [status, setStatus] = useState('확인 중')
  useEffect(() => {
    fetch('/v1/health')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body: { status: string }) => setStatus(body.status))
      .catch((e: unknown) => setStatus(`실패: ${String(e)}`))
  }, [])
  return (
    <main>
      <h1>dlude</h1>
      <p>API: {status}</p>
    </main>
  )
}

const root = document.getElementById('root')
if (root === null) throw new Error('#root가 없다')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
