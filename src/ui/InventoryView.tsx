import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { Evaluation, EvaluationResult } from '../engine/evaluate'
import {
  HIGH_PRIORITY_GAIN,
  inventoryOrder,
  levelPriority,
  PRIORITY_STEPS,
  type LevelPriority,
  type RerollPriority,
} from '../engine/inventory'
import type { Piece } from '../engine/load'
import { characterName, formatStat, isPercent, SLOT_LABEL, setName, statLabel, statShort } from '../engine/stats'
import type { GoodSubstat } from '../engine/types'
import { useStore } from '../state/store'
import { SLOT_ICON, weightClass } from './ArtifactCard'
import { levelKey } from './ListView'
import { useLocal } from './local'
import { marks } from './marks'
import { GUARANTEE, useGuarantee } from './RerollPage'

/** The game's inventory shows 8 pieces per row on PC. */
const DEFAULT_COLS = 8
const MIN_COLS = 3
const MAX_COLS = 16

/** Spend → Dust's "Rerolled it" marks. */
export const rerollKey = (id: string) => `reroll:${id}`

/** The suffix of an ordinal: 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
export const ordinal = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'))

/** "CD 7.8" or "HP 299": short enough for a grid cell. */
const shortSub = (s: GoodSubstat) => `${statShort(s.key)} ${isPercent(s.key) ? s.value.toFixed(1) : Math.round(s.value)}`

/** "Level to +4: +0.85 rolls expected for Xingqiu ★, 34% to beat the best they have". */
export const levelLine = (level: LevelPriority) =>
  `Level to +${level.next}${level.high ? ' (high priority)' : ''}: +${level.gain.toFixed(2)} rolls expected for ${characterName(level.char)}${marks({ priority: level.star ? 'priority' : 'normal', building: level.building })}, ${Math.round(level.chance * 100)}% to beat the best they have`

/** "Reroll: +1.03 rolls expected for Xingqiu ★, 100% to come out better. Pick CR + ATK%; 1 Dust". */
export const rerollLine = (reroll: RerollPriority) =>
  `Reroll${reroll.high ? ' (high priority)' : ''}: +${reroll.gain.toFixed(2)} rolls expected for ${characterName(reroll.char)}${marks({ priority: reroll.star ? 'priority' : 'normal', building: reroll.building })}, ${Math.round(reroll.chance * 100)}% to ${reroll.bar === null ? 'come out better' : `beat the ${reroll.bar.toFixed(1)} they wear`}. Pick ${reroll.chosen.map(statShort).join(' + ')}; ${reroll.cost} Dust`

interface Props {
  result: EvaluationResult
  /** The set picked in the rail, shared with the list; the first set when it isn't one of the grid's. */
  set: string
  onSet: (set: string) => void
  /** The piece open in the inspector, outlined; arrow keys move it. */
  selected: string | null
  onSelect: (id: string | null) => void
  /** A link followed to a piece: open its set (with equipped pieces if it's worn) and scroll to it once. */
  jump?: { piece: string; key: string }
  /** +20s worth a reroll, as Spend → Dust judges them (rerollPriority). */
  rerolls: Map<string, RerollPriority>
  /** Controls the page puts first in the filter bar (the view switch). */
  toolbar: ReactNode
}

/**
 * One set's pieces in the order the game's inventory shows them (filter by set, and Not Equipped unless equipped
 * pieces are included), each marked with its lock change and whether it's worth leveling or rerolling, so they can
 * be worked through in-game in one pass. Clicking a piece opens it in the inspector; its lock bar marks it done.
 */
