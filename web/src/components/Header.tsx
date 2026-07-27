export default function Header() {
  return (
    <header className="app-header animate-in">
      <div className="app-logo">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </div>
      <div className="app-title-group">
        <h1 className="app-title">dpcheck</h1>
        <p className="app-subtitle">Datapack &amp; Resource Pack Version Checker</p>
      </div>
      <span className="header-badge">content-based</span>
    </header>
  )
}
