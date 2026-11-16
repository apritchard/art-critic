import { useMemo, useState } from 'react'
import type { EvaluationResult } from '../engine/evaluate'
import { HIGH_PRIORITY_GAIN, PRIORITY_STEPS, rerollPriority } from '../engine/inventory'
import { planRerolls, upgradeCounts, type Guarantee, type RerollOption } from '../engine/reroll'
import { characterName, isPercent, SLOT_LABEL, setName, statShort } from '../engine/stats'
import { useStore } from '../state/store'
import { SLOT_ICON } from './ArtifactCard'
import { ErChange } from './FarmPage'
import { useLocal } from './local'
import { marks } from './marks'
import { inventoryHref } from './routes'

const pct = (x: number) => (x > 0 && x < 0.01 ? '<1%' : `${Math.round(x * 100)}%`)

export const GUARANTEE: Record<Guarantee, string> = { 2: 'Normal (2)', 3: 'Advanced (3)', 4: 'Decreed (4)' }

/** The guaranteed upgrades picked at the top of this tab, which the Inventory's ⟳ badges use too. */
export const useGuarantee = () => useLocal<Guarantee>('reroll:guarantee', 2)

type RerollSort = 'gain' | 'chance'
type RerollWhich = 'all' | 'worn' | 'spare'

const weightClass = (w: number) => (w >= 0.75 ? 'w-hi' : w >= 0.3 ? 'w-mid' : w > 0 ? 'w-lo' : 'w-zero')

