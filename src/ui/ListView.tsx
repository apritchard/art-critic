import { useEffect, useMemo, useRef, useState } from 'react'
import type { Evaluation, EvaluationResult } from '../engine/evaluate'
import { characterName, SLOT_LABEL, setName, statLabel } from '../engine/stats'
import { SLOTS, type SlotKey } from '../engine/types'
import { useStore, type SortMode } from '../state/store'
import { ArtifactCard, SLOT_ICON } from './ArtifactCard'
import { useLocal } from './local'

const SORT_LABEL: Record<SortMode, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  level: 'Level',
  slot: 'Slot, then main stat',
  verdict: 'Verdict',
  chance: 'Upgrade chance',
}

const GRADE_ORDER = { keep: 0, equipped: 1, marginal: 2, toss: 3, skip: 4 }

/** Best chance this piece ends up beating what someone wears, over every build it passes for. */
export const topChance = (e: Evaluation) =>
  Math.max(0, ...e.candidates.filter((c) => c.gate !== 'fail').map((c) => c.chance))

/** Best chance for a ★ Priority character, or -1 when it isn't headed to one. */
const priorityChance = (e: Evaluation) =>
  Math.max(
    -1,
    ...e.candidates
      .filter((c) => c.ref.priority === 'priority' && c.gate !== 'fail' && (c.chance > 0 || c.ref.char === e.piece.owner))
      .map((c) => c.chance),
  )

