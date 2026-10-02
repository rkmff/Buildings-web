import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import Dialog from '../components/Dialog'
import Icon from '../components/Icon'
import { Protokoll } from '../components/ObjektDialog'
import { lang } from '../datum'

interface Eintrag {
  id: number
  name: string
  hersteller: string | null
  modell: string | null
  inventarnummer: string | null
  seriennummer: string | null
  status: string
  naechste_pruefung: string | null
  pruefung: 'faellig' | 'bald' | null
  typ_id: number | null
  typ: string | null
  besitzer_id: number
  besitzer: string | null
  uebergabe_an: string | null
}

interface Detail extends Eintrag {
  baujahr: number | null
  anschaffungsdatum: string | null
  beschreibung: string | null
  kommentar: string | null
  kalibrierpflichtig: boolean
  erstellt_am: string | null
  erstellt_von: string | null
  geaendert_am: string | null
  geaendert_von: string | null
}

interface AnMich { id: number; ausruestung_id: number; name: string; von: string | null; gestartet_am: string; notiz: string | null }

interface Stamm {
  ich: number
  darf_alles: boolean
  status: { id: string; label: string }[]
  typen: { id: number; name: string; kalibrierung: number }[]
  mitarbeiter: { id: number; name: string }[]
}

interface Detaildaten {
  ausruestung: Detail
  darf_bearbeiten: boolean
  uebergaben: { id: number; status: string; gestartet_am: string; bestaetigt_am: string | null; notiz: string | null; von_id: number; an_id: number; von: string; an: string }[]
  kalibrierungen: { id: number; datum: string; gueltig_bis: string | null; zertifikat: string | null; ergebnis: string | null; bemerkung: string | null }[]
  fotos: { id: number; originalname: string | null; beschreibung: string | null; aufnahmedatum: string | null }[]
  dokumente: { id: number; name: string | null; beschreibung: string | null; hochgeladen_am: string | null }[]
}

const STATUS_LABEL: Record<string, string> = { aktiv: 'Aktiv', reparatur: 'Reparatur', ausgemustert: 'Ausgemustert' }

function lesen<T>(key: string, standard: T): T {
  try {
    const v = localStorage.getItem(key)
    return v === null ? standard : (JSON.parse(v) as T)
  } catch {
    return standard
  }
}
function merken(key: string, wert: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(wert))
  } catch {
    /* egal */
  }
}

function Pruefung({ e }: { e: Pick<Eintrag, 'naechste_pruefung' | 'pruefung'> }) {
  if (!e.naechste_pruefung) return null
  if (e.pruefung === 'faellig') return <span className="status-pille pille-schlecht">Prüfung fällig</span>
  if (e.pruefung === 'bald') return <span className="status-pille pille-achtung">Prüfung {lang(e.naechste_pruefung)}</span>
  return null
}

