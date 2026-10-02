import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import Dialog from '../components/Dialog'
import Icon from '../components/Icon'

interface Vorlage {
  id: number
  kurzbezeichnung: string
  langtext: string | null
  zeitvorgabe: number
  aufgabentyp: string
  warn_grenze: number
  rot_grenze: number
  gilt_fuer_anlagen: number
  gilt_fuer_geraete: number
  vdma_position: string | null
  taetigkeit: string | null
  verwendet: number
}

interface Typ { id: number; name: string; kurz?: string | null; anzahl: number; pflichtig?: number }

interface Daten {
  darf_bearbeiten: boolean
  aufgabentypen: { id: string; label: string }[]
  taetigkeiten: string[]
  vorlagen: Vorlage[]
  anlagentypen: Typ[]
  geraetearten: Typ[]
  matrix: { anlagen: [number, number][]; geraete: [number, number][] }
  luecken: { anlagen_ohne_typ: number; geraete_ohne_art: number; geraete_nicht_pflichtig: number }
}

type Tab = 'vorlagen' | 'anlagen' | 'geraete' | 'luecken'

function minuten(m: number) {
  if (!m) return '–'
  const h = Math.floor(m / 60)
  const r = Math.round(m % 60)
  return h ? `${h} h${r ? ` ${r} min` : ''}` : `${r} min`
}

export { minuten }

export default function Wartungsvorlagen({ eingebettet = false }: { eingebettet?: boolean }) {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'vorlagen'
  const [daten, setDaten] = useState<Daten | null>(null)
  const [meldung, setMeldung] = useState('')

  const laden = useCallback(() => {
    api.get<Daten>('/api/wartungsvorlagen').then(setDaten).catch((e) => setMeldung(e.message))
  }, [])
  useEffect(laden, [laden])

  if (!daten) return <div className="seite"><p className="gedaempft">{meldung || 'Wird geladen …'}</p></div>
  const lueckenGesamt = daten.luecken.anlagen_ohne_typ

  const tabs: [Tab, string, number | null][] = [
    ['vorlagen', 'Vorlagen', daten.vorlagen.length],
    ['anlagen', 'Matrix Anlagentypen', daten.matrix.anlagen.length],
    ['geraete', 'Matrix Gerätearten', daten.matrix.geraete.length],
    ['luecken', 'Typen & Wartungspflicht', lueckenGesamt],
  ]

  return (
    <div className={eingebettet ? 'wartungsvorlagen' : 'seite'}>
      <div className="seiten-kopf">
        <div>
          {eingebettet ? <h2 className="detail-titel">Wartungsvorlagen</h2> : <h1 className="seitentitel">Wartungsvorlagen</h1>}
          <p className="gedaempft">Welche Aufgaben bei einer Wartung für welche Anlagentypen und Gerätearten entstehen.</p>
        </div>
      </div>
      {!daten.darf_bearbeiten && <p className="gedaempft klein">Vorlagen und Matrizen pflegen Admins und Dispatcher. Lücken kannst du selbst schließen.</p>}
      <div className="tabs" role="tablist">
        {tabs.map(([t, label, n]) => (
          <button key={t} type="button" role="tab" aria-selected={t === tab} className={t === tab ? 'aktiv' : ''}
            onClick={() => setParams(t === 'vorlagen' ? {} : { tab: t })}>
            {label} {n !== null && <span className={`zaehler${t === 'luecken' && n ? ' warnung' : ''}`}>{n}</span>}
          </button>
        ))}
      </div>
      {tab === 'vorlagen' && <VorlagenListe daten={daten} onGeaendert={laden} onMeldung={setMeldung} />}
      {tab === 'anlagen' && <Matrix art="anlagen" daten={daten} onGeaendert={laden} onMeldung={setMeldung} />}
      {tab === 'geraete' && <Matrix art="geraete" daten={daten} onGeaendert={laden} onMeldung={setMeldung} />}
      {tab === 'luecken' && <Luecken daten={daten} onGeaendert={laden} onMeldung={setMeldung} />}
      {meldung && (
        <div className="toast" role="alert">
          <span>{meldung}</span>
          <button type="button" className="icon-knopf klein" aria-label="Meldung schließen" onClick={() => setMeldung('')}>
            <Icon name="schliessen" size={16} />
          </button>
        </div>
      )}
    </div>
  )
}

