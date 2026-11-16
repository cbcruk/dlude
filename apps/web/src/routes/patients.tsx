import { useEffect, useState } from 'react'
import type { DludeApi } from '@/api-client'
import { messageOf } from '@/auth/messages'
import type { Session } from '@/auth/session'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PatientTable } from '@/patients/patient-table'
import { usePatientList } from '@/patients/use-patient-list'

/** 환자 목록·검색. 이름, 초성("ㄱㅁ"), 차트번호, 전화 뒤 4자리로 찾는다. */
export function PatientsRoute({ api, session }: { api: DludeApi; session: Session }) {
  const [q, setQ] = useState('')
  const [staff, setStaff] = useState<{ name: string; emoji: string } | null>(null)
  const list = usePatientList(api, session, q)

  useEffect(() => {
    void session.call(api.me).then((result) => result.ok && setStaff(result.value.staff))
  }, [api, session])

  const logout = async () => {
    await api.logout()
    session.signOut()
  }

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">환자</h1>
        <div className="flex items-center gap-2 text-sm">
          {staff !== null && (
            <span>
              {staff.emoji} {staff.name}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={logout}>
            로그아웃
          </Button>
        </div>
      </header>
      <Input
        type="search"
        placeholder="이름, 초성(ㄱㅁ), 차트번호, 전화 뒤 4자리"
        value={q}
        onChange={(event) => setQ(event.target.value)}
        aria-label="환자 검색"
      />
      {list.error !== null && <Alert>{messageOf(list.error)}</Alert>}
      <PatientTable items={list.items} />
      {!list.loading && list.items.length === 0 && list.error === null && (
        <p className="text-muted-foreground text-center text-sm">찾은 환자가 없습니다.</p>
      )}
      {list.hasMore && (
        <Button variant="outline" onClick={list.more} disabled={list.loading}>
          더 보기
        </Button>
      )}
      <p className="text-muted-foreground text-center text-xs">모든 환자는 가상 데이터입니다.</p>
    </main>
  )
}
