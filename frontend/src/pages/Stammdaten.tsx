import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import Icon from '../components/Icon'
import { lang } from '../datum'

interface Liste {
  slug: string
  gruppe: string
  titel: string
  anzahl: number
  darf_bearbeiten: boolean
}

interface Feld {
  name: string
  label: string
  typ: 'text' | 'lang' | 'farbe' | 'datum' | 'bool' | 'zahl'
  pflicht: boolean
}

type Wert = string | number | null
interface Eintrag {
  id: number
  verwendung: { label: string; anzahl: number; link: string | null }[]
  [feld: string]: unknown
}

interface ListenDaten {
  titel: string
  darf_bearbeiten: boolean
  felder: Feld[]
  eintraege: Eintrag[]
}

export default function Stammdaten() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const [listen, setListen] = useState<Liste[] | null>(null)

  const ladenListen = useCallback(() => {
    api.get<{ listen: Liste[] }>('/api/stammdaten').then((r) => setListen(r.listen))
  }, [])
  useEffect(ladenListen, [ladenListen])

  const gruppen = useMemo(() => {
    const out: { gruppe: string; listen: Liste[] }[] = []
    for (const l of listen ?? []) {
      let g = out.find((x) => x.gruppe === l.gruppe)
      if (!g) out.push((g = { gruppe: l.gruppe, listen: [] }))
      g.listen.push(l)
    }
    return out
  }, [listen])

  return (
    <div className={`objekte${slug ? ' mit-detail' : ''}`}>
      <aside className="baum" aria-label="Stammdaten-Listen">
        <div className="baum-kopf">
          <h1 className="titel-klein">Stammdaten</h1>
          <p className="gedaempft klein">
            Auswahllisten für die übrigen Bereiche. Kunden und Anlagen pflegst du unter{' '}
            <Link to="/objekte">Kunden &amp; Anlagen</Link>, Personen unter <Link to="/mitarbeiter">Mitarbeiter</Link>.
          </p>
        </div>
        <nav className="baum-liste">
          {gruppen.map((g) => (
            <div key={g.gruppe}>
              <h2 className="mini-titel personen-gruppe">{g.gruppe}</h2>
              {g.listen.map((l) => (
                <Link key={l.slug} to={`/stammdaten/${l.slug}`} className={`personen-zeile${l.slug === slug ? ' aktiv' : ''}`}>
                  <span className="personen-text"><strong>{l.titel}</strong></span>
                  <span className="mono klein gedaempft">{l.anzahl}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <section className="objekt-detail">
        {slug ? (
          <ListenAnsicht key={slug} slug={slug} onGeaendert={ladenListen} onZurueck={() => navigate('/stammdaten')} />
        ) : (
          <div className="karte leer">Wähle links eine Liste.</div>
        )}
      </section>
    </div>
  )
}

function leer(felder: Feld[]): Record<string, Wert> {
  const w: Record<string, Wert> = {}
  for (const f of felder) w[f.name] = f.typ === 'bool' ? 1 : f.typ === 'farbe' ? '#16a34a' : ''
  return w
}

function ListenAnsicht({ slug, onGeaendert, onZurueck }: { slug: string; onGeaendert: () => void; onZurueck: () => void }) {
  const [daten, setDaten] = useState<ListenDaten | null>(null)
  const [bearbeiten, setBearbeiten] = useState<number | 'neu' | null>(null)
  const [werte, setWerte] = useState<Record<string, Wert>>({})
  const [filter, setFilter] = useState('')
  const [fehler, setFehler] = useState('')

  const laden = useCallback(() => {
    api.get<ListenDaten>(`/api/stammdaten/${slug}`).then(setDaten).catch((e) => setFehler(e.message))
  }, [slug])
  useEffect(laden, [laden])

  if (!daten) return fehler ? <div className="karte leer">{fehler}</div> : <p className="gedaempft">Wird geladen …</p>

  const starten = (e: Eintrag | 'neu') => {
    setFehler('')
    if (e === 'neu') {
      setWerte(leer(daten.felder))
      setBearbeiten('neu')
    } else {
      setWerte(Object.fromEntries(daten.felder.map((f) => [f.name, (e[f.name] as Wert) ?? ''])))
      setBearbeiten(e.id)
    }
  }
  const speichern = async () => {
    try {
      if (bearbeiten === 'neu') await api.post(`/api/stammdaten/${slug}`, werte)
      else await api.put(`/api/stammdaten/${slug}/${bearbeiten}`, werte)
      setBearbeiten(null)
      laden()
      onGeaendert()
    } catch (e) {
      setFehler((e as Error).message)
    }
  }
  const loeschen = async (e: Eintrag) => {
    if (!window.confirm('Eintrag löschen?')) return
    try {
      await api.del(`/api/stammdaten/${slug}/${e.id}`)
      laden()
      onGeaendert()
    } catch (err) {
      setFehler((err as Error).message)
    }
  }

  const q = filter.trim().toLowerCase()
  const sichtbar = q
    ? daten.eintraege.filter((e) => daten.felder.some((f) => String(e[f.name] ?? '').toLowerCase().includes(q)))
    : daten.eintraege
  const kurzeFelder = daten.felder.filter((f) => f.typ !== 'lang')
  const langFeld = daten.felder.find((f) => f.typ === 'lang')

  const eingabe = (f: Feld) => {
    const v = werte[f.name]
    const setze = (x: Wert) => setWerte((w) => ({ ...w, [f.name]: x }))
    if (f.typ === 'bool') return <input type="checkbox" aria-label={f.label} checked={!!Number(v)} onChange={(e) => setze(e.target.checked ? 1 : 0)} />
    if (f.typ === 'farbe') return <input type="color" aria-label={f.label} className="farbe-klein" value={String(v || '#16a34a')} onChange={(e) => setze(e.target.value)} />
    if (f.typ === 'lang') return <textarea aria-label={f.label} rows={2} value={String(v ?? '')} onChange={(e) => setze(e.target.value)} />
    return (
      <input aria-label={f.label} type={f.typ === 'datum' ? 'date' : f.typ === 'zahl' ? 'number' : 'text'}
        value={String(v ?? '')} onChange={(e) => setze(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') speichern(); if (e.key === 'Escape') setBearbeiten(null) }} />
    )
  }

  const anzeige = (f: Feld, e: Eintrag) => {
    const v = e[f.name]
    if (f.typ === 'bool') return Number(v) ? 'ja' : 'nein'
    if (f.typ === 'farbe') return <span className="zeile"><span className="farbpunkt gross" style={{ background: String(v || '#ccc') }} /><span className="mono klein">{String(v ?? '')}</span></span>
    if (f.typ === 'datum') return v ? lang(String(v)) : '–'
    return v === null || v === '' ? '–' : String(v)
  }

  const formularZeile = (
    <tr className="bearbeiten-zeile">
      {kurzeFelder.map((f) => <td key={f.name}>{eingabe(f)}</td>)}
      {langFeld && <td>{eingabe(langFeld)}</td>}
      <td />
      <td className="aktionen-zelle">
        <button type="button" className="knopf klein primaer" onClick={speichern}>Speichern</button>
        <button type="button" className="knopf klein" onClick={() => setBearbeiten(null)}>Abbrechen</button>
      </td>
    </tr>
  )

  return (
    <div className="detail">
      <button type="button" className="knopf klein nur-mobil" onClick={onZurueck}>
        <Icon name="links" size={16} /> Zur Übersicht
      </button>
      <div className="seiten-kopf">
        <h2 className="seitentitel">{daten.titel}</h2>
        <div className="werkzeugleiste">
          {daten.eintraege.length > 12 && (
            <label className="suchfeld">
              <Icon name="suche" size={16} />
              <input type="search" aria-label="Liste filtern" placeholder="Filtern" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </label>
          )}
          {daten.darf_bearbeiten && (
            <button type="button" className="knopf primaer" onClick={() => starten('neu')} disabled={bearbeiten !== null}>
              <Icon name="plus" size={16} /> Neu
            </button>
          )}
        </div>
      </div>
      {!daten.darf_bearbeiten && <p className="gedaempft klein">Diese Liste können nur Administratoren ändern.</p>}
      {fehler && <p className="fehler" role="alert">{fehler}</p>}
      <div className="karte tab-inhalt">
        <div className="tabelle-rahmen">
          <table className="tabelle stammdaten-tabelle">
            <thead>
              <tr>
                {kurzeFelder.map((f) => <th key={f.name}>{f.label}</th>)}
                {langFeld && <th>{langFeld.label}</th>}
                <th>Verwendet</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {bearbeiten === 'neu' && formularZeile}
              {sichtbar.map((e) =>
                bearbeiten === e.id ? (
                  <Fragment key={e.id}>{formularZeile}</Fragment>
                ) : (
                  <tr key={e.id}>
                    {kurzeFelder.map((f) => <td key={f.name}>{anzeige(f, e)}</td>)}
                    {langFeld && <td className="gedaempft">{anzeige(langFeld, e)}</td>}
                    <td>
                      {e.verwendung.length === 0 ? (
                        <span className="gedaempft">–</span>
                      ) : (
                        e.verwendung.map((v) =>
                          v.link ? (
                            <Link key={v.label} to={v.link} className="status-pille verwendung">{v.anzahl} {v.label}</Link>
                          ) : (
                            <span key={v.label} className="status-pille verwendung">{v.anzahl} {v.label}</span>
                          ),
                        )
                      )}
                    </td>
                    <td className="aktionen-zelle">
                      {daten.darf_bearbeiten && (
                        <>
                          <button type="button" className="knopf klein" onClick={() => starten(e)} disabled={bearbeiten !== null}>Bearbeiten</button>
                          <button type="button" className="icon-knopf klein" aria-label="Löschen"
                            title={e.verwendung.length ? 'Wird noch verwendet' : 'Löschen'}
                            disabled={e.verwendung.length > 0 || bearbeiten !== null} onClick={() => loeschen(e)}>
                            <Icon name="papierkorb" size={15} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ),
              )}
              {sichtbar.length === 0 && bearbeiten !== 'neu' && (
                <tr><td colSpan={kurzeFelder.length + 3} className="gedaempft">Keine Einträge.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
