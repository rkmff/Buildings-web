import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import Dialog from '../components/Dialog'
import Icon from '../components/Icon'
import { lang } from '../datum'

interface Person {
  id: number
  vorname: string | null
  nachname: string | null
  funktion: string | null
  telefon: string | null
  email: string | null
  niederlassung_id: number | null
  niederlassung: string | null
  niederlassung_kurz: string | null
  aktiv: number
  in_wochenplanung: number
  sortierung: number | null
  rolle: string
  hat_zugang: number
  ausruestung_anzahl: number
  schulungen_anzahl: number
  systeme_anzahl: number
  eintrittsdatum?: string | null
  kommentar?: string | null
  benutzername?: string | null
  letzter_login?: string | null
  muss_passwort_aendern?: boolean
}

interface Stamm {
  darf_bearbeiten: boolean
  darf_zugang: boolean
  rollen: { wert: string; label: string }[]
  niederlassungen: { id: number; kurz: string | null; name: string }[]
  systeme: { id: number; kunde: string | null; name: string }[]
}

interface Detaildaten {
  mitarbeiter: Person
  schulungen: { id: number; bezeichnung: string; datum: string | null; beschreibung: string | null }[]
  systeme: { id: number; system_id: number; kunde: string | null; system: string | null; hauptverantwortlich: number; kommentar: string | null }[]
  ausruestung: { id: number; name: string; typ: string | null; status: string | null; naechste_pruefung: string | null }[]
}

const name = (p: Pick<Person, 'vorname' | 'nachname'>) => [p.vorname, p.nachname].filter(Boolean).join(' ') || 'Ohne Namen'
const initialen = (p: Person) => `${p.vorname?.[0] ?? ''}${p.nachname?.[0] ?? ''}`.toUpperCase() || '?'

