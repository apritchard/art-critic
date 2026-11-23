import { useEffect, useMemo, useState } from 'react'
import { characterBoard, swapGain, type BoardRow, type SlotFixes } from '../engine/board'
import type { EvaluationResult } from '../engine/evaluate'
import { planFarming } from '../engine/farm'
import { planRerolls } from '../engine/reroll'
import { characterName, SLOT_LABEL, setName, statShort } from '../engine/stats'
import { SLOTS, type SlotKey } from '../engine/types'
import { useStore } from '../state/store'
import { SLOT_ICON } from './ArtifactCard'
import { erTargetText, QuickWins } from './FarmPage'
import { ImprovePage } from './ImprovePage'
import { Info } from './Info'
import { useLocal } from './local'
import { BuildingToggle, marks } from './marks'
import { belowNote, finishNote, useGuarantee } from './RerollPage'
import { RosterPage } from './RosterPage'
import { charactersHref, replaceHash, type CharactersRoute, type CharactersView } from './routes'

const VIEW_LABEL: Record<CharactersView, { label: string; title: string }> = {
  board: { label: 'Board', title: 'Weak slots and fixes waiting' },
  quick: { label: 'Quick wins', title: 'Spare +20s to equip now' },
  roster: { label: 'Roster', title: 'Who counts, which builds' },
}

/**
 * Who needs help, and what's the cheapest fix: the board of every character, the free upgrades to equip now, the
 * roster of who counts, and one character's options slot by slot. `route` is what a link asks for; otherwise it's
 * where you last were.
 */
export function CharactersPage({ result, route }: { result: EvaluationResult; route: CharactersRoute }) {
  const { config } = useStore()
  const [view, setView] = useLocal<CharactersView | 'detail'>('characters:view', 'board')
  const [char, setChar] = useLocal<string>('improve:char', '')
  useEffect(() => {
    if (route.char && config.characters[route.char]) {
      setChar(route.char)
      setView('detail')
    } else if (route.view) setView(route.view)
  }, [route.key])
  const detail = view === 'detail' && !!config.characters[char]
  useEffect(() => replaceHash(detail ? charactersHref({ char }) : charactersHref(view === 'detail' ? 'board' : view)), [detail, view, char])

  return (
    <div className="characters">
      <nav className="view-bar">
        <div className="seg" role="group" aria-label="View">
          {(Object.keys(VIEW_LABEL) as CharactersView[]).map((v) => (
            <button key={v} className={view === v ? 'on' : ''} title={VIEW_LABEL[v].title} onClick={() => setView(v)}>
              {VIEW_LABEL[v].label}
            </button>
          ))}
        </div>
        {detail ? (
          <span className="crumb">
            › <b>{characterName(char)}</b>
          </span>
        ) : (
          char &&
          config.characters[char] && (
            <button className="link" onClick={() => setView('detail')} title="Back to the character you last looked at">
              {characterName(char)} →
            </button>
          )
        )}
      </nav>
      <div className="characters-body">
        {detail ? (
          <ImprovePage result={result} selected={char} />
        ) : view === 'quick' ? (
          <QuickWins result={result} />
        ) : view === 'roster' ? (
          <RosterPage result={result} />
        ) : (
          <Board result={result} />
        )}
      </div>
    </div>
  )
}

const qualityClass = (q: number | null) => (q === null ? 'q-none' : q >= 0.85 ? 'q-good' : q >= 0.6 ? 'q-ok' : 'q-weak')
const pct = (q: number) => `${Math.round(q * 100)}%`

type BoardSort = 'min' | 'avg' | 'free' | 'new' | 'name'
const SORT_LABEL: Record<BoardSort, { label: string; title: string }> = {
  min: { label: 'Weakest slot', title: 'Lowest slot first' },
  avg: { label: 'Average', title: 'Lowest average first (empty = 0%)' },
  free: { label: 'Free gain', title: 'Most free-swap gain first' },
  new: { label: 'New piece', title: 'Most gain per on-set drop first' },
  name: { label: 'Name', title: 'A to Z' },
}

const hasFix = (r: BoardRow) => SLOTS.some((s) => r.fixes[s].swap || r.fixes[s].reroll || r.fixes[s].level)

