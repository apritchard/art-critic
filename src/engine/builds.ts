// Per-character build edits made in the UI, layered over genshin_artifact_config.json.
import { MAIN_ODDS } from './farm'
import { mainStatOk } from './match'
import type { ArtifactConfig, BuildConfig } from './types'

/** Replacement builds per character key; characters not listed keep the config's builds. */
export type BuildOverrides = Record<string, BuildConfig[]>

export type MainSlot = 'sands' | 'goblet' | 'circlet'
export const MAIN_SLOTS: MainSlot[] = ['sands', 'goblet', 'circlet']

/** Substats in the order the editor lists them. */
export const SUBSTAT_KEYS = ['critRate_', 'critDMG_', 'atk_', 'atk', 'hp_', 'hp', 'def_', 'def', 'enerRech_', 'eleMas']

export function applyOverrides(config: ArtifactConfig, overrides: BuildOverrides): ArtifactConfig {
  const edited = Object.keys(overrides).filter((char) => config.characters[char])
  if (!edited.length) return config
  const characters = { ...config.characters }
  for (const char of edited) characters[char] = { ...characters[char], builds: overrides[char] }
  return { ...config, characters }
}

/** Every main stat the slot can roll that the build accepts, '*' and avoid lists resolved. */
export function allowedMains(build: BuildConfig, slot: MainSlot): string[] {
  return MAIN_ODDS[slot].map(([main]) => main).filter((main) => mainStatOk(build, { slotKey: slot, mainStatKey: main }))
}

/** Replaces a slot's main stats with an explicit list, dropping '*' and that slot's avoid list. */
export function withMainStats(build: BuildConfig, slot: MainSlot, mains: string[]): BuildConfig {
  const avoid = { ...build.avoidMainStats }
  delete avoid[slot]
  return { ...build, mainStats: { ...build.mainStats, [slot]: mains }, avoidMainStats: avoid }
}

/** Sets one substat weight; a weight of 0 removes the stat. The preset name no longer applies. */
export function withWeight(build: BuildConfig, key: string, weight: number): BuildConfig {
  const substats = { ...build.substats }
  if (weight > 0) substats[key] = weight
  else delete substats[key]
  return { ...build, substats, substatPreset: 'custom' }
}

/** Roster build toggles are stored by index, so removing a build shifts the ones after it. */
/**
 * Switched-off build positions once a character's `from` builds are replaced by `to` (a reset to the config), matched
 * by build name. Builds that aren't in `to` drop out.
 */
export function remapDisabled(disabled: number[], from: BuildConfig[], to: BuildConfig[]): number[] {
  const names = new Set(disabled.map((i) => from[i]?.name))
  return to.flatMap((b, i) => (names.has(b.name) ? [i] : []))
}

export function shiftDisabled(disabled: number[], removed: number): number[] {
  return disabled.filter((i) => i !== removed).map((i) => (i > removed ? i - 1 : i))
}
