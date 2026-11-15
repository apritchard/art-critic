import { tooFewLines, type Candidate, type Evaluation } from '../engine/evaluate'
import { describeSetMatch } from '../engine/match'
import { AVG_TIER, characterName, formatStat, MAX_ROLL, SLOT_LABEL, setName, statLabel } from '../engine/stats'
import type { LevelPriority } from '../engine/inventory'
import type { Piece } from '../engine/load'
import type { GoodSubstat, SlotKey } from '../engine/types'
import { useStore } from '../state/store'
import { buildsHref, inventoryHref } from './routes'

export const SLOT_ICON: Record<SlotKey, string> = {
  flower: '🌸',
  plume: '🪶',
  sands: '⏳',
  goblet: '🏆',
  circlet: '👑',
}

export function verdictLabel(ev: Evaluation): string {
  if (ev.grade === 'marginal') return ev.piece.level === 20 ? 'Backup' : 'Marginal'
  switch (ev.verdict) {
    case 'level':
      return `Level → +${ev.nextStop}`
    case 'continue':
      return `Continue → +${ev.nextStop}`
    case 'spare':
      return 'Spare'
    case 'trash':
      return 'Trash'
    case 'stop':
      return 'Stop & feed'
    case 'feed':
      return 'Feed'
    case 'equipped':
      return ev.nextStop ? `Equipped · finish → +${ev.nextStop}` : 'Equipped'
    case 'skip':
      return 'Not evaluated'
  }
}

/** Colors a substat by how much the build weighs it. */
export const weightClass = (w: number) => (w >= 0.75 ? 'w-hi' : w >= 0.3 ? 'w-mid' : w > 0 ? 'w-lo' : 'w-zero')

/** Upgrade rolls that landed on this line, estimated from its growth since the drop. */
function rollsInto(s: GoodSubstat): number {
  if (s.initialValue === undefined) return 0
  return Math.round((s.value - s.initialValue) / ((MAX_ROLL[s.key] ?? Infinity) * AVG_TIER))
}

interface Props {
  ev: Evaluation
  /** Level-up queue: the button marks the piece leveled, and every build's upgrade chance is shown. */
  leveling?: boolean
  /** Level-up queue: what it's worth leveling, shown as the Inventory's ⬆ badge shows it. */
  priority?: LevelPriority | null
  focused: boolean
  done: boolean
  expanded: boolean
  onFocus: () => void
  onDone: () => void
  onToggleExpand: () => void
}

export function ArtifactCard({ ev, leveling, priority, focused, done, expanded, onFocus, onDone, onToggleExpand }: Props) {
  const { piece } = ev
  const weights = ev.best?.ref.build.substats ?? {}
  const cls = ['card', `g-${ev.grade}`, focused && 'focused', done && 'done'].filter(Boolean).join(' ')

  return (
    <div className={cls} onClick={onFocus}>
      <div className="card-head">
        <span className="slot" title={SLOT_LABEL[piece.slotKey]}>
          {SLOT_ICON[piece.slotKey]}
        </span>
        <span className="main-stat">{statLabel(piece.mainStatKey)}</span>
        <span className="level">+{piece.level}</span>
        <span className="lockstate" title={piece.lock ? 'Currently locked' : 'Currently unlocked'}>
          {piece.lock ? '🔒' : '🔓'}
        </span>
        {piece.astralMark && <span className="flag" title="Astral Mark">★</span>}
        {piece.elixirCrafted && <span className="flag" title="Crafted with Sanctifying Elixir">⚗</span>}
        <span className={`verdict v-${ev.grade}`}>{verdictLabel(ev)}</span>
        {leveling ? (
          <LevelButton ev={ev} done={done} onDone={onDone} />
        ) : (
          <ActionButton ev={ev} done={done} onDone={onDone} />
        )}
      </div>
      <div className="card-set">{setName(piece.setKey)}</div>
      {leveling && <ChanceRow ev={ev} priority={priority ?? null} />}

      <div className="subs">
        {piece.substats.map((s) => {
          const rolls = rollsInto(s)
          return (
            <span key={s.key} className={`sub ${weightClass(weights[s.key] ?? 0)}`}>
              {formatStat(s.key, s.value)}
              {rolls > 0 && <span className="rolls">{'•'.repeat(rolls)}</span>}
            </span>
          )
        })}
        {(piece.unactivatedSubstats ?? []).map((s) => (
          <span key={s.key} className={`sub hidden-line ${weightClass(weights[s.key] ?? 0)}`} title="Revealed at +4">
            {formatStat(s.key, s.value)} <small>(+4)</small>
          </span>
        ))}
      </div>

      <div className="reason">
        <ReasonText ev={ev} />
        {ev.candidates.length > 0 && (
          <button
            className="link"
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand()
            }}
          >
            {expanded ? 'hide builds' : `${ev.candidates.length} build${ev.candidates.length > 1 ? 's' : ''}`}
          </button>
        )}
        {piece.rarity === 5 && !piece.owner && (
          <a
            className="link"
            href={buildsHref({ piece: piece.id })}
            onClick={(e) => e.stopPropagation()}
            title="Open the build nearest to keeping this piece in the Builds tab, with what stands in the way"
          >
            closest build
          </a>
        )}
        {piece.rarity === 5 && (
          <a
            className="link"
            href={inventoryHref(piece.id)}
            onClick={(e) => e.stopPropagation()}
            title="Show this piece in the Inventory tab's grid, outlined, at its row and place in the row"
          >
            find in inventory
          </a>
        )}
      </div>

      {expanded && <BuildTable piece={piece} candidates={ev.candidates} />}
    </div>
  )
}

