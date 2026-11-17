import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { applyOverrides, type BuildOverrides } from '../engine/builds'
import { erModel, type ErModel, type GameData } from '../engine/er'
import { defaultRosterEntry, defaultSettings } from '../engine/evaluate'
import { STRONGBOX_SETS, type DomainsFile } from '../engine/farm'
import { addEquip, applyEquips, loadPieces, parseExport, type Equip, type Piece } from '../engine/load'
import type { ArtifactConfig, BuildConfig, GoodExport, Roster, RosterEntry, Settings } from '../engine/types'
import { LoadExportButton } from '../ui/LoadExportButton'

/** 'gain' and 'value' are the To level list's only: they need a piece worth leveling. */
export type SortMode = 'newest' | 'oldest' | 'level' | 'slot' | 'verdict' | 'chance' | 'gain' | 'value'

interface PersistedState {
  settings?: Partial<Settings>
  roster?: Roster
  /** Builds edited in the Builds tab, per character. */
  builds?: BuildOverrides
  /** Done marks per export file name → piece ids. */
  done?: Record<string, string[]>
  /**
   * Modified time of each export when its done marks and equips were made. A file saved over an export with the
   * same name is a new export, so its marks start clean.
   */
  exportMtimes?: Record<string, number>
  /** Sets the Strongbox can make, once edited in the Farm tab (otherwise a guess from the domains file). */
  strongbox?: string[]
  /** Equips made in-game since each export, by export file name, in order. */
  equips?: Record<string, Equip[]>
  sort?: SortMode
  /** Characters on the Building list (who the user is working on now), in the order they were added. */
  building?: string[]
}

interface ExportInfo {
  name: string
  mtime: number
}

interface Store {
  /** The config with the user's build edits applied; what everything is judged by. */
  config: ArtifactConfig
  /** genshin_artifact_config.json as written. */
  baseConfig: ArtifactConfig
  overrides: BuildOverrides
  /** Replaces a character's builds; null goes back to the config's. */
  setCharacterBuilds: (char: string, builds: BuildConfig[] | null) => void
  /** genshin_artifact_domains.json, if present. */
  domains: DomainsFile | null
  /** Each character's ER from weapon and ascension; null without game data. */
  er: ErModel | null
  /** Sets the Strongbox can make; null when unknown (every set counts). */
  strongboxSets: Set<string> | null
  /** True once the Strongbox list has been edited. */
  strongboxEdited: boolean
  /** Saves the Strongbox list; null goes back to the guess. */
  setStrongboxSets: (sets: string[] | null) => void
  exports: ExportInfo[]
  exportName: string
  data: GoodExport
  /** Every piece, with the equips made since the export applied. */
  pieces: Piece[]
  /** Pieces exactly as exported. */
  exportPieces: Piece[]
  /** Equips made since this export, oldest first. */
  equips: Equip[]
  /** Records that a piece is now on a character (swapping with whoever wore it). */
  equip: (piece: string, char: string) => void
  /** Forgets the recorded equip at this position in `equips`. */
  undoEquip: (at: number) => void
  /** Why the last save failed, while edits are waiting to be saved; null when everything is saved. */
  saveError: string | null
  settings: Settings
  roster: Roster
  /** The Building list: characters sorted first everywhere, and what farming can be ranked for. */
  building: string[]
  /** Adds a character to the Building list or takes them off; adding an Ignored character sets them to Normal. */
  toggleBuilding: (char: string, on?: boolean) => void
  done: Set<string>
  sort: SortMode
  /** An export that appeared in imports/ (or changed there) since this one was loaded; null once it's loaded. */
  newExport: string | null
  updateSettings: (patch: Partial<Settings>) => void
  resetSettings: () => void
  setRosterEntry: (char: string, patch: Partial<RosterEntry>, fallback: RosterEntry) => void
  setRoster: (roster: Roster) => void
  toggleDone: (id: string, value?: boolean) => void
  setSort: (sort: SortMode) => void
  selectExport: (name: string) => Promise<void>
  refreshExports: () => Promise<void>
  /** Copies an export from anywhere on this machine into imports/, then loads it. Throws if it can't be copied. */
  loadExportFile: (file: File) => Promise<void>
}

