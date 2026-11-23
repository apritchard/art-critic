import { useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { allowedMains, MAIN_SLOTS, type MainSlot } from '../engine/builds'
import { KEY_SHARE, setBrief, wanted, type BriefBuild } from '../engine/brief'
import { buildKey, type ActiveBuild, type EvaluationResult } from '../engine/evaluate'
import { MAIN_ODDS } from '../engine/farm'
import { describeSetMatch } from '../engine/match'
import { characterName, SLOT_LABEL, setName, statLabel, statShort } from '../engine/stats'
import { useStore } from '../state/store'
import { SLOT_ICON, weightClass } from './ArtifactCard'
import { useLocal } from './local'
import { marks } from './marks'
import { buildsHref } from './routes'

/** What a what-if changes: pieces whose verdict or lock differ from the real ones, in this set and in the others. */
export interface WhatIfChanges {
  here: number
  /** Of `here`, pieces kept before that no longer are. */
  unkept: number
  elsewhere: number
}

interface Props {
  /** The real result, with no build switched off: who uses the set, and what's kept for them. */
  result: EvaluationResult
  set: string
  /** Builds switched off for the what-if, by `buildKey`. */
  off: ReadonlySet<string>
  onOff: (off: Set<string>) => void
  changes: WhatIfChanges | null
  /** The views are still catching up with the latest click. */
  pending?: boolean
}

/** What hovering a chip lights up: one build's stats, or a stat's builds. */
type Hover = { builds: Set<string>; stats: Set<string> } | null

/**
 * The top of a set in the Artifacts tab: who uses it, and what they want from its pieces (each slot's main stats, the
 * substats that are key lines for them), so verdicts can be checked and pieces skimmed in-game. Every chip switches
 * its builds off for a what-if (the grid and list then show the verdicts without them), and shift-click keeps only
 * its builds. The what-if is temporary: it's never saved, and picking another set drops it.
 */
export function SetBrief({ result, set, off, onOff, changes, pending }: Props) {
  const { pieces, config, settings } = useStore()
  const [open, setOpen] = useLocal('brief:open', true)
  const [details, setDetails] = useLocal('brief:details', false)
  const [hover, setHover] = useState<Hover>(null)
  const brief = useMemo(() => setBrief(result, set, pieces, config, settings), [result, set, pieces, config, settings])
  const want = useMemo(() => wanted(brief.users.map((b) => b.ref)), [brief])
  const everyone = useMemo(() => [...brief.users, ...brief.sidelined, ...brief.offSet], [brief])
  const anyStar = result.activeBuilds.some((r) => r.priority === 'priority')

  const keysOf = (refs: ActiveBuild[]) => refs.map(buildKey)
  const onCount = (refs: ActiveBuild[]) => refs.filter((r) => !off.has(buildKey(r))).length
  /** Click: switch the group off (or back on when it's all off). Shift-click: switch everyone else in the brief off. */
  const toggle = (refs: ActiveBuild[], e: MouseEvent) => {
    const keys = keysOf(refs)
    if (e.shiftKey) {
      const keep = new Set(keys)
      return onOff(new Set(everyone.map((b) => buildKey(b.ref)).filter((k) => !keep.has(k))))
    }
    const next = new Set(off)
    const anyOn = keys.some((k) => !off.has(k))
    for (const k of keys) if (anyOn) next.add(k)
    else next.delete(k)
    onOff(next)
  }
  const state = (refs: ActiveBuild[]) => {
    const on = onCount(refs)
    return on === refs.length ? '' : on === 0 ? ' off' : ' partial'
  }
  const lit = (stat: string) => (hover?.stats.has(stat) ? ' lit' : '')
  const hoverStat = (stats: string[], refs: ActiveBuild[]) => ({
    onMouseEnter: () => setHover({ builds: new Set(keysOf(refs)), stats: new Set(stats) }),
    onMouseLeave: () => setHover(null),
  })

  const label = (ref: ActiveBuild) => {
    const multi = everyone.filter((b) => b.ref.char === ref.char).length > 1
    const short = ref.build.name.replace(/\s*\(.*\)\s*$/, '') || ref.build.name
    return `${characterName(ref.char)}${multi && short ? ` (${short})` : ''}`
  }
  const userChip = (b: BriefBuild, why?: string) => {
    const key = buildKey(b.ref)
    const statsOf = (ref: ActiveBuild) => {
      const top = Math.max(0, ...Object.values(ref.build.substats))
      return [
        ...MAIN_SLOTS.flatMap((slot) => allowedMains(ref.build, slot).map((m) => `${slot}:${m}`)),
        ...Object.entries(ref.build.substats)
          .filter(([, w]) => w >= top * KEY_SHARE - 1e-9)
          .map(([k]) => `sub:${k}`),
      ]
    }
    const title = [
      `${characterName(b.ref.char)}${b.ref.build.name ? ` · ${b.ref.build.name}` : ''}${marks(b.ref)}`,
      why ?? (b.match ? describeSetMatch(b.match) : 'off-set pieces only'),
      b.kept
        ? `${b.kept} unequipped piece${b.kept === 1 ? '' : 's'} of the set kept for them${b.only ? ` (${b.only} for no one else)` : ''}`
        : 'No unequipped piece of the set kept for them',
      off.has(key) ? 'Switched off: click to switch back on' : 'Click: what-if without them · Shift-click: only them',
    ].join('\n')
    return (
      <button
        key={key}
        className={`brief-chip brief-who${state([b.ref])}${hover?.builds.has(key) ? ' lit' : ''}${b.ref.building || (b.ref.priority === 'priority' && anyStar) ? ' first' : ''}`}
        title={title}
        aria-pressed={!off.has(key)}
        onClick={(e) => toggle([b.ref], e)}
        onMouseEnter={() => setHover({ builds: new Set([key]), stats: new Set(statsOf(b.ref)) })}
        onMouseLeave={() => setHover(null)}
      >
        {label(b.ref)}
        {marks(b.ref)}
        {b.kept > 0 && <span className={`brief-kept${b.only ? ' only' : ''}`}>{b.kept}</span>}
      </button>
    )
  }

  // Users by how the set counts for them: tier 1, tier 2, … then 2pc pairs.
  const groups = useMemo(() => {
    const m = new Map<string, BriefBuild[]>()
    for (const b of brief.users) {
      const g = b.match?.kind === '4pc' ? (b.match.twoPieceOnly ? `t${b.match.tier} 2pc` : `t${b.match.tier}`) : '2pc'
      m.set(g, [...(m.get(g) ?? []), b])
    }
    return [...m]
  }, [brief])
  const groupTitle = (g: string) =>
    g === '2pc'
      ? 'Run it for a 2pc pair the build lists'
      : g.endsWith('2pc')
        ? `Tier ${g[1]}, kept for the build's 2pc pairs`
        : `Tier ${g.slice(1)} of the build's 4pc sets`

  // Under Off-set: Any, most builds keep some spare of a set off-set. Only those a piece is kept for alone (switching
  // one off changes something) and any switched off are listed; the rest fold behind "+N more".
  const [allOffSet, setAllOffSet] = useState(false)
  const offSetShown = brief.offSet
    .filter((b) => allOffSet || b.only > 0 || off.has(buildKey(b.ref)))
    .sort((a, b) => b.only - a.only || b.kept - a.kept || a.ref.char.localeCompare(b.ref.char))
  const offSetFolded = brief.offSet.length - offSetShown.length

  const keptHere = result.evaluations.filter((e) => e.piece.setKey === set && !e.piece.owner && e.grade === 'keep').length
  const offCount = everyone.filter((b) => off.has(buildKey(b.ref))).length

  const statChip = (id: string, text: ReactNode, refs: ActiveBuild[], title: string, cls = '') => (
    <button
      key={id}
      className={`brief-chip brief-stat${cls}${state(refs)}${lit(id)}`}
      title={`${title}\nClick: what-if without them · Shift-click: only them`}
      aria-pressed={onCount(refs) > 0}
      onClick={(e) => toggle(refs, e)}
      {...hoverStat([id], refs)}
    >
      {text}
      <span className="brief-n">{onCount(refs)}</span>
    </button>
  )
  const names = (refs: ActiveBuild[]) => refs.map(label).join(', ')
  const users = brief.users.length

  return (
    <section className={`brief${off.size ? ' whatif' : ''}`} aria-label={`${setName(set)} brief`}>
      <div className="brief-head">
        <button className="ghost small brief-fold" onClick={() => setOpen(!open)} aria-expanded={open} title={open ? 'Fold the brief' : 'Show who uses the set, and what they want'}>
          {open ? '▾' : '▸'}
        </button>
        <b>{setName(set)}</b>
        <span className="muted">
          {users ? `${users} build${users === 1 ? '' : 's'} use it` : 'No active build uses it'} · {keptHere} kept
        </span>
        {pending ? (
          <span className="brief-whatif" role="status">
            What-if: updating…
          </span>
        ) : changes && (
          <span className="brief-whatif" role="status">
            What-if: {offCount} off ·{' '}
            {changes.here ? (
              <>
                <b>{changes.here}</b> change{changes.here === 1 ? 's' : ''} here
                {changes.unkept > 0 && ` (${changes.unkept} no longer kept)`}
              </>
            ) : (
              'nothing changes here'
            )}
            {changes.elsewhere > 0 && ` · ${changes.elsewhere} in other sets`}
          </span>
        )}
        <span className="brief-tools">
          {off.size > 0 && (
            <button className="ghost small" onClick={() => onOff(new Set())} title="Switch every build back on">
              ↺ Reset
            </button>
          )}
          {open && (
            <button className={`ghost small${details ? ' on' : ''}`} onClick={() => setDetails(!details)} aria-pressed={details} title="Each build's main stats and weights">
              Builds
            </button>
          )}
        </span>
      </div>

      {open && (
        <div className="brief-body">
          <div className="brief-row">
            <span className="brief-label">Who</span>
            <span className="brief-chips">
              {groups.map(([g, list]) => (
                <span key={g} className="brief-group">
                  <button
                    className={`brief-chip brief-tier${state(list.map((b) => b.ref))}`}
                    title={`${groupTitle(g)}\nClick: what-if without them · Shift-click: only them`}
                    onClick={(e) => toggle(list.map((b) => b.ref), e)}
                  >
                    {g}
                  </button>
                  {list.map((b) => userChip(b))}
                </span>
              ))}
              {!users && <span className="muted">none: pieces are kept only off-set</span>}
            </span>
          </div>

          {users > 0 &&
            MAIN_SLOTS.map((slot) => (
              <div className="brief-row" key={slot}>
                <span className="brief-label" title={SLOT_LABEL[slot]}>
                  {SLOT_ICON[slot]} {SLOT_LABEL[slot]}
                </span>
                <span className="brief-chips">
                  {want.mains[slot].map((m) =>
                    statChip(`${slot}:${m.stat}`, statShort(m.stat), m.refs, `${statLabel(m.stat)} ${SLOT_LABEL[slot].toLowerCase()}: ${names(m.refs)}`),
                  )}
                </span>
              </div>
            ))}

          {users > 0 && (
            <div className="brief-row">
              <span className="brief-label" title="Key lines: weighted at least half a build's top weight">
                Substats
              </span>
              <span className="brief-chips">
                {want.subs.map((s) => {
                  const on = onCount(s.refs)
                  const share = on / Math.max(1, onCount(brief.users.map((b) => b.ref)))
                  const weights = s.weights.map((w) => `${label(w.ref)} ${+w.weight.toFixed(2)}`).join(', ')
                  return statChip(
                    `sub:${s.stat}`,
                    statShort(s.stat),
                    s.refs,
                    `${statLabel(s.stat)}: a key line for ${names(s.refs)}\nWeights: ${weights}`,
                    ` ${share >= 0.5 ? 'w-hi' : share >= 0.2 ? 'w-mid' : 'w-lo'}`,
                  )
                })}
                {want.minor.length > 0 && (
                  <span
                    className="brief-minor"
                    title={want.minor.map((s) => `${statLabel(s.stat)}: ${s.weights.map((w) => `${label(w.ref)} ${+w.weight.toFixed(2)}`).join(', ')}`).join('\n')}
                  >
                    minor: {want.minor.map((s) => statShort(s.stat)).join(', ')}
                  </span>
                )}
              </span>
            </div>
          )}

          {brief.offSet.length > 0 && (
            <div className="brief-row">
              <span
                className="brief-label"
                title="Builds that don't run the set, keeping a piece of it as their one off-set piece (often a +20 spare that beats what they wear)"
              >
                Off-set
              </span>
              <span className="brief-chips">
                <button
                  className={`brief-chip brief-tier${state(brief.offSet.map((b) => b.ref))}`}
                  title={`Every build keeping a piece of the set off-set\nClick: what-if without them · Shift-click: only them`}
                  onClick={(e) => toggle(brief.offSet.map((b) => b.ref), e)}
                  {...hoverStat([], brief.offSet.map((b) => b.ref))}
                >
                  all {brief.offSet.length}
                </button>
                {offSetShown.map((b) => userChip(b, 'Keeps a piece of it as their off-set piece'))}
                {offSetFolded > 0 && (
                  <button className="link brief-more" onClick={() => setAllOffSet(true)} title="Builds with no piece kept for them alone: switching one off changes nothing on its own">
                    +{offSetFolded} more
                  </button>
                )}
              </span>
            </div>
          )}

          {brief.sidelined.length > 0 && (
            <div className="brief-row">
              <span className="brief-label" title="Builds that list the set, but count its pieces only as their off-set piece">
                Not counting
              </span>
              <span className="brief-chips">
                {brief.sidelined.map((b) =>
                  userChip(
                    b,
                    b.sidelined?.issue === 'worn'
                      ? `Lists it at tier ${b.sidelined.tier}, but wears ${setName(b.sidelined.worn.set)} (tier ${b.sidelined.worn.tier}): only a better tier counts (Settings → Stick to the worn set)`
                      : `Lists it at tier ${b.sidelined?.tier}: Set matching counts tiers 1–2 (Settings)`,
                  ),
                )}
              </span>
            </div>
          )}

          {details && <BuildRows builds={everyone} off={off} label={label} />}
        </div>
      )}
    </section>
  )
}

/** A build's main stats for a slot, or "any" when it takes every one the slot rolls. */
function mainsText(build: ActiveBuild['build'], slot: MainSlot): string {
  const mains = allowedMains(build, slot)
  return mains.length === MAIN_ODDS[slot].length ? 'any' : mains.map(statShort).join(' ')
}

/** Each build in the brief: how the set counts, its main stats per slot, and its substat weights. */
function BuildRows({ builds, off, label }: { builds: BriefBuild[]; off: ReadonlySet<string>; label: (ref: ActiveBuild) => string }) {
  return (
    <div className="brief-table-wrap">
      <table className="brief-table">
        <thead>
          <tr>
            <th>Build</th>
            <th>Set</th>
            <th title="Unequipped pieces of the set kept for it">Kept</th>
            {MAIN_SLOTS.map((s) => (
              <th key={s} title={SLOT_LABEL[s]}>
                {SLOT_ICON[s]}
              </th>
            ))}
            <th>Substat weights</th>
            <th>ER</th>
          </tr>
        </thead>
        <tbody>
          {builds.map((b) => {
            const subs = Object.entries(b.ref.build.substats)
              .filter(([, w]) => w > 0)
              .sort((x, y) => y[1] - x[1])
            return (
              <tr key={buildKey(b.ref)} className={off.has(buildKey(b.ref)) ? 'off' : ''}>
                <td>
                  <a className="char-link" href={buildsHref({ char: b.ref.char, idx: b.ref.buildIdx })} title="Open the build in Builds">
                    {label(b.ref)}
                  </a>
                  {marks(b.ref)}
                </td>
                <td className="muted">{b.match ? describeSetMatch(b.match) : b.sidelined ? 'off-set only' : 'off-set'}</td>
                <td className="num">{b.kept || ''}</td>
                {MAIN_SLOTS.map((s) => (
                  <td key={s}>{mainsText(b.ref.build, s)}</td>
                ))}
                <td>
                  {subs.map(([k, w], i) => (
                    <span key={k} className={weightClass(w)}>
                      {i > 0 && ' · '}
                      {statShort(k)} {+w.toFixed(2)}
                    </span>
                  ))}
                </td>
                <td className="muted">{b.ref.build.erTarget}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
