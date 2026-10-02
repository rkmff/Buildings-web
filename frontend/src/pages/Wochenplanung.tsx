import {
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
  type DragStartEvent,
} from '@dnd-kit/core'
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api'
import { AuftragChip, ZiehChip } from '../components/Bausteine'
import Dialog from '../components/Dialog'
import Icon from '../components/Icon'
import { Griff, type DragDaten } from '../components/Planungskalender'
import { EintragDialog, kollision, ManuellDialog, ZiehVorschau } from '../components/PlanungWerkzeuge'
import { addDays, heute, istWochenende, kalenderwoche, kurz, montag, WOCHENTAGE } from '../datum'
import { textAuf } from '../theme'
import type { Abwesenheitsart, AuftragKurz, Planungseintrag } from '../types'

interface Techniker {
  id: number
  vorname: string | null
  nachname: string | null
  funktion: string | null
  niederlassung_id: number | null
  darf_bearbeiten: boolean
}

interface TeamAntwort {
  von: string
  bis: string
  voll: boolean
  mitarbeiter: Techniker[]
  niederlassungen: { id: number; kurz: string | null; name: string }[]
  eintraege: Planungseintrag[]
  feiertage: { datum: string; bezeichnung: string }[]
  bereitschaften: { id: number; mitarbeiter_id: number; start_datum: string; ende_datum: string }[]
}

interface Konfliktfrage {
  text: string
  ersetzen: () => Promise<void>
}

const WOCHEN = [1, 2, 3, 4, 6, 8]

function lesen(key: string, start: string): string {
  try {
    return localStorage.getItem(key) ?? start
  } catch {
    return start
  }
}

function schreiben(key: string, wert: string) {
  try {
    localStorage.setItem(key, wert)
  } catch {
    /* ohne Speicher weiter */
  }
}

const name = (t: Techniker) => [t.vorname, t.nachname].filter(Boolean).join(' ')
const initialen = (t: Techniker) => `${t.vorname?.[0] ?? ''}${t.nachname?.[0] ?? ''}`.toUpperCase()

