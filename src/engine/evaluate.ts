import type { Piece } from './load'
import { describeSetMatch, mainStatOk, matchSet, offSetAllowed, type SetMatch } from './match'
import {
  chanceToBeat,
  currentValue,
  expectedFinal,
  isCritCirclet,
  lineCeiling,
  lineScore,
  rescoreBar,
  startLines,
  thresholdScale,
  TYPICAL_CEILING,
} from './projection'
import { characterName, SLOT_LABEL, setName, statShort } from './stats'
import type {
  ArtifactConfig,
  BuildConfig,
  Confidence,
  GoodCharacter,
  Priority,
  Roster,
  RosterEntry,
  Settings,
  SlotKey,
} from './types'
import { SLOTS } from './types'

export function defaultSettings(config: ArtifactConfig): Settings {
  return {
    threshold4Line: config.scoringDefaults.levelThreshold4Line,
    threshold3Line: config.scoringDefaults.levelThreshold3Line,
    critCircletRule: config.scoringDefaults.alwaysLevelCritCircletWithOtherCritSub,
    scaleForMainStat: true,
    scaleLowBuilds: true,
    setMatch: '4pc-t12',
    commitToWornSet: true,
    offSet: 'rare',
    capOffSet: 1,
    minUpgradeChance: 0.2,
    capNormal: 3,
    capPriority: 5,
    includeUnowned: false,
    lockMarginal: false,
  }
}

/**
 * Owned level 80+ characters count by default, and so do unowned ones while planning for them; everything else
 * is ignored until switched on.
 */
export function defaultRosterEntry(owned: GoodCharacter | undefined, includeUnowned = false): RosterEntry {
  const on = owned ? owned.level >= 80 : includeUnowned
  return { priority: on ? 'normal' : 'ignore', disabledBuilds: [] }
}

export interface ActiveBuild {
  char: string
  buildIdx: number
  build: BuildConfig
  priority: Priority
  confidence: Confidence
  cap: number
  owned: boolean
}

/** One artifact judged against one build whose set and main stat it fits. */
export interface Candidate {
  ref: ActiveBuild
  setMatch: NonNullable<SetMatch>
  /** Config score: sum of weights over the starting lines. */
  lineScore: number
  /** The 3- or 4-line threshold, scaled to what this build can reach with this main stat. */
  threshold: number
  /** Why the threshold was lowered, e.g. "HP% main" or "few useful stats". */
  scaledFor: string[]
  /** For pieces past +0: projected final vs the rescore bar. */
  rescore: { bar: number } | null
  current: number
  expected: number
  gate: 'pass' | 'crit' | 'fail'
  /** Equipped piece's value for this build; null when the slot holds nothing usable. */
  bar: number | null
  chance: number
  passChance: boolean
  /** 1-based rank among this build/slot's surviving candidates (unequipped pieces only). */
  rank?: number
  rankOf?: number
  /** Off-set candidates only: rank by gain among this build's surviving off-set candidates, all slots. */
  offRank?: number
  inCap: boolean
}

export type Grade = 'keep' | 'marginal' | 'toss' | 'equipped' | 'skip'
export type Verdict = 'level' | 'continue' | 'spare' | 'trash' | 'stop' | 'feed' | 'equipped' | 'skip'

export interface Evaluation {
  piece: Piece
  grade: Grade
  verdict: Verdict
  recommendLock: boolean
  action: 'lock' | 'unlock' | null
  reason: string
  /** Candidate that decided the verdict, if any. */
  best: Candidate | null
  /** Every set+main-stat fit, best first. */
  candidates: Candidate[]
  /** For pieces worth leveling: the next level to stop at and re-check. */
  nextStop: number | null
}

export interface SlotQuality {
  /** Value of the equipped piece for this build, null if the slot is empty or has a wrong main stat. */
  value: number | null
  /** Value relative to a typical well-rolled piece for this build (1 = typical good). */
  quality: number | null
}

export interface CharacterSummary {
  char: string
  owned: boolean
  level: number | null
  priority: Priority
  active: boolean
  confidence: Confidence
  builds: { idx: number; name: string; enabled: boolean; slots: Record<SlotKey, SlotQuality> }[]
  kept: number
}

