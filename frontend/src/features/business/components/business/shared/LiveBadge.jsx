// Tells the owner whether the numbers are final or still changing, and up to what time.
// Used by Daily ("so far today") and Weekly ("this week so far").
export default function LiveBadge({ live, asOf, liveText, doneText }) {
  return live ? (
    <p className="live" role="status">
      <span className="live__dot" aria-hidden="true" />
      <strong>Live</strong> · {liveText} · up to {asOf}
    </p>
  ) : (
    <p className="live live--done"><strong>{doneText}</strong> · final numbers</p>
  )
}
