import { tooFewLines, type Candidate, type Evaluation } from '../engine/evaluate'
import { describeSetMatch } from '../engine/match'
import { AVG_TIER, characterName, formatStat, MAX_ROLL, SLOT_LABEL, setName, statLabel } from '../engine/stats'
import { MAX_PRICE } from '../engine/fodder'
import { startLines } from '../engine/projection'
import type { LevelPriority, LevelValue } from '../engine/inventory'
import type { Piece } from '../engine/load'
import type { GoodSubstat, SlotKey } from '../engine/types'
import { useStore } from '../state/store'
import { marks } from './marks'
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

/** Rolls per 100k EXP, as Spend → Fodder writes gain per EXP. */
export const per100k = (rate: number) => (rate * 1e5).toFixed(2)

/** A piece leveling advice holds: kept, but not worth its EXP right now. */
export const isHeld = (level: LevelPriority | null | undefined) => level?.value?.worth === false

/** "0.84/100k EXP", or for a held piece: "Held: 0.16/100k EXP vs 0.47 elsewhere". */
export function valueLine(v: LevelValue): string {
  const rate = `${per100k(v.rate)}/100k EXP`
  if (v.worth) return v.price > 0 ? `${rate} vs ${per100k(v.price)} marginal` : rate
  if (v.price >= MAX_PRICE) return 'Held: EXP on hand all goes to Rank for characters'
  return `Held: ${rate} vs ${per100k(v.price)} elsewhere${v.first ? '' : ' (after Rank for)'}`
}

/** "4-liner: dropped with 4 substats, so all 5 upgrades roll (9 rolls by +20)", for the 4L/3L tag's title. */
export const linesTitle = (lines: 3 | 4) =>
  lines === 4
    ? '4-liner: dropped with 4 substats, so all 5 upgrades roll (9 rolls by +20)'
    : '3-liner: dropped with 3 substats; +4 adds the 4th, so 4 upgrades roll (8 rolls by +20)'

/**
 * How many lines the piece dropped with: 4L stands out, 3L stays faint. It shows at +20 too, where both have 4 lines,
 * and the game sorts 4-liners first within a level, slot and lock state.
 */
export function LinesTag({ piece, className = '' }: { piece: Piece; className?: string }) {
  const lines = startLines(piece)
  return (
    <span className={`lines l${lines} ${className}`.trim()} title={linesTitle(lines)}>
      {lines}L
    </span>
  )
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
  /** Open in the Artifacts tab's inspector. */
  inspected?: boolean
  done: boolean
  expanded: boolean
  onFocus: () => void
  onDone: () => void
  onToggleExpand: () => void
  /** Opens the piece in the inspector beside the list, with Closest build. */
  onInspect?: () => void
  /** A what-if is on in the set brief: its button can't mark it done. */
  preview?: boolean
  /** Its real verdict, when the what-if changes it. */
  was?: Evaluation
}