export interface EvaluationResult {
  evaluations: Evaluation[]
  setUsers: Record<string, { char: string; tier: number }[]>
  characters: CharacterSummary[]
  activeBuilds: ActiveBuild[]
}

function rosterEntry(roster: Roster, char: string, owned: GoodCharacter | undefined, includeUnowned: boolean): RosterEntry {
  return roster[char] ?? defaultRosterEntry(owned, includeUnowned)
}

/** Value of a typical well-rolled +20: the four best lines this main stat allows, average tiers, 9 rolls. */
function referenceValue(build: BuildConfig, main: string): number {
  return lineCeiling(build.substats, main) * 0.85 * 2.25
}

const pct = (x: number) => `${Math.round(x * 100)}%`
const num = (x: number) => x.toFixed(2)

/** Lines worth at least half the best weight this piece could have rolled. */
function weightedLines(piece: Piece, build: BuildConfig): string {
  const w = build.substats
  const top = Math.max(0, ...Object.entries(w).filter(([k]) => k !== piece.mainStatKey).map(([, v]) => v))
  const keys = [...piece.substats, ...(piece.unactivatedSubstats ?? [])]
    .filter((s) => (w[s.key] ?? 0) > 0 && (w[s.key] ?? 0) >= top / 2)
    .map((s) => statShort(s.key))
  return keys.length ? keys.join('+') : 'no key lines'
}

function describeKeep(c: Candidate, piece: Piece): string {
  const who = `${characterName(c.ref.char)}${c.ref.build.name ? ` (${c.ref.build.name})` : ''}`
  const parts = [who, describeSetMatch(c.setMatch)]
  if (c.gate === 'crit') parts.push('crit circlet')
  else if (c.rescore) parts.push(`projected ${num(c.expected)} ≥ ${num(c.rescore.bar)}`)
  else {
    const note = c.scaledFor.length ? ` (${c.scaledFor.join(', ')})` : ''
    parts.push(`${weightedLines(piece, c.ref.build)} ${num(c.lineScore)} ≥ ${num(c.threshold)}${note}`)
  }
  parts.push(c.bar === null ? `no usable ${piece.slotKey} worn` : `${pct(c.chance)} to beat current`)
  if (c.rank) parts.push(`#${c.rank} of ${c.rankOf}`)
  return parts.join(' · ')
}

/** Threshold multiplier for a build and main stat, with the reasons it's below 1. */
function scaling(weights: Record<string, number>, main: string, settings: Settings) {
  const full = lineCeiling(weights)
  const why: string[] = []
  if (settings.scaleForMainStat && lineCeiling(weights, main) < full - 1e-9) why.push(`${statShort(main)} main`)
  if (settings.scaleLowBuilds && full < TYPICAL_CEILING - 1e-9) why.push('few useful stats')
  return { scale: thresholdScale(weights, main, settings), why }
}

