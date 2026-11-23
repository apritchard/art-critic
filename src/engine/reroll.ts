// Dust of Enlightenment: which pieces are most likely to come out better from a reroll, worn or spare: +20s, and
// pieces from +12 that would be leveled to +20 first.
import { erCap, erNeed, totalER, withoutER, type ErModel } from './er'
import { standing, type ActiveBuild, type EvaluationResult } from './evaluate'
import { freeSwaps, swapSetFit, wearing } from './farm'
import { expBetween } from './fodder'
import type { Piece } from './load'
import { mainStatOk } from './match'
import { currentValue, expectedFinal, gainDistribution, lineWeights, remainingRolls, STEP } from './projection'
import { AVG_TIER, MAX_ROLL, ROLL_TIERS } from './stats'
import { SLOTS, type ArtifactConfig, type BuildConfig, type SlotKey } from './types'

const ER = 'enerRech_'

/** Dust of Enlightenment per reroll, by slot. */
export const DUST_COST: Record<SlotKey, number> = { flower: 1, plume: 1, sands: 2, goblet: 2, circlet: 2 }

/**
 * Only a +20 can be rerolled, but a piece from this level on is judged as if leveled to +20 first: most of its EXP is
 * already in, and the reroll redoes its upgrades from the starting lines, so bad early rolls don't count against it.
 */
export const REROLL_FROM = 12

/** A 5★ piece the Dust tab considers: a +20, or one from REROLL_FROM to level to +20 first. */
export const rerollable = (piece: Piece) => piece.rarity === 5 && piece.level >= REROLL_FROM

/** Leveling a piece to +20 before its reroll: where it is, the EXP that takes, and its average value once there. */
export interface Finish {
  level: number
  exp: number
  /** Its average value at +20 (expectedFinal), which the reroll has to beat. */
  value: number
}

/** What leveling `piece` to +20 takes and leaves, judged by `weights`; null for a +20. */
export const finishOf = (piece: Piece, weights: Record<string, number>): Finish | null =>
  piece.level >= 20 ? null : { level: piece.level, exp: expBetween(piece.level, 20), value: expectedFinal(piece, weights) }

/**
 * Upgrades guaranteed to land on the two chosen lines: 2 normally, 3 once Advanced Reshape is unlocked,
 * 4 with Decreed Reshape.
 */
export type Guarantee = 2 | 3 | 4

export interface RerollOdds {
  /** The two lines to pick: the piece's highest-weighted ones, unless the character's ER needs protecting. */
  chosen: string[]
  /**
   * Chance the rerolled piece beats it as it is, or for a spare, what the character wears (`bar` in rerollOdds).
   * You can keep the old one, so a reroll never loses value.
   */
  chance: number
  /** Expected improvement over the same, counting a worse result as 0 since you'd keep the old one. */
  gain: number
  /** Expected value of the rerolled piece. */
  expected: number
  /** Average ER line (in %) after the reroll, when the piece has one. */
  erAfter?: number
  /** The character's ER needs this line: only results keeping enough count as better, and the pick may include ER. */
  erBound?: boolean
}

export interface RerollOption extends RerollOdds {
  piece: Piece
  /** The wearer's build, or for a spare, the build of the character it would go to. */
  ref: ActiveBuild
  /** The piece's value for `ref` as it is. */
  current: number
  /** A piece still to level: leveled to +20 first, and the reroll measured against it there (see rerollOdds). */
  finish: Finish | null
  /**
   * A spare +20 (unequipped): the piece it would replace and that piece's value, which a reroll has to beat for the
   * gain to count. Null for a worn piece, which only has to beat itself.
   */
  spare: { replaces: Piece; bar: number } | null
  /** Upgrades that landed on lines this build gives no weight. */
  wasted: number
  upgrades: number
  cost: number
  /**
   * Someone else this worn piece already upgrades as it is (keeping their set bonuses), the highest-ranked first
   * (📌 Building, then ★ Priority: `standing`), then by gain. Ranked at or above the wearer, move it rather than
   * reroll. Ranked `below` the wearer, it's only noted: the wearer comes first, so the reroll still counts.
   */
  elsewhere: { char: string; from: number | null; to: number; below: boolean } | null
  /** The wearer's total ER (%) now and on average after the reroll, and the build's minimum and cap; null if unknown. */
  er: { now: number; after: number; need: number | null; cap: number | null } | null
}

