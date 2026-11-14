// Farming planner: who gains most from new artifacts, and where to get them (domains, Strongbox, Elixir).
import { erNeed, totalER, type ErModel } from './er'
import type { ActiveBuild, EvaluationResult } from './evaluate'
import type { Piece } from './load'
import { mainStatOk } from './match'
import { currentValue } from './projection'
import { ROLL_TIERS } from './stats'
import type { ArtifactConfig, BuildConfig, SlotKey } from './types'
import { SLOTS } from './types'

// genshin_artifact_domains.json

export interface DomainInfo {
  domain: string
  region: string
  sets: string[]
}

export interface DomainsFile {
  version: string
  domains: DomainInfo[]
}

// Drop odds for 5★ pieces (community datamines).

export const MAIN_ODDS: Record<SlotKey, [string, number][]> = {
  flower: [['hp', 1]],
  plume: [['atk', 1]],
  sands: [['hp_', 0.2668], ['atk_', 0.2666], ['def_', 0.2666], ['enerRech_', 0.1], ['eleMas', 0.1]],
  goblet: [
    ['hp_', 0.1925],
    ['atk_', 0.1925],
    ['def_', 0.19],
    ['eleMas', 0.025],
    ...['pyro', 'electro', 'cryo', 'hydro', 'dendro', 'anemo', 'geo', 'physical'].map(
      (e): [string, number] => [`${e}_dmg_`, 0.05],
    ),
  ],
  circlet: [
    ['hp_', 0.22],
    ['atk_', 0.22],
    ['def_', 0.22],
    ['critRate_', 0.1],
    ['critDMG_', 0.1],
    ['heal_', 0.1],
    ['eleMas', 0.04],
  ],
}

/** Relative odds of each substat line; the main stat's own key is excluded when drawing. */
export const SUB_ODDS: [string, number][] = [
  ['hp', 6],
  ['atk', 6],
  ['def', 6],
  ['hp_', 4],
  ['atk_', 4],
  ['def_', 4],
  ['enerRech_', 4],
  ['eleMas', 4],
  ['critRate_', 3],
  ['critDMG_', 3],
]

/** Chance a piece starts with 4 lines: 20% from domains, 34% from the Strongbox (community figures). */
export const FOUR_LINE = { domain: 0.2, strongbox: 0.34 }

/** Sanctifying Elixirs per craft, by slot. */
export const ELIXIR_COST: Record<SlotKey, number> = { flower: 1, plume: 1, sands: 2, goblet: 4, circlet: 3 }

/** Since 5.5, at least this many of an elixir piece's upgrades land on its two chosen lines. */
const ELIXIR_GUARANTEED = 2

const DROP_SAMPLES = 40_000
const ELIXIR_SAMPLES = 2_000

/** Average 5★ drops per domain run (community figure); half of them are the set you want. */
export const DROPS_PER_RUN = 1.07
export const ON_SET_DROPS_PER_RUN = DROPS_PER_RUN / 2
/** Resin per domain run, and the amount domain gains are shown for (a full Original Resin bar). */
export const RESIN_PER_RUN = 20
export const RESIN_SHOWN = 200
/** Pieces from one full Strongbox batch: 39 five-star pieces in, 13 out. */
export const STRONGBOX_BATCH = 13

/** An Elixir craft has to add at least this much roll value to be worth suggesting. */
const MIN_ELIXIR_GAIN = 1
/** Domain runs you'd spend on a set anyway; an Elixir is credited only with what it adds beyond them. */
export const FARM_BUDGET_RUNS = 50
/** Upper bound when asking how many drops it takes to match a craft. */
export const MAX_DROPS = 5_000

/** A simulated piece already leveled to +20. `units` is each line's roll value (sum of roll tiers). */
export interface SimPiece {
  slot: SlotKey
  main: string
  keys: string[]
  units: number[]
}

function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface SimOptions {
  n: number
  seed: number
  fourLine: number
  slot?: SlotKey
  main?: string
  /** Lines picked up front (elixir crafting); they take the first positions. */
  chosen?: string[]
  guaranteed?: number
}

