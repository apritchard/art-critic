import { describe, expect, it } from 'vitest'
import { erModel, type GameData } from './er'
import { evaluate, defaultSettings } from './evaluate'
import {
  currentBuilds,
  dropsToMatch,
  expectedBestOf,
  farmTargets,
  MAX_DROPS,
  keepsSetBonuses,
  packPool,
  planFarming,
  setStatus,
  simulatePieces,
  upgradeOdds,
  type DomainsFile,
} from './farm'
import { loadPieces } from './load'
import type { ArtifactConfig, BuildConfig, GoodArtifact, GoodExport, Roster, SlotKey } from './types'

const CRIT = { critRate_: 1, critDMG_: 1, atk_: 0.75, atk: 0.3, enerRech_: 0.3, eleMas: 0.2 }

const build = (over: Partial<BuildConfig> = {}): BuildConfig => ({
  name: 'DPS',
  sets4: [
    { set: 'CrimsonWitchOfFlames', tier: 1 },
    { set: 'ShimenawasReminiscence', tier: 2 },
    { set: 'GladiatorsFinale', tier: 3 },
  ],
  sets2: [],
  mainStats: { sands: ['atk_'], goblet: ['pyro_dmg_'], circlet: ['critRate_', 'critDMG_'] },
  substatPreset: 'ATK_CRIT',
  substats: CRIT,
  erTarget: '',
  notes: '',
  ...over,
})

const support = build({
  name: 'Support',
  sets4: [{ set: 'NoblesseOblige', tier: 1 }],
  mainStats: { sands: ['enerRech_'], goblet: ['hp_'], circlet: ['hp_'] },
  substats: { enerRech_: 1, hp_: 1, hp: 0.3 },
})

const config: ArtifactConfig = {
  schemaVersion: 1,
  gameVersion: 'test',
  generated: '',
  scoringDefaults: {
    levelThreshold4Line: 1.75,
    levelThreshold3Line: 1.5,
    alwaysLevelCritCircletWithOtherCritSub: true,
    rescoreAtLevels: [4, 8, 12, 16],
  },
  legacySets: [],
  sets: Object.fromEntries(
    ['CrimsonWitchOfFlames', 'ShimenawasReminiscence', 'GladiatorsFinale', 'NoblesseOblige'].map((s) => [
      s,
      { twoPiece: '', fourPiece: '', twoPieceCategory: 'x' },
    ]),
  ),
  substatPresets: {},
  characters: {
    HuTao: { element: 'pyro', confidence: 'consensus', enabled: true, builds: [build()] },
    Bennett: { element: 'pyro', confidence: 'consensus', enabled: true, builds: [support] },
  },
}

const domains: DomainsFile = {
  version: 'test',
  domains: [
    { domain: 'Hidden Palace', region: 'Liyue', sets: ['Lavawalker', 'CrimsonWitchOfFlames'] },
    { domain: 'Clear Pool', region: 'Liyue', sets: ['BloodstainedChivalry', 'NoblesseOblige'] },
  ],
}

const MAIN: Record<SlotKey, string> = { flower: 'hp', plume: 'atk', sands: 'atk_', goblet: 'pyro_dmg_', circlet: 'critRate_' }

// A finished +20 with modest crit: about 3 crit rolls' worth.
const art = (over: Partial<GoodArtifact> = {}): GoodArtifact => ({
  setKey: 'CrimsonWitchOfFlames',
  slotKey: 'flower',
  level: 20,
  rarity: 5,
  mainStatKey: MAIN[over.slotKey ?? 'flower'],
  location: '',
  lock: true,
  substats: [
    { key: 'critRate_', value: 3.9 },
    { key: 'critDMG_', value: 7.8 },
    { key: 'def', value: 46 },
    { key: 'hp', value: 598 },
  ],
  ...over,
})

