import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import {
  allowedMains,
  categoryLabel,
  MAIN_SLOTS,
  pairCategories,
  remapDisabled,
  shiftDisabled,
  SUBSTAT_KEYS,
  withMainStats,
  withPair,
  withTwoPieceOnly,
  withWeight,
} from '../engine/builds'
import { erCap, erNeed, totalER } from '../engine/er'
import { defaultRosterEntry, type EvaluationResult } from '../engine/evaluate'
import { MAIN_ODDS } from '../engine/farm'
import { characterName, SLOT_LABEL, setName, statLabel, statShort } from '../engine/stats'
import { SLOTS, type BuildConfig } from '../engine/types'
import { useStore } from '../state/store'
import { SLOT_ICON } from './ArtifactCard'
import { FitPanel, useFitting, type Fitting } from './FitPanel'
import { useLocal } from './local'
import { charactersHref, type BuildsFocus } from './routes'

const qualityClass = (q: number | null) => (q === null ? 'q-none' : q >= 0.85 ? 'q-good' : q >= 0.6 ? 'q-ok' : 'q-weak')

/** A build to show, picked by a link or from Closest build; `n` makes picking the same one twice count. */
interface Pick {
  char: string
  idx: number
  n: number
}

export function BuildsPage({
  result,
  focus,
  back,
}: {
  result: EvaluationResult
  focus?: BuildsFocus
  /** The page you came from, to go back to (the Artifacts grid as you left it, say). */
  back?: { href: string; label: string }
}) {
  const { config, overrides, data } = useStore()
  const [query, setQuery] = useState('')
  const [showUnowned, setShowUnowned] = useLocal('builds:unowned', false)
  const owned = useMemo(() => new Set(data.characters.map((c) => c.key)), [data.characters])
  const active = useMemo(() => new Set(result.characters.filter((c) => c.active).map((c) => c.char)), [result.characters])
  const chars = useMemo(
    () =>
      Object.keys(config.characters)
        .filter((k) => showUnowned || owned.has(k))
        .filter((k) => characterName(k).toLowerCase().includes(query.toLowerCase()))
        .sort(
          (a, b) =>
            Number(active.has(b)) - Number(active.has(a)) ||
            Number(owned.has(b)) - Number(owned.has(a)) ||
            characterName(a).localeCompare(characterName(b)),
        ),
    [config.characters, owned, active, query, showUnowned],
  )
  const [selected, setSelected] = useLocal<string>('builds:char', '')
  const char = config.characters[selected] ? selected : chars[0]
  const [pick, setPick] = useState<Pick | null>(null)
  const select = useCallback(
    (c: string, idx: number) => {
      setSelected(c)
      setPick((p) => ({ char: c, idx, n: (p?.n ?? 0) + 1 }))
    },
    [setSelected],
  )
  const fitting = useFitting(result, focus?.piece)
  // Following a link: its character and build, or else the build closest to keeping its piece. Only when a link is
  // followed; the selection is the user's after that.
  useEffect(() => {
    if (focus?.char && config.characters[focus.char]) select(focus.char, focus.idx ?? 0)
    else if (fitting?.fits[0]) select(fitting.fits[0].ref.char, fitting.fits[0].ref.buildIdx)
  }, [focus?.key])

  return (
    <div className="builds-page">
      <aside className="rail">
        <input className="rail-search" placeholder="Search characters…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="check rail-check">
          <input type="checkbox" checked={showUnowned} onChange={(e) => setShowUnowned(e.target.checked)} /> Include unowned
        </label>
        {chars.map((k) => (
          <button key={k} className={k === char ? 'rail-item active' : 'rail-item'} onClick={() => (setSelected(k), setPick(null))}>
            <span className={`rail-name${active.has(k) ? '' : ' muted'}`}>{characterName(k)}</span>
            <span className="counts">{overrides[k] && <span className="c-level" title="Edited">✎ edited</span>}</span>
          </button>
        ))}
      </aside>
      {char ? (
        <Editor key={char} char={char} result={result} fitting={fitting} pick={pick?.char === char ? pick : null} onPick={select} back={back} />
      ) : (
        <div className="empty">No characters match.</div>
      )}
    </div>
  )
}

