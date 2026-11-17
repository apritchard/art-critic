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
  usedScope,
  type CharacterFarm,
  type FarmPlan,
  type FarmScope,
  type SimPiece,
} from './farm'
import type { Piece } from './load'
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
  /** A 3-liner still to reach +4, which only adds its 4th line: no roll there, and no stop (`nextStop`). */
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
  /**
   * `exp` less what dropped pieces give back when fed (FEED_RETURN of the EXP put into them here): what leveling it
   * really costs.
   */
  net: number
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
 * A piece's road to +20, set up once so it can be priced many times (`outlookAt`): its stops, what each step costs,
 * and where the minimum upgrade chance lets it go on. Value offsets are grid steps (STEP) above `start.base`.
 */
export interface LevelingPath {
  start: LevelStart
  bar: number | null
  /** One per stop to the next: its EXP, and whether an upgrade roll lands there (a 3-liner's +4 is folded into +8). */
  steps: { exp: number; roll: boolean }[]
  /** EXP spent from now to each stop: spent[k] after k steps. */
  spent: number[]
  /** Grid steps one roll can add, one per line and tier, equally likely. */
  moves: number[]
  /** Value offsets the path can reach, 0 to size − 1. */
  size: number
  /** allowed[k][i]: at stop k (1 to steps − 1) and offset i, the chance to beat the bar is still at the minimum. */
  allowed: Uint8Array[]
}

/** Sets up a piece's road to +20 for `outlookAt`. */
export function levelingPath(start: LevelStart, bar: number | null, minChance: number): LevelingPath {
  const steps: LevelingPath['steps'] = []
  const rollsAt: number[] = [start.rolls]
  let { level, rolls } = start
  // A 3-liner's +4 only reveals its 4th line, already counted, so it isn't a stop: its first stop is +8.
  let to = nextStopFrom(level, start.pending)
  while (level < 20) {
    const roll = rolls > 0
    const exp = expBetween(level, to)
    if (roll) rolls--
    steps.push({ exp, roll })
    rollsAt.push(rolls)
    level = to
    to = nextStopFrom(level, false)
  }
  const moves = start.lineW.flatMap((w) => ROLL_TIERS.map((t) => Math.round((w * t) / STEP)))
  const reach = Math.max(0, ...moves)
  const size = reach * steps.filter((s) => s.roll).length + 1
  const spent = [0]
  for (const s of steps) spent.push(spent[spent.length - 1] + s.exp)
  const allowed: Uint8Array[] = [new Uint8Array(size).fill(1)]
  for (let k = 1; k < steps.length; k++) {
    const ok = new Uint8Array(size)
    for (let i = 0; i < size; i++) ok[i] = chanceFrom(start.base + i * STEP, start.lineW, rollsAt[k], bar) >= minChance ? 1 : 0
    allowed.push(ok)
  }
  return { start, bar, steps, spent, moves, size, allowed }
}

/** The next stop from `level`: the next multiple of 4, or +8 for a 3-liner still to reveal its 4th line. */
const nextStopFrom = (level: number, pending: boolean) => (pending && level < 4 ? 8 : Math.min(20, Math.floor(level / 4) * 4 + 4))

/** Gain over the bar of a finished piece at value offset i; 0 for a miss. */
const finishedGain = (p: LevelingPath, i: number) => Math.max(0, p.start.base + i * STEP - (p.bar ?? 0))

/** Expected value of the next stop's V, from offset i, over one step (rolled or not). */
function expectNext(p: LevelingPath, k: number, V: Float64Array, i: number): number {
  if (!p.steps[k].roll) return V[i]
  let e = 0
  for (const m of p.moves) e += V[Math.min(p.size - 1, i + m)]
  return e / p.moves.length
}

