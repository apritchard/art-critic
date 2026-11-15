import { useRef, useState } from 'react'

/**
 * Opens a file picker so an export can come from anywhere on this machine (Downloads, Irminsul's folder, …).
 * `onFile` copies the chosen file into imports/ and loads it.
 */
export function LoadExportButton({ onFile }: { onFile: (file: File) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const load = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      await onFile(file)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      // Cleared so choosing the same file again still fires a change.
      if (input.current) input.current.value = ''
    }
  }

  return (
    <>
      <button
        className="ghost"
        disabled={busy}
        onClick={() => input.current?.click()}
        title="Choose an Irminsul export anywhere on this PC. It's copied into imports/ and loaded."
      >
        {busy ? 'Loading…' : 'Load export…'}
      </button>
      <input ref={input} type="file" accept=".json,application/json" hidden onChange={(e) => load(e.target.files?.[0])} />
    </>
  )
}
