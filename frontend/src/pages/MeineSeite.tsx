import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../api'
import { useAuth } from '../auth'
import Bausteine from '../components/Bausteine'
import Dialog from '../components/Dialog'
import Icon from '../components/Icon'
import Planungskalender, { type DragDaten } from '../components/Planungskalender'
import { addDays, heute, kurz, lang, langesHeute, montag } from '../datum'
import { textAuf } from '../theme'
import type {
  Abwesenheitsart,
  Aufgabe,
  AuftragKurz,
  Ausruestung,
  PlanungAntwort,
  Planungseintrag,
  Uebergabe,
} from '../types'

interface Uebersicht {
  aufgaben: Aufgabe[]
  auftraege: AuftragKurz[]
  ausruestung: Ausruestung[]
  uebergaben: Uebergabe[]
}

interface Konfliktfrage {
  text: string
  ersetzen: () => Promise<void>
}

const WOCHEN = [1, 2, 3, 4, 5, 6, 8, 10, 12]

const kollision: CollisionDetection = (args) => {
  const treffer = pointerWithin(args)
  return treffer.length ? treffer : rectIntersection(args)
}

export default function MeineSeite() {
  const { user, einstellungenSpeichern } = useAuth()
  const wochen = user?.einstellungen.planung_wochen ?? 6
  const [von, setVon] = useState(() => montag(heute()))
  const [planung, setPlanung] = useState<PlanungAntwort | null>(null)
  const [abwesenheiten, setAbwesenheiten] = useState<Abwesenheitsart[]>([])
  const [uebersicht, setUebersicht] = useState<Uebersicht | null>(null)
  const [weitere, setWeitere] = useState<AuftragKurz[]>([])
  const [aktiv, setAktiv] = useState<DragDaten | null>(null)
  const [meldung, setMeldung] = useState('')
  const [konflikt, setKonflikt] = useState<Konfliktfrage | null>(null)
  const [bearbeiten, setBearbeiten] = useState<Planungseintrag | null>(null)
  const [manuell, setManuell] = useState<{ datum: string; quelle_id: number } | null>(null)
  const [sucheOffen, setSucheOffen] = useState(false)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  )

  const planungLaden = useCallback(async () => {
    const r = await api.get<PlanungAntwort>(`/api/planung?von=${von}&wochen=${wochen}`)
    setPlanung(r)
  }, [von, wochen])

  const uebersichtLaden = useCallback(async () => {
    setUebersicht(await api.get<Uebersicht>('/api/me/uebersicht'))
  }, [])

  useEffect(() => {
    planungLaden().catch((e) => setMeldung(e.message))
  }, [planungLaden])

  useEffect(() => {
    uebersichtLaden().catch((e) => setMeldung(e.message))
    api
      .get<{ abwesenheiten: Abwesenheitsart[] }>('/api/planung/bausteine')
      .then((r) => setAbwesenheiten(r.abwesenheiten))
      .catch((e) => setMeldung(e.message))
  }, [uebersichtLaden])

  useEffect(() => {
    if (!meldung) return
    const t = window.setTimeout(() => setMeldung(''), 6000)
    return () => window.clearTimeout(t)
  }, [meldung])

  /** Führt eine Planungsänderung aus; bei Überschneidung wird nachgefragt und ggf. ersetzt. */
  const ausfuehren = useCallback(
    async (aktion: (ersetzen: boolean) => Promise<unknown>) => {
      try {
        await aktion(false)
        await planungLaden()
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setKonflikt({
            text: err.message,
            ersetzen: async () => {
              setKonflikt(null)
              try {
                await aktion(true)
              } catch (e2) {
                setMeldung((e2 as Error).message)
              }
              await planungLaden()
            },
          })
        } else {
          setMeldung((err as Error).message)
        }
      }
    },
    [planungLaden],
  )

  function onDragStart(e: DragStartEvent) {
    setAktiv((e.active.data.current as DragDaten) ?? null)
  }

  function onDragEnd(e: DragEndEvent) {
    setAktiv(null)
    const daten = e.active.data.current as DragDaten | undefined
    const datum = e.over?.data.current?.datum as string | undefined
    if (!daten || !datum) return

    if (daten.art === 'baustein') {
      if (daten.manuell) {
        setManuell({ datum, quelle_id: daten.quelle_id })
        return
      }
      ausfuehren((replace) =>
        api.post('/api/planung', { quelle_typ: daten.quelle_typ, quelle_id: daten.quelle_id, datum, replace }),
      )
    } else if (daten.art === 'eintrag') {
      if (datum === daten.eintrag.start_datum) return
      ausfuehren((replace) => api.post(`/api/planung/${daten.eintrag.id}/verschieben`, { start_datum: datum, replace }))
    } else if (daten.art === 'resize') {
      const { eintrag, kante } = daten
      if (kante === 'start' && datum <= eintrag.ende_datum && datum !== eintrag.start_datum) {
        ausfuehren((replace) => api.patch(`/api/planung/${eintrag.id}`, { start_datum: datum, replace }))
      } else if (kante === 'ende' && datum >= eintrag.start_datum && datum !== eintrag.ende_datum) {
        ausfuehren((replace) => api.patch(`/api/planung/${eintrag.id}`, { ende_datum: datum, replace }))
      }
    }
  }

  async function aufgabeUmschalten(a: Aufgabe) {
    try {
      await api.patch(`/api/me/aufgaben/${a.id}`, { status: 'erledigt' })
      await uebersichtLaden()
    } catch (err) {
      setMeldung((err as Error).message)
    }
  }

  if (!user) return null
  const darfBearbeiten = planung?.darf_bearbeiten ?? false
  const offeneUebergaben = uebersicht?.uebergaben ?? []

  return (
    <div className="seite meine-seite">
      <div className="seiten-kopf">
        <div>
          <p className="gedaempft">{langesHeute()}</p>
          <h1 className="seitentitel">Hallo {user.vorname || user.benutzername}</h1>
        </div>
        <div className="werkzeugleiste">
          <button type="button" className="icon-knopf umrandet" aria-label="Eine Woche zurück" onClick={() => setVon(addDays(von, -7))}>
            <Icon name="links" />
          </button>
          <button type="button" className="knopf" onClick={() => setVon(montag(heute()))}>Heute</button>
          <button type="button" className="icon-knopf umrandet" aria-label="Eine Woche weiter" onClick={() => setVon(addDays(von, 7))}>
            <Icon name="rechts" />
          </button>
          <label className="inline-feld">
            <span>Zeitraum</span>
            <select value={wochen} onChange={(e) => einstellungenSpeichern({ planung_wochen: Number(e.target.value) })}>
              {WOCHEN.map((w) => (
                <option key={w} value={w}>{w} {w === 1 ? 'Woche' : 'Wochen'}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={kollision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setAktiv(null)}>
        <div className="planung-bereich">
          <section className="karte kalender-karte">
            {planung ? (
              <Planungskalender daten={planung} wochen={wochen} darfBearbeiten={darfBearbeiten} onEintragKlick={setBearbeiten} />
            ) : (
              <p className="gedaempft">Planung wird geladen …</p>
            )}
            <p className="hinweis">
              Zum Verschieben einen Eintrag auf den neuen ersten Tag ziehen. Die Dauer änderst du an den Rändern, Details per Klick.
            </p>
          </section>
          <Bausteine
            abwesenheiten={abwesenheiten}
            auftraege={uebersicht?.auftraege ?? []}
            weitere={weitere.filter((w) => !uebersicht?.auftraege.some((a) => a.id === w.id))}
            onWeitereEntfernen={(id) => setWeitere((l) => l.filter((a) => a.id !== id))}
            onAlleAuftraege={() => setSucheOffen(true)}
          />
        </div>
        <DragOverlay dropAnimation={null}>
          {aktiv && <ZiehVorschau daten={aktiv} />}
        </DragOverlay>
      </DndContext>

      <div className="karten-raster drei">
        <AufgabenKarte aufgaben={uebersicht?.aufgaben ?? []} auftraege={uebersicht?.auftraege ?? []} onErledigt={aufgabeUmschalten} onNeu={uebersichtLaden} onFehler={setMeldung} />

        <section className="karte">
          <div className="karte-kopf">
            <h2 className="abschnitt-titel">Meine Aufträge <span className="zaehler">{uebersicht?.auftraege.length ?? 0}</span></h2>
          </div>
          {uebersicht?.auftraege.length === 0 && <p className="gedaempft">Keine offenen Aufträge.</p>}
          <ul className="liste">
            {uebersicht?.auftraege.map((a) => {
              const prozent = a.wartung_gesamt ? Math.round(((a.wartung_erledigt ?? 0) / a.wartung_gesamt) * 100) : null
              return (
                <li key={a.id} className="liste-eintrag gestapelt">
                  <div className="zeile-zwischen">
                    <strong>{a.name}</strong>
                    <span className="status-pille">{a.status || 'ohne Status'}</span>
                  </div>
                  <small className="gedaempft">{[a.typ, a.kunde, a.system].filter(Boolean).join(' · ')}</small>
                  {prozent !== null && (
                    <div className="fortschritt" aria-label={`Wartung ${prozent} Prozent erledigt`}>
                      <div style={{ width: `${prozent}%` }} />
                      <span className="mono klein">{a.wartung_erledigt}/{a.wartung_gesamt}</span>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        <section className="karte">
          <div className="karte-kopf">
            <h2 className="abschnitt-titel">Meine Ausrüstung <span className="zaehler">{uebersicht?.ausruestung.length ?? 0}</span></h2>
          </div>
          {offeneUebergaben.length > 0 && (
            <div className="hinweis-box">
              {offeneUebergaben.length === 1 ? 'Eine Übergabe wartet' : `${offeneUebergaben.length} Übergaben warten`} auf deine Bestätigung.
            </div>
          )}
          {uebersicht?.ausruestung.length === 0 && <p className="gedaempft">Dir ist keine Ausrüstung zugeordnet.</p>}
          <ul className="liste">
            {uebersicht?.ausruestung.map((r) => {
              const faellig = r.naechste_pruefung && r.naechste_pruefung <= heute()
              return (
                <li key={r.id} className="liste-eintrag zeile-zwischen">
                  <span>
                    <strong>{r.name}</strong>
                    <small className="gedaempft block">{[r.hersteller, r.typ].filter(Boolean).join(' ')}</small>
                  </span>
                  {r.naechste_pruefung && (
                    <small className={faellig ? 'warnung' : 'gedaempft'}>
                      {faellig ? 'Prüfung fällig' : `Prüfung ${lang(r.naechste_pruefung)}`}
                    </small>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      </div>

      {meldung && (
        <div className="toast" role="alert">
          {meldung}
          <button type="button" className="icon-knopf klein" aria-label="Meldung schließen" onClick={() => setMeldung('')}>
            <Icon name="schliessen" size={14} />
          </button>
        </div>
      )}

      {konflikt && (
        <Dialog
          titel="Eintrag ersetzen?"
          onClose={() => setKonflikt(null)}
          aktionen={
            <>
              <button type="button" className="knopf" onClick={() => setKonflikt(null)}>Abbrechen</button>
              <button type="button" className="knopf primaer" onClick={() => konflikt.ersetzen()}>Ersetzen</button>
            </>
          }
        >
          <p>{konflikt.text}</p>
          <p className="gedaempft klein">Nur der überschneidende Teil wird ersetzt, der Rest des alten Eintrags bleibt erhalten.</p>
        </Dialog>
      )}

      {bearbeiten && (
        <EintragDialog
          eintrag={bearbeiten}
          abwesenheiten={abwesenheiten}
          darfBearbeiten={darfBearbeiten}
          onClose={() => setBearbeiten(null)}
          onSpeichern={(daten) => {
            setBearbeiten(null)
            ausfuehren((replace) => api.patch(`/api/planung/${bearbeiten.id}`, { ...daten, replace }))
          }}
          onLoeschen={() => {
            setBearbeiten(null)
            ausfuehren(() => api.del(`/api/planung/${bearbeiten.id}`))
          }}
        />
      )}

      {manuell && (
        <ManuellDialog
          datum={manuell.datum}
          onClose={() => setManuell(null)}
          onAnlegen={(anzeigetext, bemerkung) => {
            const { datum, quelle_id } = manuell
            setManuell(null)
            ausfuehren((replace) =>
              api.post('/api/planung', { quelle_typ: 'abwesenheit', quelle_id, datum, anzeigetext, bemerkung, replace }),
            )
          }}
        />
      )}

      {sucheOffen && (
        <AuftragSuche
          onClose={() => setSucheOffen(false)}
          bereits={new Set([...(uebersicht?.auftraege ?? []), ...weitere].map((a) => a.id))}
          onWaehlen={(a) => setWeitere((l) => (l.some((x) => x.id === a.id) ? l : [...l, a]))}
        />
      )}
    </div>
  )
}

function ZiehVorschau({ daten }: { daten: DragDaten }) {
  if (daten.art === 'baustein') {
    return <div className="zieh-vorschau" style={{ background: daten.farbe, color: textAuf(daten.farbe) }}>{daten.label}</div>
  }
  if (daten.art === 'eintrag') {
    const f = daten.eintrag.farbe
    return <div className="zieh-vorschau" style={{ background: f, color: textAuf(f) }}>{daten.eintrag.titel}</div>
  }
  return <div className="zieh-vorschau rand">{daten.kante === 'start' ? 'Neuer Beginn' : 'Neues Ende'}</div>
}

function AufgabenKarte({ aufgaben, auftraege, onErledigt, onNeu, onFehler }: {
  aufgaben: Aufgabe[]
  auftraege: AuftragKurz[]
  onErledigt: (a: Aufgabe) => void
  onNeu: () => Promise<void>
  onFehler: (m: string) => void
}) {
  const [neu, setNeu] = useState<string | null>(null)
  const [auftragId, setAuftragId] = useState(0)

  async function anlegen(e: FormEvent) {
    e.preventDefault()
    if (!neu?.trim()) return
    if (!auftragId) {
      onFehler('Bitte einen Auftrag für die Aufgabe wählen.')
      return
    }
    try {
      await api.post('/api/me/aufgaben', { titel: neu.trim(), auftrag_id: auftragId })
      setNeu(null)
      await onNeu()
    } catch (err) {
      onFehler((err as Error).message)
    }
  }

  return (
    <section className="karte">
      <div className="karte-kopf">
        <h2 className="abschnitt-titel">Offene Aufgaben <span className="zaehler">{aufgaben.length}</span></h2>
        <button type="button" className="icon-knopf rund akzent" aria-label="Aufgabe hinzufügen" onClick={() => setNeu('')}>
          <Icon name="plus" />
        </button>
      </div>
      {neu !== null && (
        <form className="inline-formular" onSubmit={anlegen}>
          <input autoFocus aria-label="Titel der neuen Aufgabe" placeholder="Was ist zu tun?" value={neu} onChange={(e) => setNeu(e.target.value)} />
          <select aria-label="Auftrag" value={auftragId} onChange={(e) => setAuftragId(Number(e.target.value))}>
            <option value={0}>Auftrag wählen …</option>
            {auftraege.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button type="submit" className="knopf primaer">Anlegen</button>
          <button type="button" className="knopf" onClick={() => setNeu(null)}>Abbrechen</button>
        </form>
      )}
      {aufgaben.length === 0 && neu === null && <p className="gedaempft">Keine offenen Aufgaben.</p>}
      <ul className="liste">
        {aufgaben.map((a) => (
          <li key={a.id} className="liste-eintrag">
            <label className="aufgabe">
              <input type="checkbox" onChange={() => onErledigt(a)} />
              <span>
                {a.titel}
                {a.auftrag && <small className="gedaempft block">{a.auftrag}</small>}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  )
}

function EintragDialog({ eintrag, abwesenheiten, darfBearbeiten, onClose, onSpeichern, onLoeschen }: {
  eintrag: Planungseintrag
  abwesenheiten: Abwesenheitsart[]
  darfBearbeiten: boolean
  onClose: () => void
  onSpeichern: (d: Record<string, unknown>) => void
  onLoeschen: () => void
}) {
  const [start, setStart] = useState(eintrag.start_datum)
  const [ende, setEnde] = useState(eintrag.ende_datum)
  const [art, setArt] = useState(eintrag.abwesenheitsart_id ?? 0)
  const [anzeigetext, setAnzeigetext] = useState(eintrag.anzeigetext)
  const [bemerkung, setBemerkung] = useState(eintrag.bemerkung)
  const istAuftrag = eintrag.typ === 'auftrag'
  const artName = abwesenheiten.find((a) => a.id === art)?.bezeichnung.toLowerCase()

  return (
    <Dialog
      titel={eintrag.titel}
      onClose={onClose}
      aktionen={
        darfBearbeiten ? (
          <>
            <button type="button" className="knopf gefahr" onClick={onLoeschen}><Icon name="papierkorb" size={16} /> Löschen</button>
            <span className="abstand" />
            <button type="button" className="knopf" onClick={onClose}>Abbrechen</button>
            <button
              type="button"
              className="knopf primaer"
              disabled={!start || !ende || ende < start}
              onClick={() =>
                onSpeichern({
                  start_datum: start,
                  ende_datum: ende,
                  bemerkung,
                  ...(istAuftrag ? {} : { abwesenheitsart_id: art, anzeigetext }),
                })
              }
            >
              Speichern
            </button>
          </>
        ) : (
          <button type="button" className="knopf" onClick={onClose}>Schließen</button>
        )
      }
    >
      {istAuftrag && <p className="gedaempft">{eintrag.untertitel}</p>}
      <div className="feld-reihe">
        <label className="feld">
          <span>Von</span>
          <input type="date" value={start} disabled={!darfBearbeiten} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="feld">
          <span>Bis</span>
          <input type="date" value={ende} min={start} disabled={!darfBearbeiten} onChange={(e) => setEnde(e.target.value)} />
        </label>
      </div>
      {!istAuftrag && (
        <label className="feld">
          <span>Art</span>
          <select value={art} disabled={!darfBearbeiten} onChange={(e) => setArt(Number(e.target.value))}>
            {abwesenheiten.map((a) => <option key={a.id} value={a.id}>{a.bezeichnung}</option>)}
          </select>
        </label>
      )}
      {!istAuftrag && artName === 'manuell' && (
        <label className="feld">
          <span>Text</span>
          <input value={anzeigetext} maxLength={120} disabled={!darfBearbeiten} onChange={(e) => setAnzeigetext(e.target.value)} />
        </label>
      )}
      <label className="feld">
        <span>{artName === 'büro' ? 'Zusatztext' : 'Kommentar'}</span>
        <textarea rows={3} value={bemerkung} disabled={!darfBearbeiten} onChange={(e) => setBemerkung(e.target.value)} />
      </label>
      <p className="gedaempft klein">{kurz(eintrag.start_datum)} bis {kurz(eintrag.ende_datum)}</p>
    </Dialog>
  )
}

function ManuellDialog({ datum, onClose, onAnlegen }: {
  datum: string
  onClose: () => void
  onAnlegen: (anzeigetext: string, bemerkung: string) => void
}) {
  const [text, setText] = useState('')
  const [zeile2, setZeile2] = useState('')
  return (
    <Dialog
      titel={`Manueller Eintrag am ${lang(datum)}`}
      onClose={onClose}
      aktionen={
        <>
          <button type="button" className="knopf" onClick={onClose}>Abbrechen</button>
          <button type="button" className="knopf primaer" disabled={!text.trim()} onClick={() => onAnlegen(text.trim(), zeile2.trim())}>
            Eintragen
          </button>
        </>
      }
    >
      <label className="feld">
        <span>Zeile 1</span>
        <input value={text} maxLength={120} onChange={(e) => setText(e.target.value)} />
      </label>
      <label className="feld">
        <span>Zeile 2 (optional)</span>
        <input value={zeile2} maxLength={160} onChange={(e) => setZeile2(e.target.value)} />
      </label>
    </Dialog>
  )
}

function AuftragSuche({ onClose, onWaehlen, bereits }: {
  onClose: () => void
  onWaehlen: (a: AuftragKurz) => void
  bereits: Set<number>
}) {
  const [q, setQ] = useState('')
  const [treffer, setTreffer] = useState<AuftragKurz[] | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => {
      api
        .get<{ auftraege: AuftragKurz[] }>(`/api/auftraege/suche?q=${encodeURIComponent(q)}`)
        .then((r) => setTreffer(r.auftraege))
        .catch(() => setTreffer([]))
    }, 200)
    return () => window.clearTimeout(t)
  }, [q])

  return (
    <Dialog titel="Alle Aufträge" onClose={onClose} breit aktionen={<button type="button" className="knopf" onClick={onClose}>Fertig</button>}>
      <label className="suchfeld">
        <Icon name="suche" size={16} />
        <input type="search" aria-label="Aufträge durchsuchen" placeholder="Auftrag, Kunde, System oder Techniker" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <p className="gedaempft klein">Gewählte Aufträge erscheinen in deiner Leiste und können dann in den Kalender gezogen werden.</p>
      <ul className="liste such-liste">
        {treffer === null && <li className="gedaempft">Suche …</li>}
        {treffer?.length === 0 && <li className="gedaempft">Keine offenen Aufträge gefunden.</li>}
        {treffer?.map((a) => (
          <li key={a.id} className="liste-eintrag zeile-zwischen">
            <span className="zeile">
              <span className="farbpunkt" style={{ background: a.farbe }} />
              <span>
                <strong>{a.name}</strong>
                <small className="gedaempft block">{[a.typ, a.kunde, a.system, a.techniker].filter(Boolean).join(' · ')}</small>
              </span>
            </span>
            {bereits.has(a.id) ? (
              <span className="gedaempft klein">in der Leiste</span>
            ) : (
              <button type="button" className="knopf klein" onClick={() => onWaehlen(a)}>Hinzufügen</button>
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
