import { Fragment, useDeferredValue, useMemo, type ReactNode } from 'react'
import { applyEdits, type BuildEdit } from '../engine/builds'
import { defaultRosterEntry, type ActiveBuild, type Evaluation, type EvaluationResult } from '../engine/evaluate'
import { fitPiece, locksWith, piecesAhead, type Ahead, type BuildFit } from '../engine/fit'
import type { Piece } from '../engine/load'
import { describeSetMatch } from '../engine/match'
import { allSubs } from '../engine/projection'
import { characterName, formatStat, SLOT_LABEL, setName, slotPlural, statLabel, statShort } from '../engine/stats'
import type { BuildConfig, Settings } from '../engine/types'
import { useStore } from '../state/store'
import { SLOT_ICON, verdictLabel, weightClass } from './ArtifactCard'
import { useLocal } from './local'
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

/** The substat gate's numbers: starting lines at +0, the projected +20 value after. */
const gateOf = (f: BuildFit) =>
  f.cand.rescore
    ? { what: 'Projected +20 value', got: f.cand.expected, need: f.cand.rescore.bar }
    : { what: 'Weight of its lines', got: f.cand.lineScore, need: f.cand.threshold }

/** "keeps it · 1 edit", "#4 for their sands, keeps 3": one fit in a few words. */
function outcomeText(f: BuildFit, piece: Piece, settings: Settings): string {
  const c = f.cand
  const slot = SLOT_LABEL[piece.slotKey].toLowerCase()
  const what =
    f.outcome === 'keep'
      ? 'keeps it'
      : f.outcome === 'cut'
        ? c.rank !== undefined
          ? `#${c.rank} for their ${slot}, keeps ${c.ref.cap}`
          : `#${c.offRank} off-set pick, keeps ${settings.capOffSet}`
        : f.outcome === 'chance'
          ? `${pct(c.chance)} to beat what they wear`
          : `substats ${n2(gateOf(f).got)} of ${n2(gateOf(f).need)}`
  return f.edits.length ? `${what} · ${plural(f.edits.length, 'edit')}` : what
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
}

/**
 * Closest build, at the top of the Builds editor: the piece, its verdict now (live, so edits show their effect at
 * once), the active builds nearest to keeping it, and layer by layer what stands in the way for the build on screen.
 */
