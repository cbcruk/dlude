import { useEffect, useState } from 'react'
import type { DludeApi } from '@/api-client'
import type { Session } from '@/auth/session'

export type PatientRow = Extract<Awaited<ReturnType<DludeApi['listPatients']>>, { ok: true }>['value']['items'][number]

/** 검색어가 바뀌면 250ms 뒤 첫 쪽을 다시 받고, `more`로 다음 쪽을 이어 붙인다. */
export function usePatientList(api: DludeApi, session: Session, q: string) {
  const [items, setItems] = useState<PatientRow[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    const timer = setTimeout(async () => {
      const result = await session.call(() => api.listPatients(q.trim() === '' ? {} : { q: q.trim() }))
      if (!alive) return
      setLoading(false)
      if (!result.ok) return setError(result.code)
      setError(null)
      setItems([...result.value.items])
      setCursor(result.value.nextCursor)
    }, 250)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [api, session, q])

  const more = async () => {
    if (cursor === null) return
    setLoading(true)
    const query = q.trim() === '' ? { cursor } : { q: q.trim(), cursor }
    const result = await session.call(() => api.listPatients(query))
    setLoading(false)
    if (!result.ok) return setError(result.code)
    setItems((previous) => [...previous, ...result.value.items])
    setCursor(result.value.nextCursor)
  }

  return { items, hasMore: cursor !== null, more, error, loading }
}
