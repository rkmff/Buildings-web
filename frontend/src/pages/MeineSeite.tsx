import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api'
import { useAuth } from '../auth'
import Bausteine from '../components/Bausteine'
import Dialog from '../components/Dialog'
import Icon from '../components/Icon'
import Planungskalender, { type DragDaten } from '../components/Planungskalender'
import { EintragDialog, kollision, ManuellDialog, ZiehVorschau } from '../components/PlanungWerkzeuge'
import { addDays, heute, lang, langesHeute, montag } from '../datum'
import { systemText } from './Auftraege'
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

export default function MeineSeite() {
  const { user, einstellungenSpeichern } = useAuth()
  const wochen = user?.einstellungen.planung_wochen ?? 6
  const [von, setVon] = useState(() => montag(heute()))
  const [planung, setPlanung] = useState<PlanungAntwort | null>(null)
  const [abwesenheiten, setAbwesenheiten] = useState<Abwesenheitsart[]>([])
  const [uebersicht, setUebersicht] = useState<Uebersicht | null>(null)
  const [aktiv, setAktiv] = useState<DragDaten | null>(null)
  const [meldung, setMeldung] = useState('')
  const [konflikt, setKonflikt] = useState<Konfliktfrage | null>(null)
  const [bearbeiten, setBearbeiten] = useState<Planungseintrag | null>(null)
  const [manuell, setManuell] = useState<{ datum: string; quelle_id: number } | null>(null)

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
      </div>

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
                    <Link to={`/auftraege/${a.id}`}><strong>{a.name}</strong></Link>
                    <span className="zeile">
                      {a.rolle === 'mit' && <span className="status-pille" title="Du bist mitverantwortlich">mit</span>}
                      <span className="status-pille">{a.status || 'ohne Status'}</span>
                    </span>
                  </div>
                  <small className="gedaempft">{[a.typ, systemText(a.kunde, a.system)].filter(Boolean).join(' · ')}</small>
                  {prozent !== null ? (
                    <div className="fortschritt" aria-label={`Wartung ${prozent} Prozent erledigt`}>
                      <div style={{ width: `${prozent}%` }} />
                      <span className="mono klein">{a.wartung_erledigt}/{a.wartung_gesamt}</span>
                    </div>
                  ) : a.typ?.toLowerCase() !== 'wartung' && !!a.fortschritt && (
                    <div className="fortschritt" aria-label={`${a.fortschritt} Prozent erledigt`}>
                      <div style={{ width: `${a.fortschritt}%` }} />
                      <span className="mono klein">{a.fortschritt} %</span>
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
            <Link to="/ausruestung" className="klein">Alle anzeigen</Link>
          </div>
          {offeneUebergaben.length > 0 && (
            <Link to="/ausruestung" className="hinweis-box block">
              {offeneUebergaben.length === 1 ? 'Eine Übergabe wartet' : `${offeneUebergaben.length} Übergaben warten`} auf deine Bestätigung.
            </Link>
          )}
          {uebersicht?.ausruestung.length === 0 && <p className="gedaempft">Dir ist keine Ausrüstung zugeordnet.</p>}
          <ul className="liste">
            {uebersicht?.ausruestung.map((r) => {
              const faellig = r.naechste_pruefung && r.naechste_pruefung <= heute()
              return (
                <li key={r.id} className="liste-eintrag zeile-zwischen">
                  <span>
                    <Link to={`/ausruestung/${r.id}`}><strong>{r.name}</strong></Link>
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

      <div className="abschnitt-kopf">
        <h2 className="abschnitt-titel">Meine Planung</h2>
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
          />
        </div>
        <DragOverlay dropAnimation={null}>
          {aktiv && <ZiehVorschau daten={aktiv} />}
        </DragOverlay>
      </DndContext>

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

    </div>
  )
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
  const [systemId, setSystemId] = useState(0)
  const [systeme, setSysteme] = useState<{ id: number; kunde: string | null; name: string }[]>([])

  useEffect(() => {
    if (neu === null || systeme.length) return
    api.get<{ systeme: typeof systeme }>('/api/auftraege/stammdaten').then((r) => setSysteme(r.systeme)).catch(() => {})
  }, [neu, systeme.length])

  async function anlegen(e: FormEvent) {
    e.preventDefault()
    if (!neu?.trim()) return
    try {
      await api.post('/api/me/aufgaben', { titel: neu.trim(), auftrag_id: auftragId || null, system_id: auftragId ? null : systemId || null })
      setNeu(null)
      setAuftragId(0)
      setSystemId(0)
      await onNeu()
    } catch (err) {
      onFehler((err as Error).message)
    }
  }

  return (
    <section className="karte">
      <div className="karte-kopf">
        <h2 className="abschnitt-titel">Meine Aufgaben <span className="zaehler">{aufgaben.length}</span></h2>
        <button type="button" className="icon-knopf rund akzent" aria-label="Aufgabe hinzufügen" onClick={() => setNeu('')}>
          <Icon name="plus" />
        </button>
      </div>
      {neu !== null && (
        <form className="aufgabe-neu" onSubmit={anlegen}>
          <input autoFocus aria-label="Titel der neuen Aufgabe" placeholder="Was ist zu tun?" value={neu} onChange={(e) => setNeu(e.target.value)} />
          <select aria-label="Auftrag" value={auftragId} onChange={(e) => setAuftragId(Number(e.target.value))}>
            <option value={0}>ohne Auftrag</option>
            {auftraege.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {!auftragId && (
            <select aria-label="Kundensystem" value={systemId} onChange={(e) => setSystemId(Number(e.target.value))}>
              <option value={0}>ohne Kundensystem</option>
              {systeme.map((s) => <option key={s.id} value={s.id}>{systemText(s.kunde, s.name)}</option>)}
            </select>
          )}
          <div className="knopf-reihe links">
            <button type="submit" className="knopf primaer" disabled={!neu.trim()}>Anlegen</button>
            <button type="button" className="knopf" onClick={() => setNeu(null)}>Abbrechen</button>
          </div>
        </form>
      )}
      {aufgaben.length === 0 && neu === null && <p className="gedaempft">Keine offenen Aufgaben.</p>}
      <ul className="liste">
        {aufgaben.map((a) => (
          <li key={a.id} className="liste-eintrag aufgabe">
            <input type="checkbox" aria-label={`„${a.titel}“ erledigt`} onChange={() => onErledigt(a)} />
            <span>
              <Link to={`/aufgaben/${a.id}`}>{a.titel}</Link>
              {(a.auftrag || a.system_id) && (
                <small className="gedaempft block">{a.auftrag ?? systemText(a.kunde, a.system)}</small>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
