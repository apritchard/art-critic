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
