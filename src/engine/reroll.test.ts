import { describe, expect, it } from 'vitest'
import { defaultSettings, evaluate } from './evaluate'
import { loadPieces } from './load'
import { planRerolls, rerollOdds, upgradeCounts } from './reroll'
import type { ArtifactConfig, GoodArtifact, GoodExport } from './types'

const W = { critRate_: 1, critDMG_: 1, atk_: 0.75, atk: 0.3, enerRech_: 0.3, eleMas: 0.2 }

const owned = [{ key: 'Diluc', level: 90, constellation: 0, ascension: 6, talent: { auto: 1, skill: 1, burst: 1 } }]

const piece = (substats: GoodArtifact['substats'], over: Partial<GoodArtifact> = {}) =>
  loadPieces({
    format: 'GOOD',
    version: 3,
    characters: owned,
    artifacts: [
      {
        setKey: 'CrimsonWitchOfFlames',
        slotKey: 'flower',
        level: 20,
        rarity: 5,
        mainStatKey: 'hp',
        location: 'Diluc',
        lock: true,
        totalRolls: 9,
        substats,
        ...over,
      },
    ],
  })[0]

// Starts with one max CRIT Rate and CRIT DMG roll; all five upgrades went into DEF.
const bricked = piece([
  { key: 'critRate_', value: 3.9, initialValue: 3.9 },
  { key: 'critDMG_', value: 7.8, initialValue: 7.8 },
  { key: 'def', value: 138, initialValue: 23 },
  { key: 'hp', value: 299, initialValue: 299 },
])

// Same start, but every upgrade hit CRIT at the top tier: nothing left to gain.
const perfect = piece([
  { key: 'critRate_', value: 15.6, initialValue: 3.9 },
  { key: 'critDMG_', value: 23.3, initialValue: 7.8 },
  { key: 'def', value: 23, initialValue: 23 },
  { key: 'hp', value: 299, initialValue: 299 },
])

describe('rerollOdds', () => {
  it('picks the two highest-weighted lines', () => {
    expect(rerollOdds(bricked, W, 2)?.chosen.sort()).toEqual(['critDMG_', 'critRate_'])
  })

  it('always improves a piece whose upgrades all went to dead stats', () => {
    const odds = rerollOdds(bricked, W, 2)!
    // At least two upgrades land on CRIT, each worth at least 0.7.
    expect(odds.chance).toBeCloseTo(1, 6)
    expect(odds.gain).toBeGreaterThan(1.4)
    expect(odds.expected).toBeCloseTo(2 + odds.gain, 1)
  })

  it('finds nothing to gain on a perfect piece', () => {
    const odds = rerollOdds(perfect, W, 2)!
    expect(odds.chance).toBeLessThan(0.01)
    expect(odds.gain).toBeLessThan(0.01)
  })

  it('gains more with a stronger guarantee', () => {
    // Two max CRIT Rate upgrades and three on DEF: a reroll has to land 3+ on CRIT to do better.
    const middling = piece([
      { key: 'critRate_', value: 11.7, initialValue: 3.9 },
      { key: 'critDMG_', value: 7.8, initialValue: 7.8 },
      { key: 'def', value: 92, initialValue: 23 },
      { key: 'hp', value: 299, initialValue: 299 },
    ])
    const [g2, g3, g4] = ([2, 3, 4] as const).map((g) => rerollOdds(middling, W, g)!)
    expect(g2.chance).toBeGreaterThan(0.4)
    expect(g2.chance).toBeLessThan(0.7)
    expect(g3.gain).toBeGreaterThan(g2.gain)
    expect(g4.gain).toBeGreaterThan(g3.gain)
    expect(g4.chance).toBeCloseTo(1, 6)
  })

  it('works out how many upgrades each line got', () => {
    expect(upgradeCounts(bricked)).toEqual([0, 0, 5, 0])
    expect(upgradeCounts(perfect)).toEqual([3, 2, 0, 0])
  })

  it('needs starting values from the export', () => {
    expect(rerollOdds(piece([{ key: 'critRate_', value: 3.9 }, { key: 'critDMG_', value: 7.8 }, { key: 'def', value: 23 }, { key: 'hp', value: 299 }]), W, 2)).toBeNull()
  })
})