const strong = [
  { key: 'critRate_', value: 10.5 },
  { key: 'critDMG_', value: 21.0 },
  { key: 'atk_', value: 9.9 },
  { key: 'def', value: 19 },
]

describe('simulated pieces', () => {
  it('follows the main stat odds', () => {
    const sands = simulatePieces({ n: 20_000, seed: 7, fourLine: 0.2, slot: 'sands' })
    const er = sands.filter((p) => p.main === 'enerRech_').length / sands.length
    expect(er).toBeGreaterThan(0.085)
    expect(er).toBeLessThan(0.115)
    expect(sands.every((p) => !p.keys.includes(p.main))).toBe(true)
  })

  it('gives 4-liners 9 rolls in total and 3-liners 8', () => {
    const total = (p: { units: number[] }) => p.units.reduce((s, u) => s + u, 0)
    const four = simulatePieces({ n: 2_000, seed: 1, fourLine: 1 }).map(total)
    const three = simulatePieces({ n: 2_000, seed: 1, fourLine: 0 }).map(total)
    expect(Math.min(...four)).toBeGreaterThanOrEqual(9 * 0.7 - 1e-9)
    expect(Math.max(...four)).toBeLessThanOrEqual(9 + 1e-9)
    expect(Math.min(...three)).toBeGreaterThanOrEqual(8 * 0.7 - 1e-9)
    expect(Math.max(...three)).toBeLessThanOrEqual(8 + 1e-9)
  })

  it('puts the chosen elixir lines first and lands the guaranteed upgrades on them', () => {
    const opts = { n: 2_000, seed: 3, fourLine: 1, slot: 'circlet' as const, main: 'critRate_', chosen: ['critDMG_', 'atk_'] }
    const crafted = simulatePieces({ ...opts, guaranteed: 2 })
    expect(crafted.every((p) => p.keys[0] === 'critDMG_' && p.keys[1] === 'atk_')).toBe(true)
    // Two starting rolls plus at least two upgrades, each worth at least 0.7.
    expect(crafted.every((p) => p.units[0] + p.units[1] >= 4 * 0.7 - 1e-9)).toBe(true)
    const plain = simulatePieces(opts)
    expect(plain.some((p) => p.units[0] + p.units[1] < 4 * 0.7 - 1e-9)).toBe(true)
  })
})

describe('upgrade odds', () => {
  const pool = packPool(simulatePieces({ n: 20_000, seed: 5, fourLine: 0.2 }))
  const none = { flower: null, plume: null, sands: null, goblet: null, circlet: null }

  it('counts every fitting piece as an upgrade over an empty slot', () => {
    const odds = upgradeOdds(build(), none, pool)
    // Flower + plume + ATK% sands + Pyro goblet + CRIT circlet.
    const fit = 0.2 + 0.2 + 0.2 * 0.2666 + 0.2 * 0.05 + 0.2 * 0.2
    expect(odds.chance).toBeGreaterThan(fit - 0.03)
    expect(odds.chance).toBeLessThan(fit + 0.01)
    expect(odds.slots.flower.chance + odds.slots.circlet.chance).toBeLessThan(odds.chance)
  })

  it('finds nothing to gain over a perfect set', () => {
    const odds = upgradeOdds(build(), { flower: 99, plume: 99, sands: 99, goblet: 99, circlet: 99 }, pool)
    expect(odds.chance).toBe(0)
    expect(odds.gain).toBe(0)
  })
})

describe('best of n', () => {
  // Half the pieces gain exactly 1.0, the rest nothing.
  const counts = new Float64Array(401)
  counts[20] = 50
  const h = { total: 100, counts }

  it('approaches the best possible gain as n grows', () => {
    expect(expectedBestOf(h, 1)).toBeCloseTo(0.5, 6)
    expect(expectedBestOf(h, 2)).toBeCloseTo(0.75, 6)
    expect(expectedBestOf(h, 50)).toBeCloseTo(1, 6)
  })

  it('counts the pieces needed to expect a given gain', () => {
    expect(dropsToMatch(h, 0.5)).toBe(1)
    expect(dropsToMatch(h, 0.7)).toBe(2)
    expect(dropsToMatch(h, 0.9)).toBe(4)
    expect(dropsToMatch(h, 1.5)).toBe(MAX_DROPS)
  })
})

