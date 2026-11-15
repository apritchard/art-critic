// The order the game's artifact inventory lists pieces in, so the Inventory tab can mirror it cell for cell.
import type { Piece } from './load'
import { SLOTS } from './types'

/**
 * Compares two pieces in the in-game artifact inventory's order, with "Show 5-star Artifacts in the order of when
 * they were obtained" off: rarity and level high to low, then flower → circlet, locked before unlocked, 4 active
 * lines before 3, then newest first. Worked out from in-game screenshots of one set against an export, and confirmed
 * by predicting pieces further down the same grid.
 *
 * `locked` says what the game shows as locked: the export's state by default. The game re-sorts when the inventory
 * is opened again, so a piece locked since the export moves up then.
 */
export function inventoryOrder(a: Piece, b: Piece, locked: (p: Piece) => boolean = (p) => p.lock): number {
  return (
    b.rarity - a.rarity ||
    b.level - a.level ||
    SLOTS.indexOf(a.slotKey) - SLOTS.indexOf(b.slotKey) ||
    Number(locked(b)) - Number(locked(a)) ||
    b.substats.length - a.substats.length ||
    b.idx - a.idx
  )
}
