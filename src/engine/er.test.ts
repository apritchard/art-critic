import { describe, expect, it } from 'vitest'
import { erModel, erNeed, pieceER, totalER, type GameData } from './er'
import { loadPieces } from './load'
import { rerollOdds } from './reroll'
import type { ArtifactConfig, BuildConfig, GoodArtifact, GoodExport } from './types'

const target = (erTarget: string) => erNeed({ erTarget } as BuildConfig)

// A flat curve keeps the arithmetic readable: weapon substats are base × curve[level].
const gd: GameData = {
  source: 'test',
  fetched: '',
  weapons: {
    FavoniusSword: { sub: { stat: 'enerRech_', base: 0.3, curve: 'FLAT' } },
    WolfsGravestone: { sub: { stat: 'atk_', base: 0.5, curve: 'FLAT' } },
    BreezeborneRefrain: { sub: { stat: 'critRate_', base: 0.1, curve: 'FLAT' }, refine: { enerRech_: [-1, 0.2, 0.25, 0.3, 0.35, 0.4] } },
  },
  chars: {
    Bennett: { stat: 'enerRech_', values: [0, 0, 0.0667, 0.1333, 0.1333, 0.2, 0.2667] },
    Diluc: { stat: 'critRate_', values: [0, 0, 0.048, 0.096, 0.096, 0.144, 0.192] },
    Traveler: { stat: 'atk_', values: [0, 0, 0.06, 0.12, 0.12, 0.18, 0.24] },
  },
  curves: { FLAT: Array(101).fill(1) },
  artMain: { '5': { enerRech_: Array.from({ length: 21 }, (_, l) => 0.078 + l * 0.022) } },
}

const config = {
  sets: {
    EmblemOfSeveredFate: { twoPiece: '', fourPiece: '', twoPieceCategory: 'er20' },
    CrimsonWitchOfFlames: { twoPiece: '', fourPiece: '', twoPieceCategory: 'ele15:pyro' },
  },
} as unknown as ArtifactConfig

const char = (key: string, ascension = 6) => ({ key, level: 90, constellation: 0, ascension, talent: { auto: 1, skill: 1, burst: 1 } })
const weapon = (key: string, location: string, refinement = 1) => ({ key, level: 90, ascension: 6, refinement, location, lock: true })
const art = (over: Partial<GoodArtifact>): GoodArtifact => ({
  setKey: 'CrimsonWitchOfFlames',
  slotKey: 'flower',
  level: 20,
  rarity: 5,
  mainStatKey: 'hp',
  location: 'Bennett',
  lock: true,
  substats: [],
  ...over,
})

describe('ER targets', () => {
  it('takes the low end of the first percentage', () => {
    expect(target('110-130%')).toBe(110)
    expect(target('~130-180%')).toBe(130)
    expect(target('250%+ at C0 (~165% at C6)')).toBe(250)
    expect(target('100-150% (Icy Veins/GameWith; mobalytics says 120-180%)')).toBe(100)
    expect(target('To requirement (~120%)')).toBe(120)
    expect(target('Low; mostly skippable (GameWith)')).toBeNull()
    expect(target('')).toBeNull()
  })
})

describe('ER totals', () => {
  const data: GoodExport = {
    format: 'GOOD',
    version: 3,
    characters: [char('Bennett'), char('Diluc'), char('TravelerCryo'), char('Kaveh')],
    weapons: [weapon('FavoniusSword', 'Bennett'), weapon('WolfsGravestone', 'Diluc'), weapon('BreezeborneRefrain', 'Traveler', 3)],
    artifacts: [],
  }
  const model = erModel(data, gd, config)!

  it('adds base, ascension, weapon substat and refinement bonus', () => {
    expect(model.outside.get('Bennett')).toBeCloseTo(100 + 26.67 + 30, 1)
    expect(model.outside.get('Diluc')).toBeCloseTo(100)
    // The plain "Traveler" weapon location and game-data key both map to the owned Traveler.
    expect(model.outside.get('TravelerCryo')).toBeCloseTo(130)
    // No weapon in the export: unknown rather than guessed.
    expect(model.outside.has('Kaveh')).toBe(false)
    expect(totalER(model, 'Kaveh', [])).toBeNull()
  })

  it('counts ER main stats, ER lines and 2pc bonuses', () => {
    const pieces = loadPieces({
      ...data,
      artifacts: [
        art({ slotKey: 'sands', mainStatKey: 'enerRech_', setKey: 'EmblemOfSeveredFate' }),
        art({ setKey: 'EmblemOfSeveredFate', substats: [{ key: 'enerRech_', value: 11 }] }),
        art({ slotKey: 'plume', mainStatKey: 'atk', substats: [{ key: 'enerRech_', value: 5.2 }] }),
      ],
    })
    expect(pieceER(pieces[0], gd)).toBeCloseTo(51.8)
    expect(totalER(model, 'Bennett', pieces)).toBeCloseTo(156.67 + 51.8 + 11 + 5.2 + 20, 1)
    expect(totalER(model, 'Bennett', pieces.slice(1))).toBeCloseTo(156.67 + 11 + 5.2, 1)
  })
})

describe('rerolls that need to keep ER', () => {
  const W = { critRate_: 1, critDMG_: 1, enerRech_: 0.3 }
  // Most of the upgrades went into ER.
  const [plume] = loadPieces({
    format: 'GOOD',
    version: 3,
    characters: [char('Bennett')],
    artifacts: [
      art({
        slotKey: 'plume',
        mainStatKey: 'atk',
        totalRolls: 9,
        substats: [
          { key: 'critRate_', value: 3.9, initialValue: 3.9 },
          { key: 'critDMG_', value: 7.8, initialValue: 7.8 },
          { key: 'enerRech_', value: 32.4, initialValue: 6.5 },
          { key: 'def', value: 23, initialValue: 23 },
        ],
      }),
    ],
  })

  it('only counts results that keep enough ER, and may pick ER', () => {
    const free = rerollOdds(plume, W, 2)!
    expect(free.erBound).toBe(false)
    expect(free.chosen).toEqual(['critRate_', 'critDMG_'])
    // The character needs at least 15% from this line: the starting 6.5 plus a couple of rolls.
    const bound = rerollOdds(plume, W, 2, 15)!
    expect(bound.erBound).toBe(true)
    expect(bound.gain).toBeLessThan(free.gain)
    expect(bound.chance).toBeLessThan(free.chance)
    expect(bound.chosen).toContain('enerRech_')
  })

  it('leaves the odds alone when the line has room to spare', () => {
    const roomy = rerollOdds(plume, W, 2, 6)!
    const free = rerollOdds(plume, W, 2)!
    expect(roomy.erBound).toBe(false)
    expect(roomy.gain).toBeCloseTo(free.gain, 9)
    expect(free.erAfter).toBeGreaterThan(6.5)
  })
})