/** A link to a build in the Builds tab, with Closest build open for the piece unless it's worn. */
const buildHref = (c: Candidate, piece: Piece) => buildsHref({ char: c.ref.char, idx: c.ref.buildIdx, piece: piece.owner ? undefined : piece.id })

/**
 * The verdict's reason, with the character it names linked to the build that decided it (`ev.best`), as the builds
 * table links every character. The reason is the engine's text, so the name is found in it rather than rebuilt.
 */
export function ReasonText({ ev }: { ev: Evaluation }) {
  const c = ev.best
  const name = c ? characterName(c.ref.char) : ''
  const at = name ? ev.reason.indexOf(name) : -1
  if (!c || at < 0) return <>{ev.reason}</>
  return (
    <>
      {ev.reason.slice(0, at)}
      <a className="char-link" href={buildHref(c, ev.piece)} onClick={(e) => e.stopPropagation()} title="Open this build in the Builds tab">
        {name}
      </a>
      {ev.reason.slice(at + name.length)}
    </>
  )
}

function ActionButton({ ev, done, onDone }: { ev: Evaluation; done: boolean; onDone: () => void }) {
  const click = (e: React.MouseEvent) => {
    e.stopPropagation()
    onDone()
  }
  if (!ev.action) {
    return <span className="action none">{ev.recommendLock ? '✓ keep' : '– tossed'}</span>
  }
  return (
    <button className={`action ${ev.action}${done ? ' is-done' : ''}`} onClick={click} title="Click once you've done it in-game">
      {done ? '✓ done' : ev.action === 'lock' ? '🔒 LOCK' : '🔓 UNLOCK'}
    </button>
  )
}

function LevelButton({ ev, done, onDone }: { ev: Evaluation; done: boolean; onDone: () => void }) {
  const click = (e: React.MouseEvent) => {
    e.stopPropagation()
    onDone()
  }
  return (
    <button className={`action level${done ? ' is-done' : ''}`} onClick={click} title="Click once you've leveled it in-game">
      {done ? '✓ leveled' : `⬆ +${ev.nextStop}`}
    </button>
  )
}

const pct = (x: number) => (x > 0 && x < 0.01 ? '<1%' : `${Math.round(x * 100)}%`)

const MAX_CHIPS = 5

/**
 * What leveling it is worth (the Inventory's ⬆ badge: expected gain once finished, which the Level up tab sorts by),
 * then each character it could go to, with the chance it ends up beating what they wear now.
 */