export function ArtifactCard(props: Props) {
  const { ev, leveling, priority, focused, inspected, done, expanded, onFocus, onDone, onToggleExpand, onInspect, preview, was } = props
  const { piece } = ev
  const weights = ev.best?.ref.build.substats ?? {}
  const cls = ['card', `g-${ev.grade}`, focused && 'focused', inspected && 'inspected', done && 'done', was && 'was'].filter(Boolean).join(' ')

  return (
    <div className={cls} onClick={onFocus}>
      <div className="card-head">
        <span className="slot" title={SLOT_LABEL[piece.slotKey]}>
          {SLOT_ICON[piece.slotKey]}
        </span>
        <span className="main-stat">{statLabel(piece.mainStatKey)}</span>
        <span className="level">+{piece.level}</span>
        <LinesTag piece={piece} />
        <span className="lockstate" title={piece.lock ? 'Currently locked' : 'Currently unlocked'}>
          {piece.lock ? '🔒' : '🔓'}
        </span>
        {piece.astralMark && <span className="flag" title="Astral Mark">★</span>}
        {piece.elixirCrafted && <span className="flag" title="Crafted with Sanctifying Elixir">⚗</span>}
        <span className={`verdict v-${ev.grade}`}>{verdictLabel(ev)}</span>
        {leveling ? (
          <LevelButton ev={ev} held={isHeld(priority)} done={done} onDone={onDone} preview={preview} />
        ) : (
          <ActionButton ev={ev} done={done} onDone={onDone} preview={preview} />
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

      {was && <WasLine was={was} />}
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
        {piece.rarity === 5 && onInspect && (
          <button
            className="link"
            onClick={(e) => {
              e.stopPropagation()
              onInspect()
            }}
            title="Open in inspector"
          >
            inspect
          </button>
        )}
        {piece.rarity === 5 && !piece.owner && !onInspect && (
          <a
            className="link"
            href={buildsHref({ piece: piece.id })}
            onClick={(e) => e.stopPropagation()}
            title="Closest build in Builds tab"
          >
            closest build
          </a>
        )}
        {piece.rarity === 5 && (
          <a
            className="link"
            href={inventoryHref(piece.id)}
            onClick={(e) => e.stopPropagation()}
            title="Show in grid"
          >
            find in grid
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
      <a className="char-link" href={buildHref(c, ev.piece)} onClick={(e) => e.stopPropagation()} title="Open build">
        {name}
      </a>
      {ev.reason.slice(at + name.length)}
    </>
  )
}

/** What a piece the set brief's what-if changes really is: its verdict and reason with every build on. */
export function WasLine({ was }: { was: Evaluation }) {
  return (
    <div className="was-line" title="The verdict with every build on">
      What-if changes it. Really: <b>{verdictLabel(was)}</b>
      {was.action && ` (${was.action.toUpperCase()})`} · {was.reason}
    </div>
  )
}

const PREVIEW_TITLE = 'What-if: reset it in the set brief to mark pieces done'

function ActionButton({ ev, done, onDone, preview }: { ev: Evaluation; done: boolean; onDone: () => void; preview?: boolean }) {
  const click = (e: React.MouseEvent) => {
    e.stopPropagation()
    onDone()
  }
  if (!ev.action) {
    return <span className="action none">{ev.recommendLock ? '✓ keep' : '– tossed'}</span>
  }
  return (
    <button
      className={`action ${ev.action}${done ? ' is-done' : ''}`}
      onClick={click}
      disabled={preview}
      title={preview ? PREVIEW_TITLE : "Click once you've done it in-game"}
    >
      {done ? '✓ done' : ev.action === 'lock' ? '🔒 LOCK' : '🔓 UNLOCK'}
    </button>
  )
}

function LevelButton({
  ev,
  held,
  done,
  onDone,
  preview,
}: {
  ev: Evaluation
  held: boolean
  done: boolean
  onDone: () => void
  preview?: boolean
}) {
  const click = (e: React.MouseEvent) => {
    e.stopPropagation()
    onDone()
  }
  return (
    <button
      className={`action level${done ? ' is-done' : ''}`}
      onClick={click}
      disabled={preview}
      title={preview ? PREVIEW_TITLE : "Click once you've leveled it in-game"}
    >
      {done ? '✓ leveled' : `${held ? '⏸' : '⬆'} +${ev.nextStop}`}
    </button>
  )
}

const pct = (x: number) => (x > 0 && x < 0.01 ? '<1%' : `${Math.round(x * 100)}%`)

const MAX_CHIPS = 5

/**
 * What leveling it is worth (the grid's ⬆ badge: expected gain once finished, which the To level queue sorts by),
 * then each character it could go to, with the chance it ends up beating what they wear now.
 */
function ChanceRow({ ev, priority }: { ev: Evaluation; priority: LevelPriority | null }) {
  const { config, settings } = useStore()
  const shown = ev.candidates
    .filter((c) => c.gate !== 'fail' && (c.chance > 0 || c.ref.char === ev.piece.owner))
    .sort(
      (a, b) =>
        Number(!!b.ref.building) - Number(!!a.ref.building) ||
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
          title={`+${gain.gain.toFixed(2)} over ${characterName(gain.char)}'s best (miss = 0) · ${pct(gain.chance)} to beat`}
        >
          ⬆ +{gain.gain.toFixed(2)} {characterName(gain.char)}
          {marks({ priority: gain.star ? 'priority' : 'normal', building: gain.building })}
        </span>
      )}
      {priority?.value && (
        <span
          className={`chance value${isHeld(priority) ? ' held' : ''}`}
          title={valueLine(priority.value)}
        >
          {isHeld(priority) ? '⏸ hold · ' : ''}
          <b>{per100k(priority.value.rate)}</b>/100k EXP
        </span>
      )}
      {shown.slice(0, MAX_CHIPS).map((c) => {
        const worn = c.ref.char === ev.piece.owner
        const title = [
          c.ref.build.name,
          `at +20 ≈ ${c.expected.toFixed(2)}`,
          worn ? 'worn' : c.bar === null ? 'nothing usable worn' : `${c.spare ? 'spare' : 'current'} ${c.bar.toFixed(2)}`,
          c.floor !== undefined ? `${pct(c.floorChance!)} past floor (${c.floor.toFixed(2)})` : '',
          c.rank ? `#${c.rank}/${c.rankOf}` : '',
        ]
          .filter(Boolean)
          .join(' · ')
        // Likely to beat what they have, but not to reach the leveling floor: say that's what keeps it out.
        const belowFloor = !worn && c.floor !== undefined && !c.passChance && c.chance >= settings.minUpgradeChance - 1e-9
        return (
          <span key={`${c.ref.char}|${c.ref.buildIdx}`} className={`chance ${c.inCap || worn ? 'in' : c.passChance ? 'cut' : 'out'}`} title={title}>
            {characterName(c.ref.char)}
            {marks(c.ref)}
            {config.characters[c.ref.char].builds.length > 1 && <small> ({c.ref.build.name})</small>}{' '}
            <b>{worn ? 'worn' : pct(c.chance)}</b>
            {belowFloor && <small> · floor {pct(c.floorChance!)}</small>}
          </span>
        )
      })}
      {shown.length > MAX_CHIPS && <span className="chance out">+{shown.length - MAX_CHIPS} more</span>}
    </div>
  )
}

export function BuildTable({ piece, candidates }: { piece: Piece; candidates: Candidate[] }) {
  return (
    <table className="builds" onClick={(e) => e.stopPropagation()}>
      <thead>
        <tr>
          <th>Character</th>
          <th>Set</th>
          <th title="+0: line weight / threshold · later: projected / bar">Gate</th>
          <th title="Expected +20 value, in rolls">At +20</th>
          <th title="Current, or spare +20 if better · floor if higher">To beat</th>
          <th>Beat</th>
          <th>Rank</th>
        </tr>
      </thead>
      <tbody>
        {candidates.slice(0, 12).map((c) => (
          <tr key={`${c.ref.char}|${c.ref.buildIdx}`} className={c.inCap ? 'in' : c.passChance ? 'cut' : 'out'}>
            <td>
              <a className="char-link" href={buildHref(c, piece)} title="Open build">
                {characterName(c.ref.char)}
              </a>
              {marks(c.ref)}
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
            <td>
              {c.bar === null ? 'nothing usable' : c.spare ? `${c.bar.toFixed(2)} (spare +20)` : c.bar.toFixed(2)}
              {c.floor !== undefined && <div className="sub-note">floor {c.floor.toFixed(2)}</div>}
            </td>
            <td className={c.gate !== 'fail' && !c.passChance ? 'bad' : ''}>
              {c.gate === 'fail' ? '–' : pct(c.chance)}
              {c.floor !== undefined && <div className="sub-note">floor {pct(c.floorChance!)}</div>}
            </td>
            <td>{c.rank ? `#${c.rank}/${c.rankOf}, ${c.ref.cap >= 99 ? 'all' : `top ${c.ref.cap}`} kept` : '–'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
