import { useDraggable, useDroppable } from '@dnd-kit/core'
import { addDays, heute, istWochenende, kalenderwoche, kurz, WOCHENTAGE } from '../datum'
import { textAuf } from '../theme'
import type { PlanungAntwort, Planungseintrag } from '../types'

export type DragDaten =
  | { art: 'baustein'; quelle_typ: 'abwesenheit' | 'auftrag'; quelle_id: number; label: string; farbe: string; manuell?: boolean }
  | { art: 'eintrag'; eintrag: Planungseintrag }
  | { art: 'resize'; kante: 'start' | 'ende'; eintrag: Planungseintrag }

interface Props {
  daten: PlanungAntwort
  wochen: number
  darfBearbeiten: boolean
  onEintragKlick: (e: Planungseintrag) => void
}

function Tag({ datum, feiertag, gesperrt }: { datum: string; feiertag?: string; gesperrt: boolean }) {
  const { setNodeRef, isOver, active } = useDroppable({ id: `t-${datum}`, data: { datum }, disabled: gesperrt })
  const klassen = ['tag-zelle']
  if (istWochenende(datum)) klassen.push('wochenende')
  if (feiertag) klassen.push('feiertag')
  if (isOver) klassen.push('ziel')
  if (active && !gesperrt) klassen.push('ablegbar')
  return (
    <div ref={setNodeRef} className={klassen.join(' ')} title={feiertag}>
      {feiertag && <span className="feiertag-name">{feiertag}</span>}
    </div>
  )
}

function Segment({
  eintrag,
  schluessel,
  spalte,
  ersterTeil,
  letzterTeil,
  darfBearbeiten,
  onKlick,
}: {
  eintrag: Planungseintrag
  schluessel: string
  spalte: string
  ersterTeil: boolean
  letzterTeil: boolean
  darfBearbeiten: boolean
  onKlick: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `e-${schluessel}`,
    data: { art: 'eintrag', eintrag } satisfies DragDaten,
    disabled: !darfBearbeiten,
  })
  const farbe = eintrag.farbe
  const klassen = ['segment-eintrag']
  if (!ersterTeil) klassen.push('fortsetzung-links')
  if (!letzterTeil) klassen.push('fortsetzung-rechts')
  if (isDragging) klassen.push('zieht')
  return (
    <div
      ref={setNodeRef}
      className={klassen.join(' ')}
      style={{ gridColumn: spalte, background: farbe, color: textAuf(farbe) }}
      {...listeners}
      {...attributes}
      role="button"
      aria-label={`${eintrag.titel}, ${kurz(eintrag.start_datum)} bis ${kurz(eintrag.ende_datum)}. Öffnen oder ziehen zum Verschieben.`}
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

function Griff({ eintrag, kante }: { eintrag: Planungseintrag; kante: 'start' | 'ende' }) {
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: `r-${eintrag.id}-${kante}`,
    data: { art: 'resize', kante, eintrag } satisfies DragDaten,
  })
  return (
    <span
      ref={setNodeRef}
      className={`griff griff-${kante}`}
      {...listeners}
      {...attributes}
      role="button"
      aria-label={kante === 'start' ? 'Beginn ändern' : 'Ende ändern'}
      onPointerDown={(e) => {
        listeners?.onPointerDown?.(e)
        e.stopPropagation()
      }}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e)
        e.stopPropagation()
      }}
      onClick={(e) => e.stopPropagation()}
    />
  )
}

export default function Planungskalender({ daten, wochen, darfBearbeiten, onEintragKlick }: Props) {
  const feiertage = new Map(daten.feiertage.map((f) => [f.datum, f.bezeichnung]))
  const heuteIso = heute()

  return (
    <div className="kalender" role="grid" aria-label="Meine Planung">
      <div className="woche kopfzeile" role="row">
        <span />
        {WOCHENTAGE.map((t) => (
          <span key={t} className={t === 'Sa' || t === 'So' ? 'wochenende' : ''}>{t}</span>
        ))}
      </div>
      {Array.from({ length: wochen }, (_, w) => {
        const montag = addDays(daten.von, w * 7)
        const sonntag = addDays(montag, 6)
        const tage = Array.from({ length: 7 }, (_, i) => addDays(montag, i))
        const spalteVon = (iso: string) => tage.indexOf(iso) + 2
        const segmente = daten.eintraege
          .filter((e) => e.start_datum <= sonntag && e.ende_datum >= montag)
          .map((e) => {
            const von = e.start_datum < montag ? montag : e.start_datum
            const bis = e.ende_datum > sonntag ? sonntag : e.ende_datum
            return { e, von, bis, spalte: `${spalteVon(von)} / ${spalteVon(bis) + 1}` }
          })
        const bereitschaften = daten.bereitschaften
          .filter((b) => b.start_datum <= sonntag && b.ende_datum >= montag)
          .map((b) => {
            const von = b.start_datum < montag ? montag : b.start_datum
            const bis = b.ende_datum > sonntag ? sonntag : b.ende_datum
            return { id: b.id, spalte: `${spalteVon(von)} / ${spalteVon(bis) + 1}` }
          })
        return (
          <div key={montag} className="woche" role="row">
            <div className="kw-spalte">
              <strong>KW {kalenderwoche(montag)}</strong>
              {bereitschaften.length > 0 && <span className="bereitschaft-text">Bereitschaft</span>}
            </div>
            {tage.map((t, i) => (
              <span
                key={`d-${t}`}
                className={`tag-datum${t === heuteIso ? ' heute' : ''}${istWochenende(t) ? ' wochenende' : ''}`}
                style={{ gridColumn: i + 2 }}
              >
                <span className="datum-lang">{kurz(t)}</span>
                <span className="datum-kurz">{Number(t.slice(8))}</span>
              </span>
            ))}
            {tage.map((t, i) => (
              <div key={`z-${t}`} className="tag-platz" style={{ gridColumn: i + 2 }}>
                <Tag datum={t} feiertag={feiertage.get(t)} gesperrt={!darfBearbeiten || istWochenende(t) || feiertage.has(t)} />
              </div>
            ))}
            {segmente.map(({ e, von, bis, spalte }) => (
              <Segment
                key={`${e.id}-${montag}`}
                schluessel={`${e.id}-${montag}`}
                eintrag={e}
                spalte={spalte}
                ersterTeil={von === e.start_datum}
                letzterTeil={bis === e.ende_datum}
                darfBearbeiten={darfBearbeiten}
                onKlick={() => onEintragKlick(e)}
              />
            ))}
            {bereitschaften.map((b) => (
              <span key={b.id} className="bereitschaft-band" style={{ gridColumn: b.spalte }} title="Bereitschaft" />
            ))}
          </div>
        )
      })}
    </div>
  )
}
