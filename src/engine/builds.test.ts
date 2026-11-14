import { describe, expect, it } from 'vitest'
import { allowedMains, applyOverrides, remapDisabled, shiftDisabled, withMainStats, withWeight } from './builds'
import { mainStatOk } from './match'
import type { ArtifactConfig, BuildConfig } from './types'

const build: BuildConfig = {
  name: 'DPS',
  sets4: [{ set: 'CrimsonWitchOfFlames', tier: 1 }],
  sets2: [],
  mainStats: { sands: ['atk_'], goblet: ['*'], circlet: ['critRate_', 'critDMG_'] },
  avoidMainStats: { goblet: ['def_', 'hp_'] },
  substatPreset: 'ATK_CRIT',
  substats: { critRate_: 1, critDMG_: 1, atk_: 0.75 },
  erTarget: '',
  notes: '',
}

describe('build edits', () => {
  it('resolves "*" and avoid lists into explicit main stats', () => {
    const goblets = allowedMains(build, 'goblet')
    expect(goblets).toContain('pyro_dmg_')
    expect(goblets).toContain('atk_')
    expect(goblets).not.toContain('def_')
    expect(goblets).not.toContain('hp_')
  })

  it('writes an explicit list and clears that slot\'s avoid list', () => {
    const edited = withMainStats(build, 'goblet', ['pyro_dmg_', 'hp_'])
    expect(mainStatOk(edited, { slotKey: 'goblet', mainStatKey: 'hp_' })).toBe(true)
    expect(mainStatOk(edited, { slotKey: 'goblet', mainStatKey: 'atk_' })).toBe(false)
    expect(edited.avoidMainStats?.goblet).toBeUndefined()
    expect(build.mainStats.goblet).toEqual(['*'])
  })

  it('sets and removes substat weights', () => {
    const edited = withWeight(withWeight(build, 'enerRech_', 0.5), 'atk_', 0)
    expect(edited.substats).toEqual({ critRate_: 1, critDMG_: 1, enerRech_: 0.5 })
    expect(edited.substatPreset).toBe('custom')
  })

  it('layers overrides over the config', () => {
    const config = {
      characters: {
        Diluc: { element: 'pyro', confidence: 'consensus', enabled: true, builds: [build] },
        Bennett: { element: 'pyro', confidence: 'consensus', enabled: true, builds: [build] },
      },
    } as unknown as ArtifactConfig
    const renamed = { ...build, name: 'Mine' }
    const merged = applyOverrides(config, { Diluc: [renamed], Gone: [renamed] })
    expect(merged.characters.Diluc.builds[0].name).toBe('Mine')
    expect(merged.characters.Bennett.builds[0].name).toBe('DPS')
    expect(merged.characters.Gone).toBeUndefined()
    expect(applyOverrides(config, {})).toBe(config)
  })

  it('shifts roster build toggles when a build is removed', () => {
    expect(shiftDisabled([0, 2, 3], 2)).toEqual([0, 2])
  })

  it('carries switched-off builds over to the config by name on reset', () => {
    const [a, b, c] = ['A', 'B', 'C'].map((name) => ({ ...build, name }))
    // A was deleted and C (now at 1) switched off; the reset brings back A, B, C.
    expect(remapDisabled([1], [b, c], [a, b, c])).toEqual([2])
    expect(remapDisabled([0], [{ ...build, name: 'Mine' }], [a])).toEqual([])
  })
})
