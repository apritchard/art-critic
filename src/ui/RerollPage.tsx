import { useMemo, useState } from 'react'
import type { EvaluationResult } from '../engine/evaluate'
import { planRerolls, upgradeCounts, type Guarantee, type RerollOption } from '../engine/reroll'
import { characterName, isPercent, SLOT_LABEL, setName, statShort } from '../engine/stats'
import { useStore } from '../state/store'
import { SLOT_ICON } from './ArtifactCard'
import { ErChange } from './FarmPage'
import { useLocal } from './local'

const pct = (x: number) => (x > 0 && x < 0.01 ? '<1%' : `${Math.round(x * 100)}%`)

const GUARANTEE: Record<Guarantee, string> = { 2: 'Normal (2)', 3: 'Advanced (3)', 4: 'Decreed (4)' }

type RerollSort = 'gain' | 'chance'

const weightClass = (w: number) => (w >= 0.75 ? 'w-hi' : w >= 0.3 ? 'w-mid' : w > 0 ? 'w-lo' : 'w-zero')

export function RerollPage({ result }: { result: EvaluationResult }) {
  const { pieces, er, done, toggleDone } = useStore()
  const [guarantee, setGuarantee] = useLocal<Guarantee>('reroll:guarantee', 2)
  const [sort, setSort] = useLocal<RerollSort>('reroll:sort', 'gain')
  const [priorityFirst, setPriorityFirst] = useLocal('reroll:priorityFirst', true)
  const [query, setQuery] = useState('')
  const [all, setAll] = useState(false)
  const plan = useMemo(() => planRerolls(result, pieces, guarantee, er), [result, pieces, guarantee, er])

  const rows = useMemo(() => {
    const key = (o: RerollOption) => (sort === 'gain' ? o.gain / o.cost : o.chance)
    const prio = (o: RerollOption) => Number(priorityFirst && o.ref.priority === 'priority')
    return plan.options
      .filter((o) => o.gain > 0 && characterName(o.ref.char).toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => prio(b) - prio(a) || key(b) - key(a) || b.gain - a.gain)
  }, [plan, sort, priorityFirst, query])
  const shown = all ? rows : rows.slice(0, 30)

  return (
    <div className="page reroll">
      <p className="hint">
        Dust of Enlightenment re-rolls a +20 piece&apos;s upgrades from its starting values. You pick two lines and at
        least that many upgrades land on them; the suggestion is the two this build weights most. You can keep the old
        stats, so a reroll never loses anything: what matters is how likely it comes out better, and by how much. When
        the piece&apos;s ER line is needed to keep its wearer at their build&apos;s ER minimum, results that lose it count as
        no change, and the pick may include ER.
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
        <label className="check">
          <input type="checkbox" checked={priorityFirst} onChange={(e) => setPriorityFirst(e.target.checked)} /> ★ Priority first
        </label>
        <input placeholder="Search characters…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <table className="farm-table">
        <thead>
          <tr>
            <th />
            <th>Character</th>
            <th>Piece</th>
            <th title="Value now → average after a reroll (you'd keep whichever is better)">Now → avg</th>
            <th title="Chance the reroll comes out better">Better</th>
            <th title="Average improvement, counting a worse roll as no change">Gain</th>
            <th title="The two lines to pick">Pick</th>
            <th title="Dust of Enlightenment per reroll">Dust</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((o) => {
            const isDone = done.has(`reroll:${o.piece.id}`)
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
                    {o.ref.priority === 'priority' && ' ★'}
                  </span>
                  <div className="sub-note">{o.ref.build.name}</div>
                </td>
                <td>
                  <span title={SLOT_LABEL[o.piece.slotKey]}>{SLOT_ICON[o.piece.slotKey]}</span> {setName(o.piece.setKey)} ·{' '}
                  <b>{statShort(o.piece.mainStatKey)}</b>
                  <Lines o={o} />
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
                </td>
                <td className="num">
                  <b>{pct(o.chance)}</b>
                </td>
                <td className="num">{o.gain.toFixed(2)}</td>
                <td>
                  <span className="nowrap">{o.chosen.map(statShort).join(' + ')}</span>
                  {o.erBound && (
                    <div className="sub-note" title="Results that would cost ER this character needs count as no change">
                      keeps needed ER
                    </div>
                  )}
                  <ErChange er={o.er && { from: o.er.now, to: o.er.after, need: o.er.need }} approx />
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
