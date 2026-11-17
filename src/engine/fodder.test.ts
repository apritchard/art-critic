import { describe, expect, it } from 'vitest'
import { allocate, boxRatio, expBetween, feedExp, levelingOutlook, materialsExp, startOf, type CraftCurve } from './fodder'
import { expectedGainOver } from './projection'
import type { GoodArtifact } from './types'

const W = { critRate_: 1, critDMG_: 1, atk_: 0.75, atk: 0.3 }
const fresh = (over: Partial<GoodArtifact> = {}): GoodArtifact => ({
  setKey: 'X',
  slotKey: 'flower',
  level: 0,
  rarity: 5,
  mainStatKey: 'hp',
  location: '',
  lock: false,
  substats: [
    { key: 'critRate_', value: 3.5 },
    { key: 'critDMG_', value: 7.0 },
    { key: 'atk_', value: 5.0 },
    { key: 'def', value: 19 },
  ],
  ...over,
})

describe('EXP', () => {
  it('matches the game table', () => {
    expect(expBetween(0, 4)).toBe(16300)
    expect(expBetween(0, 20)).toBe(270475)
    expect(feedExp(0)).toBe(3780)
    expect(feedExp(20)).toBe(3780 + 216380)
    expect(materialsExp(undefined)).toBeNull()
    expect(materialsExp({ SanctifyingUnction: 2, SanctifyingEssence: 1, Other: 9 })).toBe(2 * 2520 + 3780)
  })
})

describe('levelingOutlook', () => {
  it('finishes every piece when nothing can stop it, matching expectedGainOver', () => {
    const a = fresh()
    const o = levelingOutlook(startOf(a, W), -1, 0.2)
    expect(o.exp).toBe(270475)
    expect(o.finish).toBeCloseTo(1, 9)
    expect(o.gain).toBeCloseTo(expectedGainOver(a, W, -1), 6)
  })

  it('pays only the first stop for a piece that can never beat the bar', () => {
    const o = levelingOutlook(startOf(fresh(), W), 100, 0.2)
    expect(o.exp).toBe(16300)
    expect(o.gain).toBe(0)
  })

  it('drops some borderline pieces part way, and loses a little gain for it', () => {
    const a = fresh()
    const bar = 5
    const o = levelingOutlook(startOf(a, W), bar, 0.2)
    expect(o.exp).toBeGreaterThan(16300)
    expect(o.exp).toBeLessThan(270475)
    expect(o.finish).toBeGreaterThan(0)
    expect(o.finish).toBeLessThan(1)
    expect(o.gain).toBeLessThanOrEqual(expectedGainOver(a, W, bar) + 1e-9)
  })

  it("gives a 3-liner's +4 no roll", () => {
    const a = fresh({ substats: fresh().substats.slice(0, 3), unactivatedSubstats: [{ key: 'def', value: 19 }] })
    const o = levelingOutlook(startOf(a, W), null, 0.2)
    expect(o.exp).toBe(270475)
    expect(o.gain).toBeCloseTo(expectedGainOver(a, W, null), 6)
  })
})

describe('allocate', () => {
  const q = (gain: number, exp: number) => ({ gain, exp, finish: 1 })
  const linear = (each: number, cost: number): CraftCurve => ({ set: 'S', levelExp: 0, cost, gain: (k) => k * each })

  it('funds the best queue pieces until EXP runs out', () => {
    const a = allocate([q(3, 100), q(2, 100), q(1, 100)], [], 250, 0)
    expect(a).toMatchObject({ funded: 2, price: 1 / 100 })
  })

  it('boxes every toss when EXP is plentiful and crafts gain', () => {
    const a = allocate([q(1, 100)], [linear(0.5, 10)], 1e6, 10)
    expect(a.funded).toBe(1)
    expect(a.crafts).toEqual([3])
    expect(a.price).toBe(0)
  })

  it('stops crafting once a craft gains less per EXP than the queue', () => {
    const curve: CraftCurve = { set: 'S', levelExp: 0, cost: 100, gain: (k) => 4 * (1 - 0.5 ** k) }
    // Crafts add 2, 1, 0.5, …; the queue pays 0.8 per 100 EXP.
    const a = allocate(Array.from({ length: 10 }, () => q(0.8, 100)), [curve], 600, 30)
    expect(a.crafts).toEqual([2])
    expect(a.funded).toBe(4)
  })
})

describe('boxRatio', () => {
  const q = (gain: number, exp: number) => ({ gain, exp, finish: 1 })
  const linear = (each: number, cost: number): CraftCurve => ({ set: 'S', levelExp: 0, cost, gain: (k) => k * each })
  const split = (queue: ReturnType<typeof q>[], curves: CraftCurve[], budget: number, tosses: number) => {
    const a = allocate(queue, curves, budget, tosses)
    return { boxed: a.crafts.some((n) => n > 0), ...boxRatio(curves, a, tosses) }
  }

  it("counts a craft that adds too little as nothing, as the split does, even with EXP to spare", () => {
    const s = split([q(1, 100)], [linear(0.005, 10)], 1e6, 30)
    expect(s).toMatchObject({ boxed: false, best: null, ratio: 0 })
  })

  it('leans to box exactly when the split boxes', () => {
    const halving: CraftCurve = { set: 'S', levelExp: 0, cost: 100, gain: (k) => 4 * (1 - 0.5 ** k) }
    const cases = [
      split([q(1, 100)], [linear(0.5, 10)], 1e6, 30), // EXP to spare: box
      split([q(1, 100)], [linear(0.5, 10)], 1e6, 2), // too few +0s for a craft: feed
      split(Array.from({ length: 10 }, () => q(0.8, 100)), [halving], 600, 30), // crafts first, then the queue
      split(Array.from({ length: 10 }, () => q(5, 100)), [halving], 600, 30), // the queue beats every craft
    ]
    expect(cases.map((s) => s.boxed)).toEqual([true, false, true, false])
    expect(cases[0].ratio).toBe(Infinity)
    expect(cases[1].ratio).toBe(0)
    for (const s of cases) expect(s.ratio > 1).toBe(s.boxed)
  })
})