export function FitPanel({ fitting, char, idx, build, save, onPick }: Props) {
  const { settings, config, pieces, roster, data } = useStore()
  const [showAll, setShowAll] = useLocal('builds:fit:all', false)
  const close = () => {
    location.hash = buildsHref({ char, idx })
  }
  const { ev, fits } = fitting
  const piece = ev?.piece ?? null

  // The build on screen: its fit among the active ones, or judged on its own when it doesn't count yet.
  const cc = config.characters[char]
  const owned = data.characters.find((c) => c.key === char)
  const entry = roster[char] ?? defaultRosterEntry(owned, settings.includeUnowned)
  const inactive = !cc.enabled
    ? 'the config switches them off'
    : !owned && !settings.includeUnowned
      ? "you don't own them (Settings → Include unowned)"
      : entry.priority === 'ignore'
        ? 'they’re set to Ignore'
        : entry.disabledBuilds.includes(idx)
          ? 'this build is switched off'
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
      <b>Closest build</b>
      {piece && (
        <span className="fit-piece">
          {SLOT_ICON[piece.slotKey]} {setName(piece.setKey)} · {statLabel(piece.mainStatKey)} · +{piece.level}{' '}
          <span title={piece.lock ? 'Locked now' : 'Unlocked now'}>{piece.lock ? '🔒' : '🔓'}</span>
        </span>
      )}
      <button className="ghost small" onClick={close} title="Close Closest build">
        ✕
      </button>
    </div>
  )
  if (!ev || !piece) {
    return (
      <div className="fit-panel">
        {head}
        <p className="hint">That piece isn&apos;t in this export. If you&apos;ve leveled it since, open it again from its new card.</p>
      </div>
    )
  }

  const weights = build.substats
  const shown = showAll ? fits : fits.slice(0, SHOWN)
  // Builds that would need the main stat allowed come last (see fitPiece), under a label of their own.
  const firstNeedsMain = shown.findIndex((f) => f.mainIssue)
  const needsMain = fits.filter((f) => f.mainIssue).length
  return (
    <div className="fit-panel">
      {head}
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
        <span className="reason">{ev.reason}</span>
      </div>

      {piece.owner ? (
        <p className="hint">Equipped on {characterName(piece.owner)}, so it&apos;s kept whatever the builds say.</p>
      ) : (
        <>
          <h4>Nearest to keeping it</h4>
          <p className="hint">
            Active builds, as if they counted it: its set listed if it can&apos;t be their off-set piece, and its main
            stat allowed. Builds that already take its main stat come first, those that would keep it first, fewest
            edits first. Pick one to edit it here.
          </p>
          <div className="fit-list">
            {shown.map((f, i) => {
              const on = f.ref.char === char && f.ref.buildIdx === idx
              return (
                <Fragment key={`${f.ref.char}|${f.ref.buildIdx}`}>
                  {i === firstNeedsMain && (
                    <span className="fit-group">
                      These need {statLabel(piece.mainStatKey)} {slotPlural(piece.slotKey)} allowed, which makes a different
                      build rather than a tweak:
                    </span>
                  )}
                  <button
                    className={`fit-row o-${f.outcome}${f.mainIssue ? ' needs-main' : ''}${on ? ' on' : ''}`}
                    onClick={() => onPick(f.ref.char, f.ref.buildIdx)}
                    title={f.edits.length ? f.edits.map(editLabel).join('\n') : 'No edits needed'}
                  >
                    <span className="fit-who">
                      {characterName(f.ref.char)}
                      {f.ref.priority === 'priority' && ' ★'} <small>{f.ref.build.name}</small>
                    </span>
                    <span className="fit-what">{outcomeText(f, piece, settings)}</span>
                  </button>
                </Fragment>
              )
            })}
            {fits.length > SHOWN && (
              <button className="link" onClick={() => setShowAll(!showAll)}>
                {showAll
                  ? 'fewer'
                  : `all ${fits.length}${needsMain ? `, ${needsMain} needing ${statShort(piece.mainStatKey)} allowed` : ''}`}
              </button>
            )}
            {!fits.length && <span className="muted">No active build has this slot.</span>}
          </div>

          {fit && (
            <Layers
              fit={fit}
              piece={piece}
              build={build}
              save={save}
              settings={settings}
              who={`${characterName(char)}${build.name ? ` · ${build.name}` : ''}`}
              inactive={inactive}
              byId={fitting.byId}
            />
          )}
        </>
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
}) {
  const { fit: f, piece, build, save, settings, who, inactive, byId } = props
  const { pieces, config } = useStore()
  const c = f.cand
  const slot = SLOT_LABEL[piece.slotKey].toLowerCase()
  const set = setName(piece.setKey)
  const rows: Layer[] = []
  // When the cap cuts it, what it's waiting on. Judged against the build the fit was (its edits made).
  const cut = useMemo(
    () => (f.outcome === 'cut' ? piecesAhead(piece, pieces, c.ref, config, settings) : null),
    [f.outcome, piece, pieces, c.ref, config, settings],
  )

  if (inactive) {
    rows.push({ label: 'Counts', ok: false, text: <>Not counted: {inactive}. Switch them on in <a href="#roster">Roster</a>.</> })
  }

  const setEdits = f.edits.filter((e) => e.kind === 'tier')
  const own = setEdits.find((e) => e.set === piece.setKey)
  if (!f.setIssue) {
    rows.push({
      label: 'Set',
      ok: true,
      text: c.setMatch.kind === 'off' ? `${set} as its off-set piece: any set can fill its one free slot` : `${set}, ${describeSetMatch(c.setMatch)}`,
    })
  } else {
    const worn = f.worn && `the 4pc ${setName(f.worn.set)} they wear (tier ${f.worn.tier})`
    const why =
      f.setIssue === 'unlisted'
        ? `${set} isn't one of its sets${worn ? `, and has to outrank ${worn}` : ''}`
        : f.setIssue === 'tier'
          ? `${set} is tier ${own?.from}, and only tiers 1–2 count${worn ? `; it has to outrank ${worn} too` : ''}`
          : `${set} doesn't outrank ${worn}`
    const label = setEdits
      .map((e) => (e.set !== piece.setKey ? `${setName(e.set)} to tier ${e.to}` : e.from === null ? `add at tier ${e.to}` : `make it tier ${e.to}`))
      .join(', ')
    rows.push({ label: 'Set', ok: false, text: why, fix: { label: label[0].toUpperCase() + label.slice(1), edits: setEdits } })
  }

  const mainEdits = f.edits.filter((e) => e.kind === 'main')
  rows.push(
    f.mainIssue
      ? { label: 'Main stat', ok: false, text: `${statLabel(piece.mainStatKey)} ${slotPlural(piece.slotKey)} aren't on its list`, fix: { label: `Allow ${statShort(piece.mainStatKey)}`, edits: mainEdits } }
      : { label: 'Main stat', ok: true, text: statLabel(piece.mainStatKey) },
  )

  const gate = gateOf(f)
  const scaled = c.scaledFor.length ? ` (lowered for ${c.scaledFor.join(', ')})` : ''
  const lines = allSubs(piece)
    .map((s) => `${statShort(s.key)} ${n2(build.substats[s.key] ?? 0)}`)
    .join(' · ')
  rows.push(
    c.gate === 'crit'
      ? { label: 'Substats', ok: true, text: 'CRIT circlet with the other CRIT stat, which always passes' }
      : c.gate === 'pass'
        ? { label: 'Substats', ok: true, text: `${gate.what} ${n2(gate.got)} ≥ ${n2(gate.need)}${scaled}` }
        : {
            label: 'Substats',
            ok: false,
            text: `${gate.what} ${n2(gate.got)}, needs ${n2(gate.need)}${scaled}. Its lines weigh ${lines}: raise the weights below to keep pieces like it.`,
          },
  )

  rows.push(
    c.gate === 'fail'
      ? { label: 'Upgrade', ok: null, text: 'Not judged until the substats pass' }
      : {
          label: 'Upgrade',
          ok: c.passChance,
          text:
            c.bar === null
              ? `Nothing usable worn in the ${slot}, so anything is an upgrade`
              : `${pct(c.chance)} to beat what they wear (${n2(c.bar)} now, ${n2(c.expected)} expected at +20)${c.passChance ? '' : `; needs ${pct(settings.minUpgradeChance)}`}`,
        },
  )

  rows.push(
    !c.passChance
      ? { label: 'Cap', ok: null, text: 'Not ranked until it passes the rest' }
      : c.rank === undefined
        ? {
            label: 'Cap',
            ok: false,
            text: `#${c.offRank} of its off-set candidates, which rank by gain over what they wear (+${n2(c.expected - (c.bar ?? 0))} for this one), and it keeps ${settings.capOffSet} (Settings → Off-set pieces)`,
          }
        : {
            label: 'Cap',
            ok: c.inCap,
            text: `#${c.rank} of ${c.rankOf} for their ${slot}, and it keeps ${c.ref.cap}${!c.inCap && c.ref.priority !== 'priority' ? ` (${settings.capPriority} as ★ Priority)` : ''}`,
          },
  )

  const ahead = cut?.ahead.length ?? 0
  const tail = {
    keep: "it's kept for this build",
    cut: !cut
      ? 'it passes, but the cap cuts it'
      : cut.lane === 'off-set'
        ? `it passes, but ${plural(ahead, 'other off-set candidate')} would gain them more`
        : `it passes, but ${ahead} other ${ahead === 1 ? slot : slotPlural(piece.slotKey)} rank above it`,
    chance: "it isn't likely enough to beat what they wear",
    substats: 'its substats fall short',
  }[f.outcome]
  const backup = f.outcome !== 'keep' && locksWith(f.outcome, piece, settings) ? ', so it stays locked as a backup' : ''
  const sentence = f.edits.length ? `With ${f.edits.length === 1 ? 'that edit' : 'those edits'}, ${tail}` : tail[0].toUpperCase() + tail.slice(1)
  const fixes = rows.filter((r) => r.fix)

  return (
    <div className="fit-layers-box">
      <h4>For {who}</h4>
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
            </span>
          </div>
        ))}
      </div>
      <p className={`fit-sum o-${f.outcome}`}>
        {sentence}
        {backup}
        {inactive ? ', once they count' : ''}.
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
 * The pieces the cap ranks above this one for the build. Unfinished ones link to the Inventory grid, since leveling
 * them settles whether they really belong ahead: one that rolls badly drops back, and this piece moves up.
 */
