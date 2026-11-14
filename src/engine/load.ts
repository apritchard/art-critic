import type { GoodArtifact, GoodExport } from './types'

/** An artifact with a stable id and its equip location resolved to a character key. */
export interface Piece extends GoodArtifact {
  /** Position in the export, which follows acquisition order. */
  idx: number
  /** Content fingerprint; GOOD has no artifact ids. Exact duplicates get a #n suffix. */
  id: string
  /** Character key wearing it, or null. */
  owner: string | null
}

export function fingerprint(a: GoodArtifact): string {
  const subs = a.substats.map((s) => `${s.key}:${s.value}`).join(',')
  const hidden = (a.unactivatedSubstats ?? []).map((s) => `${s.key}:${s.value}`).join(',')
  return `${a.setKey}|${a.slotKey}|${a.mainStatKey}|${a.level}|${subs}|${hidden}`
}

/**
 * GOOD writes the Traveler's equip location as plain "Traveler" while the character list uses an
 * element-specific key such as "TravelerCryo".
 */
export function resolveLocation(location: string, ownedKeys: string[]): string | null {
  if (!location) return null
  if (location === 'Traveler') return ownedKeys.find((k) => k.startsWith('Traveler')) ?? location
  return location
}

/** An equip made in-game since the export: this piece now goes on this character. */
export interface Equip {
  piece: string
  char: string
}

/**
 * Pieces as they are after equips made since the export, in order. Equipping a piece another character
 * wears swaps the two, as the game does; a spare just displaces what the character wore, which becomes
 * unequipped.
 */
export function applyEquips(pieces: Piece[], equips: Equip[]): Piece[] {
  if (!equips.length) return pieces
  const out = pieces.slice()
  const at = new Map(out.map((p, i) => [p.id, i]))
  for (const { piece, char } of equips) {
    const i = at.get(piece)
    if (i === undefined || out[i].owner === char) continue
    const moved = out[i]
    const j = out.findIndex((p) => p.owner === char && p.slotKey === moved.slotKey)
    out[i] = { ...moved, owner: char, location: char }
    if (j >= 0) out[j] = { ...out[j], owner: moved.owner, location: moved.owner ?? '' }
  }
  return out
}

/**
 * The equip list with one more equip. A piece moved again keeps its earlier move, since equips are replayed in order
 * (the second move swaps it with whoever it goes to); a piece the character already wears adds nothing.
 */
export function addEquip(equips: Equip[], applied: Piece[], piece: string, char: string): Equip[] {
  if (applied.find((p) => p.id === piece)?.owner === char) return equips
  return [...equips, { piece, char }]
}

/** Checks a fetched file is a GOOD export, and fills in the sections GOOD lets a scanner leave out. */
export function parseExport(raw: unknown, name: string): GoodExport {
  const data = raw as Partial<GoodExport> | null
  if (!data || typeof data !== 'object' || data.format !== 'GOOD') {
    throw new Error(`${name} isn't a GOOD export. Export again from Irminsul, or remove it from imports/.`)
  }
  return { ...data, characters: data.characters ?? [], artifacts: data.artifacts ?? [], weapons: data.weapons ?? [] } as GoodExport
}

export function loadPieces(data: GoodExport): Piece[] {
  const owned = data.characters.map((c) => c.key)
  const seen = new Map<string, number>()
  return data.artifacts.map((raw, idx) => {
    // Some GOOD writers pad missing lines with empty entries; only real lines count.
    const a: GoodArtifact = { ...raw, substats: raw.substats.filter((x) => x.key) }
    if (raw.unactivatedSubstats) a.unactivatedSubstats = raw.unactivatedSubstats.filter((x) => x.key)
    const base = fingerprint(a)
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return { ...a, idx, id: n === 0 ? base : `${base}#${n}`, owner: resolveLocation(a.location, owned) }
  })
}
