import { describe, expect, it } from 'vitest'
import { setBrief, wanted } from './brief'
import { buildKey, defaultSettings, evaluate, withoutBuilds } from './evaluate'
import { loadPieces } from './load'
import type { ArtifactConfig, BuildConfig, GoodArtifact, GoodCharacter, Roster, Settings } from './types'

const W = { critRate_: 1, critDMG_: 1, atk_: 0.75, atk: 0.3, enerRech_: 0.3, eleMas: 0.2 }

const build = (over: Partial<BuildConfig> = {}): BuildConfig => ({
  name: 'DPS',
  sets4: [
    { set: 'GladiatorsFinale', tier: 1 },
    { set: 'ShimenawasReminiscence', tier: 2 },
    { set: 'CrimsonWitchOfFlames', tier: 3 },
  ],
  sets2: [],
  mainStats: { sands: ['atk_'], goblet: ['pyro_dmg_'], circlet: ['critRate_', 'critDMG_'] },
  substatPreset: 'ATK_CRIT',
  substats: W,
  erTarget: '',
  notes: '',
  ...over,
})

const config = (characters: Record<string, BuildConfig[]>): ArtifactConfig => ({
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
  sets: {
    GladiatorsFinale: { twoPiece: '', fourPiece: '', twoPieceCategory: 'atk18' },
    ShimenawasReminiscence: { twoPiece: '', fourPiece: '', twoPieceCategory: 'atk18' },
    CrimsonWitchOfFlames: { twoPiece: '', fourPiece: '', twoPieceCategory: 'ele15:pyro' },
    EmblemOfSeveredFate: { twoPiece: '', fourPiece: '', twoPieceCategory: 'er20' },
    NoblesseOblige: { twoPiece: '', fourPiece: '', twoPieceCategory: 'burst20' },
  },
  substatPresets: {},
  characters: Object.fromEntries(
    Object.entries(characters).map(([k, builds]) => [k, { element: 'pyro', confidence: 'consensus' as const, enabled: true, builds }]),
  ),
})

const CRIT_LINES = [
  { key: 'critRate_', value: 3.9 },
  { key: 'critDMG_', value: 7.8 },
  { key: 'def', value: 23 },
  { key: 'hp', value: 299 },
]

const art = (over: Partial<GoodArtifact> = {}): GoodArtifact => ({
  setKey: 'GladiatorsFinale',
  slotKey: 'flower',
  level: 0,
  rarity: 5,
  mainStatKey: 'hp',
  location: '',
  lock: false,
  substats: CRIT_LINES,
  totalRolls: 4,
  unactivatedSubstats: [],
  ...over,
})

const char = (key: string): GoodCharacter => ({ key, level: 90, constellation: 0, ascension: 6, talent: { auto: 1, skill: 1, burst: 1 } })

/** Four pieces of `set` worn by `owner`, leaving the goblet free. */
const wornSet = (set: string, owner: string): GoodArtifact[] => [
  art({ setKey: set, location: owner, slotKey: 'flower', mainStatKey: 'hp', level: 20 }),
  art({ setKey: set, location: owner, slotKey: 'plume', mainStatKey: 'atk', level: 20 }),
  art({ setKey: set, location: owner, slotKey: 'sands', mainStatKey: 'atk_', level: 20 }),
  art({ setKey: set, location: owner, slotKey: 'circlet', mainStatKey: 'critDMG_', level: 20 }),
]

/**
 * Diluc runs Gladiator's at tier 1 (and Crimson Witch at a tier that doesn't count), Xiangling lists it at tier 2 but
 * wears Emblem at tier 1, and Yoimiya doesn't list it at all.
 */
const BUILDS: Record<string, BuildConfig[]> = {
  Diluc: [build()],
  Xiangling: [build({ name: 'Sub-DPS', sets4: [{ set: 'EmblemOfSeveredFate', tier: 1 }, { set: 'GladiatorsFinale', tier: 2 }] })],
  Yoimiya: [build({ sets4: [{ set: 'ShimenawasReminiscence', tier: 1 }] })],
}