export function evaluate(
  pieces: Piece[],
  ownedChars: GoodCharacter[],
  config: ArtifactConfig,
  settings: Settings,
  roster: Roster,
): EvaluationResult {
  const ownedMap = new Map(ownedChars.map((c) => [c.key, c]))

  // 1. Who counts.
  const activeBuilds: ActiveBuild[] = []
  const characters: CharacterSummary[] = []
  for (const [char, cc] of Object.entries(config.characters)) {
    const owned = ownedMap.get(char)
    if (!owned && !settings.includeUnowned) continue
    const entry = rosterEntry(roster, char, owned, settings.includeUnowned)
    const active = cc.enabled && entry.priority !== 'ignore'
    const summary: CharacterSummary = {
      char,
      owned: !!owned,
      level: owned?.level ?? null,
      priority: entry.priority,
      active,
      confidence: cc.confidence,
      builds: [],
      kept: 0,
    }
    cc.builds.forEach((build, buildIdx) => {
      const enabled = !entry.disabledBuilds.includes(buildIdx)
      summary.builds.push({ idx: buildIdx, name: build.name, enabled, slots: {} as Record<SlotKey, SlotQuality> })
      if (!active || !enabled) return
      activeBuilds.push({
        char,
        buildIdx,
        build,
        priority: entry.priority,
        confidence: cc.confidence,
        cap: entry.priority === 'priority' ? settings.capPriority : settings.capNormal,
        owned: !!owned,
      })
    })
    characters.push(summary)
  }

  // 2. What each character wears now.
  const equipped = new Map<string, Piece>()
  for (const p of pieces) if (p.owner) equipped.set(`${p.owner}|${p.slotKey}`, p)
  const usable = (char: string, build: BuildConfig, slot: SlotKey): Piece | null => {
    const eq = equipped.get(`${char}|${slot}`)
    return eq && eq.rarity === 5 && mainStatOk(build, eq) ? eq : null
  }
  const barFor = (char: string, build: BuildConfig, slot: SlotKey): number | null => {
    const eq = usable(char, build, slot)
    return eq ? expectedFinal(eq, build.substats) : null
  }
  for (const summary of characters) {
    for (const b of summary.builds) {
      const build = config.characters[summary.char].builds[b.idx]
      for (const slot of SLOTS) {
        const eq = usable(summary.char, build, slot)
        const value = eq ? expectedFinal(eq, build.substats) : null
        b.slots[slot] = { value, quality: eq && value !== null ? value / referenceValue(build, eq.mainStatKey) : null }
      }
    }
  }

  // A build whose character already wears one of its 4pc sets is committed to it: another set's pieces only
  // count if that set is ranked a better tier (worth switching to). Pieces they're wearing always count.
  const commitment = new Map<ActiveBuild, { set: string; tier: number }>()
  if (settings.commitToWornSet) {
    const worn = new Map<string, Record<string, number>>()
    for (const p of pieces) {
      if (!p.owner) continue
      const sets = worn.get(p.owner) ?? {}
      sets[p.setKey] = (sets[p.setKey] ?? 0) + 1
      worn.set(p.owner, sets)
    }
    for (const ref of activeBuilds) {
      const sets = worn.get(ref.char) ?? {}
      const listed = ref.build.sets4.filter((s) => (sets[s.set] ?? 0) >= 4)
      if (listed.length) commitment.set(ref, { set: listed[0].set, tier: Math.min(...listed.map((s) => s.tier)) })
    }
  }
  const setFor = (ref: ActiveBuild, piece: Piece): SetMatch => {
    const match = matchSet(ref.build, piece.setKey, config, settings.setMatch)
    const committed = commitment.get(ref)
    const sidelined =
      match?.kind === '4pc' &&
      !!committed &&
      piece.owner !== ref.char &&
      piece.setKey !== committed.set &&
      match.tier >= committed.tier
    return sidelined ? null : match
  }

  // Threshold scaling depends only on the build and the main stat.
  const scales = new Map<string, ReturnType<typeof scaling>>()
  const scaleFor = (ref: ActiveBuild, main: string) => {
    const key = `${ref.char}|${ref.buildIdx}|${main}`
    let s = scales.get(key)
    if (!s) scales.set(key, (s = scaling(ref.build.substats, main, settings)))
    return s
  }

  // 3. Judge every piece against every active build it fits.
  const perPiece: Candidate[][] = pieces.map((piece) => {
    if (piece.rarity !== 5) return []
    const out: Candidate[] = []
    const lines = startLines(piece)
    const baseThreshold = lines === 4 ? settings.threshold4Line : settings.threshold3Line
    const crit = settings.critCircletRule && isCritCirclet(piece)
    const offSet = offSetAllowed(settings.offSet, piece)
    for (const ref of activeBuilds) {
      const setMatch: SetMatch = setFor(ref, piece) ?? (offSet ? { kind: 'off' } : null)
      if (!setMatch || !mainStatOk(ref.build, piece)) continue
      const w = ref.build.substats
      const { scale, why } = scaleFor(ref, piece.mainStatKey)
      const threshold = baseThreshold * scale
      const score = lineScore(piece, w)
      const expected = expectedFinal(piece, w)
      const rescore = piece.level >= 4 ? { bar: rescoreBar(threshold, lines) } : null
      const passesGate = rescore ? expected >= rescore.bar - 1e-9 : score >= threshold - 1e-9
      const gate = passesGate ? 'pass' : crit ? 'crit' : 'fail'
      const bar = piece.owner === ref.char ? null : barFor(ref.char, ref.build, piece.slotKey)
      const chance = gate === 'fail' ? 0 : chanceToBeat(piece, w, bar)
      out.push({
        ref,
        setMatch,
        lineScore: score,
        threshold,
        scaledFor: why,
        rescore,
        current: currentValue(piece, w),
        expected,
        gate,
        bar,
        chance,
        passChance: gate !== 'fail' && chance >= settings.minUpgradeChance - 1e-9,
        inCap: false,
      })
    }
    return out
  })

  // 4. Off-set lane: a build holds one off-set piece, so only its best few off-set candidates (by gain over
  //    what's worn, across all slots) go on to compete with on-set pieces for a slot.
  const gainOver = (c: Candidate) => c.expected - (c.bar ?? 0)
  const offPools = new Map<string, Candidate[]>()
  pieces.forEach((piece, i) => {
    if (piece.owner) return
    for (const cand of perPiece[i]) {
      if (cand.setMatch.kind !== 'off' || !cand.passChance) continue
      const key = `${cand.ref.char}|${cand.ref.buildIdx}`
      let pool = offPools.get(key)
      if (!pool) offPools.set(key, (pool = []))
      pool.push(cand)
    }
  })
  for (const pool of offPools.values()) {
    pool.sort((a, b) => gainOver(b) - gainOver(a) || b.expected - a.expected)
    pool.forEach((cand, i) => (cand.offRank = i + 1))
  }

  // 5. Cap: per build and slot, keep only the best few unequipped survivors.
  const pools = new Map<string, { piece: Piece; cand: Candidate }[]>()
  pieces.forEach((piece, i) => {
    if (piece.owner) return
    for (const cand of perPiece[i]) {
      if (!cand.passChance) continue
      if (cand.offRank !== undefined && cand.offRank > settings.capOffSet) continue
      const key = `${cand.ref.char}|${cand.ref.buildIdx}|${piece.slotKey}`
      let pool = pools.get(key)
      if (!pool) pools.set(key, (pool = []))
      pool.push({ piece, cand })
    }
  })
  for (const pool of pools.values()) {
    pool.sort((a, b) => b.cand.expected - a.cand.expected || b.piece.level - a.piece.level || b.piece.idx - a.piece.idx)
    pool.forEach(({ cand }, i) => {
      cand.rank = i + 1
      cand.rankOf = pool.length
      cand.inCap = i < cand.ref.cap
    })
  }

  // 6. Verdicts.
  const keptBy = new Map<string, number>()
  const evaluations = pieces.map((piece, i): Evaluation => {
    const candidates = perPiece[i].sort(compareCandidates)
    const ev = verdictFor(piece, candidates, settings, activeBuilds, config, setFor)
    if (ev.grade === 'keep' && ev.best) keptBy.set(ev.best.ref.char, (keptBy.get(ev.best.ref.char) ?? 0) + 1)
    return ev
  })
  for (const c of characters) c.kept = keptBy.get(c.char) ?? 0

  const setUsers: EvaluationResult['setUsers'] = {}
  for (const ref of activeBuilds) {
    for (const s of ref.build.sets4) {
      const list = (setUsers[s.set] ??= [])
      if (!list.some((u) => u.char === ref.char)) list.push({ char: ref.char, tier: s.tier })
    }
  }

  return { evaluations, setUsers, characters, activeBuilds }
}