/**
 * Every active character in one table: how good each worn piece is for the build they wear (the Roster ratings),
 * and per slot whether a free swap (⇄), a reroll (⟳) or a piece to level (⬆) is waiting. Building characters come
 * first, then (optionally) ★ Priority ones.
 */
function Board({ result }: { result: EvaluationResult }) {
  const { pieces, config, domains, er, strongboxSets } = useStore()
  const [guarantee] = useGuarantee()
  const [sort, setSort] = useLocal<BoardSort>('board:sort', 'min')
  const [starFirst, setStarFirst] = useLocal('board:starFirst', true)
  const [onlyFixes, setOnlyFixes] = useLocal('board:onlyFixes', false)
  const [query, setQuery] = useState('')
  const plan = useMemo(
    () => planFarming(result, pieces, config, domains, 'all', er, strongboxSets),
    [result, pieces, config, domains, er, strongboxSets],
  )
  const rerolls = useMemo(() => planRerolls(result, pieces, guarantee, er, config).options, [result, pieces, guarantee, er, config])
  const rows = useMemo(() => characterBoard(result, pieces, plan, rerolls, er), [result, pieces, plan, rerolls, er])
  const summaries = useMemo(() => new Map(result.characters.map((c) => [c.char, c])), [result.characters])

  const shown = useMemo(() => {
    // Name sorts by the tie-break alone.
    const key = (r: BoardRow) =>
      sort === 'min' ? r.min : sort === 'avg' ? r.avg : sort === 'free' ? -r.freeGain : sort === 'new' ? -(r.newPiece ?? 0) : 0
    return rows
      .filter((r) => summaries.get(r.char)?.active)
      .filter((r) => characterName(r.char).toLowerCase().includes(query.toLowerCase()))
      .filter((r) => !onlyFixes || hasFix(r))
      .sort(
        (a, b) =>
          Number(!!b.ref?.building) - Number(!!a.ref?.building) ||
          (starFirst ? Number(b.ref?.priority === 'priority') - Number(a.ref?.priority === 'priority') : 0) ||
          key(a) - key(b) ||
          characterName(a.char).localeCompare(characterName(b.char)),
      )
  }, [rows, summaries, query, onlyFixes, sort, starFirst])

  const counts = {
    swap: rows.reduce((n, r) => n + SLOTS.filter((s) => r.fixes[s].swap).length, 0),
    reroll: rows.reduce((n, r) => n + SLOTS.filter((s) => r.fixes[s].reroll).length, 0),
    level: rows.reduce((n, r) => n + SLOTS.filter((s) => r.fixes[s].level).length, 0),
  }

  return (
    <div className="page board">
      <Info id="board" heading={<h2>Who needs help</h2>}>
        <p>
          Slot % = worn vs typical good +20 (– empty / 4★ / unlisted main). <span className="fix swap">⇄</span> free swap ·{' '}
          <span className="fix reroll">⟳</span> reroll ≥ 0.5 · <span className="fix level">⬆</span> level ≥ 0.5. <b>Free gain</b>{' '}
          = Σ swaps; <b>New piece</b> = gain per on-set drop.
        </p>
      </Info>
      <div className="roster-tools">
        <input placeholder="Search characters…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="muted">Sort by</span>
        <div className="seg small">
          {(Object.keys(SORT_LABEL) as BoardSort[]).map((k) => (
            <button key={k} className={sort === k ? 'on' : ''} title={SORT_LABEL[k].title} onClick={() => setSort(k)}>
              {SORT_LABEL[k].label}
            </button>
          ))}
        </div>
        <label className="check" title="★ Priority before the rest">
          <input type="checkbox" checked={starFirst} onChange={(e) => setStarFirst(e.target.checked)} /> ★ first
        </label>
        <label className="check" title="Only rows with ⇄, ⟳ or ⬆">
          <input type="checkbox" checked={onlyFixes} onChange={(e) => setOnlyFixes(e.target.checked)} /> With a fix waiting
        </label>
        <span className="muted">
          <span className="fix swap">⇄</span> {counts.swap} · <span className="fix reroll">⟳</span> {counts.reroll} ·{' '}
          <span className="fix level">⬆</span> {counts.level}
        </span>
      </div>
      <table className="roster-table board-table">
        <thead>
          <tr>
            <th />
            <th>Character</th>
            {SLOTS.map((s) => (
              <th key={s} className="qcell" title={SLOT_LABEL[s]}>
                {SLOT_ICON[s]}
              </th>
            ))}
            <th className="num" title={SORT_LABEL.free.title}>
              Free gain
            </th>
            <th className="num" title={SORT_LABEL.new.title}>
              New piece
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <BoardLine key={r.char} r={r} multi={(config.characters[r.char]?.builds.length ?? 0) > 1} />
          ))}
        </tbody>
      </table>
      {!shown.length && <p className="empty">No characters match.</p>}
    </div>
  )
}

