import { useCallback, useEffect, useRef, useState } from 'react';

// Runs an async loader whenever `deps` change. Aborts the previous request, so a slow old response
// can never overwrite newer data. Returns { data, error, loading, reload }.
export default function useAsync(loader, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    loaderRef.current({ signal: ctrl.signal })
      .then((data) => { if (!ctrl.signal.aborted) setState({ data, error: null, loading: false }); })
      .catch((error) => { if (error?.name !== 'AbortError') setState((s) => ({ ...s, error, loading: false })); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
