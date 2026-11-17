import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
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
  type SetTrade,
  type SourceScore,
  type Swap,
  type ToLevel,
} from '../engine/farm'
import { CRAFT_INPUTS, FEED_EXP, planFeedOrBox, type FeedOrBox } from '../engine/fodder'
import { applyEquips, type Piece } from '../engine/load'
import { characterName, isPercent, SLOT_LABEL, setName, statShort } from '../engine/stats'
import { SLOTS, type SlotKey } from '../engine/types'
import { useStore } from '../state/store'
import { SLOT_ICON } from './ArtifactCard'
import { useLocal } from './local'
import { marks } from './marks'
import { Info } from './Info'
import { artifactsHref, charactersHref, inventoryHref, type Resource } from './routes'

const pct = (x: number) => (x > 0 && x < 0.01 ? '<1%' : `${Math.round(x * 100)}%`)
const num = (x: number) => x.toFixed(2)
/** "+0.6" or "−0.1": a swap made for its ER can score lower on substats. */
const signed = (x: number) => `${x < -0.05 ? '−' : '+'}${Math.abs(x).toFixed(1)}`
/** A build's ER target as the app reads it: "110–130%", or "220%" for one number. */
export const erTargetText = (need: number, cap: number | null) => (cap === null || cap === need ? `${need}%` : `${need}–${cap}%`)
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

/** The farming plan for the characters in scope, and what everyone wears. */
function useFarmPlan(result: EvaluationResult, scope: FarmScope) {
  const { pieces, config, domains, er, strongboxSets } = useStore()
  const plan = useMemo(
    () => planFarming(result, pieces, config, domains, scope, er, strongboxSets),
    [result, pieces, config, domains, scope, er, strongboxSets],
  )
  const worn: WornAt = useMemo(
    () => new Map(pieces.filter((p) => p.owner).map((p) => [`${p.owner}|${p.slotKey}`, p])),
    [pieces],
  )
  return { plan, worn }
}

/**
 * The Spend tab's farming views (Dust is the Reroll page): where resin, Strongbox crafts, Elixirs and fodder do most,
 * one at a time, ranked for the characters picked at the top.
 */