const StoreContext = createContext<Store | null>(null)

export function useStore(): Store {
  const s = useContext(StoreContext)
  if (!s) throw new Error('useStore outside StoreProvider')
  return s
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return res.json() as Promise<T>
}

/** Copies an export file the user picked into imports/ and returns the name it has there (see saveExport). */
export async function uploadExport(file: File): Promise<string> {
  const url = `/api/exports/${encodeURIComponent(file.name)}?modified=${file.lastModified}`
  const res = await fetch(url, { method: 'POST', body: file })
  const body = (await res.json().catch(() => ({}))) as { name?: string; error?: string }
  if (!res.ok || !body.name) throw new Error(body.error ?? `Couldn't copy ${file.name} into imports/: the server answered ${res.status}.`)
  return body.name
}

type Loaded = {
  config: ArtifactConfig
  domains: DomainsFile | null
  gameData: GameData | null
  exports: ExportInfo[]
  exportName: string
  data: GoodExport
  persisted: PersistedState
}

/** Everything the page needs, or null when imports/ has no export yet. */
async function loadAll(): Promise<Loaded | null> {
  const [config, domains, gameData, exports, persisted] = await Promise.all([
    getJson<ArtifactConfig>('/api/config'),
    getJson<DomainsFile>('/api/domains').catch(() => null),
    getJson<GameData>('/api/game-data').catch(() => null),
    getJson<ExportInfo[]>('/api/exports'),
    getJson<PersistedState>('/api/state'),
  ])
  if (!exports.length) return null
  const exportName = exports[0].name
  const data = parseExport(await getJson<unknown>(`/api/exports/${encodeURIComponent(exportName)}`), exportName)
  return { config, domains, gameData, exports, exportName, data, persisted }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** True while imports/ has no export, so there's nothing to show but the Load export button. */
  const [empty, setEmpty] = useState(false)
  const [persisted, setPersisted] = useState<PersistedState>({})
  // With its modified time, so the copy just loaded doesn't announce itself as new (see `newExport` below).
  const [newExport, setNewExport] = useState<{ name: string; mtime?: number } | null>(null)

  const start = useCallback(
    () =>
      loadAll()
        .then((l) => {
          setEmpty(!l)
          if (!l) return
          setLoaded(l)
          setPersisted(l.persisted)
        })
        .catch((e) => setError(String(e.message ?? e))),
    [],
  )
  useEffect(() => {
    start()
  }, [start])

  // Persist edits, debounced. A failed save is retried and shown in the header; leaving the page saves at once.
  const lastSaved = useRef<string | null>(null)
  const unsaved = useRef<string | null>(null)
  const retry = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [saveError, setSaveError] = useState<string | null>(null)
  const save = useCallback(async (json: string) => {
    clearTimeout(retry.current)
    try {
      const res = await fetch('/api/state', { method: 'PUT', body: json })
      if (!res.ok) throw new Error(`the server answered ${res.status}`)
      lastSaved.current = json
      if (unsaved.current === json) unsaved.current = null
      setSaveError(null)
    } catch (e) {
      if (unsaved.current === null) return // a later save already went through
      setSaveError(e instanceof Error ? e.message : String(e))
      retry.current = setTimeout(() => unsaved.current && save(unsaved.current), 5000)
    }
  }, [])
  useEffect(() => {
    if (!loaded) return
    const json = JSON.stringify(persisted)
    // The first run just records what was loaded; only real edits are written back.
    if (lastSaved.current === null) lastSaved.current = JSON.stringify(loaded.persisted)
    if (json === lastSaved.current) {
      unsaved.current = null
      return
    }
    unsaved.current = json
    const t = setTimeout(() => save(json), 400)
    return () => clearTimeout(t)
  }, [persisted, loaded, save])
  useEffect(() => {
    // Closing or reloading the page inside the debounce, or while saves are failing, would lose the last edits.
    const flush = () => {
      const json = unsaved.current
      if (json) fetch('/api/state', { method: 'PUT', body: json, keepalive: json.length < 60_000 }).catch(() => {})
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [])

  useEffect(() => {
    if (!import.meta.hot) return
    const onChange = (payload: { name: string; mtime?: number }) => setNewExport(payload)
    import.meta.hot.on('art-critic:exports-changed', onChange)
    // The dev server refreshed the weapon/ascension data in the background.
    const onGameData = () =>
      getJson<GameData>('/api/game-data')
        .then((gameData) => setLoaded((l) => (l ? { ...l, gameData } : l)))
        .catch(() => {})
    import.meta.hot.on('art-critic:game-data-changed', onGameData)
    return () => {
      import.meta.hot?.off('art-critic:exports-changed', onChange)
      import.meta.hot?.off('art-critic:game-data-changed', onGameData)
    }
  }, [])

  const selectExport = useCallback(async (name: string) => {
    try {
      const [raw, exports] = await Promise.all([
        getJson<unknown>(`/api/exports/${encodeURIComponent(name)}`),
        getJson<ExportInfo[]>('/api/exports'),
      ])
      const data = parseExport(raw, name)
      setLoaded((l) => (l ? { ...l, data, exportName: name, exports } : l))
      setNewExport(null)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // A file saved over an export with the same name is a new export: its done marks and equips start clean.
  const exportMtime = loaded?.exports.find((e) => e.name === loaded.exportName)?.mtime
  useEffect(() => {
    if (!loaded || exportMtime === undefined) return
    const name = loaded.exportName
    setPersisted((p) => {
      const seen = p.exportMtimes?.[name]
      if (seen === exportMtime) return p
      const next: PersistedState = { ...p, exportMtimes: { ...p.exportMtimes, [name]: exportMtime } }
      if (seen !== undefined) {
        next.done = { ...p.done }
        next.equips = { ...p.equips }
        delete next.done[name]
        delete next.equips[name]
      }
      return next
    })
  }, [loaded?.exportName, exportMtime])

  const refreshExports = useCallback(async () => {
    const exports = await getJson<ExportInfo[]>('/api/exports')
    if (exports.length) await selectExport(exports[0].name)
  }, [selectExport])

  const loadExportFile = useCallback(async (file: File) => selectExport(await uploadExport(file)), [selectExport])
  // The watcher reports the copy a moment after it's loaded; it's only new if it differs from what's on screen.
  const unseenExport =
    newExport && !(loaded && newExport.name === loaded.exportName && newExport.mtime === exportMtime) ? newExport.name : null

  // Kept separate so marking pieces done doesn't re-run the evaluation.
  const exportPieces = useMemo(() => (loaded ? loadPieces(loaded.data) : []), [loaded?.data])
  const equipList = loaded ? persisted.equips?.[loaded.exportName] : undefined
  const equips = useMemo(() => equipList ?? [], [equipList])
  const pieces = useMemo(() => applyEquips(exportPieces, equips), [exportPieces, equips])
  const settings = useMemo(
    () => (loaded ? { ...defaultSettings(loaded.config), ...persisted.settings } : null),
    [loaded?.config, persisted.settings],
  )
  const roster = useMemo(() => persisted.roster ?? {}, [persisted.roster])
  const overrides = useMemo(() => persisted.builds ?? {}, [persisted.builds])
  const building = useMemo(() => persisted.building ?? [], [persisted.building])
  const config = useMemo(() => (loaded ? applyOverrides(loaded.config, overrides) : null), [loaded?.config, overrides])
  const strongboxSets = useMemo(() => new Set(persisted.strongbox ?? STRONGBOX_SETS), [persisted.strongbox])
  const er = useMemo(
    () => (loaded && config ? erModel(loaded.data, loaded.gameData, config) : null),
    [loaded?.data, loaded?.gameData, config],
  )

  const store = useMemo<Store | null>(() => {
    if (!loaded || !settings || !config) return null
    const done = new Set(persisted.done?.[loaded.exportName] ?? [])
    const update = (fn: (p: PersistedState) => PersistedState) => setPersisted((p) => fn(p))
    return {
      config,
      baseConfig: loaded.config,
      overrides,
      setCharacterBuilds: (char, builds) =>
        update((p) => {
          const next = { ...p.builds }
          if (builds) next[char] = builds
          else delete next[char]
          return { ...p, builds: next }
        }),
      domains: loaded.domains,
      er,
      strongboxSets,
      strongboxEdited: !!persisted.strongbox,
      setStrongboxSets: (sets) =>
        update((p) => {
          const next = { ...p }
          if (sets) next.strongbox = sets
          else delete next.strongbox
          return next
        }),
      exports: loaded.exports,
      exportName: loaded.exportName,
      data: loaded.data,
      pieces,
      exportPieces,
      equips,
      equip: (piece, char) =>
        update((p) => {
          const list = p.equips?.[loaded.exportName] ?? []
          const next = addEquip(list, pieces, piece, char)
          return next === list ? p : { ...p, equips: { ...p.equips, [loaded.exportName]: next } }
        }),
      undoEquip: (at) =>
        update((p) => {
          const list = (p.equips?.[loaded.exportName] ?? []).filter((_, i) => i !== at)
          return { ...p, equips: { ...p.equips, [loaded.exportName]: list } }
        }),
      saveError,
      settings,
      roster,
      building,
      toggleBuilding: (char, value) =>
        update((p) => {
          const list = p.building ?? []
          const on = value ?? !list.includes(char)
          if (on === list.includes(char)) return p
          if (!on) return { ...p, building: list.filter((c) => c !== char) }
          // Someone you're building should count: an Ignored character becomes Normal.
          const owned = loaded.data.characters.find((c) => c.key === char)
          const entry = p.roster?.[char] ?? defaultRosterEntry(owned, settings.includeUnowned)
          const roster = entry.priority === 'ignore' ? { ...p.roster, [char]: { ...entry, priority: 'normal' as const } } : p.roster
          return { ...p, roster, building: [...list, char] }
        }),
      done,
      sort: persisted.sort ?? 'newest',
      newExport: unseenExport,
      updateSettings: (patch) => update((p) => ({ ...p, settings: { ...p.settings, ...patch } })),
      resetSettings: () => update((p) => ({ ...p, settings: {} })),
      setRosterEntry: (char, patch, fallback) =>
        update((p) => ({ ...p, roster: { ...p.roster, [char]: { ...(p.roster?.[char] ?? fallback), ...patch } } })),
      setRoster: (r) => update((p) => ({ ...p, roster: r })),
      toggleDone: (id, value) =>
        update((p) => {
          const list = new Set(p.done?.[loaded.exportName] ?? [])
          const on = value ?? !list.has(id)
          if (on) list.add(id)
          else list.delete(id)
          return { ...p, done: { ...p.done, [loaded.exportName]: [...list] } }
        }),
      setSort: (sort) => update((p) => ({ ...p, sort })),
      selectExport,
      refreshExports,
      loadExportFile,
    }
  }, [loaded, config, er, strongboxSets, persisted.strongbox, overrides, pieces, exportPieces, equips, saveError, settings, roster, building, persisted.done, persisted.sort, unseenExport, selectExport, refreshExports, loadExportFile])

  if (error) return <div className="fatal">{error}</div>
  if (empty) {
    return (
      <div className="fatal">
        <p>No exports yet. Export your account with Irminsul, then load the .json it writes. It's copied into imports/.</p>
        <LoadExportButton
          onFile={async (file) => {
            await uploadExport(file)
            await start()
          }}
        />
      </div>
    )
  }
  if (!store) return <div className="fatal">Loading…</div>
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}
