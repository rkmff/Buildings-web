export default function Platzhalter({ titel }: { titel: string }) {
  return (
    <div className="seite">
      <h1 className="seitentitel">{titel}</h1>
      <div className="karte leer">Dieser Bereich wird in einem der nächsten Schritte gebaut.</div>
    </div>
  )
}
