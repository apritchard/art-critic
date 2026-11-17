import { swapSetFit } from './farm'
import type { Piece } from './load'
import { describeSetMatch, fourPieceSets, mainStatOk, matchSet, offSetAllowed, type SetMatch } from './match'
import {
  chanceToBeat,
  currentValue,
  expectedFinal,
  isCritCirclet,
  knownReveal,
  lineCeiling,
  lineScore,
  nextStop,
  rescoreBar,
  startLines,
  thresholdScale,
  TYPICAL_CEILING,
  usefulLineCount,
} from './projection'
import { characterName, onlyTopKept, SLOT_LABEL, setName, slotPlural, statShort } from './stats'
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
    requireTwoLines: true,
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

/** With Settings → requireTwoLines, how many lines a +0 needs that its build uses at all. */
export const MIN_USEFUL_LINES = 2

/** The +0 gate failed only because too few of the piece's lines are stats the build uses: the weight was enough. */
export const tooFewLines = (c: Candidate) =>
  c.gate === 'fail' && !c.rescore && c.lineScore >= c.threshold - 1e-9 && c.usefulLines < MIN_USEFUL_LINES

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
  /**
   * On the user's Building list: who they're working on right now. It changes no verdict, only order: these come
   * first in lists, get first pick of a spare two characters want, and can be what farming is ranked for.
   */
  building?: boolean
}

/**
 * Who a reason or a pick is for, as lists rank them: 2 for a character on the Building list, 1 for a ★ Priority
 * character (or anyone, when `anyStar` says nobody is ★), 0 otherwise. Building characters count whether or not they're
 * ★, so a piece for one gets its leveling badge's heat.
 */
export function standing(ref: Pick<ActiveBuild, 'priority' | 'building'>, anyStar: boolean): 0 | 1 | 2 {
  if (ref.building) return 2
  return ref.priority === 'priority' || !anyStar ? 1 : 0
}

/** One artifact judged against one build whose set and main stat it fits. */
export interface Candidate {
  ref: ActiveBuild
  setMatch: NonNullable<SetMatch>
  /** Config score: sum of weights over the starting lines. */
  lineScore: number
  /** How many of its lines the build uses at all; at +0 the gate needs MIN_USEFUL_LINES (Settings → requireTwoLines). */
  usefulLines: number
  /** The 3- or 4-line threshold, scaled to what this build can reach with this main stat. */
  threshold: number
  /** Why the threshold was lowered, e.g. "HP% main" or "few useful stats". */
  scaledFor: string[]
  /**
   * Projected final vs the rescore bar: for pieces at +4 or more, and for a 3-liner whose known 4th line (`knownReveal`)
   * passed the +0 rule, since it's judged now as it will be at +4. Null when the +0 rule on its lines decides.
   */
  rescore: { bar: number } | null
  current: number
  expected: number
  gate: 'pass' | 'crit' | 'fail'
  /**
   * What the piece has to beat for this build: what the character wears, or for a piece still to level, their best
   * finished spare when that's better (`spare`). Null when there's nothing usable, so any piece is an upgrade.
   */
  bar: number | null
  /** Id of the finished spare that sets `bar`, when it beats what's worn. */
  spare?: string
  chance: number
  passChance: boolean
  /** 1-based rank among this build/slot's surviving candidates (unequipped pieces still to level only). */
  rank?: number
  rankOf?: number
  /** Off-set candidates only: rank by gain among this build's surviving off-set candidates in the same slot. */
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
  /** For pieces worth leveling: the next level to stop at and re-check (`nextStop`: +8 for a 3-liner still at +0). */
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
  /** On the user's Building list. */
  building: boolean
  active: boolean
  confidence: Confidence
  builds: { idx: number; name: string; enabled: boolean; slots: Record<SlotKey, SlotQuality> }[]
  kept: number
}

