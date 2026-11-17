import { AVG_TIER, MAX_ROLL, ROLL_TIERS } from './stats'
import type { GoodArtifact, GoodSubstat, Settings } from './types'

/** Visible substats plus the hidden 4th line of a 3-liner (Irminsul exports it). */
export const allSubs = (a: GoodArtifact): GoodSubstat[] => [...a.substats, ...(a.unactivatedSubstats ?? [])]

/** True while a 3-liner hasn't reached +4 and revealed its 4th line yet. */
export const pendingActivation = (a: GoodArtifact) => a.level < 4 && a.substats.length < 4

/**
 * A 3-liner still to reach +4 whose hidden 4th line the export gives. Its +4 adds no roll and only reveals that line,
 * so leveling to +4 teaches nothing: it's judged now as it will be at +4, and its first stop is +8.
 */
export const knownReveal = (a: GoodArtifact) => pendingActivation(a) && (a.unactivatedSubstats?.length ?? 0) > 0

/**
 * The level to stop at next and re-check: the next multiple of 4, where an upgrade roll lands, or +8 for a 3-liner
 * whose +4 only reveals a line already known (`knownReveal`). Null once it's +20.
 */
export function nextStop(a: GoodArtifact): number | null {
  if (a.level >= 20) return null
  if (knownReveal(a)) return 8
  return Math.min(20, Math.floor(a.level / 4) * 4 + 4)
}

/** Number of substat lines the piece dropped with (3 or 4). */
export function startLines(a: GoodArtifact): 3 | 4 {
  if (pendingActivation(a)) return 3
  if (a.totalRolls !== undefined) return a.totalRolls - Math.floor(a.level / 4) <= 3 ? 3 : 4
  return 4
}

/** Upgrade rolls still to come. A 3-liner's +4 only reveals its 4th line, so it gets one fewer. */
export function remainingRolls(a: GoodArtifact): number {
  return Math.max(0, 5 - Math.floor(a.level / 4) - (pendingActivation(a) ? 1 : 0))
}

/** Weighted roll value so far: Σ weight × value / max roll, counting the hidden 4th line. */
export function currentValue(a: GoodArtifact, weights: Record<string, number>): number {
  let v = 0
  for (const s of allSubs(a)) v += (weights[s.key] ?? 0) * (s.value / (MAX_ROLL[s.key] ?? Infinity))
  return v
}

/** Weights of the four lines that future rolls can land on (padded with 0 if a line is unknown). */
export function lineWeights(a: GoodArtifact, weights: Record<string, number>): number[] {
  const w = allSubs(a).map((s) => weights[s.key] ?? 0)
  while (w.length < 4) w.push(0)
  return w.slice(0, 4)
}

/** Config's starting-substat score: sum of weights over the lines present at +0. */
export function lineScore(a: GoodArtifact, weights: Record<string, number>): number {
  return allSubs(a).reduce((sum, s) => sum + (weights[s.key] ?? 0), 0)
}

/** How many of its lines (the hidden 4th of a 3-liner included) the build gives any weight at all. */
export function usefulLineCount(a: GoodArtifact, weights: Record<string, number>): number {
  return allSubs(a).filter((s) => (weights[s.key] ?? 0) > 0).length
}

/**
 * Best possible starting score: the four highest weights. A piece can't roll its main stat as a
 * substat, so pass `main` to leave it out (Nilou's HP% sands tops out at 1.10, her plume at 2.10).
 */
export function lineCeiling(weights: Record<string, number>, main?: string): number {
  return Object.entries(weights)
    .filter(([k]) => k !== main)
    .map(([, w]) => w)
    .sort((a, b) => b - a)
    .slice(0, 4)
    .reduce((s, w) => s + w, 0)
}

/** Best four weights of a typical CRIT DPS (CRIT Rate, CRIT DMG, ATK%, flat ATK): the config's median build. */
export const TYPICAL_CEILING = 3.05

