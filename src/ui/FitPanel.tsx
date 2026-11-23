import { Fragment, useDeferredValue, useMemo, type ReactNode } from 'react'
import { applyEdits, type BuildEdit } from '../engine/builds'
import {
  defaultRosterEntry,
  MIN_USEFUL_LINES,
  referenceValue,
  tooFewLines,
  type ActiveBuild,
  type Evaluation,
  type EvaluationResult,
} from '../engine/evaluate'
import { bestOtherSpare, fitPiece, locksWith, piecesAhead, spareContext, type Ahead, type BuildFit, type SpareContext } from '../engine/fit'
import type { Piece } from '../engine/load'
import { describeSetMatch, offSetAllowed } from '../engine/match'
import { allSubs } from '../engine/projection'
import { characterName, formatStat, SLOT_LABEL, setName, slotPlural, statLabel, statShort, topKept } from '../engine/stats'
import type { BuildConfig, Settings } from '../engine/types'
import { useStore } from '../state/store'
import { LinesTag, ReasonText, SLOT_ICON, verdictLabel, weightClass } from './ArtifactCard'
import { useLocal } from './local'
import { marks } from './marks'
import { buildsHref, inventoryHref } from './routes'

/** A piece opened with Closest build: its evaluation, and every active build's fit for it, closest first. */
export interface Fitting {
  id: string
  /** Null when the piece isn't in this export (leveled since the link was made, say). */
  ev: Evaluation | null
  fits: BuildFit[]
  /** Every piece's evaluation, for the pieces ranked ahead of it. */
  byId: Map<string, Evaluation>
}

export function useFitting(result: EvaluationResult, pieceId: string | undefined): Fitting | null {
  const { pieces, config, settings } = useStore()
  // Ranking every build costs about as much as an evaluation, so it trails edits instead of holding them up.
  const judged = useDeferredValue(result)
  const judgedBy = useDeferredValue(config)
  const byId = useMemo(() => new Map(judged.evaluations.map((e) => [e.piece.id, e])), [judged])
  return useMemo(() => {
    if (!pieceId) return null
    const ev = byId.get(pieceId) ?? null
    const fits = ev && !ev.piece.owner ? fitPiece(ev.piece, pieces, judged.activeBuilds, judgedBy, settings, ev.candidates) : []
    return { id: pieceId, ev, fits, byId }
  }, [pieceId, byId, judged, judgedBy, pieces, settings])
}

const SHOWN = 5

const pct = (x: number) => (x > 0 && x < 0.01 ? '<1%' : `${Math.round(x * 100)}%`)
const n2 = (x: number) => x.toFixed(2)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * The substat gate's numbers: starting lines at +0, the projected +20 value after (just its value once it's +20). A
 * 3-liner whose lines pass at +0 shows its projection, as it would at +4.
 */
const gateOf = (f: BuildFit, piece: Piece) =>
  f.cand.rescore
    ? {
        what: piece.level >= 20 ? 'Value' : piece.level < 4 ? 'Projected +20 (with +4 line)' : 'Projected +20',
        got: f.cand.expected,
        need: f.cand.rescore.bar,
      }
    : { what: 'Line weight', got: f.cand.lineScore, need: f.cand.threshold }

/** What a fit gains the build: the piece's average at +20 over its bar (what they wear, or their best spare). */
const gainOf = (f: BuildFit) => f.cand.expected - (f.cand.bar ?? 0)
const signed = (x: number) => `${x < 0 ? '−' : '+'}${n2(Math.abs(x))}`

/**
 * The build in a group the piece gains most, among those that take its main stat: who it's best for, whether or not
 * they'd keep it. Null when it's no gain to any of them, or there's only one.
 */
function bestOf(fits: BuildFit[]): BuildFit | null {
  const takers = fits.filter((f) => !f.mainIssue)
  if (takers.length < 2) return null
  const best = takers.reduce((a, b) => (gainOf(b) > gainOf(a) ? b : a))
  return gainOf(best) > 0 ? best : null
}

/**
 * "keeps", "#4 sands, top 3 kept", "12% to beat spare +20 Emblem of Severed Fate": where a fit ends up, its edits made,
 * in a few words. `byId` names the spare it's measured against; `offSet` labels it "off-set:" when they'd wear it in
 * their off-set slot.
 */
