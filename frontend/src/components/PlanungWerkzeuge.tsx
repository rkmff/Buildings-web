import { pointerWithin, rectIntersection, type CollisionDetection } from '@dnd-kit/core'
import { useState } from 'react'
import { kurz, lang } from '../datum'
import { textAuf } from '../theme'
import type { Abwesenheitsart, Planungseintrag } from '../types'
import Dialog from './Dialog'
import Icon from './Icon'
import type { DragDaten } from './Planungskalender'

/** Gemeinsame Bausteine für persönliche Planung und Team-Wochenplanung. */

export const kollision: CollisionDetection = (args) => {
  const treffer = pointerWithin(args)
  return treffer.length ? treffer : rectIntersection(args)
}

export function ZiehVorschau({ daten }: { daten: DragDaten }) {
  if (daten.art === 'baustein') {
    return <div className="zieh-vorschau" style={{ background: daten.farbe, color: textAuf(daten.farbe) }}>{daten.label}</div>
  }
  if (daten.art === 'eintrag') {
    const f = daten.eintrag.farbe
    return <div className="zieh-vorschau" style={{ background: f, color: textAuf(f) }}>{daten.eintrag.titel}</div>
  }
  return <div className="zieh-vorschau rand">{daten.kante === 'start' ? 'Neuer Beginn' : 'Neues Ende'}</div>
}

export function EintragDialog({ eintrag, abwesenheiten, darfBearbeiten, onClose, onSpeichern, onLoeschen }: {
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

export function ManuellDialog({ datum, onClose, onAnlegen }: {
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