export function simulatePieces({ n, seed, fourLine, slot, main, chosen = [], guaranteed = 0 }: SimOptions): SimPiece[] {
  const rnd = mulberry32(seed)
  const pick = (opts: [string, number][]) => {
    let r = rnd() * opts.reduce((s, o) => s + o[1], 0)
    for (const o of opts) if ((r -= o[1]) <= 0) return o[0]
    return opts[opts.length - 1][0]
  }
  const tier = () => ROLL_TIERS[Math.floor(rnd() * ROLL_TIERS.length)]
  const out: SimPiece[] = []
  for (let i = 0; i < n; i++) {
    const s = slot ?? SLOTS[Math.floor(rnd() * SLOTS.length)]
    const m = main ?? pick(MAIN_ODDS[s])
    const keys = [...chosen]
    let pool = SUB_ODDS.filter(([k]) => k !== m && !keys.includes(k))
    while (keys.length < 4) {
      const k = pick(pool)
      keys.push(k)
      pool = pool.filter(([x]) => x !== k)
    }
    const units = keys.map(tier)
    // A 3-liner's first upgrade only adds its 4th line, so it gets 4 upgrades instead of 5.
    const hits = Array.from({ length: rnd() < fourLine ? 5 : 4 }, () => Math.floor(rnd() * 4))
    let short = chosen.length ? guaranteed - hits.filter((h) => h < chosen.length).length : 0
    for (let j = 0; short > 0 && j < hits.length; j++) {
      if (hits[j] < chosen.length) continue
      hits[j] = Math.floor(rnd() * chosen.length)
      short--
    }
    for (const h of hits) units[h] += tier()
    out.push({ slot: s, main: m, keys, units })
  }
  return out
}

const SUB_KEYS = SUB_ODDS.map(([k]) => k)

/** Simulated pieces packed by slot and main stat, so each build checks a main stat once per group. */
export interface SimPool {
  total: number
  groups: { slot: SlotKey; main: string; n: number; keys: Uint8Array; units: Float64Array }[]
}

export function packPool(pieces: SimPiece[]): SimPool {
  const bySlotMain = new Map<string, SimPiece[]>()
  for (const p of pieces) {
    const key = `${p.slot}|${p.main}`
    const list = bySlotMain.get(key) ?? []
    list.push(p)
    bySlotMain.set(key, list)
  }
  const groups = [...bySlotMain.values()].map((list) => {
    const keys = new Uint8Array(list.length * 4)
    const units = new Float64Array(list.length * 4)
    list.forEach((p, i) =>
      p.keys.forEach((k, j) => {
        keys[i * 4 + j] = SUB_KEYS.indexOf(k)
        units[i * 4 + j] = p.units[j]
      }),
    )
    return { slot: list[0].slot, main: list[0].main, n: list.length, keys, units }
  })
  return { total: pieces.length, groups }
}

const pools = new Map<string, SimPool>()

function cachedPool(key: string, make: () => SimPiece[]): SimPool {
  let p = pools.get(key)
  if (!p) pools.set(key, (p = packPool(make())))
  return p
}

/** Simulated +20 drops from a domain or the Strongbox, shared across calls. */
export const dropPool = (source: keyof typeof FOUR_LINE) =>
  cachedPool(source, () => simulatePieces({ n: DROP_SAMPLES, seed: source === 'domain' ? 1 : 2, fourLine: FOUR_LINE[source] }))

const elixirPool = (slot: SlotKey, main: string, chosen: string[]) =>
  cachedPool(`elixir|${slot}|${main}|${chosen.join(',')}`, () =>
    simulatePieces({ n: ELIXIR_SAMPLES, seed: 3, fourLine: 1, slot, main, chosen, guaranteed: ELIXIR_GUARANTEED }),
  )

export interface SlotOdds {
  chance: number
  gain: number
}

