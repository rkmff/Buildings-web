import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import Dialog from '../components/Dialog'
import Icon from '../components/Icon'
import { kurz } from '../datum'
import { textAuf } from '../theme'

export interface Auftrag {
  id: number
  name: string
  beschreibung: string | null
  status_id: number | null
  status: string | null
  typ_id: number | null
  typ: string | null
  system_id: number | null
  kunde: string | null
  system: string | null
  niederlassung_id: number | null
  techniker_id: number | null
  techniker: string
  farbe: string
  plan_tage: number | null
  plan_stunden: number | null
  wartung_gesamt: number
  wartung_erledigt: number
  wartung_gut: number
  wartung_achtung: number
  wartung_schlecht: number
  wartung_status?: 'geplant' | 'gestartet' | 'pausiert' | 'fertig'
}

interface Stammdaten {
  darf_bearbeiten: boolean
  status: { id: number; name: string }[]
  typen: { id: number; name: string; farbe: string | null }[]
  niederlassungen: { id: number; name: string }[]
  techniker: { id: number; name: string }[]
  systeme: { id: number; kunde: string | null; name: string }[]
}

type Ansicht = 'board' | 'liste'

function gespeicherteAnsicht(): Ansicht {
  try {
    return localStorage.getItem('buildings.auftraege.ansicht') === 'liste' ? 'liste' : 'board'
  } catch {
    return 'board'
  }
}

function initialen(name: string) {
  return name.split(' ').filter(Boolean).map((t) => t[0]).join('').slice(0, 2).toUpperCase()
}

function prozent(a: Auftrag) {
  return a.wartung_gesamt ? Math.round((a.wartung_erledigt / a.wartung_gesamt) * 100) : 0
}

