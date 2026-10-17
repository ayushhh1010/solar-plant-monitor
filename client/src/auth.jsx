import { createContext, useContext, useEffect, useState } from 'react'
import { api } from './api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined) // undefined = still checking, null = signed out
  const [meta, setMeta] = useState(null)

  useEffect(() => {
    api('/auth/me').then(setUser, () => setUser(null))
    const signOut = () => setUser(null)
    window.addEventListener('session-expired', signOut)
    return () => window.removeEventListener('session-expired', signOut)
  }, [])

  useEffect(() => {
    if (user) api('/meta').then(setMeta)
  }, [user])

  const value = {
    user,
    meta,
    login: async (email, password) => setUser(await api('/auth/login', { method: 'POST', body: { email, password } })),
    logout: async () => {
      await api('/auth/logout', { method: 'POST' })
      setUser(null)
    },
    // Only hides controls; the API enforces the same permissions.
    can: permission => user?.permissions.includes(permission) ?? false,
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
