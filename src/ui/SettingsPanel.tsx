import type { ReactNode } from 'react'
import type { EvaluationResult } from '../engine/evaluate'
import type { OffSetMode, SetMatchMode, Settings } from '../engine/types'
import { useStore } from '../state/store'

const UNLIMITED = 99

const SET_MATCH: Record<SetMatchMode, { label: string; help: string }> = {
  '4pc-t12': { label: '4pc sets, tier 1–2', help: 'Tier 1–2 4pc sets count.' },
  '4pc-all': { label: '4pc sets, all tiers', help: 'Also tier-3 fallbacks.' },
  config: {
    label: 'Config rule (4pc + 2pc)',
    help: "Also sets whose 2pc fits one of the build's 2-piece pairs.",
  },
}

const OFF_SET: Record<OffSetMode, { label: string; help: string }> = {
  off: { label: 'Off', help: 'Only the build’s own sets count.' },
  rare: {
    label: 'Rare main stats',
    help: 'DMG/EM/Healing goblets, CRIT/EM/Healing circlets, ER/EM sands.',
  },
  any: { label: 'Any slot', help: 'Any acceptable main stat. Keeps more.' },
}

export function SettingsPanel({ result }: { result: EvaluationResult }) {
  const { settings, updateSettings, resetSettings, config } = useStore()
  const set = <K extends keyof Settings>(k: K) => (v: Settings[K]) => updateSettings({ [k]: v } as Partial<Settings>)

  const tally = (pred: (lvl: number, owned: boolean) => boolean) => {
    const evs = result.evaluations.filter((e) => pred(e.piece.level, !!e.piece.owner))
    return {
      keep: evs.filter((e) => e.grade === 'keep').length,
      marginal: evs.filter((e) => e.grade === 'marginal').length,
      toss: evs.filter((e) => e.grade === 'toss').length,
    }
  }
  const rows = [
    { label: '+0', ...tally((l, o) => l === 0 && !o) },
    { label: '+1 – +19', ...tally((l, o) => l > 0 && l < 20 && !o) },
    { label: '+20 unequipped', ...tally((l, o) => l === 20 && !o) },
  ]

  return (
    <div className="page settings">
      <table className="tally">
        <thead>
          <tr>
            <th />
            <th className="g-keep">Keep</th>
            <th className="g-marginal">Marginal</th>
            <th className="g-toss">Toss</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td>{r.keep}</td>
              <td>{r.marginal}</td>
              <td>{r.toss}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Field title="1 · Set matching" help={SET_MATCH[settings.setMatch].help}>
        <div className="seg">
          {(Object.keys(SET_MATCH) as SetMatchMode[]).map((m) => (
            <button key={m} className={settings.setMatch === m ? 'on' : ''} onClick={() => set('setMatch')(m)}>
              {SET_MATCH[m].label}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={settings.commitToWornSet} onChange={(e) => set('commitToWornSet')(e.target.checked)} /> Stick to
          the set a character wears
        </label>
        <p className="hint">Once a 4pc is worn, other sets count only if ranked better; lower tiers can still go off-set.</p>
      </Field>

      <Field
        title="Off-set pieces"
        help="Any set can fill a 4pc build's free slot; best few per slot kept, by gain over current."
      >
        <div className="seg">
          {(Object.keys(OFF_SET) as OffSetMode[]).map((m) => (
            <button key={m} className={settings.offSet === m ? 'on' : ''} onClick={() => set('offSet')(m)} title={OFF_SET[m].help}>
              {OFF_SET[m].label}
            </button>
          ))}
        </div>
        <p className="hint">{OFF_SET[settings.offSet].help}</p>
        {settings.offSet !== 'off' && (
          <Slider label="Per slot" value={settings.capOffSet} min={1} max={5} step={1} onChange={set('capOffSet')} fmt={String} />
        )}
      </Field>

      <Field
        title="2 · Substat thresholds"
        help="Σ weights over starting lines (CR, CD = 1.0 each). Past +0: projected value."
      >
        <Slider label="4-line drop" value={settings.threshold4Line} min={1} max={3} step={0.05} onChange={set('threshold4Line')} fmt={(v) => v.toFixed(2)} />
        <Slider label="3-line drop" value={settings.threshold3Line} min={1} max={3} step={0.05} onChange={set('threshold3Line')} fmt={(v) => v.toFixed(2)} />
        <label className="check">
          <input type="checkbox" checked={settings.critCircletRule} onChange={(e) => set('critCircletRule')(e.target.checked)} /> Always
          level CRIT circlets with the other CRIT line
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.scaleForMainStat} onChange={(e) => set('scaleForMainStat')(e.target.checked)} />{' '}
          Scale for the main stat
        </label>
        <p className="hint">Bar scaled by what the main stat leaves possible (it can&apos;t roll as a sub).</p>
        <label className="check">
          <input type="checkbox" checked={settings.scaleLowBuilds} onChange={(e) => set('scaleLowBuilds')(e.target.checked)} />{' '}
          Scale for builds with few useful stats
        </label>
        <p className="hint">Top 4 weights under 3.05: bar scaled to what the build can reach.</p>
        <label className="check">
          <input type="checkbox" checked={settings.requireTwoLines} onChange={(e) => set('requireTwoLines')(e.target.checked)} />{' '}
          Need at least two useful lines at +0
        </label>
        <p className="hint">Stops one line clearing a scaled-down bar.</p>
      </Field>

      <Field
        title="3 · Upgrade chance"
        help="Chance the +20 beats current, or a better spare. 0% = off."
      >
        <Slider
          label="Minimum"
          value={settings.minUpgradeChance}
          min={0}
          max={0.8}
          step={0.05}
          onChange={set('minUpgradeChance')}
          fmt={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="Leveling floor"
          value={settings.levelFloor}
          min={0}
          max={1}
          step={0.05}
          onChange={set('levelFloor')}
          fmt={(v) => (v > 0 ? `${Math.round(v * 100)}%` : 'Off')}
        />
        <p className="hint">Also needs that chance to pass this share of a typical +20 (Board&apos;s 100%). +20s exempt. 0% = off.</p>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.levelFloorExemptRare}
            onChange={(e) => set('levelFloorExemptRare')(e.target.checked)}
          />{' '}
          Rare main stats are exempt
        </label>
        <p className="hint">DMG/EM/Healing goblets, CRIT/EM/Healing circlets, ER/EM sands: hard to farm.</p>
      </Field>

      <Field
        title="4 · Keep cap"
        help="Best few unequipped per character, build and slot (spare +20s count); the rest Marginal."
      >
        <Slider label="Normal" value={settings.capNormal} min={1} max={UNLIMITED} step={1} onChange={set('capNormal')} fmt={capFmt} capped />
        <Slider label="Priority" value={settings.capPriority} min={1} max={UNLIMITED} step={1} onChange={set('capPriority')} fmt={capFmt} capped />
        <label className="check">
          <input type="checkbox" checked={settings.lockMarginal} onChange={(e) => set('lockMarginal')(e.target.checked)} /> Keep marginal
          pieces locked too
        </label>
      </Field>

      <Field title="Roster" help="Unowned config characters count as Normal, empty slots.">
        <label className="check">
          <input type="checkbox" checked={settings.includeUnowned} onChange={(e) => set('includeUnowned')(e.target.checked)} /> Plan for
          characters I don't own
        </label>
      </Field>

      <button
        className="ghost"
        onClick={resetSettings}
        title={`${config.scoringDefaults.levelThreshold4Line} / ${config.scoringDefaults.levelThreshold3Line}, 20%, 80% floor, cap 3/5, 1 off-set per slot, stick to worn set`}
      >
        Reset to defaults
      </button>
    </div>
  )
}

const capFmt = (v: number) => (v >= UNLIMITED ? '∞' : String(v))

function Field({ title, help, children }: { title: string; help: string; children: ReactNode }) {
  return (
    <section className="field">
      <h3>{title}</h3>
      <p className="hint">{help}</p>
      {children}
    </section>
  )
}

function Slider(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  fmt: (v: number) => string
  /** 1–10, then a final notch for unlimited. */
  capped?: boolean
}) {
  const { label, value, min, max, step, onChange, fmt, capped } = props
  // Cap sliders run 1..11 where 11 means unlimited.
  const toSlider = (v: number) => (capped ? Math.min(v, 11) : v)
  const fromSlider = (v: number) => (capped && v >= 11 ? max : v)
  return (
    <label className="slider">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={capped ? 11 : max}
        step={step}
        value={toSlider(value)}
        onChange={(e) => onChange(fromSlider(Number(e.target.value)))}
      />
      <b>{fmt(value)}</b>
    </label>
  )
}