export default function Auftraege() {
  const { id } = useParams()
  const navigate = useNavigate()
  const ausgewaehlt = id ? Number(id) : null
  const [auftraege, setAuftraege] = useState<Auftrag[] | null>(null)
  const [stamm, setStamm] = useState<Stammdaten | null>(null)
  const [ansicht, setAnsichtState] = useState<Ansicht>(gespeicherteAnsicht)
  const [q, setQ] = useState('')
  const [typ, setTyp] = useState('')
  const [nl, setNl] = useState('')
  const [nurMeine, setNurMeine] = useState(false)
  const [storniert, setStorniert] = useState(false)
  const [formular, setFormular] = useState<Auftrag | 'neu' | null>(null)
  const [meldung, setMeldung] = useState('')

  const setAnsicht = (a: Ansicht) => {
    setAnsichtState(a)
    try {
      localStorage.setItem('buildings.auftraege.ansicht', a)
    } catch {
      /* ignorieren */
    }
  }

  const laden = useCallback(async () => {
    const p = new URLSearchParams()
    if (q.trim()) p.set('q', q.trim())
    if (typ) p.set('typ_id', typ)
    if (nl) p.set('niederlassung_id', nl)
    if (nurMeine) p.set('nur_meine', '1')
    if (storniert) p.set('storniert', '1')
    const r = await api.get<{ auftraege: Auftrag[] }>(`/api/auftraege?${p}`)
    setAuftraege(r.auftraege)
  }, [q, typ, nl, nurMeine, storniert])

  useEffect(() => {
    const t = window.setTimeout(() => laden().catch((e) => setMeldung(e.message)), 200)
    return () => window.clearTimeout(t)
  }, [laden])

  useEffect(() => {
    api.get<Stammdaten>('/api/auftraege/stammdaten').then(setStamm).catch((e) => setMeldung(e.message))
  }, [])

  useEffect(() => {
    if (!meldung) return
    const t = window.setTimeout(() => setMeldung(''), 6000)
    return () => window.clearTimeout(t)
  }, [meldung])

  async function statusSetzen(auftrag: Auftrag, statusId: number | null) {
    if (auftrag.status_id === statusId) return
    setAuftraege((l) => l?.map((a) => (a.id === auftrag.id ? { ...a, status_id: statusId } : a)) ?? null)
    try {
      await api.patch(`/api/auftraege/${auftrag.id}/status`, { status_id: statusId })
    } catch (err) {
      setMeldung((err as Error).message)
    }
    await laden()
  }

  const darf = stamm?.darf_bearbeiten ?? false

  return (
    <div className={`auftraege-seite${ausgewaehlt ? ' mit-detail' : ''}`}>
      <div className="seite breit">
        <div className="seiten-kopf">
          <h1 className="seitentitel">Aufträge</h1>
          <div className="werkzeugleiste">
            <div className="segment" role="group" aria-label="Ansicht">
              <button type="button" className={ansicht === 'board' ? 'aktiv' : ''} aria-pressed={ansicht === 'board'} onClick={() => setAnsicht('board')}>Board</button>
              <button type="button" className={ansicht === 'liste' ? 'aktiv' : ''} aria-pressed={ansicht === 'liste'} onClick={() => setAnsicht('liste')}>Liste</button>
            </div>
            {darf && (
              <button type="button" className="knopf primaer" onClick={() => setFormular('neu')}>
                <Icon name="plus" size={16} /> Neuer Auftrag
              </button>
            )}
          </div>
        </div>

        <div className="filterleiste">
          <label className="suchfeld">
            <Icon name="suche" size={16} />
            <input type="search" aria-label="Aufträge suchen" placeholder="Auftrag, Kunde, System, Techniker" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <select aria-label="Typ" value={typ} onChange={(e) => setTyp(e.target.value)}>
            <option value="">Alle Typen</option>
            {stamm?.typen.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select aria-label="Niederlassung" value={nl} onChange={(e) => setNl(e.target.value)}>
            <option value="">Alle Niederlassungen</option>
            {stamm?.niederlassungen.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
          <label className="schalter">
            <input type="checkbox" checked={nurMeine} onChange={(e) => setNurMeine(e.target.checked)} /> Nur meine
          </label>
          <label className="schalter">
            <input type="checkbox" checked={storniert} onChange={(e) => setStorniert(e.target.checked)} /> Stornierte
          </label>
        </div>

        {!auftraege || !stamm ? (
          <p className="gedaempft">Aufträge werden geladen …</p>
        ) : ansicht === 'board' ? (
          <Board auftraege={auftraege} stamm={stamm} storniert={storniert} ausgewaehlt={ausgewaehlt} darf={darf} onStatus={statusSetzen} />
        ) : (
          <Liste auftraege={auftraege} ausgewaehlt={ausgewaehlt} />
        )}
      </div>

      {ausgewaehlt && stamm && (
        <AuftragDetail
          key={ausgewaehlt}
          id={ausgewaehlt}
          stamm={stamm}
          onClose={() => navigate('/auftraege')}
          onBearbeiten={(a) => setFormular(a)}
          onGeaendert={laden}
          onFehler={setMeldung}
        />
      )}

      {formular && stamm && (
        <AuftragFormular
          auftrag={formular === 'neu' ? null : formular}
          stamm={stamm}
          onClose={() => setFormular(null)}
          onGespeichert={async (a) => {
            setFormular(null)
            await laden()
            navigate(`/auftraege/${a.id}`)
          }}
        />
      )}

      {meldung && (
        <div className="toast" role="alert">
          {meldung}
          <button type="button" className="icon-knopf klein" aria-label="Meldung schließen" onClick={() => setMeldung('')}>
            <Icon name="schliessen" size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

/* ---------- Board ---------- */

function Board({ auftraege, stamm, storniert, ausgewaehlt, darf, onStatus }: {
  auftraege: Auftrag[]
  stamm: Stammdaten
  storniert: boolean
  ausgewaehlt: number | null
  darf: boolean
  onStatus: (a: Auftrag, statusId: number | null) => void
}) {
  const [aktiv, setAktiv] = useState<Auftrag | null>(null)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
  )
  const spalten = useMemo(() => {
    const s: { id: number | null; name: string }[] = stamm.status.filter((x) => storniert || x.name.toLowerCase() !== 'storniert')
    if (auftraege.some((a) => a.status_id === null)) s.unshift({ id: null, name: 'Ohne Status' })
    return s
  }, [stamm, storniert, auftraege])

  function onDragEnd(e: DragEndEvent) {
    setAktiv(null)
    const a = e.active.data.current?.auftrag as Auftrag | undefined
    if (!a || !e.over) return
    onStatus(a, (e.over.data.current?.statusId as number | null) ?? null)
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setAktiv((e.active.data.current?.auftrag as Auftrag) ?? null)}
      onDragEnd={onDragEnd}
      onDragCancel={() => setAktiv(null)}
    >
      <div className="board" style={{ gridTemplateColumns: `repeat(${spalten.length}, minmax(260px, 1fr))` }}>
        {spalten.map((s) => {
          const karten = auftraege.filter((a) => a.status_id === s.id)
          return (
            <BoardSpalte key={String(s.id)} statusId={s.id} titel={s.name} anzahl={karten.length}>
              {karten.map((a) => (
                <AuftragKarte key={a.id} a={a} aktiv={a.id === ausgewaehlt} ziehbar={darf} />
              ))}
              {karten.length === 0 && <p className="gedaempft klein spalte-leer">Keine Aufträge</p>}
            </BoardSpalte>
          )
        })}
      </div>
      <DragOverlay dropAnimation={null}>{aktiv && <KartenInhalt a={aktiv} schwebend />}</DragOverlay>
    </DndContext>
  )
}

function BoardSpalte({ statusId, titel, anzahl, children }: { statusId: number | null; titel: string; anzahl: number; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `s-${statusId}`, data: { statusId } })
  return (
    <section ref={setNodeRef} className={`board-spalte${isOver ? ' ziel' : ''}`} aria-label={titel}>
      <div className="board-spalte-kopf">
        <h2>{titel}</h2>
        <span className="mono klein gedaempft">{anzahl}</span>
      </div>
      <div className="board-karten">{children}</div>
    </section>
  )
}

function AuftragKarte({ a, aktiv, ziehbar }: { a: Auftrag; aktiv: boolean; ziehbar: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `a-${a.id}`, data: { auftrag: a }, disabled: !ziehbar })
  return (
    <div ref={setNodeRef} className={`board-karte-huelle${isDragging ? ' zieht' : ''}`} {...listeners} {...attributes} role={undefined} tabIndex={-1}>
      <Link to={`/auftraege/${a.id}`} className={`board-karte${aktiv ? ' aktiv' : ''}`} draggable={false}>
        <KartenInhalt a={a} />
      </Link>
    </div>
  )
}

function KartenInhalt({ a, schwebend }: { a: Auftrag; schwebend?: boolean }) {
  return (
    <div className={`karten-inhalt${schwebend ? ' schwebend' : ''}`}>
      <div className="zeile-zwischen oben">
        <strong>{a.name}</strong>
        {a.typ && <span className="typ-pille" style={{ background: a.farbe, color: textAuf(a.farbe) }}>{a.typ}</span>}
      </div>
      <small className="gedaempft">{[a.kunde, a.system].filter(Boolean).join(' · ')}</small>
      {a.wartung_gesamt > 0 && (
        <div className="fortschritt">
          <div style={{ width: `${prozent(a)}%` }} />
          <span className="mono klein">{a.wartung_erledigt}/{a.wartung_gesamt}</span>
        </div>
      )}
      {a.techniker && (
        <span className="techniker-zeile"><span className="avatar mini">{initialen(a.techniker)}</span>{a.techniker}</span>
      )}
    </div>
  )
}

/* ---------- Liste ---------- */

type Sortierung = { spalte: keyof Auftrag | 'fortschritt'; auf: boolean }

function Liste({ auftraege, ausgewaehlt }: { auftraege: Auftrag[]; ausgewaehlt: number | null }) {
  const [sort, setSort] = useState<Sortierung>({ spalte: 'name', auf: true })
  const navigate = useNavigate()
  const sortiert = useMemo(() => {
    const wert = (a: Auftrag) => (sort.spalte === 'fortschritt' ? (a.wartung_gesamt ? prozent(a) : -1) : a[sort.spalte] ?? '')
    return [...auftraege].sort((x, y) => {
      const a = wert(x)
      const b = wert(y)
      const r = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'de', { numeric: true })
      return sort.auf ? r : -r
    })
  }, [auftraege, sort])

  const kopf = (label: string, spalte: Sortierung['spalte']) => (
    <th aria-sort={sort.spalte === spalte ? (sort.auf ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="sortier-knopf" onClick={() => setSort((s) => ({ spalte, auf: s.spalte === spalte ? !s.auf : true }))}>
        {label} {sort.spalte === spalte ? (sort.auf ? '▲' : '▼') : ''}
      </button>
    </th>
  )

  if (!auftraege.length) return <div className="karte leer">Keine Aufträge gefunden.</div>
  return (
    <div className="karte tab-inhalt">
      <div className="tabelle-rahmen">
        <table className="tabelle klickbar">
          <thead>
            <tr>
              {kopf('Auftrag', 'name')}
              {kopf('Kunde', 'kunde')}
              {kopf('System', 'system')}
              {kopf('Typ', 'typ')}
              {kopf('Status', 'status')}
              {kopf('Verantwortlich', 'techniker')}
              {kopf('Wartung', 'fortschritt')}
            </tr>
          </thead>
          <tbody>
            {sortiert.map((a) => (
              <tr key={a.id} className={a.id === ausgewaehlt ? 'aktiv' : ''} onClick={() => navigate(`/auftraege/${a.id}`)}>
                <td><Link to={`/auftraege/${a.id}`} onClick={(e) => e.stopPropagation()}>{a.name}</Link></td>
                <td>{a.kunde}</td>
                <td>{a.system}</td>
                <td><span className="zeile"><span className="farbpunkt" style={{ background: a.farbe }} />{a.typ}</span></td>
                <td>{a.status || <span className="gedaempft">ohne</span>}</td>
                <td>{a.techniker}</td>
                <td className="mono">{a.wartung_gesamt ? `${a.wartung_erledigt}/${a.wartung_gesamt}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ---------- Detail ---------- */

interface Detaildaten {
  darf_bearbeiten: boolean
  auftrag: Auftrag
  aufgaben: { id: number; titel: string; beschreibung: string | null; status: string; ergebnis: string | null; mitarbeiter_id: number | null; mitarbeiter: string }[]
  planung: { id: number; start_datum: string; ende_datum: string; mitarbeiter_id: number; mitarbeiter: string }[]
  ansprechpartner: { id: number; vorname: string | null; nachname: string | null; funktion: string | null; telefon: string | null; mobil: string | null; email: string | null }[]
}

const AUFGABE_STATUS = [
  { wert: 'offen', label: 'offen' },
  { wert: 'in arbeit', label: 'in Arbeit' },
  { wert: 'erledigt', label: 'erledigt' },
]

export function Befunde({ a }: { a: Auftrag }) {
  const gesamt = a.wartung_gesamt
  const neutral = a.wartung_erledigt - a.wartung_gut - a.wartung_achtung - a.wartung_schlecht
  const offen = gesamt - a.wartung_erledigt
  const teile = [
    { label: 'gut', n: a.wartung_gut, farbe: 'var(--gut)' },
    { label: 'Achtung', n: a.wartung_achtung, farbe: 'var(--achtung)' },
    { label: 'schlecht', n: a.wartung_schlecht, farbe: 'var(--schlecht)' },
    { label: 'neutral', n: neutral, farbe: 'var(--neutral)' },
    { label: 'offen', n: offen, farbe: 'var(--surface-3)' },
  ]
  let pos = 0
  const verlauf = teile
    .map((t) => {
      const von = pos
      pos += (t.n / gesamt) * 100
      return `${t.farbe} ${von}% ${pos}%`
    })
    .join(', ')
  return (
    <div className="befunde">
      <div className="ring" style={{ background: `conic-gradient(${verlauf})` }} role="img" aria-label={`${a.wartung_erledigt} von ${gesamt} Wartungsaufgaben erledigt`}>
        <div><strong>{a.wartung_erledigt}/{gesamt}</strong><small>{prozent(a)} %</small></div>
      </div>
      <ul className="befunde-legende">
        {teile.map((t) => (
          <li key={t.label}><span className="farbpunkt" style={{ background: t.farbe, outline: t.label === 'offen' ? '1px solid var(--line-2)' : undefined }} />{t.n} {t.label}</li>
        ))}
      </ul>
    </div>
  )
}

function AuftragDetail({ id, stamm, onClose, onBearbeiten, onGeaendert, onFehler }: {
  id: number
  stamm: Stammdaten
  onClose: () => void
  onBearbeiten: (a: Auftrag) => void
  onGeaendert: () => Promise<void>
  onFehler: (m: string) => void
}) {
  const [d, setD] = useState<Detaildaten | null>(null)
  const [tab, setTab] = useState<'details' | 'aufgaben' | 'planung' | 'kontakte'>('details')
  const [neueAufgabe, setNeueAufgabe] = useState('')

  const laden = useCallback(async () => {
    try {
      setD(await api.get<Detaildaten>(`/api/auftraege/${id}`))
    } catch (err) {
      onFehler((err as Error).message)
    }
  }, [id, onFehler])

  useEffect(() => {
    laden()
  }, [laden])

  async function aufgabeStatus(aufgabeId: number, status: string) {
    try {
      await api.patch(`/api/aufgaben/${aufgabeId}`, { status })
      await laden()
    } catch (err) {
      onFehler((err as Error).message)
    }
  }

  async function aufgabeAnlegen(e: FormEvent) {
    e.preventDefault()
    if (!neueAufgabe.trim()) return
    try {
      await api.post(`/api/auftraege/${id}/aufgaben`, { titel: neueAufgabe.trim() })
      setNeueAufgabe('')
      await laden()
    } catch (err) {
      onFehler((err as Error).message)
    }
  }

  async function status(statusId: number) {
    try {
      await api.patch(`/api/auftraege/${id}/status`, { status_id: statusId })
      await Promise.all([laden(), onGeaendert()])
    } catch (err) {
      onFehler((err as Error).message)
    }
  }

  return (
    <aside className="detail-spalte" aria-label="Auftragsdetails">
      {!d ? (
        <p className="gedaempft">Wird geladen …</p>
      ) : (
        <>
          <div className="zeile-zwischen">
            <span className="gedaempft klein">{['Auftrag', d.auftrag.typ, d.auftrag.status].filter(Boolean).join(' · ')}</span>
            <button type="button" className="icon-knopf" aria-label="Details schließen" onClick={onClose}><Icon name="schliessen" /></button>
          </div>
          <h2 className="detail-titel">{d.auftrag.name}</h2>
          {d.auftrag.system_id && (
            <Link to={`/objekte/system/${d.auftrag.system_id}`} className="klein">{[d.auftrag.kunde, d.auftrag.system].filter(Boolean).join(' › ')}</Link>
          )}
          {d.auftrag.wartung_gesamt > 0 && <Befunde a={d.auftrag} />}
          <div className="knopf-reihe links">
            {(d.auftrag.typ?.toLowerCase() === 'wartung' || d.auftrag.wartung_gesamt > 0) && (
              <Link to={`/wartung/${d.auftrag.id}`} className="knopf primaer">Wartung ausführen</Link>
            )}
            {d.darf_bearbeiten && <button type="button" className="knopf" onClick={() => onBearbeiten(d.auftrag)}>Bearbeiten</button>}
            {d.darf_bearbeiten && (
              <select aria-label="Status ändern" className="status-wahl" value={d.auftrag.status_id ?? ''} onChange={(e) => status(Number(e.target.value))}>
                {d.auftrag.status_id === null && <option value="">ohne Status</option>}
                {stamm.status.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </div>

          <div className="tabs" role="tablist">
            {([
              ['details', 'Details', null],
              ['aufgaben', 'Aufgaben', d.aufgaben.length],
              ['planung', 'Planung', d.planung.length],
              ['kontakte', 'Kontakte', d.ansprechpartner.length],
            ] as const).map(([k, label, n]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'aktiv' : ''} onClick={() => setTab(k)}>
                {label} {n !== null && <span className="zaehler">{n}</span>}
              </button>
            ))}
          </div>

          {tab === 'details' && (
            <dl className="detail-liste">
              <dt>Verantwortlich</dt><dd>{d.auftrag.techniker || '–'}</dd>
              <dt>Plan</dt><dd>{[d.auftrag.plan_tage ? `${d.auftrag.plan_tage} Tage` : '', d.auftrag.plan_stunden ? `${d.auftrag.plan_stunden} Stunden` : ''].filter(Boolean).join(' · ') || '–'}</dd>
              <dt>Eingeplant</dt><dd>{[...new Set(d.planung.map((p) => p.mitarbeiter))].join(', ') || '–'}</dd>
              <dt>Beschreibung</dt><dd className="mehrzeilig">{d.auftrag.beschreibung || '–'}</dd>
            </dl>
          )}

          {tab === 'aufgaben' && (
            <div className="stapel">
              <form className="inline-formular" onSubmit={aufgabeAnlegen}>
                <input aria-label="Neue Aufgabe" placeholder="Neue Aufgabe …" value={neueAufgabe} onChange={(e) => setNeueAufgabe(e.target.value)} />
                <button type="submit" className="knopf" disabled={!neueAufgabe.trim()}>Hinzufügen</button>
              </form>
              {d.aufgaben.length === 0 && <p className="gedaempft">Noch keine Aufgaben.</p>}
              <ul className="liste">
                {d.aufgaben.map((t) => (
                  <li key={t.id} className="liste-eintrag zeile-zwischen">
                    <span>
                      <span className={t.status === 'erledigt' ? 'durchgestrichen' : ''}>{t.titel}</span>
                      {t.mitarbeiter && <small className="gedaempft block">{t.mitarbeiter}</small>}
                    </span>
                    <select aria-label={`Status von ${t.titel}`} value={t.status} onChange={(e) => aufgabeStatus(t.id, e.target.value)}>
                      {AUFGABE_STATUS.map((s) => <option key={s.wert} value={s.wert}>{s.label}</option>)}
                    </select>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tab === 'planung' && (
            <ul className="liste">
              {d.planung.length === 0 && <li className="gedaempft">Noch niemand eingeplant.</li>}
              {d.planung.map((p) => (
                <li key={p.id} className="liste-eintrag zeile-zwischen">
                  <span>{p.mitarbeiter}</span>
                  <span className="mono klein">{p.start_datum === p.ende_datum ? kurz(p.start_datum) : `${kurz(p.start_datum)} – ${kurz(p.ende_datum)}`}{p.ende_datum.slice(0, 4)}</span>
                </li>
              ))}
            </ul>
          )}

          {tab === 'kontakte' && (
            <ul className="liste">
              {d.ansprechpartner.length === 0 && <li className="gedaempft">Keine Ansprechpartner beim System hinterlegt.</li>}
              {d.ansprechpartner.map((p) => (
                <li key={p.id} className="liste-eintrag">
                  <strong>{[p.vorname, p.nachname].filter(Boolean).join(' ')}</strong>
                  {p.funktion && <small className="gedaempft block">{p.funktion}</small>}
                  <span className="kontakt-links">
                    {p.telefon && <a href={`tel:${p.telefon}`}>{p.telefon}</a>}
                    {p.mobil && <a href={`tel:${p.mobil}`}>{p.mobil}</a>}
                    {p.email && <a href={`mailto:${p.email}`}>{p.email}</a>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </aside>
  )
}

/* ---------- Formular ---------- */

function AuftragFormular({ auftrag, stamm, onClose, onGespeichert }: {
  auftrag: Auftrag | null
  stamm: Stammdaten
  onClose: () => void
  onGespeichert: (a: Auftrag) => void
}) {
  const [werte, setWerte] = useState({
    name: auftrag?.name ?? '',
    system_id: auftrag?.system_id ?? 0,
    typ_id: auftrag?.typ_id ?? stamm.typen[0]?.id ?? 0,
    status_id: auftrag?.status_id ?? stamm.status[0]?.id ?? 0,
    techniker_id: auftrag?.techniker_id ?? 0,
    plan_tage: auftrag?.plan_tage ?? '',
    plan_stunden: auftrag?.plan_stunden ?? '',
    beschreibung: auftrag?.beschreibung ?? '',
    farbe: auftrag?.farbe ?? '',
  })
  const [fehler, setFehler] = useState('')
  const setze = (k: keyof typeof werte, v: string | number) => setWerte((w) => ({ ...w, [k]: v }))

  async function speichern() {
    setFehler('')
    const daten = {
      ...werte,
      system_id: werte.system_id || null,
      typ_id: werte.typ_id || null,
      status_id: werte.status_id || null,
      techniker_id: werte.techniker_id || null,
      plan_tage: werte.plan_tage === '' ? null : Number(werte.plan_tage),
      plan_stunden: werte.plan_stunden === '' ? null : Number(werte.plan_stunden),
      farbe: werte.farbe || null,
    }
    try {
      const r = auftrag
        ? await api.put<{ auftrag: Auftrag }>(`/api/auftraege/${auftrag.id}`, daten)
        : await api.post<{ auftrag: Auftrag }>('/api/auftraege', daten)
      onGespeichert(r.auftrag)
    } catch (err) {
      setFehler((err as Error).message)
    }
  }

  return (
    <Dialog
      titel={auftrag ? 'Auftrag bearbeiten' : 'Neuer Auftrag'}
      onClose={onClose}
      breit
      aktionen={
        <>
          <button type="button" className="knopf" onClick={onClose}>Abbrechen</button>
          <button type="button" className="knopf primaer" disabled={!werte.name.trim() || !werte.system_id} onClick={speichern}>Speichern</button>
        </>
      }
    >
      <label className="feld">
        <span>Name</span>
        <input value={werte.name} maxLength={200} onChange={(e) => setze('name', e.target.value)} />
      </label>
      <label className="feld">
        <span>Kundensystem</span>
        <select value={werte.system_id} onChange={(e) => setze('system_id', Number(e.target.value))}>
          <option value={0}>Bitte wählen …</option>
          {stamm.systeme.map((s) => <option key={s.id} value={s.id}>{[s.kunde, s.name].filter(Boolean).join(' · ')}</option>)}
        </select>
      </label>
      <div className="feld-reihe">
        <label className="feld">
          <span>Typ</span>
          <select value={werte.typ_id} onChange={(e) => setze('typ_id', Number(e.target.value))}>
            {stamm.typen.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="feld">
          <span>Status</span>
          <select value={werte.status_id} onChange={(e) => setze('status_id', Number(e.target.value))}>
            {stamm.status.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </div>
      <label className="feld">
        <span>Verantwortlicher Techniker</span>
        <select value={werte.techniker_id} onChange={(e) => setze('techniker_id', Number(e.target.value))}>
          <option value={0}>Niemand</option>
          {stamm.techniker.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <div className="feld-reihe">
        <label className="feld">
          <span>Geplante Tage</span>
          <input type="number" min={0} value={werte.plan_tage} onChange={(e) => setze('plan_tage', e.target.value)} />
        </label>
        <label className="feld">
          <span>Geplante Stunden</span>
          <input type="number" min={0} value={werte.plan_stunden} onChange={(e) => setze('plan_stunden', e.target.value)} />
        </label>
      </div>
      <label className="feld">
        <span>Farbe in der Planung (leer = Farbe des Typs)</span>
        <span className="zeile">
          <input type="color" className="farbe-klein" value={werte.farbe || '#16a34a'} onChange={(e) => setze('farbe', e.target.value)} />
          {werte.farbe && <button type="button" className="knopf klein" onClick={() => setze('farbe', '')}>Zurücksetzen</button>}
        </span>
      </label>
      <label className="feld">
        <span>Beschreibung</span>
        <textarea rows={4} value={werte.beschreibung} onChange={(e) => setze('beschreibung', e.target.value)} />
      </label>
      {fehler && <p className="fehler" role="alert">{fehler}</p>}
    </Dialog>
  )
}
