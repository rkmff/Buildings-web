import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import Icon from '../components/Icon'
import ObjektDialog, { type ObjektTyp } from '../components/ObjektDialog'
import { lang } from '../datum'
import type { Foto } from '../types'

interface BaumAnlage { id: number; name: string; beschreibung: string | null; geraete: number }
interface BaumIsp { id: number; name: string; beschreibung: string | null; anlagen: BaumAnlage[] }
interface BaumSystem { id: number; name: string; ort: string | null; isps: BaumIsp[] }
interface BaumKunde { id: number | null; name: string; systeme: BaumSystem[] }

type Typ = 'kunde' | 'system' | 'isp' | 'anlage' | 'geraet'

const TYP_KUERZEL: Record<Typ, string> = { kunde: 'KU', system: 'KS', isp: 'IS', anlage: 'AN', geraet: 'GR' }
const TYP_NAME: Record<Typ, string> = { kunde: 'Kunde', system: 'Kundensystem', isp: 'ISP', anlage: 'Anlage', geraet: 'Gerät' }

/** Offener Bearbeiten- oder Anlegen-Dialog */
interface DialogZustand {
  typ: ObjektTyp
  id?: number
  elternId?: number | null
  zuordnung?: { kunde_id?: number; system_id?: number }
}

function schluessel(typ: Typ, id: number | null) {
  return `${typ}:${id}`
}

/** Pfad (Schlüssel aller Vorfahren) zu einem Knoten, damit der Baum dorthin aufklappt. */
function vorfahren(kunden: BaumKunde[], typ: Typ, id: number): string[] {
  for (const k of kunden) {
    for (const s of k.systeme) {
      if (typ === 'system' && s.id === id) return [schluessel('kunde', k.id)]
      for (const i of s.isps) {
        if (typ === 'isp' && i.id === id) return [schluessel('kunde', k.id), schluessel('system', s.id)]
        for (const a of i.anlagen) {
          if (typ === 'anlage' && a.id === id) {
            return [schluessel('kunde', k.id), schluessel('system', s.id), schluessel('isp', i.id)]
          }
        }
      }
    }
  }
  return []
}

function passt(text: string | null | undefined, q: string) {
  return !!text && text.toLowerCase().includes(q)
}

function filtern(kunden: BaumKunde[], q: string): BaumKunde[] {
  if (!q) return kunden
  return kunden
    .map((k) => {
      if (passt(k.name, q)) return k
      const systeme = k.systeme
        .map((s) => {
          if (passt(s.name, q) || passt(s.ort, q)) return s
          const isps = s.isps
            .map((i) => {
              if (passt(i.name, q) || passt(i.beschreibung, q)) return i
              const anlagen = i.anlagen.filter((a) => passt(a.name, q) || passt(a.beschreibung, q))
              return anlagen.length ? { ...i, anlagen } : null
            })
            .filter(Boolean) as BaumIsp[]
          return isps.length ? { ...s, isps } : null
        })
        .filter(Boolean) as BaumSystem[]
      return systeme.length ? { ...k, systeme } : null
    })
    .filter(Boolean) as BaumKunde[]
}

