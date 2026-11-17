import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { evaluate } from '../engine/evaluate'
import { characterName } from '../engine/stats'
import { useStore } from '../state/store'
import { ArtifactsPage } from './ArtifactsPage'
import { BuildsPage } from './BuildsPage'
import { CharactersPage } from './CharactersPage'
import { LoadExportButton } from './LoadExportButton'
import { useLocal } from './local'
import {
  artifactsRoute,
  buildsFocus,
  charactersHref,
  charactersRoute,
  HASH_REPLACED,
  LEGACY_LISTS,
  parseHash,
  spendRoute,
} from './routes'
import { SettingsPanel } from './SettingsPanel'
import { SpendPage } from './SpendPage'

/** One tab per question: what to do with each piece, who needs help, where to spend what you have. */
type Tab = 'artifacts' | 'characters' | 'spend' | 'builds' | 'settings'

const TAB_LABEL: Record<Tab, string> = {
  artifacts: 'Artifacts',
  characters: 'Characters',
  spend: 'Spend',
  builds: 'Builds',
  settings: 'Settings',
}

/** The tabs that were folded into others, by their old names. */
const LEGACY_TABS: Record<string, Tab> = {
  inventory: 'artifacts',
  roster: 'characters',
  improve: 'characters',
  farm: 'spend',
  reroll: 'spend',
}

/** The tab a hash names, including the old tabs' names (their links still work). */
function tabOf(name: string): Tab | null {
  if (name in TAB_LABEL) return name as Tab
  if (name in LEGACY_LISTS) return 'artifacts'
  return LEGACY_TABS[name] ?? null
}