export default function Wochenplanung() {
  const [von, setVon] = useState(() => montag(heute()))
  const [wochen, setWochenState] = useState(() => {
    const w = Number(lesen('buildings.team.wochen', '2'))
    return WOCHEN.includes(w) ? w : 2
  })
  const [nl, setNlState] = useState(() => lesen('buildings.team.nl', ''))
  const [panel, setPanelState] = useState(() => lesen('buildings.team.panel', '1') === '1')
  const [daten, setDaten] = useState<TeamAntwort | null>(null)
  const [abwesenheiten, setAbwesenheiten] = useState<Abwesenheitsart[]>([])
  const [aktiv, setAktiv] = useState<DragDaten | null>(null)
  const [meldung, setMeldung] = useState('')
  const [konflikt, setKonflikt] = useState<Konfliktfrage | null>(null)
  const [bearbeiten, setBearbeiten] = useState<Planungseintrag | null>(null)
  const [manuell, setManuell] = useState<{ datum: string; quelle_id: number; mitarbeiter_id: number } | null>(null)

  const setWochen = (w: number) => { setWochenState(w); schreiben('buildings.team.wochen', String(w)) }
  const setNl = (v: string) => { setNlState(v); schreiben('buildings.team.nl', v) }
  const setPanel = (v: boolean) => { setPanelState(v); schreiben('buildings.team.panel', v ? '1' : '0') }

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  )

  const laden = useCallback(async () => {
    const p = new URLSearchParams({ von, wochen: String(wochen) })
    if (nl) p.set('niederlassung_id', nl)
    setDaten(await api.get<TeamAntwort>(`/api/team-planung?${p}`))
  }, [von, wochen, nl])

  useEffect(() => {
    laden().catch((e) => setMeldung(e.message))
  }, [laden])

  useEffect(() => {
    api
      .get<{ abwesenheiten: Abwesenheitsart[] }>('/api/planung/bausteine')
      .then((r) => setAbwesenheiten(r.abwesenheiten))
      .catch((e) => setMeldung(e.message))
  }, [])

  useEffect(() => {
    if (!meldung) return
    const t = window.setTimeout(() => setMeldung(''), 6000)
    return () => window.clearTimeout(t)
  }, [meldung])

  const ausfuehren = useCallback(
    async (aktion: (ersetzen: boolean) => Promise<unknown>) => {
      try {
        await aktion(false)
        await laden()
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
              await laden()
            },
          })
        } else {
          setMeldung((err as Error).message)
        }
      }
    },
    [laden],
  )

  function onDragStart(e: DragStartEvent) {
    setAktiv((e.active.data.current as DragDaten) ?? null)
  }

  function onDragEnd(e: DragEndEvent) {
    setAktiv(null)
    const d = e.active.data.current as DragDaten | undefined
    const ziel = e.over?.data.current as { datum: string; mitarbeiter_id: number } | undefined
    if (!d || !ziel) return
    const { datum, mitarbeiter_id } = ziel

    if (d.art === 'baustein') {
      if (d.manuell) {
        setManuell({ datum, quelle_id: d.quelle_id, mitarbeiter_id })
        return
      }
      ausfuehren((replace) =>
        api.post('/api/planung', { mitarbeiter_id, quelle_typ: d.quelle_typ, quelle_id: d.quelle_id, datum, replace }),
      )
    } else if (d.art === 'eintrag') {
      if (datum === d.eintrag.start_datum && mitarbeiter_id === d.eintrag.mitarbeiter_id) return
      ausfuehren((replace) =>
        api.post(`/api/planung/${d.eintrag.id}/verschieben`, { start_datum: datum, mitarbeiter_id, replace }),
      )
    } else if (d.art === 'resize') {
      const { eintrag, kante } = d
      if (mitarbeiter_id !== eintrag.mitarbeiter_id) return
      if (kante === 'start' && datum <= eintrag.ende_datum && datum !== eintrag.start_datum) {
        ausfuehren((replace) => api.patch(`/api/planung/${eintrag.id}`, { start_datum: datum, replace }))
      } else if (kante === 'ende' && datum >= eintrag.start_datum && datum !== eintrag.ende_datum) {
        ausfuehren((replace) => api.patch(`/api/planung/${eintrag.id}`, { ende_datum: datum, replace }))
      }
    }
  }

  const tage = useMemo(() => Array.from({ length: wochen * 7 }, (_, i) => addDays(von, i)), [von, wochen])
  const darfIrgendwas = daten?.mitarbeiter.some((m) => m.darf_bearbeiten) ?? false
  const bearbeitenErlaubt = bearbeiten ? !!daten?.mitarbeiter.find((m) => m.id === bearbeiten.mitarbeiter_id)?.darf_bearbeiten : false

  return (
    <div className="team-seite">
      <div className="seite breit team-kopf">
        <div className="seiten-kopf">
          <div>
            <h1 className="seitentitel">Wochenplanung</h1>
            {daten && <p className="gedaempft">KW {kalenderwoche(daten.von)}{wochen > 1 ? ` bis KW ${kalenderwoche(daten.bis)}` : ''} · {kurz(daten.von)} – {kurz(daten.bis)}{daten.bis.slice(0, 4)}</p>}
          </div>
          <div className="werkzeugleiste">
            <button type="button" className="icon-knopf umrandet" aria-label="Eine Woche zurück" onClick={() => setVon(addDays(von, -7))}>
              <Icon name="links" />
            </button>
            <button type="button" className="knopf" onClick={() => setVon(montag(heute()))}>Heute</button>
            <button type="button" className="icon-knopf umrandet" aria-label="Eine Woche weiter" onClick={() => setVon(addDays(von, 7))}>
              <Icon name="rechts" />
            </button>
            <select aria-label="Zeitraum" value={wochen} onChange={(e) => setWochen(Number(e.target.value))} className="status-wahl">
              {WOCHEN.map((w) => <option key={w} value={w}>{w} {w === 1 ? 'Woche' : 'Wochen'}</option>)}
            </select>
            {daten?.voll && (
              <select aria-label="Niederlassung" value={nl} onChange={(e) => setNl(e.target.value)} className="status-wahl">
                <option value="">Alle Niederlassungen</option>
                {daten.niederlassungen.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
            )}
            {darfIrgendwas && (
              <button type="button" className={`knopf${panel ? ' aktiv' : ''}`} aria-expanded={panel} onClick={() => setPanel(!panel)}>
                <Icon name="auftrag" size={16} /> Aufträge
              </button>
            )}
          </div>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={kollision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setAktiv(null)}>
        <div className={`team-bereich${panel && darfIrgendwas ? ' mit-panel' : ''}`}>
          <div className="karte team-raster-karte">
            {!daten ? (
              <p className="gedaempft">Wird geladen …</p>
            ) : daten.mitarbeiter.length === 0 ? (
              <p className="gedaempft">Keine Techniker in der Wochenplanung.</p>
            ) : (
              <TeamRaster daten={daten} tage={tage} onEintragKlick={setBearbeiten} />
            )}
          </div>
          {panel && darfIrgendwas && <AuftragsPanel abwesenheiten={abwesenheiten} onSchliessen={() => setPanel(false)} />}
        </div>
        <DragOverlay dropAnimation={null}>{aktiv ? <ZiehVorschau daten={aktiv} /> : null}</DragOverlay>
      </DndContext>

      {meldung && (
        <div className="toast" role="alert">
          <span>{meldung}</span>
          <button type="button" className="icon-knopf klein" aria-label="Meldung schließen" onClick={() => setMeldung('')}>
            <Icon name="schliessen" size={16} />
          </button>
        </div>
      )}

      {konflikt && (
        <Dialog
          titel="Zeitraum ist schon belegt"
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
          darfBearbeiten={bearbeitenErlaubt}
          onClose={() => setBearbeiten(null)}
          onSpeichern={(d) => {
            setBearbeiten(null)
            ausfuehren((replace) => api.patch(`/api/planung/${bearbeiten.id}`, { ...d, replace }))
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
            const { datum, quelle_id, mitarbeiter_id } = manuell
            setManuell(null)
            ausfuehren((replace) =>
              api.post('/api/planung', { mitarbeiter_id, quelle_typ: 'abwesenheit', quelle_id, datum, anzeigetext, bemerkung, replace }),
            )
          }}
        />
      )}
    </div>
  )
}