export interface UpgradeOdds {
  /** Chance one piece from the pool beats what's worn in its slot. */
  chance: number
  /** Expected improvement over what's worn, in roll-value units (0 when it doesn't beat it). */
  gain: number
  /** The same split by the slot the piece lands in; sums to the totals. */
  slots: Record<SlotKey, SlotOdds>
}

/** Odds that one random piece beats what the build wears. A null bar (nothing usable worn) counts as 0. */
export function upgradeOdds(build: BuildConfig, bars: Record<SlotKey, number | null>, pool: SimPool): UpgradeOdds {
  const slots = Object.fromEntries(SLOTS.map((s) => [s, { chance: 0, gain: 0 }])) as Record<SlotKey, SlotOdds>
  const w = SUB_KEYS.map((k) => build.substats[k] ?? 0)
  for (const g of pool.groups) {
    if (!mainStatOk(build, { slotKey: g.slot, mainStatKey: g.main })) continue
    const bar = bars[g.slot] ?? 0
    const { keys, units } = g
    let hits = 0
    let gain = 0
    for (let o = 0; o < g.n * 4; o += 4) {
      const v =
        w[keys[o]] * units[o] + w[keys[o + 1]] * units[o + 1] + w[keys[o + 2]] * units[o + 2] + w[keys[o + 3]] * units[o + 3]
      if (v > bar) {
        hits++
        gain += v - bar
      }
    }
    slots[g.slot].chance += hits / pool.total
    slots[g.slot].gain += gain / pool.total
  }
  let chance = 0
  let gain = 0
  for (const s of SLOTS) {
    chance += slots[s].chance
    gain += slots[s].gain
  }
  return { chance, gain, slots }
}

export type SetStatus =
  | { kind: 'listed'; set: string; tier: number }
  | { kind: 'unlisted'; set: string }
  | { kind: 'none' }

export function setStatus(worn: Record<string, number>, build: BuildConfig): SetStatus {
  const four = Object.keys(worn).find((s) => worn[s] >= 4)
  if (!four) return { kind: 'none' }
  const tiers = build.sets4.filter((s) => s.set === four).map((s) => s.tier)
  return tiers.length ? { kind: 'listed', set: four, tier: Math.min(...tiers) } : { kind: 'unlisted', set: four }
}

/** Sets worth farming for a build: the tier 1–2 set it already wears, else its best-tier sets. */
export function farmTargets(build: BuildConfig, status: SetStatus): string[] {
  if (status.kind === 'listed' && status.tier <= 2) return [status.set]
  const best = Math.min(...build.sets4.map((s) => s.tier))
  return build.sets4.filter((s) => s.tier === best).map((s) => s.set)
}

/** Set counts after swapping `incoming` in for `outgoing`. */
function swapSets(worn: Record<string, number>, outgoing: string | undefined, incoming: string): Record<string, number> {
  const after = { ...worn }
  if (outgoing) after[outgoing]--
  after[incoming] = (after[incoming] ?? 0) + 1
  return after
}

/** True when `after` still has every 2pc and 4pc bonus that `before` has. */
function keepsBonuses(before: Record<string, number>, after: Record<string, number>): boolean {
  return Object.entries(before).every(([set, n]) => {
    const left = after[set] ?? 0
    return !(n >= 4 && left < 4) && !(n >= 2 && left < 2)
  })
}

/** True when swapping `incoming` in for `outgoing` keeps every 2pc and 4pc bonus currently active. */
export function keepsSetBonuses(worn: Record<string, number>, outgoing: string | undefined, incoming: string): boolean {
  return keepsBonuses(worn, swapSets(worn, outgoing, incoming))
}

export type FarmScope = 'priority' | 'all'

export interface ElixirPick {
  char: string
  set: string
  slot: SlotKey
  main: string
  chosen: string[]
  /** Value of what the character wears in that slot (after free swaps); null if nothing usable. */
  from: number | null
  chance: number
  gain: number
  cost: number
  /** On-set domain drops it takes, on average, to expect an upgrade this big in this slot (MAX_DROPS if never). */
  drops: number
  /** Gain beyond what FARM_BUDGET_RUNS domain runs would likely bring that slot anyway. */
  extra: number
}

