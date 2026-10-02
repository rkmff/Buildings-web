import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { AKZENT_VORSCHLAEGE, themeAnwenden } from '../theme'
import type { Theme } from '../types'

const MODI: { wert: Theme; label: string }[] = [
  { wert: 'hell', label: 'Hell' },
  { wert: 'dunkel', label: 'Dunkel' },
  { wert: 'system', label: 'Wie das Gerät' },
]

export default function Einstellungen() {
  const { user, einstellungenSpeichern } = useAuth()
  const [fehler, setFehler] = useState('')
  const timer = useRef<number | undefined>(undefined)
  if (!user) return null
  const e = user.einstellungen

  async function speichern(teil: Parameters<typeof einstellungenSpeichern>[0]) {
    setFehler('')
    try {
      await einstellungenSpeichern(teil)
    } catch (err) {
      setFehler((err as Error).message)
    }
  }

  function eigeneFarbe(farbe: string) {
    themeAnwenden({ theme: e.theme, akzentfarbe: farbe })
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => speichern({ akzentfarbe: farbe }), 400)
  }

  return (
    <div className="seite schmal">
      <h1 className="seitentitel">Einstellungen</h1>
      <p className="gedaempft">Diese Einstellungen gelten nur für dich und werden sofort gespeichert.</p>

      <section className="karte formular">
        <h2 className="abschnitt-titel">Darstellung</h2>
        <fieldset className="feld">
          <legend>Modus</legend>
          <div className="segment">
            {MODI.map((m) => (
              <button
                key={m.wert}
                type="button"
                className={e.theme === m.wert ? 'aktiv' : ''}
                aria-pressed={e.theme === m.wert}
                onClick={() => speichern({ theme: m.wert })}
              >
                {m.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="feld">
          <legend>Akzentfarbe</legend>
          <div className="farbwahl">
            {AKZENT_VORSCHLAEGE.map((f) => (
              <button
                key={f}
                type="button"
                className={`farbfeld${e.akzentfarbe === f ? ' aktiv' : ''}`}
                style={{ background: f }}
                aria-label={`Akzentfarbe ${f}`}
                aria-pressed={e.akzentfarbe === f}
                onClick={() => speichern({ akzentfarbe: f })}
              />
            ))}
            <label className="farbe-eigene">
              <input type="color" defaultValue={e.akzentfarbe} onChange={(ev) => eigeneFarbe(ev.target.value.toLowerCase())} />
              <span>Eigene Farbe</span>
            </label>
          </div>
        </fieldset>
      </section>

      <section className="karte formular">
        <h2 className="abschnitt-titel">Meine Seite</h2>
        <label className="feld">
          <span>Planung anzeigen für</span>
          <select value={e.planung_wochen} onChange={(ev) => speichern({ planung_wochen: Number(ev.target.value) })}>
            {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((w) => (
              <option key={w} value={w}>{w} {w === 1 ? 'Woche' : 'Wochen'}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="karte formular">
        <h2 className="abschnitt-titel">Konto</h2>
        <p>Angemeldet als <strong>{user.benutzername}</strong>.</p>
        <Link to="/passwort" className="knopf">Passwort ändern</Link>
      </section>
      {fehler && <p className="fehler" role="alert">{fehler}</p>}
    </div>
  )
}
