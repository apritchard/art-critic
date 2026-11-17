import { describe, expect, it } from 'vitest'
import { evaluate, defaultSettings } from './evaluate'
import { addEquip, applyEquips, fingerprint, loadPieces, parseExport, resolveLocation } from './load'
import { describeSetMatch, mainStatOk, matchSet } from './match'
import {
  chanceToBeat,
  currentValue,
  expectedFinal,
  gainDistribution,
  isCritCirclet,
  lineCeiling,
  lineScore,
  remainingRolls,
  rescoreBar,
  startLines,
  thresholdScale,
} from './projection'
import { formatStat } from './stats'
import type { ArtifactConfig, BuildConfig, GoodArtifact, GoodExport } from './types'

const W = { critRate_: 1, critDMG_: 1, atk_: 0.75, atk: 0.3, enerRech_: 0.3, eleMas: 0.2 }

const build = (over: Partial<BuildConfig> = {}): BuildConfig => ({
  name: 'DPS',
  sets4: [
    { set: 'GladiatorsFinale', tier: 1 },
    { set: 'ShimenawasReminiscence', tier: 2 },
    { set: 'CrimsonWitchOfFlames', tier: 3 },
  ],
  sets2: [['atk18', 'ele15:pyro']],
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
    ScarletProof: { twoPiece: '', fourPiece: '', twoPieceCategory: 'atk18' },
    MaidenBeloved: { twoPiece: '', fourPiece: '', twoPieceCategory: 'heal15' },
  },
  substatPresets: {},
  characters: Object.fromEntries(
    Object.entries(characters).map(([k, builds]) => [
      k,
      { element: 'pyro', confidence: 'consensus' as const, enabled: true, builds },
    ]),
  ),
})

const art = (over: Partial<GoodArtifact> = {}): GoodArtifact => ({
  setKey: 'GladiatorsFinale',
  slotKey: 'flower',
  level: 0,
  rarity: 5,
  mainStatKey: 'hp',
  location: '',
  lock: true,
  substats: [
    { key: 'critRate_', value: 3.9 },
    { key: 'critDMG_', value: 7.8 },
    { key: 'def', value: 23 },
    { key: 'hp', value: 299 },
  ],
  totalRolls: 4,
  unactivatedSubstats: [],
  ...over,
})

const threeLiner = (over: Partial<GoodArtifact> = {}) =>
  art({
    substats: [
      { key: 'critRate_', value: 3.9 },
      { key: 'def', value: 23 },
      { key: 'hp', value: 299 },
    ],
    unactivatedSubstats: [{ key: 'critDMG_', value: 7.8 }],
    totalRolls: 3,
    ...over,
  })

describe('set matching', () => {
  const cfg = config({})
  it('honours 4pc tiers per mode', () => {
    expect(matchSet(build(), 'GladiatorsFinale', cfg, '4pc-t12')).toEqual({ kind: '4pc', tier: 1 })
    expect(matchSet(build(), 'CrimsonWitchOfFlames', cfg, '4pc-t12')).toBeNull()
    expect(matchSet(build(), 'CrimsonWitchOfFlames', cfg, '4pc-all')).toEqual({ kind: '4pc', tier: 3 })
    // A set kept for 2pc pairs only still counts at its tier, and says so.
    const pairOnly = build({ sets4: [{ set: 'GladiatorsFinale', tier: 1, twoPieceOnly: true }] })
    const m = matchSet(pairOnly, 'GladiatorsFinale', cfg, '4pc-t12')
    expect(m).toEqual({ kind: '4pc', tier: 1, twoPieceOnly: true })
    expect(describeSetMatch(m!)).toBe('tier 1, for its 2pc')
  })
  it('uses 2pc categories and "any" only in config mode', () => {
    expect(matchSet(build(), 'ScarletProof', cfg, '4pc-all')).toBeNull()
    expect(matchSet(build(), 'ScarletProof', cfg, 'config')).toEqual({ kind: '2pc', category: 'atk18' })
    expect(matchSet(build(), 'MaidenBeloved', cfg, 'config')).toBeNull()
    expect(matchSet(build({ sets2: [['any', 'any']] }), 'MaidenBeloved', cfg, 'config')).toEqual({
      kind: '2pc',
      category: 'any',
    })
  })
})

