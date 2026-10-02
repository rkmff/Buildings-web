import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import type { User } from '../types'

export default function PasswortAendern({ erzwungen = false }: { erzwungen?: boolean }) {
  const { setUser, abmelden } = useAuth()
  const [alt, setAlt] = useState('')
  const [neu, setNeu] = useState('')
  const [wiederholung, setWiederholung] = useState('')
  const [meldung, setMeldung] = useState<{ text: string; ok: boolean } | null>(null)

  async function absenden(e: FormEvent) {
    e.preventDefault()
    if (neu !== wiederholung) {
      setMeldung({ text: 'Die beiden neuen Passwörter stimmen nicht überein.', ok: false })
      return
    }
    try {
      const r = await api.post<{ user: User }>('/api/auth/passwort', { alt, neu })
      setUser(r.user)
      setAlt('')
      setNeu('')
      setWiederholung('')
      setMeldung({ text: 'Das Passwort wurde geändert.', ok: true })
    } catch (err) {
      setMeldung({ text: (err as Error).message, ok: false })
    }
  }

  const formular = (
    <form className={erzwungen ? 'login-karte' : 'karte formular'} onSubmit={absenden}>
      <h1 className={erzwungen ? 'titel-klein' : 'seitentitel'}>Passwort ändern</h1>
      {erzwungen && <p className="gedaempft">Bitte vergib vor dem ersten Arbeiten ein eigenes Passwort.</p>}
      <label className="feld">
        <span>Bisheriges Passwort</span>
        <input type="password" autoComplete="current-password" value={alt} onChange={(e) => setAlt(e.target.value)} />
      </label>
      <label className="feld">
        <span>Neues Passwort (mindestens 8 Zeichen)</span>
        <input type="password" autoComplete="new-password" value={neu} onChange={(e) => setNeu(e.target.value)} />
      </label>
      <label className="feld">
        <span>Neues Passwort wiederholen</span>
        <input type="password" autoComplete="new-password" value={wiederholung} onChange={(e) => setWiederholung(e.target.value)} />
      </label>
      {meldung && <p className={meldung.ok ? 'erfolg' : 'fehler'} role="status">{meldung.text}</p>}
      <div className="knopf-reihe">
        {erzwungen && <button type="button" className="knopf" onClick={() => abmelden()}>Abmelden</button>}
        <button type="submit" className="knopf primaer" disabled={!alt || !neu}>Speichern</button>
      </div>
    </form>
  )

  return erzwungen ? <div className="login-seite">{formular}</div> : <div className="seite schmal">{formular}</div>
}
