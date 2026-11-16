// Closest build: for one piece, which build is nearest to keeping it, and what in that build stands in the way.
import { applyEdits, type BuildEdit, type MainSlot } from './builds'
import { commitmentOf, judge, wornSets, type ActiveBuild, type Candidate } from './evaluate'
import type { Piece } from './load'
import { mainStatOk, matchSet, offSetAllowed } from './match'
import type { ArtifactConfig, Settings } from './types'

/**
 * Where a piece stands with a build:
 * - keep: kept for it;
 * - cut: passes every layer but the cap (or the off-set lane's cap);
 * - chance: passes the substats, but isn't likely enough to beat what the character wears;
 * - substats: fails the substat gate.
 */
export type FitOutcome = 'keep' | 'cut' | 'chance' | 'substats'

export interface BuildFit {
  /** The build as it is now. */
  ref: ActiveBuild
  /** Changes that let the piece count for the build at all (its set, its main stat); empty when it already does. */
  edits: BuildEdit[]
  /** Why the set needed an edit: the build doesn't list it, lists it at a tier that doesn't count, or the worn set outranks it. */
  setIssue: 'unlisted' | 'tier' | 'worn' | null
  /** The 4pc set the character wears, when the piece's set has to rank above it. */
  worn: { set: string; tier: number } | null
  /** The build didn't accept the piece's main stat. */
  mainIssue: boolean
  /**
   * The build runs the piece's set: lists it among its 4pc sets (at any tier), or takes it for one of its 2pc pairs.
   * Any other build could only use the piece as its one off-set piece.
   */
  onSet: boolean
  /**
   * A build that runs the piece's set but counts it only as its off-set piece, and why its set doesn't count: its tier
   * (Settings → Set matching on tiers 1–2), or the 4pc set the character wears, which outranks it.
   */
  sidelined: { issue: 'tier'; tier: number } | { issue: 'worn'; tier: number; worn: { set: string; tier: number } } | null
  /** The piece judged against the build with the edits made. */
  cand: Candidate
  outcome: FitOutcome
}

const LEVEL: Record<FitOutcome, number> = { keep: 3, cut: 2, chance: 1, substats: 0 }

/** For unequipped pieces: equipped ones are never ranked, so they never reach 'keep'. */
export function outcomeOf(c: Candidate): FitOutcome {
  return c.inCap ? 'keep' : c.passChance ? 'cut' : c.gate !== 'fail' ? 'chance' : 'substats'
}

/** Whether the piece ends up locked with this outcome: kept, or a marginal piece the settings keep locked. */
export function locksWith(outcome: FitOutcome, piece: Piece, settings: Settings): boolean {
  if (outcome === 'keep') return true
  if (outcome === 'substats') return false
  return piece.level === 20 || (outcome === 'cut' && settings.lockMarginal)
}

const NO_SET_EDIT: Pick<BuildFit, 'setIssue' | 'worn'> & { edits: BuildEdit[] } = { edits: [], setIssue: null, worn: null }

/**
 * The pieces that can move one piece's standing with a build: what's worn (the bars and the worn set), and the other
 * pieces of its slot (its cap pool and its slot's off-set lane).
 */
function relevantTo(piece: Piece, pieces: Piece[]): Piece[] {
  return pieces.filter((p) => p.id === piece.id || p.owner || p.slotKey === piece.slotKey)
}

/** A piece the cap ranks above another for a build, with its candidate there. */
export interface Ahead {
  piece: Piece
  cand: Candidate
}

/**
 * The pieces of its slot ranked above one the cap cuts from a build, best first: the build's other off-set
 * candidates when the off-set lane cut it (ranked by gain over what the character wears there), otherwise the slot's
 * pool (by projected value). `ref` is the build the piece was judged against: a fit's `cand.ref`, which has the fit's
 * edits made. Null when the cap didn't cut it.
 */