describe('main stats', () => {
  it('always accepts flower and plume', () => {
    expect(mainStatOk(build(), { slotKey: 'flower', mainStatKey: 'hp' })).toBe(true)
    expect(mainStatOk(build(), { slotKey: 'plume', mainStatKey: 'atk' })).toBe(true)
  })
  it('checks the slot list, "*" and avoidMainStats', () => {
    expect(mainStatOk(build(), { slotKey: 'sands', mainStatKey: 'atk_' })).toBe(true)
    expect(mainStatOk(build(), { slotKey: 'sands', mainStatKey: 'hp_' })).toBe(false)
    const anyGoblet = build({ mainStats: { goblet: ['*'] }, avoidMainStats: { goblet: ['hydro_dmg_'] } })
    expect(mainStatOk(anyGoblet, { slotKey: 'goblet', mainStatKey: 'eleMas' })).toBe(true)
    expect(mainStatOk(anyGoblet, { slotKey: 'goblet', mainStatKey: 'hydro_dmg_' })).toBe(false)
  })
})

describe('roll accounting', () => {
  it('counts remaining rolls for 3- and 4-liners', () => {
    expect(remainingRolls(threeLiner())).toBe(4)
    expect(remainingRolls(art())).toBe(5)
    expect(remainingRolls(art({ level: 4 }))).toBe(4)
    expect(remainingRolls(art({ level: 8, totalRolls: 6 }))).toBe(3)
    expect(remainingRolls(art({ level: 20, totalRolls: 9 }))).toBe(0)
    // A 3-liner at +4 has revealed its 4th line and has four rolls left (+8..+20).
    expect(remainingRolls(art({ level: 4, totalRolls: 4 }))).toBe(4)
  })
  it('detects starting lines', () => {
    expect(startLines(threeLiner())).toBe(3)
    expect(startLines(art())).toBe(4)
    expect(startLines(art({ level: 8, totalRolls: 5 }))).toBe(3)
    expect(startLines(art({ level: 8, totalRolls: 6 }))).toBe(4)
  })
  it('scores the hidden 4th line of a 3-liner', () => {
    expect(lineScore(threeLiner(), W)).toBe(2)
    expect(currentValue(threeLiner(), W)).toBeCloseTo(3.9 / 3.89 + 7.8 / 7.77, 5)
  })
})

describe('projection', () => {
  it('produces a distribution that sums to 1 with the closed-form mean', () => {
    const lineW = [1, 1, 0.75, 0]
    const dist = gainDistribution(lineW, 5)
    const total = dist.reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(1, 9)
    const mean = dist.reduce((a, p, i) => a + p * i * 0.05, 0)
    expect(mean).toBeCloseTo(5 * (2.75 / 4) * 0.85, 1)
  })
  it('chance to beat falls as the bar rises', () => {
    const a = art()
    const bars = [0, 2, 4, 6, 8, 10]
    const chances = bars.map((b) => chanceToBeat(a, W, b))
    for (let i = 1; i < chances.length; i++) expect(chances[i]).toBeLessThanOrEqual(chances[i - 1])
    expect(chanceToBeat(a, W, null)).toBe(1)
    expect(chanceToBeat(a, W, 100)).toBe(0)
  })
  it('expected final matches current + rolls × mean weight × 0.85', () => {
    const a = art()
    expect(expectedFinal(a, W)).toBeCloseTo(currentValue(a, W) + 5 * (2 / 4) * 0.85, 9)
  })
  it('rescore bar equals a fresh piece at threshold rolling average', () => {
    expect(rescoreBar(1.75, 4)).toBeCloseTo(1.75 * 0.85 * 2.25, 9)
    expect(rescoreBar(1.5, 3)).toBeCloseTo(1.5 * 0.85 * 2, 9)
  })
  it('recognises crit circlets', () => {
    expect(isCritCirclet(art({ slotKey: 'circlet', mainStatKey: 'critRate_' }))).toBe(true)
    expect(isCritCirclet(art({ slotKey: 'circlet', mainStatKey: 'atk_' }))).toBe(false)
  })
})