/**
 * How to reroll a worn piece whose wearer has `total` ER (null if unknown). `erMin` is the least its ER line may
 * end at (see rerollOdds). An ER line the wearer could lose entirely and still be at their ER cap is all spare, so
 * it's worth nothing and `weights` leave ER out; otherwise ER keeps its weight.
 */
export function rerollTerms(piece: Piece, build: BuildConfig, total: number | null) {
  const line = piece.substats.find((s) => s.key === ER)?.value ?? 0
  const need = erNeed(build)
  const cap = erCap(build)
  // Whatever the character has above the build's minimum is spare.
  const erMin = total !== null && need !== null ? line - Math.max(0, total - need) : null
  const spare = line > 0 && total !== null && cap !== null && total - line >= cap
  return { line, erMin, need, cap, weights: spare ? withoutER(build.substats) : build.substats }
}

/**
 * Moving beats rerolling when the piece is clearly someone else's kind of piece: it beats a real piece they
 * wear by this much, and is worth MIN_MOVE_EDGE more to them than to its wearer, and they rank at least as high
 * (`standing`). Empty slots don't count; those are what the Farm tab's free upgrades are for.
 */
const MIN_MOVE_GAIN = 1
const MIN_MOVE_EDGE = 2

export interface RerollPlan {
  /**
   * Worn pieces, then spares (each for the character it would gain most, Building then ★ Priority first): +20s, and
   * pieces from REROLL_FROM to level to +20 first.
   */
  options: RerollOption[]
  /** Worn pieces skipped because their main stat doesn't fit the build: a reroll can't fix that. */
  wrongMain: number
  /** Worn pieces the export has no starting values for. */
  noData: number
}

const choose = (n: number, k: number) => {
  let c = 1
  for (let i = 1; i <= k; i++) c = (c * (n - i + 1)) / i
  return c
}

function convolve(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(a.length + b.length - 1)
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0) continue
    for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j]
  }
  return out
}

/** Upgrades a piece has received after its starting lines: at +20, exactly what the reroll redoes. */
export const upgradesOf = (piece: Piece) => Math.max(0, Math.min(5, (piece.totalRolls ?? 9) - 4))

/** Upgrades a reroll redoes: a +20's, so for a piece still to level, those it has plus those it has left. */
export const rerolledUpgrades = (piece: Piece) => Math.min(5, upgradesOf(piece) + remainingRolls(piece))

/**
 * Upgrades that landed on each line. Each upgrade adds 0.7–1.0 of a max roll, so a line's growth bounds its
 * count; of the combinations adding up to the piece's total, take the one closest to average-sized rolls.
 */
export function upgradeCounts(piece: Piece): number[] {
  const total = upgradesOf(piece)
  const grown = piece.substats.map((s) => (s.value - (s.initialValue ?? s.value)) / (MAX_ROLL[s.key] ?? Infinity))
  // Displayed values are rounded, hence the slack.
  const ranges = grown.map((u) => [Math.max(0, Math.ceil(u - 0.05)), Math.floor(u / 0.7 + 0.05)])
  let best: number[] | null = null
  let bestErr = Infinity
  const walk = (i: number, counts: number[], sum: number) => {
    if (i === ranges.length) {
      if (sum !== total) return
      const err = counts.reduce((e, n, j) => e + (n - grown[j] / AVG_TIER) ** 2, 0)
      if (err < bestErr) [best, bestErr] = [[...counts], err]
      return
    }
    for (let n = ranges[i][0]; n <= ranges[i][1] && sum + n <= total; n++) walk(i + 1, [...counts, n], sum + n)
  }
  walk(0, [], 0)
  return best ?? grown.map((u) => Math.round(u / AVG_TIER))
}

