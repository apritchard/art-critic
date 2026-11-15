// Runs the engine over the real export in imports/ (skipped when there is none).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultSettings, evaluate } from './evaluate'
import { planFarming, type DomainsFile } from './farm'
import { loadPieces } from './load'
import type { ArtifactConfig, GoodExport, Roster } from './types'

const root = join(import.meta.dirname, '..', '..')
const importsDir = join(root, 'imports')
const exportFile = existsSync(importsDir)
  ? readdirSync(importsDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .pop()
  : undefined
const PROTOTYPE_EXPORT = 'genshin_export_2026-11-13_15-34.json'

describe.skipIf(!exportFile)('real export', () => {
  // Vitest runs this body even when the suite is skipped (to list its tests), so it mustn't read a missing file.
  const data: GoodExport = exportFile
    ? JSON.parse(readFileSync(join(importsDir, exportFile), 'utf8'))
    : { format: 'GOOD', version: 2, characters: [], artifacts: [] }
  const config: ArtifactConfig = JSON.parse(readFileSync(join(root, 'genshin_artifact_config.json'), 'utf8'))
  const pieces = loadPieces(data)
  const count = (evs: ReturnType<typeof evaluate>['evaluations'], verdict: string) =>
    evs.filter((e) => e.verdict === verdict).length

  it('reproduces the plain config rule when every extra layer is off', () => {
    // Every owned character active, 2pc categories on, no upgrade-chance filter, no cap.
    const roster: Roster = Object.fromEntries(
      data.characters.map((c) => [c.key, { priority: 'normal' as const, disabledBuilds: [] }]),
    )
    const settings = {
      ...defaultSettings(config),
      setMatch: 'config' as const,
      scaleForMainStat: false,
      scaleLowBuilds: false,
      commitToWornSet: false,
      offSet: 'off' as const,
      minUpgradeChance: 0,
      capNormal: Infinity,
    }
    const { evaluations } = evaluate(pieces, data.characters, config, settings, roster)
    // Count equipped +0s too, as the prototype did: any build whose gate the piece passes.
    const plusZero = evaluations.filter((e) => e.piece.level === 0)
    // Count for the export the tool was built against; a newer export gives its own. The prototype got 1,131 with the
    // research config; the build tuning of 2026-11-14 accepts more main stats, so more pieces pass (1,201),
    // Kokomi's EM bloom-healer build adds 9 more, Nilou's C6 hybrid build 2 more, and Dehya's C6 burst build 1 more.
    if (exportFile === PROTOTYPE_EXPORT) {
      expect(plusZero.filter((e) => e.candidates.some((c) => c.passChance)).length).toBe(1213)
    }
    const unequippedPassing = plusZero.filter((e) => !e.piece.owner && e.candidates.some((c) => c.passChance))
    expect(plusZero.filter((e) => e.grade === 'keep').length).toBe(unequippedPassing.length)
  })

  it('lands near the prototype numbers with default settings', () => {
    const t0 = performance.now()
    const { evaluations } = evaluate(pieces, data.characters, config, defaultSettings(config), {})
    const ms = performance.now() - t0
    const level = count(evaluations, 'level')
    const cont = count(evaluations, 'continue')
    console.log(
      `defaults: level=${level} continue=${cont} spare=${count(evaluations, 'spare')} ` +
        `feed=${count(evaluations, 'feed')} marginal=${evaluations.filter((e) => e.grade === 'marginal').length} ` +
        `lock=${evaluations.filter((e) => e.action === 'lock').length} unlock=${evaluations.filter((e) => e.action === 'unlock').length} ` +
        `(${ms.toFixed(0)}ms)`,
    )
    expect(level).toBeGreaterThan(150)
    expect(level).toBeLessThan(350)
    expect(cont).toBeGreaterThan(15)
    expect(cont).toBeLessThan(80)
    // Equipped pieces are never recommended for unlocking.
    expect(evaluations.some((e) => e.piece.owner && e.action === 'unlock')).toBe(false)
  })

  it('plans farming without reusing a spare or double-booking a slot', () => {
    const domainsFile = join(root, 'genshin_artifact_domains.json')
    const domains: DomainsFile | null = existsSync(domainsFile) ? JSON.parse(readFileSync(domainsFile, 'utf8')) : null
    const result = evaluate(pieces, data.characters, config, defaultSettings(config), {})
    planFarming(result, pieces, config, domains, 'all') // builds the simulated pools
    const t0 = performance.now()
    const plan = planFarming(result, pieces, config, domains, 'all')
    const ms = performance.now() - t0
    console.log(
      `farm: ${plan.swaps.length} swaps, top domain ${plan.domains[0]?.key}, ` +
        `top strongbox ${plan.strongbox[0]?.key} (${ms.toFixed(0)}ms)`,
    )
    expect(plan.characters.length).toBe(result.characters.filter((c) => c.active).length)
    expect(new Set(plan.swaps.map((s) => s.piece.id)).size).toBe(plan.swaps.length)
    expect(new Set(plan.swaps.map((s) => `${s.char}|${s.slot}`)).size).toBe(plan.swaps.length)
    if (domains) expect(plan.domains.length).toBe(domains.domains.length)
    expect(ms).toBeLessThan(500)
  })
})
