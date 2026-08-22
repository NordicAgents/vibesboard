import { useCallback, useRef, useSyncExternalStore } from 'react'

/**
 * Event dispatched on `window` whenever this hook writes a value. The native
 * `storage` event only fires in *other* tabs, so without this two components
 * reading the same key in one tab would drift apart until a remount.
 */
const LOCAL_WRITE_EVENT = 'vibesboard:local-storage'

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener('storage', onStoreChange)
  window.addEventListener(LOCAL_WRITE_EVENT, onStoreChange)
  return () => {
    window.removeEventListener('storage', onStoreChange)
    window.removeEventListener(LOCAL_WRITE_EVENT, onStoreChange)
  }
}

/**
 * Reads and writes a JSON value in localStorage, kept in sync across every
 * component that uses the same key and across browser tabs.
 *
 * Implemented with `useSyncExternalStore` rather than the usual
 * `useState` + `useEffect` pair. Seeding state in an effect would render once
 * with `initialValue`, then immediately re-render with the stored value —
 * a visible flash of the wrong sidebar/view state on every mount, and the
 * cascading render that `react-hooks/set-state-in-effect` warns about.
 * `getServerSnapshot` keeps server rendering and hydration on `initialValue`,
 * so there is no hydration mismatch.
 */
export const useLocalStorage = <T>(
  key: string,
  initialValue: T
): [T, (value: T) => void] => {
  // `getSnapshot` must return a referentially stable value for unchanged
  // storage, or React re-renders forever. Parsed results are therefore cached
  // against the raw string that produced them.
  const cache = useRef<{ raw: string | null; parsed: T } | null>(null)

  // Pinned on first render: callers routinely pass an inline object/array
  // literal, which would otherwise be a new reference every render and defeat
  // the cache above.
  const fallback = useRef(initialValue)

  const getSnapshot = useCallback((): T => {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback.current

    const cached = cache.current
    if (cached && cached.raw === raw) return cached.parsed

    let parsed: T
    try {
      parsed = JSON.parse(raw) as T
    } catch {
      // Corrupt or non-JSON entry (e.g. written by an older build). Fall back
      // rather than throwing during render.
      parsed = fallback.current
    }
    cache.current = { raw, parsed }
    return parsed
  }, [key])

  const getServerSnapshot = useCallback((): T => fallback.current, [])

  const storedValue = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  )

  const setValue = useCallback(
    (value: T) => {
      window.localStorage.setItem(key, JSON.stringify(value))
      window.dispatchEvent(new Event(LOCAL_WRITE_EVENT))
    },
    [key]
  )

  return [storedValue, setValue]
}
