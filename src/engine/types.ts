// GOOD (Genshin Open Object Description) export, as written by Irminsul.

export type SlotKey = 'flower' | 'plume' | 'sands' | 'goblet' | 'circlet'
export const SLOTS: SlotKey[] = ['flower', 'plume', 'sands', 'goblet', 'circlet']

export interface GoodSubstat {
  key: string
  value: number
  initialValue?: number
}

export interface GoodArtifact {
  setKey: string
  slotKey: SlotKey
  level: number
  rarity: number
  mainStatKey: string
  location: string
  lock: boolean
  substats: GoodSubstat[]
  totalRolls?: number
  astralMark?: boolean
  elixirCrafted?: boolean
  unactivatedSubstats?: GoodSubstat[]
}

export interface GoodCharacter {
  key: string
  level: number
  constellation: number
  ascension: number
  talent: { auto: number; skill: number; burst: number }
}

export interface GoodWeapon {
  key: string
  level: number
  ascension: number
  refinement: number
  location: string
  lock: boolean
}

export interface GoodExport {
  format: string
  version: number
  source?: string
  characters: GoodCharacter[]
  artifacts: GoodArtifact[]
  weapons?: GoodWeapon[]
}

// genshin_artifact_config.json

export type Confidence = 'verified' | 'consensus' | 'speculative'

export interface BuildConfig {
  name: string
  sets4: { set: string; tier: number }[]
  sets2: string[][]
  mainStats: Partial<Record<'sands' | 'goblet' | 'circlet', string[]>>
  avoidMainStats?: Partial<Record<'sands' | 'goblet' | 'circlet', string[]>>
  substatPreset: string
  substats: Record<string, number>
  erTarget: string
  notes: string
}

export interface CharacterConfig {
  element: string
  confidence: Confidence
  enabled: boolean
  builds: BuildConfig[]
}

export interface SetConfig {
  twoPiece: string
  fourPiece: string
  twoPieceCategory: string
}

export interface ArtifactConfig {
  schemaVersion: number
  gameVersion: string
  generated: string
  scoringDefaults: {
    levelThreshold4Line: number
    levelThreshold3Line: number
    alwaysLevelCritCircletWithOtherCritSub: boolean
    rescoreAtLevels: number[]
  }
  legacySets: string[]
  sets: Record<string, SetConfig>
  substatPresets: Record<string, Record<string, number>>
  characters: Record<string, CharacterConfig>
}

// User-adjustable settings and roster.

export type SetMatchMode = '4pc-t12' | '4pc-all' | 'config'
/** Which pieces of other sets can count as a build's one off-set piece. */
export type OffSetMode = 'off' | 'rare' | 'any'
export type Priority = 'priority' | 'normal' | 'ignore'

export interface Settings {
  threshold4Line: number
  threshold3Line: number
  critCircletRule: boolean
  /** Scale the thresholds by how much of the build's best lines the piece's main stat leaves possible. */
  scaleForMainStat: boolean
  /** Judge builds with few useful stats (best four weights under a typical build's) by the share of their own best. */
  scaleLowBuilds: boolean
  setMatch: SetMatchMode
  /** Once a build's character wears one of its 4pc sets, other sets count only if ranked a better tier. */
  commitToWornSet: boolean
  offSet: OffSetMode
  /** Off-set candidates kept per character build, across all slots. */
  capOffSet: number
  /** 0-1; a candidate must have at least this chance of beating the equipped piece. */
  minUpgradeChance: number
  capNormal: number
  capPriority: number
  includeUnowned: boolean
  lockMarginal: boolean
}

export interface RosterEntry {
  priority: Priority
  /** Build indexes switched off for this character. */
  disabledBuilds: number[]
}

export type Roster = Record<string, RosterEntry>