export function FarmPage({ result, resource }: { result: EvaluationResult; resource: Exclude<Resource, 'dust'> }) {
  const { domains, data, settings } = useStore()
  // Building by default: farming is usually for whoever you're working on. With nobody on the list it's ★ Priority,
  // as the old default was, so the choice moved to a new key for the new default to apply.
  const [scope, setScope] = useLocal<FarmScope>('farm:for', 'building')
  const { plan, worn } = useFarmPlan(result, scope)
  const feedOrBox = useMemo(
    () => (resource === 'fodder' ? planFeedOrBox(result, plan, data.materials, settings.minUpgradeChance) : null),
    [resource, result, plan, data.materials, settings.minUpgradeChance],
  )
  const domainOf = useMemo(
    () => new Map((domains?.domains ?? []).flatMap((d) => d.sets.map((s) => [s, d.domain] as const))),
    [domains],
  )
  const priorityCount = plan.characters.filter((c) => c.ref.priority === 'priority').length
  const buildingCount = plan.characters.filter((c) => c.ref.building).length
  const scopeLabel =
    plan.scope === 'building' ? '📌 Building characters' : plan.scope === 'priority' ? '★ Priority characters' : 'every active character'
  const resinDrops = (RESIN_SHOWN / RESIN_PER_RUN) * DROPS_PER_RUN

  return (
    <div className="page farm">
      <div className="scope-bar">
        <span className="muted">Rank for</span>
        <div className="seg small">
          <button
            className={scope === 'building' ? 'on' : ''}
            onClick={() => setScope('building')}
            title="Who you're building now: pin characters with 📌 in the Characters tab"
          >
            📌 Building ({buildingCount})
          </button>
          <button className={scope === 'priority' ? 'on' : ''} onClick={() => setScope('priority')}>
            ★ Priority ({priorityCount})
          </button>
          <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>
            All active ({plan.characters.length})
          </button>
        </div>
        {scope === 'building' && plan.scope !== 'building' && (
          <span className="muted">
            Nobody is on the Building list (📌 in the Characters tab), so{' '}
            {plan.scope === 'priority' ? '★ Priority characters count' : 'everyone counts'}.
          </span>
        )}
        {scope === 'priority' && plan.scope === 'all' && (
          <span className="warn">No ★ Priority characters yet (set them in Characters → Roster), so everyone counts.</span>
        )}
      </div>
      <p className="sub-note">
        Gains are in roll value: 1.0 ≈ one max roll of a stat the build fully wants. New pieces are measured against what
        each character wears after the{' '}
        <a href={charactersHref('quick')}>
          {plan.swaps.length} free upgrade{plan.swaps.length === 1 ? '' : 's'}
        </a>{' '}
        in Characters → Quick wins.
      </p>

      {resource === 'resin' && (
        <>
          <Section
            title="Where to spend resin"
            note={`Expected gain from ${RESIN_SHOWN} resin (${RESIN_SHOWN / RESIN_PER_RUN} runs, about ${resinDrops.toFixed(1)} five-star drops), summed over ${scopeLabel}. A domain splits its drops between its two sets. It's the per-drop gain times the drops, so slightly optimistic: a second upgrade to the same slot has to beat the first. Gains assume what each character wears now, so "Level first" flags pieces of those sets you already have to level for them.`}
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
            title="Who gains most from new pieces"
            note="Every active character, by expected gain from one piece of the set they should farm. Chance = how often that piece beats what they wear."
          >
            <Beneficiaries rows={plan.characters} domainOf={domainOf} />
          </Section>
        </>
      )}

      {resource === 'strongbox' && (
        <Section
          title="Strongbox"
          note={`Expected gain from one full batch: ${STRONGBOX_BATCH * 3} five-star pieces in, ${STRONGBOX_BATCH} of the chosen set out. Summed over ${scopeLabel}. Strongbox pieces start with 4 lines more often (34% vs 20%). "Level first" flags pieces of the set you already have to level for those characters.`}
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
      )}

      {resource === 'elixir' && (
        <Section
          title="Sanctifying Elixir"
          note={`One craft per character, ranked per Elixir by what it adds beyond the drops ~${FARM_BUDGET_RUNS} domain runs would likely bring. Easy slots (flower, plume, ATK% sands) rarely win. Assumes 4 starting lines and at least 2 upgrades on the chosen lines; check the set is craftable.`}
        >
          <Elixirs picks={plan.elixirs} worn={worn} />
        </Section>
      )}

      {resource === 'fodder' && feedOrBox && (
        <Section
          title="Feed or box"
          note={`Whether the +0 pieces marked to unlock do more as EXP for the To level queue or as Strongbox input, for ${scopeLabel}. A crafted piece has to be leveled too, so both are compared by expected gain per EXP, counting a craft's ${CRAFT_INPUTS} pieces as the EXP they'd give. Pieces past +0 marked to unlock are always fed: they carry the EXP spent on them.`}
        >
          <FeedOrBoxPanel f={feedOrBox} />
        </Section>
      )}

      {resource === 'fodder' && feedOrBox && (
        <Section
          title="Best pieces to level"
          count={feedOrBox.queue.count}
          note={`The To level queue's unequipped pieces for ${scopeLabel}, best expected gain per EXP first: the order the split above spends EXP on them. Each is leveled for the build it gains most and costs the EXP it's likely to take under the app's rule (level to the next stop, and carry on only while it can still beat the best that character has), so the gain counts only what a finished piece brings. Pieces above the line are what your EXP on hand pays for. Tick one once you've leveled it to its next stop; L does the same in the Artifacts grid.`}
        >
          <LevelQueue queue={feedOrBox.queue} />
        </Section>
      )}
    </div>
  )
}

/**
 * Characters → Quick wins: the free upgrades (spare +20s that beat what someone wears, keeping their set bonuses and
 * ER minimum), with the equips made since the export and a way to take one back.
 */