/** Distribution of the sum of tier indices (0–3) over h rolls; tier sum = 0.7·h + 0.1·index sum. */
const tierCache = new Map<number, Float64Array>()
function tierSums(h: number): Float64Array {
  let d = tierCache.get(h)
  if (d) return d
  d = new Float64Array([1])
  for (let i = 0; i < h; i++) d = convolve(d, new Float64Array(ROLL_TIERS.map(() => 1 / ROLL_TIERS.length)))
  tierCache.set(h, d)
  return d
}

/** Adds p × part into target, shifted right by `shift` grid steps, growing target as needed. */
function addInto(target: { d: Float64Array }, part: Float64Array, shift: number, p: number) {
  if (shift + part.length > target.d.length) {
    const grown = new Float64Array(shift + part.length)
    grown.set(target.d)
    target.d = grown
  }
  for (let i = 0; i < part.length; i++) target.d[shift + i] += p * part[i]
}

/**
 * Exact odds for rerolling a +20 piece: lines go back to their starting values, then its upgrades are
 * redone, each landing on one of the 4 lines at random but at least `guaranteed` of them on the 2 chosen.
 *
 * A piece still to level is leveled to +20 first. The reroll redoes all 5 upgrades (4 for a 3-liner) from the
 * starting lines whatever they rolled, so its odds don't depend on them; what it has to beat is the piece as it ends up
 * at +20, which is uncertain: chance and gain are averaged over the rolls it has left, independent of the reroll's.
 *
 * `erMin` is the least the ER line may end at without dropping the wearer below their ER target. When a
 * reroll could go under it, results that do count as no change (you'd keep the old stats), and every pair of
 * lines is tried, so picking ER itself can win.
 *
 * `bar` is what the rerolled piece has to beat when that's more than it's worth at +20: for a spare, what the
 * character it would go to wears. Chance and gain are then measured against it.
 */
