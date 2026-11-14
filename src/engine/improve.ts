// Everything that could improve one character's pieces, slot by slot: spare +20s, pieces other characters
// wear, pieces worth leveling, a reroll, an Elixir craft, the Strongbox and domains. Every option says how
// likely it is to beat what they wear now and by how much on average, so they compare side by side.
import { erNeed, totalER, type ErModel } from './er'
import type { ActiveBuild, EvaluationResult, Verdict } from './evaluate'
import {
  dropPool,
  elixirCrafts,
  expectedBestOf,
  farmTargets,
  gainHistograms,
  keepsSetBonuses,
  ON_SET_DROPS_PER_RUN,
  RESIN_PER_RUN,
  RESIN_SHOWN,
  setStatus,
  STRONGBOX_BATCH,
  upgradeOdds,
  wearing,
  type DomainsFile,
  type ElixirPick,
  type SetStatus,
} from './farm'
import type { Piece } from './load'
import { mainStatOk } from './match'
import { chanceToBeat, currentValue, expectedFinal, expectedGainOver } from './projection'
import { DUST_COST, rerollOdds, type Guarantee, type RerollOdds } from './reroll'
import type { ArtifactConfig, SlotKey } from './types'
import { SLOTS } from './types'

const ER = 'enerRech_'

/** How many of each kind of piece option to list per slot. */
export const SHOWN = { spare: 4, taken: 4, level: 5 }
/** Leveling options below this chance of beating the worn piece aren't listed. */
const MIN_LEVEL_CHANCE = 0.05
/** Spares and borrowed pieces have to beat the worn piece by at least this much. */
const MIN_PIECE_GAIN = 0.1

/** What wearing a piece does to the character's set bonuses. */
export type SetFit =
  | { kind: 'keeps' }
  /** Only useful once they move to 4pc of another listed set. */
  | { kind: 'switch'; tier: number }
  /** Loses the 2pc or 4pc bonus of this set. */
  | { kind: 'breaks'; set: string }

export interface PieceOption {
  piece: Piece
  /** Chance it ends up beating the worn piece: 1 for a finished piece that does. */
  chance: number
  /** Average improvement, counting a result under the worn piece as no gain. */
  gain: number
  /** Value once finished (projected for a piece still to level). */
  value: number
  fit: SetFit
  /** Total ER (%) before and after wearing it, for finished pieces; null if unknown. */
  er: { from: number; to: number; need: number | null } | null
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
  er: { from: number; to: number; need: number | null } | null
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
  reroll: RerollChoice | null
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
  const { result, pieces, domains, er, ref, guarantee, claimed, strongboxSets } = input
  const { worn, equipped, barsOf, current } = wearing(result, pieces)
  const char = ref.char
  const w = ref.build.substats
  const wornSets = worn.get(char) ?? {}
  const bars = barsOf(ref)
  const quality = result.characters.find((c) => c.char === char)?.builds.find((b) => b.idx === ref.buildIdx)?.slots
  const mine = SLOTS.flatMap((s) => equipped.get(`${char}|${s}`) ?? [])
  const erNow = totalER(er, char, mine)
  const need = erNeed(ref.build)
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
      if (keepsSetBonuses(wornSets, wornPiece?.setKey, p.setKey)) return { kind: 'keeps' }
      const listed = ref.build.sets4.find((s) => s.set === p.setKey)
      return listed ? { kind: 'switch', tier: listed.tier } : { kind: 'breaks', set: wornPiece!.setKey }
    }
    const erWith = (p: Piece) => {
      const to = totalER(er, char, [...mine.filter((x) => x.slotKey !== slot), p])
      return erNow !== null && to !== null ? { from: erNow, to, need } : null
    }
    const finished = (p: Piece): PieceOption | null => {
      const value = currentValue(p, w)
      const gain = value - (now ?? 0)
      if (gain < MIN_PIECE_GAIN) return null
      return { piece: p, chance: 1, gain, value, fit: fitOf(p), er: erWith(p) }
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
        return [{ piece: p, chance, gain, value: expectedFinal(p, w), fit, er: null, verdict: verdicts.get(p.id) ?? 'skip' }]
      })
      .sort(byFit)
      .slice(0, SHOWN.level)

    let reroll: RerollChoice | null = null
    if (wornPiece && wornPiece.rarity === 5 && wornPiece.level === 20 && mainStatOk(ref.build, wornPiece)) {
      const line = wornPiece.substats.find((s) => s.key === ER)?.value ?? 0
      const erMin = erNow !== null && need !== null ? line - Math.max(0, erNow - need) : null
      const odds = rerollOdds(wornPiece, w, guarantee, erMin)
      if (odds) {
        reroll = {
          ...odds,
          cost: DUST_COST[slot],
          er: erNow !== null && odds.erAfter !== undefined ? { from: erNow, to: erNow - line + odds.erAfter, need } : null,
        }
      }
    }

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
  return { ref, status, targets, er: erNow, need, slots }
}
