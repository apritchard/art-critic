// Dust of Enlightenment: which worn +20 pieces are most likely to come out better from a reroll.
import { erCap, erNeed, totalER, withoutER, type ErModel } from './er'
import type { ActiveBuild, EvaluationResult } from './evaluate'
import { swapSetFit, wearing } from './farm'
import type { Piece } from './load'
import { mainStatOk } from './match'
import { currentValue, gainDistribution, STEP } from './projection'
import { AVG_TIER, MAX_ROLL, ROLL_TIERS } from './stats'
import { SLOTS, type ArtifactConfig, type BuildConfig, type SlotKey } from './types'

const ER = 'enerRech_'

/** Dust of Enlightenment per reroll, by slot. */
export const DUST_COST: Record<SlotKey, number> = { flower: 1, plume: 1, sands: 2, goblet: 2, circlet: 2 }

/**
 * Upgrades guaranteed to land on the two chosen lines: 2 normally, 3 once Advanced Reshape is unlocked,
 * 4 with Decreed Reshape.
 */
export type Guarantee = 2 | 3 | 4

export interface RerollOdds {
  /** The two lines to pick: the piece's highest-weighted ones, unless the character's ER needs protecting. */
  chosen: string[]
  /** Chance the rerolled piece beats it as it is. You can keep the old one, so a reroll never loses value. */
  chance: number
  /** Expected improvement, counting a worse result as 0 since you'd keep the old one. */
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
  ref: ActiveBuild
  current: number
  /** Upgrades that landed on lines this build gives no weight. */
  wasted: number
  upgrades: number
  cost: number
  /** Someone else this piece already upgrades as it is (keeping their set bonuses): move it rather than reroll. */
  elsewhere: { char: string; from: number | null; to: number } | null
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
 * wear by this much, and is worth MIN_MOVE_EDGE more to them than to its wearer. Empty slots don't count;
 * those are what the Farm tab's free upgrades are for.
 */
const MIN_MOVE_GAIN = 1
const MIN_MOVE_EDGE = 2

export interface RerollPlan {
  options: RerollOption[]
  /** Worn +20s skipped because their main stat doesn't fit the build: a reroll can't fix that. */
  wrongMain: number
  /** Worn +20s the export has no starting values for. */
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

/** Upgrades a +20 piece received after its starting lines (the reroll redoes exactly these). */
export const upgradesOf = (piece: Piece) => Math.max(0, Math.min(5, (piece.totalRolls ?? 9) - 4))

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
 * `erMin` is the least the ER line may end at without dropping the wearer below their ER target. When a
 * reroll could go under it, results that do count as no change (you'd keep the old stats), and every pair of
 * lines is tried, so picking ER itself can win.
 */
export function rerollOdds(
  piece: Piece,
  weights: Record<string, number>,
  guaranteed: Guarantee,
  erMin: number | null = null,
): RerollOdds | null {
  const subs = piece.substats
  if (subs.length !== 4 || subs.some((s) => s.initialValue === undefined)) return null
  const w = subs.map((s) => weights[s.key] ?? 0)
  const base = subs.reduce((sum, s, i) => sum + (w[i] * s.initialValue!) / (MAX_ROLL[s.key] ?? Infinity), 0)
  const order = [0, 1, 2, 3].sort((a, b) => w[b] - w[a])
  const n = upgradesOf(piece)
  const floor = Math.min(guaranteed, n)
  const now = currentValue(piece, weights)
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
    for (let i = 0; i < valid.d.length; i++) {
      const v = base + i * STEP
      // Half a grid step of slack, so a reroll identical to the current piece doesn't count as better.
      if (v > now + STEP / 2) {
        chance += valid.d[i]
        gain += valid.d[i] * (v - now)
      }
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
  const elsewhereFor = (piece: Piece, wearer: ActiveBuild): RerollOption['elsewhere'] => {
    const mine = currentValue(piece, wearer.build.substats)
    let best: RerollOption['elsewhere'] = null
    for (const other of current) {
      if (other.char === wearer.char || !mainStatOk(other.build, piece)) continue
      const from = barsOf(other)[piece.slotKey]
      const to = currentValue(piece, other.build.substats)
      if (from === null || to - from < MIN_MOVE_GAIN || to - mine < MIN_MOVE_EDGE) continue
      const outgoing = equipped.get(`${other.char}|${piece.slotKey}`)?.setKey
      if (!swapSetFit(worn.get(other.char) ?? {}, outgoing, piece.setKey, other.build, config)) continue
      if (!best || to - from > best.to - best.from!) best = { char: other.char, from, to }
    }
    return best
  }
  let wrongMain = 0
  let noData = 0
  for (const ref of current) {
    const total = totalER(erModel, ref.char, SLOTS.flatMap((s) => equipped.get(`${ref.char}|${s}`) ?? []))
    for (const slot of SLOTS) {
      const piece = equipped.get(`${ref.char}|${slot}`)
      if (!piece || piece.rarity !== 5 || piece.level !== 20) continue
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
      const counts = upgradeCounts(piece)
      // Against the build's own weights: a roll into spare ER isn't counted as wasted.
      const wasted = piece.substats.reduce((n, s, i) => n + (ref.build.substats[s.key] > 0 ? 0 : counts[i]), 0)
      options.push({
        ...odds,
        piece,
        ref,
        current: currentValue(piece, w),
        wasted,
        upgrades: upgradesOf(piece),
        cost: DUST_COST[slot],
        elsewhere: elsewhereFor(piece, ref),
        er: total !== null && odds.erAfter !== undefined ? { now: total, after: total - line + odds.erAfter, need, cap } : null,
      })
    }
  }
  return { options, wrongMain, noData }
}
