import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import Icon from '../components/Icon'

export default function Login() {
  const { anmelden } = useAuth()
  const [benutzername, setBenutzername] = useState('')
  const [passwort, setPasswort] = useState('')
  const [fehler, setFehler] = useState('')
  const [sendet, setSendet] = useState(false)

  async function absenden(e: FormEvent) {
    e.preventDefault()
    setFehler('')
    setSendet(true)
    try {
      await anmelden(benutzername, passwort)
    } catch (err) {
      setFehler((err as Error).message)
    } finally {
      setSendet(false)
    }
  }

  return (
    <div className="login-seite">
      <form className="login-karte" onSubmit={absenden}>
        <span className="marke gross"><Icon name="logo" size={30} className="marke-icon" /> Buildings</span>
        <p className="gedaempft">Bitte melde dich mit deinem Benutzernamen an.</p>
        <label className="feld">
          <span>Benutzername</span>
          <input autoFocus autoComplete="username" value={benutzername} onChange={(e) => setBenutzername(e.target.value)} />
        </label>
        <label className="feld">
          <span>Passwort</span>
          <input type="password" autoComplete="current-password" value={passwort} onChange={(e) => setPasswort(e.target.value)} />
        </label>
        {fehler && <p className="fehler" role="alert">{fehler}</p>}
        <button type="submit" className="knopf primaer breit" disabled={sendet || !benutzername || !passwort}>
          {sendet ? 'Anmelden …' : 'Anmelden'}
        </button>
      </form>
    </div>
  )
}
