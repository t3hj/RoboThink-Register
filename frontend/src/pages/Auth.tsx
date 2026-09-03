import React, { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function Auth(){
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')

  const signIn = async (e:any)=>{
    e.preventDefault()
    setMessage('Sending sign-in link...')
    const { error } = await supabase.auth.signInWithOtp({ email })
    if(error) setMessage('Error: '+error.message)
    else setMessage('Check your email for the sign-in link (magic link).')
  }

  return (
    <div className="max-w-md mx-auto mt-20 card p-6 bg-white shadow rounded">
      <h2 className="text-xl font-semibold mb-2">Sign in to RoboThink</h2>
      <p className="text-sm text-slate-600 mb-4">Use your instructor email.</p>
      <form onSubmit={signIn} className="space-y-3">
        <input className="w-full p-2 border rounded" placeholder="you@company.com" value={email} onChange={e=>setEmail(e.target.value)} />
        <div className="flex justify-end">
          <button className="px-3 py-2 bg-teal-600 text-white rounded">Send sign-in link</button>
        </div>
      </form>
      {message && <p className="mt-3 text-sm">{message}</p>}
    </div>
  )
}
