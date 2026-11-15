// The order the game's artifact inventory lists pieces in, so the Inventory tab can mirror it cell for cell, and how
// much each piece there is worth leveling.
import type { Evaluation } from './evaluate'
import type { Piece } from './load'
import { expectedGainOver, startLines } from './projection'
import { SLOTS } from './types'

/**
 * Expected gains (roll value, the same in every set) where a piece's leveling priority steps up: worth a look, high
 * priority (about one max roll of a stat the build fully wants), very high, and top.
 */
export const PRIORITY_STEPS = [0.5, 1, 2, 3] as const
/** The step from which leveling a piece counts as high priority. */
export const HIGH_PRIORITY_GAIN = PRIORITY_STEPS[1]

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
  const tier = counts ? PRIORITY_STEPS.filter((s) => gain >= s - 1e-9).length : 0
  return { next: e.nextStop, gain, char, chance, star, tier, high: tier >= 2 }
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