/**
 * Expected EXP and gain from leveling a piece the way the app says to, with EXP worth `price` (gain per EXP): to its
 * next stop, then on only while its chance of ending above the bar stays at the minimum and, when EXP has a price,
 * while what leveling on is expected to bring (stopping the same way later) is worth the EXP it's expected to take.
 * A piece dropped on the way gives back FEED_RETURN of the EXP put into it here, so a speculative step costs a fifth
 * of its EXP if the piece is then fed, and the full EXP if it goes on to +20: cheap early stops are worth a look that
 * a costly late one isn't. At price 0, EXP is plentiful and only the chance counts. Only those two rules are modeled;
 * the cap and the rescore bar aren't. The first stop is paid for in any case, since the piece is already worth leveling.
 */
export function outlookAt(p: LevelingPath, price: number): Outlook {
  const n = p.steps.length
  // Where to go on: at each stop after the first, by optimal stopping when EXP has a price (backward induction).
  let goOn = p.allowed
  if (price > 0 && n > 1) {
    const lost = 1 - FEED_RETURN
    let V = new Float64Array(p.size)
    for (let i = 0; i < p.size; i++) {
      const g = finishedGain(p, i)
      V[i] = g > 0 ? g - price * p.spent[n] : -price * p.spent[n]
    }
    goOn = p.allowed.slice()
    for (let k = n - 1; k >= 1; k--) {
      const stop = -lost * price * p.spent[k]
      const W = new Float64Array(p.size)
      const ok = new Uint8Array(p.size)
      for (let i = 0; i < p.size; i++) {
        const e = p.allowed[k][i] ? expectNext(p, k, V, i) : -Infinity
        ok[i] = e > stop + 1e-12 ? 1 : 0
        W[i] = ok[i] ? e : stop
      }
      goOn[k] = ok
      V = W
    }
  }
  // Then follow the piece forward.
  let dist = new Float64Array(p.size)
  dist[0] = 1
  let exp = 0
  let refund = 0
  for (let k = 0; k < n; k++) {
    let alive = 0
    for (const x of dist) alive += x
    if (alive < 1e-12) break
    exp += alive * p.steps[k].exp
    if (p.steps[k].roll) {
      const out = new Float64Array(p.size)
      const share = 1 / p.moves.length
      for (let i = 0; i < p.size; i++) {
        if (!dist[i]) continue
        for (const m of p.moves) out[Math.min(p.size - 1, i + m)] += dist[i] * share
      }
      dist = out
    }
    if (k + 1 < n) {
      for (let i = 0; i < p.size; i++) {
        if (dist[i] && !goOn[k + 1][i]) {
          refund += FEED_RETURN * p.spent[k + 1] * dist[i]
          dist[i] = 0
        }
      }
    }
  }
  let gain = 0
  let finish = 0
  for (let i = 0; i < p.size; i++) {
    if (!dist[i]) continue
    finish += dist[i]
    gain += dist[i] * finishedGain(p, i)
  }
  return { exp, net: exp - refund, gain, finish }
}

/** Whether leveling is worth its EXP at `price` (gain per EXP): the gain beats what its net EXP would buy elsewhere. */
export const worthIt = (o: Outlook, price: number) => o.gain > price * o.net + 1e-12

/** `outlookAt` for a piece set up and priced in one go. */
export function levelingOutlook(s: LevelStart, bar: number | null, minChance: number, price = 0): Outlook {
  return outlookAt(levelingPath(s, bar, minChance), price)
}

