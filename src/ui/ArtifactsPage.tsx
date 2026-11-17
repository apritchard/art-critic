import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { EvaluationResult } from '../engine/evaluate'
import { rerollPriority, type RerollPriority } from '../engine/inventory'
import { planRerolls } from '../engine/reroll'
import { useStore } from '../state/store'
import { InventoryView } from './InventoryView'
import { ListView } from './ListView'
import { useLocal } from './local'
import { DEFAULT_SIZE, PieceInspector, type Dock } from './PieceInspector'
import { useGuarantee } from './RerollPage'
import { artifactsHref, replaceHash, type ArtifactsRoute, type ArtifactsView, type LevelFilter, type ShowFilter } from './routes'

/** Whether the window is taller than wide, as on a portrait monitor; follows it as it changes. */
function usePortrait(): boolean {
  const query = '(orientation: portrait)'
  const [portrait, setPortrait] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const m = matchMedia(query)
    const on = () => setPortrait(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return portrait
}

/**
 * Every piece, one set at a time: as the game's inventory grid or as cards, filtered to lock changes, the Level up
 * queue or everything. A piece opens in the inspector beside it, with Closest build, so checking a verdict doesn't
 * leave the page. The view, set and inspected piece are kept in the URL, so Back comes here as it was.
 */
export function ArtifactsPage({ result, route }: { result: EvaluationResult; route: ArtifactsRoute }) {
  const { pieces, er, config } = useStore()
  const [guarantee] = useGuarantee()
  const [view, setView] = useLocal<ArtifactsView>('artifacts:view', 'grid')
  const [set, setSet] = useLocal<string>('artifacts:set', 'all')
  const [show, setShow] = useLocal<ShowFilter>('list:show', 'changes')
  const [level, setLevel] = useLocal<LevelFilter>('list:level', 'fresh')
  const [inspected, setInspected] = useState<string | null>(route.piece ?? null)
  // Room for the grid: the set list can be folded away (a dropdown in the filter bar stands in for it), and the
  // inspector docked at the side or the bottom. Auto puts it at the bottom while the window is portrait.
  const [railOff, setRailOff] = useLocal('artifacts:railOff', false)
  const [dock, setDock] = useLocal<Dock>('artifacts:dock', 'auto')
  const portrait = usePortrait()
  const placed = dock === 'auto' ? (portrait ? 'bottom' : 'side') : dock
  const [sizes, setSizes] = useLocal('artifacts:inspectorSize', DEFAULT_SIZE)
  const size = sizes[placed] ?? DEFAULT_SIZE[placed]
  const [jump, setJump] = useState<{ piece: string; key: string } | undefined>(undefined)

  // A link followed (or an old tab's): its view, filters, set, and the piece to open and scroll to.
  useEffect(() => {
    if (route.view) setView(route.view)
    if (route.show) setShow(route.show)
    if (route.level) setLevel(route.level)
    const ev = route.piece ? result.evaluations.find((e) => e.piece.id === route.piece) : undefined
    if (route.set) setSet(route.set)
    else if (ev) setSet(ev.piece.setKey)
    if (route.piece) {
      setInspected(route.piece)
      setJump({ piece: route.piece, key: route.key })
    }
  }, [route.key])

  // Keep the URL in step without adding history entries: Back leaves the tab, and comes back to it as it was.
  useEffect(() => {
    replaceHash(artifactsHref({ view, set, piece: inspected ?? undefined }))
  }, [view, set, inspected])

  // +20s worth a reroll, as Spend → Dust judges them: the grid's ⟳ badges and the inspector's reroll line.
  const anyStar = result.activeBuilds.some((r) => r.priority === 'priority')
  const needRerolls = view === 'grid' || inspected !== null
  const rerolls = useMemo(() => {
    if (!needRerolls) return null
    const m = new Map<string, RerollPriority>()
    for (const o of planRerolls(result, pieces, guarantee, er, config).options) {
      const r = rerollPriority(o, anyStar)
      if (r) m.set(o.piece.id, r)
    }
    return m
  }, [needRerolls, result, pieces, guarantee, er, config, anyStar])

  const toolbar = (
    <>
      <button
        className={`ghost rail-toggle${railOff ? '' : ' on'}`}
        onClick={() => setRailOff(!railOff)}
        aria-pressed={!railOff}
        title={railOff ? 'Show the set list' : 'Hide the set list (a dropdown here picks the set instead)'}
      >
        {railOff ? '»' : '«'} Sets
      </button>
      <div className="seg" role="group" aria-label="View">
        <button className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')} title="The game's inventory order, one set at a time">
          ▦ Grid
        </button>
        <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} title="Cards with each piece's reason, across sets">
          ☰ List
        </button>
      </div>
    </>
  )
  const find = (id: string) => {
    const ev = result.evaluations.find((e) => e.piece.id === id)
    if (ev) setSet(ev.piece.setKey)
    setView('grid')
    setJump({ piece: id, key: `find:${id}:${Date.now()}` })
  }

  return (
    <div
      className={`artifacts dock-${placed}${inspected ? ' inspecting' : ''}${railOff ? ' rail-off' : ''}`}
      style={{ [`--inspector-${placed === 'side' ? 'w' : 'h'}`]: `${size}px` } as CSSProperties}
    >
      {view === 'grid' ? (
        <InventoryView
          result={result}
          set={set}
          onSet={setSet}
          selected={inspected}
          onSelect={setInspected}
          jump={jump}
          rerolls={rerolls ?? new Map()}
          toolbar={toolbar}
        />
      ) : (
        <ListView
          result={result}
          set={set}
          onSet={setSet}
          show={show}
          onShow={setShow}
          level={level}
          onLevel={setLevel}
          inspected={inspected}
          onInspect={setInspected}
          toolbar={toolbar}
        />
      )}
      {inspected && (
        <PieceInspector
          result={result}
          id={inspected}
          rerolls={rerolls}
          dock={dock}
          placed={placed}
          onDock={setDock}
          size={size}
          onSize={(px) => setSizes({ ...DEFAULT_SIZE, ...sizes, [placed]: px })}
          onClose={() => setInspected(null)}
          onFind={view === 'list' ? () => find(inspected) : undefined}
        />
      )}
    </div>
  )
}
