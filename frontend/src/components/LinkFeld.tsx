import { useEffect, useState, type DragEvent } from 'react'

/** Liest einen Link aus einem Drag-and-Drop (z. B. Adresszeile oder Link aus Chrome/Edge). */
export function linkAusDrop(e: DragEvent): string {
  const liste = e.dataTransfer.getData('text/uri-list')
  const zeile = liste.split(/\r?\n/).find((z) => z && !z.startsWith('#'))
  return (zeile || e.dataTransfer.getData('text/plain') || '').trim()
}

/** Eingabefeld für einen Link. Ein hineingezogener Link wird sofort gespeichert. */
export default function LinkFeld({ label, wert, darf, onSpeichern }: {
  label: string
  wert: string | null
  darf: boolean
  onSpeichern: (link: string) => Promise<boolean>
}) {
  const [text, setText] = useState(wert ?? '')
  const [ueber, setUeber] = useState(false)
  const [bearbeiten, setBearbeiten] = useState(false)
  useEffect(() => setText(wert ?? ''), [wert])

  const speichern = async (link: string) => {
    if (link === (wert ?? '')) { setBearbeiten(false); return }
    if (await onSpeichern(link)) setBearbeiten(false)
  }
  const fallen = (e: DragEvent) => {
    e.preventDefault()
    setUeber(false)
    const link = linkAusDrop(e)
    if (link && darf) { setText(link); speichern(link) }
  }

  return (
    <div className={`link-feld${ueber ? ' ueber' : ''}`}
      onDragOver={(e) => { if (darf) { e.preventDefault(); setUeber(true) } }}
      onDragLeave={() => setUeber(false)} onDrop={fallen}>
      <span className="link-feld-label">{label}</span>
      {bearbeiten ? (
        <form className="zeile" onSubmit={(e) => { e.preventDefault(); speichern(text.trim()) }}>
          <input autoFocus type="url" value={text} aria-label={label} placeholder="https://…" onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="knopf klein primaer">OK</button>
          <button type="button" className="knopf klein" onClick={() => { setText(wert ?? ''); setBearbeiten(false) }}>Abbrechen</button>
        </form>
      ) : (
        <div className="zeile">
          {wert ? (
            <a href={wert} target="_blank" rel="noreferrer" className="link-feld-wert" title={wert}>{wert}</a>
          ) : (
            <span className="gedaempft klein">{darf ? 'Link hierher ziehen oder eingeben' : 'kein Link'}</span>
          )}
          {darf && (
            <button type="button" className="knopf klein flach" onClick={() => setBearbeiten(true)}>{wert ? 'Ändern' : 'Eingeben'}</button>
          )}
          {darf && wert && (
            <button type="button" className="knopf klein flach" onClick={() => speichern('')}>Entfernen</button>
          )}
        </div>
      )}
    </div>
  )
}
