// Feed or box: whether the +0 pieces Triage marks to unlock are worth more as EXP for the Level up queue or as
// Strongbox input. Both end up as expected gain, and both cost EXP to get there (a crafted piece has to be leveled
// too), so the two are compared by gain per EXP.
import type { ActiveBuild, Candidate, EvaluationResult } from './evaluate'
import {
  dropPool,
  expectedBestOf,
  FOUR_LINE,
  gainHistograms,
  inFarmScope,
  simulatePieces,
  type CharacterFarm,
  type FarmPlan,
  type SimPiece,
} from './farm'
import { mainStatOk } from './match'
import {
  currentValue,
  expectedGainOver,
  gainDistribution,
  lineWeights,
  pendingActivation,
  remainingRolls,
  STEP,
} from './projection'
import { ROLL_TIERS } from './stats'
import type { GoodArtifact } from './types'
import { SLOTS } from './types'

/** EXP to take a 5★ piece from each level to the next, +0 → +1 first: 16,300 to +4 and 270,475 to +20. */
export const LEVEL_EXP = [
  3000, 3725, 4425, 5150, 5900, 6675, 7500, 8350, 9225, 10125, 11050, 12025, 13025, 15150, 17600, 20375, 23500, 27050,
  31050, 35575,
]

export function expBetween(from: number, to: number): number {
  let exp = 0
  for (let l = from; l < to; l++) exp += LEVEL_EXP[l]
  return exp
}

/** A 5★ piece fed to another gives this much EXP, plus FEED_RETURN of the EXP spent leveling it. */
export const FEED_EXP = 3780
export const FEED_RETURN = 0.8
export const feedExp = (level: number) => FEED_EXP + Math.floor(FEED_RETURN * expBetween(0, level))

/** EXP per enhancement material, by its GOOD key. */
export const MATERIAL_EXP: Record<string, number> = { SanctifyingUnction: 2520, SanctifyingEssence: 3780 }

/** Total EXP in an export's enhancement materials; null when the export doesn't list materials. */
export function materialsExp(materials: Record<string, number> | undefined): number | null {
  if (!materials) return null
  return Object.entries(MATERIAL_EXP).reduce((sum, [key, exp]) => sum + (materials[key] ?? 0) * exp, 0)
}

/** 5★ pieces in per Strongbox craft. */
export const CRAFT_INPUTS = 3
/** How many of the Strongbox ranking's top sets the split considers crafting. */
export const CRAFT_SETS = 3
/** A craft has to add at least this much expected gain to be worth its pieces. */
const MIN_CRAFT_GAIN = 0.01
/** Fresh Strongbox pieces simulated to see how much EXP one takes to level. */
const FRESH_SAMPLES = 3000

/** Where a piece starts leveling from, for one build's weights. */
export interface LevelStart {
  level: number
  /** Weighted value so far, counting a 3-liner's hidden 4th line. */
  base: number
  /** Weights of the four lines later rolls can land on. */
  lineW: number[]
  rolls: number
  /** A 3-liner whose next stop (+4) only adds its 4th line. */
  pending: boolean
}

export const startOf = (a: GoodArtifact, weights: Record<string, number>): LevelStart => ({
  level: a.level,
  base: currentValue(a, weights),
  lineW: lineWeights(a, weights),
  rolls: remainingRolls(a),
  pending: pendingActivation(a),
})

/** A fresh simulated piece at +0. */
function freshStart(p: SimPiece, weights: Record<string, number>): LevelStart {
  const lineW = p.keys.map((k) => weights[k] ?? 0)
  return {
    level: 0,
    base: lineW.reduce((s, w, i) => s + w * p.start[i], 0),
    lineW,
    rolls: p.lines === 4 ? 5 : 4,
    pending: p.lines === 3,
  }
}

/** What leveling a piece is likely to cost and bring, stopping as the app says to. */
export interface Outlook {
  /** Expected EXP spent before it's finished or dropped. */
  exp: number
  /** Expected improvement over the bar once finished, a dropped piece or a miss counting as 0. */
  gain: number
  /** Chance it's leveled all the way to +20. */
  finish: number
}

