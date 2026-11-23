import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { standing, type Evaluation, type EvaluationResult } from '../engine/evaluate'
import { MAX_PRICE, type LevelingAdvice } from '../engine/fodder'
import { levelPriority, type LevelPriority } from '../engine/inventory'
import { characterName, SLOT_LABEL, setName, statLabel } from '../engine/stats'
import { SLOTS, type SlotKey } from '../engine/types'
import { useStore, type SortMode } from '../state/store'
import { ArtifactCard, isHeld, SLOT_ICON } from './ArtifactCard'
import { useLocal } from './local'
import type { LevelFilter, ShowFilter } from './routes'

const SORT_LABEL: Record<SortMode, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  level: 'Level',
  slot: 'Slot, then main stat',
  verdict: 'Verdict',
  chance: 'Upgrade chance',
  gain: 'Expected gain',
  value: 'Best value (gain per EXP)',
}

/** Sorts only the Level up queue offers. */
const LEVEL_ONLY: SortMode[] = ['gain', 'value']

export const SHOW_LABEL: Record<ShowFilter, { label: string; title: string }> = {
  changes: { label: 'Lock changes', title: 'LOCK to keep, UNLOCK to feed' },
  level: { label: 'To level', title: 'Worth leveling, plus equipped to finish' },
  all: { label: 'Everything', title: 'Every piece' },
}

export const LEVEL_LABEL: Record<LevelFilter, { label: string; title: string }> = {
  any: { label: 'Any', title: 'Any level' },
  fresh: { label: '+0', title: 'Still at +0' },
  started: { label: '+1–19', title: 'Partly leveled' },
  spare20: { label: '+20 spare', title: 'Unequipped +20s' },
}

const levelOk: Record<LevelFilter, (e: Evaluation) => boolean> = {
  any: () => true,
  fresh: (e) => e.piece.level === 0,
  started: (e) => e.piece.level > 0 && e.piece.level < 20,
  spare20: (e) => e.piece.level === 20 && !e.piece.owner,
}

/** In the Level up queue: worth leveling, locked or not, plus equipped pieces worth finishing. */
export const toLevel = (e: Evaluation) => e.piece.level < 20 && e.nextStop !== null

/** A piece's expected gain once finished from its leveling priority, 0 when it isn't worth leveling. */
const gainOf = (priorities: Map<string, LevelPriority | null>) => (e: Evaluation) => priorities.get(e.piece.id)?.gain ?? 0

/**
 * Best value first: equipped pieces to finish (their EXP is set aside first), then pieces worth their EXP now, then
 * held ones, each by gain per EXP.
 */
const valueOf =
  (priorities: Map<string, LevelPriority | null>) =>
  (e: Evaluation): [number, number] => {
    const p = priorities.get(e.piece.id)
    if (!p) return [-1, 0]
    if (!p.value) return [2, 0]
    return [p.value.worth ? 1 : 0, p.value.rate]
  }

const GRADE_ORDER = { keep: 0, equipped: 1, marginal: 2, toss: 3, skip: 4 }

/** Best chance this piece ends up beating what someone wears, over every build it passes for. */
export const topChance = (e: Evaluation) =>
  Math.max(0, ...e.candidates.filter((c) => c.gate !== 'fail').map((c) => c.chance))

/**
 * Who a piece is headed to, as lists rank it: the best `standing` among the builds it could beat what they wear for
 * (or is worn by), and that build's chance. -1 when it isn't headed anywhere.
 */
const headedTo = (e: Evaluation, anyStar: boolean) => {
  let top = { rank: -1, chance: 0 }
  for (const c of e.candidates) {
    if (c.gate === 'fail' || !(c.chance > 0 || c.ref.char === e.piece.owner)) continue
    const rank = standing(c.ref, anyStar)
    if (rank > top.rank || (rank === top.rank && c.chance > top.chance)) top = { rank, chance: c.chance }
  }
  return top
}

/**
 * `gainOf` is a piece's expected gain once finished, as the Inventory's ⬆ badge rates it (levelPriority), or 0 when
 * it isn't worth leveling.
 */