export function QuickWins({ result }: { result: EvaluationResult }) {
  const { done, toggleDone, equip, er } = useStore()
  const { plan, worn } = useFarmPlan(result, 'all')
  // Swaps ticked before ticks were recorded as equips: record them now, so everything treats them as worn.
  useEffect(() => {
    for (const s of plan.swaps) {
      if (!done.has(`swap:${s.piece.id}`)) continue
      equip(s.piece.id, s.char)
      toggleDone(`swap:${s.piece.id}`, false)
    }
  }, [plan.swaps, done, equip, toggleDone])
  return (
    <div className="page farm">
      <Section
        title="Free upgrades"
        note="Spare +20s that beat what someone wears without breaking a set bonus or dropping their Energy Recharge below their build's minimum. 📌 Building characters come first and get first pick of a spare two people want, then ★ Priority characters, then everyone else, biggest gain first. Tick one once you've equipped it in-game: every tab then treats it as worn until your next export."
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
    </div>
  )
}

/** The next stop to level a piece to: +4, +8, … +20. */
const nextStop = (level: number) => Math.min(20, Math.floor(level / 4) * 4 + 4)

/**
 * Feed or box's queue as a list: the pieces to level next, best gain per EXP first, with a line where the EXP on hand
 * runs out and a tick to mark one leveled.
 */
function LevelQueue({ queue }: { queue: FeedOrBox['queue'] }) {
  const { done, toggleDone } = useStore()
  const { pieces, funded } = queue
  const [shown, more] = useMore(pieces, 15)
  if (!pieces.length) return <p className="sub-note">Nothing in the queue gains these characters anything.</p>
  return (
    <>
      <p className="sub-note">
        {funded === pieces.length
          ? `Your EXP on hand pays for all ${pieces.length}.`
          : funded > 0
            ? `Your EXP on hand pays for the first ${funded} (about ${expText(queue.fundedExp)}); the other ${pieces.length - funded} wait for more.`
            : "Your EXP on hand doesn't reach any of them: the split above spends it on Strongbox crafts first, or there's none."}
      </p>
      <table className="farm-table level-queue">
        <thead>
          <tr>
            <th />
            <th>Piece</th>
            <th>For</th>
            <th title="Chance it ends up beating the best they have, once it reaches +20">Chance</th>
            <th className="num" title="Average improvement once finished, counting a miss or a piece dropped part way as 0">
              Gain
            </th>
            <th className="num" title="EXP it's likely to take before it's finished or dropped">
              EXP
            </th>
            <th className="num" title="Expected gain per 100k EXP: what the list is ranked by">
              Per 100k
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((q, i) => {
            const leveled = done.has(`lvl:${q.piece.id}`)
            return (
              <Fragment key={q.piece.id}>
                {i === funded && funded > 0 && (
                  <tr className="budget-line">
                    <td colSpan={7}>Your EXP on hand runs out here: the pieces below wait for more.</td>
                  </tr>
                )}
                <tr className={[leveled ? 'done' : '', q.funded ? '' : 'unfunded'].filter(Boolean).join(' ')}>
                  <td>
                    <button
                      className={`tick${leveled ? ' on' : ''}`}
                      onClick={() => toggleDone(`lvl:${q.piece.id}`)}
                      title={leveled ? 'Marked leveled: click to undo' : `Leveled it to +${nextStop(q.piece.level)} in-game`}
                    >
                      ✓
                    </button>
                  </td>
                  <td>
                    <span title={SLOT_LABEL[q.piece.slotKey]}>{SLOT_ICON[q.piece.slotKey]}</span> {setName(q.piece.setKey)} ·{' '}
                    <b>{statShort(q.piece.mainStatKey)}</b> · +{q.piece.level} → <b>+{nextStop(q.piece.level)}</b>
                    <div className="sub-note">{shortSubs(q.piece)}</div>
                    <a className="link find" href={inventoryHref(q.piece.id)} title="Show it in the Artifacts grid, outlined, to find it in-game">
                      find in grid
                    </a>
                  </td>
                  <td>
                    <CharName c={{ char: q.ref.char, ref: q.ref }} />
                    <div className="sub-note">{q.ref.build.name}</div>
                  </td>
                  <td className="num">{pct(q.chance)}</td>
                  <td className="num">+{q.gain.toFixed(2)}</td>
                  <td className="num">{expText(q.exp)}</td>
                  <td className="num">
                    <b>{per100k(q.gain / q.exp)}</b>
                  </td>
                </tr>
              </Fragment>
            )
          })}
        </tbody>
      </table>
      {more}
    </>
  )
}