function BoardLine({ r, multi }: { r: BoardRow; multi: boolean }) {
  const open = () => {
    location.hash = charactersHref({ char: r.char })
  }
  const under = r.er !== null && r.need !== null && r.er < r.need
  return (
    <tr className="board-row" onClick={open}>
      <td>
        <BuildingToggle char={r.char} />
      </td>
      <td>
        <a className="char-name char-link" href={charactersHref({ char: r.char })} onClick={(e) => e.stopPropagation()}>
          {characterName(r.char)}
        </a>
        {r.ref && marks(r.ref)}
        <div className="sub-note">
          {multi && r.ref && <>{r.ref.build.name} · </>}
          {r.er !== null && (
            <span className={under ? 'warn' : ''} title="Worn ER vs target">
              ER {r.er.toFixed(0)}%{r.need !== null && (under ? ` (needs ${erTargetText(r.need, r.cap)})` : '')}
            </span>
          )}
        </div>
      </td>
      {SLOTS.map((s) => (
        <SlotCell key={s} slot={s} rating={r.ratings[s]} fixes={r.fixes[s]} />
      ))}
      <td className="num">{r.freeGain > 0 ? `+${r.freeGain.toFixed(1)}` : ''}</td>
      <td className="num muted">{r.newPiece !== null ? r.newPiece.toFixed(2) : ''}</td>
    </tr>
  )
}

/** A slot's rating, with a marker for each quick fix waiting and the details on hover. */
function SlotCell({ slot, rating, fixes }: { slot: SlotKey; rating: number | null; fixes: SlotFixes }) {
  const { swap, reroll, level } = fixes
  const lines = [
    `${SLOT_LABEL[slot]}: ${rating === null ? 'nothing usable worn' : pct(rating)}`,
    swap &&
      `⇄ Equip ${setName(swap.piece.setKey)} ${statShort(swap.piece.mainStatKey)}: +${swapGain(swap).toFixed(1)}${swap.mainFrom ? ` (main ${statShort(swap.mainFrom)} →)` : ''}`,
    reroll &&
      `⟳ Reroll ${reroll.spare ? `spare ${setName(reroll.piece.setKey)} ${statShort(reroll.piece.mainStatKey)}` : 'worn'} (${reroll.chosen.map(statShort).join(' + ')}): +${reroll.gain.toFixed(2)}, ${Math.round(reroll.chance * 100)}%${reroll.finish ? `, ${finishNote(reroll.finish)}` : ''}${reroll.elsewhere ? `\n   ${belowNote(reroll.ref.char, reroll.elsewhere)}` : ''}`,
    level &&
      `⬆ Level ${setName(level.piece.setKey)} ${statShort(level.piece.mainStatKey)} +${level.piece.level}: +${level.gain.toFixed(2)}, ${Math.round(level.chance * 100)}%`,
  ].filter(Boolean)
  return (
    <td className={`qcell ${qualityClass(rating)}`} title={lines.join('\n')}>
      {rating === null ? '–' : pct(rating)}
      {(swap || reroll || level) && (
        <div className="fixes">
          {swap && <span className="fix swap">⇄</span>}
          {reroll && <span className="fix reroll">⟳</span>}
          {level && <span className="fix level">⬆</span>}
        </div>
      )}
    </td>
  )
}
