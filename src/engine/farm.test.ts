import { describe, expect, it } from 'vitest'
import { characterBoard, swapGain } from './board'
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
  setsFit,
  setStatus,
  simulatePieces,
  swapSetFit,
  upgradeOdds,
  type DomainsFile,
} from './farm'
import { planFeedOrBox } from './fodder'
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
    expect(currentBuilds(refs, worn, bars, bars).map((r) => r.build.name)).toEqual(['Support'])
    // Nothing worn: the first build.
    const none = () => ({ flower: null, plume: null, sands: null, goblet: null, circlet: null })
    expect(currentBuilds(refs, new Map(), none, none).map((r) => r.buildIdx)).toEqual([0])
  })

  it('compares builds that fit equally by their ratings, not their raw values', () => {
    // Like Nilou in 2pc + 2pc: both builds fit every slot. The pieces add up to more for the build that weighs more
    // stats, but they're nearer what the other build wants.
    const bloom = build({ name: 'Bloom' })
    const hybrid = build({ name: 'Hybrid' })
    const ref = (b: BuildConfig, buildIdx: number) => ({
      char: 'Nilou',
      buildIdx,
      build: b,
      priority: 'normal' as const,
      confidence: 'consensus' as const,
      cap: 3,
      owned: true,
    })
    const refs = [ref(hybrid, 0), ref(bloom, 1)]
    const worn = new Map([['Nilou', { GildedDreams: 1, VourukashasGlow: 2, TenacityOfTheMillelith: 2 }]])
    const slots = (bloomV: number, hybridV: number) => (r: { build: BuildConfig }) => {
      const v = r.build === bloom ? bloomV : hybridV
      return { flower: v, plume: v, sands: v, goblet: v, circlet: v }
    }
    const values = slots(2.2, 2.8)
    const ratings = slots(0.79, 0.58)
    expect(currentBuilds(refs, worn, values, ratings).map((r) => r.build.name)).toEqual(['Bloom'])
  })

  it('only allows swaps that keep every active bonus', () => {
    const fourPlusOne = { CrimsonWitchOfFlames: 4, GladiatorsFinale: 1 }
    expect(keepsSetBonuses(fourPlusOne, 'GladiatorsFinale', 'NoblesseOblige')).toBe(true)
    expect(keepsSetBonuses(fourPlusOne, 'CrimsonWitchOfFlames', 'NoblesseOblige')).toBe(false)
    expect(keepsSetBonuses({ CrimsonWitchOfFlames: 5 }, 'CrimsonWitchOfFlames', 'NoblesseOblige')).toBe(true)
    expect(keepsSetBonuses({ NoblesseOblige: 2, GladiatorsFinale: 2, CrimsonWitchOfFlames: 1 }, 'GladiatorsFinale', 'X')).toBe(false)
    expect(keepsSetBonuses({}, undefined, 'X')).toBe(true)
  })

  const cat = (twoPieceCategory: string) => ({ twoPiece: '', fourPiece: '', twoPieceCategory })
  const cats: ArtifactConfig = {
    ...config,
    sets: {
      GladiatorsFinale: cat('atk18'),
      ShimenawasReminiscence: cat('atk18'),
      EmblemOfSeveredFate: cat('er20'),
      NoblesseOblige: cat('burst20'),
      CrimsonWitchOfFlames: cat('ele15:pyro'),
    },
  }

  it('lets a swap trade one 2pc for another only when the build lists the pair it makes', () => {
    const quill = build({ sets4: [{ set: 'NoblesseOblige', tier: 1 }], sets2: [['atk18', 'atk18']] })
    const twoTwo = { GladiatorsFinale: 2, ShimenawasReminiscence: 2, EmblemOfSeveredFate: 1 }
    // ATK + ATK → ATK + ER isn't a pair this build lists.
    expect(swapSetFit(twoTwo, 'GladiatorsFinale', 'EmblemOfSeveredFate', quill, cats)).toBeNull()
    const withEr = build({ ...quill, sets2: [['atk18', 'atk18'], ['atk18', 'er20']] })
    expect(swapSetFit(twoTwo, 'GladiatorsFinale', 'EmblemOfSeveredFate', withEr, cats)).toEqual({
      lost: [{ set: 'GladiatorsFinale', pieces: 2 }],
      gained: [{ set: 'EmblemOfSeveredFate', pieces: 2 }],
    })
    // Keeping every bonus needs no pair.
    expect(swapSetFit(twoTwo, 'EmblemOfSeveredFate', 'X', quill, cats)).toEqual({ lost: [], gained: [] })
    // Two ATK bonuses need two sets: 4pc Gladiator is one.
    expect(swapSetFit({ GladiatorsFinale: 3, ShimenawasReminiscence: 2 }, 'ShimenawasReminiscence', 'GladiatorsFinale', quill, cats)).toBeNull()
    // "any" leaves that half free.
    const loose = build({ ...quill, sets2: [['atk18', 'any']] })
    expect(swapSetFit(twoTwo, 'GladiatorsFinale', 'EmblemOfSeveredFate', loose, cats)?.lost).toEqual([{ set: 'GladiatorsFinale', pieces: 2 }])
    // Without the config the categories are unknown, so only keeping every bonus fits.
    expect(swapSetFit(twoTwo, 'GladiatorsFinale', 'EmblemOfSeveredFate', withEr, null)).toBeNull()
  })

  it('gives up a 2pc to complete a listed 4pc, but never trades a 4pc away', () => {
    const dps = build({ sets2: [['any', 'any']] })
    expect(
      swapSetFit({ CrimsonWitchOfFlames: 3, GladiatorsFinale: 2 }, 'GladiatorsFinale', 'CrimsonWitchOfFlames', dps, cats),
    ).toEqual({ lost: [{ set: 'GladiatorsFinale', pieces: 2 }], gained: [{ set: 'CrimsonWitchOfFlames', pieces: 4 }] })
    // Even with "any + any" still met afterwards, a 4pc stays: listed or not.
    expect(swapSetFit({ CrimsonWitchOfFlames: 4, GladiatorsFinale: 1 }, 'CrimsonWitchOfFlames', 'GladiatorsFinale', dps, cats)).toBeNull()
    expect(swapSetFit({ NoblesseOblige: 4, GladiatorsFinale: 1 }, 'NoblesseOblige', 'GladiatorsFinale', dps, cats)).toBeNull()
  })

  describe('a set kept for 2pc pairs only', () => {
    // Nilou: Tenacity 2pc + Vourukasha 2pc (HP + HP), neither 4pc wanted over them; Gilded Dreams is a real 4pc.
    const hp = cat('hp20')
    const nilouCats: ArtifactConfig = {
      ...cats,
      sets: { ...cats.sets, TenacityOfTheMillelith: hp, VourukashasGlow: hp, GildedDreams: cat('em80') },
    }
    const bloom = build({
      name: 'Bloom',
      sets4: [
        { set: 'TenacityOfTheMillelith', tier: 1, twoPieceOnly: true },
        { set: 'VourukashasGlow', tier: 1, twoPieceOnly: true },
        { set: 'GildedDreams', tier: 2 },
      ],
      sets2: [['hp20', 'hp20']],
    })
    // The same sets with Vourukasha as a real 4pc, for a build that wants its Skill/Burst DMG.
    const burst = build({
      ...bloom,
      name: 'Burst',
      sets4: [
        { set: 'VourukashasGlow', tier: 1 },
        { set: 'TenacityOfTheMillelith', tier: 1, twoPieceOnly: true },
      ],
    })

    it("isn't a listed 4pc when worn, and farming keeps to the pair", () => {
      expect(setStatus({ VourukashasGlow: 4, TenacityOfTheMillelith: 1 }, bloom)).toEqual({ kind: 'twoPiece', set: 'VourukashasGlow' })
      expect(setStatus({ VourukashasGlow: 4, TenacityOfTheMillelith: 1 }, burst)).toEqual({
        kind: 'listed',
        set: 'VourukashasGlow',
        tier: 1,
      })
      const status = setStatus({ VourukashasGlow: 4, TenacityOfTheMillelith: 1 }, bloom)
      expect(farmTargets(bloom, status)).toEqual(['TenacityOfTheMillelith', 'VourukashasGlow'])
    })

    it("won't give up a 2pc to complete its 4pc", () => {
      const threeTwo = { VourukashasGlow: 3, TenacityOfTheMillelith: 2 }
      expect(swapSetFit(threeTwo, 'TenacityOfTheMillelith', 'VourukashasGlow', bloom, nilouCats)).toBeNull()
      // Where its 4pc is a real one, completing it is fine.
      expect(swapSetFit(threeTwo, 'TenacityOfTheMillelith', 'VourukashasGlow', burst, nilouCats)).toEqual({
        lost: [{ set: 'TenacityOfTheMillelith', pieces: 2 }],
        gained: [{ set: 'VourukashasGlow', pieces: 4 }],
      })
      // Completing a real 4pc listed below it still ranks above the pair.
      expect(swapSetFit({ GildedDreams: 3, VourukashasGlow: 2 }, 'VourukashasGlow', 'GildedDreams', bloom, nilouCats)).not.toBeNull()
    })

    it('can go back from its 4pc to its 2pc', () => {
      const fourOne = { VourukashasGlow: 4, TenacityOfTheMillelith: 1 }
      expect(swapSetFit(fourOne, 'VourukashasGlow', 'TenacityOfTheMillelith', bloom, nilouCats)).toEqual({
        lost: [{ set: 'VourukashasGlow', pieces: 4 }],
        gained: [{ set: 'TenacityOfTheMillelith', pieces: 2 }],
      })
      // Its 2pc stays, so even a piece of another set only gives up what the build doesn't want.
      expect(swapSetFit(fourOne, 'VourukashasGlow', 'X', bloom, nilouCats)?.lost).toEqual([{ set: 'VourukashasGlow', pieces: 4 }])
      // A real 4pc is never traded away.
      expect(swapSetFit(fourOne, 'VourukashasGlow', 'TenacityOfTheMillelith', burst, nilouCats)).toBeNull()
    })

    it('still counts its 2pc', () => {
      // Losing Vourukasha's 2pc breaks the pair, and a 4pc Tenacity doesn't make up for it.
      expect(setsFit({ VourukashasGlow: 2, TenacityOfTheMillelith: 3 }, { VourukashasGlow: 1, TenacityOfTheMillelith: 4 }, bloom, nilouCats)).toBeNull()
      expect(swapSetFit({ VourukashasGlow: 2, TenacityOfTheMillelith: 2, GildedDreams: 1 }, 'VourukashasGlow', 'X', bloom, nilouCats)).toBeNull()
    })

    it("doesn't mark the build being worn", () => {
      const ref = (b: BuildConfig, buildIdx: number) => ({
        char: 'Nilou',
        buildIdx,
        build: b,
        priority: 'normal' as const,
        confidence: 'consensus' as const,
        cap: 3,
        owned: true,
      })
      const worn = new Map([['Nilou', { VourukashasGlow: 4, TenacityOfTheMillelith: 1 }]])
      const full = () => ({ flower: 1, plume: 1, sands: 1, goblet: 1, circlet: 1 })
      // Both fit every slot; the Burst build runs 4pc Vourukasha, the Bloom build doesn't.
      expect(currentBuilds([ref(bloom, 0), ref(burst, 1)], worn, full, full).map((r) => r.build.name)).toEqual(['Burst'])
    })
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

  // Hu Tao's ER is 100% plus her artifacts: neither her ascension stat nor her weapon gives any.
  const gd: GameData = {
    source: 'test',
    fetched: '',
    weapons: { StaffOfHoma: { sub: { stat: 'critDMG_', base: 0.66, curve: 'FLAT' } } },
    chars: { HuTao: { stat: 'critDMG_', values: [0, 0, 0, 0, 0, 0, 0.384] } },
    curves: { FLAT: Array(101).fill(1) },
    artMain: {},
  }
  const withTarget = (erTarget: string): ArtifactConfig => ({
    ...config,
    characters: { ...config.characters, HuTao: { ...config.characters.HuTao, builds: [build({ erTarget })] } },
  })
  const homa = [{ key: 'StaffOfHoma', level: 90, ascension: 6, refinement: 1, location: 'HuTao', lock: true }]

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
    const exportWithWeapon = { ...data, weapons: homa }
    const plan = (erTarget: string) => {
      const cfg = withTarget(erTarget)
      const er = erModel(exportWithWeapon, gd, cfg)
      const res = evaluate(erPieces, data.characters, cfg, defaultSettings(cfg), roster)
      return planFarming(res, erPieces, cfg, domains, 'priority', er)
    }
    // 130% now; the swap leaves 100%. The 20% lost under 120% costs a little of the swap's gain.
    const loose = plan('100-120%').swaps.find((s) => s.char === 'HuTao')
    expect(loose?.er).toEqual({ from: 130, to: 100, need: 100, cap: 120 })
    expect(loose?.erGain).toBeCloseTo((-0.3 * 20) / 6.48)
    const strict = plan('120%')
    expect(strict.swaps.some((s) => s.char === 'HuTao')).toBe(false)
    expect(strict.erHeld).toBe(1)
  })

  it('treats ER past the target as worth nothing, so a swap can shed it', () => {
    // Hu Tao's worn circlet: 2 crit rolls plus 30% ER she doesn't need at 100%. The spare has 3.5 crit rolls.
    const erData: GoodExport = {
      ...data,
      weapons: homa,
      artifacts: [
        ...worn,
        art({ slotKey: 'circlet', setKey: 'GladiatorsFinale', location: 'HuTao', substats: [...art().substats.slice(0, 3), { key: 'enerRech_', value: 30 }] }),
        art({ slotKey: 'circlet', setKey: 'ShimenawasReminiscence', substats: [{ key: 'critRate_', value: 3.9 }, { key: 'critDMG_', value: 19.4 }, { key: 'def', value: 46 }, { key: 'hp', value: 598 }] }),
      ],
    }
    const ps = loadPieces(erData)
    const swapsFor = (erTarget: string, gameData: GameData | null = gd) => {
      const cfg = withTarget(erTarget)
      const res = evaluate(ps, erData.characters, cfg, defaultSettings(cfg), roster)
      return planFarming(res, ps, cfg, domains, 'priority', erModel(erData, gameData, cfg)).swaps.filter((s) => s.char === 'HuTao')
    }
    const [swap] = swapsFor('100%')
    expect(swap).toMatchObject({ erGain: 0, er: { from: 130, to: 100 } })
    expect(swap.from).toBeCloseTo(3.9 / 3.89 + 7.8 / 7.77)
    expect(swap.to).toBeCloseTo(3.9 / 3.89 + 19.4 / 7.77)
    // With her ER unknown, the line keeps its 0.3 weight (1.39) and the spare isn't worth the trouble.
    expect(swapsFor('100%', null)).toEqual([])
  })

  it('counts the ER a swap brings toward the target', () => {
    // The spare has half the worn circlet's CRIT DMG and 32.4% ER instead of flat HP.
    const erData: GoodExport = {
      ...data,
      weapons: homa,
      artifacts: [
        ...worn,
        art({ slotKey: 'circlet', setKey: 'GladiatorsFinale', location: 'HuTao' }),
        art({
          slotKey: 'circlet',
          setKey: 'ShimenawasReminiscence',
          substats: [{ key: 'critRate_', value: 3.9 }, { key: 'critDMG_', value: 3.9 }, { key: 'def', value: 46 }, { key: 'enerRech_', value: 32.4 }],
        }),
      ],
    }
    const ps = loadPieces(erData)
    const swapsFor = (erTarget: string) => {
      const cfg = withTarget(erTarget)
      const res = evaluate(ps, erData.characters, cfg, defaultSettings(cfg), roster)
      return planFarming(res, ps, cfg, domains, 'priority', erModel(erData, gd, cfg)).swaps.filter((s) => s.char === 'HuTao')
    }
    // Short of 150%, the 32.4% she gains (five max rolls) counts at her 0.3 ER weight, and outweighs the CRIT DMG.
    const [swap] = swapsFor('150%')
    expect(swap.to).toBeLessThan(swap.from!)
    expect(swap.er).toEqual({ from: 100, to: 132.4, need: 150, cap: 150 })
    expect(swap.erGain).toBeCloseTo(0.3 * 5)
    // Only the ER up to the top of the target counts: 10% of it toward 100-110% isn't enough.
    expect(swapsFor('100-110%')).toEqual([])
    // Once 100% is enough, the ER is worth nothing and the swap isn't worth making.
    expect(swapsFor('100%')).toEqual([])
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
    // On the Building list, Bennett picks before the ★ character, and is listed first.
    const building = evaluate(pieces, data.characters, dps, defaultSettings(dps), roster, new Set(['Bennett']))
    const picked = planFarming(building, pieces, dps, domains, 'priority').swaps
    expect(picked.find((s) => s.slot === 'circlet')?.char).toBe('Bennett')
    expect(picked.every((s) => s.char === 'Bennett')).toBe(true)
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

  it("flags pieces of a source's sets still to level for the characters it helps", () => {
    // A fresh Crimson Witch sands with strong lines: triage keeps it for Hu Tao, who farms Crimson Witch.
    const fresh = art({ slotKey: 'sands', level: 0, substats: strong })
    const withFresh = { ...data, artifacts: [...data.artifacts, fresh] }
    const ps = loadPieces(withFresh)
    const res = evaluate(ps, withFresh.characters, config, defaultSettings(config), roster)
    const piece = ps.find((p) => p.setKey === 'CrimsonWitchOfFlames' && p.slotKey === 'sands' && !p.owner)!
    expect(res.evaluations.find((e) => e.piece === piece)?.verdict).toBe('level')
    const plan = planFarming(res, ps, config, domains, 'priority')
    expect(plan.domains.find((d) => d.key === 'Hidden Palace')?.toLevel).toEqual([{ piece, chars: ['HuTao'] }])
    expect(plan.strongbox.find((s) => s.key === 'CrimsonWitchOfFlames')?.toLevel).toEqual([{ piece, chars: ['HuTao'] }])
    // Bennett's domain doesn't help Hu Tao, so it doesn't flag her piece.
    expect(plan.domains.find((d) => d.key === 'Clear Pool')?.toLevel).toEqual([])
  })

  it('puts each free swap and piece to level on the Characters board', () => {
    // A fresh Crimson Witch sands with strong lines, kept for Hu Tao, beside her free circlet swap.
    const fresh = art({ slotKey: 'sands', level: 0, substats: strong })
    const withFresh = { ...data, artifacts: [...data.artifacts, fresh] }
    const ps = loadPieces(withFresh)
    const res = evaluate(ps, withFresh.characters, config, defaultSettings(config), roster)
    const plan = planFarming(res, ps, config, domains, 'all')
    const rows = characterBoard(res, ps, plan, [], null)
    const hutao = rows.find((r) => r.char === 'HuTao')!
    expect(hutao.ref?.buildIdx).toBe(0)
    expect(hutao.fixes.circlet.swap?.piece.setKey).toBe('ShimenawasReminiscence')
    expect(hutao.freeGain).toBeCloseTo(swapGain(hutao.fixes.circlet.swap!))
    expect(hutao.fixes.sands.level?.piece.level).toBe(0)
    expect(hutao.fixes.sands.level!.gain).toBeGreaterThan(0.5)
    expect(hutao.fixes.flower.swap).toBeNull()
    expect(hutao.newPiece).toBeGreaterThan(0)
    // Bennett wears nothing: every slot is unusable, so his weakest is 0.
    const bennett = rows.find((r) => r.char === 'Bennett')!
    expect(bennett.ratings.flower).toBeNull()
    expect(bennett.min).toBe(0)
  })

  it('lists the pieces to level next, best gain per EXP first, funded while the EXP lasts', () => {
    const fresh = art({ slotKey: 'sands', level: 0, substats: strong })
    const withFresh = { ...data, artifacts: [...data.artifacts, fresh] }
    const ps = loadPieces(withFresh)
    const res = evaluate(ps, withFresh.characters, config, defaultSettings(config), roster)
    const piece = ps.find((p) => p.setKey === 'CrimsonWitchOfFlames' && p.slotKey === 'sands' && !p.owner)!
    const plan = planFarming(res, ps, config, domains, 'all')
    const rich = planFeedOrBox(res, plan, { SanctifyingEssence: 1000 }, 0.2)
    expect(rich.queue.pieces[0]).toMatchObject({ piece, funded: true })
    expect(rich.queue.pieces[0].ref.char).toBe('HuTao')
    expect(rich.queue.pieces[0].gain).toBeGreaterThan(0)
    const rates = rich.queue.pieces.map((q) => q.gain / q.exp)
    rates.forEach((r, i) => i > 0 && expect(r).toBeLessThanOrEqual(rates[i - 1]))
    expect(rich.queue.pieces.filter((q) => q.funded)).toHaveLength(rich.queue.funded)
    // No EXP on hand: still listed, but nothing is funded.
    const broke = planFeedOrBox(res, plan, {}, 0.2)
    expect(broke.queue.pieces[0]).toMatchObject({ piece, funded: false })
  })

  it('ranks for the Building list, falling back to ★ Priority when it is empty', () => {
    const building = evaluate(pieces, data.characters, config, defaultSettings(config), roster, new Set(['Bennett']))
    const plan = planFarming(building, pieces, config, domains, 'building')
    expect(plan.scope).toBe('building')
    expect(plan.domains[0].key).toBe('Clear Pool')
    expect(plan.domains.find((d) => d.key === 'Hidden Palace')?.value).toBe(0)
    expect(planFarming(result, pieces, config, domains, 'building').scope).toBe('priority')
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