/** One set's Strongbox crafts, as the split weighs them. */
export interface CraftCurve {
  set: string
  /** EXP to level one crafted piece, on average (most are dropped at +0 or their first stop). */
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

/** What a set's next craft adds per EXP once `made` are done; 0 when it adds too little to be worth its pieces. */
function craftRate(c: CraftCurve, made: number): number {
  const add = c.gain(made + 1) - c.gain(made)
  return add >= MIN_CRAFT_GAIN ? add / c.cost : 0
}

/**
 * Spends one EXP budget, best gain per EXP first, on queue entries (sorted that way already, each costing its net
 * EXP: what dropped pieces give back returns to the budget) and crafts. Every +0
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
    const qRate = q && q.net > 0 ? q.gain / q.net : 0
    let best = -1
    let bestRate = 0
    if (boxed + CRAFT_INPUTS <= tosses) {
      curves.forEach((c, i) => {
        const rate = craftRate(c, crafts[i])
        if (rate > bestRate) {
          best = i
          bestRate = rate
        }
      })
    }
    if (qRate <= 0 && best < 0) return { funded, crafts, left, price: 0 }
    if (qRate >= bestRate) {
      if (q!.net > left) return { funded, crafts, left, price: qRate }
      left -= q!.net
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

/**
 * How many times more a +0 does boxed than fed, for the bar: the best first craft's gain per EXP over the price the
 * allocation ended on. Crafts are judged by allocate's own rule, so the bar leans to box exactly when the split boxes.
 * 0 when no craft is worth its pieces or there are too few +0s for one; Infinity when one is and EXP isn't short.
 */
export function boxRatio(
  curves: CraftCurve[],
  a: Allocation,
  tosses: number,
): { best: CraftCurve | null; rate: number; ratio: number } {
  let best: CraftCurve | null = null
  let rate = 0
  if (tosses >= CRAFT_INPUTS) {
    for (const c of curves) {
      const r = craftRate(c, 0)
      if (r > rate) {
        best = c
        rate = r
      }
    }
  }
  return { best, rate, ratio: rate === 0 ? 0 : a.price > 0 ? rate / a.price : Infinity }
}

let fresh: SimPiece[] | null = null
const freshPieces = () => (fresh ??= simulatePieces({ n: FRESH_SAMPLES, seed: 4, fourLine: FOUR_LINE.strongbox }))

/**
 * One set's crafts for the characters farming it. A crafted piece is leveled for whichever of them it's likeliest to
 * beat what they have, by the same rule as the queue (levelingOutlook at EXP worth `price`), which sets its EXP (net
 * of what a dropped piece gives back) and first-craft gain; one not worth its EXP at that price is fed at +0.
 * Later crafts add less, the way the best of k pieces improves on the best of k − 1 (expectedBestOf).
 */
export function craftCurve(set: string, chars: CharacterFarm[], minChance: number, price = 0): CraftCurve | null {
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
    const o = levelingOutlook(top.start, top.bar, minChance, price)
    if (!worthIt(o, price)) continue
    exp += o.net
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

/** A piece in the Level up queue as Feed or box ranks it: who it's leveled for, and what leveling it should bring. */
export interface QueuePiece extends Outlook {
  piece: Piece
  /** The build in scope, among those triage keeps it for, that it gains most. */
  ref: ActiveBuild
  /** Chance it ends up beating the best that build's character has (what they wear, or a better finished spare). */
  chance: number
  /** Within what the EXP on hand pays for, best gain per EXP first. */
  funded: boolean
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
  /**
   * Unequipped pieces in the Level up queue, how many the EXP reaches (best gain per EXP first), and their net EXP.
   * `pieces` lists them in that order: the best pieces to level next.
   */
  queue: { count: number; funded: number; exp: number; fundedExp: number; pieces: QueuePiece[] }
  /** EXP left once everything worth doing is paid for. */
  left: number
  /**
   * The craft with the best gain per EXP, judged on its first craft; null when none adds enough to be worth its
   * pieces, or there are fewer +0s than a craft takes.
   */
  bestCraft: { set: string; rate: number; levelExp: number } | null
  /** Gain per EXP of the best use EXP can't reach; 0 when EXP isn't what runs out. */
  price: number
  /**
   * How many times more a +0 is worth boxed than fed (under 1: fed; see boxRatio). 0 when nothing is worth boxing;
   * Infinity when a craft is and there's EXP to spare.
   */
  ratio: number
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
  /** levelingAdvice for the same scope, when it's already worked out. */
  advice: LevelingAdvice = levelingAdvice(result, materials, plan.scope, minChance),
): FeedOrBox {
  const { tosses, leveled, committed, materials: matExp, budget } = advice.hand
  // The queue: unequipped pieces for the characters in scope, leveled with EXP at the price that clears the EXP on hand.
  const queue: Omit<QueuePiece, 'funded'>[] = []
  for (const a of advice.pieces.values()) {
    if (a.first && a.outlook.gain > 0) queue.push({ ...a.outlook, piece: a.piece, ref: a.ref, chance: a.chance })
  }
  queue.sort((a, b) => b.gain / b.net - a.gain / a.net)

  const inScopeChars = plan.characters.filter((c) => inFarmScope(plan.scope, c.ref))
  const curves = plan.strongbox
    .slice(0, CRAFT_SETS)
    .map((s) => craftCurve(s.key, inScopeChars, minChance, advice.price))
    .filter((c): c is CraftCurve => !!c)
  const a = allocate(queue, curves, budget, tosses)
  const { best, rate: bestRate, ratio } = boxRatio(curves, a, tosses)
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
      exp: queue.reduce((s, o) => s + o.net, 0),
      fundedExp: queue.slice(0, a.funded).reduce((s, o) => s + o.net, 0),
      pieces: queue.map((o, i) => ({ ...o, funded: i < a.funded })),
    },
    left: a.left,
    bestCraft: best ? { set: best.set, rate: bestRate, levelExp: best.levelExp } : null,
    price: a.price,
    ratio,
  }
}

