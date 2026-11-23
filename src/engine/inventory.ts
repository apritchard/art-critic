// The order the game's artifact inventory lists pieces in, so the Inventory tab can mirror it cell for cell, and how
// much each piece there is worth leveling or rerolling.
import { standing, type Evaluation } from './evaluate'
import type { LevelAdvice } from './fodder'
import type { Piece } from './load'
import { expectedGainOver, startLines } from './projection'
import type { RerollOption } from './reroll'
import { SLOTS } from './types'

/**
 * Expected gains (roll value, the same in every set) where a piece's leveling or reroll priority steps up: worth a
 * look, high priority (about one max roll of a stat the build fully wants), very high, and top.
 */
export const PRIORITY_STEPS = [0.5, 1, 2, 3] as const
/** The step from which leveling or rerolling a piece counts as high priority. */
export const HIGH_PRIORITY_GAIN = PRIORITY_STEPS[1]

/** How many of PRIORITY_STEPS a gain reaches (0–4). */
const gainTier = (gain: number) => PRIORITY_STEPS.filter((s) => gain >= s - 1e-9).length

export interface LevelPriority {
  /** The level to stop at next (+4, +8, …). */
  next: number
  /** Average improvement once finished over the best `char` has (what they wear, or a better finished spare: the candidate's bar), counting a miss as 0 (see expectedGainOver). */
  gain: number
  char: string
  /** Chance it ends up beating that same bar. */
  chance: number
  star: boolean
  /** `char` is on the Building list. */
  building: boolean
  /** How many of PRIORITY_STEPS the gain reaches (0–4); 0 when it's only for characters who aren't ★ or Building. */
  tier: number
  /** Tier 2 or more: a gain of at least HIGH_PRIORITY_GAIN. */
  high: boolean
  /**
   * How leveling it pays for its EXP (levelingAdvice): gain per net EXP, what EXP is worth for it, and whether it's
   * worth leveling now. Absent for an equipped piece, whose finishing comes out of the EXP first.
   */
  value?: LevelValue
}

export interface LevelValue {
  /** Its value for its EXP: expected gain per net EXP, at the most EXP could be worth and it still pay (breakEven). */
  rate: number
  /** What EXP is worth for it, in gain per EXP: 0 while there's EXP to spare. */
  price: number
  /** Worth leveling to its next stop now. A piece that isn't is held: still kept, just not worth its EXP yet. */
  worth: boolean
  /** For a character Spend's "Rank for" counts, whose pieces get the EXP first. */
  first: boolean
}

/**
 * Why a piece in the Level up queue is worth leveling: of the characters it's kept for, the one whose gain reaches the
 * most PRIORITY_STEPS, counting only Building and ★ Priority characters (anyone, when `anyStar` says nobody is ★).
 * Within a tier, a Building character comes first (`standing`), then the biggest expected gain, so a small gain for
 * someone on the Building list never hides a bigger one for a ★ character. For an equipped piece, the gain is what
 * finishing it adds for its wearer. Null for pieces not in the queue. `advice` (levelingAdvice's entry for the piece)
 * adds how it pays for its EXP.
 */
export function levelPriority(e: Evaluation, anyStar: boolean, advice?: LevelAdvice): LevelPriority | null {
  if (e.piece.level >= 20 || e.nextStop === null) return null
  const kept = e.piece.owner ? (e.best ? [e.best] : []) : e.candidates.filter((c) => c.inCap)
  let top: { gain: number; char: string; chance: number; star: boolean; building: boolean; rank: number; tier: number } | null = null
  for (const c of kept) {
    const gain = e.piece.owner ? Math.max(0, c.expected - c.current) : expectedGainOver(e.piece, c.ref.build.substats, c.bar)
    const rank = standing(c.ref, anyStar)
    const tier = rank > 0 ? gainTier(gain) : 0
    // The hottest reason wins, then a Building character's, then one that counts toward the tier, then the biggest gain.
    if (!top || tier > top.tier || (tier === top.tier && (rank > top.rank || (rank === top.rank && gain > top.gain)))) {
      top = { gain, char: c.ref.char, chance: c.chance, star: c.ref.priority === 'priority', building: !!c.ref.building, rank, tier }
    }
  }
  const value = advice && { rate: advice.rate, price: advice.price, worth: advice.worth, first: advice.first }
  if (!top) return { next: e.nextStop, gain: 0, char: e.piece.owner ?? '', chance: 0, star: false, building: false, tier: 0, high: false, value }
  const { gain, char, chance, star, building, tier } = top
  return { next: e.nextStop, gain, char, chance, star, building, tier, high: tier >= 2, value }
}