export interface CharacterFarm {
  char: string
  ref: ActiveBuild
  /** What each slot is worth now, counting free swaps; null if nothing usable is worn. */
  bars: Record<SlotKey, number | null>
  /** Per on-set piece from a domain. */
  odds: UpgradeOdds
  /** Per piece crafted in the Strongbox. */
  boxGain: number
  status: SetStatus
  targets: string[]
  /** Best tier 1–2 set the character could assemble from spares, when not already wearing one. */
  spares: { set: string; slots: number } | null
  kept: number
  elixir: ElixirPick | null
}

export interface Contribution {
  char: string
  set: string
  value: number
}

export interface SourceScore {
  key: string
  region?: string
  sets: string[]
  /** Summed expected gain per 5★ piece from this source, over the characters in scope. */
  value: number
  contributors: Contribution[]
}

export interface Swap {
  char: string
  ref: ActiveBuild
  slot: SlotKey
  piece: Piece
  from: number | null
  to: number
  /** Main stat of the piece it replaces, when different: substat scores don't weigh that trade. */
  mainFrom: string | null
  /** The character's total ER (%) before and after (counting their earlier swaps), and the build's minimum. */
  er: { from: number; to: number; need: number | null } | null
}

export interface FarmPlan {
  /** Every active character, biggest expected gain first. */
  characters: CharacterFarm[]
  /** Scope actually used: falls back to all active when no character is ★ Priority. */
  scope: FarmScope
  domains: SourceScore[]
  strongbox: SourceScore[]
  elixirs: ElixirPick[]
  swaps: Swap[]
  /** Slots whose best swap was held back because it would drop the character's ER below their build's minimum. */
  erHeld: number
  /** Sets some in-scope character farms for that no domain drops. */
  noDomain: string[]
  /** Sets some in-scope character farms for that the Strongbox can't make. */
  noStrongbox: string[]
}

/** A swap has to beat the worn piece by at least this much roll value to be worth listing. */
const MIN_SWAP_GAIN = 0.5

/**
 * The sets the in-game Strongbox offered as of 7.2. Newer sets join it a few versions after release, so a set
 * missing here counts as not craftable; when the game adds some, tick them in the Farm tab.
 */
export const STRONGBOX_SETS = [
  'ArchaicPetra',
  'BlizzardStrayer',
  'BloodstainedChivalry',
  'CrimsonWitchOfFlames',
  'DeepwoodMemories',
  'DesertPavilionChronicle',
  'EchoesOfAnOffering',
  'EmblemOfSeveredFate',
  'FinaleOfTheDeepGalleries',
  'FlowerOfParadiseLost',
  'FragmentOfHarmonicWhimsy',
  'GildedDreams',
  'GladiatorsFinale',
  'GoldenTroupe',
  'HeartOfDepth',
  'HuskOfOpulentDreams',
  'Lavawalker',
  'LongNightsOath',
  'MaidenBeloved',
  'MarechausseeHunter',
  'NightOfTheSkysUnveiling',
  'NighttimeWhispersInTheEchoingWoods',
  'NoblesseOblige',
  'NymphsDream',
  'ObsidianCodex',
  'OceanHuedClam',
  'PaleFlame',
  'RetracingBolide',
  'ScrollOfTheHeroOfCinderCity',
  'ShimenawasReminiscence',
  'SilkenMoonsSerenade',
  'SongOfDaysPast',
  'TenacityOfTheMillelith',
  'ThunderingFury',
  'Thundersoother',
  'UnfinishedReverie',
  'VermillionHereafter',
  'ViridescentVenerer',
  'VourukashasGlow',
  'WanderersTroupe',
]

