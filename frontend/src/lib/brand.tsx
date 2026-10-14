import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './auth'
import { useToast } from '../components/Toast'

export type BrandId = 'robothink' | 'creative_iq'

interface BrandContextValue {
  activeBrand: BrandId
  saving: boolean
  setActiveBrand: (brand: BrandId) => Promise<void>
}

const BrandContext = createContext<BrandContextValue>({
  activeBrand: 'robothink',
  saving: false,
  setActiveBrand: async () => {},
})

export function useBrand() {
  return useContext(BrandContext)
}

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const { user, profile } = useAuth()
  const { notify } = useToast()
  const [activeBrand, setBrand] = useState<BrandId>('robothink')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (profile?.active_brand === 'robothink' || profile?.active_brand === 'creative_iq') {
      setBrand(profile.active_brand)
    } else if (!user) {
      setBrand('robothink')
    }
  }, [profile?.id, profile?.active_brand, user])

  async function setActiveBrand(brand: BrandId) {
    if (!profile || saving || brand === activeBrand) return
    setSaving(true)
    const { data, error } = await supabase
      .from('profiles')
      .update({ active_brand: brand })
      .eq('id', profile.id)
      .select('active_brand')
      .maybeSingle()
    setSaving(false)
    if (error || !data) {
      notify(error?.message ?? 'Could not change brand. Apply the brand separation database migration first.', 'error')
      return
    }
    setBrand(brand)
    notify('Switched to ' + (brand === 'robothink' ? 'RoboThink' : 'Creative IQ'), 'success')
  }

  return (
    <BrandContext.Provider value={{ activeBrand, saving, setActiveBrand }}>
      {children}
    </BrandContext.Provider>
  )
}
