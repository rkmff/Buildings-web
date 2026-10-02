import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import Dialog from '../components/Dialog'
import Icon from '../components/Icon'
import ObjektDialog from '../components/ObjektDialog'
import { lang } from '../datum'
import { Befunde, type Auftrag } from './Auftraege'
import { minuten } from './Wartungsvorlagen'

type Ergebnis = 'gut' | 'achtung' | 'schlecht' | 'neutral'
type Typ = 'standard' | 'fuehlerkalibrierung' | 'strommessung' | 'schaltschrankmessung' | 'trafomessung'
type Modus = 'standard' | 'fuehler' | 'elektro'

interface Wartungsaufgabe {
  id: number
  name: string
  beschreibung: string | null
  status: string
  ergebnis: Ergebnis
  typ: Typ
  erledigt_datum: string | null
  erledigt_uhrzeit: string | null
  techniker: string
  isp_id: number
  isp: string
  anlage_id: number
  anlage: string
  geraet_id: number | null
  geraet: string | null
  bmkz: string | null
  einbauort: string | null
  warn_grenze: number
  rot_grenze: number
  [messwert: string]: unknown
}

interface Kommentar {
  id: number
  aufgabe_id: number
  kommentar: string
  intern: number
  name: string
  datum: string
  uhrzeit: string
}

interface WartungFoto {
  id: number
  aufgabe_id: number
  originalname: string
  beschreibung: string | null
  im_wartungsbericht: number
}

interface FruehererKommentar {
  id: number
  kommentar: string
  name: string
  datum: string
  geraet_id: number | null
  anlage_id: number
  auftrag: string | null
  aufgabe: string
}

interface Zeiten {
  eintraege: { id: number; start: string; ende: string | null; techniker: string }[]
  ist_minuten: number
  soll_minuten: number
  laeuft_seit: string | null
}

type WartungStatus = 'geplant' | 'gestartet' | 'pausiert' | 'fertig'

interface Vorschau {
  status: WartungStatus | null
  vorhanden: number
  anlagen: { aufgaben: number; objekte: number; minuten: number }
  geraete: { aufgaben: number; objekte: number; minuten: number }
  veraltet: number[]
  luecken: { anlagen_ohne_typ: number; geraete_nicht_pflichtig: number }
}

interface Daten {
  auftrag: Auftrag
  aufgaben: Wartungsaufgabe[]
  kommentare: Kommentar[]
  fruehere_kommentare: FruehererKommentar[]
  veraltet: number[]
  zeiten: Zeiten
  fotos: WartungFoto[]
  ich: string
  darf_alles: boolean
}

const ERGEBNISSE: { wert: Ergebnis; label: string }[] = [
  { wert: 'gut', label: 'gut' },
  { wert: 'achtung', label: 'Achtung' },
  { wert: 'schlecht', label: 'schlecht' },
  { wert: 'neutral', label: 'neutral' },
]

const MODI: { wert: Modus; label: string; typen: Typ[] }[] = [
  { wert: 'standard', label: 'Wartung', typen: ['standard'] },
  { wert: 'fuehler', label: 'Fühlerabgleich', typen: ['fuehlerkalibrierung'] },
  { wert: 'elektro', label: 'Elektromessungen', typen: ['strommessung', 'schaltschrankmessung', 'trafomessung'] },
]

const erledigt = (t: Wartungsaufgabe) => t.status === 'erledigt'

const STATUS_LABEL: Record<WartungStatus, string> = { geplant: 'geplant', gestartet: 'gestartet', pausiert: 'pausiert', fertig: 'fertig' }
const STATUS_PILLE: Record<WartungStatus, string> = { geplant: '', gestartet: ' pille-aktiv', pausiert: ' pille-achtung', fertig: ' pille-gut' }

function anzahl(n: number, eins: string, viele: string) {
  return `${n} ${n === 1 ? eins : viele}`
}

function WartungPille({ status }: { status?: WartungStatus | null }) {
  const s = status ?? 'geplant'
  return <span className={`status-pille${STATUS_PILLE[s]}`}>Wartung {STATUS_LABEL[s]}</span>
}

function zahl(v: unknown): string {
  return typeof v === 'number' ? v.toLocaleString('de-DE', { maximumFractionDigits: 3 }) : '–'
}

function parse(v: string): number | null {
  const n = Number(v.trim().replace(',', '.'))
  return v.trim() === '' || Number.isNaN(n) ? null : n
}

function useLokal(key: string, start: boolean): [boolean, (v: boolean) => void] {
  const [wert, setWert] = useState(() => {
    try {
      const s = localStorage.getItem(key)
      return s === null ? start : s === '1'
    } catch {
      return start
    }
  })
  const setzen = (v: boolean) => {
    setWert(v)
    try {
      localStorage.setItem(key, v ? '1' : '0')
    } catch {
      /* ohne Speicher weiter */
    }
  }
  return [wert, setzen]
}

// ---------- Übersicht ----------