describe('load', () => {
  it('maps the plain "Traveler" location to the owned Traveler key', () => {
    expect(resolveLocation('Traveler', ['Bennett', 'TravelerCryo'])).toBe('TravelerCryo')
    expect(resolveLocation('Bennett', ['Bennett'])).toBe('Bennett')
    expect(resolveLocation('', ['Bennett'])).toBeNull()
  })
  it('disambiguates exact duplicates', () => {
    const data = { format: 'GOOD', version: 3, characters: [], artifacts: [art(), art(), art({ level: 4 })] }
    const ids = loadPieces(data).map((p) => p.id)
    expect(new Set(ids).size).toBe(3)
    expect(ids[0]).toBe(fingerprint(art()))
    expect(ids[1]).toBe(`${fingerprint(art())}#1`)
  })

  describe('equips since the export', () => {
    const chars = ['Diluc', 'Bennett'].map((key) => ({ key, level: 90, constellation: 0, ascension: 6, talent: { auto: 1, skill: 1, burst: 1 } }))
    const pieces = loadPieces({
      format: 'GOOD',
      version: 3,
      characters: chars,
      artifacts: [
        art({ location: 'Diluc' }),
        art({ location: 'Bennett', level: 16 }),
        art({ level: 20 }), // a spare flower
      ],
    })
    const [dilucs, bennetts, spare] = pieces
    const owners = (ps: typeof pieces) => ps.map((p) => p.owner)

    it('puts a spare on and unequips what it replaces', () => {
      expect(owners(applyEquips(pieces, [{ piece: spare.id, char: 'Diluc' }]))).toEqual([null, 'Bennett', 'Diluc'])
    })

    it("swaps with whoever wore it, as the game does", () => {
      expect(owners(applyEquips(pieces, [{ piece: bennetts.id, char: 'Diluc' }]))).toEqual(['Bennett', 'Diluc', null])
    })

    it('applies equips in order and leaves the export untouched', () => {
      const after = applyEquips(pieces, [
        { piece: spare.id, char: 'Diluc' },
        { piece: dilucs.id, char: 'Bennett' },
      ])
      expect(owners(after)).toEqual(['Bennett', null, 'Diluc'])
      expect(owners(pieces)).toEqual(['Diluc', 'Bennett', null])
      expect(applyEquips(pieces, [{ piece: 'gone', char: 'Diluc' }])).toEqual(pieces)
    })

    it('keeps the earlier move when a piece moves again, so the second move swaps', () => {
      // The spare goes on Diluc, then on to Bennett: Diluc gets Bennett's flower, as in-game.
      let list = addEquip([], pieces, spare.id, 'Diluc')
      list = addEquip(list, applyEquips(pieces, list), spare.id, 'Bennett')
      expect(list).toHaveLength(2)
      expect(owners(applyEquips(pieces, list))).toEqual([null, 'Diluc', 'Bennett'])
      // Equipping a piece where it already is records nothing.
      expect(addEquip(list, applyEquips(pieces, list), spare.id, 'Bennett')).toBe(list)
    })
  })

  it('fills in the sections a GOOD export leaves out, and rejects other files', () => {
    const data = parseExport({ format: 'GOOD', version: 2 }, 'x.json')
    expect(data.characters).toEqual([])
    expect(loadPieces(data)).toEqual([])
    expect(() => parseExport({ hello: 1 }, 'x.json')).toThrow("x.json isn't a GOOD export")
    expect(() => parseExport(null, 'x.json')).toThrow("isn't a GOOD export")
  })

  it('ignores empty padding lines in substats', () => {
    const padded = threeLiner({ substats: [...threeLiner().substats, { key: '', value: 0 }] })
    const [p] = loadPieces({ format: 'GOOD', version: 2, characters: [], artifacts: [padded] })
    expect(p.substats).toHaveLength(3)
    expect(p.id).toBe(fingerprint(threeLiner()))
    expect(startLines(p)).toBe(3)
    expect(remainingRolls(p)).toBe(4)
  })
})

describe('formatStat', () => {
  it('matches in-game style', () => {
    expect(formatStat('critRate_', 3.9)).toBe('CRIT Rate+3.9%')
    expect(formatStat('atk_', 5.3)).toBe('ATK+5.3%')
    expect(formatStat('atk', 19)).toBe('ATK+19')
    expect(formatStat('eleMas', 23)).toBe('Elemental Mastery+23')
  })
})

