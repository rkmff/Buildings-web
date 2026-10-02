import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from './api'
import { themeAnwenden } from './theme'
import type { Einstellungen, User } from './types'

interface AuthState {
  user: User | null
  laden: boolean
  anmelden: (benutzername: string, passwort: string) => Promise<void>
  abmelden: () => Promise<void>
  setUser: (u: User) => void
  einstellungenSpeichern: (e: Partial<Einstellungen>) => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null)
  const [laden, setLaden] = useState(true)

  const setUser = useCallback((u: User) => {
    setUserState(u)
    themeAnwenden(u.einstellungen)
  }, [])

  useEffect(() => {
    api
      .get<{ user: User }>('/api/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUserState(null))
      .finally(() => setLaden(false))
    const onAbgemeldet = () => setUserState(null)
    window.addEventListener('buildings:abgemeldet', onAbgemeldet)
    return () => window.removeEventListener('buildings:abgemeldet', onAbgemeldet)
  }, [setUser])

  const anmelden = useCallback(
    async (benutzername: string, passwort: string) => {
      const r = await api.post<{ user: User }>('/api/auth/login', { benutzername, passwort })
      setUser(r.user)
    },
    [setUser],
  )

  const abmelden = useCallback(async () => {
    await api.post('/api/auth/logout')
    setUserState(null)
  }, [])

  const einstellungenSpeichern = useCallback(
    async (e: Partial<Einstellungen>) => {
      if (!user) return
      const vorschau = { ...user.einstellungen, ...e }
      themeAnwenden(vorschau)
      const r = await api.put<{ einstellungen: Einstellungen }>('/api/me/einstellungen', vorschau)
      setUser({ ...user, einstellungen: r.einstellungen })
    },
    [user, setUser],
  )

  return (
    <AuthContext.Provider value={{ user, laden, anmelden, abmelden, setUser, einstellungenSpeichern }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth außerhalb von AuthProvider')
  return ctx
}
