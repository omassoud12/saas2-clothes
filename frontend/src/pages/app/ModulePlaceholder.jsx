export function ModulePlaceholder({ eyebrow, title, description, emptyMessage }) {
  return (
    <section className="business-page">
      <header className="business-page-heading">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      <div className="module-empty-state">
        <span className="module-empty-mark" aria-hidden="true">+</span>
        <h2>{title} workspace</h2>
        <p>{emptyMessage}</p>
      </div>
    </section>
  )
}
