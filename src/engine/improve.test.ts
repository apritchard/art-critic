import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultSettings, evaluate } from './evaluate'
import { STRONGBOX_SETS, type DomainsFile } from './farm'
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
