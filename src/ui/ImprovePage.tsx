import { useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { defaultRosterEntry, type ActiveBuild, type EvaluationResult } from '../engine/evaluate'
import { currentBuilds, planFarming, RESIN_SHOWN, STRONGBOX_BATCH, wearing } from '../engine/farm'
import { fourPieceSets } from '../engine/match'
import { improveCharacter, type ImprovePlan, type PieceOption, type SlotPlan } from '../engine/improve'
import type { Piece } from '../engine/load'
import type { Guarantee } from '../engine/reroll'
import { characterName, isPercent, SLOT_LABEL, setName, statShort } from '../engine/stats'
import type { Priority } from '../engine/types'
import { useStore } from '../state/store'
import { SLOT_ICON } from './ArtifactCard'
import { EquipLog, ErChange, ErGainNote, erTargetText, runs, TradeNote } from './FarmPage'
import { useLocal } from './local'
import { BuildingToggle, marks } from './marks'
import { buildsHref, charactersHref } from './routes'

const pct = (x: number) => (x > 0 && x < 0.01 ? '<1%' : `${Math.round(x * 100)}%`)
const qualityClass = (q: number | null) => (q === null ? 'q-none' : q >= 0.85 ? 'q-good' : q >= 0.6 ? 'q-ok' : 'q-weak')
const shortSubs = (p: Piece) =>
  p.substats.map((s) => `${statShort(s.key)} ${isPercent(s.key) ? s.value.toFixed(1) : Math.round(s.value)}`).join(' · ')

const GUARANTEE: Record<Guarantee, string> = { 2: 'Normal (2)', 3: 'Advanced (3)', 4: 'Decreed (4)' }

/** What the character rail ranks by: the weakest equipped piece's rating, or the average of all five. */
type RailSort = 'min' | 'avg' | 'name'
const RAIL_SORT: Record<RailSort, { label: string; title: string }> = {
  min: { label: 'Min', title: 'Weakest equipped piece' },
  avg: { label: 'Avg', title: 'Average (empty = 0%)' },
  name: { label: 'A–Z', title: 'By name; number = weakest piece' },
}

/** Every build of a character as something the planners can judge, active or not. */
function useRefs(result: EvaluationResult, char: string): ActiveBuild[] {
  const { config, roster, settings, data } = useStore()
  return useMemo(() => {
    const cc = config.characters[char]
    if (!cc) return []
    const owned = data.characters.find((c) => c.key === char)
    const entry = roster[char] ?? defaultRosterEntry(owned, settings.includeUnowned)
    return cc.builds.map(
      (build, buildIdx) =>
        result.activeBuilds.find((r) => r.char === char && r.buildIdx === buildIdx) ?? {
          char,
          buildIdx,
          build,
          priority: entry.priority,
          confidence: cc.confidence,
          cap: settings.capNormal,
          owned: !!owned,
        },
    )
  }, [result.activeBuilds, config.characters, char, roster, settings.capNormal, settings.includeUnowned, data.characters])
}

/**
 * One character in the Characters tab: the rail of characters, weakest first, and every way to improve the one
 * `selected`, slot by slot. Picking another adds a history entry, so Back returns to the last.
 */
export function ImprovePage({ result, selected }: { result: EvaluationResult; selected: string }) {
  const { pieces, config } = useStore()
  const [query, setQuery] = useState('')
  const [showInactive, setShowInactive] = useLocal('improve:inactive', false)
  const [sortPick, setSortBy] = useLocal<RailSort>('improve:sort', 'min')
  const sortBy: RailSort = sortPick === 'avg' || sortPick === 'name' ? sortPick : 'min'
  // The rating shown beside each name: by name, their weakest piece.
  const shownBy = sortBy === 'avg' ? 'avg' : 'min'

  // Ratings of the build each character wears: the weakest slot (where help is most needed) and the average.
  const ratings = useMemo(() => {
    const { worn } = wearing(result, pieces)
    return new Map(
      result.characters.map((c) => {
        const builds = c.builds.filter((b) => b.enabled)
        const scored = (builds.length ? builds : c.builds).map((b) => {
          const qs = Object.values(b.slots).map((s) => s.quality ?? 0)
          const sets = worn.get(c.char) ?? {}
          const build = config.characters[c.char]?.builds[b.idx]
          const onSet = build && fourPieceSets(build).some((s) => (sets[s.set] ?? 0) >= 4)
          return {
            onSet: Number(!!onSet),
            filled: qs.filter((q) => q > 0).length,
            min: Math.min(...qs),
            avg: qs.reduce((sum, q) => sum + q, 0) / qs.length,
          }
        })
        scored.sort((a, b) => b.onSet - a.onSet || b.filled - a.filled)
        return [c.char, { min: scored[0]?.min ?? 0, avg: scored[0]?.avg ?? 0 }] as const
      }),
    )
  }, [result, pieces, config.characters])
  const rating = (char: string) => ratings.get(char)?.[shownBy] ?? 0

  const chars = useMemo(
    () =>
      result.characters
        .filter((c) => c.owned && (showInactive || c.active))
        .filter((c) => characterName(c.char).toLowerCase().includes(query.toLowerCase()))
        .sort(
          (a, b) =>
            Number(b.building) - Number(a.building) ||
            (sortBy === 'name'
              ? characterName(a.char).localeCompare(characterName(b.char))
              : Number(b.priority === 'priority') - Number(a.priority === 'priority') ||
                (ratings.get(a.char)?.[sortBy] ?? 0) - (ratings.get(b.char)?.[sortBy] ?? 0)),
        ),
    [result.characters, showInactive, query, ratings, sortBy],
  )
  const char = config.characters[selected] && result.characters.some((c) => c.char === selected) ? selected : chars[0]?.char

  const pick = (k: string) => {
    location.hash = charactersHref({ char: k })
  }

  return (
    <div className="builds-page">
      <aside className="rail improve-rail">
        <input className="rail-search" placeholder="Search characters…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="check rail-check">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Include ignored
        </label>
        <div className="rail-sort">
          <span className="muted">Sort by</span>
          <div className="seg small">
            {(Object.keys(RAIL_SORT) as RailSort[]).map((k) => (
              <button key={k} className={sortBy === k ? 'on' : ''} title={RAIL_SORT[k].title} onClick={() => setSortBy(k)}>
                {RAIL_SORT[k].label}
              </button>
            ))}
          </div>
        </div>
        {chars.map((c) => {
          const q = rating(c.char)
          return (
            <button key={c.char} className={c.char === char ? 'rail-item active' : 'rail-item'} onClick={() => pick(c.char)}>
              <span className={`rail-name${c.active ? '' : ' muted'}`}>
                {characterName(c.char)}
                {marks(c)}
              </span>
              <span className={`counts ${qualityClass(q)}`} title={RAIL_SORT[shownBy].title}>
                {Math.round(q * 100)}%
              </span>
            </button>
          )
        })}
      </aside>
      {char ? <Detail key={char} char={char} result={result} /> : <div className="empty">No characters match.</div>}
    </div>
  )
}

function Detail({ char, result }: { char: string; result: EvaluationResult }) {
  const { pieces, config, domains, er, strongboxSets, data } = useStore()
  const [guarantee, setGuarantee] = useLocal<Guarantee>('reroll:guarantee', 2)
  const [otherSets, setOtherSets] = useLocal('improve:otherSets', true)
  const refs = useRefs(result, char)
  const worn = useMemo(() => wearing(result, pieces), [result, pieces])
  const wornIdx = useMemo(() => currentBuilds(refs, worn.worn, worn.barsOf, worn.ratingsOf)[0]?.buildIdx ?? 0, [refs, worn])
  const [idx, setIdx] = useState<number | null>(null)
  const ref = refs[idx ?? wornIdx] ?? refs[0]
  // Spares the free upgrades (Quick wins) already hand to someone.
  const claimed = useMemo(
    () => new Map(planFarming(result, pieces, config, domains, 'all', er, strongboxSets).swaps.map((s) => [s.piece.id, s.char])),
    [result, pieces, config, domains, er, strongboxSets],
  )
  const plan = useMemo(
    () => ref && improveCharacter({ result, pieces, config, domains, er, ref, guarantee, claimed, strongboxSets }),
    [result, pieces, config, domains, er, ref, guarantee, claimed, strongboxSets],
  )
  if (!ref || !plan) return <div className="empty">No build for {characterName(char)} in the config.</div>
  const owned = data.characters.find((c) => c.key === char)

  return (
    <div className="editor improve">
      <div className="editor-head">
        <h2>
          {characterName(char)}
          {marks({ priority: ref.priority })}
        </h2>
        <BuildingToggle char={char} label />
        <PrioritySwitch char={char} />
        <span className="sub-note">
          {owned ? `Lv ${owned.level}` : 'not owned'}
          {plan.er !== null && (
            <span className={plan.need !== null && plan.er < plan.need ? 'warn' : ''}>
              {' '}
              · ER {plan.er.toFixed(0)}%{plan.need !== null && ` (needs ${erTargetText(plan.need, plan.cap)})`}
            </span>
          )}
        </span>
        <a className="link" href={buildsHref({ char, idx: ref.buildIdx })} title="Edit in Builds">
          Edit build →
        </a>
      </div>
      {refs.length > 1 && (
        <div className="build-tabs">
          <div className="seg">
            {refs.map((r) => (
              <button key={r.buildIdx} className={r.buildIdx === ref.buildIdx ? 'on' : ''} onClick={() => setIdx(r.buildIdx)}>
                {r.build.name || `Build ${r.buildIdx + 1}`}
                {r.buildIdx === wornIdx && <span className="worn-tag">wearing</span>}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="sub-note">
        <SetLine plan={plan} />
      </p>
      <OffSetLine plan={plan} />
      <EquipLog char={char} />
      <div className="impact">
        {plan.slots.map((s) => (
          <a key={s.slot} href={charactersHref({ char })} onClick={(e) => jump(e, s.slot)} className={`qcell ${qualityClass(s.quality)}`} title={SLOT_LABEL[s.slot]}>
            {SLOT_ICON[s.slot]} {s.quality === null ? '–' : `${Math.round(s.quality * 100)}%`}
          </a>
        ))}
        <span className="muted">· weakest first</span>
      </div>
      <p className="hint">
        Chance vs current · Avg gain: miss = 0 · domain per {RESIN_SHOWN} resin, Strongbox per {STRONGBOX_BATCH}
      </p>
      <div className="roster-tools">
        <span className="muted">Reroll guarantee</span>
        <div className="seg small">
          {([2, 3, 4] as const).map((g) => (
            <button key={g} className={guarantee === g ? 'on' : ''} onClick={() => setGuarantee(g)}>
              {GUARANTEE[g]}
            </button>
          ))}
        </div>
        <label
          className="check"
          title={`Off: only ${ownSets(plan).map(setName).join(' or ')} pieces`}
        >
          <input type="checkbox" checked={otherSets} onChange={(e) => setOtherSets(e.target.checked)} /> Pieces from other sets
        </label>
      </div>
      {plan.slots.map((s) => (
        <SlotSection key={s.slot} s={s} plan={plan} only={otherSets ? null : ownSets(plan)} />
      ))}
    </div>
  )
}

function jump(e: MouseEvent, slot: string) {
  e.preventDefault()
  document.getElementById(`improve-${slot}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function SetLine({ plan }: { plan: ImprovePlan }) {
  const st = plan.status
  const wears =
    st.kind === 'listed'
      ? `4pc ${setName(st.set)} (t${st.tier})`
      : st.kind === 'twoPiece'
        ? `4pc ${setName(st.set)} (2pc only)`
        : st.kind === 'unlisted'
          ? `4pc ${setName(st.set)} (unlisted)`
          : 'No 4pc'
  return (
    <>
      {wears} · farm {plan.targets.map(setName).join(' or ')}
    </>
  )
}

/**
 * Which slot can hold an off-set piece while they keep their 4pc: any one when all five are the set, else the one
 * that isn't. Options in other slots that "use the off-set slot" can't all be taken.
 */
function OffSetLine({ plan }: { plan: ImprovePlan }) {
  const st = plan.status
  if (st.kind === 'none') return null
  const onSet = plan.slots.filter((s) => s.worn?.setKey === st.set).length
  if (onSet < 4) return null
  if (onSet === 5) {
    return (
      <p className="sub-note">All 5 {setName(st.set)}: one slot can go off-set</p>
    )
  }
  const off = plan.slots.find((s) => s.worn?.setKey !== st.set)!
  return (
    <p className="sub-note">
      Off-set slot: {SLOT_ICON[off.slot]} {SLOT_LABEL[off.slot].toLowerCase()}
      {off.worn ? ` (${setName(off.worn.setKey)})` : ' (empty)'}
    </p>
  )
}

const PRIORITY_LABEL: Record<Priority, string> = { priority: '★ Priority', normal: 'Normal', ignore: 'Ignore' }

/** Who counts when judging pieces, as the Roster sets it. */
function PrioritySwitch({ char }: { char: string }) {
  const { roster, setRosterEntry, data, settings } = useStore()
  const fallback = defaultRosterEntry(
    data.characters.find((c) => c.key === char),
    settings.includeUnowned,
  )
  const entry = roster[char] ?? fallback
  return (
    <span className="seg small" role="group" aria-label="Counts" title="Who counts when judging pieces, as in Roster">
      {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
        <button key={p} className={entry.priority === p ? 'on' : ''} onClick={() => setRosterEntry(char, { priority: p }, fallback)}>
          {PRIORITY_LABEL[p]}
        </button>
      ))}
    </span>
  )
}

/** Where an option comes from: free now, someone else's piece, or something to spend. */
type Group = 'free' | 'cost' | 'spend'
const GROUP_LABEL: Record<Group, string> = {
  free: 'Free',
  cost: 'From others',
  spend: 'Spend',
}

/** Their own set: the 4pc they wear, or with none on, the sets the page says new pieces come from. */
const ownSets = (plan: ImprovePlan) => (plan.status.kind === 'none' ? plan.targets : [plan.status.set])

/** Options gaining less than this are folded away with the set-breaking ones. */
const MINOR_GAIN = 0.1

interface Row {
  key: string
  group: Group
  /** A domain or Strongbox: always shown, since their averages are small by nature. */
  source?: boolean
  what: ReactNode
  detail?: ReactNode
  chance: number | null
  gain: number
  cost: ReactNode
  /** Dimmed: it would cost a set bonus or isn't available. */
  dim?: boolean
  /** A piece that would cost a set bonus: folded away below the rest. */
  breaks?: boolean
  /** The set of the piece it puts on (spares, others' pieces, pieces to level, spares to reroll). */
  set?: string
}

/** One slot's options. With `only`, pieces of other sets are left out (and counted under the table). */
function SlotSection({ s, plan, only }: { s: SlotPlan; plan: ImprovePlan; only: string[] | null }) {
  const { equip, equips } = useStore()
  const [showMore, setShowMore] = useState(false)
  const every = slotRows(s, plan, (p) => equip(p.id, plan.ref.char))
  const all = only ? every.filter((r) => !r.set || only.includes(r.set)) : every
  const otherSets = every.length - all.length
  const equippedHere = !!s.worn && equips.some((e) => e.piece === s.worn!.id && e.char === plan.ref.char)
  // Folded until asked for: pieces that would break a set bonus, pieces someone who counts is wearing, small gains.
  const minor = (r: Row) => !r.source && r.gain < MINOR_GAIN
  const folded = (r: Row) => !!r.breaks || r.group === 'cost' || minor(r)
  const hidden = all.filter(folded)
  const visible = showMore ? all : all.filter((r) => !folded(r))
  const groups = (Object.keys(GROUP_LABEL) as Group[])
    .map((g) => [g, visible.filter((r) => r.group === g)] as const)
    .filter(([, rows]) => rows.length)
  const rows = groups.flatMap(([, list]) => list)
  const top = Math.max(0.01, ...rows.filter((r) => !r.dim).map((r) => r.gain))
  const foldedText = [
    hidden.filter((r) => r.group === 'cost' && !r.breaks).length && `${hidden.filter((r) => r.group === 'cost' && !r.breaks).length} from others`,
    hidden.filter((r) => r.breaks).length && `${hidden.filter((r) => r.breaks).length} breaking a set bonus`,
    hidden.filter((r) => !r.breaks && r.group !== 'cost').length &&
      `${hidden.filter((r) => !r.breaks && r.group !== 'cost').length} under ${MINOR_GAIN}`,
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <section className="improve-slot" id={`improve-${s.slot}`}>
      <h3>
        {SLOT_ICON[s.slot]} {SLOT_LABEL[s.slot]}{' '}
        <span className={`qcell ${qualityClass(s.quality)}`}>{s.quality === null ? '–' : `${Math.round(s.quality * 100)}%`}</span>
      </h3>
      <div className="sub-note">
        {s.worn ? (
          <>
            Wears {setName(s.worn.setKey)} · <b>{statShort(s.worn.mainStatKey)}</b> · +{s.worn.level}
            {s.worn.rarity !== 5 && ` · ${s.worn.rarity}★`} — {shortSubs(s.worn)}
            {s.now !== null ? ` (${s.now.toFixed(1)})` : ' (unlisted main)'}
            {equippedHere && <span className="muted"> · equipped since export</span>}
          </>
        ) : (
          'Nothing equipped'
        )}
      </div>
      {rows.length ? (
        <table className="farm-table improve-table">
          <thead>
            <tr>
              <th>Option</th>
              <th title="vs current">Chance</th>
              <th title="Miss = 0">Avg gain</th>
              <th>Cost</th>
            </tr>
          </thead>
          {groups.map(([g, list]) => (
            <tbody key={g}>
              <tr className="group-row">
                <td colSpan={4}>{GROUP_LABEL[g]}</td>
              </tr>
              {list.map((r) => (
                <tr key={r.key} className={r.dim ? 'dim' : ''}>
                  <td>
                    {r.what}
                    {r.detail}
                  </td>
                  <td className="num">{r.chance === null ? '–' : pct(r.chance)}</td>
                  <td className="num gain-cell">
                    <b>{r.gain.toFixed(2)}</b>
                    <span className="gain-bar" style={{ width: `${Math.min(100, (r.gain / top) * 100)}%` }} />
                  </td>
                  <td className="cost">{r.cost}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      ) : (
        <p className="sub-note">Nothing found that beats it.</p>
      )}
      {hidden.length > 0 && (
        <button className="link more" onClick={() => setShowMore(!showMore)}>
          {showMore ? `Fold the ${hidden.length} again` : `Show ${hidden.length} more (${foldedText})`}
        </button>
      )}
      {otherSets > 0 && (
        <p className="sub-note">
          {otherSets} from other sets hidden
        </p>
      )}
    </section>
  )
}

function slotRows(s: SlotPlan, plan: ImprovePlan, equip: (p: Piece) => void): Row[] {
  const rows: Row[] = []
  const name = characterName(plan.ref.char)
  const equipButton = (p: Piece) => (
    <div>
      <button className="link" onClick={() => equip(p)} title="Counted as worn until next export">
        Equip
      </button>
    </div>
  )
  const pieceLine = (o: PieceOption) => (
    <>
      {' '}
      {setName(o.piece.setKey)} · <b>{statShort(o.piece.mainStatKey)}</b>
      <div className="sub-note">{shortSubs(o.piece)}</div>
      <FitNote o={o} plan={plan} />
      <ErChange er={o.er} />
      <ErGainNote gain={o.erGain} er={o.er} />
    </>
  )

  for (const o of s.spares) {
    rows.push({
      key: `spare-${o.piece.id}`,
      group: 'free',
      set: o.piece.setKey,
      what: <span className="opt">Spare +20</span>,
      detail: (
        <>
          {pieceLine(o)}
          {o.claimedBy && (
            <div className="sub-note">Quick wins gives it to {characterName(o.claimedBy)}</div>
          )}
        </>
      ),
      chance: o.chance,
      gain: o.gain,
      cost: (
        <>
          Free
          {equipButton(o.piece)}
        </>
      ),
      dim: o.fit.kind === 'breaks',
      breaks: o.fit.kind === 'breaks',
    })
  }
  for (const o of s.taken) {
    const owner = characterName(o.owner)
    rows.push({
      key: `taken-${o.piece.id}`,
      group: o.ownerActive ? 'cost' : 'free',
      set: o.piece.setKey,
      what: <span className="opt">From {owner}</span>,
      detail: pieceLine(o),
      chance: o.chance,
      gain: o.gain,
      cost: !o.ownerActive ? (
        <>
          {owner} is ignored: free
          {equipButton(o.piece)}
        </>
      ) : (
        <>
          {owner} loses it{o.ownerValue !== null && ` (worth ${o.ownerValue.toFixed(1)} to them)`}
          {o.breaksOwner && <div className="warn">breaks their set bonus</div>}
          {equipButton(o.piece)}
        </>
      ),
      dim: o.fit.kind === 'breaks',
      breaks: o.fit.kind === 'breaks',
    })
  }
  for (const o of s.level) {
    const listed = o.verdict === 'level' || o.verdict === 'continue'
    rows.push({
      key: `level-${o.piece.id}`,
      group: 'spend',
      set: o.piece.setKey,
      what: <span className="opt">Level +{o.piece.level} → +20</span>,
      detail: (
        <>
          {pieceLine(o)}
          <div className={`sub-note${listed ? '' : ' warn'}`}>
            {listed ? 'In To level queue' : `Marked to unlock: lock if leveling for ${name}`}
          </div>
        </>
      ),
      chance: o.chance,
      gain: o.gain,
      cost: 'EXP',
    })
  }
  if (s.reroll && s.reroll.gain > 0.005) {
    const r = s.reroll
    rows.push({
      key: 'reroll',
      group: 'spend',
      what: <span className="opt">Reroll</span>,
      detail: (
        <>
          {' '}
          pick {r.chosen.map(statShort).join(' + ')}
          {r.erBound && <div className="sub-note">keeps needed ER</div>}
          <ErChange er={r.er} approx />
        </>
      ),
      chance: r.chance,
      gain: r.gain,
      cost: `${r.cost} Dust`,
    })
  }
  for (const o of s.spareRerolls) {
    rows.push({
      key: `spare-reroll-${o.piece.id}`,
      group: 'spend',
      set: o.piece.setKey,
      what: <span className="opt">Reroll a spare</span>,
      detail: (
        <>
          {' '}
          {setName(o.piece.setKey)} · <b>{statShort(o.piece.mainStatKey)}</b> ({o.current.toFixed(1)} now), pick{' '}
          {o.chosen.map(statShort).join(' + ')}
          <div className="sub-note">{shortSubs(o.piece)}</div>
          {s.now !== null && o.bar < s.now - 0.05 && (
            <div className="sub-note" title="ER past target: ER lines don't count">
              vs {o.bar.toFixed(1)} worn, ER past target
            </div>
          )}
          <FitNote o={o} plan={plan} />
          {o.erBound && <div className="sub-note">keeps needed ER</div>}
          <ErChange er={o.er} approx />
          {o.claimedBy && <div className="sub-note warn">Quick wins gives it to {characterName(o.claimedBy)}</div>}
        </>
      ),
      chance: o.chance,
      gain: o.gain,
      cost: `${o.cost} Dust`,
    })
  }
  if (s.elixir && s.elixir.gain > 0.005) {
    const e = s.elixir
    rows.push({
      key: 'elixir',
      group: 'spend',
      what: <span className="opt">Sanctifying Elixir</span>,
      detail: (
        <>
          {' '}
          {setName(e.set)} · <b>{statShort(e.main)}</b>, pick {e.chosen.map(statShort).join(' + ')}
          <div className="sub-note">or {runs(e.drops)}</div>
        </>
      ),
      chance: e.chance,
      gain: e.gain,
      cost: `${e.cost} Elixir${e.cost === 1 ? '' : 's'}`,
    })
  }
  for (const [key, label, src, cost, missingWhy] of [
    ['strongbox', 'Strongbox', s.strongbox, `${STRONGBOX_BATCH * 3} five-stars`, "isn't in the Strongbox yet"],
    ['domain', 'Domain', s.domain, `${RESIN_SHOWN} resin`, 'has no domain'],
  ] as const) {
    if (!src) continue
    const usable = src.sets.length > 0
    rows.push({
      key,
      group: 'spend',
      source: true,
      what: <span className="opt">{label}</span>,
      detail: (
        <>
          {' '}
          {key === 'strongbox'
            ? usable && `${STRONGBOX_BATCH} × ${src.sets.map(setName).join(' or ')}`
            : usable && `${src.domains.join(' / ')} (${src.sets.map(setName).join(' or ')})`}
          {src.missing.length > 0 && (
            <div className="sub-note">
              {src.missing.map(setName).join(', ')} {missingWhy}
            </div>
          )}
        </>
      ),
      chance: usable ? src.chance : null,
      gain: src.gain,
      cost,
      dim: !usable,
    })
  }
  return rows
}

function FitNote({ o, plan }: { o: PieceOption; plan: ImprovePlan }) {
  const st = plan.status
  if (o.fit.kind === 'keeps') {
    if (o.fit.trade) return <TradeNote trade={o.fit.trade} />
    if (st.kind === 'none' || o.piece.setKey === st.set) return null
    const allFive = plan.slots.every((x) => x.worn?.setKey === st.set)
    return <div className="sub-note">off-set slot{allFive ? ' (one only)' : ''}</div>
  }
  if (o.fit.kind === 'switch') {
    return <div className="sub-note warn">only with 4pc {setName(o.piece.setKey)} (t{o.fit.tier})</div>
  }
  return <div className="sub-note warn">breaks {setName(o.fit.set)} bonus</div>
}