export interface EvaluationResult {
  evaluations: Evaluation[]
  /** Who lists each set, at their best tier; `twoPieceOnly` when every build of theirs keeps it for 2pc pairs only. */
  setUsers: Record<string, { char: string; tier: number; twoPieceOnly?: true }[]>
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
  else if (c.rescore) parts.push(`${piece.level >= 20 ? 'value' : 'projected'} ${num(c.expected)} ≥ ${num(c.rescore.bar)}`)
  else {
    const note = c.scaledFor.length ? ` (${c.scaledFor.join(', ')})` : ''
    parts.push(`${weightedLines(piece, c.ref.build)} ${num(c.lineScore)} ≥ ${num(c.threshold)}${note}`)
  }
  parts.push(
    c.bar === null
      ? `no usable ${piece.slotKey} worn`
      : piece.level >= 20
        ? // A finished piece has no rolls left: it beats what's worn or it doesn't.
          `beats current (${num(c.expected)} vs ${num(c.bar)})`
        : `${pct(c.chance)} to beat ${c.spare ? 'their best spare +20' : 'current'}`,
  )
  if (c.rank) parts.push(`#${c.rank} of ${c.rankOf}`)
  return parts.join(' · ')
}

/**
 * Which of a character's builds a reason means, when they have more than one active build: the name up to any
 * bracket ("C6 hybrid" for "C6 hybrid (Bloom + Hydro DMG)"), or all of it if two of their builds share that much.
 * Null for a character with one active build, where the name is enough.
 */
function buildLabel(ref: ActiveBuild, activeBuilds: ActiveBuild[]): string | null {
  const theirs = activeBuilds.filter((r) => r.char === ref.char)
  if (theirs.length < 2 || !ref.build.name) return null
  const short = (name: string) => name.replace(/\s*\(.*\)\s*$/, '') || name
  const name = short(ref.build.name)
  return theirs.some((r) => r.buildIdx !== ref.buildIdx && short(r.build.name) === name) ? ref.build.name : name
}

/** "Nilou's C6 hybrid build" for a character with several active builds, or just "Diluc". */
function whoFor(ref: ActiveBuild, activeBuilds: ActiveBuild[]): string {
  const build = buildLabel(ref, activeBuilds)
  return build ? `${characterName(ref.char)}'s ${build} build` : characterName(ref.char)
}

/** What follows a possessive ("Nilou's current circlet") to say which build: " for their C6 hybrid build", or nothing. */
function forBuild(ref: ActiveBuild, activeBuilds: ActiveBuild[]): string {
  const build = buildLabel(ref, activeBuilds)
  return build ? ` for their ${build} build` : ''
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
  /** Characters on the user's Building list: they sort first, but are judged like anyone else. */
  building: ReadonlySet<string> = new Set(),
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
      building: building.has(char),
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
        building: building.has(char),
      })
    })
    characters.push(summary)
  }

  // 2–6. What each character wears, and every piece judged against every active build.
  const { perPiece, usable, barFor, setFor } = judge(pieces, activeBuilds, config, settings)
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

  // 7. Verdicts. A piece no build can use is still shown what it would be worth as someone's off-set piece.
  const spares = pieces.filter((p) => !p.owner && p.rarity === 5)
  const gainFor = (ref: ActiveBuild, p: Piece): number | null =>
    mainStatOk(ref.build, p) ? expectedFinal(p, ref.build.substats) - (barFor(ref.char, ref.build, p.slotKey) ?? 0) : null
  const spareGains = new Map<ActiveBuild, number[]>()
  const offStanding = (piece: Piece): OffStanding | null => {
    let best: { ref: ActiveBuild; gain: number } | null = null
    for (const ref of activeBuilds) {
      const gain = gainFor(ref, piece)
      if (gain !== null && (!best || gain > best.gain)) best = { ref, gain }
    }
    if (!best) return null
    const { ref, gain } = best
    let gains = spareGains.get(ref)
    if (!gains) spareGains.set(ref, (gains = spares.flatMap((p) => gainFor(ref, p) ?? [])))
    return {
      char: ref.char,
      build: buildLabel(ref, activeBuilds),
      gain,
      bar: barFor(ref.char, ref.build, piece.slotKey),
      better: gains.filter((g) => g > gain + 1e-9).length,
    }
  }

  // Reasons name the spare a piece is measured against.
  const byId = new Map(pieces.map((p) => [p.id, p]))
  const keptBy = new Map<string, number>()
  const evaluations = pieces.map((piece, i): Evaluation => {
    const candidates = perPiece[i].sort(compareCandidates)
    const ev = verdictFor(piece, candidates, settings, activeBuilds, config, setFor, offStanding, (id) => byId.get(id))
    if (ev.grade === 'keep' && ev.best) keptBy.set(ev.best.ref.char, (keptBy.get(ev.best.ref.char) ?? 0) + 1)
    return ev
  })
  for (const c of characters) c.kept = keptBy.get(c.char) ?? 0

  // Per character, the best tier any of their builds gives a set, and whether all of them keep it for 2pc pairs only.
  const setUsers: EvaluationResult['setUsers'] = {}
  for (const ref of activeBuilds) {
    for (const s of ref.build.sets4) {
      const list = (setUsers[s.set] ??= [])
      const user = list.find((u) => u.char === ref.char)
      if (!user) list.push(s.twoPieceOnly ? { char: ref.char, tier: s.tier, twoPieceOnly: true } : { char: ref.char, tier: s.tier })
      else {
        user.tier = Math.min(user.tier, s.tier)
        if (!s.twoPieceOnly) delete user.twoPieceOnly
      }
    }
  }

  return { evaluations, setUsers, characters, activeBuilds }
}

