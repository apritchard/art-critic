import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { erModel, type GameData } from './er'
import { defaultSettings, evaluate } from './evaluate'
import { planFarming, STRONGBOX_SETS, type DomainsFile } from './farm'
import { improveCharacter } from './improve'
import { loadPieces } from './load'
import type { ArtifactConfig, BuildConfig, GoodArtifact, GoodExport, Roster, SlotKey } from './types'

const build: BuildConfig = {
  name: 'DPS',
  sets4: [
    { set: 'CrimsonWitchOfFlames', tier: 1 },
    { set: 'ShimenawasReminiscence', tier: 2 },
  ],
  sets2: [],
  mainStats: { sands: ['atk_'], goblet: ['pyro_dmg_'], circlet: ['critRate_', 'critDMG_'] },
  substatPreset: 'ATK_CRIT',
  substats: { critRate_: 1, critDMG_: 1, atk_: 0.75, atk: 0.3, enerRech_: 0.3, eleMas: 0.2 },
  erTarget: '',
  notes: '',
}

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
    ['CrimsonWitchOfFlames', 'ShimenawasReminiscence', 'GladiatorsFinale', 'Lavawalker', 'NewSet'].map((s) => [
      s,
      { twoPiece: '', fourPiece: '', twoPieceCategory: 'x' },
    ]),
  ),
  substatPresets: {},
  characters: {
    HuTao: { element: 'pyro', confidence: 'consensus', enabled: true, builds: [build] },
    Bennett: { element: 'pyro', confidence: 'consensus', enabled: true, builds: [build] },
  },
}

const domains: DomainsFile = {
  version: 'test',
  domains: [
    { domain: 'Hidden Palace', region: 'Liyue', sets: ['Lavawalker', 'CrimsonWitchOfFlames'] },
    { domain: 'Momiji-Dyed Court', region: 'Inazuma', sets: ['ShimenawasReminiscence', 'EmblemOfSeveredFate'] },
    { domain: 'New Domain', region: 'Newland', sets: ['NewSet', 'OtherNewSet'] },
  ],
}

const MAIN: Record<SlotKey, string> = { flower: 'hp', plume: 'atk', sands: 'atk_', goblet: 'pyro_dmg_', circlet: 'critRate_' }
const weak = [
  { key: 'critRate_', value: 3.9 },
  { key: 'def', value: 46 },
  { key: 'hp', value: 598 },
  { key: 'def_', value: 14.6 },
]
const strong = [
  { key: 'critDMG_', value: 21.0 },
  { key: 'atk_', value: 9.9 },
  { key: 'atk', value: 19 },
  { key: 'def', value: 19 },
]
const art = (over: Partial<GoodArtifact>): GoodArtifact => ({
  setKey: 'CrimsonWitchOfFlames',
  slotKey: 'flower',
  level: 20,
  rarity: 5,
  mainStatKey: MAIN[over.slotKey ?? 'flower'],
  location: '',
  lock: true,
  substats: strong,
  ...over,
})