function RankedAhead({ cut, byId }: { cut: NonNullable<ReturnType<typeof piecesAhead>>; byId: Map<string, Evaluation> }) {
  const offSet = cut.lane === 'off-set'
  const unfinished = cut.ahead.filter((a) => a.piece.level < 20)
  const finished = cut.ahead.length - unfinished.length
  return (
    <div className="fit-ahead">
      {unfinished.length > 0 && (
        <>
          <p className="hint">
            Ranked above it and not finished yet: level these first, and if they roll badly it moves up. Each opens
            in the Inventory grid, outlined, so you can find it in-game.
          </p>
          <div className="fit-list">
            {unfinished.slice(0, AHEAD_SHOWN).map((a) => (
              <AheadLink key={a.piece.id} a={a} offSet={offSet} ev={byId.get(a.piece.id)} />
            ))}
            {unfinished.length > AHEAD_SHOWN && <span className="muted">+{unfinished.length - AHEAD_SHOWN} more</span>}
          </div>
        </>
      )}
      {finished > 0 && (
        <p className="hint">
          {plural(finished, 'finished +20')} rank{finished === 1 ? 's' : ''} above it
          {unfinished.length ? '.' : ': it only moves up once one of them is equipped or fed, or the cap is raised.'}
        </p>
      )}
    </div>
  )
}

function AheadLink({ a, offSet, ev }: { a: Ahead; offSet: boolean; ev?: Evaluation }) {
  const p = a.piece
  const place = offSet ? a.cand.offRank : a.cand.rank
  // The off-set lane ranks by gain over what's worn (in any slot); a slot's cap by projected value.
  const worth = offSet ? `+${n2(a.cand.expected - (a.cand.bar ?? 0))} gain` : `${n2(a.cand.expected)} at +20`
  return (
    <a className="fit-row" href={inventoryHref(p.id)} title={`Show it in the Inventory grid${ev ? `. ${verdictLabel(ev)}: ${ev.reason}` : ""}`}>
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