function sorter(mode: SortMode): (a: Evaluation, b: Evaluation) => number {
  switch (mode) {
    case 'chance':
      return (a, b) =>
        topChance(b) - topChance(a) || (b.best?.expected ?? 0) - (a.best?.expected ?? 0) || b.piece.idx - a.piece.idx
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

export type ListTab = 'triage' | 'progress' | 'review' | 'level'

/** Rail entry for pieces whose verdict rests on being someone's off-set piece, whatever their set. */
const OFF_SET = '__offset'
const isOffSetPick = (e: Evaluation) => e.best?.setMatch.kind === 'off' && e.grade !== 'toss'

/** Done marks for leveling are kept apart from lock/unlock marks on the same piece. */
export const doneKey = (tab: ListTab, e: Evaluation) => (tab === 'level' ? `lvl:${e.piece.id}` : e.piece.id)

type LevelFilter = 'all' | 'fresh' | 'started'

/** Pieces headed to a ★ Priority character first (by their chance, when sorting by chance), then the rest. */
function priorityThen(mode: SortMode): (a: Evaluation, b: Evaluation) => number {
  const base = sorter(mode)
  return (a, b) => {
    const pa = priorityChance(a)
    const pb = priorityChance(b)
    return Number(pb >= 0) - Number(pa >= 0) || (mode === 'chance' ? pb - pa : 0) || base(a, b)
  }
}

interface Props {
  tab: ListTab
  result: EvaluationResult
  scope: (e: Evaluation) => boolean
}

export function ListView({ tab, result, scope }: Props) {
  const store = useStore()
  const { done, toggleDone } = store
  const leveling = tab === 'level'
  const [set, setSet] = useLocal<string>(`${tab}:set`, 'all')
  const [slot, setSlot] = useLocal<SlotKey | 'all'>(`${tab}:slot`, 'all')
  const [main, setMain] = useLocal<string>(`${tab}:main`, 'all')
  const [show, setShow] = useLocal<'actions' | 'all'>(`${tab}:show`, 'actions')
  const [levels, setLevels] = useLocal<LevelFilter>('level:levels', 'all')
  const [hideDone, setHideDone] = useLocal<boolean>('hideDone', false)
  // The level queue keeps its own sort (upgrade chance by default); the lock tabs share one.
  const [levelSort, setLevelSort] = useLocal<SortMode>('level:sort', 'chance')
  const [priorityFirst, setPriorityFirst] = useLocal('level:priorityFirst', true)
  const sort = leveling ? levelSort : store.sort
  const setSort = leveling ? setLevelSort : store.setSort
  const [focus, setFocus] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)
  const undo = useRef<string[]>([])

  const keyOf = (e: Evaluation) => doneKey(tab, e)
  const isDone = (e: Evaluation) => done.has(keyOf(e))
  // Every piece in the level queue is work to do; elsewhere only lock-state changes are.
  const needsWork = (e: Evaluation) => leveling || e.action !== null

  const inScope = useMemo(
    () =>
      result.evaluations.filter(
        (e) =>
          scope(e) &&
          (!leveling || levels === 'all' || (levels === 'fresh' ? e.piece.level === 0 : e.piece.level > 0)),
      ),
    [result, scope, leveling, levels],
  )

  const sets = useMemo(() => {
    const m = new Map<string, { lock: number; unlock: number; level: number; total: number }>()
    for (const e of inScope) {
      const c = m.get(e.piece.setKey) ?? { lock: 0, unlock: 0, level: 0, total: 0 }
      c.total++
      if (!done.has(doneKey(tab, e))) {
        if (tab === 'level') c.level++
        else if (e.action === 'lock') c.lock++
        else if (e.action === 'unlock') c.unlock++
      }
      m.set(e.piece.setKey, c)
    }
    const pending = (c: { lock: number; unlock: number; level: number }) => c.lock + c.unlock + c.level
    return [...m.entries()].sort((a, b) => pending(b[1]) - pending(a[1]) || setName(a[0]).localeCompare(setName(b[0])))
  }, [inScope, done, tab])

  const offSetCount = useMemo(() => {
    const picks = inScope.filter(isOffSetPick)
    return { total: picks.length, pending: picks.filter((e) => (tab === 'level' || e.action) && !done.has(doneKey(tab, e))).length }
  }, [inScope, done, tab])

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
            !(hideDone && done.has(doneKey(tab, e))),
        )
        .sort(leveling && priorityFirst ? priorityThen(sort) : sorter(sort)),
    [inSet, slot, main, show, hideDone, done, sort, leveling, tab, priorityFirst],
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
    setSet(s)
    setMain('all')
    setFocus(0)
  }

  const users = set !== 'all' ? (result.setUsers[set] ?? []) : []

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
            title="Pieces kept as a character's one off-set piece, whatever their set"
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
          <select className="rail-select" value={set} onChange={(e) => pickSet(e.target.value)}>
            <option value="all">All sets</option>
            {offSetCount.total > 0 && <option value={OFF_SET}>◇ Off-set picks ({offSetCount.total})</option>}
            {sets.map(([key, c]) => (
              <option key={key} value={key}>
                {setName(key)} ({c.lock + c.unlock + c.level})
              </option>
            ))}
          </select>
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
            {(Object.keys(SORT_LABEL) as SortMode[]).map((m) => (
              <option key={m} value={m}>
                {SORT_LABEL[m]}
              </option>
            ))}
          </select>
          {leveling ? (
            <div className="seg">
              {(['all', 'fresh', 'started'] as const).map((l) => (
                <button key={l} className={levels === l ? 'on' : ''} onClick={() => (setLevels(l), setFocus(0))}>
                  {l === 'all' ? 'Any level' : l === 'fresh' ? '+0' : '+1–19'}
                </button>
              ))}
            </div>
          ) : (
            <div className="seg">
              <button className={show === 'actions' ? 'on' : ''} onClick={() => setShow('actions')}>
                Needs action
              </button>
              <button className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>
                All
              </button>
            </div>
          )}
          {leveling && (
            <label className="check" title="Pieces that could go to a ★ Priority character come first">
              <input type="checkbox" checked={priorityFirst} onChange={(e) => (setPriorityFirst(e.target.checked), setFocus(0))} /> ★
              Priority first
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Hide done
          </label>
        </div>

        {leveling && (
          <div className="set-info">
            Level each piece only to its next stop: every 4 levels adds one roll. Then re-export and the piece is re-scored
            with the new roll, so it either continues or gets fed. Each chip is the chance it beats what that character
            wears once it reaches +20.
          </div>
        )}
        {set === OFF_SET && (
          <div className="set-info">
            <b>Off-set picks</b>: pieces kept to fill a character&apos;s one free slot, whatever their set. In-game, filter
            by slot and main stat instead of set.
          </div>
        )}
        {set !== 'all' && set !== OFF_SET && (
          <div className="set-info">
            <b>{setName(set)}</b>: filter by this set in-game.{' '}
            {users.length ? (
              <>4pc users: {users.map(userLabel).join(', ')}</>
            ) : (
              <>No active character uses it as a 4pc set.</>
            )}
          </div>
        )}

        <div className="cards">
          {list.length === 0 && (
            <div className="empty">
              {leveling ? 'Nothing to level here.' : show === 'actions' ? 'Nothing to change here. 🎉' : 'No artifacts match.'}
            </div>
          )}
          {list.map((e, i) => (
            <ArtifactCard
              key={e.piece.id}
              ev={e}
              leveling={leveling}
              focused={i === focusIdx}
              done={isDone(e)}
              expanded={expanded === e.piece.id}
              onFocus={() => setFocus(i)}
              onDone={() => markDone(e, i)}
              onToggleExpand={() => setExpanded(expanded === e.piece.id ? null : e.piece.id)}
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

function Counts({ lock, unlock, level }: { lock: number; unlock: number; level: number }) {
  return (
    <span className="counts">
      {lock > 0 && <span className="c-lock">▲{lock}</span>}
      {unlock > 0 && <span className="c-unlock">▼{unlock}</span>}
      {level > 0 && <span className="c-level">⬆{level}</span>}
    </span>
  )
}

/** "Nilou (t2, 2pc)": a set's user, with its tier past 1 and whether they keep it for 2pc pairs only. */
function userLabel(u: EvaluationResult['setUsers'][string][number]): string {
  const notes = [u.tier > 1 && `t${u.tier}`, u.twoPieceOnly && '2pc'].filter(Boolean)
  return `${characterName(u.char)}${notes.length ? ` (${notes.join(', ')})` : ''}`
}

function railTitle(set: string, result: EvaluationResult): string {
  const users = result.setUsers[set] ?? []
  return users.length
    ? `4pc users: ${users.map((u) => `${characterName(u.char)}${u.twoPieceOnly ? ' (2pc)' : ''}`).join(', ')}`
    : 'No active character uses this as a 4pc set'
}
