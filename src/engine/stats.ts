import type { SlotKey } from './types'

/** Highest single roll of each 5★ substat. A substat's value / max roll = its roll value (RV). */
export const MAX_ROLL: Record<string, number> = {
  hp: 298.75,
  atk: 19.45,
  def: 23.15,
  hp_: 5.83,
  atk_: 5.83,
  def_: 7.29,
  eleMas: 23.31,
  enerRech_: 6.48,
  critRate_: 3.89,
  critDMG_: 7.77,
}

export const ROLL_TIERS = [0.7, 0.8, 0.9, 1.0]
export const AVG_TIER = 0.85

const STAT_LABEL: Record<string, string> = {
  hp: 'HP',
  hp_: 'HP%',
  atk: 'ATK',
  atk_: 'ATK%',
  def: 'DEF',
  def_: 'DEF%',
  eleMas: 'Elemental Mastery',
  enerRech_: 'Energy Recharge',
  critRate_: 'CRIT Rate',
  critDMG_: 'CRIT DMG',
  heal_: 'Healing Bonus',
  physical_dmg_: 'Physical DMG',
  anemo_dmg_: 'Anemo DMG',
  geo_dmg_: 'Geo DMG',
  electro_dmg_: 'Electro DMG',
  dendro_dmg_: 'Dendro DMG',
  hydro_dmg_: 'Hydro DMG',
  pyro_dmg_: 'Pyro DMG',
  cryo_dmg_: 'Cryo DMG',
}

const STAT_SHORT: Record<string, string> = {
  hp: 'HP',
  hp_: 'HP%',
  atk: 'ATK',
  atk_: 'ATK%',
  def: 'DEF',
  def_: 'DEF%',
  eleMas: 'EM',
  enerRech_: 'ER',
  critRate_: 'CR',
  critDMG_: 'CD',
  heal_: 'Heal',
  physical_dmg_: 'Phys',
  anemo_dmg_: 'Anemo',
  geo_dmg_: 'Geo',
  electro_dmg_: 'Electro',
  dendro_dmg_: 'Dendro',
  hydro_dmg_: 'Hydro',
  pyro_dmg_: 'Pyro',
  cryo_dmg_: 'Cryo',
}

export const statLabel = (key: string) => STAT_LABEL[key] ?? key
export const statShort = (key: string) => STAT_SHORT[key] ?? key
export const isPercent = (key: string) => key.endsWith('_')

/** Format a substat the way the game shows it, e.g. "CRIT Rate+3.9%" or "ATK+19". */
export function formatStat(key: string, value: number): string {
  const label = STAT_LABEL[key] ?? key
  // Flat HP/ATK/DEF and EM display as integers; ER/DMG% etc. as one decimal.
  const shown = isPercent(key) ? `${value.toFixed(1)}%` : `${Math.round(value)}`
  // Percent variants of HP/ATK/DEF show as "ATK+5.3%", not "ATK%+5.3%".
  const name = key === 'hp_' || key === 'atk_' || key === 'def_' ? label.slice(0, -1) : label
  return `${name}+${shown}`
}

export const SLOT_LABEL: Record<SlotKey, string> = {
  flower: 'Flower',
  plume: 'Plume',
  sands: 'Sands',
  goblet: 'Goblet',
  circlet: 'Circlet',
}

/** "flowers", "sands": a slot's pieces in running text. */
export const slotPlural = (slot: SlotKey) => (slot === 'sands' ? 'sands' : `${SLOT_LABEL[slot].toLowerCase()}s`)

/** What a cap of `n` means in a reason: "top 3 kept". Settings' slider tops out at 99 for no cap. */
export const topKept = (n: number) => (!Number.isFinite(n) || n >= 99 ? 'no cap' : `top ${n} kept`)

const SET_NAMES: Record<string, string> = {
  ADayCarvedFromRisingWinds: 'A Day Carved From Rising Winds',
  AubadeOfMorningstarAndMoon: 'Aubade of Morningstar and Moon',
  CrimsonWitchOfFlames: 'Crimson Witch of Flames',
  DisenchantmentInDeepShadow: 'Disenchantment in Deep Shadow',
  EchoesOfAnOffering: 'Echoes of an Offering',
  EmblemOfSeveredFate: 'Emblem of Severed Fate',
  FinaleOfTheDeepGalleries: 'Finale of the Deep Galleries',
  FlowerOfParadiseLost: 'Flower of Paradise Lost',
  FragmentOfHarmonicWhimsy: 'Fragment of Harmonic Whimsy',
  GladiatorsFinale: "Gladiator's Finale",
  HeartOfDepth: 'Heart of Depth',
  HeartOfTheFurnace: 'Heart of the Furnace',
  HuskOfOpulentDreams: 'Husk of Opulent Dreams',
  LongNightsOath: "Long Night's Oath",
  MarechausseeHunter: 'Marechaussee Hunter',
  NightOfTheSkysUnveiling: "Night of the Sky's Unveiling",
  NighttimeWhispersInTheEchoingWoods: 'Nighttime Whispers in the Echoing Woods',
  NymphsDream: "Nymph's Dream",
  OceanHuedClam: 'Ocean-Hued Clam',
  ScrollOfTheHeroOfCinderCity: 'Scroll of the Hero of Cinder City',
  ShimenawasReminiscence: "Shimenawa's Reminiscence",
  SilkenMoonsSerenade: "Silken Moon's Serenade",
  SongOfDaysPast: 'Song of Days Past',
  TenacityOfTheMillelith: 'Tenacity of the Millelith',
  VourukashasGlow: "Vourukasha's Glow",
  WanderersTroupe: "Wanderer's Troupe",
}

const splitPascal = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2')

export const setName = (key: string) => SET_NAMES[key] ?? splitPascal(key)

const CHARACTER_NAMES: Record<string, string> = {
  AratakiItto: 'Itto',
  KaedeharaKazuha: 'Kazuha',
  KamisatoAyaka: 'Ayaka',
  KamisatoAyato: 'Ayato',
  KujouSara: 'Sara',
  KukiShinobu: 'Shinobu',
  RaidenShogun: 'Raiden',
  SangonomiyaKokomi: 'Kokomi',
  ShikanoinHeizou: 'Heizou',
  YumemizukiMizuki: 'Mizuki',
  Tartaglia: 'Childe',
}

export function characterName(key: string): string {
  if (CHARACTER_NAMES[key]) return CHARACTER_NAMES[key]
  const traveler = /^Traveler(\w+)$/.exec(key)
  if (traveler) return `Traveler (${traveler[1]})`
  return splitPascal(key)
}
