import { useDraggable } from '@dnd-kit/core'
import type { CSSProperties, ReactNode } from 'react'
import { textAuf } from '../theme'
import type { Abwesenheitsart, AuftragKurz } from '../types'
import type { DragDaten } from './Planungskalender'
import Icon from './Icon'

function ZiehChip({ id, daten, children, className, style }: {
  id: string
  daten: DragDaten
  children: ReactNode
  className: string
  style?: CSSProperties
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data: daten })
  return (
    <div ref={setNodeRef} className={`${className}${isDragging ? ' zieht' : ''}`} style={style} {...listeners} {...attributes}>
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
        <small>{[a.kunde, a.system].filter(Boolean).join(' · ')}</small>
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

interface Props {
  abwesenheiten: Abwesenheitsart[]
  auftraege: AuftragKurz[]
  weitere: AuftragKurz[]
  onWeitereEntfernen: (id: number) => void
  onAlleAuftraege: () => void
}

export default function Bausteine({ abwesenheiten, auftraege, weitere, onWeitereEntfernen, onAlleAuftraege }: Props) {
  return (
    <aside className="karte bausteine" aria-label="Bausteine für die Planung">
      <div>
        <h2 className="abschnitt-titel">Auf einen Tag ziehen</h2>
        <p className="gedaempft klein">Abwesenheiten und Aufträge in den Kalender ziehen.</p>
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
      <div className="bausteine-abschnitt">
        <h3 className="mini-titel">Meine Aufträge</h3>
        {auftraege.length === 0 && <p className="gedaempft klein">Dir sind keine offenen Aufträge zugeordnet.</p>}
        {auftraege.map((a) => <AuftragChip key={a.id} a={a} />)}
        {weitere.length > 0 && <h3 className="mini-titel">Weitere Aufträge</h3>}
        {weitere.map((a) => <AuftragChip key={a.id} a={a} onEntfernen={() => onWeitereEntfernen(a.id)} />)}
        <button type="button" className="knopf breit" onClick={onAlleAuftraege}>
          <Icon name="suche" size={16} /> Alle Aufträge
        </button>
      </div>
    </aside>
  )
}