const tails = new Map<string, Float64Array>()

/** tail[j]: the chance the remaining rolls add at least j grid steps. */
function tailOf(lineW: number[], rolls: number): Float64Array {
  const key = `${lineW.join(',')}|${rolls}`
  let tail = tails.get(key)
  if (!tail) {
    const dist = gainDistribution(lineW, rolls)
    tail = new Float64Array(dist.length + 1)
    for (let j = dist.length - 1; j >= 0; j--) tail[j] = tail[j + 1] + dist[j]
    tails.set(key, tail)
  }
  return tail
}

/** chanceToBeat for a piece worth `value` now: the chance it ends strictly above `bar`. */
export function chanceFrom(value: number, lineW: number[], rolls: number, bar: number | null): number {
  if (bar === null) return 1
  const tail = tailOf(lineW, rolls)
  const j = Math.max(0, Math.floor((bar + 1e-9 - value) / STEP) + 1)
  return j < tail.length ? Math.min(1, tail[j]) : 0
}

/**
 * Expected EXP and gain from leveling a piece the way the app says to: to its next stop, then on only while its
 * chance of ending above `bar` stays at `minChance` or more. Only that layer is modeled; the cap and the rescore bar
 * aren't. The first stop is paid for in any case, since the piece is already worth leveling.
 */
export function levelingOutlook(s: LevelStart, bar: number | null, minChance: number): Outlook {
  const steps = s.lineW.flatMap((w) => ROLL_TIERS.map((t) => Math.round((w * t) / STEP)))
  const reach = Math.max(0, ...steps)
  let dist = new Float64Array([1])
  let { level, rolls, pending } = s
  let exp = 0
  while (level < 20) {
    const next = Math.min(20, Math.floor(level / 4) * 4 + 4)
    let alive = 0
    for (const p of dist) alive += p
    if (alive < 1e-12) break
    exp += alive * expBetween(level, next)
    if (pending) pending = false
    else if (rolls > 0) {
      const out = new Float64Array(dist.length + reach)
      const p = 1 / steps.length
      for (let i = 0; i < dist.length; i++) {
        if (!dist[i]) continue
        for (const step of steps) out[i + step] += dist[i] * p
      }
      dist = out
      rolls--
    }
    level = next
    if (level < 20) {
      for (let i = 0; i < dist.length; i++) {
        if (dist[i] && chanceFrom(s.base + i * STEP, s.lineW, rolls, bar) < minChance) dist[i] = 0
      }
    }
  }
  let gain = 0
  let finish = 0
  if (level >= 20) {
    for (let i = 0; i < dist.length; i++) {
      if (!dist[i]) continue
      finish += dist[i]
      gain += dist[i] * Math.max(0, s.base + i * STEP - (bar ?? 0))
    }
  }
  return { exp, gain, finish }
}

/** One set's Strongbox crafts, as the split weighs them. */
export interface CraftCurve {
  set: string
  /** EXP to level one crafted piece, on average (most are dropped at +0 or +4). */
  levelExp: number
  /** What one craft costs, in EXP: its pieces as the fodder they'd have been, plus levelExp. */
  cost: number
  /** Total expected gain from k crafts. Each adds less than the one before. */
  gain: (k: number) => number
}

export interface Allocation {
  /** Queue entries funded, from the top. */
  funded: number
  /** Crafts per curve. */
  crafts: number[]
  /** EXP left over. */
  left: number
  /** Gain per EXP of the best use left without EXP to pay for it; 0 when something other than EXP runs out. */
  price: number
}

/**
 * Spends one EXP budget, best gain per EXP first, on queue entries (sorted that way already) and crafts. Every +0
 * piece that could be boxed is in the budget as the EXP it would give, so a craft pays for its pieces from it, and
 * `tosses` caps how many crafts there can be.
 */