/** EXP as "9.2M", "186k" or "940". */
const expText = (x: number) => (x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `${Math.round(x / 1e3)}k` : `${Math.round(x)}`)
/** Gain per EXP, in rolls per 100k EXP. */
const per100k = (rate: number) => (rate * 1e5).toFixed(2)
/** The bar runs to 2^BAR_SPAN (8×) each way. */
const BAR_SPAN = 3

/** Where the +0 tosses do more, as a marker between feeding and boxing, and how many of each. */
function FeedOrBoxPanel({ f }: { f: FeedOrBox }) {
  if (!f.tosses) return <p className="sub-note">No +0 pieces are marked to unlock, so there&apos;s nothing to feed or box.</p>
  const times = (r: number) => (r >= 10 ? `${Math.round(r)}` : r.toFixed(1))
  const { ratio } = f
  const lean = Math.min(BAR_SPAN, Math.max(-BAR_SPAN, Math.log2(Math.max(ratio, 2 ** -BAR_SPAN))))
  const pos = 50 + (lean / BAR_SPAN) * 50
  const label =
    ratio === Infinity
      ? 'box: EXP to spare'
      : ratio === 0
        ? 'feed: nothing worth boxing'
        : Math.abs(ratio - 1) < 1e-9
          ? 'even'
          : ratio > 1
            ? `${times(ratio)}× box`
            : `${times(1 / ratio)}× feed`
  const align = pos < 12 ? 'start' : pos > 88 ? 'end' : ''
  const title = [
    f.bestCraft
      ? `Best craft: ${setName(f.bestCraft.set)}, ${per100k(f.bestCraft.rate)} rolls per 100k EXP (its ${CRAFT_INPUTS} pieces count as the ${expText(CRAFT_INPUTS * FEED_EXP)} EXP they'd give, and leveling what comes out takes ${expText(f.bestCraft.levelExp)} on average, since most are dropped at +0 or +4).`
      : f.tosses < CRAFT_INPUTS
        ? `Too few +0s for a Strongbox craft, which takes ${CRAFT_INPUTS}.`
        : `No Strongbox craft would add enough to be worth its ${CRAFT_INPUTS} pieces.`,
    f.price > 0
      ? `The best use your EXP can't pay for: ${per100k(f.price)} rolls per 100k EXP.`
      : 'Your EXP covers everything worth leveling.',
  ].join(' ')
  const crafts = f.box / CRAFT_INPUTS
  const sets = f.crafts.map((c) => `${c.count} ${setName(c.set)}`).join(', ')
  return (
    <div className="feedbox">
      <div className="feedbox-bar" title={title} role="img" aria-label={`Feed or box: ${label}`}>
        <span className="feedbox-mid" />
        <span className={`feedbox-label ${align}`} style={{ left: `${pos}%` }}>
          {label}
        </span>
        <span className="feedbox-marker" style={{ left: `${pos}%` }} />
      </div>
      <div className="feedbox-scale">
        <span>Feed: 8×</span>
        <span>even</span>
        <span>Box: 8×</span>
      </div>
      <p className="feedbox-advice">
        {f.box ? (
          <>
            Box <b>{f.box.toLocaleString()}</b> of the {f.tosses.toLocaleString()} ({crafts} craft{crafts === 1 ? '' : 's'}: {sets})
            {f.feed > 0 && (
              <>
                , then feed the other <b>{f.feed.toLocaleString()}</b>
              </>
            )}
            .{' '}
            {f.feed >= CRAFT_INPUTS &&
              (f.price > 0
                ? 'Past that, a craft gains less than the EXP it would take from the Level up queue.'
                : 'Past that, more crafts would add almost nothing.')}
          </>
        ) : (
          <>
            Feed all <b>{f.tosses.toLocaleString()}</b>:{' '}
            {f.tosses < CRAFT_INPUTS
              ? `a Strongbox craft takes ${CRAFT_INPUTS}.`
              : !f.bestCraft
                ? `no Strongbox craft would add enough to be worth its ${CRAFT_INPUTS} pieces${f.price > 0 ? '' : ', and your EXP already covers everything worth leveling'}.`
                : ratio < 1
                  ? `even the best craft, ${setName(f.bestCraft.set)}, gains less per EXP than the Level up queue.`
                  : `the best craft, ${setName(f.bestCraft.set)}, would do about as well per EXP as the Level up queue, but your EXP runs out first.`}
          </>
        )}
      </p>
      <p className="sub-note">
        EXP on hand: {f.materials === null ? 'materials aren’t in this export, so they’re not counted' : `${expText(f.materials)} in materials`},{' '}
        {expText(f.leveled.exp)} from {f.leveled.count} leveled piece{f.leveled.count === 1 ? '' : 's'} marked to unlock, and{' '}
        {expText(f.tosses * FEED_EXP)} if every +0 is fed.
        {f.committed > 0 && ` Finishing equipped pieces takes ${expText(f.committed)} of it first.`} The Level up queue&apos;s{' '}
        {f.queue.count} pieces would take about {expText(f.queue.exp)} to play out
        {f.queue.funded < f.queue.count
          ? `; this split pays for the ${f.queue.funded} that gain most per EXP (${expText(f.queue.fundedExp)}).`
          : `, and this split pays for all of them${f.left >= 1000 ? `, with ${expText(f.left)} to spare` : ''}.`}
      </p>
    </div>
  )
}

