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

/** A 2pc category's meaning: "er20" → "Energy Recharge +20%", "ele15:cryo" → "Elemental DMG +15% (Cryo)". */
export function categoryLabel(config: ArtifactConfig, category: string): string {
  const known = config.setCategories ?? {}
  if (known[category]) return known[category]
  const [base, element] = category.split(':')
  const generic = element && known[`${base}:<element>`]
  return generic ? `${generic.replace(/\s*\(.*\)$/, '')} (${element[0].toUpperCase()}${element.slice(1)})` : category
}

/** Categories a 2pc pair can name: every one some set has, then "any". */
export function pairCategories(config: ArtifactConfig): string[] {
  const used = [...new Set(Object.values(config.sets).map((s) => s.twoPieceCategory))].filter((c) => c && c !== 'any')
  return [...used.sort((a, b) => categoryLabel(config, a).localeCompare(categoryLabel(config, b))), 'any']
}

/**
 * Marks a set as kept for the build's 2pc pairs only (its 4pc not preferred over them), or back to a 4pc set. The
 * flag is left out rather than stored as false, so unflagged sets save as they always have.
 */
export function withTwoPieceOnly(build: BuildConfig, set: string, on: boolean): BuildConfig {
  return {
    ...build,
    sets4: build.sets4.map((s) => {
      if (s.set !== set) return s
      const { twoPieceOnly: _, ...rest } = s
      return on ? { ...rest, twoPieceOnly: true } : rest
    }),
  }
}

/**
 * One change to a build, as Closest build suggests it: rank a set at a tier (`from` null adds it), or accept a main
 * stat in a slot.
 */
export type BuildEdit =
  | { kind: 'tier'; set: string; from: number | null; to: number }
  | { kind: 'main'; slot: MainSlot; main: string }

export function applyEdits(build: BuildConfig, edits: BuildEdit[]): BuildConfig {
  let b = build
  for (const e of edits) {
    if (e.kind === 'main') b = withMainStats(b, e.slot, [...new Set([...allowedMains(b, e.slot), e.main])])
    else if (b.sets4.some((s) => s.set === e.set)) b = { ...b, sets4: b.sets4.map((s) => (s.set === e.set ? { ...s, tier: e.to } : s)) }
    else b = { ...b, sets4: [...b.sets4, { set: e.set, tier: e.to }] }
  }
  return b
}

/** Adds a 2pc pair unless the build already has it (in either order). */
export function withPair(build: BuildConfig, pair: [string, string]): BuildConfig {
  const key = (p: string[]) => [...p].sort().join('+')
  if (build.sets2.some((p) => key(p) === key(pair))) return build
  return { ...build, sets2: [...build.sets2, pair] }
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
