// Everything that could improve one character's pieces, slot by slot: spare +20s, pieces other characters
// wear, pieces worth leveling, a reroll of the worn piece or a spare, an Elixir craft, the Strongbox and domains. Every option says how
// likely it is to beat what they wear now and by how much on average, so they compare side by side.
import { erCap, erChangeValue, erNeed, totalER, withoutER, type ErChange, type ErModel } from './er'
import type { ActiveBuild, EvaluationResult, Verdict } from './evaluate'
import {
  dropPool,
  elixirCrafts,
  expectedBestOf,
  farmTargets,
  gainHistograms,
  ON_SET_DROPS_PER_RUN,
  RESIN_PER_RUN,
  RESIN_SHOWN,
  setStatus,
  STRONGBOX_BATCH,
  swapSetFit,
  upgradeOdds,
  wearing,
  type DomainsFile,
  type ElixirPick,
  type SetStatus,
  type SetTrade,
} from './farm'
import type { Piece } from './load'
import { fourPieceSets, mainStatOk } from './match'
import { chanceToBeat, currentValue, expectedFinal, expectedGainOver } from './projection'
import { DUST_COST, finishOf, rerollable, rerollOdds, rerollTerms, spareReroll, type Finish, type Guarantee, type RerollOdds } from './reroll'
import type { ArtifactConfig, SlotKey } from './types'
import { SLOTS } from './types'

/** How many of each kind of piece option to list per slot. */
export const SHOWN = { spare: 4, taken: 4, level: 5, spareReroll: 3 }
/** Leveling and spare reroll options below this chance of beating the worn piece aren't listed. */
const MIN_LEVEL_CHANCE = 0.05
/** Spares and borrowed pieces have to beat the worn piece by at least this much. */
const MIN_PIECE_GAIN = 0.1

/** What wearing a piece does to the character's set bonuses. */
export type SetFit =
  /** Fits the build: keeps every bonus, or `trade`s a 2pc for another the build accepts (see setsFit). */
  | { kind: 'keeps'; trade?: SetTrade }
  /** Only useful once they move to 4pc of another listed set (not one kept for 2pc pairs only). */
  | { kind: 'switch'; tier: number }
  /** Loses the 2pc or 4pc bonus of this set. */
  | { kind: 'breaks'; set: string }

export interface PieceOption {
  piece: Piece
  /** Chance it ends up beating the worn piece: 1 for a finished piece that does. */
  chance: number
  /** Average improvement, counting a result under the worn piece as no gain. */
  gain: number
  /** Value once finished (projected for a piece still to level). Leaves ER out when it's counted in `erGain`. */
  value: number
  fit: SetFit
  /** Total ER (%) before and after wearing it, for finished pieces; null if unknown. */
  er: ErChange | null
  /** Part of `gain` from the change in their total ER (see erChangeValue); finished pieces only. */
  erGain: number
}

export interface SpareOption extends PieceOption {
  /** The Farm tab's free upgrades hand this spare to someone else. */
  claimedBy: string | null
}

export interface TakenOption extends PieceOption {
  owner: string
  /** False when the wearer is set to Ignore in Roster (or has no active build): taking it costs nothing. */
  ownerActive: boolean
  /** What it's worth to the wearer's own build; null if inactive or the main stat doesn't suit them. */
  ownerValue: number | null
  /** Taking it would cost the wearer a 2pc or 4pc bonus. */
  breaksOwner: boolean
}

export interface LevelOption extends PieceOption {
  verdict: Verdict
}

export interface RerollChoice extends RerollOdds {
  cost: number
  er: ErChange | null
  /** A worn piece still to level: leveled to +20 first (see rerollOdds). */
  finish: Finish | null
}

/**
 * A spare that a reroll could lift past the worn piece, judged as on the Reroll tab (spareReroll) but for this
 * character, whoever else it would suit: a +20, or one from +12 leveled to +20 first. `value` is its average after the
 * reroll, and `er` the total with it on, on average; `erGain` is 0, since ER is handled by the reroll's own terms.
 */
export interface SpareRerollOption extends PieceOption {
  /** Its value for this build as it is. */
  current: number
  /** Still to level: leveled to +20 first. */
  finish: Finish | null
  /** The worn piece's value it's measured against: below the slot's `now` when ER past their target doesn't count. */
  bar: number
  /** The two lines to pick. */
  chosen: string[]
  /** Dust of Enlightenment per reroll. */
  cost: number
  /** Results that would cost ER this character needs count as no change. */
  erBound?: boolean
  /** The Farm tab's free upgrades hand this spare to someone else. */
  claimedBy: string | null
}

/** Odds from a batch of Strongbox crafts or 200 resin of domain runs. */
export interface SourceOdds {
  chance: number
  gain: number
  /** Sets to craft or farm. */
  sets: string[]
  /** Domains that drop them (domain odds only). */
  domains: string[]
  /** Sets that can't be crafted or farmed this way (no domain, or not in the Strongbox yet). */
  missing: string[]
}