/** Best first: in-cap, then surviving, then passing the gate, then by projected value. */
function compareCandidates(a: Candidate, b: Candidate): number {
  const level = (c: Candidate) => (c.inCap ? 3 : c.passChance ? 2 : c.gate !== 'fail' ? 1 : 0)
  return (
    level(b) - level(a) ||
    (a.rank ?? Infinity) - (b.rank ?? Infinity) ||
    b.chance - a.chance ||
    b.expected - a.expected
  )
}

function verdictFor(
  piece: Piece,
  candidates: Candidate[],
  settings: Settings,
  activeBuilds: ActiveBuild[],
  config: ArtifactConfig,
  setFor: (ref: ActiveBuild, piece: Piece) => SetMatch,
): Evaluation {
  const base = { piece, candidates, nextStop: null as number | null }
  if (piece.rarity !== 5) {
    return { ...base, grade: 'skip', verdict: 'skip', recommendLock: piece.lock, action: null, reason: 'Not 5★, not evaluated', best: null }
  }

  const best = candidates[0] ?? null
  const nextStop = piece.level < 20 ? Math.min(20, Math.floor(piece.level / 4) * 4 + 4) : null

  if (piece.owner) {
    const own = candidates.find((c) => c.ref.char === piece.owner && c.gate !== 'fail')
    const hint = piece.level < 20 && own ? ` · worth finishing (projected ${num(own.expected)})` : ''
    return {
      ...base,
      grade: 'equipped',
      verdict: 'equipped',
      recommendLock: true,
      action: piece.lock ? null : 'lock',
      reason: `Equipped on ${characterName(piece.owner)}${hint}`,
      best: own ?? null,
      nextStop: own && piece.level < 20 ? nextStop : null,
    }
  }

  let grade: Grade
  let reason: string
  if (best?.inCap) {
    grade = 'keep'
    const others = candidates.filter((c) => c.inCap).length - 1
    reason = describeKeep(best, piece) + (others > 0 ? ` · +${others} more` : '')
  } else if (best?.passChance) {
    grade = 'marginal'
    const label = piece.level === 20 ? 'Backup' : 'Redundant'
    const who = characterName(best.ref.char)
    reason =
      best.rank === undefined
        ? `${label}: #${best.offRank} off-set piece for ${who} (keeps ${settings.capOffSet})`
        : `${label}: #${best.rank} for ${who}'s ${piece.slotKey} (cap ${best.ref.cap})`
  } else if (best && best.gate !== 'fail' && piece.level === 20) {
    // A finished piece that's decent for someone is a backup, not fodder: only feed what fails the gate.
    grade = 'marginal'
    reason = `Backup: doesn't beat ${characterName(best.ref.char)}'s current ${piece.slotKey} (${num(best.expected)} vs ${num(best.bar ?? 0)})`
  } else if (best && best.gate !== 'fail') {
    grade = 'toss'
    reason = `${pct(best.chance)} chance to beat ${characterName(best.ref.char)}'s current ${piece.slotKey}`
  } else if (best) {
    grade = 'toss'
    reason = best.rescore
      ? `Rolls fell short: projected ${num(best.expected)} for ${characterName(best.ref.char)} (need ${num(best.rescore.bar)})`
      : `Subs too weak: best ${num(best.lineScore)} for ${characterName(best.ref.char)} (need ${num(best.threshold)})`
  } else {
    grade = 'toss'
    reason = noFitReason(piece, settings, activeBuilds, config, setFor)
  }

  const verdict: Verdict =
    piece.level === 20
      ? grade === 'toss'
        ? 'feed'
        : 'spare'
      : grade === 'keep'
        ? piece.level === 0
          ? 'level'
          : 'continue'
        : piece.level === 0
          ? 'trash'
          : 'stop'
  // Marginal +20s stay locked: the EXP is already spent, and the +20 tab only suggests what's safe to feed.
  const recommendLock = grade === 'keep' || (grade === 'marginal' && (settings.lockMarginal || piece.level === 20))
  const action = recommendLock === piece.lock ? null : recommendLock ? 'lock' : 'unlock'
  return {
    ...base,
    grade,
    verdict,
    recommendLock,
    action,
    reason: piece.elixirCrafted && !recommendLock ? `${reason} · elixir-crafted, double-check` : reason,
    best,
    nextStop: grade === 'keep' ? nextStop : null,
  }
}

function noFitReason(
  piece: Piece,
  settings: Settings,
  activeBuilds: ActiveBuild[],
  config: ArtifactConfig,
  setFor: (ref: ActiveBuild, piece: Piece) => SetMatch,
): string {
  const set = setName(piece.setKey)
  const slot = SLOT_LABEL[piece.slotKey].toLowerCase()
  // An off-set candidate only needs the main stat, so its absence means nobody wants that main stat at all.
  if (offSetAllowed(settings.offSet, piece)) return `No active character wants ${statShort(piece.mainStatKey)} ${slot}s`
  const users = activeBuilds.filter((ref) => matchSet(ref.build, piece.setKey, config, settings.setMatch))
  if (users.length && users.every((ref) => !setFor(ref, piece))) {
    return `${set} users already wear a set they rank as high or higher`
  }
  const usesSet = users.length > 0
  if (!usesSet || piece.slotKey === 'flower' || piece.slotKey === 'plume') {
    return settings.setMatch === 'config'
      ? `No active character uses ${set}`
      : `No active character uses 4pc ${set}`
  }
  return `${set} users don't want ${statShort(piece.mainStatKey)} ${slot}s`
}
