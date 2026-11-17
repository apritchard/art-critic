import { erCap, erNeed, totalER, type ErModel } from './er'
import type { ActiveBuild, EvaluationResult } from './evaluate'
import { wearing, type FarmPlan, type Swap } from './farm'
import { PRIORITY_STEPS } from './inventory'
import type { Piece } from './load'
import { expectedGainOver } from './projection'
import type { RerollOption } from './reroll'
import { SLOTS, type SlotKey } from './types'

/** A piece still to level for a character's slot, and what it's expected to gain them once finished. */
export interface LevelFix {
  piece: Piece
  /** Average improvement at +20 over the best they have (what they wear, or a better finished spare); a miss is 0. */
  gain: number
  /** Chance it ends up beating that. */
  chance: number
}

/** The cheapest ways to improve one slot, each only when it's worth a look. */
export interface SlotFixes {
  /** A free upgrade (Farm's free swaps): a spare +20 to equip now. */
  swap: Swap | null
  /** A Dust of Enlightenment reroll for this character: of the worn piece, or of a spare for this slot. */
  reroll: RerollOption | null
  /** The piece to level that gains them most here. */
  level: LevelFix | null
}

/** One character on the Characters board: how good what they wear is, and the quick fixes waiting. */
export interface BoardRow {
  char: string
  /** The build they're judged by: the one they wear (see `currentBuilds`); null when they don't count. */
  ref: ActiveBuild | null
  /** Each slot against what the build can reach (the Roster ratings); null when nothing usable is worn. */
  ratings: Record<SlotKey, number | null>
  /** Their weakest slot's rating and the average of all five (an empty or unusable slot counts as 0). */
  min: number
  avg: number
  /** Total Energy Recharge (%) as worn, and the build's ER minimum and cap; null when unknown or not set. */
  er: number | null
  need: number | null
  cap: number | null
  fixes: Record<SlotKey, SlotFixes>
  /** Everything the free swaps add (substats and ER), summed over their slots. */
  freeGain: number
  /** Expected gain from one on-set domain piece, as Farm's "Who gains most" has it; null when they don't count. */
  newPiece: number | null
}

/** What a free swap adds: the substat change and what the ER change is worth. */
export const swapGain = (s: Swap) => s.to - (s.from ?? 0) + s.erGain

/** Rerolls and pieces to level are worth flagging from the leveling badge's first step (half a roll). */
export const FIX_MIN_GAIN = PRIORITY_STEPS[0]

/**
 * The Characters board: every character in `result`, with the build they wear, their slot ratings and ER, and per
 * slot the best free swap (`plan.swaps`), reroll (`rerolls`, from planRerolls) and piece to level for them. Free
 * swaps are listed whatever their gain (planFarming already sets a floor); rerolls and pieces to level from
 * FIX_MIN_GAIN. A reroll worth more moved to someone else (`elsewhere`) isn't one.
 */
export function characterBoard(
  result: EvaluationResult,
  pieces: Piece[],
  plan: FarmPlan,
  rerolls: RerollOption[],
  er: ErModel | null,
): BoardRow[] {
  const { current, ratingsOf } = wearing(result, pieces)
  const refOf = new Map(current.map((r) => [r.char, r]))
  const farmOf = new Map(plan.characters.map((c) => [c.char, c]))
  const wornBy = new Map<string, Piece[]>()
  for (const p of pieces) if (p.owner) wornBy.set(p.owner, [...(wornBy.get(p.owner) ?? []), p])

  // Pieces still to level, per character and slot: the best gain over what each would-be wearer has.
  const levels = new Map<string, LevelFix>()
  for (const e of result.evaluations) {
    if (e.piece.owner || e.piece.level >= 20 || e.nextStop === null) continue
    for (const c of e.candidates) {
      if (!c.inCap || refOf.get(c.ref.char)?.buildIdx !== c.ref.buildIdx) continue
      const gain = expectedGainOver(e.piece, c.ref.build.substats, c.bar)
      const key = `${c.ref.char}|${e.piece.slotKey}`
      if (gain >= FIX_MIN_GAIN && gain > (levels.get(key)?.gain ?? -1)) levels.set(key, { piece: e.piece, gain, chance: c.chance })
    }
  }
  const swaps = new Map(plan.swaps.map((s) => [`${s.char}|${s.slot}`, s]))
  const rerollBest = new Map<string, RerollOption>()
  for (const o of rerolls) {
    if (o.elsewhere || o.gain < FIX_MIN_GAIN) continue
    const key = `${o.ref.char}|${o.spare?.replaces.slotKey ?? o.piece.slotKey}`
    if (o.gain > (rerollBest.get(key)?.gain ?? -1)) rerollBest.set(key, o)
  }

  return result.characters.map((c) => {
    const ref = refOf.get(c.char) ?? null
    const slots = (ref ? c.builds.find((b) => b.idx === ref.buildIdx) : c.builds.find((b) => b.enabled) ?? c.builds[0])?.slots
    const ratings = Object.fromEntries(SLOTS.map((s) => [s, ref ? ratingsOf(ref)[s] : (slots?.[s].quality ?? null)])) as Record<
      SlotKey,
      number | null
    >
    const qs = SLOTS.map((s) => ratings[s] ?? 0)
    const fixes = Object.fromEntries(
      SLOTS.map((s) => {
        const key = `${c.char}|${s}`
        return [s, { swap: swaps.get(key) ?? null, reroll: rerollBest.get(key) ?? null, level: levels.get(key) ?? null }]
      }),
    ) as Record<SlotKey, SlotFixes>
    const build = ref?.build ?? null
    return {
      char: c.char,
      ref,
      ratings,
      min: Math.min(...qs),
      avg: qs.reduce((a, b) => a + b, 0) / qs.length,
      er: totalER(er, c.char, wornBy.get(c.char) ?? []),
      need: build ? erNeed(build) : null,
      cap: build ? erCap(build) : null,
      fixes,
      freeGain: SLOTS.reduce((sum, s) => sum + (fixes[s].swap ? swapGain(fixes[s].swap!) : 0), 0),
      newPiece: farmOf.get(c.char)?.odds.gain ?? null,
    }
  })
}