function setup(artifacts: GoodArtifact[], over: Partial<Settings> = {}, builds = BUILDS) {
  const cfg = config(builds)
  const owned = Object.keys(builds).map(char)
  const settings = { ...defaultSettings(cfg), levelFloor: 0, ...over }
  const pieces = loadPieces({ format: 'GOOD', version: 3, characters: owned, artifacts })
  const result = evaluate(pieces, owned, cfg, settings, {})
  return { cfg, owned, settings, pieces, result }
}

const ARTIFACTS = [
  ...wornSet('EmblemOfSeveredFate', 'Xiangling'),
  // Kept for Diluc alone: a flower can't be anyone's off-set piece under Off-set: Rare.
  art(),
  // A Pyro DMG goblet is rare, so Xiangling and Yoimiya take it off-set too.
  art({ slotKey: 'goblet', mainStatKey: 'pyro_dmg_' }),
  // No one keeps a flower with no useful lines.
  art({ substats: [{ key: 'def', value: 23 }, { key: 'hp', value: 299 }, { key: 'def_', value: 7.3 }, { key: 'hp_', value: 5.8 }] }),
]

describe('withoutBuilds', () => {
  it('matches evaluating with the builds switched off in the Roster', () => {
    const { cfg, owned, settings, pieces, result } = setup(ARTIFACTS)
    for (const off of [['Diluc|0'], ['Xiangling|0', 'Yoimiya|0'], ['Diluc|0', 'Xiangling|0', 'Yoimiya|0']]) {
      const roster: Roster = Object.fromEntries(
        off.map((k) => [k.split('|')[0], { priority: 'normal' as const, disabledBuilds: [Number(k.split('|')[1])] }]),
      )
      expect(withoutBuilds(result, new Set(off), cfg, settings)).toEqual(evaluate(pieces, owned, cfg, settings, roster))
    }
  })

  it('changes the verdict only of pieces kept for the builds switched off', () => {
    const { cfg, settings, result } = setup(ARTIFACTS)
    const flower = result.evaluations[4]
    const goblet = result.evaluations[5]
    expect([flower.grade, goblet.grade]).toEqual(['keep', 'keep'])
    const what = withoutBuilds(result, new Set(['Diluc|0']), cfg, settings)
    // The flower was kept for Diluc alone; the goblet is still kept off-set for the others.
    expect(what.evaluations[4]).toMatchObject({ grade: 'toss', action: null })
    expect(what.evaluations[5].grade).toBe('keep')
    expect(what.evaluations[5].best?.setMatch.kind).toBe('off')
    expect(what.activeBuilds.map(buildKey)).toEqual(['Xiangling|0', 'Yoimiya|0'])
  })

  it('leaves the result it starts from alone', () => {
    const { cfg, settings, result } = setup(ARTIFACTS)
    const before = structuredClone(result)
    withoutBuilds(result, new Set(['Diluc|0']), cfg, settings)
    expect(result).toEqual(before)
  })

  it('returns the same result when no active build is switched off', () => {
    const { cfg, settings, result } = setup(ARTIFACTS)
    expect(withoutBuilds(result, new Set(['Bennett|0']), cfg, settings)).toBe(result)
  })
})

