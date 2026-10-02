import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'
import Icon from './Icon'

const NAV = [
  { to: '/', label: 'Meine Seite', icon: 'home', end: true },
  { to: '/objekte', label: 'Kunden & Anlagen', icon: 'gebaeude' },
  { to: '/auftraege', label: 'Aufträge', icon: 'auftrag' },
  { to: '/wartung', label: 'Wartung', icon: 'wartung' },
  { to: '/wartungsvorlagen', label: 'Wartungsvorlagen', icon: 'liste' },
  { to: '/wochenplanung', label: 'Wochenplanung', icon: 'kalender' },
  { to: '/mitarbeiter', label: 'Mitarbeiter', icon: 'team' },
  { to: '/ausruestung', label: 'Ausrüstung', icon: 'werkzeug' },
  { to: '/berichte', label: 'Berichte', icon: 'bericht' },
  { to: '/stammdaten', label: 'Stammdaten', icon: 'stammdaten' },
]

const ROLLEN: Record<string, string> = { admin: 'Administrator', dispatcher: 'Dispatcher', mitarbeiter: 'Techniker' }

export default function Layout() {
  const { user, abmelden } = useAuth()
  const [offen, setOffen] = useState(false)
  const location = useLocation()

  useEffect(() => setOffen(false), [location.pathname])

  if (!user) return null
  const initialen = `${user.vorname[0] ?? ''}${user.nachname[0] ?? ''}`.toUpperCase() || user.benutzername.slice(0, 2)

  return (
    <div className="app">
      <header className="mobil-kopf">
        <button type="button" className="icon-knopf" aria-label="Menü öffnen" onClick={() => setOffen(true)}>
          <Icon name="menue" size={22} />
        </button>
        <span className="marke"><Icon name="logo" size={22} className="marke-icon" /> Buildings</span>
      </header>

      <nav className={`seitenleiste${offen ? ' offen' : ''}`} aria-label="Hauptnavigation">
        <div className="seitenleiste-kopf">
          <span className="marke"><Icon name="logo" size={24} className="marke-icon" /> Buildings</span>
          <button type="button" className="icon-knopf nur-mobil" aria-label="Menü schließen" onClick={() => setOffen(false)}>
            <Icon name="schliessen" />
          </button>
        </div>
        <ul className="nav-liste">
          {NAV.map((n) => (
            <li key={n.to}>
              <NavLink to={n.to} end={n.end} className={({ isActive }) => `nav-link${isActive ? ' aktiv' : ''}`}>
                <Icon name={n.icon} />
                <span>{n.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="seitenleiste-fuss">
          <NavLink to="/einstellungen" className="benutzer">
            <span className="avatar">{initialen}</span>
            <span className="benutzer-text">
              <strong>{user.vorname} {user.nachname}</strong>
              <small>{ROLLEN[user.rolle]}</small>
            </span>
            <Icon name="einstellungen" />
          </NavLink>
          <button type="button" className="nav-link abmelden" onClick={() => abmelden()}>
            <Icon name="abmelden" />
            <span>Abmelden</span>
          </button>
        </div>
      </nav>
      {offen && <div className="seitenleiste-hintergrund" onClick={() => setOffen(false)} />}

      <main className="inhalt">
        <Outlet />
      </main>
    </div>
  )
}
