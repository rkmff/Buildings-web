/** Datumshelfer. Alle Daten sind ISO-Strings (YYYY-MM-DD) in lokaler Zeit. */

export function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function toIso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function addDays(iso: string, n: number): string {
  const d = parseIso(iso)
  d.setDate(d.getDate() + n)
  return toIso(d)
}

export function montag(iso: string): string {
  const d = parseIso(iso)
  const wd = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - wd)
  return toIso(d)
}

export function heute(): string {
  return toIso(new Date())
}

export function kalenderwoche(iso: string): number {
  const d = parseIso(iso)
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dayNr = (target.getDay() + 6) % 7
  target.setDate(target.getDate() - dayNr + 3)
  const firstThursday = new Date(target.getFullYear(), 0, 4)
  const diff = (target.getTime() - firstThursday.getTime()) / 86400000
  return 1 + Math.round((diff - 3 + ((firstThursday.getDay() + 6) % 7)) / 7)
}

export function kurz(iso: string): string {
  const d = parseIso(iso)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`
}

export function lang(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = parseIso(iso.slice(0, 10))
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function istWochenende(iso: string): boolean {
  const wd = parseIso(iso).getDay()
  return wd === 0 || wd === 6
}

export const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

export function langesHeute(): string {
  return new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}
