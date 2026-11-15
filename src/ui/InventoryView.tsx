import { useMemo } from 'react'
import type { Evaluation, EvaluationResult } from '../engine/evaluate'
import { inventoryOrder } from '../engine/inventory'
import type { Piece } from '../engine/load'
import { characterName, formatStat, SLOT_LABEL, setName, statLabel, statShort } from '../engine/stats'
import { useStore } from '../state/store'
import { SLOT_ICON } from './ArtifactCard'
import { useLocal } from './local'

/** The game's inventory shows 8 pieces per row on PC. */
const DEFAULT_COLS = 8
const MIN_COLS = 3
const MAX_COLS = 16

/**
 * One set's pieces in the order the game's inventory shows them (filter by set, and Not Equipped unless equipped
 * pieces are included), each marked with its lock change, so they can be worked through in-game in one pass.
 */
export function InventoryView({ result }: { result: EvaluationResult }) {
  const { done, toggleDone } = useStore()
  const [setPick, setSet] = useLocal<string>('inventory:set', '')
  const [colsPick, setCols] = useLocal<number>('inventory:cols', DEFAULT_COLS)
  const [withEquipped, setWithEquipped] = useLocal('inventory:equipped', false)
  const [reopened, setReopened] = useLocal('inventory:reopened', false)
  const cols = Math.min(MAX_COLS, Math.max(MIN_COLS, Math.round(Number(colsPick) || DEFAULT_COLS)))

  const shown = useMemo(
    () => result.evaluations.filter((e) => e.piece.rarity === 5 && (withEquipped || !e.piece.owner)),
    [result.evaluations, withEquipped],
  )
  const pending = (e: Evaluation) => e.action !== null && !done.has(e.piece.id)

  // Sets with lock changes still to make first, then by name.
  const sets = useMemo(() => {
    const m = new Map<string, { lock: number; unlock: number; total: number }>()
    for (const e of shown) {
      const c = m.get(e.piece.setKey) ?? { lock: 0, unlock: 0, total: 0 }
      c.total++
      if (pending(e)) c[e.action!]++
      m.set(e.piece.setKey, c)
    }
    return [...m].sort((a, b) => b[1].lock + b[1].unlock - (a[1].lock + a[1].unlock) || setName(a[0]).localeCompare(setName(b[0])))
  }, [shown, done])
  const set = sets.some(([k]) => k === setPick) ? setPick : (sets[0]?.[0] ?? '')

  // The export's lock states, unless asked to follow the done marks: the game re-sorts only when reopened.
  const ordered = useMemo(() => {
    const evals = shown.filter((e) => e.piece.setKey === set)
    const byId = new Map(evals.map((e) => [e.piece.id, e]))
    const locked = (p: Piece) => {
      const e = byId.get(p.id)!
      return reopened && e.action && done.has(p.id) ? e.action === 'lock' : p.lock
    }
    return evals.sort((a, b) => inventoryOrder(a.piece, b.piece, locked))
    // Done marks only reorder the grid when following them, so ticking pieces off doesn't shuffle it.
  }, [shown, set, reopened, reopened ? done : null])

  const toLock = ordered.filter((e) => e.action === 'lock')
  const toUnlock = ordered.filter((e) => e.action === 'unlock')
  const left = ordered.filter(pending)
  const markAll = (value: boolean) => {
    for (const e of ordered) if (e.action) toggleDone(e.piece.id, value)
  }

  const rows: Evaluation[][] = []
  for (let i = 0; i < ordered.length; i += cols) rows.push(ordered.slice(i, i + cols))

  return (
    <div className="listview">
      <aside className="rail">
        {sets.map(([key, c]) => (
          <button key={key} className={key === set ? 'rail-item active' : 'rail-item'} onClick={() => setSet(key)}>
            <span className="rail-name">{setName(key)}</span>
            <span className="counts">
              {c.lock > 0 && <span className="c-lock">▲{c.lock}</span>}
              {c.unlock > 0 && <span className="c-unlock">▼{c.unlock}</span>}
              {c.lock + c.unlock === 0 && <span className="muted">{c.total}</span>}
            </span>
          </button>
        ))}
      </aside>

      <section className="inventory-pane">
        <div className="filters">
          <select className="rail-select" value={set} onChange={(e) => setSet(e.target.value)}>
            {sets.map(([key, c]) => (
              <option key={key} value={key}>
                {setName(key)} ({c.lock + c.unlock})
              </option>
            ))}
          </select>
          <label className="check" title="Pieces per row in your game's inventory: 8 on PC">
            Per row
            <input
              type="number"
              className="cols-input"
              min={MIN_COLS}
              max={MAX_COLS}
              // What's typed, so typing "12" doesn't get clamped at "1"; the grid uses the clamped value.
              value={colsPick || ''}
              onChange={(e) => setCols(Number(e.target.value) || 0)}
            />
          </label>
          <label className="check" title="Match the game's Equipped filter: off for Not Equipped">
            <input type="checkbox" checked={withEquipped} onChange={(e) => setWithEquipped(e.target.checked)} /> Include
            equipped
          </label>
          <label
            className="check"
            title="The game puts locked pieces first, but only re-sorts when the inventory is opened again. Tick this after reopening it to order by the lock states your done marks say."
          >
            <input type="checkbox" checked={reopened} onChange={(e) => setReopened(e.target.checked)} /> Reopened since
            marking
          </label>
        </div>

        {set ? (
          <>
            <p className="hint">
              In-game: Filter → Set → <b>{setName(set)}</b>
              {withEquipped ? '' : ', Not Equipped'}, with "order obtained" off. {ordered.length} pieces:{' '}
              <span className="c-lock">▲ lock {toLock.length}</span> · <span className="c-unlock">▼ unlock {toUnlock.length}</span>
              {left.length < toLock.length + toUnlock.length && ` · ${toLock.length + toUnlock.length - left.length} done`}. Click a
              piece once you&apos;ve changed it.{' '}
              {left.length > 0 ? (
                <button className="link" onClick={() => markAll(true)}>
                  Mark all done
                </button>
              ) : (
                toLock.length + toUnlock.length > 0 && (
                  <button className="link" onClick={() => markAll(false)}>
                    Clear done marks
                  </button>
                )
              )}
            </p>
            <div className="inv-grid" style={{ gridTemplateColumns: `2.5em repeat(${cols}, var(--inv-cell))` }}>
              {rows.map((row, r) => (
                <Row key={r} n={r + 1} row={row} done={done} toggle={toggleDone} />
              ))}
            </div>
            <p className="sub-note">
              The order is level, then flower → circlet, then locked first, then 4-line before 3-line, then newest
              first. The export only has 5★ pieces, so 4★ pieces of this set in your inventory will shift the grid.
            </p>
          </>
        ) : (
          <div className="empty">No artifacts.</div>
        )}
      </section>
    </div>
  )
}

