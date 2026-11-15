// Hash routes: #tab, #tab/arg (#improve/Columbina), the Builds tab's #builds/<char>/<build>?piece=<id>, and the
// Inventory tab's #inventory?piece=<id>.

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

/** The Inventory tab at a piece: its set's grid, scrolled to the piece and outlined. */
export function inventoryHref(piece: string): string {
  return `#inventory?${new URLSearchParams({ piece })}`
}

/** The piece an #inventory link points at, with the whole hash so following the same link again re-selects. */
export function inventoryFocus(hash: string): { piece?: string; key: string } {
  return { piece: parseHash(hash).query.get('piece') ?? undefined, key: hash }
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