function ChanceRow({ ev, priority }: { ev: Evaluation; priority: LevelPriority | null }) {
  const { config } = useStore()
  const shown = ev.candidates
    .filter((c) => c.gate !== 'fail' && (c.chance > 0 || c.ref.char === ev.piece.owner))
    .sort(
      (a, b) =>
        Number(b.ref.priority === 'priority') - Number(a.ref.priority === 'priority') ||
        b.chance - a.chance ||
        b.expected - a.expected,
    )
  const gain = priority?.char ? priority : null
  if (!shown.length && !gain) return null
  return (
    <div className="chances">
      {gain && (
        <span
          className={`inv-up card-gain t${gain.tier}`}
          title={`Expected gain once finished: +${gain.gain.toFixed(2)} rolls over the best ${characterName(gain.char)} has (what they wear, or a better spare +20), counting a miss as 0 (${pct(gain.chance)} to beat it). The same number as the Inventory's ⬆ badge; "Expected gain" sorts by it.`}
        >
          ⬆ +{gain.gain.toFixed(2)} {characterName(gain.char)}
          {gain.star && ' ★'}
        </span>
      )}
      {shown.slice(0, MAX_CHIPS).map((c) => {
        const worn = c.ref.char === ev.piece.owner
        const title = [
          c.ref.build.name,
          `at +20 ≈ ${c.expected.toFixed(2)}`,
          worn
            ? 'already wearing it'
            : c.bar === null
              ? 'nothing usable in that slot now'
              : c.spare
                ? `best spare +20 ${c.bar.toFixed(2)}, better than what they wear`
                : `now wears ${c.bar.toFixed(2)}`,
          c.rank ? `#${c.rank} of ${c.rankOf} candidates` : '',
        ]
          .filter(Boolean)
          .join(' · ')
        return (
          <span key={`${c.ref.char}|${c.ref.buildIdx}`} className={`chance ${c.inCap || worn ? 'in' : c.passChance ? 'cut' : 'out'}`} title={title}>
            {characterName(c.ref.char)}
            {c.ref.priority === 'priority' && ' ★'}
            {config.characters[c.ref.char].builds.length > 1 && <small> ({c.ref.build.name})</small>}{' '}
            <b>{worn ? 'worn' : pct(c.chance)}</b>
          </span>
        )
      })}
      {shown.length > MAX_CHIPS && <span className="chance out">+{shown.length - MAX_CHIPS} more</span>}
    </div>
  )
}

function BuildTable({ piece, candidates }: { piece: Piece; candidates: Candidate[] }) {
  return (
    <table className="builds" onClick={(e) => e.stopPropagation()}>
      <thead>
        <tr>
          <th>Character</th>
          <th>Set</th>
          <th title="+0: weight of starting lines vs threshold. Later: projected value vs re-score bar.">Gate</th>
          <th title="Expected value at +20, in weighted max-roll units">At +20</th>
          <th title="What it has to beat, same units: what this character wears in the slot, or their best spare +20 when that's better">
            To beat
          </th>
          <th>Beat</th>
          <th>Rank</th>
        </tr>
      </thead>
      <tbody>
        {candidates.slice(0, 12).map((c) => (
          <tr key={`${c.ref.char}|${c.ref.buildIdx}`} className={c.inCap ? 'in' : c.passChance ? 'cut' : 'out'}>
            <td>
              <a className="char-link" href={buildHref(c, piece)} title="Open this build in the Builds tab">
                {characterName(c.ref.char)}
              </a>
              {c.ref.priority === 'priority' && ' ★'}
              <div className="sub-note">
                {c.ref.build.name}
                {c.ref.confidence === 'speculative' && ' · speculative'}
                {c.ref.build.erTarget && ` · ER ${c.ref.build.erTarget}`}
              </div>
            </td>
            <td>{describeSetMatch(c.setMatch)}</td>
            <td className={c.gate === 'fail' ? 'bad' : ''}>
              {c.gate === 'crit'
                ? 'crit circlet'
                : c.rescore
                  ? `${c.expected.toFixed(2)} / ${c.rescore.bar.toFixed(2)}`
                  : `${c.lineScore.toFixed(2)} / ${c.threshold.toFixed(2)}${tooFewLines(c) ? ` · ${c.usefulLines} useful line` : ''}`}
            </td>
            <td>{c.expected.toFixed(2)}</td>
            <td>{c.bar === null ? 'nothing usable' : c.spare ? `${c.bar.toFixed(2)} (spare +20)` : c.bar.toFixed(2)}</td>
            <td className={c.gate !== 'fail' && !c.passChance ? 'bad' : ''}>{c.gate === 'fail' ? '–' : pct(c.chance)}</td>
            <td>{c.rank ? `#${c.rank}/${c.rankOf}, ${c.ref.cap >= 99 ? 'all' : `top ${c.ref.cap}`} kept` : '–'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
