// Set brief: who a set is for, and what they want from it, for the top of the Artifacts tab.
import { allowedMains, MAIN_SLOTS, type MainSlot } from './builds'
import { buildKey, commitmentOf, wornSets, type ActiveBuild, type EvaluationResult } from './evaluate'
import { MAIN_ODDS } from './farm'
import type { Piece } from './load'
import { matchSet, type SetMatch } from './match'
import type { ArtifactConfig, Settings } from './types'

/** A substat is one of a build's key lines when it weighs at least this share of the build's top weight. */
export const KEY_SHARE = 0.5

/** One build's standing with a set. */
export interface BriefBuild {
  ref: ActiveBuild
  /** How the set counts for the build (`matchSet`); null when it counts only as the build's off-set piece. */
  match: NonNullable<SetMatch> | null
  /**
   * A build that lists the set but counts it only off-set, and why: its tier (Settings → Set matching on tiers 1–2), or
   * the 4pc set the character wears, ranked as high or higher (Settings → Stick to the worn set). Mirrors `setFor`.
   */
  sidelined?: { issue: 'tier'; tier: number } | { issue: 'worn'; tier: number; worn: { set: string; tier: number } }
  /** Unequipped pieces of the set kept for the build: in its cap, or finished spares that beat what's worn. */
  kept: number
  /** Of those, the pieces kept for no other build: what switching this build off would lose. */
  only: number
}

export interface SetBrief {
  set: string
  /** Builds the set counts for: as one of their 4pc sets (best tier first) or for a 2pc pair. */
  users: BriefBuild[]
  /** Builds that list the set but count its pieces only as their off-set piece. */
  sidelined: BriefBuild[]
  /** Builds keeping a piece of the set as their off-set piece, but that don't list it. */
  offSet: BriefBuild[]
}

/**
 * Who a set is for: the active builds it counts for, those that list it but can't count it (and why), and those
 * keeping its pieces off-set, each with how many of its unequipped pieces are kept for them. Pieces a character wears
 * always count for them, so the set layer is read here as it treats every other piece.
 */
export function setBrief(
  result: EvaluationResult,
  set: string,
  pieces: Piece[],
  config: ArtifactConfig,
  settings: Settings,
): SetBrief {
  // Kept pieces per build, and those kept for that build alone.
  const kept = new Map<string, number>()
  const only = new Map<string, number>()
  const keptOff = new Set<string>()
  for (const e of result.evaluations) {
    if (e.piece.setKey !== set || e.piece.owner) continue
    const keys = new Set<string>()
    for (const c of e.candidates) {
      if (!c.inCap) continue
      keys.add(buildKey(c.ref))
      if (c.setMatch.kind === 'off') keptOff.add(buildKey(c.ref))
    }
    for (const k of keys) kept.set(k, (kept.get(k) ?? 0) + 1)
    if (keys.size === 1) {
      const [k] = keys
      only.set(k, (only.get(k) ?? 0) + 1)
    }
  }

  const worn = wornSets(pieces)
  const users: BriefBuild[] = []
  const sidelined: BriefBuild[] = []
  const offSet: BriefBuild[] = []
  for (const ref of result.activeBuilds) {
    const key = buildKey(ref)
    const counts = { kept: kept.get(key) ?? 0, only: only.get(key) ?? 0 }
    const listed = ref.build.sets4.find((s) => s.set === set)
    const match = matchSet(ref.build, set, config, settings.setMatch)
    const committed = settings.commitToWornSet ? commitmentOf(ref.build, worn.get(ref.char) ?? {}) : null
    if (match?.kind === '4pc' && committed && committed.set !== set && match.tier >= committed.tier) {
      sidelined.push({ ref, match: null, sidelined: { issue: 'worn', tier: match.tier, worn: committed }, ...counts })
    } else if (match) {
      users.push({ ref, match, ...counts })
    } else if (listed) {
      sidelined.push({ ref, match: null, sidelined: { issue: 'tier', tier: listed.tier }, ...counts })
    } else if (keptOff.has(key)) {
      offSet.push({ ref, match: null, ...counts })
    }
  }
  const tier = (b: BriefBuild) => (b.match?.kind === '4pc' ? b.match.tier : (b.sidelined?.tier ?? 9))
  const byTier = (a: BriefBuild, b: BriefBuild) => tier(a) - tier(b) || a.ref.char.localeCompare(b.ref.char) || a.ref.buildIdx - b.ref.buildIdx
  const byKept = (a: BriefBuild, b: BriefBuild) => b.kept - a.kept || a.ref.char.localeCompare(b.ref.char)
  return { set, users: users.sort(byTier), sidelined: sidelined.sort(byTier), offSet: offSet.sort(byKept) }
}

/** A stat some builds want, and which. */
export interface WantedStat {
  stat: string
  refs: ActiveBuild[]
}

/** A substat and each build's weight for it. */
export interface WantedSub extends WantedStat {
  /** Builds it's a key line for (`KEY_SHARE`): the group it stands for. */
  refs: ActiveBuild[]
  /** Every build that weighs it, key line or not, heaviest first. */
  weights: { ref: ActiveBuild; weight: number }[]
}

export interface Wanted {
  /** Per slot, the main stats the builds accept, most wanted first. */
  mains: Record<MainSlot, WantedStat[]>
  /** Substats that are a key line for at least one build, most builds first. */
  subs: WantedSub[]
  /** Substats some build weighs, but none as a key line, heaviest first. */
  minor: WantedSub[]
}

/** What a list of builds wants from a set's pieces: each slot's main stats, and their substats. */
export function wanted(refs: ActiveBuild[]): Wanted {
  const mains = {} as Record<MainSlot, WantedStat[]>
  for (const slot of MAIN_SLOTS) {
    const by = new Map<string, ActiveBuild[]>()
    for (const ref of refs) for (const main of allowedMains(ref.build, slot)) by.set(main, [...(by.get(main) ?? []), ref])
    // Most builds first, then in the game's drop-odds order, so the order doesn't hang on which build came first.
    const order = (stat: string) => MAIN_ODDS[slot].findIndex(([main]) => main === stat)
    mains[slot] = [...by]
      .map(([stat, refs]) => ({ stat, refs }))
      .sort((a, b) => b.refs.length - a.refs.length || order(a.stat) - order(b.stat))
  }

  const subs = new Map<string, WantedSub>()
  for (const ref of refs) {
    const top = Math.max(0, ...Object.values(ref.build.substats))
    for (const [stat, weight] of Object.entries(ref.build.substats)) {
      if (!(weight > 0)) continue
      let s = subs.get(stat)
      if (!s) subs.set(stat, (s = { stat, refs: [], weights: [] }))
      s.weights.push({ ref, weight })
      if (weight >= top * KEY_SHARE - 1e-9) s.refs.push(ref)
    }
  }
  const total = (s: WantedSub) => s.weights.reduce((sum, w) => sum + w.weight, 0)
  for (const s of subs.values()) s.weights.sort((a, b) => b.weight - a.weight)
  const all = [...subs.values()]
  return {
    mains,
    subs: all.filter((s) => s.refs.length).sort((a, b) => b.refs.length - a.refs.length || total(b) - total(a)),
    minor: all.filter((s) => !s.refs.length).sort((a, b) => total(b) - total(a)),
  }
}
