import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import Dokumente from '../components/Dokumente'
import Icon from '../components/Icon'
import { Protokoll } from '../components/ObjektDialog'
import { systemText } from './Auftraege'

interface AufgabeDetail {
  id: number
  titel: string
  beschreibung: string | null
  status: string
  ergebnis: string | null
  mitarbeiter_id: number | null
  mitarbeiter: string
  auftrag_id: number | null
  auftrag: string | null
  system_id: number | null
  kunde: string | null
  system: string | null
  erstellt_am: string | null
  erstellt_von: string | null
  geaendert_am: string | null
  geaendert_von: string | null
}

interface Stamm {
  techniker: { id: number; name: string }[]
  systeme: { id: number; kunde: string | null; name: string }[]
}

const STATUS = [
  { wert: 'offen', label: 'offen' },
  { wert: 'in arbeit', label: 'in Arbeit' },
  { wert: 'erledigt', label: 'erledigt' },
]

export default function Aufgabe() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [t, setT] = useState<AufgabeDetail | null>(null)
  const [darf, setDarf] = useState(false)
  const [zuweisen, setZuweisen] = useState(false)
  const [stamm, setStamm] = useState<Stamm | null>(null)
  const [werte, setWerte] = useState({ titel: '', beschreibung: '', ergebnis: '' })
  const [fehler, setFehler] = useState('')
  const [meldung, setMeldung] = useState('')

  const laden = useCallback(() => {
    api
      .get<{ aufgabe: AufgabeDetail; darf_bearbeiten: boolean; darf_zuweisen: boolean }>(`/api/aufgaben/${id}`)
      .then((r) => {
        setT(r.aufgabe)
        setDarf(r.darf_bearbeiten)
        setZuweisen(r.darf_zuweisen)
        setWerte({ titel: r.aufgabe.titel, beschreibung: r.aufgabe.beschreibung ?? '', ergebnis: r.aufgabe.ergebnis ?? '' })
      })
      .catch((e) => setFehler(e instanceof ApiError && e.status === 404 ? 'Diese Aufgabe gibt es nicht mehr.' : e.message))
  }, [id])
  useEffect(laden, [laden])
  useEffect(() => {
    api.get<Stamm>('/api/auftraege/stammdaten').then(setStamm).catch(() => {})
  }, [])

  const aendern = async (daten: Record<string, unknown>, text = 'Gespeichert.') => {
    try {
      await api.patch(`/api/aufgaben/${id}`, daten)
      setMeldung(text)
      laden()
    } catch (e) {
      setMeldung((e as Error).message)
    }
  }
  const loeschen = async () => {
    if (!t || !window.confirm(`Aufgabe „${t.titel}“ löschen?`)) return
    try {
      await api.del(`/api/aufgaben/${id}`)
      navigate(t.auftrag_id ? `/auftraege/${t.auftrag_id}` : '/')
    } catch (e) {
      setMeldung((e as Error).message)
    }
  }

  if (fehler) return <div className="seite"><p className="fehler">{fehler}</p><Link to="/">Zur Startseite</Link></div>
  if (!t) return <div className="seite"><p className="gedaempft">Wird geladen …</p></div>
  const geaendert = werte.titel !== t.titel || werte.beschreibung !== (t.beschreibung ?? '') || werte.ergebnis !== (t.ergebnis ?? '')

  return (
    <div className="seite aufgabe-seite">
      <nav className="brotkrumen" aria-label="Pfad">
        <Link to="/">Start</Link>
        {t.auftrag_id && <> <span aria-hidden="true">›</span> <Link to={`/auftraege/${t.auftrag_id}`}>{t.auftrag}</Link></>}
        {!t.auftrag_id && t.system_id && <> <span aria-hidden="true">›</span> <Link to={`/objekte/system/${t.system_id}`}>{systemText(t.kunde, t.system)}</Link></>}
      </nav>
      <div className="seiten-kopf">
        <label className="aufgabe gross">
          <input type="checkbox" checked={t.status === 'erledigt'} disabled={!darf}
            aria-label={t.status === 'erledigt' ? 'Wieder öffnen' : 'Als erledigt markieren'}
            onChange={(e) => aendern({ status: e.target.checked ? 'erledigt' : 'offen' }, e.target.checked ? 'Erledigt.' : 'Wieder offen.')} />
          <h1 className={`seitentitel${t.status === 'erledigt' ? ' durchgestrichen' : ''}`}>{t.titel}</h1>
        </label>
        {darf && <button type="button" className="knopf gefahr" onClick={loeschen}>Löschen</button>}
      </div>

      <div className="karte formular aufgabe-formular">
        <div className="formular-raster">
          <label className="feld breit"><span>Titel</span>
            <input value={werte.titel} disabled={!darf} maxLength={200} onChange={(e) => setWerte((w) => ({ ...w, titel: e.target.value }))} />
          </label>
          <label className="feld">
            <span>Status</span>
            <select value={t.status} disabled={!darf} onChange={(e) => aendern({ status: e.target.value })}>
              {STATUS.map((s) => <option key={s.wert} value={s.wert}>{s.label}</option>)}
            </select>
          </label>
          <label className="feld">
            <span>Zuständig</span>
            <select value={t.mitarbeiter_id ?? 0} disabled={!zuweisen} onChange={(e) => aendern({ mitarbeiter_id: Number(e.target.value) || null })}>
              <option value={0}>niemand</option>
              {stamm?.techniker.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              {!stamm && t.mitarbeiter_id && <option value={t.mitarbeiter_id}>{t.mitarbeiter}</option>}
            </select>
          </label>
          <label className="feld">
            <span>Auftrag</span>
            {t.auftrag_id ? (
              <span className="zeile">
                <Link to={`/auftraege/${t.auftrag_id}`}>{t.auftrag}</Link>
                {darf && <button type="button" className="knopf klein flach" onClick={() => aendern({ auftrag_id: null, system_id: t.system_id })}>lösen</button>}
              </span>
            ) : <span className="gedaempft">ohne Auftrag</span>}
          </label>
          <label className="feld">
            <span>Kundensystem</span>
            <select value={t.system_id ?? 0} disabled={!darf || !!t.auftrag_id}
              title={t.auftrag_id ? 'Das Kundensystem ergibt sich aus dem Auftrag.' : undefined}
              onChange={(e) => aendern({ system_id: Number(e.target.value) || null })}>
              <option value={0}>ohne Kundensystem</option>
              {stamm?.systeme.map((s) => <option key={s.id} value={s.id}>{systemText(s.kunde, s.name)}</option>)}
              {!stamm && t.system_id && <option value={t.system_id}>{systemText(t.kunde, t.system)}</option>}
            </select>
          </label>
          <label className="feld breit"><span>Beschreibung</span>
            <textarea rows={4} value={werte.beschreibung} disabled={!darf} onChange={(e) => setWerte((w) => ({ ...w, beschreibung: e.target.value }))} />
          </label>
          <label className="feld breit"><span>Ergebnis</span>
            <textarea rows={2} value={werte.ergebnis} disabled={!darf} onChange={(e) => setWerte((w) => ({ ...w, ergebnis: e.target.value }))} />
          </label>
        </div>
        {darf && (
          <div className="knopf-reihe links">
            <button type="button" className="knopf primaer" disabled={!geaendert || !werte.titel.trim()} onClick={() => aendern(werte)}>Speichern</button>
          </div>
        )}
        <Protokoll erstelltAm={t.erstellt_am} erstelltVon={t.erstellt_von} geaendertAm={t.geaendert_am} geaendertVon={t.geaendert_von} />
      </div>

      <section className="karte">
        <h2 className="abschnitt-titel">Dokumente</h2>
        <Dokumente art="aufgabe" id={t.id} />
      </section>

      {meldung && (
        <div className="toast" role="alert">
          <span>{meldung}</span>
          <button type="button" className="icon-knopf klein" aria-label="Meldung schließen" onClick={() => setMeldung('')}>
            <Icon name="schliessen" size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
