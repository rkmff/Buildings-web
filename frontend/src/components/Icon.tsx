const PFADE: Record<string, string> = {
  logo: 'M3 21V9l6-4v16M9 21V3l12 6v12M3 21h18M13 11h4M13 15h4',
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  gebaeude: 'M4 21V5l8-3 8 3v16M4 21h16M9 9h1M14 9h1M9 13h1M14 13h1M10 21v-4h4v4',
  auftrag: 'M8 4h8l1 2h3v15H4V6h3zM9 11h6M9 15h6',
  wartung: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z',
  kalender: 'M4 6h16v15H4zM4 10h16M9 3v4M15 3v4',
  team: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a7 7 0 0 1 14 0v1M17 11a3 3 0 1 0 0-6M22 21v-1a5 5 0 0 0-4-4.9',
  werkzeug: 'M3 7h18v12H3zM8 7V4h8v3M3 12h18',
  bericht: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5',
  stammdaten: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  einstellungen: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  abmelden: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  menue: 'M4 6h16M4 12h16M4 18h16',
  schliessen: 'M6 6l12 12M18 6L6 18',
  links: 'M15 18l-6-6 6-6',
  rechts: 'M9 18l6-6-6-6',
  plus: 'M12 5v14M5 12h14',
  suche: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5',
  pfeilRunter: 'M6 9l6 6 6-6',
  pfeilRechts: 'M9 6l6 6-6 6',
  foto: 'M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  griff: 'M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01',
  papierkorb: 'M4 7h16M10 11v6M14 11v6M5 7l1 14h12l1-14M9 7V4h6v3',
  liste: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
}

export default function Icon({ name, size = 18, className }: { name: keyof typeof PFADE | string; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PFADE[name] ?? ''} />
    </svg>
  )
}