export default function KundenAnlagen() {
  const params = useParams()
  const typ = params.typ as Typ | undefined
  const id = params.id ? Number(params.id) : undefined
  const [kunden, setKunden] = useState<BaumKunde[] | null>(null)
  const [offen, setOffen] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [darf, setDarf] = useState(false)
  const [neuerKunde, setNeuerKunde] = useState(false)
  const navigate = useNavigate()

  const ladenBaum = useCallback(() => {
    api.get<{ kunden: BaumKunde[]; darf_bearbeiten: boolean }>('/api/baum').then((r) => {
      setKunden(r.kunden)
      setDarf(r.darf_bearbeiten)
    })
  }, [])
  useEffect(ladenBaum, [ladenBaum])

  useEffect(() => {
    if (!kunden || !typ || id === undefined) return
    setOffen((alt) => new Set([...alt, ...vorfahren(kunden, typ, id), schluessel(typ, id)]))
  }, [kunden, typ, id])

  const q = filter.trim().toLowerCase()
  const sichtbar = useMemo(() => (kunden ? filtern(kunden, q) : []), [kunden, q])
  const istOffen = (k: string) => !!q || offen.has(k)
  const umschalten = (k: string) =>
    setOffen((alt) => {
      const neu = new Set(alt)
      if (neu.has(k)) neu.delete(k)
      else neu.add(k)
      return neu
    })

  const knoten = (t: Typ, nid: number | null, label: string, ebene: number, kinder: boolean, zusatz?: string) => {
    const k = schluessel(t, nid)
    const aktiv = typ === t && id === nid
    return (
      <div className={`baum-knoten${aktiv ? ' aktiv' : ''}`} style={{ paddingLeft: 8 + ebene * 16 }}>
        {kinder ? (
          <button type="button" className="baum-pfeil" aria-label={istOffen(k) ? 'Zuklappen' : 'Aufklappen'} aria-expanded={istOffen(k)} onClick={() => umschalten(k)}>
            <Icon name={istOffen(k) ? 'pfeilRunter' : 'pfeilRechts'} size={14} />
          </button>
        ) : (
          <span className="baum-pfeil" />
        )}
        <span className={`typ-marke typ-${t}`}>{TYP_KUERZEL[t]}</span>
        {nid === null ? (
          <span className="baum-label">{label}</span>
        ) : (
          <Link to={`/objekte/${t}/${nid}`} className="baum-label" title={zusatz ? `${label} · ${zusatz}` : label}>
            {label}
            {zusatz && <span className="gedaempft"> · {zusatz}</span>}
          </Link>
        )}
      </div>
    )
  }

  return (
    <div className={`objekte${typ ? ' mit-detail' : ''}`}>
      <aside className="baum" aria-label="Objektbaum">
        <div className="baum-kopf">
          <div className="baum-kopf-zeile">
            <h1 className="titel-klein">Kunden &amp; Anlagen</h1>
            {darf && (
              <button type="button" className="knopf klein" onClick={() => setNeuerKunde(true)}>
                <Icon name="plus" size={15} /> Kunde
              </button>
            )}
          </div>
          <label className="suchfeld">
            <Icon name="suche" size={16} />
            <input type="search" aria-label="Objekte filtern" placeholder="Kunde, System, ISP, Anlage" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
        </div>
        <div className="baum-liste" role="tree">
          {!kunden && <p className="gedaempft">Wird geladen …</p>}
          {kunden && sichtbar.length === 0 && <p className="gedaempft">Nichts gefunden.</p>}
          {sichtbar.map((k) => (
            <div key={schluessel('kunde', k.id)} role="treeitem">
              {knoten('kunde', k.id, k.name, 0, k.systeme.length > 0)}
              {istOffen(schluessel('kunde', k.id)) &&
                k.systeme.map((s) => (
                  <div key={s.id}>
                    {knoten('system', s.id, s.name, 1, s.isps.length > 0, s.ort ?? undefined)}
                    {istOffen(schluessel('system', s.id)) &&
                      s.isps.map((i) => (
                        <div key={i.id}>
                          {knoten('isp', i.id, i.name, 2, i.anlagen.length > 0, i.beschreibung ?? undefined)}
                          {istOffen(schluessel('isp', i.id)) &&
                            i.anlagen.map((a) => (
                              <div key={a.id}>{knoten('anlage', a.id, a.name, 3, false, a.beschreibung ?? undefined)}</div>
                            ))}
                        </div>
                      ))}
                  </div>
                ))}
            </div>
          ))}
        </div>
      </aside>
      <section className="objekt-detail">
        {typ && id !== undefined ? (
          <Detail key={`${typ}-${id}`} typ={typ} id={id} darf={darf} onGeaendert={ladenBaum} />
        ) : (
          <div className="karte leer">Wähle links einen Kunden, ein System, eine ISP oder eine Anlage.</div>
        )}
      </section>
      {neuerKunde && (
        <ObjektDialog
          typ="kunde"
          onClose={() => setNeuerKunde(false)}
          onGespeichert={(nid) => {
            setNeuerKunde(false)
            ladenBaum()
            navigate(`/objekte/kunde/${nid}`)
          }}
        />
      )}
    </div>
  )
}