export function rerollOdds(
  piece: Piece,
  weights: Record<string, number>,
  guaranteed: Guarantee,
  erMin: number | null = null,
  bar: number | null = null,
): RerollOdds | null {
  const subs = piece.substats
  if (subs.length !== 4 || subs.some((s) => s.initialValue === undefined)) return null
  const w = subs.map((s) => weights[s.key] ?? 0)
  const base = subs.reduce((sum, s, i) => sum + (w[i] * s.initialValue!) / (MAX_ROLL[s.key] ?? Infinity), 0)
  const order = [0, 1, 2, 3].sort((a, b) => w[b] - w[a])
  const n = rerolledUpgrades(piece)
  const floor = Math.min(guaranteed, n)
  // What a result has to beat, with its probability: the piece at +20 (just as it is, for a +20), or `bar` if more.
  const cur = currentValue(piece, weights)
  const finish = gainDistribution(lineWeights(piece, weights), remainingRolls(piece))
  const beat: { at: number; p: number }[] = []
  for (let j = 0; j < finish.length; j++) if (finish[j] > 0) beat.push({ at: Math.max(cur + j * STEP, bar ?? -Infinity), p: finish[j] })
  const e = subs.findIndex((s) => s.key === ER)
  const erBound = e >= 0 && erMin !== null && erMin > subs[e].initialValue! + 0.05
  const er = e >= 0 ? { idx: e, min: erBound ? erMin! : -Infinity } : null

  const pairOdds = (pair: number[]): RerollOdds => {
    const others = [0, 1, 2, 3].filter((i) => !pair.includes(i))
    const valid = { d: new Float64Array(1) }
    const all = { d: new Float64Array(1) }
    let erAfter = 0
    // Each upgrade hits a chosen line with probability 1/2; short of the guarantee, the game tops it up.
    for (let k = floor; k <= n; k++) {
      let pK = choose(n, k) / 2 ** n
      if (k === floor) for (let j = 0; j < floor; j++) pK += choose(n, j) / 2 ** n
      if (!er) {
        const part = convolve(gainDistribution(pair.map((i) => w[i]), k), gainDistribution(others.map((i) => w[i]), n - k))
        addInto(valid, part, 0, pK)
        addInto(all, part, 0, pK)
        continue
      }
      // Follow the ER line on its own: h of its group's g upgrades land on it, each a tier from ROLL_TIERS.
      const inChosen = pair.includes(er.idx)
      const partner = (inChosen ? pair : others).find((i) => i !== er.idx)!
      const rest = inChosen ? others : pair
      const g = inChosen ? k : n - k
      const restDist = gainDistribution(rest.map((i) => w[i]), n - g)
      for (let h = 0; h <= g; h++) {
        const pH = (pK * choose(g, h)) / 2 ** g
        const part = convolve(gainDistribution([w[partner]], g - h), restDist)
        const sums = tierSums(h)
        for (let t = 0; t < sums.length; t++) {
          const p = pH * sums[t]
          const rolls = ROLL_TIERS[0] * h + 0.1 * t
          const value = subs[er.idx].initialValue! + rolls * MAX_ROLL[ER]
          erAfter += p * value
          const shift = Math.round((w[er.idx] * rolls) / STEP)
          addInto(all, part, shift, p)
          if (value >= er.min - 0.05) addInto(valid, part, shift, p)
        }
      }
    }

    let chance = 0
    let gain = 0
    let expected = 0
    for (let i = 0; i < all.d.length; i++) expected += all.d[i] * (base + i * STEP)
    // Sums of the chance and value of every result from each grid point up, so each value to beat is one lookup.
    const len = valid.d.length
    const tailP = new Float64Array(len + 1)
    const tailV = new Float64Array(len + 1)
    for (let i = len - 1; i >= 0; i--) {
      tailP[i] = tailP[i + 1] + valid.d[i]
      tailV[i] = tailV[i + 1] + valid.d[i] * (base + i * STEP)
    }
    for (const { at, p } of beat) {
      // The first result past it, with half a grid step of slack so a reroll identical to the piece doesn't count.
      const from = Math.max(0, Math.floor((at + STEP / 2 - base) / STEP) + 1)
      if (from >= len) continue
      chance += p * tailP[from]
      gain += p * (tailV[from] - at * tailP[from])
    }
    const odds: RerollOdds = { chosen: pair.map((i) => subs[i].key), chance, gain, expected }
    return er ? { ...odds, erAfter, erBound } : odds
  }

  if (!erBound) return pairOdds(order.slice(0, 2))
  // Try every pair. Several often come out about even (a dead line plus ER spreads rolls much like ER plus a
  // good line), so take the most-weighted pair within a hair of the best.
  const pairs: number[][] = []
  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) pairs.push([a, b])
  pairs.sort((x, y) => w[y[0]] + w[y[1]] - (w[x[0]] + w[x[1]]))
  const all = pairs.map(pairOdds)
  const top = Math.max(...all.map((o) => o.gain))
  return all.find((o) => o.gain >= top - PAIR_TIE)!
}

/** Gains this close count as a tie when choosing which two lines to pick. */
const PAIR_TIE = 0.01

