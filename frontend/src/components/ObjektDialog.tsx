import { useEffect, useState } from 'react'
import { api } from '../api'
import Dialog from './Dialog'

export type ObjektTyp = 'kunde' | 'system' | 'isp' | 'anlage' | 'geraet' | 'ansprechpartner'

interface Feld {
  name: string
  label: string
  typ: 'text' | 'lang' | 'zahl' | 'ganzzahl' | 'bool' | 'auswahl'
  pflicht: boolean
  auswahl?: string
}

interface Option { id: number; label: string }

interface Formular {
  name: string
  felder: Feld[]
  auswahl: Record<string, Option[]>
  eltern: { spalte: string; typ: string; label: string; optionen: Option[] } | null
  werte?: Record<string, unknown>
  eltern_id?: number | null
  verwendung?: { label: string; anzahl: number }[]
}

type Wert = string | number | boolean | null

interface Props {
  typ: ObjektTyp
  /** Bearbeiten: ID des Objekts. Fehlt sie, wird neu angelegt. */
  id?: number
  /** Beim Anlegen: übergeordnetes Objekt (Kunde, System, ISP oder Anlage). */
  elternId?: number | null
  /** Ansprechpartner hängen an einem Kunden oder an einem System. */
  zuordnung?: { kunde_id?: number; system_id?: number }
  onClose: () => void
  onGespeichert: (id: number) => void
  onGeloescht?: () => void
}

function leerWert(f: Feld): Wert {
  return f.typ === 'bool' ? false : ''
}

export default function ObjektDialog({ typ, id, elternId, zuordnung, onClose, onGespeichert, onGeloescht }: Props) {
  const [form, setForm] = useState<Formular | null>(null)
  const [werte, setWerte] = useState<Record<string, Wert>>({})
  const [eltern, setEltern] = useState<number | null>(elternId ?? null)
  const [fehler, setFehler] = useState('')
  const [laeuft, setLaeuft] = useState(false)

  useEffect(() => {
    api
      .get<Formular>(`/api/objekt-formular/${typ}${id ? `?id=${id}` : ''}`)
      .then((f) => {
        setForm(f)
        setWerte(Object.fromEntries(f.felder.map((x) => {
          const v = f.werte?.[x.name]
          if (x.typ === 'bool') return [x.name, !!Number(v ?? 0)]
          return [x.name, v === null || v === undefined ? leerWert(x) : (v as Wert)]
        })))
        if (id && f.eltern_id !== undefined) setEltern(f.eltern_id ?? null)
      })
      .catch((e) => setFehler(e.message))
  }, [typ, id])

  if (!form) {
    return fehler ? (
      <Dialog titel="Fehler" onClose={onClose}><p className="fehler" role="alert">{fehler}</p></Dialog>
    ) : null
  }

  const fehlt = form.felder.filter((f) => f.pflicht && String(werte[f.name] ?? '').trim() === '')
  const speichern = async () => {
    setLaeuft(true)
    setFehler('')
    try {
      const body: Record<string, unknown> = { werte }
      if (form.eltern) body.eltern_id = eltern
      if (!id && zuordnung) Object.assign(body, zuordnung)
      const r = id
        ? await api.put<{ id: number }>(`/api/objekte/${typ}/${id}`, body)
        : await api.post<{ id: number }>(`/api/objekte/${typ}`, body)
      onGespeichert(r.id)
    } catch (e) {
      setFehler((e as Error).message)
      setLaeuft(false)
    }
  }
  const loeschen = async () => {
    if (!id || !window.confirm(`${form.name} wirklich löschen?`)) return
    try {
      await api.del(`/api/objekte/${typ}/${id}`)
      onGeloescht?.()
    } catch (e) {
      setFehler((e as Error).message)
    }
  }

  const setze = (name: string, v: Wert) => setWerte((w) => ({ ...w, [name]: v }))
  const eingabe = (f: Feld) => {
    const v = werte[f.name]
    if (f.typ === 'bool') {
      return (
        <label key={f.name} className="schalter">
          <input type="checkbox" checked={!!v} onChange={(e) => setze(f.name, e.target.checked)} />
          <span>{f.label}</span>
        </label>
      )
    }
    const label = `${f.label}${f.pflicht ? ' *' : ''}`
    if (f.typ === 'lang') {
      return (
        <label key={f.name} className="feld breit">
          <span>{label}</span>
          <textarea rows={3} value={String(v ?? '')} onChange={(e) => setze(f.name, e.target.value)} />
        </label>
      )
    }
    if (f.typ === 'auswahl') {
      return (
        <label key={f.name} className="feld">
          <span>{label}</span>
          <select value={v === null || v === '' ? '' : String(v)} onChange={(e) => setze(f.name, e.target.value ? Number(e.target.value) : '')}>
            <option value="">–</option>
            {(form.auswahl[f.auswahl!] ?? []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
      )
    }
    return (
      <label key={f.name} className="feld">
        <span>{label}</span>
        <input
          value={String(v ?? '')}
          inputMode={f.typ === 'zahl' || f.typ === 'ganzzahl' ? 'decimal' : undefined}
          onChange={(e) => setze(f.name, e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !fehlt.length) speichern() }}
        />
      </label>
    )
  }

  const benutzt = form.verwendung ?? []
  const verwendungText = benutzt.map((b) => `${b.anzahl} ${b.label}`).join(', ')

  return (
    <Dialog
      titel={id ? `${form.name} bearbeiten` : `${form.name} anlegen`}
      onClose={onClose}
      breit
      aktionen={
        <>
          {id && onGeloescht && (
            <button type="button" className="knopf gefahr" onClick={loeschen} disabled={benutzt.length > 0}
              title={benutzt.length ? `Wird noch verwendet: ${verwendungText}` : undefined}>
              Löschen
            </button>
          )}
          <span className="abstand" />
          <button type="button" className="knopf" onClick={onClose}>Abbrechen</button>
          <button type="button" className="knopf primaer" disabled={laeuft || fehlt.length > 0 || (!!form.eltern && !eltern)} onClick={speichern}>
            Speichern
          </button>
        </>
      }
    >
      {form.eltern && (
        <label className="feld">
          <span>{form.eltern.label} *</span>
          <select value={eltern ?? ''} onChange={(e) => setEltern(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Bitte wählen</option>
            {form.eltern.optionen.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
      )}
      <div className="formular-raster">{form.felder.map(eingabe)}</div>
      {id && benutzt.length > 0 && (
        <p className="gedaempft klein">Löschen geht erst, wenn nichts mehr daran hängt. Verwendet von: {verwendungText}.</p>
      )}
      {fehler && <p className="fehler" role="alert">{fehler}</p>}
    </Dialog>
  )
}
