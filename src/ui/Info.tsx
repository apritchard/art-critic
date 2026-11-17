import type { ReactNode } from 'react'
import { useLocal } from './local'

/**
 * A heading with an ⓘ button that shows or hides the explanation under it. Closed by default, and remembered per
 * `id`, so the page stays a table you read once you know what it says.
 */
export function Info({ id, heading, children }: { id: string; heading: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useLocal(`info:${id}`, false)
  return (
    <>
      <div className="info-head">
        {heading}
        <button
          className={`info-toggle${open ? ' on' : ''}`}
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          title={open ? 'Hide the explanation' : 'How this works'}
        >
          ⓘ
        </button>
      </div>
      {open && <div className="hint info-text">{children}</div>}
    </>
  )
}
