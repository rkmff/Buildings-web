import { useDraggable } from '@dnd-kit/core'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { api } from '../api'
import { textAuf } from '../theme'
import type { Abwesenheitsart, AuftragKurz } from '../types'
import type { DragDaten } from './Planungskalender'
import Icon from './Icon'

export function ZiehChip({ id, daten, children, className, style, title }: {
  id: string
  title?: string
  daten: DragDaten
  children: ReactNode
  className: string
  style?: CSSProperties
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data: daten })
  return (
    <div ref={setNodeRef} className={`${className}${isDragging ? ' zieht' : ''}`} style={style} title={title} {...listeners} {...attributes}>
      {children}
    </div>
  )
}

export function AuftragChip({ a, onEntfernen }: { a: AuftragKurz; onEntfernen?: () => void }) {
  const fortschritt = a.wartung_gesamt ? `${a.wartung_erledigt}/${a.wartung_gesamt}` : ''
  return (
    <ZiehChip
      id={`b-auf-${a.id}`}
      className="auftrag-baustein"
      daten={{ art: 'baustein', quelle_typ: 'auftrag', quelle_id: a.id, label: a.name, farbe: a.farbe }}
    >
      <span className="farbpunkt" style={{ background: a.farbe }} />
      <span className="auftrag-baustein-text">
        <strong>{a.name}</strong>
        <small>{[a.kunde, a.system !== a.kunde ? a.system : null].filter(Boolean).join(' · ')}</small>
      </span>
      {fortschritt && <span className="mono klein">{fortschritt}</span>}
      {onEntfernen && (
        <button
          type="button"
          className="icon-knopf klein"
          aria-label={`${a.name} aus der Liste entfernen`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onEntfernen}
        >
          <Icon name="schliessen" size={14} />
        </button>
      )}
    </ZiehChip>
  )
}

/** Kurzzeichen einer Abwesenheit (aus den Stammdaten, sonst Anfangsbuchstabe), z. B. u = Urlaub geplant, U = Urlaub genehmigt */
export function abwKuerzel(a: Abwesenheitsart) {
  return (a.kuerzel || '').trim() || a.bezeichnung.trim().charAt(0).toUpperCase() || '?'
}

/** Kleine Ziehknöpfe für Abwesenheiten: nur das Kürzel, der Name steht im Tooltip. */
export function AbwesenheitChips({ abwesenheiten }: { abwesenheiten: Abwesenheitsart[] }) {
  return (
    <div className="chip-liste">
      {abwesenheiten.map((a) => {
        const farbe = a.farbe || '#64748b'
        return (
          <ZiehChip
              key={a.id}
              title={a.bezeichnung}
              id={`b-abw-${a.id}`}
              className="abwesenheit-chip kurz"
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
              <span aria-hidden="true">{abwKuerzel(a)}</span>
              <span className="sr-only">{a.bezeichnung}</span>
            </ZiehChip>
        )
      })}
    </div>
  )
}

interface Props {
  abwesenheiten: Abwesenheitsart[]
  auftraege: AuftragKurz[]
}

export default function Bausteine({ abwesenheiten, auftraege }: Props) {
  const [q, setQ] = useState('')
  const [treffer, setTreffer] = useState<AuftragKurz[] | null>(null)
  const suche = q.trim()

  // Mit Suchbegriff werden alle offenen Aufträge durchsucht, nicht nur die eigenen
  useEffect(() => {
    if (!suche) {
      setTreffer(null)
      return
    }
    const t = window.setTimeout(() => {
      api
        .get<{ auftraege: AuftragKurz[] }>(`/api/auftraege/suche?q=${encodeURIComponent(suche)}`)
        .then((r) => setTreffer(r.auftraege))
        .catch(() => setTreffer([]))
    }, 200)
    return () => window.clearTimeout(t)
  }, [suche])

  return (
    <aside className="karte bausteine" aria-label="Bausteine für die Planung">
      <div>
        <h2 className="abschnitt-titel">Auf einen Tag ziehen</h2>
        <p className="gedaempft klein">Abwesenheiten und Aufträge in den Kalender ziehen.</p>
      </div>
      <AbwesenheitChips abwesenheiten={abwesenheiten} />
      <div className="bausteine-abschnitt">
        <label className="suchfeld">
          <Icon name="suche" size={16} />
          <input type="search" aria-label="Alle Aufträge durchsuchen" placeholder="Alle Aufträge durchsuchen" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {suche ? (
          <>
            <h3 className="mini-titel">Alle Aufträge{treffer ? ` · ${treffer.length}${treffer.length === 100 ? '+' : ''}` : ''}</h3>
            {treffer === null && <p className="gedaempft klein">Suche …</p>}
            {treffer?.length === 0 && <p className="gedaempft klein">Keine offenen Aufträge gefunden.</p>}
            {treffer?.map((a) => <AuftragChip key={a.id} a={a} />)}
          </>
        ) : (
          <>
            <h3 className="mini-titel">Meine Aufträge</h3>
            {auftraege.length === 0 && <p className="gedaempft klein">Dir sind keine offenen Aufträge zugeordnet.</p>}
            {auftraege.map((a) => <AuftragChip key={a.id} a={a} />)}
          </>
        )}
      </div>
    </aside>
  )
}