export default function Ausruestung() {
  const { id } = useParams()
  const ausgewaehlt = id ? Number(id) : null
  const navigate = useNavigate()
  const [ansicht, setAnsicht] = useState<'meine' | 'alle'>(() => lesen('ausruestung.ansicht', 'meine'))
  const [q, setQ] = useState('')
  const [typ, setTyp] = useState('')
  const [person, setPerson] = useState('')
  const [ausgemusterte, setAusgemusterte] = useState(false)
  const [liste, setListe] = useState<Eintrag[] | null>(null)
  const [anMich, setAnMich] = useState<AnMich[]>([])
  const [stamm, setStamm] = useState<Stamm | null>(null)
  const [neu, setNeu] = useState(false)
  const [meldung, setMeldung] = useState('')

  const laden = useCallback(() => {
    const p = new URLSearchParams({ ansicht, q, ausgemusterte: ausgemusterte ? '1' : '0' })
    if (typ) p.set('typ', typ)
    if (person && ansicht === 'alle') p.set('mitarbeiter', person)
    api
      .get<{ eintraege: Eintrag[]; an_mich: AnMich[] }>(`/api/ausruestung?${p}`)
      .then((r) => {
        setListe(r.eintraege)
        setAnMich(r.an_mich)
      })
      .catch((e) => setMeldung(e.message))
  }, [ansicht, q, typ, person, ausgemusterte])

  useEffect(() => {
    const t = window.setTimeout(laden, 150)
    return () => window.clearTimeout(t)
  }, [laden])
  useEffect(() => {
    api.get<Stamm>('/api/ausruestung/stammdaten').then(setStamm).catch((e) => setMeldung(e.message))
  }, [])

  const wechseln = (a: 'meine' | 'alle') => {
    setAnsicht(a)
    merken('ausruestung.ansicht', a)
  }

  const gruppen = useMemo(() => {
    const out: { titel: string; eintraege: Eintrag[] }[] = []
    for (const e of liste ?? []) {
      const titel = ansicht === 'alle' && !person ? e.besitzer || 'Ohne Besitzer' : e.typ || 'Ohne Typ'
      let g = out.find((x) => x.titel === titel)
      if (!g) out.push((g = { titel, eintraege: [] }))
      g.eintraege.push(e)
    }
    return out.sort((a, b) => a.titel.localeCompare(b.titel, 'de'))
  }, [liste, ansicht, person])

  const abschliessen = async (u: AnMich, aktion: 'annehmen' | 'ablehnen') => {
    try {
      await api.post(`/api/uebergaben/${u.id}/${aktion}`)
      setMeldung(aktion === 'annehmen' ? `${u.name} gehört jetzt dir.` : 'Übergabe abgelehnt.')
      laden()
      if (aktion === 'annehmen') navigate(`/ausruestung/${u.ausruestung_id}`)
    } catch (e) {
      setMeldung((e as Error).message)
    }
  }

  return (
    <div className={`objekte${ausgewaehlt ? ' mit-detail' : ''}`}>
      <aside className="baum" aria-label="Ausrüstungsliste">
        <div className="baum-kopf">
          <div className="zeile-zwischen">
            <h1 className="titel-klein">Ausrüstung</h1>
            <button type="button" className="knopf klein primaer" onClick={() => setNeu(true)} disabled={!stamm}>
              <Icon name="plus" size={15} /> Neu
            </button>
          </div>
          <div className="segment volle-breite" role="group" aria-label="Ansicht">
            <button type="button" className={ansicht === 'meine' ? 'aktiv' : ''} aria-pressed={ansicht === 'meine'} onClick={() => wechseln('meine')}>Meine</button>
            <button type="button" className={ansicht === 'alle' ? 'aktiv' : ''} aria-pressed={ansicht === 'alle'} onClick={() => wechseln('alle')}>Alle</button>
          </div>
          <label className="suchfeld">
            <Icon name="suche" size={16} />
            <input type="search" aria-label="Ausrüstung suchen" placeholder="Name, Hersteller, Inventar-Nr." value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="zeile">
            <select aria-label="Ausrüstungstyp" className="status-wahl flex-1" value={typ} onChange={(e) => setTyp(e.target.value)}>
              <option value="">Alle Typen</option>
              {stamm?.typen.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {ansicht === 'alle' && (
              <select aria-label="Mitarbeiter" className="status-wahl flex-1" value={person} onChange={(e) => setPerson(e.target.value)}>
                <option value="">Alle Mitarbeiter</option>
                {stamm?.mitarbeiter.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            )}
          </div>
          <label className="aufgabe klein gedaempft nowrap">
            <input type="checkbox" checked={ausgemusterte} onChange={(e) => setAusgemusterte(e.target.checked)} /> Ausgemusterte zeigen
          </label>
        </div>
        <div className="baum-liste">
          {anMich.length > 0 && (
            <div className="uebergabe-box">
              <h2 className="mini-titel">Übergaben an dich</h2>
              {anMich.map((u) => (
                <div key={u.id} className="uebergabe-zeile">
                  <span>
                    <strong>{u.name}</strong>
                    <small className="gedaempft block">von {u.von}{u.notiz ? ` · ${u.notiz}` : ''}</small>
                  </span>
                  <span className="zeile">
                    <button type="button" className="knopf klein primaer" onClick={() => abschliessen(u, 'annehmen')}>Annehmen</button>
                    <button type="button" className="knopf klein" onClick={() => abschliessen(u, 'ablehnen')}>Ablehnen</button>
                  </span>
                </div>
              ))}
            </div>
          )}
          {!liste && <p className="gedaempft">Wird geladen …</p>}
          {liste && liste.length === 0 && (
            <p className="gedaempft">{ansicht === 'meine' && !q && !typ ? 'Dir ist keine Ausrüstung zugeordnet.' : 'Nichts gefunden.'}</p>
          )}
          {gruppen.map((g) => (
            <div key={g.titel}>
              <h2 className="mini-titel personen-gruppe">{g.titel} <span className="zaehler">{g.eintraege.length}</span></h2>
              {g.eintraege.map((e) => (
                <Link key={e.id} to={`/ausruestung/${e.id}`}
                  className={`personen-zeile${e.id === ausgewaehlt ? ' aktiv' : ''}${e.status === 'ausgemustert' ? ' inaktiv' : ''}`}>
                  <span className="personen-text">
                    <strong>{e.name}</strong>
                    <small>{[e.hersteller, e.modell].filter(Boolean).join(' ') || e.typ || '–'}</small>
                  </span>
                  <Pruefung e={e} />
                  {e.status !== 'aktiv' && <span className="status-pille">{STATUS_LABEL[e.status] ?? e.status}</span>}
                  {e.uebergabe_an && <span className="status-pille" title={`Übergabe an ${e.uebergabe_an} offen`}>Übergabe offen</span>}
                </Link>
              ))}
            </div>
          ))}
        </div>
      </aside>
      <section className="objekt-detail">
        {ausgewaehlt && stamm ? (
          <AusruestungDetail key={ausgewaehlt} id={ausgewaehlt} stamm={stamm} onGeaendert={laden} onMeldung={setMeldung}
            onZurueck={() => navigate('/ausruestung')} />
        ) : (
          <div className="karte leer">Wähle links einen Gegenstand.</div>
        )}
      </section>

      {neu && stamm && (
        <AusruestungFormular stamm={stamm} onClose={() => setNeu(false)}
          onGespeichert={(nid) => { setNeu(false); laden(); navigate(`/ausruestung/${nid}`) }} />
      )}
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

type Tab = 'uebergaben' | 'kalibrierungen' | 'fotos' | 'dokumente'

function AusruestungDetail({ id, stamm, onGeaendert, onMeldung, onZurueck }: {
  id: number
  stamm: Stamm
  onGeaendert: () => void
  onMeldung: (m: string) => void
  onZurueck: () => void
}) {
  const [d, setD] = useState<Detaildaten | null>(null)
  const [fehler, setFehler] = useState('')
  const [tab, setTab] = useState<Tab>('uebergaben')
  const [dialog, setDialog] = useState<'bearbeiten' | 'uebergabe' | 'kalibrierung' | null>(null)
  const fotoEingabe = useRef<HTMLInputElement>(null)

  const laden = useCallback(() => {
    api.get<Detaildaten>(`/api/ausruestung/${id}`).then(setD).catch((e) => setFehler(e.message))
  }, [id])
  useEffect(laden, [laden])

  if (fehler) return <div className="karte leer">{fehler}</div>
  if (!d) return <p className="gedaempft">Wird geladen …</p>
  const a = d.ausruestung
  const offen = d.uebergaben.find((u) => u.status === 'offen')

  const neuLaden = () => {
    laden()
    onGeaendert()
  }
  const aktion = async (fn: () => Promise<unknown>, text?: string) => {
    try {
      await fn()
      if (text) onMeldung(text)
      neuLaden()
    } catch (e) {
      onMeldung((e as Error).message)
    }
  }
  const fotosHochladen = (dateien: FileList | null) => {
    if (!dateien?.length) return
    const daten = new FormData()
    for (const f of Array.from(dateien)) daten.append('fotos', f)
    aktion(() => api.hochladen(`/api/ausruestung/${id}/fotos`, daten), 'Foto gespeichert.')
    if (fotoEingabe.current) fotoEingabe.current.value = ''
  }

  const tabs: [Tab, string, number][] = [
    ['uebergaben', 'Übergaben', d.uebergaben.length],
    ...(a.kalibrierpflichtig || d.kalibrierungen.length ? [['kalibrierungen', 'Kalibrierungen', d.kalibrierungen.length] as [Tab, string, number]] : []),
    ['fotos', 'Fotos', d.fotos.length],
    ...(d.dokumente.length ? [['dokumente', 'Dokumente', d.dokumente.length] as [Tab, string, number]] : []),
  ]
  const aktiverTab = tabs.some(([t]) => t === tab) ? tab : 'uebergaben'

  const felder: [string, string | number | null][] = [
    ['Besitzer', a.besitzer],
    ['Status', STATUS_LABEL[a.status] ?? a.status],
    ['Hersteller', a.hersteller],
    ['Typ / Modell', a.modell],
    ['Seriennummer', a.seriennummer],
    ['Inventarnummer', a.inventarnummer],
    ['Baujahr', a.baujahr || null],
    ['Angeschafft', a.anschaffungsdatum ? lang(a.anschaffungsdatum) : null],
    ['Nächste Prüfung', a.naechste_pruefung ? lang(a.naechste_pruefung) : null],
    ['Beschreibung', a.beschreibung],
    ['Kommentar', a.kommentar],
  ]

  return (
    <div className="detail">
      <button type="button" className="knopf klein nur-mobil" onClick={onZurueck}>
        <Icon name="links" size={16} /> Zur Übersicht
      </button>
      <div className="detail-kopf">
        <div>
          <span className="typ-marke gross">{a.typ ?? 'Ausrüstung'}</span>
          <h1 className="seitentitel">{a.name}</h1>
          <p className="zeile">
            <Pruefung e={a} />
            {offen && <span className="status-pille">Übergabe an {offen.an} offen</span>}
          </p>
        </div>
        {d.darf_bearbeiten && (
          <div className="zeile">
            {!offen && a.status !== 'ausgemustert' && (
              <button type="button" className="knopf" onClick={() => setDialog('uebergabe')}>Übergeben</button>
            )}
            <button type="button" className="knopf" onClick={() => setDialog('bearbeiten')}>Bearbeiten</button>
          </div>
        )}
      </div>
      <dl className="feld-raster">
        {felder.filter(([, w]) => w !== null && w !== '').map(([k, w]) => (
          <div key={k} className="feld-kachel"><dt>{k}</dt><dd>{w}</dd></div>
        ))}
      </dl>
      <div className="tabs" role="tablist">
        {tabs.map(([t, label, n]) => (
          <button key={t} type="button" role="tab" aria-selected={t === aktiverTab} className={t === aktiverTab ? 'aktiv' : ''} onClick={() => setTab(t)}>
            {label} <span className="zaehler">{n}</span>
          </button>
        ))}
      </div>
      <div className="karte tab-inhalt" role="tabpanel">
        {aktiverTab === 'uebergaben' && (
          d.uebergaben.length === 0 ? <p className="gedaempft">Noch keine Übergaben.</p> : (
            <div className="tabelle-rahmen">
              <table className="tabelle">
                <thead><tr><th>Gestartet</th><th>Von</th><th>An</th><th>Status</th><th>Notiz</th><th /></tr></thead>
                <tbody>
                  {d.uebergaben.map((u) => (
                    <tr key={u.id}>
                      <td>{lang(u.gestartet_am)}</td>
                      <td>{u.von}</td>
                      <td>{u.an}</td>
                      <td><span className={`status-pille uebergabe-${u.status}`}>{u.status}</span>{u.bestaetigt_am && <small className="gedaempft"> {lang(u.bestaetigt_am)}</small>}</td>
                      <td className="gedaempft">{u.notiz}</td>
                      <td className="aktionen-zelle">
                        {u.status === 'offen' && u.an_id === stamm.ich && (
                          <>
                            <button type="button" className="knopf klein primaer" onClick={() => aktion(() => api.post(`/api/uebergaben/${u.id}/annehmen`), 'Übergabe angenommen.')}>Annehmen</button>
                            <button type="button" className="knopf klein" onClick={() => aktion(() => api.post(`/api/uebergaben/${u.id}/ablehnen`), 'Übergabe abgelehnt.')}>Ablehnen</button>
                          </>
                        )}
                        {u.status === 'offen' && (u.von_id === stamm.ich || stamm.darf_alles) && (
                          <button type="button" className="knopf klein" onClick={() => aktion(() => api.post(`/api/uebergaben/${u.id}/stornieren`), 'Übergabe zurückgezogen.')}>Zurückziehen</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
        {aktiverTab === 'kalibrierungen' && (
          <>
            {d.darf_bearbeiten && (
              <div className="tab-aktionen">
                <button type="button" className="knopf klein" onClick={() => setDialog('kalibrierung')}><Icon name="plus" size={15} /> Kalibrierung</button>
              </div>
            )}
            {d.kalibrierungen.length === 0 ? <p className="gedaempft">Noch keine Kalibrierung erfasst.</p> : (
              <div className="tabelle-rahmen">
                <table className="tabelle">
                  <thead><tr><th>Datum</th><th>Gültig bis</th><th>Zertifikat</th><th>Ergebnis</th><th>Bemerkung</th><th /></tr></thead>
                  <tbody>
                    {d.kalibrierungen.map((k) => (
                      <tr key={k.id}>
                        <td>{lang(k.datum)}</td>
                        <td>{k.gueltig_bis ? lang(k.gueltig_bis) : '–'}</td>
                        <td className="mono">{k.zertifikat}</td>
                        <td>{k.ergebnis}</td>
                        <td className="gedaempft">{k.bemerkung}</td>
                        <td className="aktionen-zelle">
                          {d.darf_bearbeiten && (
                            <button type="button" className="icon-knopf klein" aria-label="Kalibrierung löschen"
                              onClick={() => window.confirm('Kalibrierung löschen?') && aktion(() => api.del(`/api/kalibrierungen/${k.id}`))}>
                              <Icon name="papierkorb" size={15} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {aktiverTab === 'fotos' && (
          <>
            {d.darf_bearbeiten && (
              <div className="tab-aktionen">
                <input ref={fotoEingabe} type="file" accept="image/*" multiple hidden onChange={(e) => fotosHochladen(e.target.files)} />
                <button type="button" className="knopf klein" onClick={() => fotoEingabe.current?.click()}><Icon name="foto" size={15} /> Foto hinzufügen</button>
              </div>
            )}
            {d.fotos.length === 0 ? <p className="gedaempft">Keine Fotos vorhanden.</p> : (
              <div className="foto-raster">
                {d.fotos.map((f) => (
                  <a key={f.id} href={`/api/fotos/${f.id}/datei`} target="_blank" rel="noreferrer" className="foto-kachel">
                    <img src={`/api/fotos/${f.id}/datei`} alt={f.beschreibung || f.originalname || 'Foto'} loading="lazy" />
                    <span>{f.beschreibung || lang(f.aufnahmedatum) || f.originalname}</span>
                  </a>
                ))}
              </div>
            )}
          </>
        )}
        {aktiverTab === 'dokumente' && (
          <ul className="liste dokument-liste">
            {d.dokumente.map((x) => (
              <li key={x.id} className="liste-eintrag zeile-zwischen">
                <a href={`/api/dokumente/${x.id}/datei`} target="_blank" rel="noreferrer">{x.name || 'Dokument'}</a>
                <small className="gedaempft">{x.beschreibung || lang(x.hochgeladen_am)}</small>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Protokoll erstelltAm={a.erstellt_am} erstelltVon={a.erstellt_von} geaendertAm={a.geaendert_am} geaendertVon={a.geaendert_von} />

      {dialog === 'bearbeiten' && (
        <AusruestungFormular stamm={stamm} ausruestung={a} onClose={() => setDialog(null)}
          onGespeichert={() => { setDialog(null); neuLaden() }}
          onGeloescht={() => { setDialog(null); onGeaendert(); onZurueck() }} />
      )}
      {dialog === 'uebergabe' && (
        <UebergabeDialog stamm={stamm} ausruestung={a} onClose={() => setDialog(null)}
          onGestartet={(an) => { setDialog(null); onMeldung(`Übergabe gestartet. ${an} muss sie noch annehmen.`); neuLaden() }} />
      )}
      {dialog === 'kalibrierung' && (
        <KalibrierungDialog id={id} onClose={() => setDialog(null)} onGespeichert={() => { setDialog(null); neuLaden() }} />
      )}
    </div>
  )
}

// ---------- Dialoge ----------

function AusruestungFormular({ stamm, ausruestung, onClose, onGespeichert, onGeloescht }: {
  stamm: Stamm
  ausruestung?: Detail
  onClose: () => void
  onGespeichert: (id: number) => void
  onGeloescht?: () => void
}) {
  const a = ausruestung
  const [w, setW] = useState({
    name: a?.name ?? '',
    typ_id: (a?.typ_id ?? stamm.typen[0]?.id ?? null) as number | null,
    status: a?.status ?? 'aktiv',
    hersteller: a?.hersteller ?? '',
    modell: a?.modell ?? '',
    seriennummer: a?.seriennummer ?? '',
    inventarnummer: a?.inventarnummer ?? '',
    baujahr: a?.baujahr ? String(a.baujahr) : '',
    anschaffungsdatum: a?.anschaffungsdatum ?? '',
    naechste_pruefung: a?.naechste_pruefung ?? '',
    beschreibung: a?.beschreibung ?? '',
    kommentar: a?.kommentar ?? '',
    besitzer_id: a?.besitzer_id ?? stamm.ich,
  })
  const [fehler, setFehler] = useState('')
  const setze = <K extends keyof typeof w>(k: K, v: (typeof w)[K]) => setW((x) => ({ ...x, [k]: v }))

  const speichern = async () => {
    try {
      if (a) {
        await api.put(`/api/ausruestung/${a.id}`, w)
        onGespeichert(a.id)
      } else {
        const r = await api.post<{ id: number }>('/api/ausruestung', w)
        onGespeichert(r.id)
      }
    } catch (e) {
      setFehler((e as Error).message)
    }
  }
  const loeschen = async () => {
    if (!a || !window.confirm(`${a.name} endgültig löschen? Meist reicht der Status „Ausgemustert“.`)) return
    try {
      await api.del(`/api/ausruestung/${a.id}`)
      onGeloescht?.()
    } catch (e) {
      setFehler((e as Error).message)
    }
  }
  const text = (k: 'name' | 'hersteller' | 'modell' | 'seriennummer' | 'inventarnummer', label: string, pflicht = false) => (
    <label className="feld"><span>{label}{pflicht ? ' *' : ''}</span><input value={w[k]} onChange={(e) => setze(k, e.target.value)} /></label>
  )

  return (
    <Dialog
      titel={a ? `${a.name} bearbeiten` : 'Neue Ausrüstung'}
      onClose={onClose}
      breit
      aktionen={
        <>
          {a && stamm.darf_alles && <button type="button" className="knopf gefahr" onClick={loeschen}>Löschen</button>}
          <span className="abstand" />
          <button type="button" className="knopf" onClick={onClose}>Abbrechen</button>
          <button type="button" className="knopf primaer" disabled={!w.name.trim() || !w.typ_id} onClick={speichern}>Speichern</button>
        </>
      }
    >
      <div className="formular-raster">
        {text('name', 'Name', true)}
        <label className="feld">
          <span>Ausrüstungstyp *</span>
          <select value={w.typ_id ?? ''} onChange={(e) => setze('typ_id', e.target.value ? Number(e.target.value) : null)}>
            {stamm.typen.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        {text('hersteller', 'Hersteller')}
        {text('modell', 'Typ / Modell')}
        {text('seriennummer', 'Seriennummer')}
        {text('inventarnummer', 'Inventarnummer')}
        <label className="feld"><span>Baujahr</span><input inputMode="numeric" value={w.baujahr} onChange={(e) => setze('baujahr', e.target.value)} /></label>
        <label className="feld"><span>Angeschafft am</span><input type="date" value={w.anschaffungsdatum} onChange={(e) => setze('anschaffungsdatum', e.target.value)} /></label>
        <label className="feld"><span>Nächste Prüfung</span><input type="date" value={w.naechste_pruefung} onChange={(e) => setze('naechste_pruefung', e.target.value)} /></label>
        <label className="feld">
          <span>Status</span>
          <select value={w.status} onChange={(e) => setze('status', e.target.value)}>
            {stamm.status.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        {stamm.darf_alles && (
          <label className="feld">
            <span>Besitzer</span>
            <select value={w.besitzer_id} onChange={(e) => setze('besitzer_id', Number(e.target.value))}>
              {stamm.mitarbeiter.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
        )}
        <label className="feld breit"><span>Beschreibung</span><textarea rows={2} value={w.beschreibung} onChange={(e) => setze('beschreibung', e.target.value)} /></label>
        <label className="feld breit"><span>Kommentar</span><textarea rows={2} value={w.kommentar} onChange={(e) => setze('kommentar', e.target.value)} /></label>
      </div>
      {!stamm.darf_alles && a && <p className="gedaempft klein">Den Besitzer wechselst du über „Übergeben“.</p>}
      {fehler && <p className="fehler" role="alert">{fehler}</p>}
    </Dialog>
  )
}

function UebergabeDialog({ stamm, ausruestung, onClose, onGestartet }: {
  stamm: Stamm
  ausruestung: Detail
  onClose: () => void
  onGestartet: (an: string) => void
}) {
  const [an, setAn] = useState<number | null>(null)
  const [notiz, setNotiz] = useState('')
  const [fehler, setFehler] = useState('')
  const empfaenger = stamm.mitarbeiter.filter((m) => m.id !== ausruestung.besitzer_id)
  const starten = async () => {
    try {
      await api.post(`/api/ausruestung/${ausruestung.id}/uebergabe`, { an_id: an, notiz })
      onGestartet(empfaenger.find((m) => m.id === an)?.name ?? 'Der Empfänger')
    } catch (e) {
      setFehler((e as Error).message)
    }
  }
  return (
    <Dialog
      titel={`${ausruestung.name} übergeben`}
      onClose={onClose}
      aktionen={
        <>
          <button type="button" className="knopf" onClick={onClose}>Abbrechen</button>
          <button type="button" className="knopf primaer" disabled={!an} onClick={starten}>Übergabe starten</button>
        </>
      }
    >
      <label className="feld">
        <span>An</span>
        <select value={an ?? ''} onChange={(e) => setAn(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Bitte wählen</option>
          {empfaenger.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </label>
      <label className="feld"><span>Notiz</span><input value={notiz} placeholder="optional" onChange={(e) => setNotiz(e.target.value)} /></label>
      <p className="gedaempft klein">Die Ausrüstung wechselt erst, wenn der Empfänger die Übergabe annimmt.</p>
      {fehler && <p className="fehler" role="alert">{fehler}</p>}
    </Dialog>
  )
}

function KalibrierungDialog({ id, onClose, onGespeichert }: { id: number; onClose: () => void; onGespeichert: () => void }) {
  const heute = new Date().toISOString().slice(0, 10)
  const [w, setW] = useState({ datum: heute, gueltig_bis: '', zertifikat: '', ergebnis: '', bemerkung: '' })
  const [fehler, setFehler] = useState('')
  const setze = (k: keyof typeof w, v: string) => setW((x) => ({ ...x, [k]: v }))
  const speichern = async () => {
    try {
      await api.post(`/api/ausruestung/${id}/kalibrierungen`, w)
      onGespeichert()
    } catch (e) {
      setFehler((e as Error).message)
    }
  }
  return (
    <Dialog
      titel="Kalibrierung erfassen"
      onClose={onClose}
      aktionen={
        <>
          <button type="button" className="knopf" onClick={onClose}>Abbrechen</button>
          <button type="button" className="knopf primaer" disabled={!w.datum} onClick={speichern}>Speichern</button>
        </>
      }
    >
      <div className="feld-reihe">
        <label className="feld"><span>Datum *</span><input type="date" value={w.datum} onChange={(e) => setze('datum', e.target.value)} /></label>
        <label className="feld"><span>Gültig bis</span><input type="date" value={w.gueltig_bis} onChange={(e) => setze('gueltig_bis', e.target.value)} /></label>
      </div>
      <div className="feld-reihe">
        <label className="feld"><span>Zertifikat-Nr.</span><input value={w.zertifikat} onChange={(e) => setze('zertifikat', e.target.value)} /></label>
        <label className="feld"><span>Ergebnis</span><input value={w.ergebnis} placeholder="z. B. i. O." onChange={(e) => setze('ergebnis', e.target.value)} /></label>
      </div>
      <label className="feld"><span>Bemerkung</span><textarea rows={2} value={w.bemerkung} onChange={(e) => setze('bemerkung', e.target.value)} /></label>
      <p className="gedaempft klein">„Gültig bis“ wird als nächste Prüfung übernommen.</p>
      {fehler && <p className="fehler" role="alert">{fehler}</p>}
    </Dialog>
  )
}
