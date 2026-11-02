// One period navigator for every tab: ‹ label (tap to pick) ›. Sticky, full width on mobile.
// The store picker lives in the page header, so this bar stays one line on a small phone.
export default function PeriodNav({ label, sub, unit, onPrev, onNext, nextDisabled, picker }) {
  return (
    <div className="pnav" role="group" aria-label={`Choose ${unit}`}>
      <button type="button" className="icon-btn" aria-label={`Previous ${unit}`} onClick={onPrev}>‹</button>
      {picker ? (
        <label className="pnav__label">
          <span className="pnav__text">{label}</span>
          {sub && <span className="pnav__sub">{sub}</span>}
          <input
            type={picker.type}
            className="pnav__input"
            value={picker.value}
            max={picker.max}
            onChange={(e) => e.target.value && picker.onPick(e.target.value)}
            aria-label={`Pick a ${unit}`}
          />
        </label>
      ) : (
        <div className="pnav__label pnav__label--static">
          <span className="pnav__text">{label}</span>
          {sub && <span className="pnav__sub">{sub}</span>}
        </div>
      )}
      <button type="button" className="icon-btn" aria-label={`Next ${unit}`} disabled={nextDisabled} onClick={onNext}>›</button>
    </div>
  )
}