function sorter(
  mode: SortMode,
  gainOf: (e: Evaluation) => number,
  valueOf: (e: Evaluation) => [number, number],
): (a: Evaluation, b: Evaluation) => number {
  switch (mode) {
    case 'value':
      return (a, b) => {
        const va = valueOf(a)
        const vb = valueOf(b)
        return vb[0] - va[0] || vb[1] - va[1] || gainOf(b) - gainOf(a) || b.piece.idx - a.piece.idx
      }
    case 'gain':
      return (a, b) => gainOf(b) - gainOf(a) || topChance(b) - topChance(a) || b.piece.idx - a.piece.idx
    case 'chance':
      // Many pieces are sure upgrades (100%), so ties go to the bigger gain. Projected value comes last: it's
      // measured against different builds, so it doesn't compare well across pieces.
      return (a, b) =>
        topChance(b) - topChance(a) ||
        gainOf(b) - gainOf(a) ||
        (b.best?.expected ?? 0) - (a.best?.expected ?? 0) ||
        b.piece.idx - a.piece.idx
    case 'newest':
      return (a, b) => b.piece.idx - a.piece.idx
    case 'oldest':
      return (a, b) => a.piece.idx - b.piece.idx
    case 'level':
      return (a, b) => b.piece.level - a.piece.level || b.piece.idx - a.piece.idx
    case 'slot':
      return (a, b) =>
        SLOTS.indexOf(a.piece.slotKey) - SLOTS.indexOf(b.piece.slotKey) ||
        a.piece.mainStatKey.localeCompare(b.piece.mainStatKey) ||
        b.piece.idx - a.piece.idx
    case 'verdict':
      return (a, b) =>
        GRADE_ORDER[a.grade] - GRADE_ORDER[b.grade] ||
        (b.best?.expected ?? 0) - (a.best?.expected ?? 0) ||
        b.piece.idx - a.piece.idx
  }
}

/** Rail entry for pieces whose verdict rests on being someone's off-set piece, whatever their set. */
export const OFF_SET = '__offset'
const isOffSetPick = (e: Evaluation) => e.best?.setMatch.kind === 'off' && e.grade !== 'toss'

/** Done marks for leveling are kept apart from lock/unlock marks on the same piece. */
export const levelKey = (id: string) => `lvl:${id}`
export const doneKey = (leveling: boolean, e: Evaluation) => (leveling ? levelKey(e.piece.id) : e.piece.id)

/**
 * Pieces headed to a Building character first, then a ★ Priority one, then the rest. By expected gain, that's whose
 * the gain is (`rankOf`, as the Inventory badge picks it); by chance, anyone it could beat, ranked by that chance.
 */
function priorityThen(
  mode: SortMode,
  gainOf: (e: Evaluation) => number,
  valueOf: (e: Evaluation) => [number, number],
  rankOf: (e: Evaluation) => number,
  anyStar: boolean,
): (a: Evaluation, b: Evaluation) => number {
  const base = sorter(mode, gainOf, valueOf)
  if (mode === 'gain' || mode === 'value') return (a, b) => rankOf(b) - rankOf(a) || base(a, b)
  return (a, b) => {
    const pa = headedTo(a, anyStar)
    const pb = headedTo(b, anyStar)
    return pb.rank - pa.rank || (mode === 'chance' ? pb.chance - pa.chance : 0) || base(a, b)
  }
}

interface Props {
  result: EvaluationResult
  /** The set picked in the rail (shared with the grid), 'all', or OFF_SET. */
  set: string
  onSet: (set: string) => void
  show: ShowFilter
  onShow: (show: ShowFilter) => void
  level: LevelFilter
  onLevel: (level: LevelFilter) => void
  /** The piece open in the inspector, outlined. */
  inspected: string | null
  onInspect: (id: string) => void
  /** Which pieces in the To level queue are worth their EXP now (levelingAdvice). */
  advice: LevelingAdvice
  /** Controls the page puts first in the filter bar (the view switch). */
  toolbar: ReactNode
  /** The set brief, under the filter bar, for one set. */
  brief?: ReactNode
  /** While the brief's what-if is on: the real verdicts of the pieces it changes, by id. No done marks then. */
  was: Map<string, Evaluation> | null
}

/**
 * The Artifacts tab's list: one card per piece, filtered to lock changes, the Level up queue or everything, at any
 * level. The old Triage +0, In progress, +20 review and Level up tabs are its filter combinations.
 */