export function allocate(queue: Outlook[], curves: CraftCurve[], budget: number, tosses: number): Allocation {
  const crafts = curves.map(() => 0)
  let funded = 0
  let left = budget
  let boxed = 0
  for (;;) {
    const q = funded < queue.length ? queue[funded] : null
    const qRate = q && q.exp > 0 ? q.gain / q.exp : 0
    let best = -1
    let bestRate = 0
    if (boxed + CRAFT_INPUTS <= tosses) {
      curves.forEach((c, i) => {
        const add = c.gain(crafts[i] + 1) - c.gain(crafts[i])
        const rate = add >= MIN_CRAFT_GAIN ? add / c.cost : 0
        if (rate > bestRate) {
          best = i
          bestRate = rate
        }
      })
    }
    if (qRate <= 0 && best < 0) return { funded, crafts, left, price: 0 }
    if (qRate >= bestRate) {
      if (q!.exp > left) return { funded, crafts, left, price: qRate }
      left -= q!.exp
      funded++
    } else {
      const c = curves[best]
      if (c.cost > left) return { funded, crafts, left, price: bestRate }
      left -= c.cost
      crafts[best]++
      boxed += CRAFT_INPUTS
    }
  }
}

let fresh: SimPiece[] | null = null
const freshPieces = () => (fresh ??= simulatePieces({ n: FRESH_SAMPLES, seed: 4, fourLine: FOUR_LINE.strongbox }))

/**
 * One set's crafts for the characters farming it. A crafted piece is leveled for whichever of them it's likeliest to
 * beat what they have, by the same rule as the queue (levelingOutlook), which sets its EXP and first-craft gain.
 * Later crafts add less, the way the best of k pieces improves on the best of k − 1 (expectedBestOf).
 */
export function craftCurve(set: string, chars: CharacterFarm[], minChance: number): CraftCurve | null {
  const farming = chars.filter((c) => c.targets.includes(set))
  if (!farming.length) return null
  let exp = 0
  let first = 0
  const pieces = freshPieces()
  for (const p of pieces) {
    let top: { chance: number; start: LevelStart; bar: number | null } | null = null
    for (const c of farming) {
      if (!mainStatOk(c.ref.build, { slotKey: p.slot, mainStatKey: p.main })) continue
      const start = freshStart(p, c.ref.build.substats)
      const bar = c.bars[p.slot]
      const chance = chanceFrom(start.base, start.lineW, start.rolls, bar)
      if (chance >= minChance && (!top || chance > top.chance)) top = { chance, start, bar }
    }
    if (!top) continue
    const o = levelingOutlook(top.start, top.bar, minChance)
    exp += o.exp
    first += o.gain
  }
  exp /= pieces.length
  first /= pieces.length
  // The shape of the curve: each farming character's best of k pieces, split like the Strongbox ranking splits them.
  const hists = farming.map((c) => ({ share: 1 / c.targets.length, h: gainHistograms(c.ref.build, c.bars, dropPool('strongbox')) }))
  const shape: number[] = [0]
  const shapeAt = (k: number) => {
    for (let n = shape.length; n <= k; n++) {
      shape.push(hists.reduce((s, { share, h }) => s + share * SLOTS.reduce((t, slot) => t + expectedBestOf(h[slot], n), 0), 0))
    }
    return shape[k]
  }
  const scale = shapeAt(1) > 0 ? first / shapeAt(1) : 0
  return { set, levelExp: exp, cost: CRAFT_INPUTS * FEED_EXP + exp, gain: (k) => shapeAt(k) * scale }
}

export interface FeedOrBox {
  /** +0 pieces Triage marks to unlock. */
  tosses: number
  /** How many of them to box and to feed. */
  box: number
  feed: number
  /** Crafts per set, most first. */
  crafts: { set: string; count: number }[]
  /** EXP in enhancement materials; null when the export doesn't list them. */
  materials: number | null
  /** Pieces past +0 marked to unlock: always fed, since they carry the EXP spent on them. */
  leveled: { count: number; exp: number }
  /** EXP to finish equipped pieces still leveling, set aside first. */
  committed: number
  /** Unequipped pieces in the Level up queue, how many the EXP reaches (best gain per EXP first), and their EXP. */
  queue: { count: number; funded: number; exp: number; fundedExp: number }
  /** EXP left once everything worth doing is paid for. */
  left: number
  /** The craft with the best gain per EXP, judged on its first craft. */
  bestCraft: { set: string; rate: number; levelExp: number } | null
  /** Gain per EXP of the best use EXP can't reach; 0 when EXP isn't what runs out. */
  price: number
  /** How many times more a +0 is worth boxed than fed (under 1: fed); null when neither would gain anything. */
  ratio: number | null
}

