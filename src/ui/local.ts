import { useEffect, useState } from 'react'

/** Per-browser UI convenience (current tab, filters). Falls back to in-memory when storage is blocked. */
export function useLocal<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`art-critic:${key}`)
      return raw === null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(`art-critic:${key}`, JSON.stringify(value))
    } catch {
      // storage unavailable; keep the in-memory value
    }
  }, [key, value])
  return [value, setValue]
}
