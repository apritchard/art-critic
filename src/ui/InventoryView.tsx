import { useMemo } from 'react'
import type { Evaluation, EvaluationResult } from '../engine/evaluate'
import { HIGH_PRIORITY_GAIN, inventoryOrder, levelPriority, PRIORITY_STEPS, type LevelPriority } from '../engine/inventory'
import type { Piece } from '../engine/load'
import { characterName, formatStat, isPercent, SLOT_LABEL, setName, statLabel, statShort } from '../engine/stats'
import type { GoodSubstat } from '../engine/types'
import { useStore } from '../state/store'
import { SLOT_ICON, weightClass } from './ArtifactCard'
import { useLocal } from './local'

/** The game's inventory shows 8 pieces per row on PC. */
const DEFAULT_COLS = 8
const MIN_COLS = 3
const MAX_COLS = 16

/** Level up queue marks are kept apart from lock marks on the same piece (see doneKey in ListView). */
const levelKey = (id: string) => `lvl:${id}`

/** "CD 7.8" or "HP 299": short enough for a grid cell. */
const shortSub = (s: GoodSubstat) => `${statShort(s.key)} ${isPercent(s.key) ? s.value.toFixed(1) : Math.round(s.value)}`

/**
 * One set's pieces in the order the game's inventory shows them (filter by set, and Not Equipped unless equipped
 * pieces are included), each marked with its lock change and whether it's worth leveling, so they can be worked
 * through in-game in one pass.
 */
export function InventoryView({ result }: { result: EvaluationResult }) {
  const { done, toggleDone } = useStore()
  const [setPick, setSet] = useLocal<string>('inventory:set', '')
  const [colsPick, setCols] = useLocal<number>('inventory:cols', DEFAULT_COLS)
  const [withEquipped, setWithEquipped] = useLocal('inventory:equipped', false)
  const [reopened, setReopened] = useLocal('inventory:reopened', false)
  const [showSubs, setShowSubs] = useLocal('inventory:subs', true)
  const cols = Math.min(MAX_COLS, Math.max(MIN_COLS, Math.round(Number(colsPick) || DEFAULT_COLS)))

  const shown = useMemo(
    () => result.evaluations.filter((e) => e.piece.rarity === 5 && (withEquipped || !e.piece.owner)),
    [result.evaluations, withEquipped],
  )
  const pending = (e: Evaluation) => e.action !== null && !done.has(e.piece.id)
  const anyStar = result.activeBuilds.some((r) => r.priority === 'priority')
  const priorities = useMemo(
    () => new Map(shown.map((e) => [e.piece.id, levelPriority(e, anyStar)] as const)),
    [shown, anyStar],
  )
  const highToLevel = (e: Evaluation) => !!priorities.get(e.piece.id)?.high && !done.has(levelKey(e.piece.id))

  // Sets with lock changes still to make first, then by name.
  const sets = useMemo(() => {
    const m = new Map<string, { lock: number; unlock: number; high: number; total: number }>()
    for (const e of shown) {
      const c = m.get(e.piece.setKey) ?? { lock: 0, unlock: 0, high: 0, total: 0 }
      c.total++
      if (pending(e)) c[e.action!]++
      if (highToLevel(e)) c.high++
      m.set(e.piece.setKey, c)
    }
    return [...m].sort((a, b) => b[1].lock + b[1].unlock - (a[1].lock + a[1].unlock) || setName(a[0]).localeCompare(setName(b[0])))
  }, [shown, done, priorities])
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
  const toLevel = ordered.filter((e) => priorities.get(e.piece.id) && !done.has(levelKey(e.piece.id)))
  const high = toLevel.filter(highToLevel)
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
              {c.high > 0 && (
                <span className="c-heat" title="High priority to level">
                  ⬆{c.high}
                </span>
              )}
              {c.lock + c.unlock + c.high === 0 && <span className="muted">{c.total}</span>}
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
          <label className="check" title="Each piece's substats, colored by how much the build it's judged for weighs them">
            <input type="checkbox" checked={showSubs} onChange={(e) => setShowSubs(e.target.checked)} /> Substats
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
              {left.length < toLock.length + toUnlock.length && ` · ${toLock.length + toUnlock.length - left.length} done`} ·{' '}
              <span className="c-heat">
                ⬆ level {toLevel.length}
                {high.length > 0 && `, ${high.length} high priority`}
              </span>
              . Click a piece once you&apos;ve changed its lock.{' '}
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
            <div
              className={`inv-grid${showSubs ? ' with-subs' : ''}`}
              style={{ gridTemplateColumns: `2.5em repeat(${cols}, var(--inv-cell))` }}
            >
              {rows.map((row, r) => (
                <Row key={r} n={r + 1} row={row} done={done} toggle={toggleDone} priorities={priorities} showSubs={showSubs} />
              ))}
            </div>
            <p className="sub-note inv-key">
              <span className="inv-up t0">⬆+4</span> worth leveling (the Level up queue), to the stop shown. Hotter means a
              bigger expected gain once finished{anyStar ? ' for a ★ Priority character' : ''}, in rolls, the same scale in
              every set:{' '}
              {PRIORITY_STEPS.map((s, i) => (
                <span key={s} className={`inv-up t${i + 1}`}>
                  {s}
                  {i === PRIORITY_STEPS.length - 1 ? '+' : ''}
                </span>
              ))}
              . From {HIGH_PRIORITY_GAIN} it counts as high priority. Re-export after leveling; mark it leveled on the Level up
              tab.
            </p>
            <p className="sub-note">
              The order is level, then flower → circlet, then locked first, then pieces that started with 4 lines,
              then newest first. The export only has 5★ pieces, so 4★ pieces of this set in your inventory will shift
              the grid.
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
  priorities,
  showSubs,
}: {
  n: number
  row: Evaluation[]
  done: Set<string>
  toggle: (id: string) => void
  priorities: Map<string, LevelPriority | null>
  showSubs: boolean
}) {
  return (
    <>
      <span className="inv-row">{n}</span>
      {row.map((e) => (
        <Cell
          key={e.piece.id}
          e={e}
          isDone={done.has(e.piece.id)}
          toggle={toggle}
          level={priorities.get(e.piece.id) ?? null}
          leveled={done.has(levelKey(e.piece.id))}
          showSubs={showSubs}
        />
      ))}
    </>
  )
}