export interface RerollPriority {
  /** Average improvement from one reroll, counting a worse result as 0 (RerollOption.gain). */
  gain: number
  /** Chance the reroll comes out better: for a spare, better than what `char` wears. */
  chance: number
  /** The wearer, or for a spare, the character it would go to. */
  char: string
  /** For a spare: the value of the piece it would replace, which the gain is measured over. Null for a worn piece. */
  bar: number | null
  star: boolean
  /** `char` is on the Building list. */
  building: boolean
  /** The two lines to pick. */
  chosen: string[]
  /** Dust of Enlightenment per reroll. */
  cost: number
  /** A piece still to level: leveled to +20 first (RerollOption.finish). */
  finish: { level: number; exp: number } | null
  /**
   * Someone ranked below `char` whom it already upgrades as it is (RerollOption.elsewhere): noted, since moving it
   * is an option, but `char` comes first.
   */
  elsewhere: { char: string; from: number | null; to: number } | null
  /** How many of PRIORITY_STEPS the gain reaches (1–4); 0 when the wearer isn't ★ or Building and someone else is ★. */
  tier: number
  /** Tier 2 or more: a gain of at least HIGH_PRIORITY_GAIN. */
  high: boolean
}

/**
 * A piece worth a Dust of Enlightenment reroll (a +20, or one from +12 leveled to +20 first), rated like a piece to
 * level: its expected gain from one reroll (for a spare, over what the character it would go to wears), tiered by
 * PRIORITY_STEPS when that character is ★ (or anyone, when `anyStar` says nobody is). The gain, not the gain
 * per Dust the Reroll tab sorts by, so a tier means the same as the leveling badge's. Null below the first step,
 * which almost every worn +20 would reach, and for a piece worth more moved to someone ranked at least as high as
 * its wearer (RerollOption.elsewhere): rerolling would throw that away. Someone ranked below doesn't stop it.
 */
export function rerollPriority(o: RerollOption, anyStar: boolean): RerollPriority | null {
  if ((o.elsewhere && !o.elsewhere.below) || o.gain < PRIORITY_STEPS[0] - 1e-9) return null
  const tier = standing(o.ref, anyStar) > 0 ? gainTier(o.gain) : 0
  return {
    gain: o.gain,
    chance: o.chance,
    char: o.ref.char,
    bar: o.spare?.bar ?? null,
    star: o.ref.priority === 'priority',
    building: !!o.ref.building,
    chosen: o.chosen,
    cost: o.cost,
    finish: o.finish && { level: o.finish.level, exp: o.finish.exp },
    elsewhere: o.elsewhere && { char: o.elsewhere.char, from: o.elsewhere.from, to: o.elsewhere.to },
    tier,
    high: tier >= 2,
  }
}

/**
 * Compares two pieces in the in-game artifact inventory's order, with "Show 5-star Artifacts in the order of when
 * they were obtained" off: rarity and level high to low, then flower → circlet, locked before unlocked, pieces that
 * started with 4 lines before those that started with 3 (so it still matters at +20), then newest first. Worked out
 * from in-game screenshots against an export, and confirmed by predicting pieces further down the same grids.
 *
 * `locked` says what the game shows as locked: the export's state by default. The game re-sorts when the inventory
 * is opened again, so a piece locked since the export moves up then.
 */
export function inventoryOrder(a: Piece, b: Piece, locked: (p: Piece) => boolean = (p) => p.lock): number {
  return (
    b.rarity - a.rarity ||
    b.level - a.level ||
    SLOTS.indexOf(a.slotKey) - SLOTS.indexOf(b.slotKey) ||
    Number(locked(b)) - Number(locked(a)) ||
    startLines(b) - startLines(a) ||
    b.idx - a.idx
  )
}