export function piecesAhead(
  piece: Piece,
  pieces: Piece[],
  ref: ActiveBuild,
  config: ArtifactConfig,
  settings: Settings,
): { lane: 'off-set' | 'slot'; ahead: Ahead[] } | null {
  const relevant = relevantTo(piece, pieces)
  const { perPiece } = judge(relevant, [ref], config, settings)
  const own = perPiece[relevant.findIndex((p) => p.id === piece.id)]?.[0]
  if (!own || !own.passChance || own.inCap) return null
  const lane = own.rank === undefined ? 'off-set' : 'slot'
  const ahead: Ahead[] = []
  relevant.forEach((p, i) => {
    const c = perPiece[i][0]
    if (!c || p.id === piece.id || p.slotKey !== piece.slotKey) return
    if (lane === 'off-set' ? (c.offRank ?? Infinity) < own.offRank! : (c.rank ?? Infinity) < own.rank!) ahead.push({ piece: p, cand: c })
  })
  const place = (a: Ahead) => (lane === 'off-set' ? a.cand.offRank! : a.cand.rank!)
  return { lane, ahead: ahead.sort((a, b) => place(a) - place(b)) }
}

/**
 * The build's best finished spare for a piece's slot, other than the piece: unequipped, +20 and past the substat gate,
 * as step 4 of `judge()` picks the spare that raises the bar for pieces still to level. A finished piece is only ever
 * measured against what's worn, so several can be kept for one slot; this says whether another would be equipped
 * first. `ref` is a fit's `cand.ref`, with its edits made. Null when there's no other.
 */
export function bestOtherSpare(piece: Piece, pieces: Piece[], ref: ActiveBuild, config: ArtifactConfig, settings: Settings): Ahead | null {
  const relevant = relevantTo(piece, pieces)
  const { perPiece } = judge(relevant, [ref], config, settings)
  let best: Ahead | null = null
  for (let i = 0; i < relevant.length; i++) {
    const p = relevant[i]
    const c = perPiece[i][0]
    if (!c || p.id === piece.id || p.owner || p.level < 20 || p.slotKey !== piece.slotKey || c.gate === 'fail') continue
    if (!best || c.expected > best.cand.expected) best = { piece: p, cand: c }
  }
  return best
}

/** The tier edits that make the piece's set count for the build, as the evaluation's set layer judges it. */
function setEdits(
  ref: ActiveBuild,
  piece: Piece,
  config: ArtifactConfig,
  settings: Settings,
  worn: Record<string, number>,
): Pick<BuildFit, 'setIssue' | 'worn'> & { edits: BuildEdit[] } {
  const match = matchSet(ref.build, piece.setKey, config, settings.setMatch)
  const committed = settings.commitToWornSet && piece.owner !== ref.char ? commitmentOf(ref.build, worn) : null
  const outranked = committed && piece.setKey !== committed.set ? committed : null
  if (match && !(match.kind === '4pc' && outranked && match.tier >= outranked.tier)) return { edits: [], setIssue: null, worn: null }

  const entry = ref.build.sets4.find((s) => s.set === piece.setKey)
  // The lowest tier that still counts, unless the worn set needs outranking.
  const counting = settings.setMatch === '4pc-t12' ? 2 : 3
  let to = outranked ? Math.min(counting, outranked.tier - 1) : counting
  const edits: BuildEdit[] = []
  if (to < 1) {
    // Nothing outranks tier 1, so the worn set drops to 2.
    edits.push({ kind: 'tier', set: outranked!.set, from: outranked!.tier, to: 2 })
    to = 1
  }
  if (!entry) edits.push({ kind: 'tier', set: piece.setKey, from: null, to })
  else if (entry.tier > to) edits.push({ kind: 'tier', set: piece.setKey, from: entry.tier, to })
  return {
    edits,
    setIssue: !entry ? 'unlisted' : match ? 'worn' : 'tier',
    worn: outranked && outranked.tier - 1 < counting ? outranked : null,
  }
}

/**
 * How every build in `refs` stands with one piece, closest to keeping it first. Builds that run its set (`onSet`) come
 * before every build that could only use it as its off-set piece, so what its own set's builds make of it isn't lost
 * among builds that would take a piece of any set. Within each, builds that accept its main stat come before every
 * build that would need it allowed, since that's a different build rather than a tweak (an Anemo DMG goblet for Nilou).
 * Within each group: builds that keep it (fewest edits first), then those it passes but the cap cuts it from, then
 * those it isn't likely to upgrade, then those whose substat gate it fails; within each of those, nearest the next
 * step up first.
 *
 * A build the piece doesn't count for is judged as if the edits that let it count were made: its main stat allowed
 * and, unless any set can fill the build's off-set slot with it (the Off-set setting), its set at the lowest tier that
 * counts (above the worn set when the character sticks to it). The edited build is judged by the real evaluation, so
 * its cap counts every other piece the edits let in too. A piece that already counts gets no edits: neither changes
 * its substats, its odds or the pieces ranked above it.
 *
 * `judged` is the piece's candidates from the evaluation, when `refs` are its active builds; without it the builds
 * are judged here as they are first.
 */
