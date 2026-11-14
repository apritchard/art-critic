import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { EvaluationResult } from '../engine/evaluate'
import {
  DROPS_PER_RUN,
  FARM_BUDGET_RUNS,
  MAX_DROPS,
  ON_SET_DROPS_PER_RUN,
  planFarming,
  RESIN_PER_RUN,
  RESIN_SHOWN,
  STRONGBOX_BATCH,
  type CharacterFarm,
  type Contribution,
  type ElixirPick,
  type FarmScope,
  type SourceScore,
  type Swap,
} from '../engine/farm'
import { applyEquips, type Piece } from '../engine/load'
import { characterName, isPercent, SLOT_LABEL, setName, statShort } from '../engine/stats'
import { SLOTS, type SlotKey } from '../engine/types'
import { useStore } from '../state/store'
import { SLOT_ICON } from './ArtifactCard'
import { useLocal } from './local'

const pct = (x: number) => (x > 0 && x < 0.01 ? '<1%' : `${Math.round(x * 100)}%`)
const num = (x: number) => x.toFixed(2)
type WornAt = Map<string, Piece>

/** What a slot is worth now; when it counts as nothing, say why. */
function Now({ char, slot, value, worn }: { char: string; slot: SlotKey; value: number | null; worn: WornAt }) {
  if (value !== null) return <>{value.toFixed(1)}</>
  const p = worn.get(`${char}|${slot}`)
  if (!p) return <span className="warn">empty</span>
  if (p.rarity !== 5) return <span className="warn">{p.rarity}★</span>
  return (
    <span className="warn" title="The build doesn't list this main stat for the slot">
      {statShort(p.mainStatKey)} main ✗
    </span>
  )
}

const shortSubs = (p: Piece) =>
  p.substats.map((s) => `${statShort(s.key)} ${isPercent(s.key) ? s.value.toFixed(1) : Math.round(s.value)}`).join(' · ')