describe('set bonuses', () => {
  it('classifies what a character wears', () => {
    expect(setStatus({ CrimsonWitchOfFlames: 4, GladiatorsFinale: 1 }, build())).toEqual({
      kind: 'listed',
      set: 'CrimsonWitchOfFlames',
      tier: 1,
    })
    expect(setStatus({ NoblesseOblige: 5 }, build())).toEqual({ kind: 'unlisted', set: 'NoblesseOblige' })
    expect(setStatus({ NoblesseOblige: 2, GladiatorsFinale: 2, CrimsonWitchOfFlames: 1 }, build())).toEqual({ kind: 'none' })
  })

  it('farms the worn tier 1-2 set, otherwise the best tier', () => {
    expect(farmTargets(build(), { kind: 'listed', set: 'ShimenawasReminiscence', tier: 2 })).toEqual(['ShimenawasReminiscence'])
    expect(farmTargets(build(), { kind: 'listed', set: 'GladiatorsFinale', tier: 3 })).toEqual(['CrimsonWitchOfFlames'])
    expect(farmTargets(build(), { kind: 'none' })).toEqual(['CrimsonWitchOfFlames'])
  })

  it('follows the build a character is actually wearing', () => {
    const shield = support
    const dps = build()
    const ref = (b: BuildConfig, buildIdx: number) => ({
      char: 'Zhongli',
      buildIdx,
      build: b,
      priority: 'normal' as const,
      confidence: 'consensus' as const,
      cap: 3,
      owned: true,
    })
    const refs = [ref(dps, 0), ref(shield, 1)]
    const worn = new Map([['Zhongli', { NoblesseOblige: 5 }]])
    // The DPS build would see the HP% sands/goblet/circlet as unusable.
    const bars = (r: { build: BuildConfig }) =>
      r.build === dps
        ? { flower: 1, plume: 1, sands: null, goblet: null, circlet: null }
        : { flower: 1, plume: 1, sands: 1, goblet: 1, circlet: 1 }
    expect(currentBuilds(refs, worn, bars).map((r) => r.build.name)).toEqual(['Support'])
    // Nothing worn: the first build.
    const none = () => ({ flower: null, plume: null, sands: null, goblet: null, circlet: null })
    expect(currentBuilds(refs, new Map(), none).map((r) => r.buildIdx)).toEqual([0])
  })

  it('only allows swaps that keep every active bonus', () => {
    const fourPlusOne = { CrimsonWitchOfFlames: 4, GladiatorsFinale: 1 }
    expect(keepsSetBonuses(fourPlusOne, 'GladiatorsFinale', 'NoblesseOblige')).toBe(true)
    expect(keepsSetBonuses(fourPlusOne, 'CrimsonWitchOfFlames', 'NoblesseOblige')).toBe(false)
    expect(keepsSetBonuses({ CrimsonWitchOfFlames: 5 }, 'CrimsonWitchOfFlames', 'NoblesseOblige')).toBe(true)
    expect(keepsSetBonuses({ NoblesseOblige: 2, GladiatorsFinale: 2, CrimsonWitchOfFlames: 1 }, 'GladiatorsFinale', 'X')).toBe(false)
    expect(keepsSetBonuses({}, undefined, 'X')).toBe(true)
  })
})

