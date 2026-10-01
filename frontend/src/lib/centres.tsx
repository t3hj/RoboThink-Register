import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './auth'
import type { Centre, StaffCentre } from '../types'

const SELECTED_CENTRE_KEY = 'robothink.selectedCentreId'

interface CentreContextValue {
  centres: Centre[]
  assignedCentres: Centre[]
  activeCentres: Centre[]
  selectedCentreId: string | null
  selectedCentre: Centre | null
  isAllCentres: boolean
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  setSelectedCentreId: (centreId: string | null) => void
}

const CentreContext = createContext<CentreContextValue | null>(null)

function readStoredCentreId() {
  return typeof window === 'undefined' ? null : window.localStorage.getItem(SELECTED_CENTRE_KEY)
}

export function CentreProvider({ children }: { children: React.ReactNode }) {
  const { profile, role } = useAuth()
  const [centres, setCentres] = useState<Centre[]>([])
  const [assignments, setAssignments] = useState<StaffCentre[]>([])
  const [selectedCentreId, setSelectedCentreIdState] = useState<string | null>(readStoredCentreId)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    if (!profile) {
      setCentres([])
      setAssignments([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const [centresRes, assignmentsRes] = await Promise.all([
      supabase.from('centres').select('*').order('name'),
      supabase.from('staff_centres').select('staff_id, centre_id, created_at').eq('staff_id', profile.id),
    ])
    if (centresRes.error || assignmentsRes.error) {
      setError(centresRes.error?.message ?? assignmentsRes.error?.message ?? 'Unable to load centre access')
      setCentres([])
      setAssignments([])
      setLoading(false)
      return
    }
    setCentres((centresRes.data ?? []) as Centre[])
    setAssignments((assignmentsRes.data ?? []) as StaffCentre[])
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
  }, [profile?.id])

  const assignedIds = useMemo(() => new Set(assignments.map((assignment) => assignment.centre_id)), [assignments])
  const assignedCentres = useMemo(() => centres.filter((centre) => assignedIds.has(centre.id)), [centres, assignedIds])
  const activeCentres = useMemo(() => centres.filter((centre) => centre.active), [centres])
  const selectableCentres = role === 'admin' ? activeCentres : assignedCentres.filter((centre) => centre.active)
  const isAllCentres = role === 'admin' && selectedCentreId === null

  useEffect(() => {
    if (loading || !profile) return
    const availableIds = new Set(selectableCentres.map((centre) => centre.id))
    if (role === 'admin') {
      if (selectedCentreId !== null && !availableIds.has(selectedCentreId)) setSelectedCentreIdState(null)
      return
    }
    if (selectableCentres.length === 0) {
      setSelectedCentreIdState(null)
    } else if (!selectedCentreId || !availableIds.has(selectedCentreId)) {
      setSelectedCentreIdState(selectableCentres[0].id)
    }
  }, [loading, profile, role, selectedCentreId, selectableCentres])

  function setSelectedCentreId(centreId: string | null) {
    const next = role === 'admin' ? centreId : selectableCentres.some((centre) => centre.id === centreId) ? centreId : selectedCentreId
    setSelectedCentreIdState(next)
    if (typeof window !== 'undefined') {
      if (next) window.localStorage.setItem(SELECTED_CENTRE_KEY, next)
      else window.localStorage.removeItem(SELECTED_CENTRE_KEY)
    }
  }

  const selectedCentre = centres.find((centre) => centre.id === selectedCentreId) ?? null

  return (
    <CentreContext.Provider
      value={{
        centres,
        assignedCentres,
        activeCentres,
        selectedCentreId,
        selectedCentre,
        isAllCentres,
        loading,
        error,
        refresh,
        setSelectedCentreId,
      }}
    >
      {children}
    </CentreContext.Provider>
  )
}

export function useCentres() {
  const context = useContext(CentreContext)
  if (!context) throw new Error('useCentres must be used within CentreProvider')
  return context
}