function outcomeText(f: BuildFit, piece: Piece, settings: Settings, byId: Map<string, Evaluation>, offSet = false): string {
  const c = f.cand
  const slot = SLOT_LABEL[piece.slotKey].toLowerCase()
  const spare = c.spare ? byId.get(c.spare)?.piece : undefined
  const label = offSet ? 'off-set:' : 'spare'
  const what =
    f.outcome === 'keep'
      ? 'keeps'
      : f.outcome === 'cut'
        ? c.rank !== undefined
          ? `#${c.rank} ${slot}, ${topKept(c.ref.cap)}`
          : `#${c.offRank} off-set ${slot}, ${topKept(settings.capOffSet)}`
        : f.outcome === 'chance'
          ? piece.level >= 20
            ? `doesn't beat current`
            : c.floor !== undefined && c.chance >= settings.minUpgradeChance - 1e-9
              ? `${pct(c.floorChance!)} to reach ${pct(settings.levelFloor)} floor`
              : `${pct(c.chance)} to beat ${spare ? `${label} +${spare.level} ${setName(spare.setKey)}` : c.spare ? label.replace(':', '') : 'current'}`
          : `substats ${n2(gateOf(f, piece).got)} / ${n2(gateOf(f, piece).need)}`
  return what
}

/** The spare, not the piece's odds, is what stops it: a piece still to level that isn't likely enough to beat it. */
const spareBlocks = (f: BuildFit, piece: Piece, settings: Settings) =>
  f.outcome === 'chance' && !!f.cand.spare && piece.level < 20 && !(f.cand.floor !== undefined && f.cand.chance >= settings.minUpgradeChance - 1e-9)

/**
 * What a piece measured against a spare is better shown against first: what they wear now. That's when they wear all
 * five pieces of their set, so the spare only fits because one can go off-set, and when the build runs the piece's set
 * but its character wears another (`SpareContext.runsSet`), so the spare is just their best off-set piece.
 */
const leadsWithWorn = (f: BuildFit, ctx: SpareContext | null): ctx is SpareContext & { worn: NonNullable<SpareContext['worn']> } =>
  !!ctx?.worn && (ctx.offSet?.why === 'five' || (f.onSet && !ctx.runsSet))

/**
 * A row's text: where the fit ends up (`outcomeText`), then, when a finished spare stops a piece still to level, a
 * line with its chance against what they wear ("41% to beat current"). A spare they'd wear in their off-set slot
 * (`SpareContext.offSet`) is labelled "off-set:". When it `leadsWithWorn`, what they wear comes first and the spare
 * follows: "<1% to beat current +20 Heart of the Furnace", then "0% to beat off-set: +20 Scroll of the Hero of Cinder
 * City". That's also how a piece their set doesn't count yet reads (`BuildFit.sidelined`): it's only up against the
 * spare as an off-set piece.
 */
function rowText(
  f: BuildFit,
  piece: Piece,
  settings: Settings,
  byId: Map<string, Evaluation>,
  ctx: SpareContext | null,
): [string, string | null] {
  if (!ctx || !spareBlocks(f, piece, settings)) return [outcomeText(f, piece, settings, byId), null]
  const o = ctx.offSet
  if (leadsWithWorn(f, ctx)) {
    const first = `${pct(ctx.worn.chance)} to beat current +${ctx.worn.piece.level} ${setName(ctx.worn.piece.setKey)}`
    return [first, outcomeText(f, piece, settings, byId, !!o || f.cand.setMatch.kind === 'off')]
  }
  const worn = ctx.worn ? `${pct(ctx.worn.chance)} to beat current` : null
  const also = [o?.why === 'empty' ? 'empty slot' : null, worn ?? (o?.why === 'empty' ? null : 'nothing usable worn')]
  return [outcomeText(f, piece, settings, byId, !!o), also.filter(Boolean).join(' · ')]
}

type TierEdit = Extract<BuildEdit, { kind: 'tier' }>

/**
 * For a build that doesn't count the piece yet: what stands in the way as the build is now, then what its edits
 * would do. ["takes no HP% goblets", "if allowed"], ["tier 3 doesn't count", "at tier 2"]. Null when it counts.
 */
function blockerText(f: BuildFit, piece: Piece): [string, string] | null {
  if (!f.edits.length) return null
  const own = f.edits.find((e): e is TierEdit => e.kind === 'tier' && e.set === piece.setKey)
  // When the character sticks to a worn 4pc set, the piece's set has to rank above it as well.
  const worn = f.worn && setName(f.worn.set)
  const set =
    f.setIssue === 'unlisted'
      ? ['set not listed', worn ? `if added above worn ${worn}` : 'if added']
      : f.setIssue === 'tier'
        ? [`tier ${own?.from} doesn't count`, worn ? `if ranked above worn ${worn}` : `at tier ${own?.to}`]
        : f.setIssue === 'worn'
          ? [`worn ${worn ?? 'set'} outranks it`, 'if ranked above it']
          : null
  const main = f.mainIssue ? [`takes no ${statShort(piece.mainStatKey)} ${slotPlural(piece.slotKey)}`, 'if allowed'] : null
  if (set && main) return [`${set[0]}, ${main[0]}`, 'with both']
  const only = set ?? main
  return only ? [only[0], only[1]] : null
}