function Cell({
  e,
  isDone,
  toggle,
  level,
  leveled,
  showSubs,
}: {
  e: Evaluation
  isDone: boolean
  toggle: (id: string) => void
  level: LevelPriority | null
  leveled: boolean
  showSubs: boolean
}) {
  const p = e.piece
  const weights = e.best?.ref.build.substats ?? {}
  const subs = [...p.substats.map((s) => formatStat(s.key, s.value)), ...(p.unactivatedSubstats ?? []).map((s) => `${formatStat(s.key, s.value)} (unactivated)`)]
  const levelLine =
    level &&
    `${leveled ? 'Marked leveled. ' : ''}Level to +${level.next}${level.high ? ' (high priority)' : ''}: +${level.gain.toFixed(2)} rolls expected for ${characterName(level.char)}${level.star ? ' ★' : ''}, ${Math.round(level.chance * 100)}% to beat what they wear`
  const title = [
    `${setName(p.setKey)} ${SLOT_LABEL[p.slotKey].toLowerCase()} · ${statLabel(p.mainStatKey)} · +${p.level}${p.lock ? ' · locked' : ''}`,
    ...subs,
    p.owner ? `Equipped on ${characterName(p.owner)}` : '',
    e.reason,
    levelLine,
  ]
    .filter(Boolean)
    .join('\n')
  const cls = ['inv-cell', e.action ? `act-${e.action}` : 'idle', isDone ? 'done' : '', level && !leveled ? `t${level.tier}` : '']
    .filter(Boolean)
    .join(' ')
  return (
    <button className={cls} title={title} onClick={() => e.action && toggle(p.id)} disabled={!e.action}>
      {p.lock && <span className="inv-lock">🔒</span>}
      {level && (
        <span className={`inv-up t${level.tier}${leveled ? ' leveled' : ''}`}>
          {leveled ? '✓' : '⬆'}+{level.next}
        </span>
      )}
      <span className="inv-icon">{SLOT_ICON[p.slotKey]}</span>
      <span className="inv-main">{statShort(p.mainStatKey)}</span>
      <span className="inv-level">
        +{p.level}
        {p.owner && <span className="inv-owner"> · {characterName(p.owner).slice(0, 3)}</span>}
      </span>
      {showSubs && (
        <span className="inv-subs">
          {p.substats.map((s) => (
            <span key={s.key} className={`inv-sub ${weightClass(weights[s.key] ?? 0)}`}>
              {shortSub(s)}
            </span>
          ))}
          {(p.unactivatedSubstats ?? []).map((s) => (
            <span key={s.key} className={`inv-sub hidden-line ${weightClass(weights[s.key] ?? 0)}`}>
              {shortSub(s)}
            </span>
          ))}
        </span>
      )}
      {e.action &&<span className="inv-act">{isDone ? '✓ done' : e.action === 'lock' ? 'LOCK' : 'UNLOCK'}</span>}
    </button>
  )
}
