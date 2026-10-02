import type { Einstellungen } from './types'

function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as [number, number, number]
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Weiß oder fast schwarz, je nachdem was auf der Farbe besser lesbar ist. */
export function textAuf(hex: string | null | undefined): string {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return '#ffffff'
  const l = luminance(hex)
  return (l + 0.05) / 0.05 > 1.05 / (l + 0.05) ? '#111a14' : '#ffffff'
}

function aufgeloestesTheme(theme: Einstellungen['theme']): 'hell' | 'dunkel' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dunkel' : 'hell'
  }
  return theme
}

export function themeAnwenden(e: Pick<Einstellungen, 'theme' | 'akzentfarbe'>) {
  const root = document.documentElement
  root.dataset.theme = aufgeloestesTheme(e.theme)
  root.style.setProperty('--accent', e.akzentfarbe)
  root.style.setProperty('--on-accent', textAuf(e.akzentfarbe))
  try {
    localStorage.setItem('buildings.theme', JSON.stringify({ theme: e.theme, akzentfarbe: e.akzentfarbe }))
  } catch {
    /* Speicher nicht verfügbar */
  }
}

/** Vor dem Login: zuletzt benutzte Darstellung dieses Browsers. */
export function gespeichertesThemeAnwenden() {
  try {
    const raw = localStorage.getItem('buildings.theme')
    if (raw) {
      themeAnwenden(JSON.parse(raw))
      return
    }
  } catch {
    /* ignorieren */
  }
  themeAnwenden({ theme: 'system', akzentfarbe: '#16a34a' })
}

export const AKZENT_VORSCHLAEGE = ['#16a34a', '#0f766e', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#ca8a04', '#475569']
