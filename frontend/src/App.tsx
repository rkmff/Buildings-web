import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth'
import Layout from './components/Layout'
import Auftraege from './pages/Auftraege'
import Einstellungen from './pages/Einstellungen'
import KundenAnlagen from './pages/KundenAnlagen'
import Login from './pages/Login'
import MeineSeite from './pages/MeineSeite'
import PasswortAendern from './pages/PasswortAendern'
import Platzhalter from './pages/Platzhalter'

export default function App() {
  const { user, laden } = useAuth()

  if (laden) return <div className="vollbild-hinweis">Buildings wird geladen …</div>
  if (!user) return <Login />
  if (user.muss_passwort_aendern) return <PasswortAendern erzwungen />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<MeineSeite />} />
        <Route path="objekte" element={<KundenAnlagen />} />
        <Route path="objekte/:typ/:id" element={<KundenAnlagen />} />
        <Route path="einstellungen" element={<Einstellungen />} />
        <Route path="passwort" element={<PasswortAendern />} />
        <Route path="auftraege" element={<Auftraege />} />
        <Route path="auftraege/:id" element={<Auftraege />} />
        <Route path="wartung" element={<Platzhalter titel="Wartung" />} />
        <Route path="wochenplanung" element={<Platzhalter titel="Wochenplanung" />} />
        <Route path="mitarbeiter" element={<Platzhalter titel="Mitarbeiter" />} />
        <Route path="ausruestung" element={<Platzhalter titel="Ausrüstung" />} />
        <Route path="berichte" element={<Platzhalter titel="Berichte" />} />
        <Route path="stammdaten" element={<Platzhalter titel="Stammdaten" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