export function RerollPage({ result }: { result: EvaluationResult }) {
  const { pieces, er, config, done, toggleDone } = useStore()
  const [guarantee, setGuarantee] = useGuarantee()
  const [sort, setSort] = useLocal<RerollSort>('reroll:sort', 'gain')
  const [priorityFirst, setPriorityFirst] = useLocal('reroll:priorityFirst', true)
  const [which, setWhich] = useLocal<RerollWhich>('reroll:which', 'all')
  const [query, setQuery] = useState('')
  const [all, setAll] = useState(false)
  const plan = useMemo(() => planRerolls(result, pieces, guarantee, er, config), [result, pieces, guarantee, er, config])
  const evaluations = useMemo(() => new Map(result.evaluations.map((e) => [e.piece.id, e])), [result])

  const listed = plan.options.filter((o) => o.gain > 0)
  const spareCount = listed.filter((o) => o.spare).length
  const rows = useMemo(() => {
    const key = (o: RerollOption) => (sort === 'gain' ? o.gain / o.cost : o.chance)
    const prio = (o: RerollOption) => (priorityFirst ? (o.ref.building ? 2 : o.ref.priority === 'priority' ? 1 : 0) : 0)
    return listed
      .filter((o) => (which === 'all' || (which === 'spare') === !!o.spare) && characterName(o.ref.char).toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => prio(b) - prio(a) || key(b) - key(a) || b.gain - a.gain)
  }, [plan, sort, priorityFirst, which, query])
  const shown = all ? rows : rows.slice(0, 30)
  // The Inventory's ⟳ badge: the expected gain on the leveling badge's steps, for a ★ character while anyone is ★.
  const anyStar = result.activeBuilds.some((r) => r.priority === 'priority')
  const anyBuilding = result.activeBuilds.some((r) => r.building)
  const firstPick = [anyBuilding && '📌 Building', anyStar && '★ Priority'].filter(Boolean).join(', then ')
  const badges = useMemo(() => new Map(plan.options.map((o) => [o.piece.id, rerollPriority(o, anyStar)] as const)), [plan, anyStar])
  const highLeft = plan.options.filter((o) => badges.get(o.piece.id)?.high && !done.has(`reroll:${o.piece.id}`)).length

  return (
    <div className="page reroll">
      <p className="hint">
        Dust of Enlightenment re-rolls a +20 piece&apos;s upgrades from its starting values. You pick two lines and at
        least that many upgrades land on them; the suggestion is the two this build weights most. You can keep the old
        stats, so a reroll never loses anything: what matters is how likely it comes out better, and by how much. When
        the piece&apos;s ER line is needed to keep its wearer at their build&apos;s ER minimum, results that lose it count as
        no change, and the pick may include ER.
      </p>
      <p className="hint">
        <b>Spare</b> +20s are listed too, each for the character it would gain most
        {firstPick ? ` (${firstPick} first)` : ''}:
        one whose main stat their build takes and whose set keeps their set bonuses. Its reroll has to beat the piece it
        would replace, without taking them below their ER minimum. The Farm tab&apos;s free upgrades are left out, both
        their spares and the slots they fill: equip those first, and they&apos;re judged here as worn pieces.
      </p>
      <p className="hint">
        A gain of {PRIORITY_STEPS[0]} rolls or more gets the Artifacts grid&apos;s ⟳ badge, shaded the same way
        {anyStar ? ' for a 📌 Building or ★ Priority character' : ''}; from {HIGH_PRIORITY_GAIN} it&apos;s high priority
        {highLeft > 0 ? ` (${highLeft} not yet rerolled)` : ''}.
      </p>
      <div className="roster-tools">
        <span className="muted">Guaranteed upgrades</span>
        <div className="seg small">
          {([2, 3, 4] as const).map((g) => (
            <button key={g} className={guarantee === g ? 'on' : ''} onClick={() => setGuarantee(g)}>
              {GUARANTEE[g]}
            </button>
          ))}
        </div>
        <div className="seg small">
          <button className={sort === 'gain' ? 'on' : ''} onClick={() => setSort('gain')} title="Average gain per Dust spent">
            Gain per Dust
          </button>
          <button className={sort === 'chance' ? 'on' : ''} onClick={() => setSort('chance')}>
            Chance
          </button>
        </div>
        <div className="seg small">
          <button className={which === 'all' ? 'on' : ''} onClick={() => setWhich('all')}>
            Both
          </button>
          <button className={which === 'worn' ? 'on' : ''} onClick={() => setWhich('worn')} title="Pieces your characters wear">
            Worn ({listed.length - spareCount})
          </button>
          <button className={which === 'spare' ? 'on' : ''} onClick={() => setWhich('spare')} title="Unequipped +20s, for the character each would gain most">
            Spare ({spareCount})
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={priorityFirst} onChange={(e) => setPriorityFirst(e.target.checked)} /> 📌 Building, ★
          Priority first
        </label>
        <input placeholder="Search characters…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <table className="farm-table">
        <thead>
          <tr>
            <th />
            <th>Character</th>
            <th>Piece</th>
            <th title="Value now → average after a reroll (you'd keep whichever is better). A spare's is for the character it would go to.">
              Now → avg
            </th>
            <th title="Chance the reroll comes out better: for a spare, better than the piece it would replace">Better</th>
            <th title="Average improvement, counting a worse roll as no change: for a spare, over the piece it would replace">Gain</th>
            <th title="The two lines to pick">Pick</th>
            <th title="Dust of Enlightenment per reroll">Dust</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((o) => {
            const isDone = done.has(`reroll:${o.piece.id}`)
            const badge = badges.get(o.piece.id)
            return (
              <tr key={o.piece.id} className={isDone ? 'done' : ''}>
                <td>
                  <button className={`tick${isDone ? ' on' : ''}`} onClick={() => toggleDone(`reroll:${o.piece.id}`)} title="Rerolled it">
                    ✓
                  </button>
                </td>
                <td>
                  <span className="char-name">
                    {characterName(o.ref.char)}
                    {marks(o.ref)}
                  </span>
                  <div className="sub-note">{o.ref.build.name}</div>
                </td>
                <td>
                  <span title={SLOT_LABEL[o.piece.slotKey]}>{SLOT_ICON[o.piece.slotKey]}</span> {setName(o.piece.setKey)} ·{' '}
                  <b>{statShort(o.piece.mainStatKey)}</b>
                  <a
                    className="link"
                    href={inventoryHref(o.piece.id)}
                    title="Show this piece in the Artifacts grid, outlined, at its row and place in the row"
                  >
                    find in grid
                  </a>
                  <Lines o={o} />
                  {o.spare && <SpareNote o={o} feed={evaluations.get(o.piece.id)?.recommendLock === false} />}
                  {o.elsewhere && (
                    <div className="sub-note warn">
                      As is, it&apos;s an upgrade for {characterName(o.elsewhere.char)} (
                      {o.elsewhere.from === null ? 'nothing usable' : o.elsewhere.from.toFixed(1)} → {o.elsewhere.to.toFixed(1)}):
                      consider moving it instead.
                    </div>
                  )}
                </td>
                <td className="num">
                  {o.current.toFixed(1)} → {o.expected.toFixed(1)}
                  {o.spare && (
                    <div className="sub-note" title="The piece it would replace, which a reroll has to beat">
                      vs {o.spare.bar.toFixed(1)} worn
                    </div>
                  )}
                </td>
                <td className="num">
                  <b>{pct(o.chance)}</b>
                </td>
                <td className="num">
                  {badge ? (
                    <span
                      className={`inv-up card-gain t${badge.tier}`}
                      title={`${badge.high ? 'High priority: the' : 'The'} Artifacts grid marks this piece ⟳, shaded by this gain${badge.tier === 0 ? " (grey: the character isn't ★ or 📌)" : ''}`}
                    >
                      ⟳ {o.gain.toFixed(2)}
                    </span>
                  ) : (
                    o.gain.toFixed(2)
                  )}
                </td>
                <td>
                  <span className="nowrap">{o.chosen.map(statShort).join(' + ')}</span>
                  {o.erBound && (
                    <div className="sub-note" title="Results that would cost ER this character needs count as no change">
                      keeps needed ER
                    </div>
                  )}
                  <ErChange er={o.er && { from: o.er.now, to: o.er.after, need: o.er.need, cap: o.er.cap }} approx />
                </td>
                <td className="num">{o.cost}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {rows.length > 30 && (
        <button className="link more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
      {plan.wrongMain > 0 && (
        <p className="sub-note">
          {plan.wrongMain} worn +20s aren&apos;t listed because their main stat doesn&apos;t fit the build; a reroll can&apos;t
          fix that. See Free upgrades on the Farm tab, or allow the main stat in Builds.
        </p>
      )}
    </div>
  )
}

/** What a spare would replace, and whether triage would feed it. */
function SpareNote({ o, feed }: { o: RerollOption; feed: boolean }) {
  const { replaces } = o.spare!
  return (
    <>
      <div className="sub-note">
        <span className="tier">spare</span> In place of their {setName(replaces.setKey)} {SLOT_LABEL[replaces.slotKey].toLowerCase()}
        {replaces.mainStatKey !== o.piece.mainStatKey && (
          <span className="warn" title="Scores compare substats only, so the main stat trade is yours to judge">
            {' '}
            ({statShort(replaces.mainStatKey)} → {statShort(o.piece.mainStatKey)} main)
          </span>
        )}
      </div>
      {feed && <div className="sub-note warn">Triage marks it to feed: keep it locked if you&apos;ll reroll it.</div>}
    </>
  )
}

/** The piece's lines, coloured by weight, with a dot per upgrade each one got. */
function Lines({ o }: { o: RerollOption }) {
  const counts = upgradeCounts(o.piece)
  const w = o.ref.build.substats
  return (
    <div className="sub-note reroll-lines">
      {o.piece.substats.map((s, i) => (
        <span key={s.key} className={weightClass(w[s.key] ?? 0)} title={`${counts[i]} upgrade${counts[i] === 1 ? '' : 's'}`}>
          {statShort(s.key)} {isPercent(s.key) ? s.value.toFixed(1) : Math.round(s.value)}
          {counts[i] > 0 && <span className="rolls">{'•'.repeat(counts[i])}</span>}
        </span>
      ))}
      {o.wasted > 0 && (
        <span className="warn">
          {o.wasted} of {o.upgrades} upgrades on dead lines
        </span>
      )}
    </div>
  )
}
