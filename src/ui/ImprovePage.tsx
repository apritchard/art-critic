import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { defaultRosterEntry, type ActiveBuild, type EvaluationResult } from '../engine/evaluate'
import { currentBuilds, planFarming, RESIN_SHOWN, STRONGBOX_BATCH, wearing } from '../engine/farm'
import { fourPieceSets } from '../engine/match'
import { improveCharacter, type ImprovePlan, type PieceOption, type SlotPlan } from '../engine/improve'
import type { Piece } from '../engine/load'
import type { Guarantee } from '../engine/reroll'
import { characterName, isPercent, SLOT_LABEL, setName, statShort } from '../engine/stats'
import { useStore } from '../state/store'
import { SLOT_ICON } from './ArtifactCard'
import { EquipLog, ErChange, ErGainNote, erTargetText, runs, TradeNote } from './FarmPage'
import { useLocal } from './local'
import { BuildingToggle, marks } from './marks'
import { buildsHref } from './routes'

const pct = (x: number) => (x > 0 && x < 0.01 ? '<1%' : `${Math.round(x * 100)}%`)
const qualityClass = (q: number | null) => (q === null ? 'q-none' : q >= 0.85 ? 'q-good' : q >= 0.6 ? 'q-ok' : 'q-weak')
const shortSubs = (p: Piece) =>
  p.substats.map((s) => `${statShort(s.key)} ${isPercent(s.key) ? s.value.toFixed(1) : Math.round(s.value)}`).join(' · ')

const GUARANTEE: Record<Guarantee, string> = { 2: 'Normal (2)', 3: 'Advanced (3)', 4: 'Decreed (4)' }

