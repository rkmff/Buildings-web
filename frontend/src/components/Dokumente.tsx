import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { api } from '../api'
import { lang } from '../datum'
import Icon from './Icon'

export type DokumentArt = 'ausruestung' | 'isp' | 'anlage' | 'geraet' | 'auftrag' | 'aufgabe'

interface Dokument {
  id: number
  name: string
  typ: string | null
  beschreibung: string | null
  hochgeladen_am: string | null
  erstellt_von: string | null
  darf_loeschen: boolean
}

/** Dokumentliste mit Ablagefläche: Dateien hineinziehen oder auswählen. */
export default function Dokumente({ art, id, onAnzahl }: { art: DokumentArt; id: number; onAnzahl?: (n: number) => void }) {
  const [liste, setListe] = useState<Dokument[] | null>(null)
  const [darf, setDarf] = useState(false)
  const [ueber, setUeber] = useState(false)
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')
  const eingabe = useRef<HTMLInputElement>(null)
  const anzahl = useRef(onAnzahl)
  anzahl.current = onAnzahl

  const laden = useCallback(() => {
    api
      .get<{ dokumente: Dokument[]; darf_hochladen: boolean }>(`/api/dokumente/${art}/${id}`)
      .then((r) => {
        setListe(r.dokumente)
        setDarf(r.darf_hochladen)
        anzahl.current?.(r.dokumente.length)
      })
      .catch((e) => setFehler(e.message))
  }, [art, id])
  useEffect(laden, [laden])

  const hochladen = async (dateien: FileList | File[]) => {
    if (!dateien.length) return
    const daten = new FormData()
    for (const d of Array.from(dateien)) daten.append('dateien', d)
    setLaeuft(true)
    setFehler('')
    try {
      await api.hochladen(`/api/dokumente/${art}/${id}`, daten)
      laden()
    } catch (e) {
      setFehler((e as Error).message)
    }
    setLaeuft(false)
    if (eingabe.current) eingabe.current.value = ''
  }

  const fallen = (e: DragEvent) => {
    e.preventDefault()
    setUeber(false)
    if (darf && e.dataTransfer.files.length) hochladen(e.dataTransfer.files)
  }

  const loeschen = async (d: Dokument) => {
    if (!window.confirm(`„${d.name}“ löschen?`)) return
    try {
      await api.del(`/api/dokumente/${d.id}`)
      laden()
    } catch (e) {
      setFehler((e as Error).message)
    }
  }

  return (
    <div
      className={`dokumente${ueber ? ' ueber' : ''}`}
      onDragOver={(e) => { if (darf && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setUeber(true) } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setUeber(false) }}
      onDrop={fallen}
    >
      {darf && (
        <button type="button" className="ablage" onClick={() => eingabe.current?.click()} disabled={laeuft}>
          <Icon name="bericht" size={20} />
          <span>{laeuft ? 'Wird hochgeladen …' : 'Dateien hierher ziehen oder klicken zum Auswählen'}</span>
        </button>
      )}
      <input ref={eingabe} type="file" multiple hidden onChange={(e) => e.target.files && hochladen(e.target.files)} />
      {fehler && <p className="fehler" role="alert">{fehler}</p>}
      {liste === null ? (
        <p className="gedaempft">Wird geladen …</p>
      ) : liste.length === 0 ? (
        <p className="gedaempft">Keine Dokumente.</p>
      ) : (
        <ul className="dokument-liste">
          {liste.map((d) => (
            <li key={d.id}>
              <a href={`/api/dokumente/${d.id}/datei?anzeigen=1`} target="_blank" rel="noreferrer">
                <span className="datei-typ mono">{(d.typ || '?').slice(0, 4).toUpperCase()}</span>
                <span>
                  <strong>{d.name}</strong>
                  <small className="gedaempft block">
                    {[d.beschreibung, lang(d.hochgeladen_am?.slice(0, 10)), d.erstellt_von].filter(Boolean).join(' · ')}
                  </small>
                </span>
              </a>
              {d.darf_loeschen && (
                <button type="button" className="icon-knopf klein" aria-label={`${d.name} löschen`} onClick={() => loeschen(d)}>
                  <Icon name="papierkorb" size={15} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
