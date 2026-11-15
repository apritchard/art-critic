import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { evaluate, type Evaluation } from '../engine/evaluate'
import { useStore } from '../state/store'
import { BuildsPage } from './BuildsPage'
import { FarmPage } from './FarmPage'
import { ImprovePage } from './ImprovePage'
import { InventoryView } from './InventoryView'
import { doneKey, ListView, type ListTab } from './ListView'
import { LoadExportButton } from './LoadExportButton'
import { useLocal } from './local'
import { RerollPage } from './RerollPage'
import { buildsFocus, inventoryFocus, parseHash } from './routes'
import { RosterPage } from './RosterPage'
import { SettingsPanel } from './SettingsPanel'

type Tab = ListTab | 'inventory' | 'reroll' | 'farm' | 'roster' | 'improve' | 'builds' | 'settings'

export const SCOPES: Record<ListTab, (e: Evaluation) => boolean> = {
  triage: (e) => e.piece.level === 0,
  progress: (e) => e.piece.level > 0 && e.piece.level < 20,
  review: (e) => e.piece.level === 20 && !e.piece.owner,
  // Everything worth leveling, locked or not, plus equipped pieces worth finishing.
  level: (e) => e.piece.level < 20 && e.nextStop !== null,
}

const TAB_LABEL: Record<Tab, string> = {
  triage: 'Triage +0',
  progress: 'In progress',
  review: '+20 review',
  level: 'Level up',
  inventory: 'Inventory',
  reroll: 'Reroll',
  farm: 'Farm',
  roster: 'Roster',
  improve: 'Improve',
  builds: 'Builds',
  settings: 'Settings',
}

export function App() {
  const store = useStore()
  const { pieces, data, config, settings, roster, done } = store
  const [savedTab, setSavedTab] = useLocal<Tab>('tab', 'triage')
  // A #tab in the URL wins, so tabs can be bookmarked; #improve/Columbina also picks the character.
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const onHash = () => setHash(location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const { tab: hashTab, args: hashArgs } = parseHash(hash) as { tab: Tab; args: string[] }
  const tab = hashTab in TAB_LABEL ? hashTab : savedTab
  const setTab = (t: Tab) => {
    history.replaceState(null, '', `#${t}`)
    setHash(`#${t}`)
    setSavedTab(t)
  }
  useEffect(() => {
    if (hashTab in TAB_LABEL && hashTab !== savedTab) setSavedTab(hashTab)
  }, [hashTab, savedTab, setSavedTab])

  // Deferred so dragging a weight slider in the Builds tab stays smooth while the re-evaluation catches up.
  const judgedBy = useDeferredValue(config)
  const result = useMemo(
    () => evaluate(pieces, data.characters, judgedBy, settings, roster),
    [pieces, data.characters, judgedBy, settings, roster],
  )

  const pending = (t: ListTab) =>
    result.evaluations.filter((e) => SCOPES[t](e) && (t === 'level' || e.action) && !done.has(doneKey(t, e))).length

  const allActions = result.evaluations.filter((e) => e.action)
  const lockCount = allActions.filter((e) => e.action === 'lock' && !done.has(e.piece.id)).length
  const unlockCount = allActions.filter((e) => e.action === 'unlock' && !done.has(e.piece.id)).length
  const doneCount = allActions.filter((e) => done.has(e.piece.id)).length

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
        <div className="summary">
          <span className="chip lock">Lock {lockCount}</span>
          <span className="chip unlock">Unlock {unlockCount}</span>
          <span className="chip">
            Done {doneCount}/{allActions.length}
          </span>
          {store.equips.length > 0 && (
            <a className="chip" href="#farm" title="Equips you've ticked since this export; every tab counts them as worn. Undo them on the Farm tab.">
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
          const count = t in SCOPES ? pending(t as ListTab) : null
          return (
            <button key={t} className={t === tab ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
              {TAB_LABEL[t]}
              {count ? <span className="badge">{count}</span> : null}
            </button>
          )
        })}
      </nav>

      <main className="main">
        {tab === 'roster' ? (
          <RosterPage result={result} />
        ) : tab === 'settings' ? (
          <SettingsPanel result={result} />
        ) : tab === 'reroll' ? (
          <RerollPage result={result} />
        ) : tab === 'farm' ? (
          <FarmPage result={result} />
        ) : tab === 'inventory' ? (
          <InventoryView result={result} focus={hashTab === 'inventory' ? inventoryFocus(hash) : undefined} />
        ) : tab === 'improve' ? (
          <ImprovePage result={result} initial={hashArgs[0]} />
        ) : tab === 'builds' ? (
          <BuildsPage result={result} focus={hashTab === 'builds' ? buildsFocus(hash) : undefined} />
        ) : (
          <ListView key={tab} tab={tab} result={result} scope={SCOPES[tab]} />
        )}
      </main>
    </div>
  )
}