describe('improveCharacter', () => {
  // Hu Tao: 4pc Crimson Witch and a weak Gladiator circlet. Bennett is ignored but wears a good circlet.
  const data: GoodExport = {
    format: 'GOOD',
    version: 2,
    characters: ['HuTao', 'Bennett'].map((key) => ({ key, level: 90, constellation: 0, ascension: 6, talent: { auto: 1, skill: 1, burst: 1 } })),
    artifacts: [
      ...(['flower', 'plume', 'sands', 'goblet'] as const).map((slotKey) => art({ slotKey, location: 'HuTao' })),
      art({ slotKey: 'circlet', setKey: 'GladiatorsFinale', location: 'HuTao', substats: weak }),
      art({ slotKey: 'circlet', setKey: 'ShimenawasReminiscence', mainStatKey: 'critRate_', location: 'Bennett' }),
      // Spares: an off-set circlet (fits the free slot) and a Shimenawa flower (only with 4pc Shimenawa).
      art({ slotKey: 'circlet', setKey: 'GladiatorsFinale' }),
      art({ slotKey: 'flower', setKey: 'ShimenawasReminiscence', substats: [...strong.slice(0, 3), { key: 'critRate_', value: 10.5 }] }),
      // A fresh Crimson Witch circlet to level.
      art({ slotKey: 'circlet', level: 0, substats: [{ key: 'critDMG_', value: 7.8 }, { key: 'atk_', value: 5.8 }, { key: 'def', value: 23 }, { key: 'hp', value: 299 }] }),
    ],
  }
  const pieces = loadPieces(data)
  const roster: Roster = { HuTao: { priority: 'priority', disabledBuilds: [] }, Bennett: { priority: 'ignore', disabledBuilds: [] } }
  const result = evaluate(pieces, data.characters, config, defaultSettings(config), roster)
  const ref = result.activeBuilds.find((r) => r.char === 'HuTao')!
  const plan = (strongboxSets: Set<string> | null = null) =>
    improveCharacter({ result, pieces, config, domains, er: null, ref, guarantee: 2, claimed: new Map(), strongboxSets })

  it('puts the weakest slot first and lists every kind of option', () => {
    const [circlet] = plan().slots
    expect(circlet.slot).toBe('circlet')
    expect(circlet.spares[0].piece.setKey).toBe('GladiatorsFinale')
    expect(circlet.spares[0].fit).toEqual({ kind: 'keeps' })
    // Bennett is ignored, so his circlet costs nothing.
    expect(circlet.taken.map((t) => [t.owner, t.ownerActive])).toEqual([['Bennett', false]])
    expect(circlet.level[0].piece.level).toBe(0)
    expect(circlet.level[0].chance).toBeGreaterThan(0)
    expect(circlet.reroll).toBeNull() // no starting values in this export
    expect(circlet.elixir?.slot).toBe('circlet')
    expect(circlet.domain?.domains).toEqual(['Hidden Palace'])
  })

  it('marks pieces that only fit another listed 4pc set', () => {
    const flower = plan().slots.find((s) => s.slot === 'flower')!
    expect(flower.spares[0].fit).toEqual({ kind: 'switch', tier: 2 })
  })

  it("doesn't suggest switching to the 4pc of a set kept for 2pc pairs only", () => {
    const sets4 = build.sets4.map((s) => (s.set === 'ShimenawasReminiscence' ? { ...s, twoPieceOnly: true } : s))
    const pairs: ArtifactConfig = {
      ...config,
      characters: { ...config.characters, HuTao: { ...config.characters.HuTao, builds: [{ ...build, sets4 }] } },
    }
    const res = evaluate(pieces, data.characters, pairs, defaultSettings(pairs), roster)
    const hutao = res.activeBuilds.find((r) => r.char === 'HuTao')!
    const p = improveCharacter({ result: res, pieces, config: pairs, domains, er: null, ref: hutao, guarantee: 2, claimed: new Map(), strongboxSets: null })
    const flower = p.slots.find((s) => s.slot === 'flower')!
    expect(flower.spares[0].fit).toEqual({ kind: 'breaks', set: 'CrimsonWitchOfFlames' })
  })

  it('lists spares a reroll could lift past the worn piece', () => {
    // Worth 0.7 against the worn circlet's 1.0, with every upgrade on DEF. Rerolled, one upgrade on CRIT DMG beats it;
    // the guarantee lands on the pair picked (CRIT DMG and a dead line), so that's likely but not certain.
    const rerollable = art({
      slotKey: 'circlet',
      totalRolls: 9,
      substats: [
        { key: 'critDMG_', value: 5.4, initialValue: 5.4 },
        { key: 'def', value: 138, initialValue: 23 },
        { key: 'hp', value: 299, initialValue: 299 },
        { key: 'def_', value: 7.3, initialValue: 7.3 },
      ],
    })
    const ps = loadPieces({ ...data, artifacts: [...data.artifacts, rerollable] })
    const res = evaluate(ps, data.characters, config, defaultSettings(config), roster)
    const hutao = res.activeBuilds.find((r) => r.char === 'HuTao')!
    const p = improveCharacter({ result: res, pieces: ps, config, domains, er: null, ref: hutao, guarantee: 2, claimed: new Map(), strongboxSets: null })
    const circlet = p.slots.find((s) => s.slot === 'circlet')!
    // The other spares have no starting values, and the one past the worn piece is a spare as it is.
    expect(circlet.spareRerolls).toHaveLength(1)
    const [o] = circlet.spareRerolls
    expect(o).toMatchObject({ fit: { kind: 'keeps' }, cost: 2, claimedBy: null })
    expect(o.piece.substats[1].value).toBe(138)
    expect(o.chosen).toContain('critDMG_')
    expect(o.current).toBeCloseTo(0.7, 1)
    expect(o.bar).toBeCloseTo(circlet.now!, 6)
    expect(o.chance).toBeGreaterThan(0.75)
    expect(o.chance).toBeLessThan(0.9)
    // Measured against the worn circlet: a miss counts as 0, so the gain is at least the average's lead over it.
    expect(o.gain).toBeGreaterThanOrEqual(o.value - circlet.now! - 1e-9)
    expect(o.gain).toBeLessThan(o.value - o.current)
    // A spare the Farm tab gives someone else says so.
    const claimed = new Map([[o.piece.id, 'Bennett']])
    const again = improveCharacter({ result: res, pieces: ps, config, domains, er: null, ref: hutao, guarantee: 2, claimed, strongboxSets: null })
    expect(again.slots.find((s) => s.slot === 'circlet')!.spareRerolls[0].claimedBy).toBe('Bennett')
  })

  it("doesn't count Strongbox crafts of sets it can't make", () => {
    const circlet = plan(new Set(['Lavawalker'])).slots[0]
    expect(circlet.strongbox).toMatchObject({ chance: 0, sets: [], missing: ['CrimsonWitchOfFlames'] })
    expect(plan(null).slots[0].strongbox!.chance).toBeGreaterThan(0)
  })
})