export function planFarming(
  result: EvaluationResult,
  pieces: Piece[],
  config: ArtifactConfig,
  domains: DomainsFile | null,
  scope: FarmScope,
  er: ErModel | null = null,
  /** Sets the Strongbox can make; null counts every set. */
  strongboxSets: Set<string> | null = null,
): FarmPlan {
  const { worn, equipped, barsOf, current } = wearing(result, pieces)
  const summaries = new Map(result.characters.map((c) => [c.char, c]))
  const spares = pieces.filter((p) => !p.owner && p.rarity === 5 && p.level === 20)

  // 1. Free upgrades come first, so new pieces are judged against what the character could wear today.
  const { swaps, erHeld } = freeSwaps(current, spares, worn, equipped, barsOf, er)
  const swapIn = new Map(swaps.map((s) => [`${s.char}|${s.slot}`, s.piece]))
  const barsAfterSwaps = (ref: ActiveBuild) => {
    const bars = barsOf(ref)
    for (const slot of SLOTS) {
      const p = swapIn.get(`${ref.char}|${slot}`)
      if (p && mainStatOk(ref.build, p)) bars[slot] = Math.max(bars[slot] ?? 0, currentValue(p, ref.build.substats))
    }
    return bars
  }

  // 2. What one on-set domain piece is worth to each character.
  const characters: CharacterFarm[] = current.map((ref) => {
    const bars = barsAfterSwaps(ref)
    const odds = upgradeOdds(ref.build, bars, dropPool('domain'))
    const wornSets = worn.get(ref.char) ?? {}
    const status = setStatus(wornSets, ref.build)
    const targets = farmTargets(ref.build, status)
    return {
      char: ref.char,
      ref,
      bars,
      odds,
      boxGain: upgradeOdds(ref.build, bars, dropPool('strongbox')).gain,
      status,
      targets,
      spares: status.kind === 'listed' && status.tier <= 2 ? null : spareCoverage(ref, spares, pieces),
      kept: summaries.get(ref.char)?.kept ?? 0,
      elixir: elixirPick(ref, bars, targets[0]),
    }
  })
  characters.sort((a, b) => b.odds.gain - a.odds.gain)

  // 3. Rank sources for the characters in scope.
  const anyPriority = characters.some((c) => c.ref.priority === 'priority')
  const used: FarmScope = scope === 'priority' && anyPriority ? 'priority' : 'all'
  const inScope = characters.filter((c) => used === 'all' || c.ref.priority === 'priority')

  const score = (key: string, sets: string[], per: (c: CharacterFarm) => number, region?: string): SourceScore => {
    const contributors: Contribution[] = []
    for (const c of inScope) {
      for (const set of sets) {
        if (!c.targets.includes(set)) continue
        // A domain splits its drops evenly between its sets; a character farming two sets splits its need.
        contributors.push({ char: c.char, set, value: per(c) / sets.length / c.targets.length })
      }
    }
    contributors.sort((a, b) => b.value - a.value)
    return { key, region, sets, value: contributors.reduce((s, x) => s + x.value, 0), contributors }
  }
  const byValue = (a: SourceScore, b: SourceScore) => b.value - a.value

  const domainList = domains?.domains ?? []
  const domainScores = domainList.map((d) => score(d.domain, d.sets, (c) => c.odds.gain, d.region)).sort(byValue)
  const craftable = (set: string) => !strongboxSets || strongboxSets.has(set)
  const strongbox = Object.keys(config.sets)
    .filter(craftable)
    .map((set) => score(set, [set], (c) => c.boxGain))
    .filter((s) => s.value > 0)
    .sort(byValue)
  const inDomain = new Set(domainList.flatMap((d) => d.sets))
  const wanted = [...new Set(inScope.flatMap((c) => c.targets))].sort()
  const noDomain = wanted.filter((s) => !inDomain.has(s))
  const noStrongbox = wanted.filter((s) => !craftable(s))

  const elixirs = inScope
    .map((c) => c.elixir)
    .filter((e): e is ElixirPick => !!e)
    .sort((a, b) => b.extra / b.cost - a.extra / a.cost || b.gain - a.gain)

  return {
    characters,
    scope: used,
    domains: domainScores,
    strongbox,
    elixirs,
    swaps,
    erHeld,
    noDomain,
    noStrongbox,
  }
}