export function planRerolls(
  result: EvaluationResult,
  pieces: Piece[],
  guaranteed: Guarantee,
  erModel: ErModel | null = null,
  /** For the 2pc categories when checking a move keeps someone's sets fit (see setsFit). */
  config: ArtifactConfig | null = null,
): RerollPlan {
  const { worn, equipped, barsOf, current } = wearing(result, pieces)
  const options: RerollOption[] = []
  const anyStar = current.some((r) => r.priority === 'priority')
  const rank = (ref: ActiveBuild) => standing(ref, anyStar)
  const elsewhereFor = (piece: Piece, wearer: ActiveBuild): RerollOption['elsewhere'] => {
    const mine = currentValue(piece, wearer.build.substats)
    let best: { char: string; rank: number; from: number; to: number } | null = null
    for (const other of current) {
      if (other.char === wearer.char || !mainStatOk(other.build, piece)) continue
      const from = barsOf(other)[piece.slotKey]
      const to = currentValue(piece, other.build.substats)
      if (from === null || to - from < MIN_MOVE_GAIN || to - mine < MIN_MOVE_EDGE) continue
      const outgoing = equipped.get(`${other.char}|${piece.slotKey}`)?.setKey
      if (!swapSetFit(worn.get(other.char) ?? {}, outgoing, piece.setKey, other.build, config)) continue
      const r = rank(other)
      if (best && (r < best.rank || (r === best.rank && to - from <= best.to - best.from))) continue
      best = { char: other.char, rank: r, from, to }
    }
    return best && { char: best.char, from: best.from, to: best.to, below: best.rank < rank(wearer) }
  }
  let wrongMain = 0
  let noData = 0
  for (const ref of current) {
    const total = totalER(erModel, ref.char, SLOTS.flatMap((s) => equipped.get(`${ref.char}|${s}`) ?? []))
    for (const slot of SLOTS) {
      const piece = equipped.get(`${ref.char}|${slot}`)
      if (!piece || !rerollable(piece)) continue
      if (!mainStatOk(ref.build, piece)) {
        wrongMain++
        continue
      }
      const { line, erMin, need, cap, weights: w } = rerollTerms(piece, ref.build, total)
      const odds = rerollOdds(piece, w, guaranteed, erMin)
      if (!odds) {
        noData++
        continue
      }
      // Against the build's own weights: a roll into spare ER isn't counted as wasted.
      const wasted = wastedUpgrades(piece, ref.build)
      options.push({
        ...odds,
        piece,
        ref,
        current: currentValue(piece, w),
        finish: finishOf(piece, w),
        spare: null,
        wasted,
        upgrades: upgradesOf(piece),
        cost: DUST_COST[slot],
        elsewhere: elsewhereFor(piece, ref),
        er: total !== null && odds.erAfter !== undefined ? { now: total, after: total - line + odds.erAfter, need, cap } : null,
      })
    }
  }

  // Spares: rerolled, would one beat what someone wears? Each is judged for every character it could go to
  // (main stat allowed, sets still fit) against the piece it would replace, and listed for the one it gains most,
  // Building characters first, then ★ Priority while anyone is ★ (`standing`, as levelPriority picks a piece's
  // reason). The Farm tab's free upgrades are left out, both the spares and the slots they fill: it says to equip
  // those first, and they're then judged as worn. Those are +20s; spares still to level are leveled first.
  const spares = pieces.filter((p) => !p.owner && rerollable(p))
  const { swaps } = freeSwaps(current, spares.filter((p) => p.level === 20), worn, equipped, barsOf, erModel, config)
  const swapped = new Set(swaps.map((s) => s.piece.id))
  const filled = new Set(swaps.map((s) => `${s.char}|${s.slot}`))
  const targets = current.map((ref) => {
    const mine = SLOTS.flatMap((s) => equipped.get(`${ref.char}|${s}`) ?? [])
    return { ref, mine, total: totalER(erModel, ref.char, mine), bars: barsOf(ref), sets: worn.get(ref.char) ?? {} }
  })
  for (const piece of spares) {
    if (swapped.has(piece.id)) continue
    let best: RerollOption | null = null
    for (const { ref, mine, total, bars, sets } of targets) {
      if (filled.has(`${ref.char}|${piece.slotKey}`)) continue
      const replaces = equipped.get(`${ref.char}|${piece.slotKey}`)
      // Nothing usable worn there: the spare is already an upgrade (the Farm tab's free upgrades).
      if (!replaces || bars[piece.slotKey] === null || !mainStatOk(ref.build, piece)) continue
      if (!swapSetFit(sets, replaces.setKey, piece.setKey, ref.build, config)) continue
      const option = spareReroll(piece, ref, replaces, mine, total, erModel, guaranteed)
      if (!option) continue
      if (!best || rank(option.ref) > rank(best.ref) || (rank(option.ref) === rank(best.ref) && option.gain > best.gain)) {
        best = option
      }
    }
    if (best) options.push(best)
  }
  return { options, wrongMain, noData }
}

