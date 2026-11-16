// The order the game's artifact inventory lists pieces in, so the Inventory tab can mirror it cell for cell, and how
// much each piece there is worth leveling or rerolling.
import type { Evaluation } from './evaluate'
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
  /** How many of PRIORITY_STEPS the gain reaches (0–4); 0 when it's only for characters who aren't ★. */
  tier: number
  /** Tier 2 or more: a gain of at least HIGH_PRIORITY_GAIN. */
  high: boolean
}

/**
 * Why a piece in the Level up queue is worth leveling: the ★ Priority character it's kept for with the biggest
 * expected gain, or else anyone it's kept for. Its tier counts the PRIORITY_STEPS that gain reaches, for a ★
 * character (for anyone, when `anyStar` says nobody is ★). For an equipped piece, the gain is what finishing it adds
 * for its wearer. Null for pieces not in the queue.
 */
export function levelPriority(e: Evaluation, anyStar: boolean): LevelPriority | null {
  if (e.piece.level >= 20 || e.nextStop === null) return null
  const kept = e.piece.owner ? (e.best ? [e.best] : []) : e.candidates.filter((c) => c.inCap)
  let top: { gain: number; char: string; chance: number; star: boolean; counts: boolean } | null = null
  for (const c of kept) {
    const gain = e.piece.owner ? Math.max(0, c.expected - c.current) : expectedGainOver(e.piece, c.ref.build.substats, c.bar)
    const star = c.ref.priority === 'priority'
    const counts = star || !anyStar
    // A reason that counts toward the tier wins, then the biggest gain.
    if (!top || Number(counts) - Number(top.counts) > 0 || (counts === top.counts && gain > top.gain)) {
      top = { gain, char: c.ref.char, chance: c.chance, star, counts }
    }
  }
  if (!top) return { next: e.nextStop, gain: 0, char: e.piece.owner ?? '', chance: 0, star: false, tier: 0, high: false }
  const { gain, char, chance, star, counts } = top
  const tier = counts ? gainTier(gain) : 0
  return { next: e.nextStop, gain, char, chance, star, tier, high: tier >= 2 }
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
  /** The two lines to pick. */
  chosen: string[]
  /** Dust of Enlightenment per reroll. */
  cost: number
  /** How many of PRIORITY_STEPS the gain reaches (1–4); 0 when the wearer isn't ★ and someone else is. */
  tier: number
  /** Tier 2 or more: a gain of at least HIGH_PRIORITY_GAIN. */
  high: boolean
}

/**
 * A +20 worth a Dust of Enlightenment reroll, rated like a piece to level: its expected gain from one reroll (for a
 * spare, over what the character it would go to wears), tiered by PRIORITY_STEPS when that character is ★ (or
 * anyone, when `anyStar` says nobody is). The gain, not the gain
 * per Dust the Reroll tab sorts by, so a tier means the same as the leveling badge's. Null below the first step,
 * which almost every worn +20 would reach, and for a piece worth more moved to someone else (RerollOption.elsewhere):
 * rerolling would throw that away.
 */
export function rerollPriority(o: RerollOption, anyStar: boolean): RerollPriority | null {
  if (o.elsewhere || o.gain < PRIORITY_STEPS[0] - 1e-9) return null
  const star = o.ref.priority === 'priority'
  const tier = star || !anyStar ? gainTier(o.gain) : 0
  return {
    gain: o.gain,
    chance: o.chance,
    char: o.ref.char,
    bar: o.spare?.bar ?? null,
    star,
    chosen: o.chosen,
    cost: o.cost,
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