export interface Wearing {
  /** Set counts each character wears. */
  worn: Map<string, Record<string, number>>
  /** Equipped piece by `${char}|${slot}`. */
  equipped: Map<string, Piece>
  /** What each slot is worth to a build; null if nothing usable is worn. */
  barsOf: (ref: ActiveBuild) => Record<SlotKey, number | null>
  /** One build per active character: the one they're wearing (see currentBuilds). */
  current: ActiveBuild[]
}

/** What every active character has on, judged by the build they're actually running. */
export function wearing(result: EvaluationResult, pieces: Piece[]): Wearing {
  const worn = new Map<string, Record<string, number>>()
  const equipped = new Map<string, Piece>()
  for (const p of pieces) {
    if (!p.owner) continue
    const sets = worn.get(p.owner) ?? {}
    sets[p.setKey] = (sets[p.setKey] ?? 0) + 1
    worn.set(p.owner, sets)
    equipped.set(`${p.owner}|${p.slotKey}`, p)
  }
  const summaries = new Map(result.characters.map((c) => [c.char, c]))
  const barsOf = (ref: ActiveBuild) => {
    const slots = summaries.get(ref.char)!.builds.find((b) => b.idx === ref.buildIdx)!.slots
    return Object.fromEntries(SLOTS.map((s) => [s, slots[s].value])) as Record<SlotKey, number | null>
  }
  return { worn, equipped, barsOf, current: currentBuilds(result.activeBuilds, worn, barsOf) }
}

/**
 * Each character's build that matches what they wear: its 4pc set is the one worn, then the most slots
 * with an acceptable main stat, then the highest value. Characters with nothing on get their first build.
 */
export function currentBuilds(
  activeBuilds: ActiveBuild[],
  worn: Map<string, Record<string, number>>,
  barsOf: (ref: ActiveBuild) => Record<SlotKey, number | null>,
): ActiveBuild[] {
  const top = new Map<string, { ref: ActiveBuild; score: number[] }>()
  for (const ref of activeBuilds) {
    const bars = Object.values(barsOf(ref))
    const sets = worn.get(ref.char) ?? {}
    const score = [
      Number(ref.build.sets4.some((s) => (sets[s.set] ?? 0) >= 4)),
      bars.filter((b) => b !== null).length,
      bars.reduce<number>((s, b) => s + (b ?? 0), 0),
    ]
    const prev = top.get(ref.char)
    if (!prev || compareScores(score, prev.score) > 0) top.set(ref.char, { ref, score })
  }
  return [...top.values()].map((t) => t.ref)
}