/**
 * Rerolling spare `piece` for `ref`, who wears `replaces` in its slot (`mine` is all they wear, `total` their
 * ER now, null if unknown): measured against `replaces`, with ER handled by spareTerms. A spare still to level is
 * leveled to +20 first, and the reroll has to beat the better of it there and `replaces` (see rerollOdds). Null when
 * a reroll can't help: no starting values, ER they'd lose, already better as it is (a swap, or finishing it, not a
 * reroll), or nothing to gain. The main stat and set fit are the caller's to check.
 */
export function spareReroll(
  piece: Piece,
  ref: ActiveBuild,
  replaces: Piece,
  mine: Piece[],
  total: number | null,
  erModel: ErModel | null,
  guaranteed: Guarantee,
): RerollOption | null {
  const after = totalER(erModel, ref.char, [...mine.filter((p) => p.slotKey !== piece.slotKey), piece])
  const terms = spareTerms(piece, ref.build, total, after)
  if (!terms) return null
  const bar = expectedFinal(replaces, terms.weights)
  const now = currentValue(piece, terms.weights)
  if (now >= bar) return null
  const odds = rerollOdds(piece, terms.weights, guaranteed, terms.erMin, bar)
  if (!odds || odds.gain <= 0) return null
  return {
    ...odds,
    piece,
    ref,
    current: now,
    finish: finishOf(piece, terms.weights),
    spare: { replaces, bar },
    wasted: wastedUpgrades(piece, ref.build),
    upgrades: upgradesOf(piece),
    cost: DUST_COST[piece.slotKey],
    elsewhere: null,
    er:
      total !== null && after !== null
        ? { now: total, after: odds.erAfter !== undefined ? after - terms.line + odds.erAfter : after, need: terms.need, cap: terms.cap }
        : null,
  }
}

/** Upgrades that landed on lines `build` gives no weight. */
function wastedUpgrades(piece: Piece, build: BuildConfig): number {
  const counts = upgradeCounts(piece)
  return piece.substats.reduce((n, s, i) => n + (build.substats[s.key] > 0 ? 0 : counts[i]), 0)
}

/**
 * How to judge rerolling a spare for a character whose total ER is `total` now and `after` with the spare on in
 * place of their piece (null if unknown). Like rerollTerms for a worn piece: the swap may not leave them below their
 * build's ER minimum (or below where they are, if already under it), so `erMin` is the least the spare's ER line
 * may end at, and a spare with no ER line that would go under is ruled out (null). When they'd be at their ER cap
 * without the spare's ER line, ER is all spare and `weights` leave it out, for the piece it replaces too.
 */
function spareTerms(piece: Piece, build: BuildConfig, total: number | null, after: number | null) {
  const line = piece.substats.find((s) => s.key === ER)?.value ?? 0
  const need = erNeed(build)
  const cap = erCap(build)
  if (total === null || after === null) return { line, erMin: null, need, cap, weights: build.substats }
  const keep = need === null ? null : Math.min(need, total)
  if (keep !== null && line === 0 && after < keep - 0.05) return null
  const spare = cap !== null && after - line >= cap
  return { line, erMin: keep === null ? null : line - (after - keep), need, cap, weights: spare ? withoutER(build.substats) : build.substats }
}