const ENDPUNKT: Record<Typ, string> = { kunde: 'kunden', system: 'systeme', isp: 'isps', anlage: 'anlagen', geraet: 'geraete' }

/** Wohin nach dem Löschen: zum übergeordneten Objekt */
function elternPfad(typ: Typ, d: any): string {
  if (typ === 'system' && d.system.KSKundeID) return `/objekte/kunde/${d.system.KSKundeID}`
  if (typ === 'isp') return `/objekte/system/${d.isp.ISKS}`
  if (typ === 'anlage') return `/objekte/isp/${d.anlage.isp_id}`
  if (typ === 'geraet') return `/objekte/anlage/${d.geraet.anlage_id}`
  return '/objekte'
}

function Detail({ typ, id, darf, onGeaendert }: { typ: Typ; id: number; darf: boolean; onGeaendert: () => void }) {
  const [daten, setDaten] = useState<any>(null)
  const [fehler, setFehler] = useState('')
  const [tab, setTab] = useState(0)
  const [dialog, setDialog] = useState<DialogZustand | null>(null)
  const navigate = useNavigate()

  const laden = useCallback(() => {
    api.get(`/api/${ENDPUNKT[typ]}/${id}`).then(setDaten).catch((e) => setFehler(e.message))
  }, [typ, id])
  useEffect(laden, [laden])

  if (fehler) return <div className="karte leer">{fehler}</div>
  if (!daten) return <p className="gedaempft">Wird geladen …</p>

  const gespeichert = (z: DialogZustand, nid: number) => {
    setDialog(null)
    onGeaendert()
    if (!z.id && z.typ !== 'ansprechpartner') navigate(`/objekte/${z.typ}/${nid}`)
    else laden()
  }
  const geloescht = (z: DialogZustand) => {
    setDialog(null)
    onGeaendert()
    if (z.typ === typ && z.id === id) navigate(elternPfad(typ, daten))
    else laden()
  }

  const sicht = ansicht(typ, daten, { darf, oeffne: setDialog })
  const tabs = sicht.tabs.filter(Boolean) as Tab[]
  const aktiverTab = tabs[Math.min(tab, tabs.length - 1)]

  return (
    <div className="detail">
      <button type="button" className="knopf klein nur-mobil" onClick={() => navigate('/objekte')}>
        <Icon name="links" size={16} /> Zur Übersicht
      </button>
      {sicht.pfad.length > 0 && (
        <nav className="brotkrumen" aria-label="Pfad">
          {sicht.pfad.map((p, i) => (
            <span key={i}>
              {p.to ? <Link to={p.to}>{p.label}</Link> : p.label}
              {i < sicht.pfad.length - 1 && <span aria-hidden="true"> › </span>}
            </span>
          ))}
        </nav>
      )}
      <div className="detail-kopf">
        <div>
          <span className={`typ-marke typ-${typ} gross`}>{TYP_NAME[typ]}</span>
          <h1 className="seitentitel">{sicht.titel}</h1>
          {sicht.untertitel && <p className="gedaempft">{sicht.untertitel}</p>}
        </div>
        {darf && (
          <button type="button" className="knopf" onClick={() => setDialog({ typ, id })}>Bearbeiten</button>
        )}
        {daten.fotos?.[0] && (
          <img className="uebersichtsfoto" src={`/api/fotos/${daten.fotos[0].id}/datei`} alt={daten.fotos[0].beschreibung || 'Übersichtsfoto'} />
        )}
      </div>
      <dl className="feld-raster">
        {sicht.felder
          .filter(([, w]) => w !== null && w !== undefined && w !== '')
          .map(([k, w]) => (
            <div key={k} className="feld-kachel">
              <dt>{k}</dt>
              <dd>{w}</dd>
            </div>
          ))}
      </dl>
      <div className="tabs" role="tablist">
        {tabs.map((t, i) => (
          <button key={t.label} type="button" role="tab" aria-selected={t === aktiverTab} className={t === aktiverTab ? 'aktiv' : ''} onClick={() => setTab(i)}>
            {t.label} <span className="zaehler">{t.anzahl}</span>
          </button>
        ))}
      </div>
      <div className="karte tab-inhalt" role="tabpanel">
        {aktiverTab?.aktion && <div className="tab-aktionen">{aktiverTab.aktion}</div>}
        {aktiverTab?.inhalt}
      </div>
      {dialog && (
        <ObjektDialog
          {...dialog}
          onClose={() => setDialog(null)}
          onGespeichert={(nid) => gespeichert(dialog, nid)}
          onGeloescht={() => geloescht(dialog)}
        />
      )}
    </div>
  )
}