describe('planFarming', () => {
  // Hu Tao wears 4pc Crimson Witch plus a Gladiator circlet; Bennett wears nothing.
  const worn = (['flower', 'plume', 'sands', 'goblet'] as const).map((slotKey) => art({ slotKey, location: 'HuTao' }))
  const data: GoodExport = {
    format: 'GOOD',
    version: 2,
    characters: ['HuTao', 'Bennett'].map((key) => ({
      key,
      level: 90,
      constellation: 0,
      ascension: 6,
      talent: { auto: 1, skill: 1, burst: 1 },
    })),
    artifacts: [
      ...worn,
      art({ slotKey: 'circlet', setKey: 'GladiatorsFinale', location: 'HuTao' }),
      // Spares: a better off-piece circlet (safe) and a better flower from another set (would break 4pc).
      art({ slotKey: 'circlet', setKey: 'ShimenawasReminiscence', substats: strong.filter((s) => s.key !== 'critRate_') }),
      art({ slotKey: 'flower', setKey: 'ShimenawasReminiscence', substats: strong }),
    ],
  }
  const pieces = loadPieces(data)
  const roster: Roster = {
    HuTao: { priority: 'priority', disabledBuilds: [] },
    Bennett: { priority: 'normal', disabledBuilds: [] },
  }
  const result = evaluate(pieces, data.characters, config, defaultSettings(config), roster)

  it('suggests only set-safe swaps from spare +20s', () => {
    const plan = planFarming(result, pieces, config, domains, 'priority')
    const hutao = plan.swaps.filter((s) => s.char === 'HuTao')
    expect(hutao.map((s) => s.slot)).toEqual(['circlet'])
    expect(hutao[0].to).toBeGreaterThan(hutao[0].from ?? 0)
  })

  it('holds back swaps that drop ER below the build minimum', () => {
    // Hu Tao's worn Gladiator circlet carries 30% ER; the spare circlet has none.
    const erPieces = loadPieces({
      ...data,
      artifacts: data.artifacts.map((a) =>
        a.slotKey === 'circlet' && a.location === 'HuTao'
          ? { ...a, substats: [...a.substats.slice(0, 3), { key: 'enerRech_', value: 30 }] }
          : a,
      ),
    })
    const withTarget = (erTarget: string): ArtifactConfig => ({
      ...config,
      characters: { ...config.characters, HuTao: { ...config.characters.HuTao, builds: [build({ erTarget })] } },
    })
    const gd: GameData = {
      source: 'test',
      fetched: '',
      weapons: { StaffOfHoma: { sub: { stat: 'critDMG_', base: 0.66, curve: 'FLAT' } } },
      chars: { HuTao: { stat: 'critDMG_', values: [0, 0, 0, 0, 0, 0, 0.384] } },
      curves: { FLAT: Array(101).fill(1) },
      artMain: {},
    }
    const exportWithWeapon = {
      ...data,
      weapons: [{ key: 'StaffOfHoma', level: 90, ascension: 6, refinement: 1, location: 'HuTao', lock: true }],
    }
    const plan = (erTarget: string) => {
      const cfg = withTarget(erTarget)
      const er = erModel(exportWithWeapon, gd, cfg)
      const res = evaluate(erPieces, data.characters, cfg, defaultSettings(cfg), roster)
      return planFarming(res, erPieces, cfg, domains, 'priority', er)
    }
    // 130% now; the swap leaves 100%.
    const loose = plan('100-120%').swaps.find((s) => s.char === 'HuTao')
    expect(loose?.er).toEqual({ from: 130, to: 100, need: 100 })
    const strict = plan('120%')
    expect(strict.swaps.some((s) => s.char === 'HuTao')).toBe(false)
    expect(strict.erHeld).toBe(1)
  })

  it('gives ★ Priority characters first pick and lists them first', () => {
    // As a DPS, Bennett (wearing nothing) would gain more from the circlet than Hu Tao does.
    const dps: ArtifactConfig = {
      ...config,
      characters: { ...config.characters, Bennett: { ...config.characters.Bennett, builds: [build()] } },
    }
    const res = evaluate(pieces, data.characters, dps, defaultSettings(dps), roster)
    const { swaps } = planFarming(res, pieces, dps, domains, 'priority')
    expect(swaps.map((s) => `${s.char} ${s.slot}`)).toEqual(['HuTao circlet', 'Bennett flower'])
    const gain = (s: (typeof swaps)[number]) => s.to - (s.from ?? 0)
    expect(gain(swaps[1])).toBeGreaterThan(gain(swaps[0]))
  })

  it("doesn't let swaps that are each set-safe break a bonus together", () => {
    // Hu Tao wears 5 Crimson Witch. Better off-set sands and goblet are each safe alone (5 → 4), not both (→ 3).
    const five: GoodExport = {
      ...data,
      artifacts: [
        ...(['flower', 'plume', 'sands', 'goblet', 'circlet'] as const).map((slotKey) => art({ slotKey, location: 'HuTao' })),
        art({ slotKey: 'sands', setKey: 'GladiatorsFinale', substats: strong }),
        art({ slotKey: 'goblet', setKey: 'GladiatorsFinale', substats: strong }),
      ],
    }
    expect(keepsSetBonuses({ CrimsonWitchOfFlames: 5 }, 'CrimsonWitchOfFlames', 'GladiatorsFinale')).toBe(true)
    const ps = loadPieces(five)
    const res = evaluate(ps, five.characters, config, defaultSettings(config), roster)
    const hutao = planFarming(res, ps, config, domains, 'priority').swaps.filter((s) => s.char === 'HuTao')
    expect(hutao).toHaveLength(1)
  })

  it('offers no Elixir craft to a build without 4pc sets', () => {
    const bare: ArtifactConfig = {
      ...config,
      characters: { ...config.characters, HuTao: { ...config.characters.HuTao, builds: [build({ sets4: [] })] } },
    }
    const res = evaluate(pieces, data.characters, bare, defaultSettings(bare), roster)
    const plan = planFarming(res, pieces, bare, domains, 'all')
    expect(plan.characters.find((c) => c.char === 'HuTao')?.elixir).toBeNull()
  })

  it('ranks domains for the characters in scope', () => {
    const priority = planFarming(result, pieces, config, domains, 'priority')
    expect(priority.scope).toBe('priority')
    expect(priority.domains[0].key).toBe('Hidden Palace')
    expect(priority.domains[1].value).toBe(0)
    // Bennett has nothing equipped, so with everyone counted his domain wins.
    const all = planFarming(result, pieces, config, domains, 'all')
    expect(all.domains[0].key).toBe('Clear Pool')
    expect(all.characters[0].char).toBe('Bennett')
    expect(all.noDomain).toEqual([])
  })

  it('falls back to every active character when nobody is Priority', () => {
    const plain = evaluate(pieces, data.characters, config, defaultSettings(config), {})
    expect(planFarming(plain, pieces, config, domains, 'priority').scope).toBe('all')
  })

  it('spends elixirs on slots that are hard to farm', () => {
    // Bennett wears nothing, so every slot gains a lot; the easy flower and plume should lose out.
    const plan = planFarming(result, pieces, config, domains, 'all')
    const pick = plan.characters.find((c) => c.char === 'Bennett')!.elixir!
    expect(['sands', 'goblet', 'circlet']).toContain(pick.slot)
    expect(pick.extra).toBeGreaterThan(0)
    expect(pick.extra).toBeLessThanOrEqual(pick.gain)
  })

  it('picks elixir lines by weight', () => {
    const plan = planFarming(result, pieces, config, domains, 'all')
    const pick = plan.characters.find((c) => c.char === 'HuTao')!.elixir!
    expect(pick.set).toBe('CrimsonWitchOfFlames')
    expect(pick.chosen).toHaveLength(2)
    for (const k of pick.chosen) expect(['critRate_', 'critDMG_', 'atk_']).toContain(k)
    expect(pick.chosen).not.toContain(pick.main)
  })
})
