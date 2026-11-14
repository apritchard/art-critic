// Energy Recharge totals. ER is a requirement rather than a stat worth a fixed amount per roll: short of what a
// build needs it matters a lot, past it barely at all. The export has no stat totals, but it does say which
// weapon each character holds, so base + ascension + weapon + artifacts + set bonuses gives the total.
import { resolveLocation, type Piece } from './load'
import type { ArtifactConfig, BuildConfig, GoodArtifact, GoodExport, GoodWeapon } from './types'

const ER = 'enerRech_'

/** The slice of Genshin Optimizer's stat data art-critic uses (data/game-data.json). Percent stats are fractions. */
export interface GameData {
  source: string
  fetched: string
  /** Weapon substat, plus unconditional refinement bonuses (index = refinement), by GOOD key. */
  weapons: Record<string, { sub: { stat: string; base: number; curve: string }; refine?: Record<string, number[]> }>
  /** The non-base ascension stat per ascension phase (0–6), by GOOD key. */
  chars: Record<string, { stat: string; values: number[] }>
  /** Weapon substat growth curves (index = level). */
  curves: Record<string, number[]>
  /** Artifact main stat values by rarity, stat and level. */
  artMain: Record<string, Record<string, number[]>>
}

/** Minimum ER (in %) a build asks for: the low end of its first percentage ("110-130%" → 110), or null. */
export function erNeed(build: BuildConfig): number | null {
  const m = /(\d+(?:\.\d+)?)\s*(?:[-–]\s*\d+(?:\.\d+)?\s*)?%/.exec(build.erTarget ?? '')
  return m ? Number(m[1]) : null
}

/** ER (in %) an artifact gives: its main stat at its level plus its ER line. */
export function pieceER(p: GoodArtifact, gd: GameData): number {
  const main = p.mainStatKey === ER ? (gd.artMain[p.rarity]?.[ER]?.[p.level] ?? 0) * 100 : 0
  return main + (p.substats.find((s) => s.key === ER)?.value ?? 0)
}

/** ER (in %) from 2pc bonuses of the config's "er20" category. */
export function setBonusER(counts: Record<string, number>, config: ArtifactConfig): number {
  return Object.entries(counts).reduce((sum, [set, n]) => sum + (n >= 2 && config.sets[set]?.twoPieceCategory === 'er20' ? 20 : 0), 0)
}

export interface ErModel {
  /** ER (in %) from base, ascension and weapon per character; missing when the export or game data can't say. */
  outside: Map<string, number>
  gd: GameData
  config: ArtifactConfig
}

export function erModel(data: GoodExport, gd: GameData | null, config: ArtifactConfig): ErModel | null {
  if (!gd) return null
  const ownedKeys = data.characters.map((c) => c.key)
  const weapons = new Map<string, GoodWeapon>()
  for (const w of data.weapons ?? []) {
    const owner = resolveLocation(w.location, ownedKeys)
    if (owner) weapons.set(owner, w)
  }
  const outside = new Map<string, number>()
  for (const c of data.characters) {
    const w = weapons.get(c.key)
    const wd = w && gd.weapons[w.key]
    // Travelers share one entry in the game data.
    const cd = gd.chars[c.key] ?? (c.key.startsWith('Traveler') ? gd.chars.Traveler : undefined)
    if (!w || !wd || !cd) continue
    const curve = gd.curves[wd.sub.curve]?.[w.level]
    if (curve === undefined) continue
    let er = 100
    if (cd.stat === ER) er += (cd.values[c.ascension] ?? 0) * 100
    if (wd.sub.stat === ER) er += wd.sub.base * curve * 100
    er += (wd.refine?.[ER]?.[w.refinement] ?? 0) * 100
    outside.set(c.key, er)
  }
  return { outside, gd, config }
}

/** Total ER (in %) a character has wearing these pieces; null when their weapon or ascension stat is unknown. */
export function totalER(model: ErModel | null, char: string, worn: Piece[]): number | null {
  const base = model?.outside.get(char)
  if (!model || base === undefined) return null
  const counts: Record<string, number> = {}
  let er = base
  for (const p of worn) {
    er += pieceER(p, model.gd)
    counts[p.setKey] = (counts[p.setKey] ?? 0) + 1
  }
  return er + setBonusER(counts, model.config)
}