// ---------- Raster ----------

function TeamRaster({ daten, tage, onEintragKlick }: {
  daten: TeamAntwort
  tage: string[]
  onEintragKlick: (e: Planungseintrag) => void
}) {
  const feiertage = new Map(daten.feiertage.map((f) => [f.datum, f.bezeichnung]))
  const heuteIso = heute()
  const spalten = tage.map((t) => (istWochenende(t) ? 'minmax(22px, 0.4fr)' : 'minmax(64px, 1fr)')).join(' ')
  const wochenendTage = tage.filter(istWochenende).length
  const stil = {
    '--team-spalten': `var(--team-name-breite) ${spalten}`,
    minWidth: `calc(var(--team-name-breite) + ${(tage.length - wochenendTage) * 67 + wochenendTage * 25}px)`,
  } as CSSProperties
  const erste = tage[0]
  const letzte = tage[tage.length - 1]
  const spalte = (iso: string) => tage.indexOf(iso) + 2
  const ausschnitt = (s: string, e: string) => {
    const a = s < erste ? erste : s
    const b = e > letzte ? letzte : e
    return { a, b, gridColumn: `${spalte(a)} / ${spalte(b) + 1}` }
  }

  return (
    <div className="team-raster" style={stil} role="grid" aria-label="Team-Wochenplanung">
      <div className="team-zeile team-kw" role="row">
        <span className="team-name-zelle" />
        {tage.map((t, i) =>
          i % 7 === 0 ? (
            <span key={t} className="team-kw-label" style={{ gridColumn: `${i + 2} / span 7` }}>KW {kalenderwoche(t)}</span>
          ) : null,
        )}
      </div>
      <div className="team-zeile team-tage" role="row">
        <span className="team-name-zelle gedaempft klein">Techniker</span>
        {tage.map((t, i) => (
          <span key={t} className={`team-tag${istWochenende(t) ? ' wochenende' : ''}${t === heuteIso ? ' heute' : ''}`} style={{ gridColumn: i + 2 }} title={feiertage.get(t)}>
            {istWochenende(t) ? (
              WOCHENTAGE[i % 7][0]
            ) : (
              <>
                <small>{WOCHENTAGE[i % 7]}</small>
                <strong>{Number(t.slice(8))}.</strong>
              </>
            )}
          </span>
        ))}
      </div>
      {daten.mitarbeiter.map((m) => {
        const eintraege = daten.eintraege.filter((e) => e.mitarbeiter_id === m.id)
        const bereitschaft = daten.bereitschaften.filter((b) => b.mitarbeiter_id === m.id)
        return (
          <div key={m.id} className={`team-zeile team-person${m.darf_bearbeiten ? '' : ' nur-lesen'}`} role="row">
            <div className="team-name-zelle">
              <span className="avatar mini">{initialen(m)}</span>
              <span className="team-name-text">
                <Link to={`/mitarbeiter/${m.id}`}><strong>{name(m)}</strong></Link>
                {m.funktion && <small>{m.funktion}</small>}
              </span>
            </div>
            {tage.map((t, i) => (
              <TagZelle
                key={t}
                datum={t}
                spalte={i + 2}
                mitarbeiterId={m.id}
                feiertag={feiertage.get(t)}
                gesperrt={!m.darf_bearbeiten || istWochenende(t) || feiertage.has(t)}
              />
            ))}
            {eintraege.map((e) => {
              const { a, b, gridColumn } = ausschnitt(e.start_datum, e.ende_datum)
              return (
                <TeamSegment
                  key={e.id}
                  eintrag={e}
                  gridColumn={gridColumn}
                  ersterTeil={a === e.start_datum}
                  letzterTeil={b === e.ende_datum}
                  darfBearbeiten={m.darf_bearbeiten}
                  onKlick={() => onEintragKlick(e)}
                />
              )
            })}
            {bereitschaft.map((x) => (
              <span key={x.id} className="team-bereitschaft" style={{ gridColumn: ausschnitt(x.start_datum, x.ende_datum).gridColumn }} title="Bereitschaft" />
            ))}
          </div>
        )
      })}
    </div>
  )
}