export function WartungListe() {
  const [q, setQ] = useState('')
  const [alle, setAlle] = useState(false)
  const [auftraege, setAuftraege] = useState<Auftrag[] | null>(null)
  const [fehler, setFehler] = useState('')

  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams({ q, alle: alle ? '1' : '0' })
      api
        .get<{ auftraege: Auftrag[] }>(`/api/wartung?${p}`)
        .then((d) => setAuftraege(d.auftraege))
        .catch((e) => setFehler(e.message))
    }, 200)
    return () => clearTimeout(t)
  }, [q, alle])

  return (
    <div className="seite">
      <h1 className="seitentitel">Wartung</h1>
      <div className="filterleiste">
        <label className="suchfeld">
          <Icon name="suche" size={16} />
          <input type="search" aria-label="Wartungen suchen" placeholder="Auftrag, Kunde, System" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="schalter">
          <input type="checkbox" checked={alle} onChange={(e) => setAlle(e.target.checked)} /> Auch abgeschlossene
        </label>
      </div>
      {fehler && <p className="fehler">{fehler}</p>}
      {!auftraege ? (
        <p className="gedaempft">Wird geladen …</p>
      ) : auftraege.length === 0 ? (
        <div className="karte leer">Keine Wartungsaufträge gefunden.</div>
      ) : (
        <div className="wartung-liste">
          {auftraege.map((a) => {
            const prozent = a.wartung_gesamt ? Math.round((a.wartung_erledigt / a.wartung_gesamt) * 100) : 0
            return (
              <Link key={a.id} to={`/wartung/${a.id}`} className="karte wartung-kachel">
                <div className="zeile-zwischen oben">
                  <strong>{a.name}</strong>
                  <WartungPille status={a.wartung_status} />
                </div>
                <small className="gedaempft">{[a.kunde, a.system].filter(Boolean).join(' · ')}</small>
                {a.wartung_gesamt ? (
                  <div className="fortschritt">
                    <div style={{ width: `${prozent}%` }} />
                    <span className="mono klein">{a.wartung_erledigt}/{a.wartung_gesamt}</span>
                  </div>
                ) : <small className="gedaempft">Noch keine Aufgaben erzeugt</small>}
                {a.techniker && <small className="gedaempft">{a.techniker}</small>}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------- Ausführen ----------

export default function WartungAusfuehren() {
  const { id } = useParams()
  const [daten, setDaten] = useState<Daten | null>(null)
  const [fehler, setFehler] = useState('')
  const [meldung, setMeldung] = useState('')
  const [modus, setModus] = useState<Modus | null>(null)
  const [isp, setIsp] = useState('')
  const [anlage, setAnlage] = useState('')
  const [suche, setSuche] = useState('')
  const [nurOffene, setNurOffene] = useLokal('buildings.wartung.nurOffene', false)
  const [dialog, setDialog] = useState<'ausfuehren' | 'aktualisieren' | null>(null)
  const [bearbeite, setBearbeite] = useState<{ typ: 'anlage' | 'geraet'; id: number } | null>(null)
  const [neuIds, setNeuIds] = useState<Set<number>>(new Set())

  const laden = useCallback(
    () =>
      api
        .get<Daten>(`/api/wartung/${id}`)
        .then((d) => { setDaten(d); return d })
        .catch((e) => {
          setFehler(e instanceof ApiError && e.status === 404 ? 'Dieser Auftrag wurde nicht gefunden.' : e.message)
          return null
        }),
    [id],
  )
  useEffect(() => { laden() }, [laden])

  const status = async (neu: WartungStatus) => {
    try {
      await api.post(`/api/wartung/${id}/status`, { status: neu })
      await laden()
    } catch (e) {
      setMeldung((e as Error).message)
    }
  }

  const erzeugt = async (modus: 'ausfuehren' | 'aktualisieren', neu: number) => {
    const vorher = new Set(daten?.aufgaben.map((t) => t.id))
    setDialog(null)
    const d = await laden()
    if (d && modus === 'aktualisieren') setNeuIds(new Set(d.aufgaben.filter((t) => !vorher.has(t.id)).map((t) => t.id)))
    if (modus === 'ausfuehren') setMeldung(neu ? `Wartung gestartet, ${neu} Aufgaben erzeugt.` : 'Wartung gestartet.')
    else setMeldung(neu ? `${neu} neue Aufgaben ergänzt, sie sind als „neu“ markiert.` : 'Alles aktuell, es fehlen keine Aufgaben.')
  }

  const entfernen = async (t: Wartungsaufgabe) => {
    if (!window.confirm(`Aufgabe „${t.name}“ entfernen?`)) return
    try {
      await api.del(`/api/wartungsaufgaben/${t.id}`)
      await laden()
    } catch (e) {
      setMeldung((e as Error).message)
    }
  }

  const modi = useMemo(
    () => MODI.filter((m) => daten?.aufgaben.some((t) => m.typen.includes(t.typ))),
    [daten],
  )
  const aktiverModus = modus && modi.some((m) => m.wert === modus) ? modus : modi[0]?.wert
  const imModus = useMemo(() => {
    const typen = MODI.find((m) => m.wert === aktiverModus)?.typen ?? []
    return (daten?.aufgaben ?? []).filter((t) => typen.includes(t.typ))
  }, [daten, aktiverModus])

  const isps = useMemo(() => [...new Map(imModus.map((t) => [t.isp_id, t.isp])).entries()], [imModus])
  const anlagen = useMemo(
    () => [...new Map(imModus.filter((t) => !isp || t.isp_id === Number(isp)).map((t) => [t.anlage_id, t.anlage])).entries()],
    [imModus, isp],
  )

  const sichtbar = useMemo(() => {
    const s = suche.trim().toLowerCase()
    return imModus.filter(
      (t) =>
        (!isp || t.isp_id === Number(isp)) &&
        (!anlage || t.anlage_id === Number(anlage)) &&
        (!nurOffene || !erledigt(t)) &&
        (!s || [t.name, t.geraet, t.bmkz, t.anlage].some((x) => x?.toLowerCase().includes(s))),
    )
  }, [imModus, isp, anlage, nurOffene, suche])

  // Gruppiert nach ISP > Anlage, Gerätebezug steht an der Aufgabe.
  const gruppen = useMemo(() => {
    const out: { isp: string; anlagen: { id: number; name: string; aufgaben: Wartungsaufgabe[] }[] }[] = []
    for (const t of sichtbar) {
      let g = out.find((x) => x.isp === t.isp)
      if (!g) out.push((g = { isp: t.isp, anlagen: [] }))
      let a = g.anlagen.find((x) => x.id === t.anlage_id)
      if (!a) g.anlagen.push((a = { id: t.anlage_id, name: t.anlage, aufgaben: [] }))
      a.aufgaben.push(t)
    }
    return out
  }, [sichtbar])

  const statistik = useMemo<Auftrag | null>(() => {
    if (!daten) return null
    const fertig = daten.aufgaben.filter(erledigt)
    const n = (e: Ergebnis) => fertig.filter((t) => t.ergebnis === e).length
    return {
      ...daten.auftrag,
      wartung_gesamt: daten.aufgaben.length,
      wartung_erledigt: fertig.length,
      wartung_gut: n('gut'),
      wartung_achtung: n('achtung'),
      wartung_schlecht: n('schlecht'),
    }
  }, [daten])

  const ersetzen = (neu: Wartungsaufgabe) =>
    setDaten((d) => (d ? { ...d, aufgaben: d.aufgaben.map((t) => (t.id === neu.id ? neu : t)) } : d))

  const aktion = async (fn: () => Promise<{ aufgabe: Wartungsaufgabe }>) => {
    try {
      ersetzen((await fn()).aufgabe)
      return true
    } catch (e) {
      setMeldung((e as Error).message)
      return false
    }
  }

  if (fehler) return <div className="seite"><p className="fehler">{fehler}</p></div>
  if (!daten || !statistik) return <div className="seite"><p className="gedaempft">Wird geladen …</p></div>

  const offenImModus = imModus.filter((t) => !erledigt(t)).length
  const wStatus: WartungStatus = daten.auftrag.wartung_status ?? 'geplant'
  const veraltet = new Set(daten.veraltet)

  return (
    <div className="seite wartung-seite">
      <div className="wartung-kopf">
        <div className="wartung-titel">
          <Link to={`/auftraege/${daten.auftrag.id}`} className="klein gedaempft">‹ Auftrag</Link>
          <h1 className="seitentitel">{daten.auftrag.name}</h1>
          <p className="gedaempft">{[daten.auftrag.kunde, daten.auftrag.system].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="wartung-zaehler nur-mobil" aria-label="Fortschritt">
          <strong className="mono">{statistik.wartung_erledigt}/{statistik.wartung_gesamt}</strong>
        </div>
        <div className="wartung-befunde"><Befunde a={statistik} /></div>
      </div>

      <StatusLeiste
        status={wStatus}
        zeiten={daten.zeiten}
        offen={daten.aufgaben.filter((t) => !erledigt(t)).length}
        veraltet={daten.veraltet.length}
        onAusfuehren={() => setDialog('ausfuehren')}
        onAktualisieren={() => setDialog('aktualisieren')}
        onStatus={status}
      />

      {daten.aufgaben.length === 0 && (
        <div className="karte leer wartung-leer">
          <p>Für diese Wartung sind noch keine Aufgaben erzeugt.</p>
          <p className="gedaempft klein">„Wartung ausführen“ legt die Aufgaben nach den Matrizen für Anlagentypen und Gerätearten an.</p>
          {wStatus === 'geplant'
            ? <button type="button" className="knopf primaer" onClick={() => setDialog('ausfuehren')}>Wartung ausführen</button>
            : wStatus !== 'fertig' && <button type="button" className="knopf" onClick={() => setDialog('aktualisieren')}>Aufgaben aktualisieren</button>}
        </div>
      )}

      {daten.aufgaben.length > 0 && modi.length > 1 && (
        <div className="tabs" role="tablist">
          {modi.map((m) => {
            const alle = daten.aufgaben.filter((t) => m.typen.includes(t.typ))
            return (
              <button key={m.wert} type="button" role="tab" aria-selected={m.wert === aktiverModus} className={m.wert === aktiverModus ? 'aktiv' : ''}
                onClick={() => { setModus(m.wert); setIsp(''); setAnlage('') }}>
                {m.label} <span className="zaehler">{alle.filter(erledigt).length}/{alle.length}</span>
              </button>
            )
          })}
        </div>
      )}

      {daten.aufgaben.length > 0 && <div className="filterleiste wartung-filter">
        <select aria-label="ISP" value={isp} onChange={(e) => { setIsp(e.target.value); setAnlage('') }}>
          <option value="">Alle ISPs</option>
          {isps.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select aria-label="Anlage" value={anlage} onChange={(e) => setAnlage(e.target.value)}>
          <option value="">Alle Anlagen</option>
          {anlagen.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="schalter">
          <input type="checkbox" checked={nurOffene} onChange={(e) => setNurOffene(e.target.checked)} /> nur offene
        </label>
        <label className="suchfeld">
          <Icon name="suche" size={16} />
          <input type="search" aria-label="Aufgaben suchen" placeholder="Gerät, BMKZ, Aufgabe" value={suche} onChange={(e) => setSuche(e.target.value)} />
        </label>
      </div>}

      {gruppen.length === 0 && daten.aufgaben.length > 0 && (
        <div className="karte leer">
          {nurOffene && offenImModus === 0 ? 'Alle Aufgaben sind erledigt.' : 'Keine Aufgaben für diese Auswahl.'}
        </div>
      )}

      {gruppen.map((g) => (
        <section key={g.isp} className="wartung-gruppe">
          <h2 className="wartung-isp"><span className="typ-marke typ-isp">ISP</span>{g.isp}</h2>
          {g.anlagen.map((a) => (
            <div key={a.id} className="wartung-anlage">
              <h3 className="wartung-anlage-titel">
                <span className="typ-marke typ-anlage">AN</span>
                <Link to={`/objekte/anlage/${a.id}`}>{a.name}</Link>
                <span className="zaehler">{a.aufgaben.filter(erledigt).length}/{a.aufgaben.length}</span>
                <button type="button" className="knopf klein flach" onClick={() => setBearbeite({ typ: 'anlage', id: a.id })}>Anlage bearbeiten</button>
              </h3>
              <ul className="wartung-aufgaben">
                {a.aufgaben.map((t) => (
                  <AufgabeKarte
                    key={t.id}
                    t={t}
                    daten={daten}
                    veraltet={veraltet.has(t.id)}
                    neu={neuIds.has(t.id)}
                    onAktion={aktion}
                    onNeuLaden={laden}
                    onFehler={setMeldung}
                    onEntfernen={() => entfernen(t)}
                    onBearbeiten={() => t.geraet_id ? setBearbeite({ typ: 'geraet', id: t.geraet_id }) : setBearbeite({ typ: 'anlage', id: t.anlage_id })}
                  />
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}

      {dialog && (
        <AusfuehrenDialog auftragId={daten.auftrag.id} modus={dialog} onClose={() => setDialog(null)} onErzeugt={(n) => erzeugt(dialog, n)} />
      )}
      {bearbeite && (
        <ObjektDialog typ={bearbeite.typ} id={bearbeite.id} onClose={() => setBearbeite(null)}
          onGespeichert={() => { setBearbeite(null); setMeldung(bearbeite.typ === 'geraet' ? 'Gerät gespeichert.' : 'Anlage gespeichert.'); laden() }} />
      )}

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

// ---------- Status und Zeiten ----------

function StatusLeiste({ status, zeiten, offen, veraltet, onAusfuehren, onAktualisieren, onStatus }: {
  status: WartungStatus
  zeiten: Zeiten
  offen: number
  veraltet: number
  onAusfuehren: () => void
  onAktualisieren: () => void
  onStatus: (s: WartungStatus) => void
}) {
  // Läuft die Wartung, zählt die Ist-Zeit ohne Neuladen weiter.
  const [geladen] = useState(() => Date.now())
  const [jetzt, setJetzt] = useState(() => Date.now())
  useEffect(() => {
    if (!zeiten.laeuft_seit) return
    const t = setInterval(() => setJetzt(Date.now()), 30000)
    return () => clearInterval(t)
  }, [zeiten.laeuft_seit])
  const ist = zeiten.ist_minuten + (zeiten.laeuft_seit ? Math.max(0, Math.floor((jetzt - geladen) / 60000)) : 0)
  const ueber = zeiten.soll_minuten > 0 && ist > zeiten.soll_minuten
  const fertigTitel = offen ? `Noch ${anzahl(offen, "Aufgabe", "Aufgaben")} ohne Ergebnis` : undefined

  return (
    <div className={`karte wartung-status status-${status}`}>
      <div className="wartung-status-info">
        <WartungPille status={status} />
        <span className="klein">
          Ist <strong className={ueber ? 'warnung' : undefined}>{minuten(ist) === '–' ? '0 min' : minuten(ist)}</strong>
          {' '}von Soll <strong>{minuten(zeiten.soll_minuten)}</strong>
        </span>
        {zeiten.laeuft_seit && <small className="gedaempft">läuft seit {zeiten.laeuft_seit.slice(11, 16)} Uhr</small>}
        {veraltet > 0 && <small className="warnung">{veraltet === 1 ? "1 Aufgabe passt" : `${veraltet} Aufgaben passen`} nicht mehr zur Matrix</small>}
      </div>
      <div className="knopf-reihe">
        {status === 'geplant' && <button type="button" className="knopf primaer" onClick={onAusfuehren}>Wartung ausführen</button>}
        {(status === 'gestartet' || status === 'pausiert') && (
          <>
            <button type="button" className="knopf" onClick={onAktualisieren}>Aufgaben aktualisieren</button>
            {status === 'gestartet'
              ? <button type="button" className="knopf" onClick={() => onStatus('pausiert')}>Pausieren</button>
              : <button type="button" className="knopf primaer" onClick={() => onStatus('gestartet')}>Fortsetzen</button>}
            <button type="button" className={`knopf${status === 'gestartet' ? ' primaer' : ''}`} onClick={() => onStatus('fertig')} disabled={offen > 0} title={fertigTitel}>
              Fertig
            </button>
          </>
        )}
        {status === 'fertig' && <button type="button" className="knopf" onClick={() => onStatus('gestartet')}>Wieder öffnen</button>}
      </div>
      {(status === 'gestartet' || status === 'pausiert') && offen > 0 && (
        <small className="gedaempft wartung-status-hinweis">Fertig geht, sobald alle Aufgaben ein Ergebnis haben. Offen: {offen}.</small>
      )}
    </div>
  )
}

function AusfuehrenDialog({ auftragId, modus, onClose, onErzeugt }: {
  auftragId: number
  modus: 'ausfuehren' | 'aktualisieren'
  onClose: () => void
  onErzeugt: (neu: number) => void
}) {
  const [v, setV] = useState<Vorschau | null>(null)
  const [anlagen, setAnlagen] = useState(true)
  const [geraete, setGeraete] = useState(true)
  const [fehler, setFehler] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  useEffect(() => {
    api.get<Vorschau>(`/api/wartung/${auftragId}/vorschau`).then(setV).catch((e) => setFehler(e.message))
  }, [auftragId])

  const n = (anlagen ? v?.anlagen.aufgaben ?? 0 : 0) + (geraete ? v?.geraete.aufgaben ?? 0 : 0)
  const min = (anlagen ? v?.anlagen.minuten ?? 0 : 0) + (geraete ? v?.geraete.minuten ?? 0 : 0)
  const objekte = [
    anlagen && v?.anlagen.objekte ? anzahl(v.anlagen.objekte, 'Anlage', 'Anlagen') : '',
    geraete && v?.geraete.objekte ? anzahl(v.geraete.objekte, 'Gerät', 'Geräte') : '',
  ].filter(Boolean).join(' und ')
  const luecken = v ? v.luecken.anlagen_ohne_typ : 0

  const los = async () => {
    setLaeuft(true)
    try {
      const r = await api.post<{ neu: number }>(`/api/wartung/${auftragId}/${modus === 'ausfuehren' ? 'ausfuehren' : 'aufgaben-aktualisieren'}`, { anlagen, geraete })
      onErzeugt(r.neu)
    } catch (e) {
      setFehler((e as Error).message)
      setLaeuft(false)
    }
  }

  return (
    <Dialog
      titel={modus === 'ausfuehren' ? 'Wartung ausführen' : 'Aufgaben aktualisieren'}
      onClose={onClose}
      aktionen={
        <>
          <button type="button" className="knopf" onClick={onClose}>Abbrechen</button>
          <button type="button" className="knopf primaer" onClick={los}
            disabled={!v || laeuft || (!anlagen && !geraete) || (modus === 'aktualisieren' && n === 0) || (modus === 'ausfuehren' && n === 0 && v.vorhanden === 0)}>
            {modus === 'ausfuehren' ? 'Wartung starten' : n ? `${n} Aufgaben ergänzen` : 'Nichts zu ergänzen'}
          </button>
        </>
      }
    >
      {!v ? <p className="gedaempft">{fehler || 'Matrizen werden geprüft …'}</p> : (
        <div className="ausfuehren">
          <p>{modus === 'ausfuehren' ? 'Für welche Objekte sollen Aufgaben erzeugt werden?' : 'Die Matrizen werden neu geprüft. Fehlende Aufgaben kommen dazu, vorhandene bleiben unverändert.'}</p>
          <label className="ausfuehren-wahl">
            <input type="checkbox" checked={anlagen} onChange={(e) => setAnlagen(e.target.checked)} />
            <span><strong>Anlagenbasiert</strong><small className="gedaempft">{anzahl(v.anlagen.aufgaben, 'Aufgabe', 'Aufgaben')} für {anzahl(v.anlagen.objekte, 'Anlage', 'Anlagen')} · {minuten(v.anlagen.minuten)}</small></span>
          </label>
          <label className="ausfuehren-wahl">
            <input type="checkbox" checked={geraete} onChange={(e) => setGeraete(e.target.checked)} />
            <span><strong>Gerätebasiert</strong><small className="gedaempft">{anzahl(v.geraete.aufgaben, 'Aufgabe', 'Aufgaben')} für {anzahl(v.geraete.objekte, 'Gerät', 'Geräte')} · {minuten(v.geraete.minuten)}</small></span>
          </label>
          <p className="hinweis-box">
            {n ? `Es ${n === 1 ? 'wird 1 Aufgabe' : `werden ${n} Aufgaben`} für ${objekte} erzeugt, Zeitvorgabe gesamt ${minuten(min)}.`
              : v.vorhanden ? `Es fehlen keine Aufgaben, ${v.vorhanden} sind schon vorhanden.` : 'Nach den Matrizen entstehen für dieses System keine Aufgaben.'}
            {modus === 'ausfuehren' && v.vorhanden > 0 && n > 0 ? ` ${v.vorhanden} sind schon vorhanden.` : ''}
          </p>
          {modus === 'aktualisieren' && v.veraltet.length > 0 && (
            <p className="klein warnung">{v.veraltet.length} offene Aufgaben passen nicht mehr zur Matrix. Sie sind markiert und lassen sich an der Aufgabe entfernen.</p>
          )}
          {luecken > 0 && (
            <p className="klein gedaempft">
              In diesem System {v.luecken.anlagen_ohne_typ === 1 ? 'hat 1 Anlage' : `haben ${v.luecken.anlagen_ohne_typ} Anlagen`} keinen Anlagentyp.
              {' '}Für sie entstehen keine Anlagenaufgaben. <Link to="/wartungsvorlagen?tab=luecken">Anlagentyp setzen</Link>
            </p>
          )}
          {fehler && <p className="fehler" role="alert">{fehler}</p>}
        </div>
      )}
    </Dialog>
  )
}

function AufgabeKarte({ t, daten, veraltet, neu, onAktion, onNeuLaden, onFehler, onEntfernen, onBearbeiten }: {
  t: Wartungsaufgabe
  daten: Daten
  veraltet: boolean
  neu: boolean
  onAktion: (fn: () => Promise<{ aufgabe: Wartungsaufgabe }>) => Promise<boolean>
  onNeuLaden: () => void
  onFehler: (text: string) => void
  onEntfernen: () => void
  onBearbeiten: () => void
}) {
  const [offen, setOffen] = useState<'' | 'kommentare' | 'fotos' | 'info'>('')
  const [laeuft, setLaeuft] = useState(false)
  const [alleFrueheren, setAlleFrueheren] = useState(false)
  const kommentare = daten.kommentare.filter((k) => k.aufgabe_id === t.id)
  const fruehere = daten.fruehere_kommentare.filter((k) =>
    t.geraet_id ? k.geraet_id === t.geraet_id : k.geraet_id === null && k.anlage_id === t.anlage_id)
  const fotos = daten.fotos.filter((f) => f.aufgabe_id === t.id)
  const fertig = erledigt(t)
  const messung = t.typ !== 'standard'

  const ergebnis = async (e: Ergebnis) => {
    setLaeuft(true)
    await onAktion(() => api.post(`/api/wartungsaufgaben/${t.id}/ergebnis`, { ergebnis: e }))
    setLaeuft(false)
  }
  const oeffnen = async () => {
    setLaeuft(true)
    await onAktion(() => api.post(`/api/wartungsaufgaben/${t.id}/oeffnen`))
    setLaeuft(false)
  }
  const umschalten = (bereich: typeof offen) => setOffen((o) => (o === bereich ? '' : bereich))

  return (
    <li className={`karte wartung-aufgabe${fertig ? ` erledigt ergebnis-rand-${t.ergebnis}` : ''}`}>
      <div className="zeile-zwischen oben">
        <div className="wartung-aufgabe-text">
          <strong>
            {t.name}
            {neu && <span className="status-pille pille-aktiv">neu</span>}
            {veraltet && <span className="status-pille pille-achtung" title="Vorlage nicht mehr in der Matrix oder Gerät nicht mehr wartungspflichtig">passt nicht mehr</span>}
          </strong>
          <small className="gedaempft">
            {t.geraet_id ? [t.bmkz, t.geraet].filter(Boolean).join(' · ') : 'Anlage'}
            {t.einbauort ? ` · ${t.einbauort}` : ''}
          </small>
        </div>
        <div className="zeile">
          {veraltet && !fertig && kommentare.length === 0 && fotos.length === 0 && (
            <button type="button" className="knopf klein gefahr" onClick={onEntfernen}>Entfernen</button>
          )}
          {fertig && (
            <button type="button" className="knopf klein" onClick={oeffnen} disabled={laeuft}>Wieder öffnen</button>
          )}
        </div>
      </div>

      {messung && <Messformular t={t} onAktion={onAktion} />}

      {(!messung || fertig) && (
        <div className="ergebnis-knoepfe" role="group" aria-label={`Ergebnis für ${t.name}`}>
          {ERGEBNISSE.map((e) => {
            const gewaehlt = fertig && t.ergebnis === e.wert
            return (
              <button key={e.wert} type="button" aria-pressed={gewaehlt} disabled={laeuft}
                className={`ergebnis-knopf ergebnis-${e.wert}${gewaehlt ? ' gewaehlt' : ''}`}
                onClick={() => !gewaehlt && ergebnis(e.wert)}>
                {e.label}
              </button>
            )
          })}
        </div>
      )}

      <div className="wartung-aufgabe-fuss">
        {fertig ? (
          <small className="gedaempft">Erledigt {lang(t.erledigt_datum)} {t.erledigt_uhrzeit?.slice(0, 5)}{t.techniker ? ` · ${t.techniker}` : ''}</small>
        ) : <span />}
        <div className="zeile">
          <button type="button" className="knopf klein" onClick={onBearbeiten}>{t.geraet_id ? 'Gerät' : 'Anlage'} bearbeiten</button>
          {t.beschreibung && (
            <button type="button" className={`knopf klein${offen === 'info' ? ' aktiv' : ''}`} aria-expanded={offen === 'info'} onClick={() => umschalten('info')}>Info</button>
          )}
          <button type="button" className={`knopf klein${offen === 'kommentare' ? ' aktiv' : ''}`} aria-expanded={offen === 'kommentare'} onClick={() => umschalten('kommentare')}>
            Kommentar{kommentare.length > 0 && <span className="zaehler">{kommentare.length}</span>}
          </button>
          <button type="button" className={`knopf klein${offen === 'fotos' ? ' aktiv' : ''}`} aria-expanded={offen === 'fotos'} onClick={() => umschalten('fotos')}>
            <Icon name="foto" size={16} />{fotos.length > 0 && <span className="zaehler">{fotos.length}</span>}
            <span className="sr-only">Fotos</span>
          </button>
        </div>
      </div>

      {offen === 'info' && <p className="mehrzeilig wartung-info">{t.beschreibung}</p>}
      {(kommentare.length > 0 || offen === 'kommentare') && (
        <Kommentare aufgabeId={t.id} kommentare={kommentare} ich={daten.ich} darfAlles={daten.darf_alles}
          formular={offen === 'kommentare'} onNeuLaden={onNeuLaden} onFehler={onFehler} />
      )}
      {fruehere.length > 0 && (
        <div className="fruehere-kommentare">
          <small className="gedaempft">Aus früheren Wartungen {t.geraet_id ? 'dieses Geräts' : 'dieser Anlage'}</small>
          <ul>
            {(alleFrueheren ? fruehere : fruehere.slice(0, 2)).map((k) => (
              <li key={k.id}>
                <p className="mehrzeilig">{k.kommentar}</p>
                <small className="gedaempft">{k.name} · {lang(k.datum)}{k.auftrag ? ` · ${k.auftrag}` : ''}</small>
              </li>
            ))}
          </ul>
          {fruehere.length > 2 && (
            <button type="button" className="link-knopf klein" onClick={() => setAlleFrueheren((x) => !x)}>
              {alleFrueheren ? 'Weniger anzeigen' : `Alle ${fruehere.length} anzeigen`}
            </button>
          )}
        </div>
      )}
      {offen === 'fotos' && <Fotos aufgabeId={t.id} fotos={fotos} onNeuLaden={onNeuLaden} onFehler={onFehler} />}
    </li>
  )
}

// ---------- Messwerte ----------

const MESSFELDER: Record<Exclude<Typ, 'standard'>, { feld: string; spalte: string; label: string; einheit: string }[]> = {
  fuehlerkalibrierung: [
    { feld: 'gemessen', spalte: 'kalibrierung_gemessen', label: 'Gemessen', einheit: '°C' },
    { feld: 'angezeigt', spalte: 'kalibrierung_tatsaechlich', label: 'Angezeigt', einheit: '°C' },
    { feld: 'offset_alt', spalte: 'kalibrierung_offset_alt', label: 'Offset bisher', einheit: 'K' },
  ],
  strommessung: [
    { feld: 'l1', spalte: 'strom_l1', label: 'L1', einheit: 'A' },
    { feld: 'l2', spalte: 'strom_l2', label: 'L2', einheit: 'A' },
    { feld: 'l3', spalte: 'strom_l3', label: 'L3', einheit: 'A' },
  ],
  schaltschrankmessung: [
    { feld: 'u_l1_l2', spalte: 'schalt_u_l1_l2', label: 'U L1-L2', einheit: 'V' },
    { feld: 'u_l2_l3', spalte: 'schalt_u_l2_l3', label: 'U L2-L3', einheit: 'V' },
    { feld: 'u_l3_l1', spalte: 'schalt_u_l3_l1', label: 'U L3-L1', einheit: 'V' },
    { feld: 'u_l1_n', spalte: 'schalt_u_l1_n', label: 'U L1-N', einheit: 'V' },
    { feld: 'u_l2_n', spalte: 'schalt_u_l2_n', label: 'U L2-N', einheit: 'V' },
    { feld: 'u_l3_n', spalte: 'schalt_u_l3_n', label: 'U L3-N', einheit: 'V' },
    { feld: 'i_l1', spalte: 'schalt_i_l1', label: 'I L1', einheit: 'A' },
    { feld: 'i_l2', spalte: 'schalt_i_l2', label: 'I L2', einheit: 'A' },
    { feld: 'i_l3', spalte: 'schalt_i_l3', label: 'I L3', einheit: 'A' },
    { feld: 'i_n', spalte: 'schalt_i_n', label: 'I N', einheit: 'A' },
  ],
  trafomessung: [
    { feld: 'primaer_spannung', spalte: 'trafo_primaer_spannung', label: 'Primär U', einheit: 'V' },
    { feld: 'primaer_strom', spalte: 'trafo_primaer_strom', label: 'Primär I', einheit: 'A' },
    { feld: 'sekundaer_spannung', spalte: 'trafo_sekundaer_spannung', label: 'Sekundär U', einheit: 'V' },
    { feld: 'sekundaer_strom', spalte: 'trafo_sekundaer_strom', label: 'Sekundär I', einheit: 'A' },
  ],
}

function abweichungKlasse(t: Wartungsaufgabe, abw: number) {
  const betrag = Math.abs(abw)
  if (betrag >= t.rot_grenze) return 'ergebnis-schlecht'
  if (betrag >= t.warn_grenze) return 'ergebnis-achtung'
  return 'ergebnis-gut'
}

function Messformular({ t, onAktion }: { t: Wartungsaufgabe; onAktion: (fn: () => Promise<{ aufgabe: Wartungsaufgabe }>) => Promise<boolean> }) {
  const typ = t.typ as Exclude<Typ, 'standard'>
  const felder = MESSFELDER[typ]
  const start = () => {
    const w: Record<string, string> = {}
    for (const f of felder) w[f.feld] = typeof t[f.spalte] === 'number' ? String(t[f.spalte]).replace('.', ',') : ''
    w.spannung = String(t.strom_spannung ?? 400)
    w.sekundaer_art = String(t.trafo_sekundaer_art ?? 'AC')
    if (typ === 'fuehlerkalibrierung' && w.offset_alt === '') w.offset_alt = '0'
    return w
  }
  const [werte, setWerte] = useState(start)
  const [bearbeiten, setBearbeiten] = useState(!erledigt(t))
  const [laeuft, setLaeuft] = useState(false)
  useEffect(() => setBearbeiten(!erledigt(t)), [t.status])

  const sichtbareFelder = typ === 'strommessung' && werte.spannung === '230' ? felder.slice(0, 1) : felder
  const g = parse(werte.gemessen ?? ''), a = parse(werte.angezeigt ?? ''), o = parse(werte.offset_alt ?? '')
  const abw = g !== null && a !== null ? g - a : null

  const speichern = async (e: FormEvent) => {
    e.preventDefault()
    setLaeuft(true)
    const ok = await onAktion(() => api.post(`/api/wartungsaufgaben/${t.id}/messung`, werte))
    setLaeuft(false)
    if (ok) setBearbeiten(false)
  }

  if (!bearbeiten) {
    if (felder.every((f) => typeof t[f.spalte] !== 'number')) {
      return (
        <div className="messwerte-anzeige">
          <p className="gedaempft klein">Keine Messwerte erfasst.</p>
          <button type="button" className="knopf klein" onClick={() => setBearbeiten(true)}>Werte erfassen</button>
        </div>
      )
    }
    const abwGespeichert =
      typeof t.kalibrierung_gemessen === 'number' && typeof t.kalibrierung_tatsaechlich === 'number'
        ? t.kalibrierung_gemessen - t.kalibrierung_tatsaechlich
        : null
    return (
      <div className="messwerte-anzeige">
        <dl>
          {typ === 'strommessung' && <div><dt>Netz</dt><dd>{String(t.strom_spannung ?? '–')} V</dd></div>}
          {sichtbareFelder.map((f) => (
            <div key={f.feld}><dt>{f.label}</dt><dd className="mono">{zahl(t[f.spalte])} {f.einheit}</dd></div>
          ))}
          {typ === 'trafomessung' && <div><dt>Sekundär</dt><dd>{String(t.trafo_sekundaer_art ?? '–')}</dd></div>}
          {typ === 'fuehlerkalibrierung' && (
            <>
              <div><dt>Abweichung</dt><dd className={`mono ${abwGespeichert !== null ? abweichungKlasse(t, abwGespeichert) : ''}`}>{abwGespeichert !== null ? `${abwGespeichert > 0 ? '+' : ''}${zahl(abwGespeichert)} K` : '–'}</dd></div>
              <div><dt>Offset neu</dt><dd className="mono"><strong>{zahl(t.kalibrierung_offset_neu)} K</strong></dd></div>
            </>
          )}
        </dl>
        <button type="button" className="knopf klein" onClick={() => setBearbeiten(true)}>Werte ändern</button>
      </div>
    )
  }

  return (
    <form className="messformular" onSubmit={speichern}>
      {typ === 'strommessung' && (
        <div className="segment" role="group" aria-label="Netzspannung">
          {['230', '400'].map((v) => (
            <button key={v} type="button" className={werte.spannung === v ? 'aktiv' : ''} aria-pressed={werte.spannung === v}
              onClick={() => setWerte((w) => ({ ...w, spannung: v }))}>{v} V</button>
          ))}
        </div>
      )}
      {typ === 'trafomessung' && (
        <div className="segment" role="group" aria-label="Sekundärseite">
          {['AC', 'DC'].map((v) => (
            <button key={v} type="button" className={werte.sekundaer_art === v ? 'aktiv' : ''} aria-pressed={werte.sekundaer_art === v}
              onClick={() => setWerte((w) => ({ ...w, sekundaer_art: v }))}>Sekundär {v}</button>
          ))}
        </div>
      )}
      <div className={`messfelder${typ === 'schaltschrankmessung' ? ' viele' : typ === 'trafomessung' ? ' vier' : ''}`}>
        {sichtbareFelder.map((f) => (
          <label key={f.feld} className="messfeld">
            <span>{f.label}</span>
            <span className="messfeld-eingabe">
              <input inputMode="decimal" autoComplete="off" value={werte[f.feld]} required
                onChange={(e) => setWerte((w) => ({ ...w, [f.feld]: e.target.value }))} />
              <small>{f.einheit}</small>
            </span>
          </label>
        ))}
      </div>
      {typ === 'fuehlerkalibrierung' && (
        <p className="klein">
          Abweichung <strong className={abw !== null ? abweichungKlasse(t, abw) : ''}>{abw !== null ? `${abw > 0 ? '+' : ''}${zahl(abw)} K` : '–'}</strong>
          {' · '}Offset neu <strong className="mono">{abw !== null && o !== null ? `${zahl(Math.round((o + abw) * 1000) / 1000)} K` : '–'}</strong>
        </p>
      )}
      <div className="knopf-reihe links">
        <button type="submit" className="knopf primaer" disabled={laeuft}>Speichern und erledigen</button>
        {erledigt(t) && <button type="button" className="knopf" onClick={() => { setWerte(start()); setBearbeiten(false) }}>Abbrechen</button>}
      </div>
    </form>
  )
}

// ---------- Kommentare ----------

function Kommentare({ aufgabeId, kommentare, ich, darfAlles, formular, onNeuLaden, onFehler }: {
  aufgabeId: number
  kommentare: Kommentar[]
  ich: string
  darfAlles: boolean
  formular: boolean
  onNeuLaden: () => void
  onFehler: (t: string) => void
}) {
  const [text, setText] = useState('')
  const [intern, setIntern] = useState(false)
  const [laeuft, setLaeuft] = useState(false)

  const senden = async (e: FormEvent) => {
    e.preventDefault()
    setLaeuft(true)
    try {
      await api.post(`/api/wartungsaufgaben/${aufgabeId}/kommentare`, { kommentar: text, intern })
      setText('')
      setIntern(false)
      onNeuLaden()
    } catch (err) {
      onFehler((err as Error).message)
    }
    setLaeuft(false)
  }
  const loeschen = async (k: Kommentar) => {
    if (!window.confirm('Kommentar löschen?')) return
    try {
      await api.del(`/api/wartungskommentare/${k.id}`)
      onNeuLaden()
    } catch (err) {
      onFehler((err as Error).message)
    }
  }

  return (
    <div className="wartung-bereich">
      {kommentare.length > 0 && <ul className="liste">
        {kommentare.map((k) => (
          <li key={k.id} className="liste-eintrag zeile-zwischen oben">
            <div>
              <p className="mehrzeilig">{k.kommentar}</p>
              <small className="gedaempft">
                {k.name} · {lang(k.datum)} {k.uhrzeit?.slice(0, 5)}
                {k.intern ? <span className="status-pille intern">intern</span> : null}
              </small>
            </div>
            {(k.name === ich || darfAlles) && (
              <button type="button" className="icon-knopf klein" aria-label="Kommentar löschen" onClick={() => loeschen(k)}>
                <Icon name="papierkorb" size={15} />
              </button>
            )}
          </li>
        ))}
      </ul>}
      {formular && <form className="kommentar-formular" onSubmit={senden}>
        <textarea rows={2} aria-label="Neuer Kommentar" placeholder="Kommentar schreiben" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="zeile-zwischen">
          <label className="aufgabe"><input type="checkbox" checked={intern} onChange={(e) => setIntern(e.target.checked)} /> intern (nicht im Kundenbericht)</label>
          <button type="submit" className="knopf primaer klein" disabled={laeuft || !text.trim()}>Senden</button>
        </div>
      </form>}
    </div>
  )
}

// ---------- Fotos ----------

function Fotos({ aufgabeId, fotos, onNeuLaden, onFehler }: {
  aufgabeId: number
  fotos: WartungFoto[]
  onNeuLaden: () => void
  onFehler: (t: string) => void
}) {
  const eingabe = useRef<HTMLInputElement>(null)
  const [laeuft, setLaeuft] = useState(false)

  const hochladen = async (dateien: FileList | File[] | null) => {
    if (!dateien?.length) return
    const daten = new FormData()
    for (const d of Array.from(dateien)) daten.append('fotos', d)
    setLaeuft(true)
    try {
      await api.hochladen(`/api/wartungsaufgaben/${aufgabeId}/fotos`, daten)
      onNeuLaden()
    } catch (err) {
      onFehler((err as Error).message)
    }
    setLaeuft(false)
    if (eingabe.current) eingabe.current.value = ''
  }
  // Screenshot aus der Zwischenablage (Strg+V), z. B. von der GLT-Oberfläche
  const einfuegen = (e: React.ClipboardEvent) => {
    const stempel = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')
    const bilder = Array.from(e.clipboardData.items)
      .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f)
      .map((f, n) => new File([f], `Screenshot_${stempel}${n ? `_${n + 1}` : ''}.${f.type.split('/')[1] || 'png'}`, { type: f.type }))
    if (!bilder.length) return
    e.preventDefault()
    hochladen(bilder)
  }
  const bericht = async (f: WartungFoto, an: boolean) => {
    try {
      await api.patch(`/api/fotos/${f.id}`, { im_wartungsbericht: an })
      onNeuLaden()
    } catch (err) {
      onFehler((err as Error).message)
    }
  }
  const loeschen = async (f: WartungFoto) => {
    if (!window.confirm('Foto löschen?')) return
    try {
      await api.del(`/api/fotos/${f.id}`)
      onNeuLaden()
    } catch (err) {
      onFehler((err as Error).message)
    }
  }

  return (
    <div className="wartung-bereich" onPaste={einfuegen}>
      <div className="wartung-fotos">
        {fotos.map((f) => (
          <figure key={f.id} className="wartung-foto">
            <a href={`/api/fotos/${f.id}/datei`} target="_blank" rel="noreferrer">
              <img src={`/api/fotos/${f.id}/datei`} alt={f.beschreibung || f.originalname} loading="lazy" />
            </a>
            <figcaption className="zeile-zwischen">
              <label className="aufgabe klein">
                <input type="checkbox" checked={!!f.im_wartungsbericht} onChange={(e) => bericht(f, e.target.checked)} /> im Bericht
              </label>
              <button type="button" className="icon-knopf klein" aria-label="Foto löschen" onClick={() => loeschen(f)}>
                <Icon name="papierkorb" size={15} />
              </button>
            </figcaption>
          </figure>
        ))}
        <button type="button" className="foto-neu" onClick={() => eingabe.current?.click()} disabled={laeuft}>
          <Icon name="foto" size={22} />
          <span>{laeuft ? 'Lädt hoch …' : 'Foto aufnehmen oder wählen'}</span>
        </button>
        <div className="foto-neu einfuege-zone nur-desktop" tabIndex={0} role="button" aria-label="Screenshot einfügen: hier klicken, dann Strg+V">
          <span className="mono">Strg+V</span>
          <span>Screenshot hier einfügen</span>
        </div>
      </div>
      <input ref={eingabe} type="file" accept="image/*" multiple hidden onChange={(e) => hochladen(e.target.files)} />
    </div>
  )
}
