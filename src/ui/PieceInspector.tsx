import { useDeferredValue, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { EvaluationResult } from '../engine/evaluate'
import type { LevelingAdvice } from '../engine/fodder'
import { levelPriority, type RerollPriority } from '../engine/inventory'
import { useStore } from '../state/store'
import { BuildTable, isHeld } from './ArtifactCard'
import { FitPanel, useFitting } from './FitPanel'
import { levelLine, rerollKey, rerollLine } from './InventoryView'
import { levelKey } from './ListView'
import { buildsHref } from './routes'

/** Where the inspector sits: beside the grid, under it, or (auto) under it while the window is portrait. */
export type Dock = 'auto' | 'side' | 'bottom'

const DOCK_LABEL: Record<Dock, { label: string; title: string }> = {
  auto: { label: 'Auto', title: 'Side, or bottom when portrait' },
  side: { label: '◨', title: 'Dock at the side' },
  bottom: { label: '⬓', title: 'Dock at the bottom' },
}

interface Props {
  result: EvaluationResult
  id: string
  /** +20s worth a reroll, as Spend → Dust judges them. */
  rerolls: Map<string, RerollPriority> | null
  /** Which pieces in the To level queue are worth their EXP now (levelingAdvice). */
  advice: LevelingAdvice
  /** The dock picked, and where that puts it now. */
  dock: Dock
  placed: 'side' | 'bottom'
  onDock: (dock: Dock) => void
  /** Its width at the side or height at the bottom, in px; dragging its inner edge changes it. */
  size: number
  onSize: (px: number) => void
  onClose: () => void
  /** Shows the piece in the grid, from the list. */
  onFind?: () => void
}

/** The inspector's default size: its width docked at the side, its height docked at the bottom. */
export const DEFAULT_SIZE = { side: 460, bottom: 380 }

/** The inspector's frame: the edge to drag, and the panel scrolling inside. */
function Frame({ placed, size, onSize, stale, children }: Pick<Props, 'placed' | 'size' | 'onSize'> & { stale?: boolean; children: ReactNode }) {
  const [dragging, setDragging] = useState(false)
  // Dragging the inner edge: left for a wider side panel, up for a taller bottom one, leaving the grid some room.
  const drag = (e: ReactPointerEvent) => {
    e.preventDefault()
    const side = placed === 'side'
    const from = side ? e.clientX : e.clientY
    const max = side ? innerWidth - 320 : innerHeight - 200
    const move = (ev: PointerEvent) => {
      const moved = (side ? ev.clientX : ev.clientY) - from
      onSize(Math.round(Math.max(side ? 320 : 160, Math.min(max, size - moved))))
    }
    const up = () => {
      setDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    setDragging(true)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <aside className={`inspector ${placed}${stale ? ' stale' : ''}`}>
      <div
        className={`inspector-grip${dragging ? ' dragging' : ''}`}
        role="separator"
        aria-orientation={placed === 'side' ? 'vertical' : 'horizontal'}
        title="Drag to resize; double-click for the default size"
        onPointerDown={drag}
        onDoubleClick={() => onSize(DEFAULT_SIZE[placed])}
      />
      <div className="inspector-body">{children}</div>
    </aside>
  )
}

/** Where to dock the inspector. */
function DockSwitch({ dock, onDock }: Pick<Props, 'dock' | 'onDock'>) {
  return (
    <span className="seg small" role="group" aria-label="Dock">
      {(Object.keys(DOCK_LABEL) as Dock[]).map((d) => (
        <button key={d} className={dock === d ? 'on' : ''} title={DOCK_LABEL[d].title} onClick={() => onDock(d)}>
          {DOCK_LABEL[d].label}
        </button>
      ))}
    </span>
  )
}

/**
 * The Artifacts tab's side panel for one piece: its verdict and why, buttons to mark it done, leveled or rerolled,
 * and Closest build (the builds nearest to keeping it, with the set and main-stat edits that would), so a verdict can
 * be checked without leaving the grid.
 */
export function PieceInspector({ result, id, rerolls, advice, dock, placed, onDock, size, onSize, onClose, onFind }: Props) {
  const { config, setCharacterBuilds } = useStore()
  // Ranking every build for a piece costs about an evaluation, so moving through the grid doesn't wait on it.
  const shownId = useDeferredValue(id)
  const fitting = useFitting(result, shownId)
  const [pick, setPick] = useState<{ id: string; char: string; idx: number } | null>(null)
  const ev = fitting?.ev ?? null
  const auto = fitting?.fits[0]?.ref ?? ev?.best?.ref ?? null
  const target = pick?.id === shownId ? pick : auto ? { char: auto.char, idx: auto.buildIdx } : null
  const builds = target ? config.characters[target.char]?.builds : undefined
  const build = builds?.[target!.idx]

  const frame = { placed, size, onSize }
  const tools = <DockSwitch dock={dock} onDock={onDock} />
  if (!fitting || !ev || !target || !builds || !build) {
    return (
      <Frame {...frame}>
        <div className="fit-panel">
          <div className="fit-head">
            <b>Piece</b>
            <span className="fit-tools">{tools}</span>
            <button className="ghost small" onClick={onClose} title="Close the inspector">
              ✕
            </button>
          </div>
          <p className="hint">
            {!ev
              ? 'Not in this export (leveled since?)'
              : 'No active build has this slot'}
          </p>
        </div>
      </Frame>
    )
  }

  const save = (b: typeof build) => setCharacterBuilds(target.char, builds.map((x, j) => (j === target.idx ? b : x)))
  const editLink = (
    <a
      className="link fit-edit"
      href={buildsHref({ char: target.char, idx: target.idx, piece: ev.piece.owner ? undefined : ev.piece.id })}
      title="Edit weights in Builds (Back returns)"
    >
      edit in Builds →
    </a>
  )
  return (
    <Frame {...frame} stale={shownId !== id}>
      <FitPanel
        fitting={fitting}
        char={target.char}
        idx={target.idx}
        build={build}
        save={save}
        onPick={(char, idx) => setPick({ id: shownId, char, idx })}
        onClose={onClose}
        title="Piece"
        editLink={editLink}
        tools={tools}
        actions={<Actions result={result} id={shownId} rerolls={rerolls} advice={advice} onFind={onFind} />}
      />
    </Frame>
  )
}

/** Buttons to mark the piece's lock change done, and to mark it leveled or rerolled, with why it's worth either. */
function Actions({ result, id, rerolls, advice, onFind }: Pick<Props, 'result' | 'id' | 'rerolls' | 'advice' | 'onFind'>) {
  const { done, toggleDone } = useStore()
  const [showBuilds, setShowBuilds] = useState(false)
  const ev = result.evaluations.find((e) => e.piece.id === id)
  if (!ev) return null
  const anyStar = result.activeBuilds.some((r) => r.priority === 'priority')
  const level = levelPriority(ev, anyStar, advice.pieces.get(id))
  const reroll = rerolls?.get(id) ?? null
  const isDone = done.has(id)
  const leveled = done.has(levelKey(id))
  const rerolled = done.has(rerollKey(id))
  return (
    <div className="inspector-actions">
      <div className="inspector-buttons">
        {ev.action && (
          <button
            className={`action ${ev.action}${isDone ? ' is-done' : ''}`}
            onClick={() => toggleDone(id)}
            title={isDone ? 'Done: click to undo' : 'Mark done (Space)'}
          >
            {isDone ? '✓ done' : ev.action === 'lock' ? '🔒 LOCK it' : '🔓 UNLOCK it'}
          </button>
        )}
        {level && (
          <button
            className={`action level${leveled ? ' is-done' : ''}`}
            onClick={() => toggleDone(levelKey(id))}
            title={leveled ? 'Leveled: click to undo' : 'Mark leveled (L)'}
          >
            {leveled ? '✓ leveled' : `${isHeld(level) ? '⏸' : '⬆'} leveled to +${level.next}`}
          </button>
        )}
        {reroll && (
          <button
            className={`action level${rerolled ? ' is-done' : ''}`}
            onClick={() => toggleDone(rerollKey(id))}
            title={rerolled ? 'Rerolled: click to undo' : 'Mark rerolled (R)'}
          >
            {rerolled ? '✓ rerolled' : '⟳ rerolled'}
          </button>
        )}
        {onFind && ev.piece.rarity === 5 && (
          <button className="link" onClick={onFind} title="Show in grid">
            find in grid
          </button>
        )}
        {ev.candidates.length > 0 && (
          <button className="link" onClick={() => setShowBuilds(!showBuilds)}>
            {showBuilds ? 'hide builds' : `${ev.candidates.length} build${ev.candidates.length > 1 ? 's' : ''}`}
          </button>
        )}
      </div>
      {level && level.char && <p className="sub-note">{levelLine(level)}</p>}
      {reroll && <p className="sub-note">{rerollLine(reroll)}</p>}
      {showBuilds && <BuildTable piece={ev.piece} candidates={ev.candidates} />}
    </div>
  )
}
