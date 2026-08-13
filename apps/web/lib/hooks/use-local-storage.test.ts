// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { useLocalStorage } from './use-local-storage'

afterEach(() => {
  window.localStorage.clear()
})

describe('useLocalStorage', () => {
  it('returns the initial value when the key is absent', () => {
    const { result } = renderHook(() => useLocalStorage('absent', 'fallback'))

    expect(result.current[0]).toBe('fallback')
  })

  it('reads an existing value on the very first render, with no second pass', () => {
    window.localStorage.setItem('view', JSON.stringify('advanced'))

    const { result } = renderHook(() => useLocalStorage('view', 'focus'))

    expect(result.current[0]).toBe('advanced')
  })

  it('persists writes to localStorage', () => {
    const { result } = renderHook(() => useLocalStorage('open', true))

    act(() => result.current[1](false))

    expect(result.current[0]).toBe(false)
    expect(window.localStorage.getItem('open')).toBe('false')
  })

  it('keeps two hooks on the same key in sync within one tab', () => {
    const a = renderHook(() => useLocalStorage('shared', 0))
    const b = renderHook(() => useLocalStorage('shared', 0))

    act(() => a.result.current[1](42))

    expect(a.result.current[0]).toBe(42)
    expect(b.result.current[0]).toBe(42)
  })

  it('picks up a write made by another tab', () => {
    const { result } = renderHook(() => useLocalStorage('cross-tab', 'a'))

    act(() => {
      window.localStorage.setItem('cross-tab', JSON.stringify('b'))
      window.dispatchEvent(new StorageEvent('storage', { key: 'cross-tab' }))
    })

    expect(result.current[0]).toBe('b')
  })

  it('falls back instead of throwing when the stored entry is not JSON', () => {
    window.localStorage.setItem('corrupt', '{not json')

    const { result } = renderHook(() => useLocalStorage('corrupt', 'safe'))

    expect(result.current[0]).toBe('safe')
  })

  it('returns a stable reference for object values across re-renders', () => {
    window.localStorage.setItem('obj', JSON.stringify({ a: 1 }))

    const { result, rerender } = renderHook(() =>
      useLocalStorage<{ a: number }>('obj', { a: 0 })
    )
    const first = result.current[0]
    rerender()

    // useSyncExternalStore re-renders forever if getSnapshot returns a fresh
    // object each call, so identity here is the contract, not an optimisation.
    expect(result.current[0]).toBe(first)
  })

  it('switches to the new key when the key prop changes', () => {
    window.localStorage.setItem('k1', JSON.stringify('one'))
    window.localStorage.setItem('k2', JSON.stringify('two'))

    const { result, rerender } = renderHook(
      ({ key }) => useLocalStorage(key, 'none'),
      { initialProps: { key: 'k1' } }
    )
    expect(result.current[0]).toBe('one')

    rerender({ key: 'k2' })

    expect(result.current[0]).toBe('two')
  })
})
