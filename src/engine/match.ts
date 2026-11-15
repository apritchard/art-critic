import type { ArtifactConfig, BuildConfig, GoodArtifact, OffSetMode, SetMatchMode } from './types'

/**
 * How an artifact's set satisfies a build: as one of its 4pc sets (by tier), via a 2pc category, or as
 * the build's one off-set piece.
 */
export type SetMatch =
  | { kind: '4pc'; tier: number; twoPieceOnly?: true }
  | { kind: '2pc'; category: string }
  | { kind: 'off' }
  | null

/** The build's sets it would run as a 4pc: every listed set but those it keeps for 2pc pairs only. */
export function fourPieceSets(build: BuildConfig): BuildConfig['sets4'] {
  return build.sets4.filter((s) => !s.twoPieceOnly)
}

/** Main stats that are hard to get in their slot: anything but HP%/ATK%/DEF% on sands, goblet or circlet. */
export function isRareMain(a: Pick<GoodArtifact, 'slotKey' | 'mainStatKey'>): boolean {
  if (a.slotKey === 'flower' || a.slotKey === 'plume') return false
  return !['hp_', 'atk_', 'def_'].includes(a.mainStatKey)
}

export function offSetAllowed(mode: OffSetMode, a: Pick<GoodArtifact, 'slotKey' | 'mainStatKey'>): boolean {
  return mode === 'any' || (mode === 'rare' && isRareMain(a))
}

export function matchSet(build: BuildConfig, setKey: string, config: ArtifactConfig, mode: SetMatchMode): SetMatch {
  const four = build.sets4.find((s) => s.set === setKey)
  if (four) {
    if (mode === '4pc-t12' && four.tier > 2) return null
    return four.twoPieceOnly ? { kind: '4pc', tier: four.tier, twoPieceOnly: true } : { kind: '4pc', tier: four.tier }
  }
  if (mode !== 'config') return null
  const tokens = new Set(build.sets2.flat())
  if (tokens.has('any')) return { kind: '2pc', category: 'any' }
  const category = config.sets[setKey]?.twoPieceCategory
  if (category && tokens.has(category)) return { kind: '2pc', category }
  return null
}

export function describeSetMatch(m: NonNullable<SetMatch>): string {
  if (m.kind === 'off') return 'off-set'
  if (m.kind === '4pc') return m.twoPieceOnly ? `tier ${m.tier}, for its 2pc` : `4pc tier ${m.tier}`
  return m.category === 'any' ? 'any set' : `2pc ${m.category}`
}

/** Flower and plume always pass; other slots need an acceptable, non-avoided main stat. */
export function mainStatOk(build: BuildConfig, artifact: Pick<GoodArtifact, 'slotKey' | 'mainStatKey'>): boolean {
  const slot = artifact.slotKey
  if (slot === 'flower' || slot === 'plume') return true
  if (build.avoidMainStats?.[slot]?.includes(artifact.mainStatKey)) return false
  const allowed = build.mainStats[slot] ?? []
  return allowed.includes('*') || allowed.includes(artifact.mainStatKey)
}