describe('planRerolls', () => {
  const config = {
    scoringDefaults: { levelThreshold4Line: 1.75, levelThreshold3Line: 1.5, alwaysLevelCritCircletWithOtherCritSub: true, rescoreAtLevels: [] },
    sets: { CrimsonWitchOfFlames: { twoPiece: '', fourPiece: '', twoPieceCategory: 'x' } },
    characters: {
      Diluc: {
        element: 'pyro',
        confidence: 'consensus',
        enabled: true,
        builds: [
          {
            name: 'DPS',
            sets4: [{ set: 'CrimsonWitchOfFlames', tier: 1 }],
            sets2: [],
            mainStats: { sands: ['atk_'], goblet: ['pyro_dmg_'], circlet: ['critRate_'] },
            substatPreset: '',
            substats: W,
            erTarget: '',
            notes: '',
          },
        ],
      },
    },
  } as unknown as ArtifactConfig

  it('covers worn +20s and skips main stats the build rejects', () => {
    const subs = bricked.substats
    const data: GoodExport = {
      format: 'GOOD',
      version: 3,
      characters: owned,
      artifacts: [
        { ...bricked, idx: undefined, id: undefined, owner: undefined } as unknown as GoodArtifact,
        { ...bricked, slotKey: 'sands', mainStatKey: 'hp_', substats: subs } as unknown as GoodArtifact,
        { ...bricked, slotKey: 'goblet', mainStatKey: 'pyro_dmg_', level: 16, substats: subs } as unknown as GoodArtifact,
      ],
    }
    const pieces = loadPieces(data)
    const result = evaluate(pieces, owned, config, defaultSettings(config), {})
    const plan = planRerolls(result, pieces, 2)
    expect(plan.options.map((o) => o.piece.slotKey)).toEqual(['flower'])
    expect(plan.options[0].wasted).toBe(5)
    expect(plan.options[0].cost).toBe(1)
    expect(plan.wrongMain).toBe(1)
  })

  it('suggests moving a piece that already suits someone else', () => {
    // Bennett (ER/HP support) wears the all-CRIT flower; Diluc wears the bricked one.
    const support = { ...config.characters.Diluc.builds[0], name: 'Support', substats: { enerRech_: 1, hp_: 1, hp: 0.3 } }
    const withBennett = {
      ...config,
      characters: { ...config.characters, Bennett: { ...config.characters.Diluc, builds: [support] } },
    } as ArtifactConfig
    const chars = [...owned, { ...owned[0], key: 'Bennett' }]
    const data: GoodExport = {
      format: 'GOOD',
      version: 3,
      characters: chars,
      artifacts: [
        { ...bricked, idx: undefined, id: undefined, owner: undefined } as unknown as GoodArtifact,
        { ...perfect, location: 'Bennett', idx: undefined, id: undefined, owner: undefined } as unknown as GoodArtifact,
      ],
    }
    const pieces = loadPieces(data)
    const result = evaluate(pieces, chars, withBennett, defaultSettings(withBennett), {})
    const plan = planRerolls(result, pieces, 2)
    const bennett = plan.options.find((o) => o.ref.char === 'Bennett')!
    expect(bennett.elsewhere?.char).toBe('Diluc')
    expect(bennett.elsewhere!.to).toBeGreaterThan(bennett.elsewhere!.from!)
    expect(plan.options.find((o) => o.ref.char === 'Diluc')!.elsewhere).toBeNull()
  })

  it('rerolls a spare against what the character wears', () => {
    // Diluc wears a flower worth about 3. The bricked spare is worth 2, but rerolled it lands at least 3.4.
    const worn = piece([
      { key: 'critRate_', value: 7.8, initialValue: 3.9 },
      { key: 'critDMG_', value: 7.8, initialValue: 7.8 },
      { key: 'def', value: 23, initialValue: 23 },
      { key: 'hp', value: 299, initialValue: 299 },
    ])
    const spare = (p: typeof bricked) => ({ ...p, location: '', idx: undefined, id: undefined, owner: undefined }) as unknown as GoodArtifact
    const planWith = (...spares: GoodArtifact[]) => {
      const pieces = loadPieces({
        format: 'GOOD',
        version: 3,
        characters: owned,
        artifacts: [{ ...worn, idx: undefined, id: undefined, owner: undefined } as unknown as GoodArtifact, ...spares],
      })
      return planRerolls(result(pieces), pieces, 2, null, config)
    }
    const result = (pieces: ReturnType<typeof loadPieces>) => evaluate(pieces, owned, config, defaultSettings(config), {})
    // The sands has a main stat the build rejects.
    const plan = planWith(spare(bricked), spare({ ...bricked, slotKey: 'sands', mainStatKey: 'hp_' }))
    const spares = plan.options.filter((o) => o.spare)
    expect(spares).toHaveLength(1)
    const [o] = spares
    expect(o).toMatchObject({ ref: { char: 'Diluc' }, elsewhere: null, cost: 1 })
    expect(o.piece.substats[2].value).toBe(138)
    expect(o.spare!.replaces.owner).toBe('Diluc')
    expect(o.current).toBeCloseTo(2, 1)
    expect(o.spare!.bar).toBeCloseTo(3, 1)
    // Measured against the worn flower, not against itself.
    expect(o.chance).toBeCloseTo(1, 6)
    expect(o.gain).toBeCloseTo(o.expected - o.spare!.bar, 6)
    expect(o.gain).toBeCloseTo(rerollOdds(bricked, W, 2)!.gain - (o.spare!.bar - o.current), 6)
    // The worn flower is still listed as a reroll of its own.
    expect(plan.options.filter((x) => !x.spare).map((x) => x.piece.owner)).toEqual(['Diluc'])
    // With a spare that's already better, Free upgrades fills the slot: neither spare is rerolled for it.
    expect(planWith(spare(bricked), spare(perfect)).options.filter((o) => o.spare)).toEqual([])
  })

  it("leaves out a spare that's already a free upgrade for someone", () => {
    const support = { ...config.characters.Diluc.builds[0], name: 'Support', substats: { enerRech_: 1, hp_: 1, hp: 0.3 } }
    const withBennett = {
      ...config,
      characters: { ...config.characters, Bennett: { ...config.characters.Diluc, builds: [support] } },
    } as ArtifactConfig
    const chars = [...owned, { ...owned[0], key: 'Bennett' }]
    const raw = (p: typeof bricked, location: string) => ({ ...p, location, idx: undefined, id: undefined, owner: undefined }) as unknown as GoodArtifact
    // Worth about 3 to Bennett.
    const bennetts = piece([
      { key: 'enerRech_', value: 13, initialValue: 6.5 },
      { key: 'hp_', value: 5.8, initialValue: 5.8 },
      { key: 'def', value: 23, initialValue: 23 },
      { key: 'atk', value: 19, initialValue: 19 },
    ])
    // Worth about 2 to Bennett, so rerolled it could beat his flower, and about 5.3 to Diluc as it is.
    const both = piece([
      { key: 'critRate_', value: 15.6, initialValue: 3.9 },
      { key: 'critDMG_', value: 7.8, initialValue: 7.8 },
      { key: 'enerRech_', value: 6.5, initialValue: 6.5 },
      { key: 'hp_', value: 5.8, initialValue: 5.8 },
    ])
    const spareFor = (dilucs: typeof bricked) => {
      const pieces = loadPieces({
        format: 'GOOD',
        version: 3,
        characters: chars,
        artifacts: [raw(dilucs, 'Diluc'), raw(bennetts, 'Bennett'), raw(both, '')],
      })
      const result = evaluate(pieces, chars, withBennett, defaultSettings(withBennett), {})
      return planRerolls(result, pieces, 2, null, withBennett).options.filter((o) => o.spare)
    }
    // Diluc wears the bricked flower (about 2): the spare is his free upgrade, so it isn't rerolled for Bennett.
    expect(spareFor(bricked)).toEqual([])
    // Diluc wears the perfect one (about 6): the spare is Bennett's to reroll.
    expect(spareFor(perfect).map((o) => o.ref.char)).toEqual(['Bennett'])
  })
})