/** What the character rail ranks by: the weakest equipped piece's rating, or the average of all five. */
type RailSort = 'min' | 'avg'
const RAIL_SORT: Record<RailSort, { label: string; title: string }> = {
  min: { label: 'Min', title: 'Weakest equipped piece' },
  avg: { label: 'Avg', title: 'Average of the five equipped pieces (an empty or unusable slot counts as 0%)' },
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

export function ImprovePage({ result, initial }: { result: EvaluationResult; initial?: string }) {
  const { pieces, config } = useStore()
  const [query, setQuery] = useState('')
  const [showInactive, setShowInactive] = useLocal('improve:inactive', false)
  const [sortPick, setSortBy] = useLocal<RailSort>('improve:sort', 'min')
  const sortBy: RailSort = sortPick === 'avg' ? 'avg' : 'min'
  const [selected, setSelected] = useLocal<string>('improve:char', '')
  useEffect(() => {
    if (initial && config.characters[initial]) setSelected(initial)
  }, [initial, config.characters, setSelected])

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
  const rating = (char: string) => ratings.get(char)?.[sortBy] ?? 0

  const chars = useMemo(
    () =>
      result.characters
        .filter((c) => c.owned && (showInactive || c.active))
        .filter((c) => characterName(c.char).toLowerCase().includes(query.toLowerCase()))
        .sort(
          (a, b) =>
            Number(b.building) - Number(a.building) ||
            Number(b.priority === 'priority') - Number(a.priority === 'priority') ||
            (ratings.get(a.char)?.[sortBy] ?? 0) - (ratings.get(b.char)?.[sortBy] ?? 0),
        ),
    [result.characters, showInactive, query, ratings, sortBy],
  )
  const char = config.characters[selected] && result.characters.some((c) => c.char === selected) ? selected : chars[0]?.char

  const pick = (k: string) => {
    setSelected(k)
    location.hash = `#improve/${encodeURIComponent(k)}`
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
              <span className={`counts ${qualityClass(q)}`} title={RAIL_SORT[sortBy].title}>
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
  const refs = useRefs(result, char)
  const worn = useMemo(() => wearing(result, pieces), [result, pieces])
  const wornIdx = useMemo(() => currentBuilds(refs, worn.worn, worn.barsOf, worn.ratingsOf)[0]?.buildIdx ?? 0, [refs, worn])
  const [idx, setIdx] = useState<number | null>(null)
  const ref = refs[idx ?? wornIdx] ?? refs[0]
  // Spares the Farm tab's free upgrades already hand to someone.
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
        <span className="sub-note">
          {owned ? `Lv ${owned.level}` : 'not owned'}
          {plan.er !== null && (
            <span className={plan.need !== null && plan.er < plan.need ? 'warn' : ''}>
              {' '}
              · ER {plan.er.toFixed(0)}%{plan.need !== null && ` (needs ${erTargetText(plan.need, plan.cap)})`}
            </span>
          )}
          {ref.priority === 'ignore' && ' · ignored in Roster'}
        </span>
        <a className="link" href={buildsHref({ char, idx: ref.buildIdx })} title="Change this build's sets, main stats, weights or ER target in the Builds tab">
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
      <EquipLog char={char} />
      <div className="impact">
        {plan.slots.map((s) => (
          <a key={s.slot} href={`#improve/${encodeURIComponent(char)}`} onClick={(e) => jump(e, s.slot)} className={`qcell ${qualityClass(s.quality)}`} title={SLOT_LABEL[s.slot]}>
            {SLOT_ICON[s.slot]} {s.quality === null ? '–' : `${Math.round(s.quality * 100)}%`}
          </a>
        ))}
        <span className="muted">· weakest first</span>
      </div>
      <p className="hint">
        <b>Chance</b> is how likely an option beats what {characterName(char)} wears in that slot; <b>Avg gain</b> is the
        improvement in roll value, counting a miss as no change. Domain odds are per {RESIN_SHOWN} resin, Strongbox odds per
        batch of {STRONGBOX_BATCH}.
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
      </div>
      {plan.slots.map((s) => (
        <SlotSection key={s.slot} s={s} plan={plan} />
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
      ? `Wears 4pc ${setName(st.set)} (tier ${st.tier})`
      : st.kind === 'twoPiece'
        ? `Wears 4pc ${setName(st.set)}, which this build only wants for its 2pc`
        : st.kind === 'unlisted'
          ? `Wears 4pc ${setName(st.set)}, which this build doesn't list`
          : 'No 4pc set on'
  return (
    <>
      {wears} · new pieces from {plan.targets.map(setName).join(' or ')}
    </>
  )
}

interface Row {
  key: string
  what: ReactNode
  detail?: ReactNode
  chance: number | null
  gain: number
  cost: ReactNode
  /** Dimmed: it would cost a set bonus or isn't available. */
  dim?: boolean
  /** A piece that would cost a set bonus: folded away below the rest. */
  breaks?: boolean
}

function SlotSection({ s, plan }: { s: SlotPlan; plan: ImprovePlan }) {
  const { equip, equips } = useStore()
  const [showBreaking, setShowBreaking] = useState(false)
  const all = slotRows(s, plan, (p) => equip(p.id, plan.ref.char))
  const equippedHere = !!s.worn && equips.some((e) => e.piece === s.worn!.id && e.char === plan.ref.char)
  const breaking = all.filter((r) => r.breaks)
  const rows = [...all.filter((r) => !r.breaks), ...(showBreaking ? breaking : [])]
  const top = Math.max(0.01, ...rows.filter((r) => !r.dim).map((r) => r.gain))
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
            {s.now !== null ? ` (${s.now.toFixed(1)})` : ' (main stat not listed for this build)'}
            {equippedHere && <span className="muted"> · equipped since the export</span>}
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
              <th title="Chance it beats what's worn now">Chance</th>
              <th title="Average improvement, counting a miss as no change">Avg gain</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
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
        </table>
      ) : (
        <p className="sub-note">Nothing found that beats it.</p>
      )}
      {breaking.length > 0 && (
        <button className="link more" onClick={() => setShowBreaking(!showBreaking)}>
          {showBreaking ? 'Hide' : 'Show'} {breaking.length} piece{breaking.length === 1 ? '' : 's'} that would break a set bonus
        </button>
      )}
    </section>
  )
}

function slotRows(s: SlotPlan, plan: ImprovePlan, equip: (p: Piece) => void): Row[] {
  const rows: Row[] = []
  const name = characterName(plan.ref.char)
  const equipButton = (p: Piece) => (
    <div>
      <button className="link" onClick={() => equip(p)} title="Equipped it in-game: treat it as worn until your next export">
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
      what: <span className="opt">Spare +20</span>,
      detail: (
        <>
          {pieceLine(o)}
          {o.claimedBy && (
            <div className="sub-note">Free upgrades gives it to {characterName(o.claimedBy)}</div>
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
      what: <span className="opt">Level +{o.piece.level} → +20</span>,
      detail: (
        <>
          {pieceLine(o)}
          <div className={`sub-note${listed ? '' : ' warn'}`}>
            {listed ? 'In the To level queue' : `Marked to unlock: lock it if you level it for ${name}`}
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
      what: <span className="opt">Reroll a spare</span>,
      detail: (
        <>
          {' '}
          {setName(o.piece.setKey)} · <b>{statShort(o.piece.mainStatKey)}</b> ({o.current.toFixed(1)} now), pick{' '}
          {o.chosen.map(statShort).join(' + ')}
          <div className="sub-note">{shortSubs(o.piece)}</div>
          {s.now !== null && o.bar < s.now - 0.05 && (
            <div className="sub-note" title="Their ER is past their target without it, so neither piece's ER line counts, as for a reroll of the worn piece">
              vs {o.bar.toFixed(1)} worn, not counting ER past their target
            </div>
          )}
          <FitNote o={o} plan={plan} />
          {o.erBound && <div className="sub-note">keeps needed ER</div>}
          <ErChange er={o.er} approx />
          {o.claimedBy && <div className="sub-note warn">Free upgrades gives it to {characterName(o.claimedBy)}</div>}
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
      what: <span className="opt">Sanctifying Elixir</span>,
      detail: (
        <>
          {' '}
          {setName(e.set)} · <b>{statShort(e.main)}</b>, pick {e.chosen.map(statShort).join(' + ')}
          <div className="sub-note">Farming instead: {runs(e.drops)} for as big an upgrade</div>
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
    return st.kind !== 'none' && o.piece.setKey !== st.set ? <div className="sub-note">uses the off-set slot</div> : null
  }
  if (o.fit.kind === 'switch') {
    return <div className="sub-note warn">only with 4pc {setName(o.piece.setKey)} (tier {o.fit.tier})</div>
  }
  return <div className="sub-note warn">breaks the {setName(o.fit.set)} set bonus</div>
}