describe('evaluate', () => {
  const owned = [{ key: 'Diluc', level: 90, constellation: 0, ascension: 6, talent: { auto: 1, skill: 1, burst: 1 } }]
  const cfg = config({ Diluc: [build()] })
  const settings = { ...defaultSettings(cfg), capNormal: 2 }
  const run = (artifacts: GoodArtifact[], over = {}) => {
    const data: GoodExport = { format: 'GOOD', version: 3, characters: owned, artifacts }
    return evaluate(loadPieces(data), owned, cfg, { ...settings, ...over }, {})
  }

  it('counts unowned characters as Normal while planning for them', () => {
    const both = config({ Diluc: [build()], Klee: [build()] })
    const off = evaluate([], owned, both, defaultSettings(both), {})
    expect(off.characters.map((c) => c.char)).toEqual(['Diluc'])
    const on = evaluate([], owned, both, { ...defaultSettings(both), includeUnowned: true }, {})
    expect(on.characters.find((c) => c.char === 'Klee')?.active).toBe(true)
    expect(on.activeBuilds.some((r) => r.char === 'Klee')).toBe(true)
  })

  it('keeps a good +0 and trashes a weak one', () => {
    const weak = art({
      substats: [
        { key: 'def', value: 23 },
        { key: 'hp', value: 299 },
        { key: 'def_', value: 7.3 },
        { key: 'eleMas', value: 23 },
      ],
    })
    const [good, bad] = run([art(), weak]).evaluations
    expect(good.verdict).toBe('level')
    expect(good.action).toBeNull()
    expect(bad.verdict).toBe('trash')
    expect(bad.action).toBe('unlock')
    expect(bad.reason).toMatch(/Subs too weak/)
  })

  it('applies the cap to pieces still to level', () => {
    const grades = run([art(), art({ lock: false }), art()]).evaluations.map((e) => e.grade)
    expect(grades.filter((g) => g === 'keep')).toHaveLength(2)
    const cut = run([art(), art({ lock: false }), art()]).evaluations.find((e) => e.grade === 'marginal')!
    expect(cut.reason).toBe('Redundant: #3 of the flowers for Diluc, and only the top 2 are kept (Settings → Keep cap)')
  })

  it('takes finished spares out of the cap, and measures pieces still to level against the best of them', () => {
    const spare = art({
      level: 20,
      totalRolls: 9,
      substats: [
        { key: 'critRate_', value: 10.5 },
        { key: 'critDMG_', value: 18.7 },
        { key: 'atk_', value: 5.8 },
        { key: 'hp', value: 299 },
      ],
    })
    // A little below the spare on average, but with every roll still to come it can end up past it.
    const close = art({
      substats: [
        { key: 'critRate_', value: 3.9 },
        { key: 'critDMG_', value: 7.8 },
        { key: 'atk_', value: 5.8 },
        { key: 'def', value: 23 },
      ],
    })
    const [kept, contender, weak] = run([spare, close, art()], { capNormal: 1 }).evaluations
    // The spare beats what Diluc wears (nothing), so it's kept, without taking the slot's one place.
    expect(kept.verdict).toBe('spare')
    expect(kept.best?.rank).toBeUndefined()
    // So the one place goes to the piece that could still beat the spare.
    expect(contender.best!.expected).toBeLessThan(kept.best!.expected)
    expect(contender.best?.spare).toBe(kept.piece.id)
    expect(contender.best!.chance).toBeGreaterThan(0.2)
    expect(contender.grade).toBe('keep')
    // A weak piece is measured against the spare, not against an empty slot.
    expect(weak.grade).toBe('toss')
    expect(weak.reason).toMatch(/chance to beat Diluc's best spare, a \+20 Gladiator's Finale flower, which already beats what they wear$/)
  })

  it("measures pieces on the worn set only against spares the character could put on without breaking it", () => {
    const lines = [
      { key: 'critRate_', value: 3.9 },
      { key: 'critDMG_', value: 7.8 },
      { key: 'atk_', value: 5.8 },
      { key: 'def', value: 23 },
    ]
    // Diluc wears four Gladiator's Finale pieces, and a circlet of `circletSet`.
    const worn = (circletSet: string) => [
      art({ location: 'Diluc', level: 20 }),
      art({ location: 'Diluc', level: 20, slotKey: 'plume', mainStatKey: 'atk' }),
      art({ location: 'Diluc', level: 20, slotKey: 'sands', mainStatKey: 'atk_' }),
      art({ location: 'Diluc', level: 20, slotKey: 'goblet', mainStatKey: 'pyro_dmg_' }),
      art({ location: 'Diluc', level: 20, slotKey: 'circlet', mainStatKey: 'critDMG_', setKey: circletSet }),
    ]
    // A finished Scarlet Proof flower that beats the one he wears.
    const spare = art({
      setKey: 'ScarletProof',
      level: 20,
      totalRolls: 9,
      substats: [
        { key: 'critRate_', value: 10.5 },
        { key: 'critDMG_', value: 18.7 },
        { key: 'atk_', value: 5.8 },
        { key: 'hp', value: 299 },
      ],
    })
    const judged = (circletSet: string) => {
      const artifacts = [...worn(circletSet), spare, art({ substats: lines }), art({ setKey: 'ScarletProof', substats: lines })]
      return run(artifacts, { offSet: 'any' }).evaluations.slice(-3)
    }

    // His off-set piece is the circlet, so wearing the spare would cost him the 4pc.
    const [kept, onSet, offSet] = judged('ScarletProof')
    expect(kept.verdict).toBe('spare')
    // A Gladiator's Finale flower only has to beat the one he wears.
    expect(onSet.best?.setMatch.kind).toBe('4pc')
    expect(onSet.best?.spare).toBeUndefined()
    expect(onSet.reason).toMatch(/to beat current/)
    // An off-set flower is judged as if the off-set slot moved to the flower, where the spare competes with it.
    expect(offSet.best?.setMatch.kind).toBe('off')
    expect(offSet.best?.spare).toBe(kept.piece.id)

    // Wearing all five, he could put the spare on and keep the 4pc, so it raises the bar.
    const [, full] = judged('GladiatorsFinale')
    expect(full.best?.spare).toBe(kept.piece.id)
  })

  it('names the build in a reason when the character has more than one', () => {
    const two = config({ Diluc: [build(), build({ name: 'Vape (EM hybrid)' })] })
    const data: GoodExport = { format: 'GOOD', version: 3, characters: owned, artifacts: [art(), art({ lock: false }), art()] }
    const cut = evaluate(loadPieces(data), owned, two, { ...defaultSettings(two), capNormal: 2 }, {}).evaluations.find((e) => e.grade === 'marginal')!
    // The bracket is left out: the rest of the name tells the builds apart.
    expect(cut.reason).toMatch(/^Redundant: #3 of the flowers for Diluc's (DPS|Vape) build, and only the top 2 are kept/)
  })

  it('drops pieces that cannot beat the equipped one', () => {
    const worn = art({
      level: 20,
      totalRolls: 9,
      location: 'Diluc',
      substats: [
        { key: 'critRate_', value: 14 },
        { key: 'critDMG_', value: 28 },
        { key: 'atk_', value: 10 },
        { key: 'atk', value: 19 },
      ],
    })
    const evs = run([worn, art()]).evaluations
    expect(evs[0].verdict).toBe('equipped')
    expect(evs[1].grade).toBe('toss')
    expect(evs[1].reason).toMatch(/chance to beat Diluc/)
  })

  it('keeps decent +20s as locked backups and feeds only what fails the gate', () => {
    const worn = art({
      level: 20,
      totalRolls: 9,
      location: 'Diluc',
      substats: [
        { key: 'critRate_', value: 14 },
        { key: 'critDMG_', value: 28 },
        { key: 'atk_', value: 10 },
        { key: 'atk', value: 19 },
      ],
    })
    const decent = art({
      level: 20,
      totalRolls: 9,
      substats: [
        { key: 'critRate_', value: 10.5 },
        { key: 'critDMG_', value: 14 },
        { key: 'def', value: 23 },
        { key: 'hp', value: 299 },
      ],
    })
    const junk = art({
      level: 20,
      totalRolls: 9,
      substats: [
        { key: 'def', value: 60 },
        { key: 'hp', value: 900 },
        { key: 'def_', value: 20 },
        { key: 'critRate_', value: 3.1 },
      ],
    })
    const [, backup, fodder] = run([worn, decent, junk]).evaluations
    expect(backup.grade).toBe('marginal')
    expect(backup.recommendLock).toBe(true)
    expect(backup.reason).toMatch(/^Backup/)
    expect(fodder.verdict).toBe('feed')
    expect(fodder.action).toBe('unlock')
  })

  it('stops a borderline piece whose early rolls missed', () => {
    const borderline = art({
      level: 8,
      totalRolls: 6,
      substats: [
        { key: 'critRate_', value: 3.9 },
        { key: 'atk_', value: 5.8 },
        { key: 'def', value: 23 + 23 + 23 },
        { key: 'hp', value: 299 },
      ],
    })
    const ev = run([borderline]).evaluations[0]
    expect(ev.verdict).toBe('stop')
    expect(ev.reason).toMatch(/Rolls fell short/)
  })

  it('needs two lines the build uses at +0, however low scaling takes the bar', () => {
    // An EM support's EM goblet: the main stat blocks its best weight, so the 3-line bar scales to about 0.57.
    const support = build({
      mainStats: { goblet: ['eleMas'] },
      substats: { eleMas: 1, enerRech_: 0.6, critRate_: 0.3, critDMG_: 0.15, atk_: 0.1 },
    })
    const cfgEM = config({ Diluc: [support] })
    const goblet = (lines: GoodArtifact['substats']) =>
      art({ slotKey: 'goblet', mainStatKey: 'eleMas', substats: lines, unactivatedSubstats: [{ key: 'atk', value: 14 }], totalRolls: 3 })
    const judge = (piece: GoodArtifact, requireTwoLines = true) => {
      const data: GoodExport = { format: 'GOOD', version: 3, characters: owned, artifacts: [piece] }
      return evaluate(loadPieces(data), owned, cfgEM, { ...defaultSettings(cfgEM), requireTwoLines }, {}).evaluations[0]
    }
    // Only ER counts: 0.60 clears the scaled bar, but one line isn't enough.
    const erOnly = goblet([
      { key: 'def_', value: 6.6 },
      { key: 'enerRech_', value: 4.5 },
      { key: 'hp', value: 299 },
    ])
    const thin = judge(erOnly)
    expect(thin.best!.lineScore).toBeGreaterThanOrEqual(thin.best!.threshold)
    expect(thin.verdict).toBe('trash')
    expect(thin.reason).toBe('Too few useful lines: only ER is a stat Diluc uses (needs 2)')
    expect(judge(erOnly, false).verdict).toBe('level')
    // ER and CRIT Rate: two lines, so it passes.
    expect(judge(goblet([{ key: 'def_', value: 6.6 }, { key: 'enerRech_', value: 4.5 }, { key: 'critRate_', value: 3.1 }])).verdict).toBe('level')
  })

  it('lets crit circlets bypass the substat gate', () => {
    const circlet = art({
      slotKey: 'circlet',
      mainStatKey: 'critRate_',
      substats: [
        { key: 'critDMG_', value: 5.4 },
        { key: 'def', value: 16 },
        { key: 'hp', value: 209 },
        { key: 'def_', value: 5.1 },
      ],
    })
    expect(run([circlet]).evaluations[0].verdict).toBe('level')
    expect(run([circlet], { critCircletRule: false }).evaluations[0].verdict).toBe('trash')
  })

  describe('off-set pieces', () => {
    // Pyro goblet and CRIT circlet from a set Diluc doesn't use.
    const goblet = art({ setKey: 'ScarletProof', slotKey: 'goblet', mainStatKey: 'pyro_dmg_' })
    const circlet = art({
      setKey: 'ScarletProof',
      slotKey: 'circlet',
      mainStatKey: 'critRate_',
      substats: [
        { key: 'critDMG_', value: 7.8 },
        { key: 'atk_', value: 5.8 },
        { key: 'def', value: 23 },
        { key: 'hp', value: 299 },
      ],
    })

    it('keeps a rare main stat from any set as the off-set piece', () => {
      const [ev] = run([goblet]).evaluations
      expect(ev.verdict).toBe('level')
      expect(ev.best?.setMatch).toEqual({ kind: 'off' })
      expect(ev.reason).toMatch(/off-set/)
    })

    it('ignores common main stats unless set to any slot', () => {
      const atkGoblet = { ...goblet, mainStatKey: 'atk_' }
      const cfgAtk = config({ Diluc: [build({ mainStats: { ...build().mainStats, goblet: ['atk_', 'pyro_dmg_'] } })] })
      const data: GoodExport = { format: 'GOOD', version: 3, characters: owned, artifacts: [atkGoblet] }
      const judge = (offSet: 'rare' | 'any') =>
        evaluate(loadPieces(data), owned, cfgAtk, { ...settings, offSet }, {}).evaluations[0]
      expect(judge('rare').verdict).toBe('trash')
      expect(judge('any').verdict).toBe('level')
    })

    it('says what a piece it leaves out would do as an off-set piece, without keeping it', () => {
      const atkGoblet = { ...goblet, mainStatKey: 'atk_' }
      const cfgAtk = config({ Diluc: [build({ mainStats: { ...build().mainStats, goblet: ['atk_', 'pyro_dmg_'] } })] })
      const reasonFor = (artifacts: GoodArtifact[]) => {
        const data: GoodExport = { format: 'GOOD', version: 3, characters: owned, artifacts }
        const evs = evaluate(loadPieces(data), owned, cfgAtk, settings, {}).evaluations
        return evs[0]
      }
      // Diluc wears nothing in the goblet slot, so the goblet's whole projected value is the gain.
      const alone = reasonFor([atkGoblet])
      expect(alone.verdict).toBe('trash')
      expect(alone.reason).toMatch(/No active character uses 4pc Scarlet Proof · as an off-set goblet: \+[\d.]+ for Diluc \(nothing usable → [\d.]+\), more than any other spare would/)
      // A stronger spare in the same slot outranks it.
      const better = art({
        setKey: 'ScarletProof',
        slotKey: 'goblet',
        mainStatKey: 'atk_',
        substats: [
          { key: 'critRate_', value: 3.9 },
          { key: 'critDMG_', value: 7.8 },
          { key: 'atk', value: 19 },
          { key: 'hp', value: 299 },
        ],
      })
      expect(reasonFor([atkGoblet, better]).reason).toMatch(/but 1 other spare would gain Diluc more/)
      // Nobody can use the main stat at all: nothing to add.
      expect(reasonFor([{ ...goblet, mainStatKey: 'def_' }]).reason).toBe('No active character uses 4pc Scarlet Proof')
    })

    it('keeps only the best off-set candidates per build and slot', () => {
      // A goblet and a circlet don't compete: each is the best off-set candidate in its slot.
      expect(run([goblet, circlet]).evaluations.every((e) => e.grade === 'keep')).toBe(true)
      // Two goblets do, by gain over what's worn: only the better one is kept.
      const betterGoblet = {
        ...goblet,
        substats: [
          { key: 'critRate_', value: 3.9 },
          { key: 'critDMG_', value: 7.8 },
          { key: 'atk_', value: 5.8 },
          { key: 'hp', value: 299 },
        ],
      }
      const [cut, kept] = run([goblet, betterGoblet]).evaluations
      expect(kept.grade).toBe('keep')
      expect(cut.grade).toBe('marginal')
      expect(cut.reason).toBe('Redundant: #2 of the off-set goblets for Diluc, and only the best one is kept (Settings → Off-set pieces)')
      expect(run([goblet, betterGoblet], { capOffSet: 2 }).evaluations.every((e) => e.grade === 'keep')).toBe(true)
    })

    it('can be turned off', () => {
      const [ev] = run([goblet], { offSet: 'off' }).evaluations
      expect(ev.verdict).toBe('trash')
      expect(ev.reason).toMatch(/No active character uses 4pc Scarlet Proof/)
    })
  })

  describe('set commitment', () => {
    // Diluc wears four pieces of a set with weak +20 subs, plus nothing in the circlet slot.
    const wearing = (setKey: string) =>
      (['flower', 'plume', 'sands', 'goblet'] as const).map((slotKey) =>
        art({
          setKey,
          slotKey,
          mainStatKey: { flower: 'hp', plume: 'atk', sands: 'atk_', goblet: 'pyro_dmg_' }[slotKey],
          level: 20,
          totalRolls: 9,
          location: 'Diluc',
        }),
      )
    const flower = (setKey: string) => art({ setKey })

    it('skips sets ranked no higher than the one worn', () => {
      // Wears tier-1 Gladiator; a tier-2 Shimenawa flower can't be used without breaking it.
      const evs = run([...wearing('GladiatorsFinale'), flower('ShimenawasReminiscence')]).evaluations
      expect(evs[4].verdict).toBe('trash')
      expect(evs[4].reason).toMatch(/already wear a set they rank as high or higher/)
      const loose = run([...wearing('GladiatorsFinale'), flower('ShimenawasReminiscence')], { commitToWornSet: false })
      expect(loose.evaluations[4].verdict).toBe('level')
    })

    it("isn't committed by the 4pc of a set it keeps for 2pc pairs only", () => {
      const sets4 = build().sets4.map((s) => (s.set === 'GladiatorsFinale' ? { ...s, twoPieceOnly: true } : s))
      const pairs = config({ Diluc: [build({ sets4 })] })
      const data: GoodExport = {
        format: 'GOOD',
        version: 3,
        characters: owned,
        artifacts: [...wearing('GladiatorsFinale'), flower('ShimenawasReminiscence')],
      }
      const evs = evaluate(loadPieces(data), owned, pairs, { ...defaultSettings(pairs), capNormal: 2 }, {}).evaluations
      expect(evs[4].verdict).toBe('level')
    })

    it('still counts the worn set and better-ranked sets', () => {
      const same = run([...wearing('GladiatorsFinale'), flower('GladiatorsFinale')]).evaluations
      expect(same[4].verdict).toBe('level')
      // Wears tier-2 Shimenawa; tier-1 Gladiator is worth building toward.
      const better = run([...wearing('ShimenawasReminiscence'), flower('GladiatorsFinale')]).evaluations
      expect(better[4].verdict).toBe('level')
    })

    it('leaves rare main stats to the off-set lane', () => {
      const circlet = art({
        setKey: 'ShimenawasReminiscence',
        slotKey: 'circlet',
        mainStatKey: 'critRate_',
        substats: [
          { key: 'critDMG_', value: 7.8 },
          { key: 'atk_', value: 5.8 },
          { key: 'def', value: 23 },
          { key: 'hp', value: 299 },
        ],
      })
      const [ev] = run([...wearing('GladiatorsFinale'), circlet]).evaluations.slice(4)
      expect(ev.verdict).toBe('level')
      expect(ev.best?.setMatch).toEqual({ kind: 'off' })
    })
  })

  it('ignores characters set to ignore', () => {
    const data: GoodExport = { format: 'GOOD', version: 3, characters: owned, artifacts: [art()] }
    const res = evaluate(loadPieces(data), owned, cfg, settings, {
      Diluc: { priority: 'ignore', disabledBuilds: [] },
    })
    expect(res.evaluations[0].verdict).toBe('trash')
    expect(res.evaluations[0].reason).toMatch(/No active character/)
  })

  describe('main stat that blocks a top line', () => {
    // Nilou's weights: HP% is the only big line, and an HP% sands can't roll it.
    const HP = { hp_: 1, hp: 0.4, enerRech_: 0.4, eleMas: 0.3 }
    const hpCfg = config({ Diluc: [build({ mainStats: { sands: ['hp_'] }, substats: HP })] })
    const hpRun = (artifacts: GoodArtifact[], over = {}) => {
      const data: GoodExport = { format: 'GOOD', version: 3, characters: owned, artifacts }
      return evaluate(loadPieces(data), owned, hpCfg, { ...defaultSettings(hpCfg), ...over }, {})
    }
    const sands = (over: Partial<GoodArtifact> = {}) =>
      art({
        slotKey: 'sands',
        mainStatKey: 'hp_',
        substats: [
          { key: 'hp', value: 299 },
          { key: 'enerRech_', value: 6.5 },
          { key: 'eleMas', value: 23 },
          { key: 'def', value: 23 },
        ],
        ...over,
      })

    const both = { scaleForMainStat: true, scaleLowBuilds: true }
    const mainOnly = { scaleForMainStat: true, scaleLowBuilds: false }
    const neither = { scaleForMainStat: false, scaleLowBuilds: false }

    it('measures the best lines the main stat leaves possible', () => {
      expect(lineCeiling(HP)).toBeCloseTo(2.1)
      expect(lineCeiling(HP, 'hp_')).toBeCloseTo(1.1)
      expect(thresholdScale(HP, 'hp_', mainOnly)).toBeCloseTo(1.1 / 2.1)
      expect(thresholdScale(HP, 'hp_', neither)).toBe(1)
    })

    it('scales the threshold down so the slot can pass', () => {
      const [on] = hpRun([sands()], mainOnly).evaluations
      expect(on.verdict).toBe('level')
      expect(on.best?.threshold).toBeCloseTo(1.75 * (1.1 / 2.1))
      expect(on.reason).toMatch(/HP\+ER\+EM 1\.10 ≥ 0\.92 \(HP% main\)/)
      expect(hpRun([sands()], neither).evaluations[0].verdict).toBe('trash')
    })

    it('judges a build with few useful stats against a typical build total', () => {
      // A typical CRIT DPS (best four 3.05) is untouched; the HP build (2.10) is measured against 3.05.
      expect(thresholdScale(W, 'hp', both)).toBe(1)
      expect(thresholdScale(HP, 'atk', both)).toBeCloseTo(2.1 / 3.05)
      expect(thresholdScale(HP, 'hp_', both)).toBeCloseTo(1.1 / 3.05)
      const [s] = hpRun([sands()]).evaluations
      expect(s.reason).toMatch(/≥ 0\.63 \(HP% main, few useful stats\)/)
    })

    it('still needs the key stat once the bar is lowered', () => {
      const plume = (subs: [string, number][]) =>
        art({ slotKey: 'plume', mainStatKey: 'atk', substats: subs.map(([key, value]) => ({ key, value })) })
      const withHp = plume([['hp_', 5.8], ['eleMas', 23], ['def', 23], ['critDMG_', 7.8]]) // 1.30
      const withoutHp = plume([['hp', 299], ['enerRech_', 6.5], ['eleMas', 23], ['def', 23]]) // 1.10
      const [a, b] = hpRun([withHp, withoutHp]).evaluations
      expect(a.best?.threshold).toBeCloseTo(1.75 * (2.1 / 3.05))
      expect(a.verdict).toBe('level')
      expect(b.verdict).toBe('trash')
      expect(hpRun([withHp], mainOnly).evaluations[0].verdict).toBe('trash')
    })

    it('rates the worn piece against what its main stat allows', () => {
      const worn = sands({
        level: 20,
        location: 'Diluc',
        totalRolls: 9,
        substats: [
          { key: 'hp', value: 597.5 },
          { key: 'enerRech_', value: 12.96 },
          { key: 'eleMas', value: 46.62 },
          { key: 'def', value: 23.15 },
        ],
      })
      const slot = hpRun([worn]).characters[0].builds[0].slots.sands
      expect(slot.value).toBeCloseTo(2.2)
      expect(slot.quality).toBeCloseTo(2.2 / (1.1 * 0.85 * 2.25))
    })
  })
})