describe('a build without 4pc sets', () => {
  it('still plans, with no Elixir craft', () => {
    const pieces = loadPieces({
      format: 'GOOD',
      version: 2,
      characters: [{ key: 'HuTao', level: 90, constellation: 0, ascension: 6, talent: { auto: 1, skill: 1, burst: 1 } }],
      artifacts: [art({ location: 'HuTao' }), art({ slotKey: 'circlet' })],
    })
    const bare: ArtifactConfig = {
      ...config,
      characters: { HuTao: { ...config.characters.HuTao, builds: [{ ...build, sets4: [] }] } },
    }
    const result = evaluate(pieces, [{ key: 'HuTao', level: 90, constellation: 0, ascension: 6, talent: { auto: 1, skill: 1, burst: 1 } }], bare, defaultSettings(bare), {})
    const ref = result.activeBuilds.find((r) => r.char === 'HuTao')!
    const plan = improveCharacter({ result, pieces, config: bare, domains, er: null, ref, guarantee: 2, claimed: new Map(), strongboxSets: null })
    expect(plan.slots.every((s) => s.elixir === null)).toBe(true)
  })
})

describe('Strongbox sets', () => {
  it('names only sets the config knows', () => {
    const real: ArtifactConfig = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'genshin_artifact_config.json'), 'utf8'))
    expect(STRONGBOX_SETS.filter((s) => !real.sets[s])).toEqual([])
  })
})

describe('Domains file', () => {
  const root = join(import.meta.dirname, '..', '..')
  const real: ArtifactConfig = JSON.parse(readFileSync(join(root, 'genshin_artifact_config.json'), 'utf8'))
  const file: DomainsFile = JSON.parse(readFileSync(join(root, 'genshin_artifact_domains.json'), 'utf8'))
  const dropped = file.domains.flatMap((d) => d.sets)

  it('has a domain for every set in the config, except the ones bosses drop', () => {
    // Gladiator's Finale and Wanderer's Troupe come from bosses, so the Farm tab rightly says "no domain" for them.
    const BOSS_DROPS = ['GladiatorsFinale', 'WanderersTroupe']
    expect(Object.keys(real.sets).filter((s) => !dropped.includes(s) && !BOSS_DROPS.includes(s))).toEqual([])
  })

  it('names only sets the config knows, each in one domain', () => {
    expect(dropped.filter((s) => !real.sets[s])).toEqual([])
    expect(new Set(dropped).size).toBe(dropped.length)
  })
})