export function ListView({ result, set, onSet, show, onShow, level, onLevel, inspected, onInspect, advice, toolbar, brief, was }: Props) {
  const store = useStore()
  const { done } = store
  // No done marks while a what-if is on: they'd be for lock changes that aren't the real ones.
  const preview = was !== null
  const toggleDone = (id: string, value?: boolean) => {
    if (!preview) store.toggleDone(id, value)
  }
  const leveling = show === 'level'
  const [slot, setSlot] = useLocal<SlotKey | 'all'>('list:slot', 'all')
  const [main, setMain] = useLocal<string>('list:main', 'all')
  const [hideDone, setHideDone] = useLocal<boolean>('hideDone', false)
  // The level queue keeps its own sort (expected gain by default); the lock lists share one.
  const [levelSort, setLevelSort] = useLocal<SortMode>('level:sortBy', 'gain')
  const [priorityFirst, setPriorityFirst] = useLocal('level:priorityFirst', true)
  const sort = leveling ? levelSort : LEVEL_ONLY.includes(store.sort) ? 'newest' : store.sort
  const setSort = leveling ? setLevelSort : store.setSort
  const [focus, setFocus] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)
  const undo = useRef<string[]>([])

  const keyOf = (e: Evaluation) => doneKey(leveling, e)
  const isDone = (e: Evaluation) => done.has(keyOf(e))
  // Every piece in the level queue is work to do; elsewhere only lock-state changes are.
  const needsWork = (e: Evaluation) => leveling || e.action !== null

  const inScope = useMemo(
    () => result.evaluations.filter((e) => levelOk[level](e) && (!leveling || toLevel(e))),
    [result, level, leveling],
  )

  // What each piece is worth leveling, as the Inventory's ⬆ badge rates it: sorts by expected gain, and breaks ties.
  const anyStar = result.activeBuilds.some((r) => r.priority === 'priority')
  const priorities = useMemo(
    () => new Map(inScope.map((e) => [e.piece.id, levelPriority(e, anyStar, advice.pieces.get(e.piece.id))] as const)),
    [inScope, anyStar, advice],
  )
  const rankOf = (e: Evaluation) => {
    const p = priorities.get(e.piece.id)
    return p ? (p.building ? 2 : p.star ? 1 : 0) : -1
  }

  const sets = useMemo(() => {
    const m = new Map<string, { lock: number; unlock: number; level: number; total: number }>()
    for (const e of inScope) {
      const c = m.get(e.piece.setKey) ?? { lock: 0, unlock: 0, level: 0, total: 0 }
      c.total++
      if (!done.has(doneKey(leveling, e))) {
        // A held piece isn't worth its EXP right now, so it isn't work to do yet.
        if (leveling) c.level += isHeld(priorities.get(e.piece.id)) ? 0 : 1
        else if (e.action === 'lock') c.lock++
        else if (e.action === 'unlock') c.unlock++
      }
      m.set(e.piece.setKey, c)
    }
    const pending = (c: { lock: number; unlock: number; level: number }) => c.lock + c.unlock + c.level
    return [...m.entries()].sort((a, b) => pending(b[1]) - pending(a[1]) || setName(a[0]).localeCompare(setName(b[0])))
  }, [inScope, done, leveling, priorities])

  const offSetCount = useMemo(() => {
    const picks = inScope.filter(isOffSetPick)
    return { total: picks.length, pending: picks.filter((e) => (leveling || e.action) && !done.has(doneKey(leveling, e))).length }
  }, [inScope, done, leveling])

  const inSet = useMemo(
    () => inScope.filter((e) => set === 'all' || (set === OFF_SET ? isOffSetPick(e) : e.piece.setKey === set)),
    [inScope, set],
  )
  const mains = useMemo(
    () =>
      [...new Set(inSet.filter((e) => slot === 'all' || e.piece.slotKey === slot).map((e) => e.piece.mainStatKey))].sort(),
    [inSet, slot],
  )

  const list = useMemo(
    () =>
      inSet
        .filter(
          (e) =>
            (slot === 'all' || e.piece.slotKey === slot) &&
            (main === 'all' || e.piece.mainStatKey === main) &&
            (leveling || show === 'all' || e.action !== null) &&
            !(hideDone && done.has(doneKey(leveling, e))),
        )
        .sort(
          leveling && priorityFirst
            ? priorityThen(sort, gainOf(priorities), valueOf(priorities), rankOf, anyStar)
            : sorter(sort, gainOf(priorities), valueOf(priorities)),
        ),
    [inSet, slot, main, show, hideDone, done, sort, leveling, priorityFirst, priorities, anyStar],
  )

  const focusIdx = Math.min(focus, Math.max(0, list.length - 1))

  // Keyboard: ↑/↓ or J/K move, Space/Enter marks done and advances, Z undoes.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement
      if (t.closest('input, select, textarea') || ev.ctrlKey || ev.metaKey || ev.altKey) return
      const k = ev.key.toLowerCase()
      if (k === 'arrowdown' || k === 'j') {
        setFocus(Math.min(list.length - 1, focusIdx + 1))
      } else if (k === 'arrowup' || k === 'k') {
        setFocus(Math.max(0, focusIdx - 1))
      } else if (k === ' ' || k === 'enter') {
        const e = list[focusIdx]
        if (!e) return
        markDone(e, focusIdx)
      } else if (k === 'z') {
        const key = undo.current.pop()
        if (!key) return
        toggleDone(key, false)
        const back = list.findIndex((x) => keyOf(x) === key)
        if (back !== -1) setFocus(back)
      } else return
      ev.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    document.querySelector('.card.focused')?.scrollIntoView({ block: 'nearest' })
  }, [focusIdx, list])

  function markDone(e: Evaluation, i: number) {
    if (preview) return
    const wasDone = isDone(e)
    toggleDone(keyOf(e), !wasDone)
    if (wasDone) return
    undo.current.push(keyOf(e))
    // Advance to the next piece still needing work. If done pieces get hidden, the list shifts up instead.
    if (hideDone) return setFocus(i)
    const next = list.findIndex((x, j) => j > i && needsWork(x) && !isDone(x))
    setFocus(next === -1 ? i : next)
  }

  const pickSet = (s: string) => {
    onSet(s)
    setMain('all')
    setFocus(0)
  }

  return (
    <div className="listview">
      <aside className="rail">
        <button className={set === 'all' ? 'rail-item active' : 'rail-item'} onClick={() => pickSet('all')}>
          <span className="rail-name">All sets</span>
          <Counts
            lock={sets.reduce((s, [, c]) => s + c.lock, 0)}
            unlock={sets.reduce((s, [, c]) => s + c.unlock, 0)}
            level={sets.reduce((s, [, c]) => s + c.level, 0)}
          />
        </button>
        {offSetCount.total > 0 && (
          <button
            className={set === OFF_SET ? 'rail-item active' : 'rail-item'}
            onClick={() => pickSet(OFF_SET)}
            title="Kept as off-set pieces, any set"
          >
            <span className="rail-name">◇ Off-set picks</span>
            <span className="counts">
              <span className="muted">{offSetCount.pending || offSetCount.total}</span>
            </span>
          </button>
        )}
        {sets.map(([key, c]) => (
          <button
            key={key}
            className={key === set ? 'rail-item active' : 'rail-item'}
            onClick={() => pickSet(key)}
            title={railTitle(key, result)}
          >
            <span className="rail-name">{setName(key)}</span>
            <Counts lock={c.lock} unlock={c.unlock} level={c.level} />
          </button>
        ))}
      </aside>

      <section className="list-pane">
        <div className="filters">
          {toolbar}
          <select className="rail-select" value={set} onChange={(e) => pickSet(e.target.value)}>
            <option value="all">All sets</option>
            {offSetCount.total > 0 && <option value={OFF_SET}>◇ Off-set picks ({offSetCount.total})</option>}
            {sets.map(([key, c]) => (
              <option key={key} value={key}>
                {setName(key)} ({c.lock + c.unlock + c.level})
              </option>
            ))}
          </select>
          <div className="seg" role="group" aria-label="Show">
            {(Object.keys(SHOW_LABEL) as ShowFilter[]).map((s) => (
              <button key={s} className={show === s ? 'on' : ''} title={SHOW_LABEL[s].title} onClick={() => (onShow(s), setFocus(0))}>
                {SHOW_LABEL[s].label}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Level">
            {(Object.keys(LEVEL_LABEL) as LevelFilter[]).map((l) => (
              <button key={l} className={level === l ? 'on' : ''} title={LEVEL_LABEL[l].title} onClick={() => (onLevel(l), setFocus(0))}>
                {LEVEL_LABEL[l].label}
              </button>
            ))}
          </div>
          <div className="seg">
            <button className={slot === 'all' ? 'on' : ''} onClick={() => (setSlot('all'), setMain('all'), setFocus(0))}>
              All
            </button>
            {SLOTS.map((s) => (
              <button
                key={s}
                className={slot === s ? 'on' : ''}
                onClick={() => (setSlot(s), setMain('all'), setFocus(0))}
                title={SLOT_LABEL[s]}
              >
                {SLOT_ICON[s]}
              </button>
            ))}
          </div>
          <select value={main} onChange={(e) => (setMain(e.target.value), setFocus(0))} title="Main stat">
            <option value="all">Any main stat</option>
            {mains.map((m) => (
              <option key={m} value={m}>
                {statLabel(m)}
              </option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)} title="Match the in-game order">
            {(Object.keys(SORT_LABEL) as SortMode[]).filter((m) => leveling || !LEVEL_ONLY.includes(m)).map((m) => (
              <option key={m} value={m}>
                {SORT_LABEL[m]}
              </option>
            ))}
          </select>
          {leveling && (
            <label className="check" title="📌 Building first, then ★ Priority">
              <input type="checkbox" checked={priorityFirst} onChange={(e) => (setPriorityFirst(e.target.checked), setFocus(0))} /> 📌
              ★ first
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Hide done
          </label>
        </div>

        {leveling && (
          <div className="set-info">
            <ExpNote advice={advice} />
          </div>
        )}
        {set === OFF_SET && (
          <div className="set-info">
            <b>Off-set picks</b>: filter by slot + main stat in-game
          </div>
        )}
        {set !== 'all' && set !== OFF_SET && brief}

        <div className="cards">
          {list.length === 0 && (
            <div className="empty">
              {leveling ? 'Nothing to level here.' : show === 'changes' ? 'Nothing to change here. 🎉' : 'No artifacts match.'}
            </div>
          )}
          {list.map((e, i) => (
            <ArtifactCard
              key={e.piece.id}
              ev={e}
              leveling={leveling}
              priority={leveling ? priorities.get(e.piece.id) : undefined}
              focused={i === focusIdx}
              inspected={inspected === e.piece.id}
              done={isDone(e)}
              expanded={expanded === e.piece.id}
              onFocus={() => setFocus(i)}
              onDone={() => markDone(e, i)}
              onToggleExpand={() => setExpanded(expanded === e.piece.id ? null : e.piece.id)}
              onInspect={() => (setFocus(i), onInspect(e.piece.id))}
              preview={preview}
              was={was?.get(e.piece.id)}
            />
          ))}
        </div>
        <div className="keys">
          <kbd>↑</kbd>
          <kbd>↓</kbd> move · <kbd>Space</kbd> {leveling ? 'leveled' : 'done'} &amp; next · <kbd>Z</kbd> undo
        </div>
      </section>
    </div>
  )
}

const SCOPE_LABEL = { building: '📌 Building', priority: '★ Priority', all: 'everyone' } as const

/**
 * What EXP is worth when leveling, as levelingAdvice prices it: "12.3M EXP · 📌 Building ≥ 0.61/100k · others ≥
 * 0.30/100k · ⏸ 22 held".
 */
function ExpNote({ advice }: { advice: LevelingAdvice }) {
  const { hand, price, restPrice, scope } = advice
  const all = [...advice.pieces.values()]
  const held = all.filter((a) => !a.worth).length
  const exp = `${(Math.max(0, hand.budget) / 1e6).toFixed(1)}M`
  const rate = (p: number) => `${(p * 1e5).toFixed(2)}/100k`
  const first = price > 0 ? `${SCOPE_LABEL[scope]} ≥ ${rate(price)}` : `${SCOPE_LABEL[scope]} all covered`
  const others = all.some((a) => !a.first)
    ? restPrice >= MAX_PRICE
      ? 'others: none left'
      : restPrice > 0
        ? `others ≥ ${rate(restPrice)}`
        : 'others covered'
    : null
  return <>{[`${exp} EXP`, first, others, held > 0 ? `⏸ ${held} held` : null].filter(Boolean).join(' · ')}</>
}

function Counts({ lock, unlock, level }: { lock: number; unlock: number; level: number }) {
  return (
    <span className="counts">
      {lock > 0 && <span className="c-lock">▲{lock}</span>}
      {unlock > 0 && <span className="c-unlock">▼{unlock}</span>}
      {level > 0 && <span className="c-level">⬆{level}</span>}
    </span>
  )
}

function railTitle(set: string, result: EvaluationResult): string {
  const users = result.setUsers[set] ?? []
  return users.length
    ? `4pc users: ${users.map((u) => `${characterName(u.char)}${u.twoPieceOnly ? ' (2pc)' : ''}`).join(', ')}`
    : 'No 4pc users'
}
