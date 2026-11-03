export function Skeleton({ height = 16, width = '100%', radius = 10 }) {
  return <span className="skeleton" style={{ height, width, borderRadius: radius }} aria-hidden="true" />;
}

export function ErrorBox({ error, onRetry }) {
  return (
    <div className="state state--error" role="alert">
      <p>{error?.message || 'Something went wrong.'}</p>
      {onRetry && <button type="button" className="btn btn--ghost" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Empty({ title, text }) {
  return (
    <div className="state">
      <p className="state__title">{title}</p>
      {text && <p>{text}</p>}
    </div>
  );
}
