import { useMemo, useState } from 'react'
import { erNeed, totalER } from '../engine/er'
import { defaultRosterEntry, type CharacterSummary, type EvaluationResult } from '../engine/evaluate'
import { wearing } from '../engine/farm'
import { characterName, SLOT_LABEL } from '../engine/stats'
import { SLOTS, type Priority } from '../engine/types'
import { useStore } from '../state/store'
import { SLOT_ICON } from './ArtifactCard'
import { BuildingToggle } from './marks'
import { charactersHref } from './routes'

const PRIORITY_LABEL: Record<Priority, string> = { priority: '★ Priority', normal: 'Normal', ignore: 'Ignore' }
const PRIORITY_ORDER: Record<Priority, number> = { priority: 0, normal: 1, ignore: 2 }

const qualityClass = (q: number | null) => (q === null ? 'q-none' : q >= 0.85 ? 'q-good' : q >= 0.6 ? 'q-ok' : 'q-weak')

export function RosterPage({ result }: { result: EvaluationResult }) {
  const { data, pieces, roster, setRosterEntry, setRoster, settings, er, config } = useStore()
  const [query, setQuery] = useState('')
  const owned = useMemo(() => new Map(data.characters.map((c) => [c.key, c])), [data.characters])
  const wornIdx = useMemo(
    () => new Map(wearing(result, pieces).current.map((ref) => [ref.char, ref.buildIdx])),
    [result, pieces],
  )

  const erOf = useMemo(
    () => new Map(result.characters.map((c) => [c.char, totalER(er, c.char, pieces.filter((p) => p.owner === c.char))])),
    [result.characters, er, pieces],
  )

  const rows = useMemo(
    () =>
      result.characters
        .filter((c) => characterName(c.char).toLowerCase().includes(query.toLowerCase()))
        .sort(
          (a, b) =>
            Number(b.building) - Number(a.building) ||
            PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
            Number(b.owned) - Number(a.owned) ||
            (b.level ?? 0) - (a.level ?? 0) ||
            characterName(a.char).localeCompare(characterName(b.char)),
        ),
    [result.characters, query],
  )

  const fallback = (char: string) => defaultRosterEntry(owned.get(char), settings.includeUnowned)
  const activeCount = result.characters.filter((c) => c.active).length

  return (
    <div className="page roster">
      <p className="hint">
        Only <b>Priority</b> and <b>Normal</b> characters count when judging artifacts. Priority characters keep up to{' '}
        {settings.capPriority} candidates per slot instead of {settings.capNormal}. Slot cells show how good the equipped
        piece is for that build (100% ≈ a typical well-rolled +20 with that main stat, which can&apos;t also be a substat);
        weak cells are where new pieces have the best odds.
      </p>
      <div className="roster-tools">
        <input placeholder="Search characters…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="muted">{activeCount} active</span>
        <button className="ghost" onClick={() => setRoster({})} title="Owned Lv 80+ → Normal, others → Ignore">
          Reset to defaults
        </button>
      </div>
      <table className="roster-table">
        <thead>
          <tr>
            <th>Character</th>
            <th>Counts?</th>
            <th>Builds</th>
            {SLOTS.map((s) => (
              <th key={s} title={SLOT_LABEL[s]}>
                {SLOT_ICON[s]}
              </th>
            ))}
            <th title="Unequipped pieces kept mainly for this character">Kept</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <Row
              key={c.char}
              c={c}
              wornIdx={c.builds.length > 1 ? wornIdx.get(c.char) : undefined}
              er={erOf.get(c.char) ?? null}
              needs={config.characters[c.char].builds.map(erNeed)}
              onChange={(patch) => setRosterEntry(c.char, patch, fallback(c.char))}
              entry={roster[c.char] ?? fallback(c.char)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** One table row per build, so each build's slot ratings show; the character's own cells span them all. */
function Row({
  c,
  entry,
  wornIdx,
  er,
  needs,
  onChange,
}: {
  c: CharacterSummary
  entry: { priority: Priority; disabledBuilds: number[] }
  /** The build their equipped pieces fit best, when they have several. */
  wornIdx: number | undefined
  /** Total Energy Recharge (%) as equipped; null when the weapon or ascension stat is unknown. */
  er: number | null
  /** Each build's ER minimum (%). */
  needs: (number | null)[]
  onChange: (patch: Partial<{ priority: Priority; disabledBuilds: number[] }>) => void
}) {
  const span = c.builds.length
  return (
    <>
      {c.builds.map((b, i) => (
        <tr key={b.idx} className={[c.active ? '' : 'inactive', i < span - 1 ? 'cont' : ''].join(' ')}>
          {i === 0 && (
            <>
              <td rowSpan={span}>
                <BuildingToggle char={c.char} />{' '}
                <a className="char-name char-link" href={charactersHref({ char: c.char })} title="All the ways to improve their pieces">
                  {characterName(c.char)}
                </a>
                <div className="sub-note">
                  {c.owned ? `Lv ${c.level}` : 'not owned'}
                  {er !== null && <span title="Total Energy Recharge: base, ascension, weapon, artifacts and 2pc bonuses"> · ER {er.toFixed(0)}%</span>}
                  {c.confidence === 'speculative' && ' · speculative build'}
                </div>
              </td>
              <td rowSpan={span}>
                <div className="seg small">
                  {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
                    <button key={p} className={entry.priority === p ? 'on' : ''} onClick={() => onChange({ priority: p })}>
                      {PRIORITY_LABEL[p]}
                    </button>
                  ))}
                </div>
              </td>
            </>
          )}
          <td className={b.enabled ? '' : 'build-off'}>
            {span === 1 ? (
              <span className="sub-note">{b.name}</span>
            ) : (
              <label className="check build-toggle">
                <input
                  type="checkbox"
                  checked={b.enabled}
                  onChange={(e) =>
                    onChange({
                      disabledBuilds: e.target.checked
                        ? entry.disabledBuilds.filter((x) => x !== b.idx)
                        : [...entry.disabledBuilds, b.idx],
                    })
                  }
                />{' '}
                {b.name}
                {b.idx === wornIdx && (
                  <span className="worn-tag" title="Their equipped pieces fit this build best">
                    wearing
                  </span>
                )}
              </label>
            )}
            {er !== null && needs[b.idx] !== null && er < needs[b.idx]! && (
              <div className="sub-note warn" title="This build's ER minimum, from its ER target in Builds">
                ER under {needs[b.idx]}%
              </div>
            )}
          </td>
          {SLOTS.map((s) => {
            const q = b.slots[s]
            return (
              <td
                key={s}
                className={`qcell ${qualityClass(q.quality)}${b.enabled ? '' : ' build-off'}`}
                title={q.value === null ? 'Nothing usable for this build: empty, 4★ or a main stat it doesn’t list' : `Value ${q.value.toFixed(2)}`}
              >
                {q.quality === null ? '–' : `${Math.round(q.quality * 100)}%`}
              </td>
            )
          })}
          {i === 0 && (
            <td rowSpan={span} className="kept">
              {c.kept || ''}
            </td>
          )}
        </tr>
      ))}
    </>
  )
}
