import { useCallback, useEffect, useRef, useState } from 'react'

// Runs an async loader whenever `deps` change. Aborts the previous request, so a slow old response
// can never overwrite newer data. Returns { data, error, loading, reload }; the last data stays while the
// next one loads. `deps` must be plain values (strings, numbers, booleans).
export default function useAsync(loader, deps) {
  const [tick, setTick] = useState(0)
  const key = JSON.stringify([...deps, tick])
  const [state, setState] = useState({ key: null, data: null, error: null })
  const loaderRef = useRef(loader)
  useEffect(() => { loaderRef.current = loader })

  useEffect(() => {
    const ctrl = new AbortController()
    loaderRef.current({ signal: ctrl.signal })
      .then((data) => { if (!ctrl.signal.aborted) setState({ key, data, error: null }) })
      .catch((error) => { if (error?.name !== 'AbortError') setState((s) => ({ key, data: s.data, error })) })
    return () => ctrl.abort()
  }, [key])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  const current = state.key === key
  return { data: state.data, error: current ? state.error : null, loading: !current, reload }
}