/** Lexicographic: the first differing entry decides. */
function compareScores(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

/**
 * The best Sanctifying Elixir craft for a build: slot, main stat and its two top-weighted lines. Crafts are
 * scored by the gain they add beyond what FARM_BUDGET_RUNS of domain runs would likely give that slot, per
 * Elixir, so an easy-to-farm plume loses to a rare goblet.
 */
function elixirPick(ref: ActiveBuild, bars: Record<SlotKey, number | null>, set: string | undefined): ElixirPick | null {
  let pick: ElixirPick | null = null
  for (const craft of Object.values(elixirCrafts(ref, bars, set))) {
    if (!craft || craft.gain < MIN_ELIXIR_GAIN || craft.extra <= 0) continue
    if (!pick || craft.extra / craft.cost > pick.extra / pick.cost) pick = craft
  }
  return pick
}

/**
 * Per slot, the Elixir craft that gains most: the best of the main stats the build allows. All null when there's
 * no set to craft (a build without 4pc sets).
 */
export function elixirCrafts(
  ref: ActiveBuild,
  bars: Record<SlotKey, number | null>,
  set: string | undefined,
): Record<SlotKey, ElixirPick | null> {
  const out = {} as Record<SlotKey, ElixirPick | null>
  if (!set) {
    for (const slot of SLOTS) out[slot] = null
    return out
  }
  const w = ref.build.substats
  const farmed = gainHistograms(ref.build, bars, dropPool('domain'))
  const budget = Math.round(FARM_BUDGET_RUNS * ON_SET_DROPS_PER_RUN)
  for (const slot of SLOTS) {
    let best: { main: string; chosen: string[]; odds: UpgradeOdds } | null = null
    for (const [main] of MAIN_ODDS[slot]) {
      if (!mainStatOk(ref.build, { slotKey: slot, mainStatKey: main })) continue
      const chosen = SUB_ODDS.map(([k]) => k)
        .filter((k) => k !== main && (w[k] ?? 0) > 0)
        .sort((a, b) => w[b] - w[a])
        .slice(0, 2)
      const odds = upgradeOdds(ref.build, bars, elixirPool(slot, main, chosen))
      if (!best || odds.gain > best.odds.gain) best = { main, chosen, odds }
    }
    out[slot] = best && {
      char: ref.char,
      set,
      slot,
      main: best.main,
      chosen: best.chosen,
      from: bars[slot],
      chance: best.odds.chance,
      gain: best.odds.gain,
      extra: best.odds.gain - expectedBestOf(farmed[slot], budget),
      cost: ELIXIR_COST[slot],
      drops: dropsToMatch(farmed[slot], best.odds.gain),
    }
  }
  return out
}

const HIST_STEP = 0.05
const HIST_BINS = 400

/** Per slot: how often one random piece improves on what's worn, binned by gain (bin b ≈ b × HIST_STEP). */
export interface GainHistogram {
  total: number
  counts: Float64Array
}

export function gainHistograms(
  build: BuildConfig,
  bars: Record<SlotKey, number | null>,
  pool: SimPool,
): Record<SlotKey, GainHistogram> {
  const out = Object.fromEntries(
    SLOTS.map((s) => [s, { total: pool.total, counts: new Float64Array(HIST_BINS + 1) }]),
  ) as Record<SlotKey, GainHistogram>
  const w = SUB_KEYS.map((k) => build.substats[k] ?? 0)
  for (const g of pool.groups) {
    if (!mainStatOk(build, { slotKey: g.slot, mainStatKey: g.main })) continue
    const bar = bars[g.slot] ?? 0
    const { keys, units } = g
    const counts = out[g.slot].counts
    for (let o = 0; o < g.n * 4; o += 4) {
      const v =
        w[keys[o]] * units[o] + w[keys[o + 1]] * units[o + 1] + w[keys[o + 2]] * units[o + 2] + w[keys[o + 3]] * units[o + 3]
      if (v > bar) counts[Math.min(HIST_BINS, Math.ceil((v - bar) / HIST_STEP))]++
    }
  }
  return out
}

/** Expected improvement from the best of n pieces: Σ step × P(the best one gains at least that step). */
export function expectedBestOf(h: GainHistogram, n: number): number {
  let above = 0
  let sum = 0
  for (let b = HIST_BINS; b >= 1; b--) {
    above += h.counts[b]
    if (above > 0) sum += HIST_STEP * (1 - Math.pow(1 - above / h.total, n))
  }
  return sum
}

/** Fewest pieces whose expected best improvement reaches `target`; MAX_DROPS if it never does. */
export function dropsToMatch(h: GainHistogram, target: number): number {
  if (expectedBestOf(h, MAX_DROPS) < target) return MAX_DROPS
  let lo = 1
  let hi = 1
  while (expectedBestOf(h, hi) < target) hi *= 2
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (expectedBestOf(h, mid) >= target) hi = mid
    else lo = mid + 1
  }
  return lo
}

