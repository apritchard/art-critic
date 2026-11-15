import { describe, expect, it } from 'vitest'
import { inventoryOrder } from './inventory'
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

  it("can order by lock states other than the export's", () => {
    const unlocked = pieces.find((p) => tag.get(p) === 'unlocked 3-line')!
    const locked = (p: (typeof pieces)[number]) => p.lock || p === unlocked
    const order = [...pieces].sort((a, b) => inventoryOrder(a, b, locked)).map((p) => tag.get(p))
    expect(order.indexOf('unlocked 3-line')).toBeLessThan(order.indexOf('unlocked 4-line'))
    expect(order.indexOf('unlocked 3-line')).toBeGreaterThan(order.indexOf('locked 3-line, newest'))
  })
})