interface Tab { label: string; anzahl: number; inhalt: ReactNode; aktion?: ReactNode }

interface Kontext { darf: boolean; oeffne: (z: DialogZustand) => void }

function NeuKnopf({ ctx, label, zustand }: { ctx: Kontext; label: string; zustand: DialogZustand }) {
  if (!ctx.darf) return null
  return (
    <button type="button" className="knopf klein" onClick={() => ctx.oeffne(zustand)}>
      <Icon name="plus" size={15} /> {label}
    </button>
  )
}

function Tabelle({ spalten, zeilen, leer, onZeile }: { spalten: string[]; zeilen: ReactNode[][]; leer: string; onZeile?: (i: number) => void }) {
  if (!zeilen.length) return <p className="gedaempft">{leer}</p>
  return (
    <div className="tabelle-rahmen">
      <table className="tabelle">
        <thead>
          <tr>{spalten.map((s) => <th key={s}>{s}</th>)}</tr>
        </thead>
        <tbody>
          {zeilen.map((z, i) => (
            <tr key={i} className={onZeile ? 'zeile-klickbar' : undefined} onClick={onZeile ? () => onZeile(i) : undefined}
              title={onZeile ? 'Zum Bearbeiten klicken' : undefined}>
              {z.map((c, j) => <td key={j}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Ergebnis({ wert }: { wert: string | null }) {
  if (!wert) return <span className="gedaempft">–</span>
  return <span className={`ergebnis ergebnis-${wert.toLowerCase()}`}>{wert}</span>
}

function Fotos({ fotos }: { fotos: Foto[] }) {
  if (!fotos.length) return <p className="gedaempft">Keine Fotos vorhanden.</p>
  return (
    <div className="foto-raster">
      {fotos.map((f) => (
        <a key={f.id} href={`/api/fotos/${f.id}/datei`} target="_blank" rel="noreferrer" className="foto-kachel">
          <img src={`/api/fotos/${f.id}/datei`} alt={f.beschreibung || f.originalname || 'Foto'} loading="lazy" />
          <span>{f.beschreibung || lang(f.aufnahmedatum) || f.originalname}</span>
        </a>
      ))}
    </div>
  )
}

function ansprechpartnerTab(liste: any[], ctx: Kontext, zuordnung: { kunde_id?: number; system_id?: number }): Tab {
  return {
    label: 'Ansprechpartner',
    anzahl: liste.length,
    aktion: <NeuKnopf ctx={ctx} label="Ansprechpartner" zustand={{ typ: 'ansprechpartner', zuordnung }} />,
    inhalt: (
      <Tabelle
        spalten={['Name', 'Funktion', 'Telefon', 'Mobil', 'E-Mail']}
        leer="Keine Ansprechpartner hinterlegt."
        onZeile={ctx.darf ? (i) => ctx.oeffne({ typ: 'ansprechpartner', id: liste[i].id }) : undefined}
        zeilen={liste.map((a) => [
          `${a.vorname ?? ''} ${a.nachname ?? ''}`.trim(),
          a.funktion,
          a.telefon && <a href={`tel:${a.telefon}`} onClick={(e) => e.stopPropagation()}>{a.telefon}</a>,
          a.mobil && <a href={`tel:${a.mobil}`} onClick={(e) => e.stopPropagation()}>{a.mobil}</a>,
          a.email && <a href={`mailto:${a.email}`} onClick={(e) => e.stopPropagation()}>{a.email}</a>,
        ])}
      />
    ),
  }
}

function fotosTab(fotos: Foto[]): Tab {
  return { label: 'Fotos', anzahl: fotos.length, inhalt: <Fotos fotos={fotos} /> }
}

function ansicht(typ: Typ, d: any, ctx: Kontext): {
  titel: string
  untertitel?: string
  pfad: { label: string; to?: string }[]
  felder: [string, ReactNode][]
  tabs: (Tab | false)[]
} {
  switch (typ) {
    case 'kunde': {
      const k = d.kunde
      return {
        titel: k.KUName,
        pfad: [],
        felder: [
          ['Adresse', [k.KUStrasse, [k.KUPLZ, k.KUOrt].filter(Boolean).join(' '), k.KULand].filter(Boolean).join(', ')],
          ['Telefon', k.KUTelefon],
          ['E-Mail', k.KUEmail],
          ['Webseite', k.KUWebseite],
          ['Beschreibung', k.KUBeschreibung],
        ],
        tabs: [
          {
            label: 'Systeme',
            anzahl: d.systeme.length,
            aktion: <NeuKnopf ctx={ctx} label="System" zustand={{ typ: 'system', elternId: k.KUID }} />,
            inhalt: (
              <Tabelle
                spalten={['System', 'Ort', 'Niederlassung', 'ISPs']}
                leer="Keine Systeme."
                zeilen={d.systeme.map((s: any) => [<Link to={`/objekte/system/${s.id}`}>{s.name}</Link>, s.ort, s.niederlassung, s.isps])}
              />
            ),
          },
          ansprechpartnerTab(d.ansprechpartner, ctx, { kunde_id: k.KUID }),
        ],
      }
    }
    case 'system': {
      const s = d.system
      return {
        titel: s.KSName,
        untertitel: s.KSKunde,
        pfad: s.KSKundeID ? [{ label: s.KSKunde, to: `/objekte/kunde/${s.KSKundeID}` }, { label: s.KSName }] : [],
        felder: [
          ['Ort', s.KSOrt],
          ['Adresse', s.KSAdresse],
          ['Niederlassung', s.niederlassung],
          ['Leitebene', s.leitebene],
          ['DDC', s.ddc],
          ['Beschreibung', s.KSBeschreibung],
        ],
        tabs: [
          {
            label: 'ISPs',
            anzahl: d.isps.length,
            aktion: <NeuKnopf ctx={ctx} label="ISP" zustand={{ typ: 'isp', elternId: s.KSID }} />,
            inhalt: (
              <Tabelle
                spalten={['ISP', 'Beschreibung', 'Typ', 'BMS', 'Anlagen']}
                leer="Keine ISPs."
                zeilen={d.isps.map((i: any) => [<Link to={`/objekte/isp/${i.id}`}>{i.name}</Link>, i.beschreibung, i.typ, i.bms, i.anlagen])}
              />
            ),
          },
          {
            label: 'Aufträge',
            anzahl: d.auftraege.length,
            inhalt: (
              <Tabelle
                spalten={['Auftrag', 'Typ', 'Status', 'Verantwortlich']}
                leer="Keine Aufträge."
                zeilen={d.auftraege.map((a: any) => [a.name, a.typ, a.status, a.techniker])}
              />
            ),
          },
          ansprechpartnerTab(d.ansprechpartner, ctx, { system_id: s.KSID }),
          {
            label: 'Techniker',
            anzahl: d.mitarbeiter.length,
            inhalt: (
              <Tabelle
                spalten={['Name', 'Rolle']}
                leer="Keine Techniker zugeordnet."
                zeilen={d.mitarbeiter.map((m: any) => [m.name, m.primaer ? 'Haupttechniker' : 'Vertretung'])}
              />
            ),
          },
          fotosTab(d.fotos),
        ],
      }
    }
    case 'isp': {
      const i = d.isp
      return {
        titel: i.ISName,
        untertitel: i.ISBeschreibung,
        pfad: [{ label: i.kunde_name }, { label: i.system_name, to: `/objekte/system/${i.ISKS}` }, { label: i.ISName }],
        felder: [
          ['Typ', i.typ],
          ['BMS', i.bms],
          ['Ort', i.ISOrt],
        ],
        tabs: [
          {
            label: 'Anlagen',
            anzahl: d.anlagen.length,
            aktion: <NeuKnopf ctx={ctx} label="Anlage" zustand={{ typ: 'anlage', elternId: i.ISID }} />,
            inhalt: (
              <Tabelle
                spalten={['Anlage', 'Beschreibung', 'Typ', 'Geräte']}
                leer="Keine Anlagen."
                zeilen={d.anlagen.map((a: any) => [<Link to={`/objekte/anlage/${a.id}`}>{a.name}</Link>, a.beschreibung, a.typ, a.geraete])}
              />
            ),
          },
          fotosTab(d.fotos),
        ],
      }
    }
    case 'anlage': {
      const a = d.anlage
      return {
        titel: a.ANName,
        untertitel: a.ANBeschreibung,
        pfad: [
          { label: a.kunde_name },
          { label: a.system_name, to: `/objekte/system/${a.system_id}` },
          { label: a.isp_name, to: `/objekte/isp/${a.isp_id}` },
          { label: a.ANName },
        ],
        felder: [['Anlagentyp', a.typ]],
        tabs: [
          {
            label: 'Geräte',
            anzahl: d.geraete.length,
            aktion: <NeuKnopf ctx={ctx} label="Gerät" zustand={{ typ: 'geraet', elternId: a.ANID }} />,
            inhalt: (
              <Tabelle
                spalten={['Gerät', 'BMKZ', 'Art', 'Hersteller', 'Typ', 'Letztes Ergebnis']}
                leer="Keine Geräte."
                zeilen={d.geraete.map((g: any) => [
                  <Link to={`/objekte/geraet/${g.id}`}>{g.name}</Link>,
                  <span className="mono">{g.bmkz}</span>,
                  g.art,
                  g.hersteller,
                  g.typ,
                  <Ergebnis wert={g.letztes_ergebnis} />,
                ])}
              />
            ),
          },
          fotosTab(d.fotos),
        ],
      }
    }
    case 'geraet': {
      const g = d.geraet
      return {
        titel: g.GRName,
        untertitel: g.art,
        pfad: [
          { label: g.system_name, to: `/objekte/system/${g.system_id}` },
          { label: g.isp_name, to: `/objekte/isp/${g.isp_id}` },
          { label: g.anlage_name, to: `/objekte/anlage/${g.anlage_id}` },
          { label: g.GRName },
        ],
        felder: [
          ['BMKZ', g.GRBMKZ && <span className="mono">{g.GRBMKZ}</span>],
          ['Hersteller', g.GRHersteller],
          ['Typ', g.GRTyp],
          ['Einbauort', g.GREinbauort],
          ['Baujahr', g.GRBaujahr || null],
          ['Leistung', g.GRLeistung],
          ['Nennleistung', g.GRNennleistung],
          ['Nennstrom', g.GRNennstrom],
          ['Spannung', g.GRSpannung],
          ['Wartungspflichtig', g.GRWartungspflichtig ? 'ja' : 'nein'],
        ],
        tabs: [
          {
            label: 'Wartungsverlauf',
            anzahl: d.wartungsaufgaben.length,
            inhalt: (
              <Tabelle
                spalten={['Aufgabe', 'Auftrag', 'Status', 'Ergebnis', 'Erledigt', 'Techniker']}
                leer="Noch keine Wartungsaufgaben."
                zeilen={d.wartungsaufgaben.map((w: any) => [
                  w.aufgabenname,
                  w.auftrag,
                  w.status,
                  <Ergebnis wert={w.ergebnis} />,
                  lang(w.erledigt_datum),
                  w.techniker,
                ])}
              />
            ),
          },
          fotosTab(d.fotos),
        ],
      }
    }
  }
}