export function FarmPage({ result }: { result: EvaluationResult }) {
  const { pieces, config, domains, er, strongboxSets, done, toggleDone, equip } = useStore()
  const [scope, setScope] = useLocal<FarmScope>('farm:scope', 'priority')
  const plan = useMemo(
    () => planFarming(result, pieces, config, domains, scope, er, strongboxSets),
    [result, pieces, config, domains, scope, er, strongboxSets],
  )
  const worn: WornAt = useMemo(
    () => new Map(pieces.filter((p) => p.owner).map((p) => [`${p.owner}|${p.slotKey}`, p])),
    [pieces],
  )
  const domainOf = useMemo(
    () => new Map((domains?.domains ?? []).flatMap((d) => d.sets.map((s) => [s, d.domain] as const))),
    [domains],
  )
  // Swaps ticked before ticks were recorded as equips: record them now, so everything treats them as worn.
  useEffect(() => {
    for (const s of plan.swaps) {
      if (!done.has(`swap:${s.piece.id}`)) continue
      equip(s.piece.id, s.char)
      toggleDone(`swap:${s.piece.id}`, false)
    }
  }, [plan.swaps, done, equip, toggleDone])
  const priorityCount = plan.characters.filter((c) => c.ref.priority === 'priority').length
  const scopeLabel = plan.scope === 'priority' ? '★ Priority characters' : 'every active character'
  const resinDrops = (RESIN_SHOWN / RESIN_PER_RUN) * DROPS_PER_RUN

  return (
    <div className="page farm">
      <p className="hint">
        Gains are in roll value: 1.0 ≈ one max roll of a stat the build fully wants. New pieces are measured against what
        each character wears, after the free swaps below.
      </p>

      <Section
        title="Free upgrades"
        note="Spare +20s that beat what someone wears without breaking a set bonus or dropping their Energy Recharge below their build's minimum. ★ Priority characters come first and get first pick of a spare two people want; then everyone else, biggest gain first. Tick one once you've equipped it in-game: every tab then treats it as worn until your next export."
        count={plan.swaps.length}
      >
        <EquipLog />
        <Swaps swaps={plan.swaps} worn={worn} equip={(s) => equip(s.piece.id, s.char)} />
        {plan.erHeld > 0 && (
          <p className="sub-note">
            {plan.erHeld} more held back: they&apos;d take someone below their build&apos;s ER minimum (set in Builds).
          </p>
        )}
        {!er && <p className="sub-note warn">No weapon data (data/game-data.json), so ER isn&apos;t checked.</p>}
      </Section>

      <div className="scope-bar">
        <span className="muted">Rank resin, Strongbox and Elixirs for</span>
        <div className="seg small">
          <button className={scope === 'priority' ? 'on' : ''} onClick={() => setScope('priority')}>
            ★ Priority ({priorityCount})
          </button>
          <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>
            All active ({plan.characters.length})
          </button>
        </div>
        {scope === 'priority' && plan.scope === 'all' && (
          <span className="warn">No ★ Priority characters yet (set them in Roster), so everyone counts.</span>
        )}
      </div>

      <Section
        title="Where to spend resin"
        note={`Expected gain from ${RESIN_SHOWN} resin (${RESIN_SHOWN / RESIN_PER_RUN} runs, about ${resinDrops.toFixed(1)} five-star drops), summed over ${scopeLabel}. A domain splits its drops between its two sets. It's the per-drop gain times the drops, so slightly optimistic: a second upgrade to the same slot has to beat the first.`}
      >
        {domains ? (
          <>
            <SourceTable
              rows={plan.domains}
              label="Domain"
              per={resinDrops}
              unit={`per ${RESIN_SHOWN} resin`}
              describe={(d) => `${d.region} · ${d.sets.map(setName).join(' / ')}`}
            />
            {plan.noDomain.length > 0 && (
              <p className="sub-note">
                Not from any domain (Strongbox or bosses only): {plan.noDomain.map(setName).join(', ')}.
              </p>
            )}
          </>
        ) : (
          <p className="warn">Add genshin_artifact_domains.json next to the config to rank domains.</p>
        )}
      </Section>

      <Section
        title="Strongbox"
        note={`Expected gain from one full batch: ${STRONGBOX_BATCH * 3} five-star pieces in, ${STRONGBOX_BATCH} of the chosen set out. Summed over ${scopeLabel}. Strongbox pieces start with 4 lines more often (34% vs 20%).`}
      >
        <SourceTable
          rows={plan.strongbox}
          label="Set"
          name={setName}
          per={STRONGBOX_BATCH}
          unit={`per batch of ${STRONGBOX_BATCH}`}
          describe={(s) => domainOf.get(s.key) ?? 'no domain'}
        />
        {plan.noStrongbox.length > 0 && (
          <p className="sub-note">Not in the Strongbox yet: {plan.noStrongbox.map(setName).join(', ')}.</p>
        )}
        <StrongboxSets />
      </Section>

      <Section
        title="Sanctifying Elixir"
        note={`One craft per character, ranked per Elixir by what it adds beyond the drops ~${FARM_BUDGET_RUNS} domain runs would likely bring. Easy slots (flower, plume, ATK% sands) rarely win. Assumes 4 starting lines and at least 2 upgrades on the chosen lines; check the set is craftable.`}
      >
        <Elixirs picks={plan.elixirs} worn={worn} />
      </Section>

      <Section
        title="Who gains most from new pieces"
        note="Every active character, by expected gain from one piece of the set they should farm. Chance = how often that piece beats what they wear."
      >
        <Beneficiaries rows={plan.characters} domainOf={domainOf} />
      </Section>
    </div>
  )
}

function Section({ title, note, count, children }: { title: string; note: string; count?: number; children: ReactNode }) {
  return (
    <section className="section">
      <h2>
        {title}
        {count !== undefined && <span className="badge">{count}</span>}
      </h2>
      <p className="hint">{note}</p>
      {children}
    </section>
  )
}

/** Shows the first few rows with a toggle for the rest. */
function useMore<T>(rows: T[], first: number): [T[], ReactNode] {
  const [all, setAll] = useState(false)
  const toggle =
    rows.length > first ? (
      <button className="link more" onClick={() => setAll(!all)}>
        {all ? 'Show fewer' : `Show all ${rows.length}`}
      </button>
    ) : null
  return [all ? rows : rows.slice(0, first), toggle]
}