function TagZelle({ datum, spalte, mitarbeiterId, feiertag, gesperrt }: {
  datum: string
  spalte: number
  mitarbeiterId: number
  feiertag?: string
  gesperrt: boolean
}) {
  const { setNodeRef, isOver, active } = useDroppable({
    id: `z-${mitarbeiterId}-${datum}`,
    data: { datum, mitarbeiter_id: mitarbeiterId },
    disabled: gesperrt,
  })
  const klassen = ['team-zelle']
  if (istWochenende(datum)) klassen.push('wochenende')
  if (feiertag) klassen.push('feiertag')
  if (isOver) klassen.push('ziel')
  if (active && !gesperrt) klassen.push('ablegbar')
  return <div ref={setNodeRef} className={klassen.join(' ')} style={{ gridColumn: spalte }} title={feiertag} />
}

function TeamSegment({ eintrag, gridColumn, ersterTeil, letzterTeil, darfBearbeiten, onKlick }: {
  eintrag: Planungseintrag
  gridColumn: string
  ersterTeil: boolean
  letzterTeil: boolean
  darfBearbeiten: boolean
  onKlick: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `e-${eintrag.id}`,
    data: { art: 'eintrag', eintrag } satisfies DragDaten,
    disabled: !darfBearbeiten,
  })
  const klassen = ['segment-eintrag', 'team-segment']
  if (!ersterTeil) klassen.push('fortsetzung-links')
  if (!letzterTeil) klassen.push('fortsetzung-rechts')
  if (isDragging) klassen.push('zieht')
  return (
    <div
      ref={setNodeRef}
      className={klassen.join(' ')}
      style={{ gridColumn, background: eintrag.farbe, color: textAuf(eintrag.farbe) }}
      {...listeners}
      {...attributes}
      role="button"
      title={[eintrag.titel, eintrag.untertitel].filter(Boolean).join(' · ')}
      aria-label={`${eintrag.titel}, ${kurz(eintrag.start_datum)} bis ${kurz(eintrag.ende_datum)}`}
      onClick={onKlick}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onKlick()
        listeners?.onKeyDown?.(e)
      }}
    >
      {darfBearbeiten && ersterTeil && <Griff eintrag={eintrag} kante="start" />}
      <span className="segment-titel">{eintrag.titel}</span>
      {eintrag.untertitel && <span className="segment-untertitel">{eintrag.untertitel}</span>}
      {darfBearbeiten && letzterTeil && <Griff eintrag={eintrag} kante="ende" />}
    </div>
  )
}