// ---------- Vorlagen ----------

function VorlagenListe({ daten, onGeaendert, onMeldung }: { daten: Daten; onGeaendert: () => void; onMeldung: (m: string) => void }) {
  const [filter, setFilter] = useState('')
  const [dialog, setDialog] = useState<Vorlage | 'neu' | null>(null)
  const typLabel = Object.fromEntries(daten.aufgabentypen.map((t) => [t.id, t.label]))
  const zuordnungen = (v: Vorlage) =>
    daten.matrix.anlagen.filter(([vid]) => vid === v.id).length + daten.matrix.geraete.filter(([vid]) => vid === v.id).length
  const giltFuer = async (v: Vorlage, feld: 'gilt_fuer_anlagen' | 'gilt_fuer_geraete', an: boolean) => {
    const art = feld === 'gilt_fuer_anlagen' ? 'anlagen' : 'geraete'
    const haken = daten.matrix[art].filter(([vid]) => vid === v.id).length
    if (!an && haken && !window.confirm(`„${v.kurzbezeichnung}“ hat ${haken} Häkchen in der Matrix ${art === 'anlagen' ? 'Anlagentypen' : 'Gerätearten'}. Sie werden entfernt. Weiter?`)) return
    try {
      await api.put(`/api/wartungsvorlagen/${v.id}`, {
        kurzbezeichnung: v.kurzbezeichnung, langtext: v.langtext, zeitvorgabe: v.zeitvorgabe, aufgabentyp: v.aufgabentyp,
        taetigkeit: v.taetigkeit, vdma_position: v.vdma_position, warn_grenze: v.warn_grenze, rot_grenze: v.rot_grenze,
        gilt_fuer_anlagen: !!v.gilt_fuer_anlagen, gilt_fuer_geraete: !!v.gilt_fuer_geraete, [feld]: an,
      })
      onGeaendert()
    } catch (e) {
      onMeldung((e as Error).message)
    }
  }
  const q = filter.trim().toLowerCase()
  const sichtbar = daten.vorlagen.filter((v) => !q || [v.kurzbezeichnung, v.langtext, v.vdma_position].some((x) => x?.toLowerCase().includes(q)))

  return (
    <div className="karte tab-inhalt">
      <div className="tab-aktionen zwischen">
        <label className="suchfeld">
          <Icon name="suche" size={16} />
          <input type="search" aria-label="Vorlagen filtern" placeholder="Vorlage, VDMA-Position" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </label>
        {daten.darf_bearbeiten && (
          <button type="button" className="knopf klein primaer" onClick={() => setDialog('neu')}><Icon name="plus" size={15} /> Vorlage</button>
        )}
      </div>
      <div className="tabelle-rahmen">
        <table className="tabelle">
          <thead>
            <tr><th>Vorlage</th><th>VDMA</th><th>Tätigkeit</th><th>Aufgabentyp</th><th>Zeit</th><th className="zelle-mitte">Gilt für Anlagen</th><th className="zelle-mitte">Gilt für Geräte</th><th>Zuordnungen</th></tr>
          </thead>
          <tbody>
            {sichtbar.map((v) => (
              <tr key={v.id} className={daten.darf_bearbeiten ? 'zeile-klickbar' : undefined} onClick={daten.darf_bearbeiten ? () => setDialog(v) : undefined}>
                <td><strong>{v.kurzbezeichnung}</strong>{v.langtext && <small className="gedaempft block zwei-zeilen">{v.langtext}</small>}</td>
                <td className="mono klein">{v.vdma_position ?? '–'}</td>
                <td>{v.taetigkeit ?? '–'}</td>
                <td>{typLabel[v.aufgabentyp] ?? v.aufgabentyp}</td>
                <td className="nowrap">{minuten(v.zeitvorgabe)}</td>
                {(['gilt_fuer_anlagen', 'gilt_fuer_geraete'] as const).map((feld) => (
                  <td key={feld} className="zelle-mitte" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={!!v[feld]} disabled={!daten.darf_bearbeiten}
                      aria-label={`${v.kurzbezeichnung}: ${feld === 'gilt_fuer_anlagen' ? 'gilt für Anlagen' : 'gilt für Geräte'}`}
                      onChange={(e) => giltFuer(v, feld, e.target.checked)} />
                  </td>
                ))}
                <td>{zuordnungen(v) || <span className="warnung" title="Ohne Zuordnung wird die Vorlage nie erzeugt">keine</span>}</td>
              </tr>
            ))}
            {sichtbar.length === 0 && <tr><td colSpan={8} className="gedaempft">Keine Vorlagen.</td></tr>}
          </tbody>
        </table>
      </div>
      {dialog && (
        <VorlageDialog daten={daten} vorlage={dialog === 'neu' ? undefined : dialog} onClose={() => setDialog(null)}
          onGespeichert={(text) => { setDialog(null); onMeldung(text); onGeaendert() }} />
      )}
    </div>
  )
}

