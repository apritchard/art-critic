import { useEffect } from 'react'
import type { EvaluationResult } from '../engine/evaluate'
import { FarmPage } from './FarmPage'
import { useLocal } from './local'
import { RerollPage } from './RerollPage'
import { replaceHash, RESOURCES, spendHref, type Resource } from './routes'

const RESOURCE_LABEL: Record<Resource, { label: string; title: string }> = {
  resin: { label: 'Resin', title: 'Which domain to run, and who gains most from new pieces' },
  strongbox: { label: 'Strongbox', title: 'Which set to craft from the Artifact Strongbox' },
  elixir: { label: 'Elixirs', title: 'Which piece to craft with a Sanctifying Elixir' },
  dust: { label: 'Dust', title: 'Which +20 to reroll with Dust of Enlightenment' },
  fodder: { label: 'Fodder', title: 'Whether the +0 pieces marked to unlock do more fed or boxed' },
}

/**
 * Where to spend what you have, one resource at a time: resin, Strongbox crafts, Elixirs, Dust of Enlightenment and
 * fodder. `route` is the resource a link asks for; otherwise it's the last one picked.
 */
export function SpendPage({ result, route }: { result: EvaluationResult; route?: Resource }) {
  const [saved, setResource] = useLocal<Resource>('spend:resource', 'resin')
  useEffect(() => {
    if (route) setResource(route)
  }, [route])
  const resource = RESOURCES.includes(saved) ? saved : 'resin'
  useEffect(() => replaceHash(spendHref(resource)), [resource])

  return (
    <div className="spend">
      <nav className="spend-bar">
        <span className="muted">Spend</span>
        <div className="seg" role="group" aria-label="Resource">
          {RESOURCES.map((r) => (
            <button key={r} className={resource === r ? 'on' : ''} title={RESOURCE_LABEL[r].title} onClick={() => setResource(r)}>
              {RESOURCE_LABEL[r].label}
            </button>
          ))}
        </div>
      </nav>
      {resource === 'dust' ? <RerollPage result={result} /> : <FarmPage result={result} resource={resource} />}
    </div>
  )
}
