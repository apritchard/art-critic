// Genshin Optimizer's generated stat data, trimmed to what art-critic uses (see GameData in src/engine/er.ts).
// The dev server downloads data/game-data.json on first start and refreshes it when it's a week old, so new
// weapons and characters show up without anything to type in. It isn't committed (see .gitignore).
import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { GameData } from '../src/engine/er.ts'

export const GAME_DATA_URL =
  'https://raw.githubusercontent.com/frzyc/genshin-optimizer/master/libs/gi/stats/src/allStat_gen.json'
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const BASE_STATS = new Set(['hp', 'atk', 'def'])

/** The parts of allStat_gen.json read here. */
interface GoStats {
  weapon: {
    expCurve: Record<string, number[]>
    data: Record<string, { subStat?: { type: string; base: number; curve: string }; refinementBonus?: Record<string, number[]> }>
  }
  char: { data: Record<string, { ascensionBonus: Record<string, number[]> }> }
  art: { main: Record<string, Record<string, number[]>> }
}

export function trimGameData(all: GoStats, fetched: string): GameData {
  const weapons: GameData['weapons'] = {}
  const curves: GameData['curves'] = {}
  for (const [key, w] of Object.entries(all.weapon.data)) {
    if (!w.subStat) continue
    const { type, base, curve } = w.subStat
    weapons[key] = { sub: { stat: type, base, curve } }
    if (w.refinementBonus && Object.keys(w.refinementBonus).length) weapons[key].refine = w.refinementBonus
    curves[curve] ??= all.weapon.expCurve[curve]
  }
  const chars: GameData['chars'] = {}
  for (const [key, c] of Object.entries(all.char.data)) {
    const stat = Object.keys(c.ascensionBonus).find((s) => !BASE_STATS.has(s))
    if (stat) chars[key] = { stat, values: c.ascensionBonus[stat] }
  }
  return { source: GAME_DATA_URL, fetched, weapons, chars, curves, artMain: all.art.main }
}

/** Re-downloads the data when the file is missing or a week old. Resolves true when it wrote a new file. */
export async function refreshGameData(file: string): Promise<boolean> {
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < MAX_AGE_MS) return false
  const res = await fetch(GAME_DATA_URL, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`${GAME_DATA_URL}: ${res.status}`)
  const data = trimGameData((await res.json()) as GoStats, new Date().toISOString())
  if (Object.keys(data.weapons).length < 100 || Object.keys(data.chars).length < 50) {
    throw new Error('game data looks incomplete; keeping the current file')
  }
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(data))
  renameSync(tmp, file)
  return true
}
