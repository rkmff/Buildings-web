export type Theme = 'hell' | 'dunkel' | 'system'
export type Rolle = 'admin' | 'dispatcher' | 'mitarbeiter'

export interface Einstellungen {
  theme: Theme
  akzentfarbe: string
  planung_wochen: number
}

export interface User {
  id: number
  vorname: string
  nachname: string
  benutzername: string
  funktion: string
  rolle: Rolle
  niederlassung_id: number | null
  muss_passwort_aendern: boolean
  einstellungen: Einstellungen
}

export interface Planungseintrag {
  id: number
  mitarbeiter_id: number
  start_datum: string
  ende_datum: string
  typ: 'auftrag' | 'abwesenheit' | 'manuell'
  titel: string
  untertitel: string
  farbe: string
  auftrag_id: number | null
  system_id: number | null
  abwesenheitsart_id: number | null
  bemerkung: string
  anzeigetext: string
}

export interface PlanungAntwort {
  mitarbeiter_id: number
  von: string
  bis: string
  darf_bearbeiten: boolean
  eintraege: Planungseintrag[]
  feiertage: { datum: string; bezeichnung: string }[]
  bereitschaften: { id: number; start_datum: string; ende_datum: string }[]
}

export interface Abwesenheitsart {
  id: number
  bezeichnung: string
  kuerzel: string | null
  farbe: string | null
}

export interface AuftragKurz {
  id: number
  name: string
  status: string | null
  typ: string | null
  kunde: string | null
  system: string | null
  farbe: string
  techniker?: string | null
  wartung_gesamt?: number
  wartung_erledigt?: number
  rolle?: 'haupt' | 'mit'
  fortschritt?: number
}

export interface Aufgabe {
  id: number
  titel: string
  beschreibung: string | null
  status: string | null
  auftrag_id: number | null
  auftrag: string | null
  system_id?: number | null
  kunde?: string | null
  system?: string | null
}

export interface Ausruestung {
  id: number
  name: string
  typ: string | null
  hersteller: string | null
  naechste_pruefung: string | null
  ausruestungstyp: string | null
}

export interface Uebergabe {
  id: number
  name: string
  gestartet_am: string | null
  von: string | null
}

export interface Foto {
  id: number
  originalname: string | null
  beschreibung: string | null
  aufnahmedatum: string | null
  ist_uebersichtsfoto: number
}