describe('setBrief', () => {
  it("sorts builds into users, those the set layer sidelines, and those keeping a piece off-set", () => {
    const { cfg, settings, pieces, result } = setup(ARTIFACTS)
    const brief = setBrief(result, 'GladiatorsFinale', pieces, cfg, settings)
    const who = (list: typeof brief.users) => list.map((b) => ({ key: buildKey(b.ref), kept: b.kept, only: b.only }))
    expect(who(brief.users)).toEqual([{ key: 'Diluc|0', kept: 2, only: 1 }])
    expect(brief.users[0].match).toEqual({ kind: '4pc', tier: 1 })
    expect(who(brief.sidelined)).toEqual([{ key: 'Xiangling|0', kept: 1, only: 0 }])
    expect(brief.sidelined[0].sidelined).toEqual({ issue: 'worn', tier: 2, worn: { set: 'EmblemOfSeveredFate', tier: 1 } })
    expect(who(brief.offSet)).toEqual([{ key: 'Yoimiya|0', kept: 1, only: 0 }])
  })

  it('sidelines a tier that Set matching leaves out, and counts it once every tier does', () => {
    const { cfg, settings, pieces, result } = setup(ARTIFACTS)
    const brief = setBrief(result, 'CrimsonWitchOfFlames', pieces, cfg, settings)
    expect(brief.users).toEqual([])
    expect(brief.sidelined.map((b) => [buildKey(b.ref), b.sidelined])).toEqual([['Diluc|0', { issue: 'tier', tier: 3 }]])
    const all = setup(ARTIFACTS, { setMatch: '4pc-all' })
    expect(setBrief(all.result, 'CrimsonWitchOfFlames', all.pieces, all.cfg, all.settings).users.map((b) => buildKey(b.ref))).toEqual([
      'Diluc|0',
    ])
  })

  it("counts a build for the set it wears, and a 2pc pair's sets under the config rule", () => {
    const { cfg, settings, pieces, result } = setup(ARTIFACTS, { setMatch: 'config' }, {
      ...BUILDS,
      Bennett: [build({ sets4: [{ set: 'NoblesseOblige', tier: 1 }], sets2: [['atk18', 'atk18']] })],
    })
    const emblem = setBrief(result, 'EmblemOfSeveredFate', pieces, cfg, settings)
    expect(emblem.users.map((b) => buildKey(b.ref))).toEqual(['Xiangling|0'])
    const glad = setBrief(result, 'GladiatorsFinale', pieces, cfg, settings)
    expect(glad.users.map((b) => [buildKey(b.ref), b.match])).toEqual([
      ['Diluc|0', { kind: '4pc', tier: 1 }],
      ['Bennett|0', { kind: '2pc', category: 'atk18' }],
    ])
  })
})

describe('wanted', () => {
  const { result } = setup([], {}, {
    Diluc: [build()],
    Bennett: [
      build({
        name: 'Support',
        mainStats: { sands: ['enerRech_', 'hp_'], goblet: ['hp_'], circlet: ['heal_', 'hp_'] },
        substats: { enerRech_: 1, hp_: 0.8, critRate_: 0.3, hp: 0.2 },
      }),
    ],
    Yoimiya: [build({ avoidMainStats: { circlet: ['critDMG_'] } })],
  })
  const names = (refs: { char: string }[]) => refs.map((r) => r.char)
  const w = wanted(result.activeBuilds)

  it("lists each slot's main stats, most builds first, avoided ones left out", () => {
    expect(w.mains.sands.map((m) => [m.stat, names(m.refs)])).toEqual([
      ['atk_', ['Diluc', 'Yoimiya']],
      ['hp_', ['Bennett']],
      ['enerRech_', ['Bennett']],
    ])
    expect(w.mains.circlet.map((m) => [m.stat, m.refs.length])).toEqual([
      ['critRate_', 2],
      ['hp_', 1],
      ['critDMG_', 1],
      ['heal_', 1],
    ])
  })

  it('splits substats into key lines, by how many builds need them, and minor ones', () => {
    expect(w.subs.map((s) => [s.stat, names(s.refs)])).toEqual([
      ['critRate_', ['Diluc', 'Yoimiya']],
      ['critDMG_', ['Diluc', 'Yoimiya']],
      ['atk_', ['Diluc', 'Yoimiya']],
      ['enerRech_', ['Bennett']],
      ['hp_', ['Bennett']],
    ])
    // Crit Rate is minor for Bennett, but still listed with his weight.
    expect(w.subs[0].weights.map((x) => [x.ref.char, x.weight])).toEqual([
      ['Diluc', 1],
      ['Yoimiya', 1],
      ['Bennett', 0.3],
    ])
    expect(w.minor.map((s) => s.stat)).toEqual(['atk', 'eleMas', 'hp'])
  })
})
