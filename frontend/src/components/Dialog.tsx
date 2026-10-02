import { useEffect, useRef, type ReactNode } from 'react'
import Icon from './Icon'

interface Props {
  titel: string
  onClose: () => void
  children: ReactNode
  aktionen?: ReactNode
  breit?: boolean
}

export default function Dialog({ titel, onClose, children, aktionen, breit }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  // onClose ist meist eine Inline-Funktion; über die Ref läuft der Effekt nur beim Öffnen,
  // sonst würde jeder Tastendruck den Fokus auf das erste Feld zurücksetzen.
  const schliessen = useRef(onClose)
  schliessen.current = onClose

  useEffect(() => {
    const vorher = document.activeElement as HTMLElement | null
    const erstes = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.dialog-schliessen)')
    erstes?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') schliessen.current()
    }
    ref.current?.addEventListener('keydown', onKey)
    const el = ref.current
    return () => {
      el?.removeEventListener('keydown', onKey)
      vorher?.focus?.()
    }
  }, [])

  return (
    <div className="dialog-hintergrund" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`dialog${breit ? ' breit' : ''}`} role="dialog" aria-modal="true" aria-label={titel}>
        <div className="dialog-kopf">
          <h2>{titel}</h2>
          <button type="button" className="icon-knopf dialog-schliessen" aria-label="Schließen" onClick={onClose}>
            <Icon name="schliessen" />
          </button>
        </div>
        <div className="dialog-inhalt">{children}</div>
        {aktionen && <div className="dialog-aktionen">{aktionen}</div>}
      </div>
    </div>
  )
}