export interface SlotPlan {
  slot: SlotKey
  worn: Piece | null
  /** Value of the worn piece for this build; null if empty, 4★ or a main stat it doesn't list. */
  now: number | null
  quality: number | null
  spares: SpareOption[]
  taken: TakenOption[]
  level: LevelOption[]
  /** Rerolling the worn piece. */
  reroll: RerollChoice | null
  spareRerolls: SpareRerollOption[]
  elixir: ElixirPick | null
  strongbox: SourceOdds | null
  domain: SourceOdds | null
}

export interface ImprovePlan {
  ref: ActiveBuild
  status: SetStatus
  /** Sets worth farming or crafting (see farmTargets). */
  targets: string[]
  er: number | null
  need: number | null
  cap: number | null
  /** Weakest slot first. */
  slots: SlotPlan[]
}

export interface ImproveInput {
  result: EvaluationResult
  pieces: Piece[]
  config: ArtifactConfig
  domains: DomainsFile | null
  er: ErModel | null
  ref: ActiveBuild
  guarantee: Guarantee
  /** Spares the Farm tab's free upgrades give to someone: piece id → character. */
  claimed: Map<string, string>
  /** Sets the Strongbox can make; null when unknown (every set counts). */
  strongboxSets: Set<string> | null
}

export function improveCharacter(input: ImproveInput): ImprovePlan {
  const { result, pieces, config, domains, er, ref, guarantee, claimed, strongboxSets } = input
  const { worn, equipped, barsOf, current } = wearing(result, pieces)
  const char = ref.char
  const w = ref.build.substats
  const wornSets = worn.get(char) ?? {}
  const bars = barsOf(ref)
  const quality = result.characters.find((c) => c.char === char)?.builds.find((b) => b.idx === ref.buildIdx)?.slots
  const mine = SLOTS.flatMap((s) => equipped.get(`${char}|${s}`) ?? [])
  const erNow = totalER(er, char, mine)
  const need = erNeed(ref.build)
  const cap = erCap(ref.build)
  // With their total ER and target known, finished pieces are valued without ER lines plus the change in the total.
  const byTotal = erNow !== null && cap !== null
  const wFinished = byTotal ? withoutER(w) : w
  const status = setStatus(wornSets, ref.build)
  const targets = farmTargets(ref.build, status)
  const verdicts = new Map(result.evaluations.map((e) => [e.piece.id, e.verdict]))
  const active = new Map(current.map((r) => [r.char, r]))

  const domainOdds = upgradeOdds(ref.build, bars, dropPool('domain'))
  const domainHist = gainHistograms(ref.build, bars, dropPool('domain'))
  const boxOdds = upgradeOdds(ref.build, bars, dropPool('strongbox'))
  const boxHist = gainHistograms(ref.build, bars, dropPool('strongbox'))
  const elixirs = elixirCrafts(ref, bars, targets[0])
  // On-set drops from 200 resin: a domain splits its drops between its two sets.
  const resinDrops = (RESIN_SHOWN / RESIN_PER_RUN) * ON_SET_DROPS_PER_RUN
  const domainOf = new Map((domains?.domains ?? []).flatMap((d) => d.sets.map((s) => [s, d.domain] as const)))

  const slots = SLOTS.map((slot): SlotPlan => {
    const wornPiece = equipped.get(`${char}|${slot}`) ?? null
    const now = bars[slot]
    const fitOf = (p: Piece): SetFit => {
      const trade = swapSetFit(wornSets, wornPiece?.setKey, p.setKey, ref.build, config)
      if (trade) return trade.lost.length ? { kind: 'keeps', trade } : { kind: 'keeps' }
      const listed = fourPieceSets(ref.build).find((s) => s.set === p.setKey)
      return listed ? { kind: 'switch', tier: listed.tier } : { kind: 'breaks', set: wornPiece!.setKey }
    }
    const erWith = (p: Piece) => {
      const to = totalER(er, char, [...mine.filter((x) => x.slotKey !== slot), p])
      return erNow !== null && to !== null ? { from: erNow, to, need, cap } : null
    }
    const nowFinished = byTotal && wornPiece && now !== null ? expectedFinal(wornPiece, wFinished) : now
    // A finished piece can beat the worn one on substats, on the ER it brings toward their target, or both.
    const finished = (p: Piece): PieceOption | null => {
      const value = currentValue(p, wFinished)
      const erChange = erWith(p)
      const erGain = byTotal ? erChangeValue(erChange, w.enerRech_ ?? 0) : 0
      const gain = value - (nowFinished ?? 0) + erGain
      if (gain < MIN_PIECE_GAIN) return null
      return { piece: p, chance: 1, gain, value, fit: fitOf(p), er: erChange, erGain }
    }
    // Pieces that keep her set bonuses come first, then the biggest gain.
    const byFit = (a: PieceOption, b: PieceOption) =>
      Number(a.fit.kind !== 'keeps') - Number(b.fit.kind !== 'keeps') || b.gain - a.gain
    const candidates = pieces.filter((p) => p.slotKey === slot && p.rarity === 5 && mainStatOk(ref.build, p))

    const spares = candidates
      .filter((p) => !p.owner && p.level === 20)
      .flatMap((p) => {
        const o = finished(p)
        const by = claimed.get(p.id)
        return o ? [{ ...o, claimedBy: by && by !== char ? by : null }] : []
      })
      .sort(byFit)
      .slice(0, SHOWN.spare)

    const taken = candidates
      .filter((p) => p.owner && p.owner !== char && p.level === 20)
      .flatMap((p): TakenOption[] => {
        const o = finished(p)
        if (!o) return []
        const theirs = active.get(p.owner!)
        const n = worn.get(p.owner!)?.[p.setKey] ?? 0
        return [
          {
            ...o,
            owner: p.owner!,
            ownerActive: !!theirs,
            ownerValue: theirs && mainStatOk(theirs.build, p) ? currentValue(p, theirs.build.substats) : null,
            breaksOwner: n === 4 || n === 2,
          },
        ]
      })
      // Set-safe first, then pieces nobody active needs (they're free), then the biggest gain.
      .sort(
        (a, b) =>
          Number(a.fit.kind !== 'keeps') - Number(b.fit.kind !== 'keeps') ||
          Number(a.ownerActive) - Number(b.ownerActive) ||
          b.gain - a.gain,
      )
      .slice(0, SHOWN.taken)

    const level = candidates
      .filter((p) => !p.owner && p.level < 20)
      .flatMap((p): LevelOption[] => {
        const fit = fitOf(p)
        if (fit.kind === 'breaks') return []
        const chance = chanceToBeat(p, w, now)
        if (chance < MIN_LEVEL_CHANCE) return []
        const gain = expectedGainOver(p, w, now)
        return [{ piece: p, chance, gain, value: expectedFinal(p, w), fit, er: null, erGain: 0, verdict: verdicts.get(p.id) ?? 'skip' }]
      })
      .sort(byFit)
      .slice(0, SHOWN.level)

    let reroll: RerollChoice | null = null
    if (wornPiece && rerollable(wornPiece) && mainStatOk(ref.build, wornPiece)) {
      const terms = rerollTerms(wornPiece, ref.build, erNow)
      const odds = rerollOdds(wornPiece, terms.weights, guarantee, terms.erMin)
      if (odds) {
        reroll = {
          ...odds,
          cost: DUST_COST[slot],
          er: erNow !== null && odds.erAfter !== undefined ? { from: erNow, to: erNow - terms.line + odds.erAfter, need, cap } : null,
          finish: finishOf(wornPiece, terms.weights),
        }
      }
    }

    // Spares a reroll could lift past the worn piece (ones already past it are under `spares`), +20s and ones to level
    // to +20 first. Like leveling, not ones that would break a set bonus.
    const spareRerolls =
      wornPiece && now !== null
        ? candidates
            .filter((p) => !p.owner && rerollable(p))
            .flatMap((p): SpareRerollOption[] => {
              const fit = fitOf(p)
              if (fit.kind === 'breaks') return []
              const o = spareReroll(p, ref, wornPiece, mine, erNow, er, guarantee)
              if (!o || o.chance < MIN_LEVEL_CHANCE) return []
              const by = claimed.get(p.id)
              return [
                {
                  piece: p,
                  chance: o.chance,
                  gain: o.gain,
                  value: o.expected,
                  fit,
                  er: o.er && { from: o.er.now, to: o.er.after, need: o.er.need, cap: o.er.cap },
                  erGain: 0,
                  current: o.current,
                  finish: o.finish,
                  bar: o.spare!.bar,
                  chosen: o.chosen,
                  cost: o.cost,
                  erBound: o.erBound,
                  claimedBy: by && by !== char ? by : null,
                },
              ]
            })
            .sort(byFit)
            .slice(0, SHOWN.spareReroll)
        : []

    const boxSets = targets.filter((s) => !strongboxSets || strongboxSets.has(s))
    const farmSets = targets.filter((s) => domainOf.has(s))
    const c = boxOdds.slots[slot].chance
    const d = domainOdds.slots[slot].chance
    return {
      slot,
      worn: wornPiece,
      now,
      quality: quality?.[slot].quality ?? null,
      spares,
      taken,
      level,
      reroll,
      spareRerolls,
      elixir: elixirs[slot],
      strongbox: {
        chance: boxSets.length ? 1 - (1 - c) ** STRONGBOX_BATCH : 0,
        gain: boxSets.length ? expectedBestOf(boxHist[slot], STRONGBOX_BATCH) : 0,
        sets: boxSets,
        domains: [],
        missing: targets.filter((s) => !boxSets.includes(s)),
      },
      domain: {
        chance: farmSets.length ? 1 - (1 - d) ** resinDrops : 0,
        gain: farmSets.length ? expectedBestOf(domainHist[slot], resinDrops) : 0,
        sets: farmSets,
        domains: [...new Set(farmSets.map((s) => domainOf.get(s)!))],
        missing: targets.filter((s) => !farmSets.includes(s)),
      },
    }
  })

  // Weakest first: nothing usable, then the lowest rating.
  slots.sort((a, b) => (a.quality ?? -1) - (b.quality ?? -1))
  return { ref, status, targets, er: erNow, need, cap, slots }
}
