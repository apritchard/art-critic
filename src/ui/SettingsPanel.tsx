import type { ReactNode } from 'react'
import type { EvaluationResult } from '../engine/evaluate'
import type { OffSetMode, SetMatchMode, Settings } from '../engine/types'
import { useStore } from '../state/store'

const UNLIMITED = 99

const SET_MATCH: Record<SetMatchMode, { label: string; help: string }> = {
  '4pc-t12': { label: '4pc sets, tier 1–2', help: "A piece counts for a character only if its set is one of their best or good 4pc sets." },
  '4pc-all': { label: '4pc sets, all tiers', help: 'Also counts tier-3 fallback sets.' },
  config: {
    label: 'Config rule (4pc + 2pc)',
    help: "Also counts sets whose 2pc fits one of the build's 2-piece pairs, such as any HP +20% set for Nilou. Only a few builds list pairs by default.",
  },
}

const OFF_SET: Record<OffSetMode, { label: string; help: string }> = {
  off: { label: 'Off', help: 'Only pieces from the build’s own sets count.' },
  rare: {
    label: 'Rare main stats',
    help: 'Elemental/Physical DMG, EM and Healing goblets, CRIT, EM and Healing circlets, ER and EM sands: the slots where the right main stat is hard to get.',
  },
  any: { label: 'Any slot', help: 'Any piece with an acceptable main stat can be the off-set piece. Slower and keeps more.' },
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
        <p className="hint">
          Once someone wears one of their 4pc sets, another set&apos;s pieces only count for them if it&apos;s ranked a better
          tier (worth switching to). Equal or lower tiers can still fill their off-set slot.
        </p>
      </Field>

      <Field
        title="Off-set pieces"
        help="A 4pc build has one free slot, so a piece from any set can earn its place there. It still has to pass the substat and upgrade checks, and each build keeps only its best few off-set candidates in each slot, ranked by gain over what it wears there."
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
        help="Sum of the build's weights over the starting lines (CRIT Rate and CRIT DMG are 1.0 each). Pieces past +0 are re-scored on their projected value instead."
      >
        <Slider label="4-line drop" value={settings.threshold4Line} min={1} max={3} step={0.05} onChange={set('threshold4Line')} fmt={(v) => v.toFixed(2)} />
        <Slider label="3-line drop" value={settings.threshold3Line} min={1} max={3} step={0.05} onChange={set('threshold3Line')} fmt={(v) => v.toFixed(2)} />
        <label className="check">
          <input type="checkbox" checked={settings.critCircletRule} onChange={(e) => set('critCircletRule')(e.target.checked)} /> Always
          level CRIT circlets with the other CRIT stat as a line
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.scaleForMainStat} onChange={(e) => set('scaleForMainStat')(e.target.checked)} />{' '}
          Scale for the main stat
        </label>
        <p className="hint">
          A piece can&apos;t roll its main stat as a substat. Nilou&apos;s HP% sands can reach 1.10 at best (ER, EM and flat
          HP) where her plume can reach 2.10, so its bar is 1.10 / 2.10 of the plume&apos;s: the same share of what&apos;s
          possible.
        </p>
        <label className="check">
          <input type="checkbox" checked={settings.scaleLowBuilds} onChange={(e) => set('scaleLowBuilds')(e.target.checked)} />{' '}
          Scale for builds with few useful stats
        </label>
        <p className="hint">
          Builds whose four best weights add up to less than a typical CRIT DPS&apos;s 3.05 (single-stat supports like Nilou,
          Kazuha or Xilonen) need the same share of what they can reach. Nilou&apos;s plume bar goes from 1.75 to 1.75 × 2.10
          / 3.05 = 1.20: HP% + EM passes, flat HP + ER + EM doesn&apos;t. Builds at 3.05 or more, like Skirk, are unchanged.
        </p>
        <label className="check">
          <input type="checkbox" checked={settings.requireTwoLines} onChange={(e) => set('requireTwoLines')(e.target.checked)} />{' '}
          Need at least two useful lines at +0
        </label>
        <p className="hint">
          Scaling can bring the bar low enough for one line to clear it: an EM goblet for an EM support needs only 0.57,
          and a single ER line (0.60) gets there. With this on, a +0 also needs two lines the build uses at all.
        </p>
      </Field>

      <Field
        title="3 · Upgrade chance"
        help="Chance that the finished piece beats what that character wears in the slot now. 0% turns this check off."
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
      </Field>

      <Field
        title="4 · Keep cap"
        help="Per character, build and slot, keep only the best few unequipped pieces (spare +20s count). The rest are marked Marginal."
      >
        <Slider label="Normal" value={settings.capNormal} min={1} max={UNLIMITED} step={1} onChange={set('capNormal')} fmt={capFmt} capped />
        <Slider label="Priority" value={settings.capPriority} min={1} max={UNLIMITED} step={1} onChange={set('capPriority')} fmt={capFmt} capped />
        <label className="check">
          <input type="checkbox" checked={settings.lockMarginal} onChange={(e) => set('lockMarginal')(e.target.checked)} /> Keep marginal
          pieces locked too
        </label>
      </Field>

      <Field title="Roster" help="Treat characters in the config you don't own yet as Normal, with empty slots.">
        <label className="check">
          <input type="checkbox" checked={settings.includeUnowned} onChange={(e) => set('includeUnowned')(e.target.checked)} /> Plan for
          characters I don't own
        </label>
      </Field>

      <button className="ghost" onClick={resetSettings}>
        Reset to config defaults ({config.scoringDefaults.levelThreshold4Line} / {config.scoringDefaults.levelThreshold3Line}, 20%, cap
        3/5, 1 off-set per slot, stick to worn set)
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