/** Best tier 1–2 set by how many slots the character could fill from spares and their own pieces. */
function spareCoverage(ref: ActiveBuild, spares: Piece[], pieces: Piece[]): { set: string; slots: number } | null {
  let top: { set: string; slots: number } | null = null
  for (const { set, tier } of ref.build.sets4) {
    if (tier > 2) continue
    const slots = new Set<SlotKey>()
    for (const p of [...spares, ...pieces.filter((x) => x.owner === ref.char)]) {
      if (p.setKey === set && p.rarity === 5 && mainStatOk(ref.build, p)) slots.add(p.slotKey)
    }
    if (!top || slots.size > top.slots) top = { set, slots: slots.size }
  }
  return top
}

/**
 * Spare +20s that beat what an active character wears without breaking a set bonus; each used once. A swap
 * that would take the character's ER below their build's minimum (and lower than it is now) is held back.
 */
function freeSwaps(
  builds: ActiveBuild[],
  spares: Piece[],
  worn: Map<string, Record<string, number>>,
  equipped: Map<string, Piece>,
  barsOf: (ref: ActiveBuild) => Record<SlotKey, number | null>,
  er: ErModel | null,
): { swaps: Swap[]; erHeld: number } {
  const options: Swap[] = []
  for (const ref of builds) {
    const bars = barsOf(ref)
    const wornSets = worn.get(ref.char) ?? {}
    for (const piece of spares) {
      if (!mainStatOk(ref.build, piece)) continue
      const from = bars[piece.slotKey]
      const to = currentValue(piece, ref.build.substats)
      if (to - (from ?? 0) < MIN_SWAP_GAIN) continue
      const outgoing = equipped.get(`${ref.char}|${piece.slotKey}`)
      if (!keepsSetBonuses(wornSets, outgoing?.setKey, piece.setKey)) continue
      const mainFrom = outgoing && outgoing.mainStatKey !== piece.mainStatKey ? outgoing.mainStatKey : null
      options.push({ char: ref.char, ref, slot: piece.slotKey, piece, from, to, mainFrom, er: null })
    }
  }
  // ★ Priority characters pick first, biggest gain first; the list keeps that order.
  const gain = (s: Swap) => s.to - (s.from ?? 0)
  const starred = (s: Swap) => Number(s.ref.priority === 'priority')
  options.sort((a, b) => starred(b) - starred(a) || gain(b) - gain(a))
  const usedPieces = new Set<string>()
  const usedSlots = new Set<string>()
  const held = new Set<string>()
  // What each character wears once their earlier swaps are made.
  const wearingNow = new Map<string, Map<SlotKey, Piece>>()
  const wornBy = (char: string) => {
    let m = wearingNow.get(char)
    if (!m) wearingNow.set(char, (m = new Map(SLOTS.flatMap((s) => equipped.get(`${char}|${s}`) ?? []).map((p) => [p.slotKey, p]))))
    return m
  }
  // Set counts once each character's earlier swaps are made: two swaps that are each safe can break a bonus together.
  const setsNow = new Map<string, Record<string, number>>()
  const out: Swap[] = []
  for (const s of options) {
    const slotKey = `${s.char}|${s.slot}`
    if (usedPieces.has(s.piece.id) || usedSlots.has(slotKey)) continue
    const now = wornBy(s.char)
    const before = worn.get(s.char) ?? {}
    const sets = swapSets(setsNow.get(s.char) ?? before, now.get(s.slot)?.setKey, s.piece.setKey)
    if (!keepsBonuses(before, sets)) continue
    const from = totalER(er, s.char, [...now.values()])
    const to = totalER(er, s.char, [...new Map(now).set(s.slot, s.piece).values()])
    const need = erNeed(s.ref.build)
    if (from !== null && to !== null && need !== null && to < from - 0.05 && to < need - 0.05) {
      held.add(slotKey)
      continue
    }
    usedPieces.add(s.piece.id)
    usedSlots.add(slotKey)
    now.set(s.slot, s.piece)
    setsNow.set(s.char, sets)
    out.push({ ...s, er: from !== null && to !== null ? { from, to, need } : null })
  }
  return { swaps: out, erHeld: [...held].filter((k) => !usedSlots.has(k)).length }
}