/** How many pieces of each set every character wears. */
export function wornSets(pieces: Piece[]): Map<string, Record<string, number>> {
  const worn = new Map<string, Record<string, number>>()
  for (const p of pieces) {
    if (!p.owner) continue
    const sets = worn.get(p.owner) ?? {}
    sets[p.setKey] = (sets[p.setKey] ?? 0) + 1
    worn.set(p.owner, sets)
  }
  return worn
}

/** The build's 4pc set the character wears (`sets` as `wornSets` counts them), which the build sticks to. */
export function commitmentOf(build: BuildConfig, sets: Record<string, number>): { set: string; tier: number } | null {
  const listed = fourPieceSets(build).filter((s) => (sets[s.set] ?? 0) >= 4)
  return listed.length ? { set: listed[0].set, tier: Math.min(...listed.map((s) => s.tier)) } : null
}

/** Every piece's candidates for a list of builds, and the helpers the verdicts need. */
export interface Judgement {
  /** Each piece's candidates, in `pieces` order: one per build whose set (or off-set lane) and main stat it fits. */
  perPiece: Candidate[][]
  /** The character's equipped 5★ piece in a slot, if its main stat suits the build. */
  usable: (char: string, build: BuildConfig, slot: SlotKey) => Piece | null
  /** Value of what the character wears in a slot for a build; null when nothing usable. */
  barFor: (char: string, build: BuildConfig, slot: SlotKey) => number | null
  /** How a piece's set counts for a build, after sticking to the worn set. */
  setFor: (ref: ActiveBuild, piece: Piece) => SetMatch
  /**
   * Whether the character could put the piece on in its slot and keep their sets fit for the build (`swapSetFit`, as
   * free upgrades judge it). Only a finished spare that passes this raises the bar for on-set pieces still to level.
   */
  wearable: (ref: ActiveBuild, piece: Piece) => boolean
}

/**
 * Layers 1–4 and the cap for the given builds. Each build is judged on its own (its worn set, off-set lane and cap
 * pools are its own), so a what-if run can pass edited copies of builds and read their candidates directly.
 */
