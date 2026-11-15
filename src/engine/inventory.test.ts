import { describe, expect, it } from 'vitest'
import type { Candidate, Evaluation } from './evaluate'
import { inventoryOrder, levelPriority } from './inventory'
import { loadPieces } from './load'
import type { GoodArtifact } from './types'

const art = (over: Partial<GoodArtifact>): GoodArtifact => ({
  setKey: 'HeartOfTheFurnace',
  slotKey: 'flower',
  level: 0,
  rarity: 5,
  mainStatKey: 'hp',
  location: '',
  lock: false,
  substats: [
    { key: 'critDMG_', value: 5.4 },
    { key: 'hp_', value: 4.1 },
    { key: 'atk_', value: 5.3 },
  ],
  ...over,
})
const four = [
  { key: 'critDMG_', value: 5.4 },
  { key: 'eleMas', value: 23 },
  { key: 'enerRech_', value: 6.5 },
  { key: 'def_', value: 6.6 },
]

describe('inventory order', () => {
  // Export order is the order obtained, oldest first. Tags say where each one should land.
  const raw: [string, GoodArtifact][] = [
    ['locked 3-line, oldest', art({ lock: true })],
    ['locked 4-line', art({ lock: true, substats: four })],
    ['+16 sands', art({ slotKey: 'sands', mainStatKey: 'atk_', level: 16, lock: true })],
    ['+20 plume', art({ slotKey: 'plume', mainStatKey: 'atk', level: 20, lock: true })],
    ['unlocked 3-line', art({})],
    ['+16 flower', art({ level: 16 })],
    ['+20 flower', art({ level: 20, lock: true })],
    ['unlocked 4-line', art({ substats: four })],
    ['locked 3-line, newest', art({ lock: true })],
    ['+0 plume', art({ slotKey: 'plume', mainStatKey: 'atk' })],
  ]
  const tag = new Map(loadPieces({ format: 'GOOD', version: 3, characters: [], artifacts: raw.map(([, a]) => a) }).map((p) => [p, raw[p.idx][0]]))
  const pieces = [...tag.keys()]

  it('sorts by level, slot, lock, line count, then newest first', () => {
    expect([...pieces].sort((a, b) => inventoryOrder(a, b)).map((p) => tag.get(p))).toEqual([
      '+20 flower',
      '+20 plume',
      '+16 flower',
      '+16 sands',
      'locked 4-line',
      'locked 3-line, newest',
      'locked 3-line, oldest',
      'unlocked 4-line',
      'unlocked 3-line',
      '+0 plume',
    ])
  })

  it("can order by lock states other than the export's (as after reopening)", () => {
    const unlocked = pieces.find((p) => tag.get(p) === 'unlocked 3-line')!
    const locked = (p: (typeof pieces)[number]) => p.lock || p === unlocked
    const order = [...pieces].sort((a, b) => inventoryOrder(a, b, locked)).map((p) => tag.get(p))
    expect(order.indexOf('unlocked 3-line')).toBeLessThan(order.indexOf('unlocked 4-line'))
    expect(order.indexOf('unlocked 3-line')).toBeGreaterThan(order.indexOf('locked 3-line, newest'))
  })
})

describe('level priority', () => {
  const CRIT = { critRate_: 1, critDMG_: 1, atk_: 0.75 }
  // A fresh 4-liner with three good lines: about 2.75 now and 5.7 on average at +20.
  const [fresh] = loadPieces({
    format: 'GOOD',
    version: 3,
    characters: [],
    artifacts: [
      art({
        substats: [
          { key: 'critRate_', value: 3.9 },
          { key: 'critDMG_', value: 7.8 },
          { key: 'atk_', value: 5.8 },
          { key: 'def', value: 19 },
        ],
      }),
    ],
  })
  const cand = (char: string, priority: 'priority' | 'normal', bar: number | null, inCap = true) =>
    ({ ref: { char, priority, build: { substats: CRIT } }, bar, chance: 0.9, inCap, expected: 5.7, current: 2.75 }) as unknown as Candidate
  const ev = (candidates: Candidate[], over: Partial<Evaluation> = {}) =>
    ({ piece: fresh, candidates, best: candidates[0] ?? null, nextStop: 4, ...over }) as Evaluation

  it('is high priority at a gain of one roll or more for a ★ character', () => {
    expect(levelPriority(ev([cand('Yelan', 'priority', 2)]), true)).toMatchObject({ next: 4, char: 'Yelan', star: true, high: true })
    // Already wearing something better than it will likely become: worth leveling, but not urgent.
    expect(levelPriority(ev([cand('Yelan', 'priority', 7)]), true)?.high).toBe(false)
  })

  it('prefers a ★ reason, and counts everyone when nobody is ★', () => {
    const both = ev([cand('Thoma', 'normal', null), cand('Yelan', 'priority', 2)])
    expect(levelPriority(both, true)).toMatchObject({ char: 'Yelan', high: true })
    expect(levelPriority(ev([cand('Thoma', 'normal', 2)]), true)?.high).toBe(false)
    expect(levelPriority(ev([cand('Thoma', 'normal', 2)]), false)).toMatchObject({ char: 'Thoma', high: true })
    // Only the builds triage keeps it for count.
    expect(levelPriority(ev([cand('Yelan', 'priority', 2, false)]), true)?.high).toBe(false)
  })

  it('steps up at fixed gains, the same in every set', () => {
    // The fresh piece averages about 5.7 at +20: the bar sets how much of that is a gain.
    const tierAt = (bar: number) => levelPriority(ev([cand('Yelan', 'priority', bar)]), true)!
    expect(tierAt(0).tier).toBe(4)
    expect(tierAt(7.5).tier).toBe(0)
    const tiers = [0, 2, 3, 4, 4.5, 5, 5.5, 6, 7].map(tierAt)
    // Lower bars mean bigger gains and never a lower tier; each tier matches the steps.
    tiers.forEach((t, i) => i > 0 && expect(t.tier).toBeLessThanOrEqual(tiers[i - 1].tier))
    for (const t of tiers) expect(t.tier).toBe([0.5, 1, 2, 3].filter((s) => t.gain >= s).length)
    expect(new Set(tiers.map((t) => t.tier))).toEqual(new Set([0, 1, 2, 3, 4]))
    // Only for a ★ character while someone is ★.
    expect(levelPriority(ev([cand('Thoma', 'normal', 0)]), true)?.tier).toBe(0)
  })

  it('is null for pieces not in the Level up queue', () => {
    expect(levelPriority(ev([cand('Yelan', 'priority', 2)], { nextStop: null }), true)).toBeNull()
  })

  it('counts what finishing an equipped piece adds for its wearer', () => {
    const worn = { ...fresh, owner: 'Yelan' }
    expect(levelPriority(ev([cand('Yelan', 'priority', 2.75)], { piece: worn }), true)).toMatchObject({ gain: 5.7 - 2.75, high: true })
  })
})