// ---------- Aufträge rechts ----------

function AuftragsPanel({ abwesenheiten, onSchliessen }: { abwesenheiten: Abwesenheitsart[]; onSchliessen: () => void }) {
  const [q, setQ] = useState('')
  const [auftraege, setAuftraege] = useState<AuftragKurz[] | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => {
      api
        .get<{ auftraege: AuftragKurz[] }>(`/api/auftraege/suche?q=${encodeURIComponent(q)}`)
        .then((r) => setAuftraege(r.auftraege))
        .catch(() => setAuftraege([]))
    }, 200)
    return () => window.clearTimeout(t)
  }, [q])

  return (
    <aside className="karte team-panel" aria-label="Aufträge und Abwesenheiten">
      <div className="zeile-zwischen">
        <h2 className="abschnitt-titel">Auf einen Tag ziehen</h2>
        <button type="button" className="icon-knopf klein" aria-label="Aufträge ausblenden" onClick={onSchliessen}>
          <Icon name="rechts" size={16} />
        </button>
      </div>
      <div className="chip-liste">
        {abwesenheiten.map((a) => {
          const farbe = a.farbe || '#64748b'
          return (
            <ZiehChip
              key={a.id}
              id={`b-abw-${a.id}`}
              className="abwesenheit-chip"
              style={{ background: farbe, color: textAuf(farbe) }}
              daten={{
                art: 'baustein',
                quelle_typ: 'abwesenheit',
                quelle_id: a.id,
                label: a.bezeichnung,
                farbe,
                manuell: a.bezeichnung.trim().toLowerCase() === 'manuell',
              }}
            >
              {a.bezeichnung}
            </ZiehChip>
          )
        })}
      </div>
      <div className="bausteine-abschnitt team-auftraege">
        <h3 className="mini-titel">Aufträge</h3>
        <label className="suchfeld">
          <Icon name="suche" size={16} />
          <input type="search" aria-label="Aufträge suchen" placeholder="Auftrag, Kunde, Techniker" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {!auftraege ? (
          <p className="gedaempft klein">Wird geladen …</p>
        ) : auftraege.length === 0 ? (
          <p className="gedaempft klein">Keine offenen Aufträge gefunden.</p>
        ) : (
          <div className="team-auftrag-liste">
            {auftraege.map((a) => <AuftragChip key={a.id} a={a} />)}
          </div>
        )}
      </div>
    </aside>
  )
}