function Editor(props: {
  char: string
  result: EvaluationResult
  fitting: Fitting | null
  pick: Pick | null
  onPick: (char: string, idx: number) => void
  back?: { href: string; label: string }
}) {
  const { char, result, fitting, pick, onPick, back } = props
  const { config, baseConfig, overrides, setCharacterBuilds, data, pieces, er, roster, setRosterEntry, settings } = useStore()
  const cc = config.characters[char]
  const builds = cc.builds
  const [idx, setIdx] = useLocal(`builds:${char}:idx`, 0)
  // Before paint, so a picked build doesn't flash the last one viewed first.
  useLayoutEffect(() => {
    if (pick) setIdx(pick.idx)
  }, [pick?.n])
  const i = Math.min(idx, builds.length - 1)
  const build = builds[i]
  const owned = data.characters.find((c) => c.key === char)
  const entry = roster[char] ?? defaultRosterEntry(owned, settings.includeUnowned)
  const summary = result.characters.find((c) => c.char === char)
  const slots = summary?.builds.find((b) => b.idx === i)?.slots
  const need = erNeed(build)
  const cap = erCap(build)
  const erNow = useMemo(() => totalER(er, char, pieces.filter((p) => p.owner === char)), [er, char, pieces])

  const save = (b: BuildConfig) => setCharacterBuilds(char, builds.map((x, j) => (j === i ? b : x)))
  const copy = () => {
    setCharacterBuilds(char, [...builds, { ...structuredClone(build), name: `${build.name} (copy)` }])
    setIdx(builds.length)
  }
  const remove = () => {
    if (!confirm(`Delete the "${build.name}" build?`)) return
    setCharacterBuilds(char, builds.filter((_, j) => j !== i))
    if (roster[char]) setRosterEntry(char, { disabledBuilds: shiftDisabled(entry.disabledBuilds, i) }, entry)
    setIdx(Math.max(0, i - 1))
  }
  const reset = () => {
    if (!confirm(`Reset ${characterName(char)} to the research config?`)) return
    // Switched-off builds are stored by position, so carry them over by name.
    const original = baseConfig.characters[char]?.builds ?? []
    if (roster[char]) setRosterEntry(char, { disabledBuilds: remapDisabled(entry.disabledBuilds, builds, original) }, entry)
    setCharacterBuilds(char, null)
    setIdx(0)
  }

  const sets = [...build.sets4].sort((a, b) => a.tier - b.tier || setName(a.set).localeCompare(setName(b.set)))
  const unused = Object.keys(config.sets)
    .filter((s) => !build.sets4.some((x) => x.set === s))
    .sort((a, b) => setName(a).localeCompare(setName(b)))

  return (
    <div className="editor">
      {back && (
        <a className="link back-link" href={back.href} title="Back to where you were">
          ← Back to {back.label}
        </a>
      )}
      {fitting && <FitPanel fitting={fitting} char={char} idx={i} build={build} save={save} onPick={onPick} />}
      <div className="editor-head">
        <h2>{characterName(char)}</h2>
        <span className="sub-note">
          {cc.element} · {cc.confidence} · {owned ? `Lv ${owned.level}` : 'not owned'}
          {!summary?.active && ' · not counted (see Roster)'}
        </span>
        <a className="link" href={charactersHref({ char })} title="Improve in Characters">
          Character →
        </a>
        {overrides[char] && (
          <button className="ghost" onClick={reset}>
            Reset to research config
          </button>
        )}
      </div>

      <div className="build-tabs">
        {builds.length > 1 && (
          <div className="seg">
            {builds.map((b, j) => (
              <button key={j} className={j === i ? 'on' : ''} onClick={() => setIdx(j)}>
                {b.name || `Build ${j + 1}`}
                {entry.disabledBuilds.includes(j) && <span className="muted"> (off)</span>}
              </button>
            ))}
          </div>
        )}
        <button className="ghost" onClick={copy} title="Start a new build from this one">
          + Copy build
        </button>
        {builds.length > 1 && (
          <button className="ghost" onClick={remove}>
            Delete build
          </button>
        )}
      </div>

      <div className="form-row">
        <label>
          Name <input value={build.name} onChange={(e) => save({ ...build, name: e.target.value })} />
        </label>
        <label>
          ER target <input value={build.erTarget} onChange={(e) => save({ ...build, erTarget: e.target.value })} />
        </label>
        <span
          className="sub-note"
          title="Swaps and rerolls keep ER ≥ minimum; ER counts up to the cap"
        >
          {need === null ? 'No ER minimum (no percentage)' : `Minimum ${need}%`}
          {cap !== null && need !== null && cap > need && ` · counts up to ${cap}%`}
          {erNow !== null && ` · wears ${erNow.toFixed(0)}%`}
        </span>
      </div>

      {slots && (
        <div className="impact">
          {SLOTS.map((s) => (
            <span key={s} className={`qcell ${qualityClass(slots[s].quality)}`} title={`${SLOT_LABEL[s]}: current`}>
              {SLOT_ICON[s]} {slots[s].quality === null ? '–' : `${Math.round(slots[s].quality! * 100)}%`}
            </span>
          ))}
          <span className="muted">
            · {summary?.kept ?? 0} {summary?.kept === 1 ? 'piece' : 'pieces'} kept for them
          </span>
        </div>
      )}

      <section className="field">
        <h3>4-piece sets</h3>
        <p className="hint">
          Tier 1 best · 1–2 count (3 with loosest matching) · once worn, only it and better tiers count · 2pc only: kept
          for the pairs below, its 4pc never preferred
        </p>
        {sets.map((s) => (
          <div key={s.set} className="set-row">
            <span className="set-row-name">{setName(s.set)}</span>
            <div className="seg small">
              {[1, 2, 3].map((t) => (
                <button
                  key={t}
                  className={s.tier === t ? 'on' : ''}
                  onClick={() => save({ ...build, sets4: build.sets4.map((x) => (x.set === s.set ? { ...x, tier: t } : x)) })}
                >
                  Tier {t}
                </button>
              ))}
            </div>
            <button
              className={s.twoPieceOnly ? 'toggle on' : 'toggle'}
              onClick={() => save(withTwoPieceOnly(build, s.set, !s.twoPieceOnly))}
              title="Kept for the pairs below; 4pc never preferred"
            >
              2pc only
            </button>
            <button
              className="ghost small"
              onClick={() => save({ ...build, sets4: build.sets4.filter((x) => x.set !== s.set) })}
              title="Remove"
            >
              ✕
            </button>
          </div>
        ))}
        <select
          value=""
          onChange={(e) => e.target.value && save({ ...build, sets4: [...build.sets4, { set: e.target.value, tier: 1 }] })}
        >
          <option value="">+ Add a set…</option>
          {unused.map((s) => (
            <option key={s} value={s}>
              {setName(s)}
            </option>
          ))}
        </select>
      </section>

      <section className="field">
        <h3>2-piece pairs</h3>
        <p className="hint">2pc + 2pc combos that stand in for a 4pc. Any set = free half.</p>
        {build.sets2.map((pair, j) => (
          <div key={pair.join('+') + j} className="set-row">
            <span className="set-row-name">{pair.map((c) => categoryLabel(config, c)).join(' + ')}</span>
            <button className="ghost small" onClick={() => save({ ...build, sets2: build.sets2.filter((_, k) => k !== j) })} title="Remove">
              ✕
            </button>
          </div>
        ))}
        <PairAdder onAdd={(pair) => save(withPair(build, pair))} />
      </section>

      <section className="field">
        <h3>Main stats</h3>
        <p className="hint">Other main stats don&apos;t count.</p>
        {MAIN_SLOTS.map((slot) => {
          const on = allowedMains(build, slot)
          return (
            <div key={slot} className="main-row">
              <span className="main-row-slot" title={SLOT_LABEL[slot]}>
                {SLOT_ICON[slot]} {SLOT_LABEL[slot]}
              </span>
              <div className="toggles">
                {MAIN_ODDS[slot].map(([m]) => (
                  <button
                    key={m}
                    className={on.includes(m) ? 'toggle on' : 'toggle'}
                    onClick={() => save(withMainStats(build, slot, on.includes(m) ? on.filter((x) => x !== m) : [...on, m]))}
                    title={statLabel(m)}
                  >
                    {statShort(m)}
                  </button>
                ))}
              </div>
              {on.length === 0 && <span className="warn">nothing allowed</span>}
            </div>
          )
        })}
      </section>

      <section className="field">
        <h3>Substat weights</h3>
        <p className="hint">1 = fully wanted · 0 = useless</p>
        <label className="preset">
          Preset{' '}
          <select
            value={config.substatPresets[build.substatPreset] ? build.substatPreset : ''}
            onChange={(e) =>
              e.target.value &&
              save({ ...build, substats: { ...config.substatPresets[e.target.value] }, substatPreset: e.target.value })
            }
          >
            <option value="">Custom weights</option>
            {Object.keys(config.substatPresets).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        {SUBSTAT_KEYS.map((k) => {
          const w = build.substats[k] ?? 0
          return (
            <label key={k} className="slider">
              <span>{statLabel(k)}</span>
              <input type="range" min={0} max={1} step={0.05} value={w} onChange={(e) => save(withWeight(build, k, Number(e.target.value)))} />
              <b className={w === 0 ? 'muted' : ''}>{w.toFixed(2)}</b>
            </label>
          )
        })}
      </section>

      {build.notes && (
        <section className="field">
          <h3>Research notes</h3>
          <p className="hint">{build.notes}</p>
        </section>
      )}
    </div>
  )
}

/** Two category pickers and an Add button for a new 2pc pair. */
function PairAdder({ onAdd }: { onAdd: (pair: [string, string]) => void }) {
  const { config } = useStore()
  const options = useMemo(() => pairCategories(config), [config])
  const [first, setFirst] = useState('')
  const [second, setSecond] = useState('')
  const pick = (value: string, set: (v: string) => void) => (
    <select value={value} onChange={(e) => set(e.target.value)}>
      <option value="">Choose a 2pc…</option>
      {options.map((c) => (
        <option key={c} value={c}>
          {categoryLabel(config, c)}
        </option>
      ))}
    </select>
  )
  return (
    <div className="pair-adder">
      {pick(first, setFirst)} + {pick(second, setSecond)}
      <button
        className="ghost"
        disabled={!first || !second}
        onClick={() => {
          onAdd([first, second])
          setFirst('')
          setSecond('')
        }}
      >
        Add pair
      </button>
    </div>
  )
}