/** EXP on hand for leveling, as Feed or box counts it. */
export interface ExpOnHand {
  /** +0 pieces marked to unlock: fed, unless Feed or box boxes some. */
  tosses: number
  /** Pieces past +0 marked to unlock: always fed, since they carry the EXP spent on them. */
  leveled: { count: number; exp: number }
  /** EXP to finish equipped pieces still leveling for characters in scope, set aside first. */
  committed: number
  /** EXP in enhancement materials; null when the export doesn't list them. */
  materials: number | null
  /** All of it, with the +0s fed, less `committed`. */
  budget: number
}

/** How leveling one piece in the To level queue pays for its EXP. */
export interface LevelAdvice {
  piece: Piece
  /** The build it's leveled for: of those triage keeps it for (among the characters EXP goes to first, when any), the one it gains most. */
  ref: ActiveBuild
  /** That build's chance it ends up beating the best its character has. */
  chance: number
  /** Leveling it from here with EXP at `price`. */
  outlook: Outlook
  /** Its value for its EXP (breakEven): expected gain per net EXP, at the most EXP could be worth and it still pay. */
  rate: number
  /** What EXP is worth for it (gain per EXP): 0 while there's EXP to spare. */
  price: number
  /** Worth leveling to its next stop: the gain beats what its EXP could do for other pieces. */
  worth: boolean
  /** Its build is one Spend's "Rank for" counts, whose pieces EXP goes to first. */
  first: boolean
}

export interface LevelingAdvice {
  /** The scope used, after falling back as planFarming does. */
  scope: FarmScope
  hand: ExpOnHand
  /** What EXP is worth (gain per EXP) for pieces for the characters in scope; 0 when the EXP covers them all. */
  price: number
  /** The same for everyone else's pieces, paid from what the first ones leave (less finishing their equipped pieces). */
  restPrice: number
  /** Unequipped pieces in the To level queue, by id. */
  pieces: Map<string, LevelAdvice>
}

/** The most EXP is ever worth when solving for its price: 100 rolls per 100k EXP, more than any piece brings. */
export const MAX_PRICE = 1e-3

/**
 * A piece's value for its EXP: the most EXP could be worth (gain per EXP) and leveling it still pay, leveled the
 * cost-aware way at that price. There its expected gain per net EXP equals that price, so it's a gain per EXP like
 * any other, and a piece is worth leveling exactly when it's above what EXP is worth. 0 when it gains nothing.
 */
export function breakEven(p: LevelingPath): number {
  if (!worthIt(outlookAt(p, 0), 0)) return 0
  if (worthIt(outlookAt(p, MAX_PRICE), MAX_PRICE)) return MAX_PRICE
  let lo = 1e-9
  let hi = MAX_PRICE
  while (hi / lo > 1.01) {
    const mid = Math.sqrt(lo * hi)
    if (worthIt(outlookAt(p, mid), mid)) lo = mid
    else hi = mid
  }
  return lo
}