export function fitPiece(
  piece: Piece,
  pieces: Piece[],
  refs: ActiveBuild[],
  config: ArtifactConfig,
  settings: Settings,
  judged?: Candidate[],
): BuildFit[] {
  if (piece.rarity !== 5 || !refs.length) return []
  const key = (r: ActiveBuild) => `${r.char}|${r.buildIdx}`
  const relevant = relevantTo(piece, pieces)
  const at = relevant.findIndex((p) => p.id === piece.id)
  if (at < 0) return []
  const before = new Map((judged ?? judge(relevant, refs, config, settings).perPiece[at]).map((c) => [key(c.ref), c]))

  const worn = wornSets(pieces)
  // An off-set piece can be of any set, so only a piece that can't be one needs its set listed.
  const offSet = offSetAllowed(settings.offSet, piece)
  const plans = refs.map((ref) => {
    const cur = before.get(key(ref)) ?? null
    const set = cur || offSet ? NO_SET_EDIT : setEdits(ref, piece, config, settings, worn.get(ref.char) ?? {})
    const mainIssue = !cur && !mainStatOk(ref.build, piece)
    const main: BuildEdit[] = mainIssue ? [{ kind: 'main', slot: piece.slotKey as MainSlot, main: piece.mainStatKey }] : []
    const listed = ref.build.sets4.find((s) => s.set === piece.setKey)
    const match = matchSet(ref.build, piece.setKey, config, settings.setMatch)
    let sidelined: BuildFit['sidelined'] = null
    if (listed && cur?.setMatch.kind === 'off') {
      // The set layer turned it away (`setFor` in evaluate.ts): a tier that doesn't count, or the worn set outranks it.
      const committed = commitmentOf(ref.build, worn.get(ref.char) ?? {})
      if (!match) sidelined = { issue: 'tier', tier: listed.tier }
      else if (committed) sidelined = { issue: 'worn', tier: listed.tier, worn: committed }
    }
    const onSet = !!listed || match?.kind === '2pc'
    return { ref, cur, set, mainIssue, onSet, sidelined, edits: [...set.edits, ...main] }
  })

  const after = new Map<string, Candidate>()
  const edited = plans.filter((p) => p.edits.length)
  if (edited.length) {
    const refsAfter = edited.map((p) => ({ ...p.ref, build: applyEdits(p.ref.build, p.edits) }))
    for (const c of judge(relevant, refsAfter, config, settings).perPiece[at]) after.set(key(c.ref), c)
  }

  const fits: BuildFit[] = []
  for (const p of plans) {
    const cand = p.cur ?? after.get(key(p.ref))
    if (!cand) continue
    const { ref, edits, mainIssue, onSet, sidelined } = p
    fits.push({ ref, edits, setIssue: p.set.setIssue, worn: p.set.worn, mainIssue, onSet, sidelined, cand, outcome: outcomeOf(cand) })
  }

  const near = (f: BuildFit) => nearness(f, settings)
  const gain = (f: BuildFit) => f.cand.expected - (f.cand.bar ?? 0)
  return fits.sort(
    (a, b) =>
      Number(b.onSet) - Number(a.onSet) ||
      Number(a.mainIssue) - Number(b.mainIssue) ||
      LEVEL[b.outcome] - LEVEL[a.outcome] ||
      (a.outcome === 'keep'
        ? a.edits.length - b.edits.length || near(b) - near(a)
        : near(b) - near(a) || a.edits.length - b.edits.length) ||
      gain(b) - gain(a),
  )
}

/** How near a fit is to the next outcome up; only compared within one outcome, higher is nearer. */
function nearness(f: BuildFit, settings: Settings): number {
  const c = f.cand
  switch (f.outcome) {
    case 'keep':
    case 'chance':
      return c.chance
    case 'cut':
      // Places past the cap: the slot's, or its off-set lane's when it never reached the slot's pool.
      return c.rank !== undefined ? c.ref.cap - c.rank : settings.capOffSet - (c.offRank ?? Infinity)
    case 'substats': {
      const [got, need] = c.rescore ? [c.expected, c.rescore.bar] : [c.lineScore, c.threshold]
      return need > 0 ? got / need : 0
    }
  }
}