/** Equips recorded since the export, with what each replaced, and a way to take one back. */
export function EquipLog({ char }: { char?: string }) {
  const { equips, exportPieces, undoEquip } = useStore()
  // Each equip as it happened: where the piece was, and what the character wore, after the equips before it.
  const steps = useMemo(() => {
    let state = exportPieces
    return equips.map((e, at) => {
      const before = state
      state = applyEquips(state, [e])
      const p = before.find((q) => q.id === e.piece)
      const was = p && before.find((q) => q.owner === e.char && q.slotKey === p.slotKey)
      return { e, at, p, was }
    })
  }, [equips, exportPieces])
  const list = steps.filter(({ e }) => !char || e.char === char)
  if (!list.length) return null
  return (
    <div className="equip-log">
      <span className="muted">Equipped since this export (counted as worn until your next export):</span>
      {list.map(({ e, at, p, was }) => {
        if (!p) return null
        return (
          <div key={at} className="equip-row">
            <span title={SLOT_LABEL[p.slotKey]}>{SLOT_ICON[p.slotKey]}</span> <b>{characterName(e.char)}</b> ←{' '}
            {setName(p.setKey)} · {statShort(p.mainStatKey)}
            {p.owner && <span className="muted"> (from {characterName(p.owner)})</span>}
            {was && (
              <span className="muted">
                {' '}
                · was {setName(was.setKey)} · {statShort(was.mainStatKey)}
              </span>
            )}
            <button className="link" onClick={() => undoEquip(at)}>
              undo
            </button>
          </div>
        )
      })}
    </div>
  )
}