export function InventoryView({ result, set: setPick, onSet, selected, onSelect, jump, rerolls, toolbar }: Props) {
  const { done, toggleDone } = useStore()
  const [guarantee] = useGuarantee()
  const [colsPick, setCols] = useLocal<number>('inventory:cols', DEFAULT_COLS)
  const [withEquipped, setWithEquipped] = useLocal('inventory:equipped', false)
  const [reopened, setReopened] = useLocal('inventory:reopened', false)
  const [showSubs, setShowSubs] = useLocal('inventory:subs', true)
  const cols = Math.min(MAX_COLS, Math.max(MIN_COLS, Math.round(Number(colsPick) || DEFAULT_COLS)))

  // A link to one piece: show equipped pieces if it's worn, scroll to it once, and pulse its outline.
  const jumpEv = useMemo(
    () => (jump ? result.evaluations.find((e) => e.piece.id === jump.piece) : undefined),
    [jump, result.evaluations],
  )
  useEffect(() => {
    if (jumpEv?.piece.owner) setWithEquipped(true)
  }, [jump?.key])
  const scrolledFor = useRef<string | null>(null)
  useEffect(() => {
    if (!jump || scrolledFor.current === jump.key) return
    const cell = document.querySelector('.inv-slot.inv-followed')
    if (!cell) return
    scrolledFor.current = jump.key
    cell.scrollIntoView({ block: 'center', inline: 'center' })
  })

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
  const toRerollNow = (e: Evaluation) => rerolls.has(e.piece.id) && !done.has(rerollKey(e.piece.id))
  const highToReroll = (e: Evaluation) => toRerollNow(e) && !!rerolls.get(e.piece.id)?.high

  // Sets with lock changes still to make first, then by name. Rerolls are scarcer than pieces to level, so the rail
  // counts every one worth a look (tier 1 up), not only high priority as for leveling.
  const sets = useMemo(() => {
    const m = new Map<string, { lock: number; unlock: number; high: number; reroll: number; rerollHigh: number; total: number }>()
    for (const e of shown) {
      const c = m.get(e.piece.setKey) ?? { lock: 0, unlock: 0, high: 0, reroll: 0, rerollHigh: 0, total: 0 }
      c.total++
      if (pending(e)) c[e.action!]++
      if (highToLevel(e)) c.high++
      if (toRerollNow(e) && rerolls.get(e.piece.id)!.tier > 0) c.reroll++
      if (highToReroll(e)) c.rerollHigh++
      m.set(e.piece.setKey, c)
    }
    return [...m].sort((a, b) => b[1].lock + b[1].unlock - (a[1].lock + a[1].unlock) || setName(a[0]).localeCompare(setName(b[0])))
  }, [shown, done, priorities, rerolls])
  const set = sets.some(([k]) => k === setPick) ? setPick : (sets[0]?.[0] ?? '')
  // Pin the set shown when falling back to the first: the rail re-sorts as pieces are marked done, and the grid
  // shouldn't jump to another set under you.
  useEffect(() => {
    if (set && set !== setPick) onSet(set)
  }, [set, setPick])

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
  const toReroll = ordered.filter(toRerollNow)
  const highReroll = toReroll.filter(highToReroll)
  // Worn ones are left out while equipped pieces are hidden: say how many there are.
  const hiddenRerolls = withEquipped
    ? 0
    : result.evaluations.filter((e) => e.piece.setKey === set && e.piece.owner && toRerollNow(e)).length
  const markAll = (value: boolean) => {
    for (const e of ordered) if (e.action) toggleDone(e.piece.id, value)
  }

  // Keyboard: arrows move the selection across the grid, Space marks its lock change done and moves to the next
  // piece with one still to make, L and R mark it leveled or rerolled, Escape closes the inspector.
  const at = selected ? ordered.findIndex((e) => e.piece.id === selected) : -1
  const moved = useRef(false)
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement
      if (t.closest('input, select, textarea, .inspector') || ev.ctrlKey || ev.metaKey || ev.altKey) return
      if (!ordered.length) return
      const k = ev.key.toLowerCase()
      const go = (i: number) => {
        moved.current = true
        onSelect(ordered[Math.max(0, Math.min(ordered.length - 1, i))].piece.id)
      }
      const e = at >= 0 ? ordered[at] : null
      if (k === 'arrowright') go(at + 1)
      else if (k === 'arrowleft') go(at < 0 ? 0 : at - 1)
      else if (k === 'arrowdown') go(at < 0 ? 0 : at + cols)
      else if (k === 'arrowup') go(at < 0 ? 0 : at - cols)
      else if (k === ' ') {
        if (!e) {
          const first = ordered.findIndex(pending)
          if (first >= 0) go(first)
        } else if (e.action) {
          const wasDone = done.has(e.piece.id)
          toggleDone(e.piece.id, !wasDone)
          if (!wasDone) {
            const next = ordered.findIndex((x, j) => j > at && pending(x))
            if (next >= 0) go(next)
          }
        }
      } else if (k === 'l' && e && priorities.get(e.piece.id)) toggleDone(levelKey(e.piece.id))
      else if (k === 'r' && e && rerolls.has(e.piece.id)) toggleDone(rerollKey(e.piece.id))
      else if (k === 'escape' && selected) onSelect(null)
      else return
      ev.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    document.querySelector('.inv-slot.inv-selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selected])

  const rows: Evaluation[][] = []
  for (let i = 0; i < ordered.length; i += cols) rows.push(ordered.slice(i, i + cols))
  const spot = jump?.piece
  const spotAt = spot ? ordered.findIndex((e) => e.piece.id === spot) : -1

  return (
    <div className="listview">
      <aside className="rail">
        {sets.map(([key, c]) => (
          <button key={key} className={key === set ? 'rail-item active' : 'rail-item'} onClick={() => onSet(key)}>
            <span className="rail-name">{setName(key)}</span>
            <span className="counts">
              {c.lock > 0 && <span className="c-lock">▲{c.lock}</span>}
              {c.unlock > 0 && <span className="c-unlock">▼{c.unlock}</span>}
              {c.high > 0 && (
                <span className="c-heat" title="High priority to level">
                  ⬆{c.high}
                </span>
              )}
              {c.reroll > 0 && (
                <span
                  className={c.rerollHigh > 0 ? 'c-heat' : 'c-heat-1'}
                  title={`Worth rerolling: ${c.reroll}${c.rerollHigh > 0 ? `, ${c.rerollHigh} high priority` : ''}`}
                >
                  ⟳{c.reroll}
                </span>
              )}
              {c.lock + c.unlock + c.high + c.reroll === 0 && <span className="muted">{c.total}</span>}
            </span>
          </button>
        ))}
      </aside>

      <section className="inventory-pane">
        <div className="filters">
          {toolbar}
          <select className="rail-select" value={set} onChange={(e) => onSet(e.target.value)}>
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
              {toReroll.length > 0 && (
                <>
                  {' · '}
                  <span className="c-heat">
                    ⟳ reroll {toReroll.length}
                    {highReroll.length > 0 && `, ${highReroll.length} high priority`}
                  </span>
                </>
              )}
              {hiddenRerolls > 0 && (
                <>
                  {' · '}
                  <button className="link" onClick={() => setWithEquipped(true)} title="Include equipped pieces">
                    ⟳ {hiddenRerolls} equipped worth rerolling
                  </button>
                </>
              )}
              .{' '}
              {spotAt >= 0 && (
                <b className="inv-spot-note">
                  Outlined: the piece you followed, row {Math.floor(spotAt / cols) + 1}, {(spotAt % cols) + 1}
                  {ordinal((spotAt % cols) + 1)} from the left.{' '}
                </b>
              )}
              {spot && !jumpEv && <b className="inv-spot-note">The piece you followed isn&apos;t in this export. </b>}
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
            <p className="keys inv-keys">
              Click a piece to inspect it · its <b>LOCK</b>/<b>UNLOCK</b> bar marks it done · <kbd>←</kbd>
              <kbd>→</kbd>
              <kbd>↑</kbd>
              <kbd>↓</kbd> move · <kbd>Space</kbd> done &amp; next · <kbd>L</kbd> leveled · <kbd>R</kbd> rerolled ·{' '}
              <kbd>Esc</kbd> close
            </p>
            <div
              className={`inv-grid${showSubs ? ' with-subs' : ''}`}
              style={{ gridTemplateColumns: `2.5em repeat(${cols}, var(--inv-cell))` }}
            >
              {rows.map((row, r) => (
                <Row
                  key={r}
                  n={r + 1}
                  row={row}
                  done={done}
                  toggle={toggleDone}
                  priorities={priorities}
                  rerolls={rerolls}
                  showSubs={showSubs}
                  spot={spot}
                  selected={selected}
                  onSelect={onSelect}
                />
              ))}
            </div>
            <p className="sub-note inv-key">
              <span className="inv-up t0">⬆+4</span> worth leveling (the Level up queue), to the stop shown. Hotter means a
              bigger expected gain once finished{anyStar ? ' for a 📌 Building or ★ Priority character' : ''}, in rolls, the
              same scale in every set:{' '}
              {PRIORITY_STEPS.map((s, i) => (
                <span key={s} className={`inv-up t${i + 1}`}>
                  {s}
                  {i === PRIORITY_STEPS.length - 1 ? '+' : ''}
                </span>
              ))}
              . From {HIGH_PRIORITY_GAIN} it counts as high priority. Re-export after leveling; mark it leveled with{' '}
              <kbd>L</kbd> or in the inspector.
            </p>
            <p className="sub-note inv-key">
              <span className="inv-up t2">⟳</span> a +20 worth a Dust of Enlightenment reroll, with the {GUARANTEE[guarantee]}{' '}
              guarantee picked in Spend → Dust: a worn piece, or a spare that rerolled could beat what someone wears.
              It&apos;s shaded the same way by the expected gain from one reroll
              {anyStar ? ' for a 📌 Building or ★ Priority character' : ''}, from {PRIORITY_STEPS[0]}. A worn piece worth more
              moved to someone else gets none. Mark it rerolled with <kbd>R</kbd> or in the inspector.
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
  rerolls,
  showSubs,
  spot,
  selected,
  onSelect,
}: {
  n: number
  row: Evaluation[]
  done: Set<string>
  toggle: (id: string) => void
  priorities: Map<string, LevelPriority | null>
  rerolls: Map<string, RerollPriority>
  showSubs: boolean
  spot: string | undefined
  selected: string | null
  onSelect: (id: string) => void
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
          reroll={rerolls.get(e.piece.id) ?? null}
          rerolled={done.has(rerollKey(e.piece.id))}
          showSubs={showSubs}
          spot={e.piece.id === spot}
          selected={e.piece.id === selected}
          onSelect={onSelect}
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
  reroll,
  rerolled,
  showSubs,
  spot,
  selected,
  onSelect,
}: {
  e: Evaluation
  isDone: boolean
  toggle: (id: string) => void
  level: LevelPriority | null
  leveled: boolean
  /** A +20 worth rerolling. Never alongside `level`, which is only for pieces below +20. */
  reroll: RerollPriority | null
  rerolled: boolean
  showSubs: boolean
  /** The piece a link pointed at: its outline pulses. */
  spot: boolean
  /** Open in the inspector: outlined. */
  selected: boolean
  onSelect: (id: string) => void
}) {
  const p = e.piece
  const weights = e.best?.ref.build.substats ?? {}
  const subs = [...p.substats.map((s) => formatStat(s.key, s.value)), ...(p.unactivatedSubstats ?? []).map((s) => `${formatStat(s.key, s.value)} (unactivated)`)]
  const title = [
    `${setName(p.setKey)} ${SLOT_LABEL[p.slotKey].toLowerCase()} · ${statLabel(p.mainStatKey)} · +${p.level}${p.lock ? ' · locked' : ''}`,
    ...subs,
    p.owner ? `Equipped on ${characterName(p.owner)}` : '',
    e.reason,
    level && `${leveled ? 'Marked leveled. ' : ''}${levelLine(level)}`,
    reroll && `${rerolled ? 'Marked rerolled. ' : ''}${rerollLine(reroll)}`,
  ]
    .filter(Boolean)
    .join('\n')
  const heat = level && !leveled ? level.tier : reroll && !rerolled ? reroll.tier : null
  const act = e.action ? `act-${e.action}` : 'idle'
  const cls = ['inv-cell', act, isDone ? 'done' : '', heat !== null ? `t${heat}` : '', e.action ? 'has-act' : ''].filter(Boolean).join(' ')
  const slotCls = ['inv-slot', act, isDone ? 'done' : '', selected ? 'inv-selected' : '', spot ? 'inv-followed' : ''].filter(Boolean).join(' ')
  return (
    <div className={slotCls}>
      <button className={cls} title={title} onClick={() => onSelect(p.id)} aria-pressed={selected}>
        {p.lock && <span className="inv-lock">🔒</span>}
        {level && (
          <span className={`inv-up t${level.tier}${leveled ? ' leveled' : ''}`}>
            {leveled ? '✓' : '⬆'}+{level.next}
          </span>
        )}
        {reroll && <span className={`inv-up t${reroll.tier}${rerolled ? ' leveled' : ''}`}>{rerolled ? '✓⟳' : '⟳'}</span>}
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
      </button>
      {e.action && (
        <button
          className="inv-act"
          onClick={() => toggle(p.id)}
          title={isDone ? 'Marked done: click to undo' : `Click once you've ${e.action === 'lock' ? 'locked' : 'unlocked'} it in-game`}
        >
          {isDone ? '✓ done' : e.action === 'lock' ? 'LOCK' : 'UNLOCK'}
        </button>
      )}
    </div>
  )
}