function Row({
  n,
  row,
  done,
  toggle,
}: {
  n: number
  row: Evaluation[]
  done: Set<string>
  toggle: (id: string) => void
}) {
  return (
    <>
      <span className="inv-row">{n}</span>
      {row.map((e) => (
        <Cell key={e.piece.id} e={e} isDone={done.has(e.piece.id)} toggle={toggle} />
      ))}
    </>
  )
}

function Cell({ e, isDone, toggle }: { e: Evaluation; isDone: boolean; toggle: (id: string) => void }) {
  const p = e.piece
  const subs = [...p.substats.map((s) => formatStat(s.key, s.value)), ...(p.unactivatedSubstats ?? []).map((s) => `${formatStat(s.key, s.value)} (unactivated)`)]
  const title = [
    `${setName(p.setKey)} ${SLOT_LABEL[p.slotKey].toLowerCase()} · ${statLabel(p.mainStatKey)} · +${p.level}${p.lock ? ' · locked' : ''}`,
    ...subs,
    p.owner ? `Equipped on ${characterName(p.owner)}` : '',
    e.reason,
  ]
    .filter(Boolean)
    .join('\n')
  const cls = ['inv-cell', e.action ? `act-${e.action}` : '', isDone ? 'done' : ''].filter(Boolean).join(' ')
  return (
    <button className={cls} title={title} onClick={() => e.action && toggle(p.id)} disabled={!e.action}>
      {p.lock && <span className="inv-lock">🔒</span>}
      {p.owner && <span className="inv-owner">{characterName(p.owner).slice(0, 3)}</span>}
      <span className="inv-icon">{SLOT_ICON[p.slotKey]}</span>
      <span className="inv-main">{statShort(p.mainStatKey)}</span>
      <span className="inv-level">+{p.level}</span>
      {e.action && <span className="inv-act">{isDone ? '✓ done' : e.action === 'lock' ? 'LOCK' : 'UNLOCK'}</span>}
    </button>
  )
}