function Swaps({ swaps, worn, equip }: { swaps: Swap[]; worn: WornAt; equip: (s: Swap) => void }) {
  const [shown, more] = useMore(swaps, 10)
  if (!swaps.length) return <p className="sub-note">None: no spare beats what anyone wears.</p>
  return (
    <>
      <table className="farm-table">
        <thead>
          <tr>
            <th />
            <th>Character</th>
            <th>Spare</th>
            <th title="Value of the worn piece → the spare, for this character's build">Now → spare</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((s) => {
            return (
              <tr key={s.piece.id}>
                <td>
                  <button className="tick" onClick={() => equip(s)} title="Equipped it in-game: treat it as worn from now on">
                    ✓
                  </button>
                </td>
                <td>
                  <CharName c={s} />
                  <div className="sub-note">{s.ref.build.name}</div>
                </td>
                <td>
                  <span title={SLOT_LABEL[s.slot]}>{SLOT_ICON[s.slot]}</span> {setName(s.piece.setKey)} ·{' '}
                  <b>{statShort(s.piece.mainStatKey)}</b>
                  <div className="sub-note">{shortSubs(s.piece)}</div>
                  {s.mainFrom && (
                    <div className="sub-note warn" title="Scores compare substats only, so this trade isn't weighed: check it in-game">
                      Main stat changes: {statShort(s.mainFrom)} → {statShort(s.piece.mainStatKey)}
                    </div>
                  )}
                  <ErChange er={s.er} />
                </td>
                <td className="num">
                  <Now char={s.char} slot={s.slot} value={s.from} worn={worn} /> → <b>{s.to.toFixed(1)}</b>
                  <div className="sub-note">+{(s.to - (s.from ?? 0)).toFixed(1)}</div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {more}
    </>
  )
}

/** Sources ranked by gain; `per` scales the per-piece values to the amount named by `unit`. */
function SourceTable({
  rows,
  label,
  name = (k) => k,
  per,
  unit,
  describe,
}: {
  rows: SourceScore[]
  label: string
  name?: (key: string) => string
  per: number
  unit: string
  describe: (s: SourceScore) => string
}) {
  const [shown, more] = useMore(rows, 6)
  if (!rows.length || rows[0].value === 0) return <p className="sub-note">Nothing here helps the characters in scope.</p>
  return (
    <>
      <table className="farm-table">
        <thead>
          <tr>
            <th>{label}</th>
            <th>
              Gain <span className="sub-note">{unit}</span>
            </th>
            <th>Who it helps</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((s) => (
            <tr key={s.key}>
              <td>
                {name(s.key)}
                <div className="sub-note">{describe(s)}</div>
              </td>
              <td className="num">{num(s.value * per)}</td>
              <td>
                <Contributors list={s.contributors} per={per} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {more}
    </>
  )
}

function Contributors({ list, per }: { list: Contribution[]; per: number }) {
  const [open, setOpen] = useState(false)
  if (!list.length) return <span className="sub-note">–</span>
  const shown = open ? list : list.slice(0, 4)
  return (
    <span className="who">
      {shown.map((c) => (
        <span key={`${c.char}|${c.set}`} className="chance in" title={setName(c.set)}>
          {characterName(c.char)} <b>{num(c.value * per)}</b>
        </span>
      ))}
      {list.length > 4 && (
        <button className="chance out more-chip" onClick={() => setOpen(!open)}>
          {open ? 'less' : `+${list.length - 4} more`}
        </button>
      )}
    </span>
  )
}

/** Which sets the Strongbox can make: a guess from the domains file until edited. */
function StrongboxSets() {
  const { config, domains, strongboxSets, strongboxEdited, setStrongboxSets } = useStore()
  const [open, setOpen] = useState(false)
  // Grouped by region in release order, newest first, since those are the ones that change.
  const groups = useMemo(() => {
    const byRegion = new Map<string, string[]>()
    for (const d of domains?.domains ?? []) byRegion.set(d.region, [...(byRegion.get(d.region) ?? []), ...d.sets])
    const inDomain = new Set([...byRegion.values()].flat())
    const other = Object.keys(config.sets).filter((s) => !inDomain.has(s))
    return [...(other.length ? [['No domain', other] as const] : []), ...[...byRegion].reverse()]
  }, [config.sets, domains])
  const has = (set: string) => !strongboxSets || strongboxSets.has(set)
  const toggle = (set: string) => {
    const next = new Set(strongboxSets ?? Object.keys(config.sets))
    if (next.has(set)) next.delete(set)
    else next.add(set)
    setStrongboxSets([...next].sort())
  }
  const off = Object.keys(config.sets).filter((s) => !has(s)).length
  return (
    <div className="strongbox-sets">
      <button className="link" onClick={() => setOpen(!open)}>
        {open ? 'Hide' : 'Edit'} which sets the Strongbox can make ({off} left out
        {strongboxEdited ? ', edited' : ', the in-game list as of 7.2'})
      </button>
      {open && (
        <>
          {groups.map(([region, sets]) => (
            <div key={region} className="sb-region">
              <span className="sb-region-name">{region}</span>
              {sets.map((set) => (
                <label key={set} className="check">
                  <input type="checkbox" checked={has(set)} onChange={() => toggle(set)} /> {setName(set)}
                </label>
              ))}
            </div>
          ))}
          {strongboxEdited && (
            <button className="ghost small" onClick={() => setStrongboxSets(null)}>
              Back to the guess
            </button>
          )}
        </>
      )}
    </div>
  )
}

/** On-set drops as domain runs, rounded the way you'd say it. */
export function runs(drops: number): string {
  const r = drops / ON_SET_DROPS_PER_RUN
  const step = r < 100 ? 1 : r < 1000 ? 10 : 100
  const n = (Math.round(r / step) * step).toLocaleString()
  return drops >= MAX_DROPS ? `${n}+ runs` : `≈ ${n} runs`
}

function Elixirs({ picks, worn }: { picks: ElixirPick[]; worn: WornAt }) {
  const [shown, more] = useMore(picks, 8)
  if (!picks.length) return <p className="sub-note">No craft would beat what anyone in scope wears.</p>
  return (
    <>
      <table className="farm-table">
        <thead>
          <tr>
            <th>Character</th>
            <th>Craft</th>
            <th title="Value of what they wear in that slot now">Now</th>
            <th title="Expected gain once leveled to +20, and the chance it beats what they wear">Gain</th>
            <th title={`Domain runs it takes on average to expect as big an upgrade in this slot (${FARM_BUDGET_RUNS} runs' worth is credited to farming)`}>
              Farming instead
            </th>
            <th title="Elixirs per craft">Cost</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((e) => (
            <tr key={e.char}>
              <td>{characterName(e.char)}</td>
              <td>
                <span title={SLOT_LABEL[e.slot]}>{SLOT_ICON[e.slot]}</span> {setName(e.set)} · <b>{statShort(e.main)}</b>
                <div className="sub-note">choose {e.chosen.map(statShort).join(' + ')}</div>
              </td>
              <td className="num">
                <Now char={e.char} slot={e.slot} value={e.from} worn={worn} />
              </td>
              <td className="num">
                {num(e.gain)}
                <div className="sub-note">{pct(e.chance)} upgrade</div>
              </td>
              <td className="num">{runs(e.drops)}</td>
              <td className="num">{e.cost}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {more}
    </>
  )
}

type BenefitSort = 'gain' | 'chance' | 'name'

function Beneficiaries({ rows, domainOf }: { rows: CharacterFarm[]; domainOf: Map<string, string> }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useLocal<BenefitSort>('farm:sort', 'gain')
  const sorted = useMemo(
    () =>
      rows
        .filter((c) => characterName(c.char).toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) =>
          sort === 'name'
            ? characterName(a.char).localeCompare(characterName(b.char))
            : sort === 'chance'
              ? b.odds.chance - a.odds.chance
              : b.odds.gain - a.odds.gain,
        ),
    [rows, query, sort],
  )
  const [shown, more] = useMore(sorted, 25)
  return (
    <>
      <div className="roster-tools">
        <input placeholder="Search characters…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="seg small">
          {(['gain', 'chance', 'name'] as const).map((s) => (
            <button key={s} className={sort === s ? 'on' : ''} onClick={() => setSort(s)}>
              {s === 'gain' ? 'Gain' : s === 'chance' ? 'Chance' : 'Name'}
            </button>
          ))}
        </div>
      </div>
      <table className="farm-table">
        <thead>
          <tr>
            <th>Character</th>
            <th>Wears</th>
            <th title="Chance one on-set domain piece beats what they wear">Chance</th>
            <th title="Expected gain per on-set domain piece">Gain</th>
            <th title="Where that gain comes from">Weak spots</th>
            <th>Farm</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((c) => (
            <tr key={c.char}>
              <td>
                <CharName c={c} />
                <div className="sub-note">
                  {c.ref.build.name}
                  {c.kept > 0 && ` · ${c.kept} queued to level`}
                </div>
              </td>
              <td>
                <SetStatusCell c={c} />
              </td>
              <td className="num">{pct(c.odds.chance)}</td>
              <td className="num">{num(c.odds.gain)}</td>
              <td>
                <WeakSpots c={c} />
              </td>
              <td>
                {c.targets.map((s) => (
                  <div key={s}>
                    {setName(s)}
                    <div className="sub-note">{domainOf.get(s) ?? 'no domain'}</div>
                  </div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {more}
    </>
  )
}

/** A character's total ER before → after a change (`approx`: on average), when it moves. */
export function ErChange({ er, approx }: { er: { from: number; to: number; need: number | null } | null; approx?: boolean }) {
  if (!er || Math.abs(er.to - er.from) < 0.5) return null
  // Red when it takes them (further) below their build's minimum.
  const short = er.need !== null && er.to < er.need && er.to < er.from
  return (
    <div className={`sub-note${short ? ' warn' : ''}`} title="Total Energy Recharge: base, ascension, weapon, artifacts and 2pc bonuses">
      ER {er.from.toFixed(0)}% → {approx && '~'}
      {er.to.toFixed(0)}%{er.need !== null && <span className="muted"> (needs {er.need}%)</span>}
    </div>
  )
}

function CharName({ c }: { c: { char: string; ref: { priority: string } } }) {
  return (
    <span className="char-name">
      {characterName(c.char)}
      {c.ref.priority === 'priority' && ' ★'}
    </span>
  )
}

function SetStatusCell({ c }: { c: CharacterFarm }) {
  const s = c.status
  const spares = c.spares && c.spares.slots > 0 && (
    <div className={`sub-note${c.spares.slots >= 4 ? ' good' : ''}`}>
      {setName(c.spares.set)}: {c.spares.slots}/5 slots in spares
    </div>
  )
  if (s.kind === 'listed') {
    return (
      <>
        4pc {setName(s.set)} <span className="tier">t{s.tier}</span>
        {spares}
      </>
    )
  }
  return (
    <>
      <span className="warn">{s.kind === 'unlisted' ? `4pc ${setName(s.set)} (not in build)` : 'No 4pc bonus'}</span>
      {spares}
    </>
  )
}

function WeakSpots({ c }: { c: CharacterFarm }) {
  if (c.odds.gain <= 0) return <span className="sub-note">–</span>
  const top = SLOTS.filter((s) => c.odds.slots[s].gain > 0)
    .sort((a, b) => c.odds.slots[b].gain - c.odds.slots[a].gain)
    .slice(0, 2)
  return (
    <span>
      {top.map((s) => (
        <span
          key={s}
          className="spot"
          title={`${SLOT_LABEL[s]}: ${pct(c.odds.slots[s].gain / c.odds.gain)} of the gain${c.bars[s] === null ? '. Nothing usable worn there (empty, 4★ or wrong main stat)' : ''}`}
        >
          {SLOT_ICON[s]} {pct(c.odds.slots[s].gain / c.odds.gain)}
          {c.bars[s] === null && <span className="warn"> (none)</span>}
        </span>
      ))}
    </span>
  )
}