function editLabel(e: BuildEdit): string {
  if (e.kind === 'main') return `Allow ${statShort(e.main)} ${slotPlural(e.slot)}`
  return e.from === null ? `Add ${setName(e.set)} at tier ${e.to}` : `${setName(e.set)}: tier ${e.from} → ${e.to}`
}

interface Props {
  fitting: Fitting
  char: string
  idx: number
  /** The build being edited, as it is now. */
  build: BuildConfig
  save: (b: BuildConfig) => void
  onPick: (char: string, idx: number) => void
  /** Closes the panel; by default it goes back to the build without the piece. */
  onClose?: () => void
  /** Shown under the verdict: the inspector's buttons to mark the piece done, leveled or rerolled. */
  actions?: ReactNode
  /** The panel's heading: "Closest build" in the Builds editor. */
  title?: string
  /** Under Layers' heading: where to edit the build on screen in full. */
  editLink?: ReactNode
  /** Controls in the heading, before ✕: the inspector's dock switch. */
  tools?: ReactNode
}

/**
 * Closest build, at the top of the Builds editor and in the Artifacts tab's inspector: the piece, its verdict now
 * (live, so edits show their effect at once), the active builds nearest to keeping it, and layer by layer what stands
 * in the way for the build on screen.
 */
export function FitPanel({ fitting, char, idx, build, save, onPick, onClose, actions, title = 'Closest build', editLink, tools }: Props) {
  const { settings, config, pieces, roster, data } = useStore()
  const [showOffSet, setShowOffSet] = useLocal('builds:fit:off-set', false)
  const close =
    onClose ??
    (() => {
      location.hash = buildsHref({ char, idx })
    })
  const { ev, fits } = fitting
  const piece = ev?.piece ?? null

  // The build on screen: its fit among the active ones, or judged on its own when it doesn't count yet.
  const cc = config.characters[char]
  const owned = data.characters.find((c) => c.key === char)
  const entry = roster[char] ?? defaultRosterEntry(owned, settings.includeUnowned)
  const inactive = !cc.enabled
    ? 'off in config'
    : !owned && !settings.includeUnowned
      ? 'not owned'
      : entry.priority === 'ignore'
        ? 'set to Ignore'
        : entry.disabledBuilds.includes(idx)
          ? 'build switched off'
          : null
  const fit = useMemo(() => {
    if (!piece || piece.owner) return null
    const found = fits.find((f) => f.ref.char === char && f.ref.buildIdx === idx)
    if (found) return found
    const ref: ActiveBuild = {
      char,
      buildIdx: idx,
      build,
      priority: entry.priority,
      confidence: cc.confidence,
      cap: entry.priority === 'priority' ? settings.capPriority : settings.capNormal,
      owned: !!owned,
    }
    return fitPiece(piece, pieces, [ref], config, settings)[0] ?? null
  }, [piece, fits, char, idx, build, entry.priority, cc.confidence, owned, pieces, config, settings])

  const head = (
    <div className="fit-head">
      <b>{title}</b>
      {piece && (
        <span className="fit-piece">
          {SLOT_ICON[piece.slotKey]} {setName(piece.setKey)} · {statLabel(piece.mainStatKey)} · +{piece.level}{' '}
          <LinesTag piece={piece} /> <span title={piece.lock ? 'Locked now' : 'Unlocked now'}>{piece.lock ? '🔒' : '🔓'}</span>
        </span>
      )}
      {tools && <span className="fit-tools">{tools}</span>}
      <button className="ghost small" onClick={close} title={`Close ${title}`}>
        ✕
      </button>
    </div>
  )
  if (!ev || !piece) {
    return (
      <div className="fit-panel">
        {head}
        <p className="hint">Not in this export (leveled since?)</p>
      </div>
    )
  }

  const weights = build.substats
  const set = setName(piece.setKey)
  // Builds that run its set come first (see fitPiece). The rest could only use it as their off-set piece, which any
  // spare of any set can be, so they're folded away unless they're all there is or hold the build on screen.
  const onSet = fits.filter((f) => f.onSet)
  const offSet = fits.filter((f) => !f.onSet)
  const isOn = (f: BuildFit) => f.ref.char === char && f.ref.buildIdx === idx
  const offForced = !onSet.length || offSet.some(isOn)
  const offOpen = offForced || showOffSet
  const offKeeps = offSet.filter((f) => f.outcome === 'keep' && !f.mainIssue).length
  const onBest = bestOf(onSet)
  const what = piece.slotKey === 'flower' || piece.slotKey === 'plume' ? `${SLOT_LABEL[piece.slotKey]}` : `${statShort(piece.mainStatKey)} ${SLOT_LABEL[piece.slotKey].toLowerCase()}`
  const offSetHint = offSetAllowed(settings.offSet, piece)
    ? null
    : settings.offSet === 'off'
      ? `Off-set pieces off: each needs ${set} added`
      : `${what} can't be off-set on Rare main stats: each needs ${set} added`
  const rows = { piece, settings, isOn, onPick, byId: fitting.byId }
  // Two blocks, stacked unless there's room side by side (the inspector docked at the bottom): the piece and the
  // builds nearest to keeping it, then the build on screen layer by layer.
  return (
    <div className="fit-panel">
      {head}
      <div className="fit-body">
        <div className="fit-main">
          <div className="subs fit-subs">
            {allSubs(piece).map((s) => (
              <span key={s.key} className={`sub ${weightClass(weights[s.key] ?? 0)}${piece.substats.includes(s) ? '' : ' hidden-line'}`}>
                {formatStat(s.key, s.value)}
              </span>
            ))}
          </div>
          <div className="fit-now">
            <span className="muted">Now:</span>
            <span className={`verdict v-${ev.grade}`}>{verdictLabel(ev)}</span>
            {ev.action ? (
              <span className={`fit-act ${ev.action}`}>{ev.action === 'lock' ? '🔒 LOCK' : '🔓 UNLOCK'}</span>
            ) : (
              <span className="muted">{ev.recommendLock ? 'stays locked' : 'stays unlocked'}</span>
            )}
            <span className="reason">
              <ReasonText ev={ev} />
            </span>
          </div>
          {actions}

          {piece.owner ? (
            <p className="hint">Equipped on {characterName(piece.owner)}.</p>
          ) : (
            <>
              <h4>Nearest to keeping it</h4>
              {!fits.length && <p className="muted">No active build has this slot.</p>}
              {fits.length > 0 && (
                <div className="fit-section">
                  <span className="fit-section-head">
                    Run {set} <span className="muted">· {onSet.length}</span>
                    {onBest && (
                      <span className="fit-best" title="Most gain">
                        {' '}
                        · ▲ {characterName(onBest.ref.char)} {signed(gainOf(onBest))}
                      </span>
                    )}
                  </span>
                  {onSet.length ? <FitRows fits={onSet} store="builds:fit:all" {...rows} /> : <p className="muted">None run {set}.</p>}
                </div>
              )}
              {offSet.length > 0 && (
                <div className="fit-section">
                  {offForced ? (
                    <span className="fit-section-head">
                      Off-set <span className="muted">· {offSet.length}</span>
                    </span>
                  ) : (
                    <button className="link fit-section-head" onClick={() => setShowOffSet(!showOffSet)} aria-expanded={offOpen}>
                      {offOpen ? '▾' : '▸'} Off-set · {plural(offSet.length, 'build')}
                      {offKeeps > 0 && `, ${offKeeps} keep`}
                    </button>
                  )}
                  {offOpen && (
                    <>
                      {offSetHint && <p className="hint">{offSetHint}</p>}
                      <FitRows fits={offSet} store="builds:fit:off-set:all" {...rows} />
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        {!piece.owner && fit && (
          <div className="fit-aside">
            <Layers
              fit={fit}
              piece={piece}
              build={build}
              save={save}
              settings={settings}
              who={`${characterName(char)}${build.name ? ` · ${build.name}` : ''}`}
              editLink={editLink}
              inactive={inactive}
              byId={fitting.byId}
            />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * One group of Nearest to keeping it, closest first, with each build's gain. Builds that would need the main stat
 * allowed come last (see fitPiece), under a label of their own. ▲ marks the build it gains most (`bestOf`).
 */
function FitRows(props: {
  fits: BuildFit[]
  piece: Piece
  settings: Settings
  isOn: (f: BuildFit) => boolean
  /** Every piece's evaluation, to name the spare a build measures it against. */
  byId: Map<string, Evaluation>
  onPick: (char: string, idx: number) => void
  /** Where "all" is remembered. */
  store: string
}) {
  const { fits, piece, settings, isOn, onPick, store, byId } = props
  const { pieces } = useStore()
  const [showAll, setShowAll] = useLocal(store, false)
  const shown = showAll ? fits : fits.slice(0, SHOWN)
  const firstNeedsMain = shown.findIndex((f) => f.mainIssue)
  const needsMain = fits.filter((f) => f.mainIssue).length
  const top = bestOf(fits)
  return (
    <div className="fit-list">
      {shown.map((f, i) => {
        const c = f.cand
        // Measured against a spare: what they wear there too, and how they'd wear a spare of another set.
        const ctx = c.spare ? spareContext(piece, c, pieces) : null
        const overWorn = ctx?.worn ? ` · vs current ${n2(ctx.worn.value)}: ${signed(c.expected - ctx.worn.value)}` : ''
        const gainTitle =
          c.bar === null
            ? `${n2(c.expected)}, nothing usable worn`
            : `${n2(c.expected)} − ${c.spare ? 'spare' : 'current'} ${n2(c.bar)}${overWorn}`
        // Coloured by where the build stands now: a build that only keeps it after an edit doesn't keep it yet.
        const blocker = blockerText(f, piece)
        const [what, also] = rowText(f, piece, settings, byId, ctx)
        return (
          <Fragment key={`${f.ref.char}|${f.ref.buildIdx}`}>
            {i === firstNeedsMain && (
              <span className="fit-group">
                Need {statLabel(piece.mainStatKey)} {slotPlural(piece.slotKey)} allowed:
              </span>
            )}
            <button
              className={`fit-row o-${blocker ? 'blocked' : f.outcome}${f.mainIssue ? ' needs-main' : ''}${isOn(f) ? ' on' : ''}`}
              onClick={() => onPick(f.ref.char, f.ref.buildIdx)}
              title={f.edits.length ? f.edits.map(editLabel).join('\n') : 'No edits needed'}
            >
              <span className="fit-who">
                {characterName(f.ref.char)}
                {marks(f.ref)} <small>{f.ref.build.name}</small>
                <span className={`fit-gain${f === top ? ' best' : ''}`} title={`${gainTitle}${f === top ? ' · most gain' : ''}`}>
                  {f === top && '▲ '}
                  {signed(gainOf(f))}
                </span>
              </span>
              <span className="fit-what">
                {blocker ? (
                  <>
                    <span className="fit-block">{blocker[0]}</span> · {blocker[1]}: {what}
                  </>
                ) : (
                  what
                )}
              </span>
              {also && <span className="fit-also">{also}</span>}
            </button>
          </Fragment>
        )
      })}
      {fits.length > SHOWN && (
        <button className="link" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'fewer' : `all ${fits.length}${needsMain ? `, ${needsMain} needing ${statShort(piece.mainStatKey)} allowed` : ''}`}
        </button>
      )}
    </div>
  )
}

interface Layer {
  label: string
  /** null: not reached, because an earlier layer fails. */
  ok: boolean | null
  text: ReactNode
  fix?: { label: string; edits: BuildEdit[] }
  /** A line under the row, when a setting rather than the build is what the row hinges on. */
  note?: string
  /** Shows the note as a warning: something the scores leave out. */
  warn?: boolean
}

/** The build on screen, layer by layer, with buttons for the edits that fit the piece's set and main stat. */
function Layers(props: {
  fit: BuildFit
  piece: Piece
  build: BuildConfig
  save: (b: BuildConfig) => void
  settings: Settings
  who: string
  inactive: string | null
  byId: Map<string, Evaluation>
  editLink?: ReactNode
}) {
  const { fit: f, piece, build, save, settings, who, inactive, byId, editLink } = props
  const { pieces, config } = useStore()
  const c = f.cand
  // The finished spare it's measured against, when that beats what's worn.
  const spare = c.spare ? byId.get(c.spare) : undefined
  const slot = SLOT_LABEL[piece.slotKey].toLowerCase()
  const set = setName(piece.setKey)
  const rows: Layer[] = []
  // When the cap cuts it, what it's waiting on. Judged against the build the fit was (its edits made).
  const cut = useMemo(
    () => (f.outcome === 'cut' ? piecesAhead(piece, pieces, c.ref, config, settings) : null),
    [f.outcome, piece, pieces, c.ref, config, settings],
  )
  // For a finished piece, their best other +20 spare for the slot. Shown only: finished spares are each measured
  // against what's worn, so this is what says which one they'd equip first.
  const other = useMemo(
    () => (piece.level >= 20 && c.gate !== 'fail' ? bestOtherSpare(piece, pieces, c.ref, config, settings) : null),
    [piece, c.gate, pieces, c.ref, config, settings],
  )
  // Measured against a spare: what they wear there too, and how they'd wear a spare of another set.
  const ctx = useMemo(() => (c.spare ? spareContext(piece, c, pieces) : null), [piece, c, pieces])

  if (inactive) {
    rows.push({ label: 'Counts', ok: false, text: <>Not counted: {inactive} (<a href="#characters/roster">Roster</a>)</> })
  }

  const setEdits = f.edits.filter((e) => e.kind === 'tier')
  const own = setEdits.find((e) => e.set === piece.setKey)
  const side = f.sidelined
  if (side) {
    // The build runs its set, but the set layer turned it away, so it's here only through the off-set lane.
    rows.push({
      label: 'Set',
      ok: true,
      text:
        side.issue === 'tier'
          ? `${set} tier ${side.tier}: off-set only (tier 2 counts it)`
          : `${set} tier ${side.tier}, below worn ${setName(side.worn.set)} (t${side.worn.tier}): off-set only`,
    })
  } else if (!f.setIssue) {
    rows.push({
      label: 'Set',
      ok: true,
      text: c.setMatch.kind === 'off' ? `${set}: off-set` : `${set}, ${describeSetMatch(c.setMatch)}`,
    })
  } else {
    const worn = f.worn && `worn ${setName(f.worn.set)} (t${f.worn.tier})`
    const why =
      f.setIssue === 'unlisted'
        ? `${set} not listed${worn ? `; must outrank ${worn}` : ''}`
        : f.setIssue === 'tier'
          ? `${set} tier ${own?.from} doesn't count${worn ? `; must outrank ${worn}` : ''}`
          : `${set} doesn't outrank ${worn}`
    const label = setEdits
      .map((e) => (e.set !== piece.setKey ? `${setName(e.set)} to tier ${e.to}` : e.from === null ? `add at tier ${e.to}` : `make it tier ${e.to}`))
      .join(', ')
    // The set only needs listing because the Off-set setting keeps this piece out of the build's free slot.
    const what = piece.slotKey === 'flower' || piece.slotKey === 'plume' ? SLOT_LABEL[piece.slotKey] : `${statShort(piece.mainStatKey)} ${slot}`
    const note = offSetAllowed(settings.offSet, piece)
      ? undefined
      : settings.offSet === 'off'
        ? 'Off-set pieces off; Any slot would take it unlisted'
        : `${what} can't be off-set on Rare main stats; Any slot would take it unlisted`
    rows.push({ label: 'Set', ok: false, text: why, fix: { label: label[0].toUpperCase() + label.slice(1), edits: setEdits }, note })
  }

  const mainEdits = f.edits.filter((e) => e.kind === 'main')
  rows.push(
    f.mainIssue
      ? { label: 'Main stat', ok: false, text: `${statLabel(piece.mainStatKey)} not allowed`, fix: { label: `Allow ${statShort(piece.mainStatKey)}`, edits: mainEdits } }
      : { label: 'Main stat', ok: true, text: statLabel(piece.mainStatKey) },
  )

  const gate = gateOf(f, piece)
  const scaled = c.scaledFor.length ? ` (${c.scaledFor.join(', ')})` : ''
  const lines = allSubs(piece)
    .map((s) => `${statShort(s.key)} ${n2(build.substats[s.key] ?? 0)}`)
    .join(' · ')
  rows.push(
    c.gate === 'crit'
      ? { label: 'Substats', ok: true, text: 'CRIT circlet + CRIT line: pass' }
      : c.gate === 'pass'
        ? { label: 'Substats', ok: true, text: `${gate.what} ${n2(gate.got)} ≥ ${n2(gate.need)}${scaled}` }
        : tooFewLines(c)
          ? {
              label: 'Substats',
              ok: false,
              text: `${gate.what} ${n2(gate.got)} ≥ ${n2(gate.need)}${scaled}, but ${plural(c.usefulLines, 'useful line')} (needs ${MIN_USEFUL_LINES}) · ${lines}`,
            }
          : {
              label: 'Substats',
              ok: false,
              text: `${gate.what} ${n2(gate.got)} / ${n2(gate.need)}${scaled} · ${lines}`,
            },
  )

  // What it's measured against: their best finished spare when that beats what they wear, or what they wear.
  const rival = c.bar === null ? null : (spare?.piece ?? pieces.find((p) => p.owner === c.ref.char && p.slotKey === piece.slotKey) ?? null)
  const rivalLink = rival && (
    <a href={inventoryHref(rival.id)} title="Show in grid">
      {statShort(rival.mainStatKey)} {setName(rival.setKey)} {slot}
      {spare ? ` +${rival.level}` : ''}
    </a>
  )
  const min = settings.minUpgradeChance - 1e-9
  const needs = c.chance >= min ? '' : ` · needs ${pct(settings.minUpgradeChance)}`
  // A finished piece against their best other +20 spare, when that one also beats what they wear.
  const beatsWorn = c.bar === null || c.expected > c.bar + 1e-9
  const rivalSpare = other && (c.bar === null || other.cand.expected > c.bar + 1e-9) ? other : null
  const rivalSpareLink = rivalSpare && (
    <a href={inventoryHref(rivalSpare.piece.id)} title="Show in grid">
      {statShort(rivalSpare.piece.mainStatKey)} {setName(rivalSpare.piece.setKey)} {slot} +20
    </a>
  )
  const spareLine = rivalSpare ? (
    rivalSpare.cand.expected > c.expected + 1e-9 ? (
      <>
        {' '}
        · backup to spare {rivalSpareLink} ({n2(rivalSpare.cand.expected)})
      </>
    ) : (
      <>
        {' '}
        · best spare (next: {rivalSpareLink} {n2(rivalSpare.cand.expected)})
      </>
    )
  ) : piece.level >= 20 && beatsWorn ? (
    c.bar === null ? ' · no other spare' : ' · no other spare beats current'
  ) : null
  // A spare of another set, for a build that runs this piece's set: they'd wear it in their off-set slot.
  const o = ctx?.offSet
  const worn = ctx?.worn
  const wornLink = worn && (
    <a href={inventoryHref(worn.piece.id)} title="Show in grid">
      {statShort(worn.piece.mainStatKey)} {setName(worn.piece.setKey)} {slot}
    </a>
  )
  const wornLine = worn ? (
    <>
      {' '}
      · {pct(worn.chance)} vs current {wornLink} ({n2(worn.value)})
    </>
  ) : !ctx ? null : o?.why === 'empty' ? (
    ' · empty slot'
  ) : (
    ' · nothing usable worn'
  )
  // As in the list's row (`leadsWithWorn`): what they wear comes first, and the spare that decides the ✓ follows.
  const wornFirst =
    spare && leadsWithWorn(f, ctx) ? (
      <>
        {pct(ctx.worn.chance)} to beat current {wornLink} ({n2(ctx.worn.value)}) · avg {n2(c.expected)} · {pct(c.chance)} to
        beat {o || c.setMatch.kind === 'off' ? 'off-set:' : 'spare'} {rivalLink} ({n2(c.bar ?? 0)}){needs}
      </>
    ) : null
  rows.push(
    c.gate === 'fail'
      ? { label: 'Upgrade', ok: null, text: 'Not reached' }
      : {
          label: 'Upgrade',
          ok: c.chance >= min,
          text:
            c.bar === null ? (
              <>Nothing usable worn: any piece upgrades{spareLine}</>
            ) : wornFirst ? (
              wornFirst
            ) : spare ? (
              // Only pieces still to level are measured against a spare.
              <>
                {pct(c.chance)} to beat {o ? 'off-set:' : 'spare'} {rivalLink} ({n2(c.bar)}) · avg {n2(c.expected)}
                {needs}
                {wornLine}
              </>
            ) : piece.level >= 20 ? (
              <>
                {n2(c.expected)} vs current {rivalLink} {n2(c.bar)}
                {spareLine}
              </>
            ) : (
              <>
                {pct(c.chance)} to beat current {rivalLink} ({n2(c.bar)}) · avg {n2(c.expected)}
                {needs}
              </>
            ),
          // Farm's free swaps flag the same thing.
          note:
            rival && rival.mainStatKey !== piece.mainStatKey
              ? `Main stat ${statShort(rival.mainStatKey)} → ${statShort(piece.mainStatKey)}: not scored`
              : undefined,
          warn: true,
        },
  )

  // Only where it decides anything: a piece still to level, when the floor is above what they have.
  if (c.floor !== undefined) {
    const typical = referenceValue(c.ref.build, piece.mainStatKey)
    const theirs = c.bar === null ? 'nothing usable worn' : `${c.spare ? 'spare' : 'current'} ${pct(c.bar / typical)}`
    rows.push({
      label: 'Floor',
      ok: c.floorChance! >= min,
      text: `${pct(c.floorChance!)} to pass ${pct(settings.levelFloor)} floor (${n2(c.floor)})${
        c.floorChance! >= min ? '' : ` · needs ${pct(settings.minUpgradeChance)}`
      } · ${theirs}`,
    })
  }

  rows.push(
    !c.passChance
      ? { label: 'Cap', ok: null, text: 'Not reached' }
      : piece.level >= 20
        ? // judge() gives finished pieces no rank in either pool: inCap is just passChance.
          { label: 'Cap', ok: true, text: '+20: no cap place' }
        : c.rank === undefined
        ? {
            label: 'Cap',
            ok: false,
            text: `#${c.offRank} off-set ${slot} by gain (+${n2(c.expected - (c.bar ?? 0))}), ${topKept(settings.capOffSet)}`,
          }
        : {
            label: 'Cap',
            ok: c.inCap,
            text: `#${c.rank} of ${c.rankOf}, ${topKept(c.ref.cap)}${!c.inCap && c.ref.priority !== 'priority' ? ` (${settings.capPriority} if ★)` : ''}`,
          },
  )

  const ahead = cut?.ahead.length ?? 0
  const slots = ahead === 1 ? slot : slotPlural(piece.slotKey)
  const tail = {
    keep: 'kept',
    cut: !cut
      ? 'passes; cap cuts it'
      : cut.lane === 'off-set'
        ? `passes; ${ahead} off-set ${slots} gain more`
        : `passes; ${ahead} ${slots} rank above`,
    chance:
      piece.level >= 20
        ? "doesn't beat current"
        : c.floor !== undefined && c.chance >= min
          ? 'unlikely to reach floor'
          : c.spare
            ? `unlikely to beat spare${ctx?.worn && ctx.worn.chance < min ? ' (or current)' : ''}`
            : 'unlikely to beat current',
    substats: 'substats short',
  }[f.outcome]
  const backup = f.outcome !== 'keep' && locksWith(f.outcome, piece, settings) ? ' · stays locked' : ''
  // Like the list, it says where the build stands now first: an edit's outcome is only what it would take.
  const sentence = f.edits.length ? `Not counted. With ${f.edits.length === 1 ? 'edit' : 'edits'}: ${tail}` : tail[0].toUpperCase() + tail.slice(1)
  const fixes = rows.filter((r) => r.fix)

  return (
    <div className="fit-layers-box">
      <h4>
        For {who}
        {editLink}
      </h4>
      <div className="fit-layers">
        {rows.map((r) => (
          <div key={r.label} className="fit-layer">
            <span className={`fit-mark ${r.ok === true ? 'ok' : r.ok === false ? 'bad' : 'na'}`}>
              {r.ok === true ? '✓' : r.ok === false ? '✗' : '–'}
            </span>
            <span className="fit-label">{r.label}</span>
            <span className="fit-text">
              {r.text}
              {r.fix && (
                <button className="ghost small" onClick={() => save(applyEdits(build, r.fix!.edits))} title={r.fix.edits.map(editLabel).join('\n')}>
                  {r.fix.label}
                </button>
              )}
              {r.note && <span className={`sub-note fit-note${r.warn ? ' warn' : ''}`}>{r.note}</span>}
            </span>
          </div>
        ))}
      </div>
      <p className={`fit-sum o-${f.edits.length ? 'blocked' : f.outcome}`}>
        {sentence}
        {backup}
        {inactive ? ' · once counted' : ''}
        {fixes.length > 1 && (
          <button className="ghost small" onClick={() => save(applyEdits(build, f.edits))}>
            Make both edits
          </button>
        )}
      </p>
      {cut && <RankedAhead cut={cut} byId={byId} />}
    </div>
  )
}

const AHEAD_SHOWN = 6

/**
 * The pieces the cap ranks above this one for the build, in rank order, each a link to the Artifacts grid. They're all
 * still to level (finished pieces take no cap place; the best of them is the bar instead), so they're worth leveling
 * first: one that rolls badly drops back, and this piece moves up.
 */
function RankedAhead({ cut, byId }: { cut: NonNullable<ReturnType<typeof piecesAhead>>; byId: Map<string, Evaluation> }) {
  const offSet = cut.lane === 'off-set'
  return (
    <div className="fit-ahead">
      <p className="hint">Ranked above, still to level:</p>
      <div className="fit-list">
        {cut.ahead.slice(0, AHEAD_SHOWN).map((a) => (
          <AheadLink key={a.piece.id} a={a} offSet={offSet} ev={byId.get(a.piece.id)} />
        ))}
        {cut.ahead.length > AHEAD_SHOWN && <span className="muted">+{cut.ahead.length - AHEAD_SHOWN} more</span>}
      </div>
    </div>
  )
}

function AheadLink({ a, offSet, ev }: { a: Ahead; offSet: boolean; ev?: Evaluation }) {
  const p = a.piece
  const place = offSet ? a.cand.offRank : a.cand.rank
  // A slot's off-set lane ranks by gain over its bar; its cap by projected value.
  const worth = offSet ? `+${n2(a.cand.expected - (a.cand.bar ?? 0))} gain` : `${n2(a.cand.expected)} at +20`
  return (
    <a className="fit-row" href={inventoryHref(p.id)} title={`Show in grid${ev ? ` · ${verdictLabel(ev)}: ${ev.reason}` : ''}`}>
      <span className="fit-who">
        #{place} {SLOT_ICON[p.slotKey]} {statShort(p.mainStatKey)} +{p.level} <small>{setName(p.setKey)}</small>
      </span>
      <span className="fit-what">
        {worth}
        {ev && ` · ${verdictLabel(ev)}`}
      </span>
    </a>
  )
}