export function judge(pieces: Piece[], activeBuilds: ActiveBuild[], config: ArtifactConfig, settings: Settings): Judgement {
  // What each character wears now.
  const equipped = new Map<string, Piece>()
  for (const p of pieces) if (p.owner) equipped.set(`${p.owner}|${p.slotKey}`, p)
  const worn = wornSets(pieces)
  const wearable = (ref: ActiveBuild, piece: Piece): boolean =>
    !!swapSetFit(worn.get(ref.char) ?? {}, equipped.get(`${ref.char}|${piece.slotKey}`)?.setKey, piece.setKey, ref.build, config)
  const usable = (char: string, build: BuildConfig, slot: SlotKey): Piece | null => {
    const eq = equipped.get(`${char}|${slot}`)
    return eq && eq.rarity === 5 && mainStatOk(build, eq) ? eq : null
  }
  // Asked for every piece and build, so remembered per build, character and slot.
  const bars = new Map<BuildConfig, Map<string, number | null>>()
  const barFor = (char: string, build: BuildConfig, slot: SlotKey): number | null => {
    let byBuild = bars.get(build)
    if (!byBuild) bars.set(build, (byBuild = new Map()))
    const key = `${char}|${slot}`
    if (!byBuild.has(key)) {
      const eq = usable(char, build, slot)
      byBuild.set(key, eq ? expectedFinal(eq, build.substats) : null)
    }
    return byBuild.get(key)!
  }

  // A build whose character already wears one of its 4pc sets is committed to it: another set's pieces only
  // count if that set is ranked a better tier (worth switching to). Pieces they're wearing always count. A 4pc of
  // a set the build keeps for 2pc pairs only commits it to nothing, so its partner sets keep counting.
  const commitment = new Map<ActiveBuild, { set: string; tier: number }>()
  if (settings.commitToWornSet) {
    for (const ref of activeBuilds) {
      const committed = commitmentOf(ref.build, worn.get(ref.char) ?? {})
      if (committed) commitment.set(ref, committed)
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

  // 3. Judge every piece against every active build it fits: set, main stat and substat gate.
  const perPiece: Candidate[][] = pieces.map((piece) => {
    if (piece.rarity !== 5) return []
    const out: Candidate[] = []
    const lines = startLines(piece)
    const baseThreshold = lines === 4 ? settings.threshold4Line : settings.threshold3Line
    const crit = settings.critCircletRule && isCritCirclet(piece)
    const reveal = knownReveal(piece)
    const offSet = offSetAllowed(settings.offSet, piece)
    for (const ref of activeBuilds) {
      const setMatch: SetMatch = setFor(ref, piece) ?? (offSet ? { kind: 'off' } : null)
      if (!setMatch || !mainStatOk(ref.build, piece)) continue
      const w = ref.build.substats
      const { scale, why } = scaleFor(ref, piece.mainStatKey)
      const threshold = baseThreshold * scale
      const score = lineScore(piece, w)
      const expected = expectedFinal(piece, w)
      const useful = usefulLineCount(piece, w)
      const linesPass = score >= threshold - 1e-9 && (!settings.requireTwoLines || useful >= MIN_USEFUL_LINES)
      // A 3-liner's +4 only reveals its 4th line, which the export already gives, so it isn't a stop: it has to pass
      // the +0 rule and then, right away, the rescore it would face at +4 (its projection is the same there).
      const rescore = piece.level >= 4 || (reveal && linesPass) ? { bar: rescoreBar(threshold, lines) } : null
      const passesGate = rescore ? expected >= rescore.bar - 1e-9 : linesPass
      const gate = passesGate ? 'pass' : crit ? 'crit' : 'fail'
      out.push({
        ref,
        setMatch,
        lineScore: score,
        usefulLines: useful,
        threshold,
        scaledFor: why,
        rescore,
        current: currentValue(piece, w),
        expected,
        gate,
        // Set in step 4, once the finished spares are known.
        bar: null,
        chance: 0,
        passChance: false,
        inCap: false,
      })
    }
    return out
  })

  // 4. Upgrade chance. A finished piece is judged against what the character wears. A piece still to level is judged
  //    against the best they have: what they wear, or their best finished spare for the slot when that's better. A
  //    piece on the build's set only meets spares the character could put on now without breaking their sets
  //    (`wearable`), so an off-set spare doesn't count while their one off-set slot is elsewhere. An off-set piece is
  //    judged as if the off-set slot moved to its slot (step 5), so it meets every spare, off-set ones included. A
  //    good spare thins out weak pieces through their odds, rather than by taking a cap place (step 6).
  const finished = (p: Piece) => p.level >= 20
  type Spare = { value: number; id: string }
  const spares = { any: new Map<string, Spare>(), wearable: new Map<string, Spare>() }
  const offer = (pool: Map<string, Spare>, key: string, value: number, id: string) => {
    const best = pool.get(key)
    if (!best || value > best.value) pool.set(key, { value, id })
  }
  pieces.forEach((piece, i) => {
    if (piece.owner || !finished(piece)) return
    for (const cand of perPiece[i]) {
      if (cand.gate === 'fail') continue
      const key = `${cand.ref.char}|${cand.ref.buildIdx}|${piece.slotKey}`
      offer(spares.any, key, cand.expected, piece.id)
      if (wearable(cand.ref, piece)) offer(spares.wearable, key, cand.expected, piece.id)
    }
  })
  pieces.forEach((piece, i) => {
    for (const cand of perPiece[i]) {
      const { ref } = cand
      let bar = piece.owner === ref.char ? null : barFor(ref.char, ref.build, piece.slotKey)
      const pool = cand.setMatch.kind === 'off' ? spares.any : spares.wearable
      const spare = piece.owner !== ref.char && !finished(piece) ? pool.get(`${ref.char}|${ref.buildIdx}|${piece.slotKey}`) : undefined
      if (spare && (bar === null || spare.value > bar + 1e-9)) {
        bar = spare.value
        cand.spare = spare.id
      }
      cand.bar = bar
      cand.chance = cand.gate === 'fail' ? 0 : chanceToBeat(piece, ref.build.substats, bar)
      cand.passChance = cand.gate !== 'fail' && cand.chance >= settings.minUpgradeChance - 1e-9
      // A finished piece takes no cap place: it's kept if it beats what's worn.
      if (finished(piece) && !piece.owner) cand.inCap = cand.passChance
    }
  })

  // 5. Off-set lane: only a build's best few off-set candidates per slot (by gain over its bar) go on to compete with
  //    on-set pieces for that slot. Ranked within the slot, since which slot ends up holding the off-set piece is
  //    open: a Physical DMG goblet competes with other goblets, not with a better circlet. Pieces still to level only.
  const gainOver = (c: Candidate) => c.expected - (c.bar ?? 0)
  const offPools = new Map<string, Candidate[]>()
  pieces.forEach((piece, i) => {
    if (piece.owner || finished(piece)) return
    for (const cand of perPiece[i]) {
      if (cand.setMatch.kind !== 'off' || !cand.passChance) continue
      const key = `${cand.ref.char}|${cand.ref.buildIdx}|${piece.slotKey}`
      let pool = offPools.get(key)
      if (!pool) offPools.set(key, (pool = []))
      pool.push(cand)
    }
  })
  for (const pool of offPools.values()) {
    pool.sort((a, b) => gainOver(b) - gainOver(a) || b.expected - a.expected)
    pool.forEach((cand, i) => (cand.offRank = i + 1))
  }

  // 6. Cap: per build and slot, keep only the best few unequipped pieces still to level. Finished pieces take no
  //    place: they can't roll any further, and the best of them already raised the bar in step 4.
  const pools = new Map<string, { piece: Piece; cand: Candidate }[]>()
  pieces.forEach((piece, i) => {
    if (piece.owner || finished(piece)) return
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

  return { perPiece, usable, barFor, setFor, wearable }
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
  offStanding: (piece: Piece) => OffStanding | null,
  pieceById: (id: string) => Piece | undefined,
): Evaluation {
  const base = { piece, candidates, nextStop: null as number | null }
  if (piece.rarity !== 5) {
    return { ...base, grade: 'skip', verdict: 'skip', recommendLock: piece.lock, action: null, reason: 'Not 5★, not evaluated', best: null }
  }

  const best = candidates[0] ?? null
  const stop = nextStop(piece)

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
      nextStop: own ? stop : null,
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
    // Only pieces still to level reach here: a finished one takes no cap place.
    const who = whoFor(best.ref, activeBuilds)
    const slots = slotPlural(piece.slotKey)
    reason =
      best.rank === undefined
        ? `Redundant: #${best.offRank} of the off-set ${slots} for ${who}, and ${onlyTopKept(settings.capOffSet)} (Settings → Off-set pieces)`
        : `Redundant: #${best.rank} of the ${slots} for ${who}, and ${onlyTopKept(best.ref.cap)} (Settings → Keep cap)`
  } else if (best && best.gate !== 'fail' && piece.level === 20) {
    // A finished piece that's decent for someone is a backup, not fodder: only feed what fails the gate.
    grade = 'marginal'
    reason = `Backup: doesn't beat ${characterName(best.ref.char)}'s current ${piece.slotKey}${forBuild(best.ref, activeBuilds)} (${num(best.expected)} vs ${num(best.bar ?? 0)})`
  } else if (best && best.gate !== 'fail') {
    grade = 'toss'
    const whose = `${characterName(best.ref.char)}'s`
    const spare = best.spare ? pieceById(best.spare) : undefined
    reason = best.spare
      ? `${pct(best.chance)} chance to beat ${whose} best spare${forBuild(best.ref, activeBuilds)}, a +20 ${spare ? `${setName(spare.setKey)} ` : ''}${piece.slotKey}, which already beats what they wear`
      : `${pct(best.chance)} chance to beat ${whose} current ${piece.slotKey}${forBuild(best.ref, activeBuilds)}`
  } else if (best) {
    grade = 'toss'
    const who = whoFor(best.ref, activeBuilds)
    const used = [...piece.substats, ...(piece.unactivatedSubstats ?? [])]
      .filter((s) => (best.ref.build.substats[s.key] ?? 0) > 0)
      .map((s) => statShort(s.key))
    reason = best.rescore
      ? piece.level < 4
        ? `Starting rolls too low: projected ${num(best.expected)} for ${who} with the 4th line +4 reveals (need ${num(best.rescore.bar)})`
        : `Rolls fell short: projected ${num(best.expected)} for ${who} (need ${num(best.rescore.bar)})`
      : tooFewLines(best)
        ? `Too few useful lines: only ${used.join(' + ')} is a stat ${who} uses (needs ${MIN_USEFUL_LINES})`
        : `Subs too weak: best ${num(best.lineScore)} for ${who} (need ${num(best.threshold)})`
  } else {
    grade = 'toss'
    reason = noFitReason(piece, settings, activeBuilds, config, setFor, offStanding)
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
    nextStop: grade === 'keep' ? stop : null,
  }
}

function noFitReason(
  piece: Piece,
  settings: Settings,
  activeBuilds: ActiveBuild[],
  config: ArtifactConfig,
  setFor: (ref: ActiveBuild, piece: Piece) => SetMatch,
  offStanding: (piece: Piece) => OffStanding | null,
): string {
  const set = setName(piece.setKey)
  const slot = SLOT_LABEL[piece.slotKey].toLowerCase()
  // An off-set candidate only needs the main stat, so its absence means nobody wants that main stat at all.
  if (offSetAllowed(settings.offSet, piece)) return `No active character wants ${statShort(piece.mainStatKey)} ${slotPlural(piece.slotKey)}`
  const standing = describeOffStanding(offStanding(piece), slot)
  const users = activeBuilds.filter((ref) => matchSet(ref.build, piece.setKey, config, settings.setMatch))
  if (users.length && users.every((ref) => !setFor(ref, piece))) {
    return `${set} users already wear a set they rank as high or higher${standing}`
  }
  const usesSet = users.length > 0
  if (!usesSet || piece.slotKey === 'flower' || piece.slotKey === 'plume') {
    return `${settings.setMatch === 'config' ? `No active character uses ${set}` : `No active character uses 4pc ${set}`}${standing}`
  }
  return `${set} users don't want ${statShort(piece.mainStatKey)} ${slotPlural(piece.slotKey)}${standing}`
}

/**
 * What a piece no build can use would do as someone's off-set piece, which the Off-set setting leaves out: its
 * biggest expected gain over what a character wears in that slot, and how many spares (any set, any slot) would
 * gain that character more. Shown in the reason only; it never changes a verdict.
 */
export interface OffStanding {
  char: string
  /** Which of `char`'s builds, when they have more than one active (`buildLabel`). */
  build: string | null
  gain: number
  /** What `char` wears in that slot now; null if nothing usable. */
  bar: number | null
  better: number
}

function describeOffStanding(s: OffStanding | null, slot: string): string {
  if (!s) return ''
  if (s.gain < 0.05) return ` · as an off-set ${slot} it wouldn't beat what anyone wears`
  const name = characterName(s.char)
  const who = s.build ? `${name}'s ${s.build} build` : name
  const from = s.bar === null ? 'nothing usable' : num(s.bar)
  const rest = s.better
    ? `, but ${s.better} other spare${s.better === 1 ? '' : 's'} would gain ${s.build ? 'that build' : name} more`
    : `, more than any other spare would: Settings → Off-set "Any" keeps it`
  return ` · as an off-set ${slot}: +${num(s.gain)} for ${who} (${from} → ${num((s.bar ?? 0) + s.gain)})${rest}`
}