export default function Mitarbeiter() {
  const { id } = useParams()
  const ausgewaehlt = id ? Number(id) : null
  const [suchParams, setSuchParams] = useSearchParams()
  const nl = suchParams.get('niederlassung_id') ?? ''
  const [q, setQ] = useState('')
  const [inaktive, setInaktive] = useState(false)
  const [liste, setListe] = useState<Person[] | null>(null)
  const [stamm, setStamm] = useState<Stamm | null>(null)
  const [neu, setNeu] = useState(false)
  const [reihenfolge, setReihenfolge] = useState(false)
  const [meldung, setMeldung] = useState('')
  const navigate = useNavigate()

  const laden = useCallback(() => {
    const p = new URLSearchParams({ q, inaktive: inaktive ? '1' : '0' })
    if (nl) p.set('niederlassung_id', nl)
    api.get<{ mitarbeiter: Person[] }>(`/api/mitarbeiter?${p}`).then((r) => setListe(r.mitarbeiter)).catch((e) => setMeldung(e.message))
  }, [q, inaktive, nl])

  useEffect(() => {
    const t = window.setTimeout(laden, 150)
    return () => window.clearTimeout(t)
  }, [laden])

  useEffect(() => {
    api.get<Stamm>('/api/mitarbeiter/stammdaten').then(setStamm).catch((e) => setMeldung(e.message))
  }, [])

  const gruppen = useMemo(() => {
    const out: { titel: string; personen: Person[] }[] = []
    for (const p of liste ?? []) {
      const titel = p.niederlassung || 'Ohne Niederlassung'
      let g = out.find((x) => x.titel === titel)
      if (!g) out.push((g = { titel, personen: [] }))
      g.personen.push(p)
    }
    return out
  }, [liste])

  return (
    <div className={`objekte${ausgewaehlt ? ' mit-detail' : ''}`}>
      <aside className="baum" aria-label="Mitarbeiterliste">
        <div className="baum-kopf">
          <div className="zeile-zwischen">
            <h1 className="titel-klein">Mitarbeiter</h1>
            {stamm?.darf_bearbeiten && (
              <button type="button" className="knopf klein primaer" onClick={() => setNeu(true)}>
                <Icon name="plus" size={15} /> Neu
              </button>
            )}
          </div>
          <label className="suchfeld">
            <Icon name="suche" size={16} />
            <input type="search" aria-label="Mitarbeiter suchen" placeholder="Name, Funktion, Telefon" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="zeile">
            <select aria-label="Niederlassung" className="status-wahl flex-1" value={nl}
              onChange={(e) => setSuchParams(e.target.value ? { niederlassung_id: e.target.value } : {})}>
              <option value="">Alle Niederlassungen</option>
              {stamm?.niederlassungen.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
            <label className="aufgabe klein gedaempft nowrap">
              <input type="checkbox" checked={inaktive} onChange={(e) => setInaktive(e.target.checked)} /> Inaktive
            </label>
          </div>
          {stamm?.darf_bearbeiten && (
            <button type="button" className="knopf klein" onClick={() => setReihenfolge(true)}>
              <Icon name="liste" size={15} /> Reihenfolge in der Wochenplanung
            </button>
          )}
        </div>
        <div className="baum-liste">
          {!liste && <p className="gedaempft">Wird geladen …</p>}
          {liste && liste.length === 0 && <p className="gedaempft">Niemand gefunden.</p>}
          {gruppen.map((g) => (
            <div key={g.titel}>
              <h2 className="mini-titel personen-gruppe">{g.titel} <span className="zaehler">{g.personen.length}</span></h2>
              {g.personen.map((p) => (
                <Link key={p.id} to={`/mitarbeiter/${p.id}${nl ? `?niederlassung_id=${nl}` : ''}`}
                  className={`personen-zeile${p.id === ausgewaehlt ? ' aktiv' : ''}${p.aktiv ? '' : ' inaktiv'}`}>
                  <span className="avatar mini">{initialen(p)}</span>
                  <span className="personen-text">
                    <strong>{name(p)}</strong>
                    <small>{p.funktion || '–'}</small>
                  </span>
                  {!p.in_wochenplanung && <span className="status-pille" title="Nicht in der Wochenplanung">ohne Plan</span>}
                  {!p.aktiv && <span className="status-pille">inaktiv</span>}
                </Link>
              ))}
            </div>
          ))}
        </div>
      </aside>
      <section className="objekt-detail">
        {ausgewaehlt && stamm ? (
          <PersonDetail key={ausgewaehlt} id={ausgewaehlt} stamm={stamm} onGeaendert={laden} onFehler={setMeldung}
            onZurueck={() => navigate(`/mitarbeiter${nl ? `?niederlassung_id=${nl}` : ''}`)} />
        ) : (
          <div className="karte leer">Wähle links einen Mitarbeiter.</div>
        )}
      </section>

      {neu && stamm && (
        <PersonFormular
          stamm={stamm}
          onClose={() => setNeu(false)}
          onGespeichert={(p) => {
            setNeu(false)
            laden()
            navigate(`/mitarbeiter/${p.id}`)
          }}
        />
      )}
      {reihenfolge && stamm && <ReihenfolgeDialog stamm={stamm} onClose={() => setReihenfolge(false)} onGespeichert={() => { setReihenfolge(false); laden() }} />}
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

// ---------- Detail ----------

type Tab = 'person' | 'zugang' | 'schulungen' | 'systeme' | 'ausruestung'

function PersonDetail({ id, stamm, onGeaendert, onFehler, onZurueck }: {
  id: number
  stamm: Stamm
  onGeaendert: () => void
  onFehler: (t: string) => void
  onZurueck: () => void
}) {
  const { user } = useAuth()
  const [d, setD] = useState<Detaildaten | null>(null)
  const [tab, setTab] = useState<Tab>('person')
  const [bearbeiten, setBearbeiten] = useState(false)

  const laden = useCallback(() => {
    api.get<Detaildaten>(`/api/mitarbeiter/${id}`).then(setD).catch((e) => onFehler(e.message))
  }, [id, onFehler])
  useEffect(laden, [laden])

  if (!d) return <p className="gedaempft">Wird geladen …</p>
  const m = d.mitarbeiter
  const eigen = user?.id === m.id
  const rolle = stamm.rollen.find((r) => r.wert === m.rolle)?.label ?? m.rolle
  const tabs: [Tab, string, number | null][] = [
    ['person', 'Person', null],
    ...(stamm.darf_zugang || eigen ? [['zugang', 'Zugang', null] as [Tab, string, null]] : []),
    ['schulungen', 'Schulungen', d.schulungen.length],
    ['systeme', 'Systeme', d.systeme.length],
    ['ausruestung', 'Ausrüstung', d.ausruestung.length],
  ]
  const neuLaden = () => { laden(); onGeaendert() }

  return (
    <div className="detail">
      <button type="button" className="knopf klein nur-mobil" onClick={onZurueck}>
        <Icon name="links" size={16} /> Zur Liste
      </button>
      <div className="detail-kopf">
        <div className="zeile person-kopf">
          <span className="avatar gross">{initialen(m)}</span>
          <div>
            <h2 className="seitentitel">{name(m)}</h2>
            <p className="gedaempft">{[m.funktion, m.niederlassung].filter(Boolean).join(' · ') || '–'}</p>
            <div className="zeile pillen">
              {m.hat_zugang ? <span className="status-pille">{rolle}</span> : <span className="status-pille">ohne Zugang</span>}
              <span className="status-pille">{m.in_wochenplanung ? 'in der Wochenplanung' : 'nicht in der Wochenplanung'}</span>
              {!m.aktiv && <span className="status-pille intern">inaktiv</span>}
            </div>
          </div>
        </div>
        <div className="kontakt-links">
          {m.telefon && <a className="knopf klein" href={`tel:${m.telefon}`}>{m.telefon}</a>}
          {m.email && <a className="knopf klein" href={`mailto:${m.email}`}>{m.email}</a>}
        </div>
      </div>

      <div className="tabs" role="tablist">
        {tabs.map(([k, label, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'aktiv' : ''} onClick={() => setTab(k)}>
            {label} {n !== null && <span className="zaehler">{n}</span>}
          </button>
        ))}
      </div>

      {tab === 'person' && (
        <div className="karte">
          <div className="karte-kopf">
            <h3 className="abschnitt-titel">Person</h3>
            {stamm.darf_bearbeiten && <button type="button" className="knopf klein" onClick={() => setBearbeiten(true)}>Bearbeiten</button>}
          </div>
          <dl className="detail-liste">
            <dt>Vorname</dt><dd>{m.vorname || '–'}</dd>
            <dt>Nachname</dt><dd>{m.nachname || '–'}</dd>
            <dt>Funktion</dt><dd>{m.funktion || '–'}</dd>
            <dt>Niederlassung</dt><dd>{m.niederlassung || '–'}</dd>
            <dt>Telefon</dt><dd>{m.telefon || '–'}</dd>
            <dt>E-Mail</dt><dd>{m.email || '–'}</dd>
            <dt>Eintritt</dt><dd>{m.eintrittsdatum ? lang(m.eintrittsdatum) : '–'}</dd>
            <dt>Wochenplanung</dt><dd>{m.in_wochenplanung ? 'wird angezeigt' : 'wird nicht angezeigt'}</dd>
            <dt>Status</dt><dd>{m.aktiv ? 'aktiv' : 'inaktiv'}</dd>
            <dt>Kommentar</dt><dd className="mehrzeilig">{m.kommentar || '–'}</dd>
          </dl>
        </div>
      )}
      {tab === 'zugang' && <Zugang m={m} stamm={stamm} eigen={eigen} onGespeichert={neuLaden} onFehler={onFehler} />}
      {tab === 'schulungen' && <Schulungen d={d} darf={stamm.darf_bearbeiten} onGeaendert={neuLaden} onFehler={onFehler} />}
      {tab === 'systeme' && <Systeme d={d} stamm={stamm} onGeaendert={neuLaden} onFehler={onFehler} />}
      {tab === 'ausruestung' && (
        <div className="karte tab-inhalt">
          {d.ausruestung.length === 0 ? (
            <p className="gedaempft">Keine Ausrüstung zugeordnet.</p>
          ) : (
            <div className="tabelle-rahmen">
              <table className="tabelle">
                <thead><tr><th>Name</th><th>Typ</th><th>Status</th><th>Nächste Prüfung</th></tr></thead>
                <tbody>
                  {d.ausruestung.map((a) => (
                    <tr key={a.id}><td>{a.name}</td><td>{a.typ || '–'}</td><td>{a.status || 'aktiv'}</td><td>{a.naechste_pruefung ? lang(a.naechste_pruefung) : '–'}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {bearbeiten && (
        <PersonFormular person={m} stamm={stamm} onClose={() => setBearbeiten(false)} onGespeichert={() => { setBearbeiten(false); neuLaden() }} />
      )}
    </div>
  )
}

function PersonFormular({ person, stamm, onClose, onGespeichert }: {
  person?: Person
  stamm: Stamm
  onClose: () => void
  onGespeichert: (p: Person) => void
}) {
  const [w, setW] = useState({
    vorname: person?.vorname ?? '',
    nachname: person?.nachname ?? '',
    funktion: person?.funktion ?? '',
    niederlassung_id: person?.niederlassung_id ?? null as number | null,
    telefon: person?.telefon ?? '',
    email: person?.email ?? '',
    eintrittsdatum: person?.eintrittsdatum ?? '',
    kommentar: person?.kommentar ?? '',
    in_wochenplanung: person ? !!person.in_wochenplanung : true,
    aktiv: person ? !!person.aktiv : true,
  })
  const [fehler, setFehler] = useState('')
  const setze = <K extends keyof typeof w>(k: K, v: (typeof w)[K]) => setW((x) => ({ ...x, [k]: v }))

  const speichern = async () => {
    try {
      const r = person
        ? await api.put<{ mitarbeiter: Person }>(`/api/mitarbeiter/${person.id}`, w)
        : await api.post<{ mitarbeiter: Person }>('/api/mitarbeiter', w)
      onGespeichert(r.mitarbeiter)
    } catch (e) {
      setFehler((e as Error).message)
    }
  }

  return (
    <Dialog
      titel={person ? `${name(person)} bearbeiten` : 'Neuer Mitarbeiter'}
      onClose={onClose}
      breit
      aktionen={
        <>
          <button type="button" className="knopf" onClick={onClose}>Abbrechen</button>
          <button type="button" className="knopf primaer" disabled={!w.vorname.trim() && !w.nachname.trim()} onClick={speichern}>Speichern</button>
        </>
      }
    >
      <div className="feld-reihe">
        <label className="feld"><span>Vorname</span><input value={w.vorname} onChange={(e) => setze('vorname', e.target.value)} autoFocus /></label>
        <label className="feld"><span>Nachname</span><input value={w.nachname} onChange={(e) => setze('nachname', e.target.value)} /></label>
      </div>
      <div className="feld-reihe">
        <label className="feld"><span>Funktion</span><input value={w.funktion} placeholder="z. B. Techniker" onChange={(e) => setze('funktion', e.target.value)} /></label>
        <label className="feld">
          <span>Niederlassung</span>
          <select value={w.niederlassung_id ?? ''} onChange={(e) => setze('niederlassung_id', e.target.value ? Number(e.target.value) : null)}>
            <option value="">Keine</option>
            {stamm.niederlassungen.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        </label>
      </div>
      <div className="feld-reihe">
        <label className="feld"><span>Telefon</span><input type="tel" value={w.telefon} onChange={(e) => setze('telefon', e.target.value)} /></label>
        <label className="feld"><span>E-Mail</span><input type="email" value={w.email} onChange={(e) => setze('email', e.target.value)} /></label>
      </div>
      <label className="feld"><span>Eintrittsdatum</span><input type="date" value={w.eintrittsdatum} onChange={(e) => setze('eintrittsdatum', e.target.value)} /></label>
      <label className="feld"><span>Kommentar</span><textarea rows={3} value={w.kommentar} onChange={(e) => setze('kommentar', e.target.value)} /></label>
      <div className="zeile umbruch">
        <label className="schalter"><input type="checkbox" checked={w.in_wochenplanung} onChange={(e) => setze('in_wochenplanung', e.target.checked)} /> In der Wochenplanung anzeigen</label>
        <label className="schalter"><input type="checkbox" checked={w.aktiv} onChange={(e) => setze('aktiv', e.target.checked)} /> Aktiv</label>
      </div>
      {fehler && <p className="fehler" role="alert">{fehler}</p>}
    </Dialog>
  )
}

function Zugang({ m, stamm, eigen, onGespeichert, onFehler }: {
  m: Person
  stamm: Stamm
  eigen: boolean
  onGespeichert: () => void
  onFehler: (t: string) => void
}) {
  const [benutzername, setBenutzername] = useState(m.benutzername ?? '')
  const [rolle, setRolle] = useState(m.rolle || 'mitarbeiter')
  const [passwort, setPasswort] = useState('')
  const [gespeichert, setGespeichert] = useState(false)

  if (!stamm.darf_zugang) {
    return (
      <div className="karte">
        <dl className="detail-liste">
          <dt>Benutzername</dt><dd className="mono">{m.benutzername || '–'}</dd>
          <dt>Rolle</dt><dd>{stamm.rollen.find((r) => r.wert === m.rolle)?.label}</dd>
          <dt>Letzte Anmeldung</dt><dd>{m.letzter_login || '–'}</dd>
        </dl>
        {eigen && <p className="hinweis"><Link to="/passwort">Eigenes Passwort ändern</Link></p>}
      </div>
    )
  }

  const speichern = async (e: FormEvent) => {
    e.preventDefault()
    setGespeichert(false)
    try {
      await api.put(`/api/mitarbeiter/${m.id}/zugang`, { benutzername, rolle, passwort })
      setPasswort('')
      setGespeichert(true)
      onGespeichert()
    } catch (err) {
      onFehler((err as Error).message)
    }
  }

  return (
    <form className="karte formular" onSubmit={speichern}>
      <p className="gedaempft klein">
        Ohne Benutzernamen kann sich {name(m)} nicht anmelden, bleibt aber in Planung und Aufträgen auswählbar.
        {m.letzter_login && ` Letzte Anmeldung: ${m.letzter_login}.`}
      </p>
      <div className="feld-reihe">
        <label className="feld"><span>Benutzername</span><input value={benutzername} autoComplete="off" onChange={(e) => setBenutzername(e.target.value)} /></label>
        <label className="feld">
          <span>Rolle</span>
          <select value={rolle} disabled={!benutzername} onChange={(e) => setRolle(e.target.value)}>
            {stamm.rollen.map((r) => <option key={r.wert} value={r.wert}>{r.label}</option>)}
          </select>
        </label>
      </div>
      <label className="feld">
        <span>{m.hat_zugang ? 'Neues Startpasswort (leer lassen, um es nicht zu ändern)' : 'Startpasswort'}</span>
        <input type="password" autoComplete="new-password" value={passwort} disabled={!benutzername} onChange={(e) => setPasswort(e.target.value)} />
      </label>
      {!eigen && <p className="gedaempft klein">Nach einem neuen Startpasswort muss {name(m)} es bei der nächsten Anmeldung ändern.</p>}
      <div className="knopf-reihe links">
        <button type="submit" className="knopf primaer">Zugang speichern</button>
        {gespeichert && <span className="erfolg">Gespeichert.</span>}
      </div>
    </form>
  )
}

function Schulungen({ d, darf, onGeaendert, onFehler }: { d: Detaildaten; darf: boolean; onGeaendert: () => void; onFehler: (t: string) => void }) {
  const [bezeichnung, setBezeichnung] = useState('')
  const [datum, setDatum] = useState('')

  const anlegen = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api.post(`/api/mitarbeiter/${d.mitarbeiter.id}/schulungen`, { bezeichnung, datum })
      setBezeichnung('')
      setDatum('')
      onGeaendert()
    } catch (err) {
      onFehler((err as Error).message)
    }
  }
  const loeschen = async (id: number) => {
    if (!window.confirm('Schulung löschen?')) return
    try {
      await api.del(`/api/schulungen/${id}`)
      onGeaendert()
    } catch (err) {
      onFehler((err as Error).message)
    }
  }

  return (
    <div className="karte stapel">
      {darf && (
        <form className="inline-formular" onSubmit={anlegen}>
          <input placeholder="Schulung, z. B. SCC oder Elektrofachkraft" value={bezeichnung} onChange={(e) => setBezeichnung(e.target.value)} aria-label="Schulung" />
          <input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} aria-label="Abschlussdatum" className="datum-feld" />
          <button type="submit" className="knopf" disabled={!bezeichnung.trim()}>Hinzufügen</button>
        </form>
      )}
      {d.schulungen.length === 0 && <p className="gedaempft">Keine Schulungen eingetragen.</p>}
      <ul className="liste">
        {d.schulungen.map((s) => (
          <li key={s.id} className="liste-eintrag zeile-zwischen">
            <span>
              <strong>{s.bezeichnung}</strong>
              {s.beschreibung && <small className="gedaempft block">{s.beschreibung}</small>}
            </span>
            <span className="zeile">
              <span className="mono klein gedaempft">{s.datum ? lang(s.datum) : ''}</span>
              {darf && (
                <button type="button" className="icon-knopf klein" aria-label={`${s.bezeichnung} löschen`} onClick={() => loeschen(s.id)}>
                  <Icon name="papierkorb" size={15} />
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Systeme({ d, stamm, onGeaendert, onFehler }: { d: Detaildaten; stamm: Stamm; onGeaendert: () => void; onFehler: (t: string) => void }) {
  const [systemId, setSystemId] = useState('')
  const [haupt, setHaupt] = useState(false)
  const vorhanden = new Set(d.systeme.map((s) => s.system_id))

  const zuordnen = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api.post(`/api/mitarbeiter/${d.mitarbeiter.id}/systeme`, { system_id: Number(systemId), hauptverantwortlich: haupt })
      setSystemId('')
      setHaupt(false)
      onGeaendert()
    } catch (err) {
      onFehler((err as Error).message)
    }
  }
  const entfernen = async (id: number) => {
    try {
      await api.del(`/api/mitarbeiter-systeme/${id}`)
      onGeaendert()
    } catch (err) {
      onFehler((err as Error).message)
    }
  }

  return (
    <div className="karte stapel">
      {stamm.darf_bearbeiten && (
        <form className="inline-formular" onSubmit={zuordnen}>
          <select aria-label="System" value={systemId} onChange={(e) => setSystemId(e.target.value)}>
            <option value="">System zuordnen …</option>
            {stamm.systeme.filter((s) => !vorhanden.has(s.id)).map((s) => (
              <option key={s.id} value={s.id}>{[s.kunde, s.name].filter(Boolean).join(' · ')}</option>
            ))}
          </select>
          <label className="aufgabe klein nowrap"><input type="checkbox" checked={haupt} onChange={(e) => setHaupt(e.target.checked)} /> hauptverantwortlich</label>
          <button type="submit" className="knopf" disabled={!systemId}>Zuordnen</button>
        </form>
      )}
      {d.systeme.length === 0 && <p className="gedaempft">Keine Systeme zugeordnet.</p>}
      <ul className="liste">
        {d.systeme.map((s) => (
          <li key={s.id} className="liste-eintrag zeile-zwischen">
            <span>
              <Link to={`/objekte/system/${s.system_id}`}>{[s.kunde, s.system].filter(Boolean).join(' · ')}</Link>
              {s.hauptverantwortlich ? <span className="status-pille ml">hauptverantwortlich</span> : null}
              {s.kommentar && <small className="gedaempft block">{s.kommentar}</small>}
            </span>
            {stamm.darf_bearbeiten && (
              <button type="button" className="icon-knopf klein" aria-label="Zuordnung entfernen" onClick={() => entfernen(s.id)}>
                <Icon name="schliessen" size={15} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------- Reihenfolge ----------

function ReihenfolgeZeile({ p, nr, aktiv }: { p: Person; nr: number; aktiv: boolean }) {
  const ziehen = useDraggable({ id: p.id })
  const ziel = useDroppable({ id: p.id })
  return (
    <li ref={(el) => { ziehen.setNodeRef(el); ziel.setNodeRef(el) }} className={aktiv ? 'zieht' : ''}
      {...ziehen.listeners} {...ziehen.attributes} aria-label={`${name(p)}, Platz ${nr}. Zum Verschieben ziehen.`}>
      <Icon name="griff" size={16} className="gedaempft" />
      <span className="mono klein gedaempft">{nr}</span>
      <span className="flex-1">{name(p)} <small className="gedaempft">{p.funktion}</small></span>
    </li>
  )
}

function ReihenfolgeDialog({ stamm, onClose, onGespeichert }: { stamm: Stamm; onClose: () => void; onGespeichert: () => void }) {
  const [personen, setPersonen] = useState<Person[] | null>(null)
  const [nl, setNl] = useState<string>(() => String(stamm.niederlassungen[0]?.id ?? ''))
  const [aktiv, setAktiv] = useState<number | null>(null)
  const [status, setStatus] = useState('')
  const [fehler, setFehler] = useState('')
  const [geaendert, setGeaendert] = useState(false)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  )

  useEffect(() => {
    api.get<{ mitarbeiter: Person[] }>('/api/mitarbeiter').then((r) => setPersonen(r.mitarbeiter.filter((p) => p.in_wochenplanung)))
  }, [])

  const inGruppe = (p: Person) => String(p.niederlassung_id ?? '') === nl
  const gruppe = (personen ?? []).filter(inGruppe)

  // Wie im bisherigen Programm: beim Ziehen sofort umsortieren, beim Loslassen automatisch speichern
  const ueber = (e: DragOverEvent) => {
    if (!e.over || e.over.id === e.active.id) return
    const von = gruppe.findIndex((p) => p.id === e.active.id)
    const nach = gruppe.findIndex((p) => p.id === e.over!.id)
    if (von < 0 || nach < 0) return
    const neu = [...gruppe]
    const [x] = neu.splice(von, 1)
    neu.splice(nach, 0, x)
    setPersonen((alle) => [...(alle ?? []).filter((p) => !inGruppe(p)), ...neu])
  }
  const speichern = async (liste: Person[]) => {
    setStatus('Speichere …')
    setFehler('')
    try {
      await api.post('/api/mitarbeiter/reihenfolge', { ids: liste.map((p) => p.id) })
      setStatus('Gespeichert')
      setGeaendert(true)
    } catch (e) {
      setStatus('')
      setFehler((e as Error).message)
    }
  }
  const ende = (e: DragEndEvent) => {
    setAktiv(null)
    if (e.over) speichern(gruppe)
  }
  const schliessen = () => (geaendert ? onGespeichert() : onClose())
  const mitOhne = (personen ?? []).some((p) => p.niederlassung_id === null)
  const gezogen = gruppe.find((p) => p.id === aktiv)

  return (
    <Dialog
      titel="Reihenfolge in der Wochenplanung"
      onClose={schliessen}
      aktionen={
        <>
          <span className="gedaempft klein" aria-live="polite">{status}</span>
          <span className="abstand" />
          <button type="button" className="knopf primaer" onClick={schliessen}>Fertig</button>
        </>
      }
    >
      <label className="feld">
        <span>Niederlassung</span>
        <select value={nl} onChange={(e) => setNl(e.target.value)}>
          {stamm.niederlassungen.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          {mitOhne && <option value="">Ohne Niederlassung</option>}
        </select>
      </label>
      <p className="gedaempft klein">Mitarbeiter an die gewünschte Stelle ziehen. Die Reihenfolge wird sofort gespeichert.</p>
      {!personen ? (
        <p className="gedaempft">Wird geladen …</p>
      ) : gruppe.length === 0 ? (
        <p className="gedaempft">Hier ist niemand in der Wochenplanung.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter}
          onDragStart={(e) => setAktiv(Number(e.active.id))} onDragOver={ueber} onDragEnd={ende} onDragCancel={() => setAktiv(null)}>
          <ol className="reihenfolge ziehbar">
            {gruppe.map((p, i) => <ReihenfolgeZeile key={p.id} p={p} nr={i + 1} aktiv={p.id === aktiv} />)}
          </ol>
          <DragOverlay dropAnimation={null}>
            {gezogen && (
              <div className="reihenfolge-vorschau">
                <Icon name="griff" size={16} /> {name(gezogen)}
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}
      {fehler && <p className="fehler">{fehler}</p>}
    </Dialog>
  )
}