/**
 * Multiplier for the substat thresholds, so every build needs the same share of what it can reach.
 * - mainStat: drop the main stat's weight, since it can't also be a substat.
 * - lowBuilds: measure builds with few useful stats against a typical build's total instead of their own.
 */
export function thresholdScale(
  weights: Record<string, number>,
  main: string,
  opts: Pick<Settings, 'scaleForMainStat' | 'scaleLowBuilds'>,
): number {
  const full = lineCeiling(weights)
  if (full <= 0) return 1
  const reach = opts.scaleForMainStat ? lineCeiling(weights, main) : full
  return reach / (opts.scaleLowBuilds ? Math.max(full, TYPICAL_CEILING) : full)
}

export function expectedFinal(a: GoodArtifact, weights: Record<string, number>): number {
  const w = lineWeights(a, weights)
  const meanLine = w.reduce((x, y) => x + y, 0) / 4
  return currentValue(a, weights) + remainingRolls(a) * meanLine * AVG_TIER
}

/**
 * Expected final value of a fresh piece sitting exactly on the config threshold. Pieces past +0 are
 * held to this bar, so a borderline piece whose early rolls whiffed falls below it.
 */
export function rescoreBar(threshold: number, lines: 3 | 4): number {
  const rolls = lines === 4 ? 5 : 4
  return threshold * AVG_TIER * (1 + rolls / 4)
}

/** Grid size of the roll-value distributions. */
export const STEP = 0.05
const distCache = new Map<string, Float64Array>()

/**
 * Distribution of the total value the remaining rolls will add, on a STEP grid. Each roll picks one
 * of the four lines uniformly and a roll tier uniformly, so we convolve that 16-outcome step r times.
 */
export function gainDistribution(lineW: number[], rolls: number): Float64Array {
  const key = `${lineW.join(',')}|${rolls}`
  const hit = distCache.get(key)
  if (hit) return hit
  const steps: number[] = []
  for (const w of lineW) for (const t of ROLL_TIERS) steps.push(Math.round((w * t) / STEP))
  const maxStep = Math.max(0, ...steps)
  let dist = new Float64Array(1)
  dist[0] = 1
  const p = 1 / steps.length
  for (let r = 0; r < rolls; r++) {
    const next = new Float64Array(dist.length + maxStep)
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] === 0) continue
      for (const s of steps) next[i + s] += dist[i] * p
    }
    dist = next
  }
  distCache.set(key, dist)
  return dist
}

/**
 * Chance the finished piece ends strictly above `bar`. A null bar means the slot holds nothing usable,
 * so any piece is an upgrade.
 */
export function chanceToBeat(a: GoodArtifact, weights: Record<string, number>, bar: number | null): number {
  if (bar === null) return 1
  const base = currentValue(a, weights)
  const dist = gainDistribution(lineWeights(a, weights), remainingRolls(a))
  let p = 0
  for (let i = 0; i < dist.length; i++) if (base + i * STEP > bar + 1e-9) p += dist[i]
  return Math.min(1, p)
}

/** Average improvement over `bar` once the piece reaches +20, counting a result under it as no gain. */
export function expectedGainOver(a: GoodArtifact, weights: Record<string, number>, bar: number | null): number {
  const floor = bar ?? 0
  const base = currentValue(a, weights)
  const dist = gainDistribution(lineWeights(a, weights), remainingRolls(a))
  let gain = 0
  for (let i = 0; i < dist.length; i++) {
    const v = base + i * STEP
    if (v > floor + 1e-9) gain += dist[i] * (v - floor)
  }
  return gain
}

/** Circlet with a CRIT main stat and the other CRIT stat among its lines. */
export function isCritCirclet(a: GoodArtifact): boolean {
  if (a.slotKey !== 'circlet') return false
  const keys = allSubs(a).map((s) => s.key)
  return (
    (a.mainStatKey === 'critRate_' && keys.includes('critDMG_')) ||
    (a.mainStatKey === 'critDMG_' && keys.includes('critRate_'))
  )
}