/**
 * What EXP is worth when leveling, and which pieces in the To level queue are worth theirs. EXP on hand is the Feed or
 * box budget (materials, pieces marked to unlock fed, less finishing equipped pieces). It goes first to pieces for the
 * characters in `scope` (Spend's "Rank for"), then to everyone else's with what's left. For each group, the price is
 * where the EXP runs out: leveling every piece the cost-aware way (outlookAt) at that price, the ones still worth their
 * EXP take what there is. While there's more EXP than they'd take, the price is 0 and only the chance rule counts. A
 * piece not worth its EXP is still kept (its lock verdict is unchanged); it just isn't worth leveling now.
 */
export function levelingAdvice(
  result: EvaluationResult,
  materials: Record<string, number> | undefined,
  scope: FarmScope,
  minChance: number,
): LevelingAdvice {
  const used = usedScope(scope, result.activeBuilds)
  const inScope = (ref: ActiveBuild) => inFarmScope(used, ref)
  let tosses = 0
  const leveled = { count: 0, exp: 0 }
  let committed = 0
  let committedRest = 0
  type Entry = { piece: Piece; c: Candidate; first: boolean; path: LevelingPath }
  const entries: Entry[] = []
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
      else committedRest += expBetween(p.level, 20)
      continue
    }
    const kept = e.candidates.filter((c) => c.inCap)
    const first = kept.some((c) => inScope(c.ref))
    let top: { c: Candidate; gain: number } | null = null
    for (const c of kept) {
      if (first && !inScope(c.ref)) continue
      const gain = expectedGainOver(p, c.ref.build.substats, c.bar)
      if (!top || gain > top.gain) top = { c, gain }
    }
    if (!top) continue
    entries.push({ piece: p, c: top.c, first, path: levelingPath(startOf(p, top.c.ref.build.substats), top.c.bar, minChance) })
  }
  const matExp = materialsExp(materials)
  const budget = (matExp ?? 0) + leveled.exp - committed + tosses * FEED_EXP

  // What the worthwhile pieces of a group would take at a price, and the price at which that fits `exp`.
  const spend = (group: Entry[], price: number) => {
    let net = 0
    for (const x of group) {
      const o = outlookAt(x.path, price)
      if (worthIt(o, price)) net += o.net
    }
    return net
  }
  const clear = (group: Entry[], exp: number): { price: number; left: number } => {
    const all = spend(group, 0)
    if (all <= exp) return { price: 0, left: exp - all }
    if (spend(group, MAX_PRICE) > exp) return { price: MAX_PRICE, left: 0 }
    let lo = 1e-9
    let hi = MAX_PRICE
    // Bisect on a log scale to within about 1%.
    while (hi / lo > 1.01) {
      const mid = Math.sqrt(lo * hi)
      if (spend(group, mid) > exp) lo = mid
      else hi = mid
    }
    return { price: hi, left: exp - spend(group, hi) }
  }
  const firsts = entries.filter((x) => x.first)
  const rest = entries.filter((x) => !x.first)
  const forFirst = clear(firsts, budget)
  const forRest = clear(rest, forFirst.left - committedRest)

  const pieces = new Map<string, LevelAdvice>()
  for (const x of entries) {
    const price = x.first ? forFirst.price : forRest.price
    const outlook = outlookAt(x.path, price)
    pieces.set(x.piece.id, {
      piece: x.piece,
      ref: x.c.ref,
      chance: x.c.chance,
      outlook,
      rate: breakEven(x.path),
      price,
      worth: worthIt(outlook, price),
      first: x.first,
    })
  }
  return {
    scope: used,
    hand: { tosses, leveled, committed, materials: matExp, budget },
    price: forFirst.price,
    restPrice: forRest.price,
    pieces,
  }
}
