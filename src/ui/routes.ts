// Hash routes: #tab, #tab/arg (#improve/Columbina), the Builds tab's #builds/<char>/<build>?piece=<id>, and the
// Artifacts tab's #artifacts/<grid|list>?set=<set>&piece=<id>. The old list tabs (#triage, #progress, #review,
// #level) and #inventory?piece=<id> still open the Artifacts tab, filtered as they were.

/** How the Artifacts tab shows a set: the game's inventory grid, or cards. */
export type ArtifactsView = 'grid' | 'list'
/** What the list shows: lock changes still to make, the Level up queue, or every piece. */
export type ShowFilter = 'changes' | 'level' | 'all'
/** Which levels the list shows: +20 means unequipped +20s. */
export type LevelFilter = 'any' | 'fresh' | 'started' | 'spare20'

/** What an #artifacts link (or an old tab's) asks for; `key` changes each time a link is followed. */
export interface ArtifactsRoute {
  view?: ArtifactsView
  set?: string
  piece?: string
  show?: ShowFilter
  level?: LevelFilter
  key: string
}

/** The Characters tab's views besides one character's: the board, the free upgrades, and who counts. */
export type CharactersView = 'board' | 'quick' | 'roster'
const CHARACTER_VIEWS: CharactersView[] = ['board', 'quick', 'roster']

/** What a #characters link asks for: a view, or one character (`char`); neither means where you last were. */
export interface CharactersRoute {
  view?: CharactersView
  char?: string
  key: string
}

/** The Characters tab: #characters/board, /quick, /roster, or #characters/<char> for one character. */
export const charactersHref = (to: CharactersView | { char: string }) =>
  `#characters/${typeof to === 'string' ? to : encodeURIComponent(to.char)}`

/** The Characters tab's route, including the Roster and Improve tabs' old links. */
export function charactersRoute(hash: string, n: number): CharactersRoute {
  const { tab, args } = parseHash(hash)
  const key = `${n}:${hash}`
  if (tab === 'roster') return { view: 'roster', key }
  const arg = args[0]
  if (!arg) return { key }
  if (tab !== 'improve' && CHARACTER_VIEWS.includes(arg as CharactersView)) return { view: arg as CharactersView, key }
  return { char: arg, key }
}

/** What the Spend tab ranks: where resin, Strongbox crafts, Elixirs, Dust and fodder do most. */
export type Resource = 'resin' | 'strongbox' | 'elixir' | 'dust' | 'fodder'
export const RESOURCES: Resource[] = ['resin', 'strongbox', 'elixir', 'dust', 'fodder']

export const spendHref = (resource: Resource) => `#spend/${resource}`

/** The resource a #spend link (or the Farm and Reroll tabs' old links) asks for; none means the last one. */
export function spendRoute(hash: string): Resource | undefined {
  const { tab, args } = parseHash(hash)
  if (tab === 'reroll') return 'dust'
  if (tab === 'farm') return args[0] && RESOURCES.includes(args[0] as Resource) ? (args[0] as Resource) : undefined
  return RESOURCES.includes(args[0] as Resource) ? (args[0] as Resource) : undefined
}

/** Fired when a page keeps its state in the URL with `replaceHash`, so the app knows where Back links should go. */
export const HASH_REPLACED = 'art-critic:hash-replaced'

/** Puts a page's state in the URL without a history entry: Back still leaves the tab, and returns to it as it was. */
export function replaceHash(href: string) {
  if (location.hash === href) return
  history.replaceState(history.state, '', href)
  window.dispatchEvent(new Event(HASH_REPLACED))
}

/** The tabs the Artifacts list replaced, as its filters. */
export const LEGACY_LISTS: Record<string, { show: ShowFilter; level: LevelFilter }> = {
  triage: { show: 'changes', level: 'fresh' },
  progress: { show: 'changes', level: 'started' },
  review: { show: 'changes', level: 'spare20' },
  level: { show: 'level', level: 'any' },
}

const SHOWS: ShowFilter[] = ['changes', 'level', 'all']
const LEVELS: LevelFilter[] = ['any', 'fresh', 'started', 'spare20']
const pickOf = <T extends string>(list: T[], v: string | null | undefined): T | undefined =>
  list.includes(v as T) ? (v as T) : undefined

/** The Artifacts tab at a view, set or piece (opened in the inspector), or with the list filtered. */
export function artifactsHref(to: Omit<ArtifactsRoute, 'key'>): string {
  const q = new URLSearchParams()
  if (to.set) q.set('set', to.set)
  if (to.piece) q.set('piece', to.piece)
  if (to.show) q.set('show', to.show)
  if (to.level) q.set('level', to.level)
  const qs = q.toString()
  return `#artifacts${to.view ? `/${to.view}` : ''}${qs ? `?${qs}` : ''}`
}

/** What an Artifacts link asks for, including the old tabs' links; `n` counts links followed, so the same one twice counts. */
export function artifactsRoute(hash: string, n: number): ArtifactsRoute {
  const { tab, args, query } = parseHash(hash)
  const key = `${n}:${hash}`
  const legacy = LEGACY_LISTS[tab]
  if (legacy) return { view: 'list', ...legacy, key }
  const piece = query.get('piece') ?? undefined
  if (tab === 'inventory') return { view: 'grid', piece, key }
  return {
    view: pickOf<ArtifactsView>(['grid', 'list'], args[0]),
    set: query.get('set') ?? undefined,
    piece,
    show: pickOf(SHOWS, query.get('show')),
    level: pickOf(LEVELS, query.get('level')),
    key,
  }
}

/** What a #builds link points at: a character's build, and a piece to show Closest build for. */
export interface BuildsFocus {
  char?: string
  idx?: number
  piece?: string
  /** The whole hash, so following the same link again re-selects. */
  key: string
}

export function parseHash(hash: string): { tab: string; args: string[]; query: URLSearchParams } {
  const [path, query = ''] = hash.replace(/^#/, '').split('?')
  const [tab, ...args] = path.split('/')
  return { tab, args: args.map(decode), query: new URLSearchParams(query) }
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** The Builds tab at a character's build; with `piece`, Closest build for that piece (at its closest build without `char`). */
export function buildsHref(to: { piece?: string; char?: string; idx?: number }): string {
  let path = '#builds'
  if (to.char) path += `/${encodeURIComponent(to.char)}${to.idx ? `/${to.idx}` : ''}`
  return to.piece ? `${path}?${new URLSearchParams({ piece: to.piece })}` : path
}

/** The Artifacts grid at a piece: its set, scrolled to the piece and outlined, open in the inspector. */
export function inventoryHref(piece: string): string {
  return artifactsHref({ view: 'grid', piece })
}

export function buildsFocus(hash: string): BuildsFocus {
  const { args, query } = parseHash(hash)
  const idx = Number(args[1])
  return {
    char: args[0] || undefined,
    idx: Number.isInteger(idx) && idx >= 0 ? idx : undefined,
    piece: query.get('piece') ?? undefined,
    key: hash,
  }
}