/** A titled section whose explanation folds away behind ⓘ (remembered per section). */
function Section({ title, note, count, children }: { title: string; note: string; count?: number; children: ReactNode }) {
  const heading = (
    <h2>
      {title}
      {count !== undefined && <span className="badge">{count}</span>}
    </h2>
  )
  return (
    <section className="section">
      <Info id={title} heading={heading}>
        {note}
      </Info>
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
            <th title="Substat value of the worn piece → the spare, for this character's build. Where their total ER is known, ER lines are left out here and the change in the total is counted below.">
              Now → spare
            </th>
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
                  <TradeNote trade={s.trade} />
                  <ErChange er={s.er} />
                </td>
                <td className="num">
                  <Now char={s.char} slot={s.slot} value={s.from} worn={worn} /> → <b>{s.to.toFixed(1)}</b>
                  <div className="sub-note">{signed(s.to - (s.from ?? 0))}</div>
                  <ErGainNote gain={s.erGain} er={s.er} />
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
                <ToLevelNote list={s.toLevel} named={s.sets.length > 1} />
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

/**
 * Pieces of a source's sets already on hand and still to level for the characters it helps. The gain assumes what
 * they wear now, so these come first. Pieces marked leveled count once a new export shows them at +20.
 */
function ToLevelNote({ list, named }: { list: ToLevel[]; named: boolean }) {
  const { done } = useStore()
  if (!list.length) return null
  const pending = list.filter((t) => !done.has(`lvl:${t.piece.id}`))
  const marked = list.length - pending.length
  const bySet = new Map<string, number>()
  for (const t of pending) bySet.set(t.piece.setKey, (bySet.get(t.piece.setKey) ?? 0) + 1)
  const pieces = (n: number) => `${n} piece${n === 1 ? '' : 's'}`
  // A domain row names the set, since it drops two.
  const what = named ? [...bySet].map(([set, n]) => `${n} ${setName(set)}`).join(' and ') : pieces(pending.length)
  const title = pending
    .map(
      (t) =>
        `${setName(t.piece.setKey)} ${SLOT_LABEL[t.piece.slotKey].toLowerCase()} · ${statShort(t.piece.mainStatKey)} +${t.piece.level} · for ${t.chars.map(characterName).join(', ')}`,
    )
    .join('\n')
  return (
    <div className="sub-note warn" title={title}>
      {pending.length > 0 && (
        <>
          Level first: {what} on hand for them (
          <a href={artifactsHref({ view: 'list', show: 'level', level: 'any', set: bySet.size === 1 ? [...bySet.keys()][0] : 'all' })}>
            to level
          </a>
          )
        </>
      )}
      {pending.length > 0 && marked > 0 && ' · '}
      {marked > 0 && `${pieces(marked)} marked leveled: re-export so they count`}
    </div>
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
        // Who you're building comes first, as everywhere.
        .sort(
          (a, b) =>
            Number(!!b.ref.building) - Number(!!a.ref.building) ||
            (sort === 'name'
              ? characterName(a.char).localeCompare(characterName(b.char))
              : sort === 'chance'
                ? b.odds.chance - a.odds.chance
                : b.odds.gain - a.odds.gain),
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

/** "Trades the Gladiator's Finale 2pc for the Celestial Gift 2pc", for a swap that gives up a set bonus. */
export function TradeNote({ trade }: { trade: SetTrade | null | undefined }) {
  if (!trade?.lost.length) return null
  const list = (bonuses: SetTrade['lost']) => bonuses.map((b) => `${setName(b.set)} ${b.pieces}pc`).join(' and the ')
  return (
    <div className="sub-note" title="Still a set combination this build lists (Builds tab)">
      {trade.gained.length
        ? `Trades the ${list(trade.lost)} for the ${list(trade.gained)}`
        : `Gives up the ${list(trade.lost)}, which this build doesn't need`}
    </div>
  )
}

/** The part of a gain that comes from the change in the character's total ER (see erChangeValue). */
export function ErGainNote({ gain, er }: { gain: number; er: ErTotals | null | undefined }) {
  if (Math.abs(gain) < 0.05 || er?.cap == null) return null
  const title = "ER counts at the build's ER weight up to its target (6.48% = one max roll) and nothing past it"
  return gain > 0 ? (
    <div className="sub-note good" title={title}>
      +{gain.toFixed(1)} for ER toward {er.cap}%
    </div>
  ) : (
    <div className="sub-note warn" title={title}>
      −{Math.abs(gain).toFixed(1)} for ER lost under {er.cap}%
    </div>
  )
}

interface ErTotals {
  from: number
  to: number
  need: number | null
  cap?: number | null
}

/** A character's total ER before → after a change (`approx`: on average), when it moves. */
export function ErChange({ er, approx }: { er: ErTotals | null; approx?: boolean }) {
  if (!er || Math.abs(er.to - er.from) < 0.5) return null
  // Red when it takes them (further) below their build's minimum.
  const short = er.need !== null && er.to < er.need && er.to < er.from
  return (
    <div className={`sub-note${short ? ' warn' : ''}`} title="Total Energy Recharge: base, ascension, weapon, artifacts and 2pc bonuses">
      ER {er.from.toFixed(0)}% → {approx && '~'}
      {er.to.toFixed(0)}%{er.need !== null && <span className="muted"> (needs {erTargetText(er.need, er.cap ?? null)})</span>}
    </div>
  )
}

/** A character's name, linking to them in the Characters tab, with their 📌 and ★ marks. */
function CharName({ c }: { c: { char: string; ref: { priority: string; building?: boolean } } }) {
  return (
    <span className="char-name">
      <a className="char-link" href={charactersHref({ char: c.char })} title="Every way to improve their pieces">
        {characterName(c.char)}
      </a>
      {marks(c.ref)}
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
      <span className="warn">
        {s.kind === 'twoPiece'
          ? `4pc ${setName(s.set)} (build wants its 2pc)`
          : s.kind === 'unlisted'
            ? `4pc ${setName(s.set)} (not in build)`
            : 'No 4pc bonus'}
      </span>
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