function VorlageDialog({ daten, vorlage, onClose, onGespeichert }: {
  daten: Daten
  vorlage?: Vorlage
  onClose: () => void
  onGespeichert: (meldung: string) => void
}) {
  const v = vorlage
  const [w, setW] = useState({
    kurzbezeichnung: v?.kurzbezeichnung ?? '',
    langtext: v?.langtext ?? '',
    zeitvorgabe: v ? String(v.zeitvorgabe ?? 0).replace('.', ',') : '',
    aufgabentyp: v?.aufgabentyp ?? 'standard',
    taetigkeit: v?.taetigkeit ?? '',
    vdma_position: v?.vdma_position ?? '',
    gilt_fuer_anlagen: v ? !!v.gilt_fuer_anlagen : false,
    gilt_fuer_geraete: v ? !!v.gilt_fuer_geraete : true,
    warn_grenze: v ? String(v.warn_grenze).replace('.', ',') : '0,5',
    rot_grenze: v ? String(v.rot_grenze).replace('.', ',') : '1',
  })
  const [fehler, setFehler] = useState('')
  const setze = <K extends keyof typeof w>(k: K, x: (typeof w)[K]) => setW((a) => ({ ...a, [k]: x }))
  const speichern = async () => {
    try {
      const body = { ...w, taetigkeit: w.taetigkeit || null }
      if (v) await api.put(`/api/wartungsvorlagen/${v.id}`, body)
      else await api.post('/api/wartungsvorlagen', body)
      onGespeichert(v ? 'Vorlage gespeichert.' : 'Vorlage angelegt. Ordne sie jetzt in der Matrix zu.')
    } catch (e) {
      setFehler((e as Error).message)
    }
  }
  const loeschen = async () => {
    if (!v || !window.confirm(`Vorlage „${v.kurzbezeichnung}“ löschen?`)) return
    try {
      await api.del(`/api/wartungsvorlagen/${v.id}`)
      onGespeichert('Vorlage gelöscht.')
    } catch (e) {
      setFehler((e as Error).message)
    }
  }
  return (
    <Dialog
      titel={v ? 'Vorlage bearbeiten' : 'Neue Vorlage'}
      onClose={onClose}
      breit
      aktionen={
        <>
          {v && (
            <button type="button" className="knopf gefahr" onClick={loeschen} disabled={v.verwendet > 0}
              title={v.verwendet ? `Steckt in ${v.verwendet} Wartungsaufgaben` : undefined}>Löschen</button>
          )}
          <span className="abstand" />
          <button type="button" className="knopf" onClick={onClose}>Abbrechen</button>
          <button type="button" className="knopf primaer" onClick={speichern}
            disabled={!w.kurzbezeichnung.trim() || (!w.gilt_fuer_anlagen && !w.gilt_fuer_geraete)}>Speichern</button>
        </>
      }
    >
      <div className="formular-raster">
        <label className="feld breit"><span>Kurzbezeichnung *</span><input value={w.kurzbezeichnung} onChange={(e) => setze('kurzbezeichnung', e.target.value)} /></label>
        <label className="feld breit"><span>Langtext (Arbeitsanweisung)</span><textarea rows={4} value={w.langtext} onChange={(e) => setze('langtext', e.target.value)} /></label>
        <label className="feld"><span>VDMA-Position</span><input value={w.vdma_position} placeholder="z. B. 24186-1 / 2.3" onChange={(e) => setze('vdma_position', e.target.value)} /></label>
        <label className="feld">
          <span>Tätigkeit</span>
          <select value={w.taetigkeit} onChange={(e) => setze('taetigkeit', e.target.value)}>
            <option value="">–</option>
            {daten.taetigkeiten.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="feld">
          <span>Aufgabentyp</span>
          <select value={w.aufgabentyp} onChange={(e) => setze('aufgabentyp', e.target.value)}>
            {daten.aufgabentypen.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <label className="feld"><span>Zeitvorgabe (Minuten)</span><input inputMode="decimal" value={w.zeitvorgabe} onChange={(e) => setze('zeitvorgabe', e.target.value)} /></label>
        {w.aufgabentyp === 'fuehlerkalibrierung' && (
          <>
            <label className="feld"><span>Warngrenze (K)</span><input inputMode="decimal" value={w.warn_grenze} onChange={(e) => setze('warn_grenze', e.target.value)} /></label>
            <label className="feld"><span>Rote Grenze (K)</span><input inputMode="decimal" value={w.rot_grenze} onChange={(e) => setze('rot_grenze', e.target.value)} /></label>
          </>
        )}
        <label className="schalter"><input type="checkbox" checked={w.gilt_fuer_anlagen} onChange={(e) => setze('gilt_fuer_anlagen', e.target.checked)} /> Gilt für Anlagen</label>
        <label className="schalter"><input type="checkbox" checked={w.gilt_fuer_geraete} onChange={(e) => setze('gilt_fuer_geraete', e.target.checked)} /> Gilt für Geräte</label>
      </div>
      {v && (!w.gilt_fuer_anlagen && !!v.gilt_fuer_anlagen || !w.gilt_fuer_geraete && !!v.gilt_fuer_geraete) && (
        <p className="warnung klein">Die Häkchen in der betroffenen Matrix werden beim Speichern entfernt.</p>
      )}
      {fehler && <p className="fehler" role="alert">{fehler}</p>}
    </Dialog>
  )
}

// ---------- Matrix ----------

function Matrix({ art, daten, onGeaendert, onMeldung }: { art: 'anlagen' | 'geraete'; daten: Daten; onGeaendert: () => void; onMeldung: (m: string) => void }) {
  const typen = art === 'anlagen' ? daten.anlagentypen : daten.geraetearten
  const vorlagen = daten.vorlagen.filter((v) => (art === 'anlagen' ? v.gilt_fuer_anlagen : v.gilt_fuer_geraete))
  const [gesetzt, setGesetzt] = useState(() => new Set(daten.matrix[art].map(([v, t]) => `${v}:${t}`)))
  const [fv, setFv] = useState('')
  const [ft, setFt] = useState('')
  useEffect(() => setGesetzt(new Set(daten.matrix[art].map(([v, t]) => `${v}:${t}`))), [daten, art])

  const qv = fv.trim().toLowerCase()
  const qt = ft.trim().toLowerCase()
  const zeilen = vorlagen.filter((v) => !qv || v.kurzbezeichnung.toLowerCase().includes(qv) || v.langtext?.toLowerCase().includes(qv))
  const spalten = typen.filter((t) => !qt || t.name.toLowerCase().includes(qt))

  const umschalten = async (vid: number, tid: number) => {
    const k = `${vid}:${tid}`
    const an = !gesetzt.has(k)
    setGesetzt((s) => { const n = new Set(s); if (an) n.add(k); else n.delete(k); return n })
    try {
      await api.put(`/api/wartungsvorlagen/matrix/${art}`, { vorlage_id: vid, typ_id: tid, an })
      onGeaendert()
    } catch (e) {
      setGesetzt((s) => { const n = new Set(s); if (an) n.delete(k); else n.add(k); return n })
      onMeldung((e as Error).message)
    }
  }

  return (
    <div className="karte tab-inhalt">
      <div className="tab-aktionen zwischen">
        <div className="zeile">
          <label className="suchfeld">
            <Icon name="suche" size={16} />
            <input type="search" aria-label="Vorlagen filtern" placeholder="Vorlagen filtern" value={fv} onChange={(e) => setFv(e.target.value)} />
          </label>
          <label className="suchfeld">
            <Icon name="suche" size={16} />
            <input type="search" aria-label={art === 'anlagen' ? 'Anlagentypen filtern' : 'Gerätearten filtern'}
              placeholder={art === 'anlagen' ? 'Anlagentypen filtern' : 'Gerätearten filtern'} value={ft} onChange={(e) => setFt(e.target.value)} />
          </label>
        </div>
        <small className="gedaempft">
          {vorlagen.length} Vorlagen für {art === 'anlagen' ? 'Anlagen' : 'Geräte'} × {typen.length} {art === 'anlagen' ? 'Anlagentypen' : 'Gerätearten'}
          {daten.darf_bearbeiten ? ' · Klick speichert sofort' : ''}
        </small>
      </div>
      {vorlagen.length === 0 ? (
        <p className="gedaempft">Keine Vorlage gilt für {art === 'anlagen' ? 'Anlagen' : 'Geräte'}. Setze das Häkchen in der Vorlage.</p>
      ) : (
        <div className="matrix-rahmen">
          <table className="matrix">
            <thead>
              <tr>
                <th className="matrix-ecke">Vorlage</th>
                {spalten.map((t) => (
                  <th key={t.id} className="matrix-kopf" title={t.name || 'ohne Namen'}>
                    <span className="matrix-kopf-text">{t.name || <em className="gedaempft">ohne Namen</em>}</span>
                    <small className="gedaempft">
                      {art === 'geraete' ? `${t.pflichtig}/${t.anzahl}` : t.anzahl}
                    </small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {zeilen.map((v) => (
                <tr key={v.id}>
                  <th className="matrix-zeile" title={v.langtext ?? undefined}>
                    {v.kurzbezeichnung}
                    {v.vdma_position && <small className="gedaempft mono"> {v.vdma_position}</small>}
                  </th>
                  {spalten.map((t) => {
                    const an = gesetzt.has(`${v.id}:${t.id}`)
                    return (
                      <td key={t.id} className={`matrix-zelle${an ? ' an' : ''}`}>
                        <input type="checkbox" checked={an} disabled={!daten.darf_bearbeiten}
                          aria-label={`${v.kurzbezeichnung} für ${t.name}`} onChange={() => umschalten(v.id, t.id)} />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {art === 'geraete' && <p className="gedaempft klein matrix-fuss">Die Zahl unter jeder Geräteart: wartungspflichtige / alle Geräte dieser Art.</p>}
    </div>
  )
}

// ---------- Lücken ----------

interface LueckeAnlage { id: number; name: string; beschreibung: string | null; isp: string; system_id: number; system: string }
interface LueckeGeraet { id: number; name: string; bmkz: string | null; art: string; anlage: string; system_id: number; system: string }

function Luecken({ daten, onGeaendert, onMeldung }: { daten: Daten; onGeaendert: () => void; onMeldung: (m: string) => void }) {
  const [l, setL] = useState<{ anlagen: LueckeAnlage[]; geraete: LueckeGeraet[] } | null>(null)
  const [system, setSystem] = useState('')
  const [typen, setTypen] = useState<Record<number, number>>({})
  const [pflicht, setPflicht] = useState<Set<number>>(new Set())

  const laden = useCallback(() => {
    api.get<{ anlagen: LueckeAnlage[]; geraete: LueckeGeraet[] }>('/api/wartungsvorlagen/luecken').then((r) => {
      setL(r)
      setTypen({})
      setPflicht(new Set())
    }).catch((e) => onMeldung(e.message))
  }, [onMeldung])
  useEffect(laden, [laden])

  const systeme = useMemo(() => {
    const m = new Map<number, string>()
    for (const x of [...(l?.anlagen ?? []), ...(l?.geraete ?? [])]) m.set(x.system_id, x.system)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'de'))
  }, [l])

  if (!l) return <p className="gedaempft">Wird geladen …</p>
  const anlagen = l.anlagen.filter((a) => !system || a.system_id === Number(system))
  const geraete = l.geraete.filter((g) => !system || g.system_id === Number(system))
  const anzahl = Object.keys(typen).length + pflicht.size

  const speichern = async () => {
    try {
      const r = await api.post<{ geaendert: number }>('/api/wartungsvorlagen/luecken', { anlagentypen: typen, wartungspflichtig: [...pflicht] })
      onMeldung(`${r.geaendert} Einträge gespeichert.`)
      laden()
      onGeaendert()
    } catch (e) {
      onMeldung((e as Error).message)
    }
  }

  return (
    <div className="luecken">
      <div className="zeile-zwischen luecken-kopf">
        <select aria-label="System" className="status-wahl" value={system} onChange={(e) => setSystem(e.target.value)}>
          <option value="">Alle Systeme</option>
          {systeme.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <button type="button" className="knopf primaer" disabled={!anzahl} onClick={speichern}>
          {anzahl ? `${anzahl} Änderungen speichern` : 'Speichern'}
        </button>
      </div>

      <section className="karte tab-inhalt">
        <div className="tab-aktionen zwischen">
          <h2 className="abschnitt-titel">Anlagen ohne Anlagentyp <span className="zaehler">{anlagen.length}</span></h2>
          <small className="gedaempft">Ohne Anlagentyp entstehen keine Anlagenaufgaben.</small>
        </div>
        {anlagen.length === 0 ? <p className="gedaempft">Alle Anlagen haben einen Typ.</p> : (
          <div className="tabelle-rahmen">
            <table className="tabelle">
              <thead><tr><th>Anlage</th><th>ISP</th><th>System</th><th>Anlagentyp</th></tr></thead>
              <tbody>
                {anlagen.map((a) => (
                  <tr key={a.id}>
                    <td><Link to={`/objekte/anlage/${a.id}`}>{a.name}</Link>{a.beschreibung && <small className="gedaempft block">{a.beschreibung}</small>}</td>
                    <td>{a.isp}</td>
                    <td className="gedaempft">{a.system}</td>
                    <td>
                      <select aria-label={`Anlagentyp für ${a.name}`} value={typen[a.id] ?? ''}
                        onChange={(e) => setTypen((t) => { const n = { ...t }; if (e.target.value) n[a.id] = Number(e.target.value); else delete n[a.id]; return n })}>
                        <option value="">–</option>
                        {daten.anlagentypen.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="karte tab-inhalt">
        <div className="tab-aktionen zwischen">
          <h2 className="abschnitt-titel">Nicht wartungspflichtige Geräte mit Vorlage <span className="zaehler">{geraete.length}</span></h2>
          {geraete.length > 0 && (
            <button type="button" className="knopf klein" onClick={() => setPflicht((s) => {
              const alle = geraete.every((g) => s.has(g.id))
              const n = new Set(s)
              for (const g of geraete) { if (alle) n.delete(g.id); else n.add(g.id) }
              return n
            })}>{geraete.every((g) => pflicht.has(g.id)) ? 'Auswahl aufheben' : 'Alle auswählen'}</button>
          )}
        </div>
        <p className="gedaempft klein luecken-hinweis">Für ihre Geräteart gibt es Vorlagen, sie sind aber nicht wartungspflichtig. Das ist oft gewollt. Wer doch gewartet werden soll, lässt sich hier markieren.</p>
        {geraete.length === 0 ? <p className="gedaempft">Keine.</p> : (
          <div className="tabelle-rahmen">
            <table className="tabelle">
              <thead><tr><th /><th>Gerät</th><th>BMKZ</th><th>Art</th><th>Anlage</th><th>System</th></tr></thead>
              <tbody>
                {geraete.map((g) => (
                  <tr key={g.id}>
                    <td><input type="checkbox" aria-label={`${g.name} wartungspflichtig`} checked={pflicht.has(g.id)}
                      onChange={(e) => setPflicht((s) => { const n = new Set(s); if (e.target.checked) n.add(g.id); else n.delete(g.id); return n })} /></td>
                    <td><Link to={`/objekte/geraet/${g.id}`}>{g.name}</Link></td>
                    <td className="mono">{g.bmkz}</td>
                    <td>{g.art}</td>
                    <td>{g.anlage}</td>
                    <td className="gedaempft">{g.system}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