export function App() {
  const store = useStore()
  const { pieces, data, config, settings, roster, done, building, toggleBuilding } = store
  const [savedTab, setSavedTab] = useLocal<string>('tab', 'artifacts')
  // A #tab in the URL wins, so tabs can be bookmarked; #characters/Columbina also picks the character. `n` counts
  // navigations, so following the same link twice still counts as following it. `from` is the URL before, as the
  // page had it (pages keep their state in it with replaceHash), for the Builds tab's Back link.
  const [nav, setNav] = useState({ hash: location.hash, n: 0, from: null as string | null })
  const latest = useRef(location.hash)
  useEffect(() => {
    const onNav = () => {
      if (latest.current === location.hash) return
      const from = latest.current
      latest.current = location.hash
      setNav((v) => ({ hash: location.hash, n: v.n + 1, from }))
    }
    const onReplace = () => {
      latest.current = location.hash
    }
    window.addEventListener('hashchange', onNav)
    window.addEventListener('popstate', onNav)
    window.addEventListener(HASH_REPLACED, onReplace)
    return () => {
      window.removeEventListener('hashchange', onNav)
      window.removeEventListener('popstate', onNav)
      window.removeEventListener(HASH_REPLACED, onReplace)
    }
  }, [])
  const { tab: hashTab } = parseHash(nav.hash)
  const tab = tabOf(hashTab) ?? tabOf(savedTab) ?? 'artifacts'
  // Switching tabs adds a history entry, so Back returns to the tab (and the view in it) you came from.
  const setTab = (t: Tab) => {
    if (t === tab) return
    const from = location.hash
    history.pushState(null, '', `#${t}`)
    latest.current = `#${t}`
    setNav((v) => ({ hash: `#${t}`, n: v.n + 1, from }))
  }
  useEffect(() => {
    if (tab !== savedTab) setSavedTab(tab)
  }, [tab, savedTab, setSavedTab])

  // Deferred so dragging a weight slider in the Builds tab stays smooth while the re-evaluation catches up.
  const judgedBy = useDeferredValue(config)
  const buildingSet = useMemo(() => new Set(building), [building])
  const result = useMemo(
    () => evaluate(pieces, data.characters, judgedBy, settings, roster, buildingSet),
    [pieces, data.characters, judgedBy, settings, roster, buildingSet],
  )

  const allActions = result.evaluations.filter((e) => e.action)
  const lockCount = allActions.filter((e) => e.action === 'lock' && !done.has(e.piece.id)).length
  const unlockCount = allActions.filter((e) => e.action === 'unlock' && !done.has(e.piece.id)).length
  const doneCount = allActions.filter((e) => done.has(e.piece.id)).length
  // Where Back goes from the Builds tab, when you came from another tab.
  const fromTab = nav.from ? tabOf(parseHash(nav.from).tab) : null
  const back = tab === 'builds' && nav.from && fromTab && fromTab !== 'builds' ? { href: nav.from, label: TAB_LABEL[fromTab] } : undefined

  return (
    <div className="app">
      <header className="header">
        <div className="brand">Art Critic</div>
        <select
          className="export-select"
          value={store.exportName}
          onChange={(e) => store.selectExport(e.target.value)}
          title="Irminsul export in imports/"
        >
          {store.exports.map((x) => (
            <option key={x.name} value={x.name}>
              {x.name}
            </option>
          ))}
        </select>
        <button className="ghost" onClick={() => store.refreshExports()} title="Reload the newest export">
          ↻
        </button>
        <LoadExportButton onFile={store.loadExportFile} />
        {building.length > 0 && (
          <div className="building-strip" title="Who you're building now: first in lists, first pick of free upgrades, and what farming can be ranked for">
            <span className="muted">📌 Building</span>
            {building.map((c) => (
              <span key={c} className="chip building">
                <a href={charactersHref({ char: c })} title={`Every way to improve ${characterName(c)}'s pieces`}>
                  {characterName(c)}
                </a>
                <button className="chip-x" onClick={() => toggleBuilding(c, false)} title={`Take ${characterName(c)} off the Building list`}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="summary">
          <span className="chip lock">Lock {lockCount}</span>
          <span className="chip unlock">Unlock {unlockCount}</span>
          <span className="chip">
            Done {doneCount}/{allActions.length}
          </span>
          {store.equips.length > 0 && (
            <a
              className="chip"
              href={charactersHref('quick')}
              title="Equips you've ticked since this export; every tab counts them as worn. Undo them in Characters → Quick wins."
            >
              ✎ {store.equips.length} equipped since export
            </a>
          )}
        </div>
      </header>

      {store.saveError && (
        <div className="banner">
          Your changes aren't saved yet ({store.saveError}). Retrying every few seconds: is the dev server still running?
        </div>
      )}
      {store.newExport && (
        <div className="banner">
          New export found: <b>{store.newExport}</b>
          <button onClick={() => store.selectExport(store.newExport!)}>Load it</button>
        </div>
      )}

      <nav className="tabs">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => {
          const count = t === 'artifacts' ? lockCount + unlockCount : null
          return (
            <button key={t} className={t === tab ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
              {TAB_LABEL[t]}
              {count ? (
                <span className="badge" title="Lock changes still to make">
                  {count}
                </span>
              ) : null}
            </button>
          )
        })}
      </nav>

      <main className="main">
        {tab === 'settings' ? (
          <SettingsPanel result={result} />
        ) : tab === 'characters' ? (
          <CharactersPage result={result} route={charactersRoute(tabOf(hashTab) === 'characters' ? nav.hash : '#characters', nav.n)} />
        ) : tab === 'spend' ? (
          <SpendPage result={result} route={tabOf(hashTab) === 'spend' ? spendRoute(nav.hash) : undefined} />
        ) : tab === 'builds' ? (
          <BuildsPage result={result} focus={hashTab === 'builds' ? buildsFocus(nav.hash) : undefined} back={back} />
        ) : (
          <ArtifactsPage result={result} route={artifactsRoute(tabOf(hashTab) === 'artifacts' ? nav.hash : '#artifacts', nav.n)} />
        )}
      </main>
    </div>
  )
}