describe('a support short of their ER minimum', () => {
  // Like Shenhe: 2pc + 2pc ATK and an ER sands from a third set, wanting ATK% and ER. The spare circlet has CRIT
  // the build doesn't weigh and a little less ER than the worn one, but it's a second Emblem piece: +20% ER.
  const quill: BuildConfig = {
    ...build,
    name: 'Quill',
    sets4: [{ set: 'NoblesseOblige', tier: 1 }],
    sets2: [['atk18', 'atk18']],
    mainStats: { sands: ['enerRech_'], goblet: ['atk_'], circlet: ['atk_'] },
    substats: { atk_: 1, enerRech_: 0.8, atk: 0.5 },
    erTarget: '200%',
  }
  const cat = (twoPieceCategory: string) => ({ twoPiece: '', fourPiece: '', twoPieceCategory })
  const cfgWith = (b: Partial<BuildConfig>): ArtifactConfig => ({
    ...config,
    sets: {
      GladiatorsFinale: cat('atk18'),
      ShimenawasReminiscence: cat('atk18'),
      EmblemOfSeveredFate: cat('er20'),
      NoblesseOblige: cat('burst20'),
    },
    characters: { Shenhe: { element: 'cryo', confidence: 'consensus', enabled: true, builds: [{ ...quill, ...b }] } },
  })
  const gd: GameData = {
    source: 'test',
    fetched: '',
    weapons: { FavoniusLance: { sub: { stat: 'enerRech_', base: 0.3, curve: 'FLAT' } } },
    chars: { Shenhe: { stat: 'atk_', values: [0, 0, 0, 0, 0, 0, 0.288] } },
    curves: { FLAT: Array(101).fill(1) },
    artMain: { '5': { enerRech_: Array.from({ length: 21 }, (_, l) => 0.078 + l * 0.022) } },
  }
  const on = (over: Partial<GoodArtifact>) => art({ location: 'Shenhe', substats: [], ...over })
  const data: GoodExport = {
    format: 'GOOD',
    version: 2,
    characters: [{ key: 'Shenhe', level: 90, constellation: 0, ascension: 6, talent: { auto: 1, skill: 1, burst: 1 } }],
    weapons: [{ key: 'FavoniusLance', level: 90, ascension: 6, refinement: 1, location: 'Shenhe', lock: true }],
    artifacts: [
      on({ slotKey: 'flower', setKey: 'GladiatorsFinale' }),
      on({
        slotKey: 'circlet',
        setKey: 'GladiatorsFinale',
        mainStatKey: 'atk_',
        substats: [{ key: 'critRate_', value: 10.5 }, { key: 'critDMG_', value: 20.2 }, { key: 'def', value: 21 }, { key: 'enerRech_', value: 5.2 }],
      }),
      on({ slotKey: 'plume', setKey: 'ShimenawasReminiscence' }),
      on({ slotKey: 'goblet', setKey: 'ShimenawasReminiscence', mainStatKey: 'atk_' }),
      on({ slotKey: 'sands', setKey: 'EmblemOfSeveredFate', mainStatKey: 'enerRech_' }),
      art({
        slotKey: 'circlet',
        setKey: 'EmblemOfSeveredFate',
        mainStatKey: 'atk_',
        substats: [{ key: 'critRate_', value: 10.9 }, { key: 'hp_', value: 11.7 }, { key: 'def', value: 42 }, { key: 'enerRech_', value: 4.5 }],
      }),
    ],
  }
  const pieces = loadPieces(data)
  const roster: Roster = { Shenhe: { priority: 'priority', disabledBuilds: [] } }
  const run = (b: Partial<BuildConfig> = {}) => {
    const cfg = cfgWith(b)
    const result = evaluate(pieces, data.characters, cfg, defaultSettings(cfg), roster)
    const er = erModel(data, gd, cfg)
    const ref = result.activeBuilds.find((r) => r.char === 'Shenhe')!
    const plan = improveCharacter({ result, pieces, config: cfg, domains, er, ref, guarantee: 2, claimed: new Map(), strongboxSets: null })
    const spare = plan.slots.find((s) => s.slot === 'circlet')!.spares.find((o) => o.piece.setKey === 'EmblemOfSeveredFate')
    return { spare, swaps: planFarming(result, pieces, cfg, domains, 'priority', er).swaps }
  }
  // 100% + 30% weapon + 51.8% sands + 5.2% line = 187%; the spare gives up 0.7% of line for the 20% 2pc, and
  // the 13% that reaches 200% counts at her 0.8 ER weight. Neither circlet has a line she weighs besides ER.
  const erGain = (0.8 * (200 - 187)) / 6.48

  it('lists the spare for the ER it brings, though it breaks a 2pc the build has no pair for', () => {
    const { spare, swaps } = run()
    expect(spare?.er?.from).toBeCloseTo(187)
    expect(spare?.er?.to).toBeCloseTo(206.3)
    expect(spare?.erGain).toBeCloseTo(erGain)
    expect(spare?.gain).toBeCloseTo(erGain)
    expect(spare?.value).toBe(0)
    expect(spare?.fit).toEqual({ kind: 'breaks', set: 'GladiatorsFinale' })
    expect(swaps).toEqual([])
  })

  it('counts ER up to the top of a target range', () => {
    const { spare } = run({ erTarget: '180-200%' })
    expect(spare?.er).toMatchObject({ need: 180, cap: 200 })
    expect(spare?.erGain).toBeCloseTo(erGain)
  })

  it('makes it a free upgrade once the build lists an ATK + ER pair', () => {
    const { spare, swaps } = run({ sets2: [['atk18', 'atk18'], ['atk18', 'er20']] })
    const trade = { lost: [{ set: 'GladiatorsFinale', pieces: 2 }], gained: [{ set: 'EmblemOfSeveredFate', pieces: 2 }] }
    expect(spare?.fit).toEqual({ kind: 'keeps', trade })
    expect(swaps).toHaveLength(1)
    expect(swaps[0]).toMatchObject({ slot: 'circlet', trade })
    expect(swaps[0].erGain).toBeCloseTo(erGain)
  })

  it('ignores the extra ER once the target is met', () => {
    const { spare, swaps } = run({ sets2: [['atk18', 'atk18'], ['atk18', 'er20']], erTarget: '180%' })
    expect(spare).toBeUndefined()
    expect(swaps).toEqual([])
  })
})
