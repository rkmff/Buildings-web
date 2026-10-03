import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react'
import { api } from '../api'
import { lang } from '../datum'
import Icon from './Icon'

export interface RasterFoto {
  id: number
  originalname?: string | null
  beschreibung?: string | null
  aufnahmedatum?: string | null
}

/** Bilder aus der Zwischenablage (Strg+V) als Dateien mit Zeitstempel im Namen */
export function bilderAusZwischenablage(e: ClipboardEvent): File[] {
  const stempel = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')
  return Array.from(e.clipboardData.items)
    .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    .map((i) => i.getAsFile())
    .filter((f): f is File => !!f)
    .map((f, n) => new File([f], `Screenshot_${stempel}${n ? `_${n + 1}` : ''}.${f.type.split('/')[1] || 'png'}`, { type: f.type }))
}

/**
 * Einheitliche Fotoablage: Raster mit Fotos, Kachel zum Aufnehmen/Auswählen und Kachel zum
 * Einfügen eines Screenshots (Strg+V). Bilder können auch in den ganzen Bereich gezogen werden.
 */
export function FotoRaster<T extends RasterFoto>({ fotos, darf, onDateien, onLoeschen, darfLoeschen, extra, leer }: {
  fotos: T[]
  darf: boolean
  onDateien: (dateien: File[]) => Promise<void>
  onLoeschen?: (f: T) => void
  darfLoeschen?: (f: T) => boolean
  extra?: (f: T) => ReactNode
  leer?: string
}) {
  const eingabe = useRef<HTMLInputElement>(null)
  const [laeuft, setLaeuft] = useState(false)
  const [ueber, setUeber] = useState(false)

  const hochladen = async (dateien: File[]) => {
    const bilder = dateien.filter((d) => d.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|heic)$/i.test(d.name))
    if (!bilder.length || laeuft) return
    setLaeuft(true)
    try {
      await onDateien(bilder)
    } finally {
      setLaeuft(false)
      if (eingabe.current) eingabe.current.value = ''
    }
  }
  const einfuegen = (e: ClipboardEvent) => {
    if (!darf) return
    const bilder = bilderAusZwischenablage(e)
    if (!bilder.length) return
    e.preventDefault()
    hochladen(bilder)
  }
  const fallen = (e: DragEvent) => {
    e.preventDefault()
    setUeber(false)
    if (darf && e.dataTransfer.files.length) hochladen(Array.from(e.dataTransfer.files))
  }

  return (
    <div
      className={`foto-ablage${ueber ? ' ueber' : ''}`}
      onPaste={einfuegen}
      onDragOver={(e) => { if (darf && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setUeber(true) } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setUeber(false) }}
      onDrop={fallen}
    >
      {!darf && fotos.length === 0 && <p className="gedaempft">{leer ?? 'Keine Fotos vorhanden.'}</p>}
      <div className="wartung-fotos">
        {fotos.map((f) => (
          <figure key={f.id} className="wartung-foto">
            <a href={`/api/fotos/${f.id}/datei`} target="_blank" rel="noreferrer">
              <img src={`/api/fotos/${f.id}/datei`} alt={f.beschreibung || f.originalname || 'Foto'} loading="lazy" />
            </a>
            <figcaption className="zeile-zwischen">
              <span className="foto-zusatz">
                {extra ? extra(f) : <small className="gedaempft">{f.beschreibung || lang(f.aufnahmedatum) || ''}</small>}
              </span>
              {onLoeschen && (darfLoeschen ? darfLoeschen(f) : darf) && (
                <button type="button" className="icon-knopf klein" aria-label="Foto löschen" onClick={() => onLoeschen(f)}>
                  <Icon name="papierkorb" size={15} />
                </button>
              )}
            </figcaption>
          </figure>
        ))}
        {darf && (
          <>
            <button type="button" className="foto-neu" onClick={() => eingabe.current?.click()} disabled={laeuft}>
              <Icon name="foto" size={22} />
              <span>{laeuft ? 'Lädt hoch …' : 'Foto aufnehmen, wählen oder hierher ziehen'}</span>
            </button>
            <div className="foto-neu einfuege-zone nur-desktop" tabIndex={0} role="button" aria-label="Screenshot einfügen: hier klicken, dann Strg+V">
              <span className="mono">Strg+V</span>
              <span>Screenshot hier einfügen</span>
            </div>
          </>
        )}
      </div>
      <input ref={eingabe} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && hochladen(Array.from(e.target.files))} />
    </div>
  )
}

export type FotoArt = 'kunde' | 'system' | 'isp' | 'anlage' | 'geraet' | 'auftrag' | 'aufgabe' | 'ausruestung'

interface ObjektFoto extends RasterFoto {
  hochgeladen_am: string | null
  erstellt_von: string | null
  darf_loeschen: boolean
}

/** Fotos eines Objekts laden, hochladen und löschen. */
export default function ObjektFotos({ art, id, onAnzahl }: { art: FotoArt; id: number; onAnzahl?: (n: number) => void }) {
  const [fotos, setFotos] = useState<ObjektFoto[] | null>(null)
  const [darf, setDarf] = useState(false)
  const [fehler, setFehler] = useState('')
  const anzahl = useRef(onAnzahl)
  anzahl.current = onAnzahl

  const uebernehmen = (liste: ObjektFoto[]) => {
    setFotos(liste)
    anzahl.current?.(liste.length)
  }
  const laden = useCallback(() => {
    api
      .get<{ fotos: ObjektFoto[]; darf_hochladen: boolean }>(`/api/objektfotos/${art}/${id}`)
      .then((r) => {
        setFotos(r.fotos)
        setDarf(r.darf_hochladen)
      })
      .catch((e) => setFehler(e.message))
  }, [art, id])
  useEffect(laden, [laden])

  const hochladen = async (dateien: File[]) => {
    const daten = new FormData()
    for (const d of dateien) daten.append('fotos', d)
    setFehler('')
    try {
      const r = await api.hochladen<{ fotos: ObjektFoto[] }>(`/api/objektfotos/${art}/${id}`, daten)
      uebernehmen(r.fotos)
    } catch (e) {
      setFehler((e as Error).message)
    }
  }
  const loeschen = async (f: ObjektFoto) => {
    if (!window.confirm('Foto löschen?')) return
    try {
      await api.del(`/api/fotos/${f.id}`)
      uebernehmen((fotos ?? []).filter((x) => x.id !== f.id))
    } catch (e) {
      setFehler((e as Error).message)
    }
  }

  if (!fotos) return <p className="gedaempft">{fehler || 'Wird geladen …'}</p>
  return (
    <div className="objekt-fotos">
      {fehler && <p className="fehler" role="alert">{fehler}</p>}
      <FotoRaster fotos={fotos} darf={darf} onDateien={hochladen} onLoeschen={loeschen} darfLoeschen={(f) => f.darf_loeschen} />
    </div>
  )
}