/**
 * Whether +0 pieces marked to unlock should be fed or boxed, for the characters the Farm tab ranks for (its scope).
 * Materials, pieces past +0 marked to unlock and, if fed, the +0s are one EXP budget. Finishing equipped pieces comes
 * out of it first; then queue pieces and Strongbox crafts take what's left, best gain per EXP first (see allocate).
 */
export function planFeedOrBox(
  result: EvaluationResult,
  plan: FarmPlan,
  materials: Record<string, number> | undefined,
  minChance: number,
): FeedOrBox {
  const inScope = (ref: ActiveBuild) => inFarmScope(plan.scope, ref)
  let tosses = 0
  const leveled = { count: 0, exp: 0 }
  let committed = 0
  const queue: Outlook[] = []
  for (const e of result.evaluations) {
    const p = e.piece
    if (p.rarity !== 5) continue
    if (!p.owner && !e.recommendLock) {
      if (p.level === 0) tosses++
      else {
        leveled.count++
        leveled.exp += feedExp(p.level)
      }
      continue
    }
    if (p.level >= 20 || e.nextStop === null) continue
    if (p.owner) {
      if (e.best && inScope(e.best.ref)) committed += expBetween(p.level, 20)
      continue
    }
    let top: { c: Candidate; gain: number } | null = null
    for (const c of e.candidates) {
      if (!c.inCap || !inScope(c.ref)) continue
      const gain = expectedGainOver(p, c.ref.build.substats, c.bar)
      if (!top || gain > top.gain) top = { c, gain }
    }
    if (!top) continue
    const o = levelingOutlook(startOf(p, top.c.ref.build.substats), top.c.bar, minChance)
    if (o.gain > 0) queue.push(o)
  }
  queue.sort((a, b) => b.gain / b.exp - a.gain / a.exp)

  const matExp = materialsExp(materials)
  const budget = (matExp ?? 0) + leveled.exp - committed + tosses * FEED_EXP
  const inScopeChars = plan.characters.filter((c) => inScope(c.ref))
  const curves = plan.strongbox
    .slice(0, CRAFT_SETS)
    .map((s) => craftCurve(s.key, inScopeChars, minChance))
    .filter((c): c is CraftCurve => !!c)
  const a = allocate(queue, curves, budget, tosses)

  const firstRate = (c: CraftCurve) => c.gain(1) / c.cost
  const best = curves.reduce<CraftCurve | null>((b, c) => (!b || firstRate(c) > firstRate(b) ? c : b), null)
  const bestRate = best ? firstRate(best) : 0
  const ratio = a.price > 0 ? bestRate / a.price : bestRate > 0 ? Infinity : null
  const box = a.crafts.reduce((s, n) => s + n, 0) * CRAFT_INPUTS
  return {
    tosses,
    box,
    feed: tosses - box,
    crafts: curves
      .map((c, i) => ({ set: c.set, count: a.crafts[i] }))
      .filter((c) => c.count > 0)
      .sort((x, y) => y.count - x.count),
    materials: matExp,
    leveled,
    committed,
    queue: {
      count: queue.length,
      funded: a.funded,
      exp: queue.reduce((s, o) => s + o.exp, 0),
      fundedExp: queue.slice(0, a.funded).reduce((s, o) => s + o.exp, 0),
    },
    left: a.left,
    bestCraft: best && bestRate > 0 ? { set: best.set, rate: bestRate, levelExp: best.levelExp } : null,
    price: a.price,
    ratio,
  }
}
