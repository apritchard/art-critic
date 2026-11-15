import { describe, expect, it } from 'vitest'
import { applyEdits } from './builds'
import { defaultSettings, evaluate } from './evaluate'
import { fitPiece, piecesAhead, type BuildFit } from './fit'
import { loadPieces } from './load'
import { mainStatOk } from './match'
import type { ArtifactConfig, BuildConfig, GoodArtifact, GoodCharacter, Settings } from './types'

const W = { critRate_: 1, critDMG_: 1, atk_: 0.75, atk: 0.3, enerRech_: 0.3, eleMas: 0.2 }

const build = (over: Partial<BuildConfig> = {}): BuildConfig => ({
  name: 'DPS',
  sets4: [
    { set: 'GladiatorsFinale', tier: 1 },
    { set: 'ShimenawasReminiscence', tier: 2 },
    { set: 'CrimsonWitchOfFlames', tier: 3 },
  ],
  sets2: [],
  mainStats: { sands: ['atk_'], goblet: ['pyro_dmg_'], circlet: ['critRate_', 'critDMG_'] },
  substatPreset: 'ATK_CRIT',
  substats: W,
  erTarget: '',
  notes: '',
  ...over,
})

const config = (characters: Record<string, BuildConfig[]>): ArtifactConfig => ({
  schemaVersion: 1,
  gameVersion: 'test',
  generated: '',
  scoringDefaults: {
    levelThreshold4Line: 1.75,
    levelThreshold3Line: 1.5,
    alwaysLevelCritCircletWithOtherCritSub: true,
    rescoreAtLevels: [4, 8, 12, 16],
  },
  legacySets: [],
  sets: {
    GladiatorsFinale: { twoPiece: '', fourPiece: '', twoPieceCategory: 'atk18' },
    ShimenawasReminiscence: { twoPiece: '', fourPiece: '', twoPieceCategory: 'atk18' },
    CrimsonWitchOfFlames: { twoPiece: '', fourPiece: '', twoPieceCategory: 'ele15:pyro' },
    ScarletProof: { twoPiece: '', fourPiece: '', twoPieceCategory: 'atk18' },
  },
  substatPresets: {},
  characters: Object.fromEntries(
    Object.entries(characters).map(([k, builds]) => [k, { element: 'pyro', confidence: 'consensus' as const, enabled: true, builds }]),
  ),
})

const CRIT_LINES = [
  { key: 'critRate_', value: 3.9 },
  { key: 'critDMG_', value: 7.8 },
  { key: 'def', value: 23 },
  { key: 'hp', value: 299 },
]

const art = (over: Partial<GoodArtifact> = {}): GoodArtifact => ({
  setKey: 'ScarletProof',
  slotKey: 'flower',
  level: 0,
  rarity: 5,
  mainStatKey: 'hp',
  location: '',
  lock: false,
  substats: CRIT_LINES,
  totalRolls: 4,
  unactivatedSubstats: [],
  ...over,
})

const char = (key: string): GoodCharacter => ({ key, level: 90, constellation: 0, ascension: 6, talent: { auto: 1, skill: 1, burst: 1 } })

/** Evaluates `artifacts` and fits the last one against every active build. */
function setup(builds: Record<string, BuildConfig[]>, artifacts: GoodArtifact[], over: Partial<Settings> = {}) {
  const cfg = config(builds)
  const owned = Object.keys(builds).map(char)
  const settings = { ...defaultSettings(cfg), capNormal: 2, ...over }
  const pieces = loadPieces({ format: 'GOOD', version: 3, characters: owned, artifacts })
  const result = evaluate(pieces, owned, cfg, settings, {})
  const ev = result.evaluations[pieces.length - 1]
  const fits = fitPiece(ev.piece, pieces, result.activeBuilds, cfg, settings, ev.candidates)
  /** What the real evaluation says about the piece once a fit's edits are made to that build. */
  const after = (fit: BuildFit) => {
    const edited = { ...builds, [fit.ref.char]: builds[fit.ref.char].map((b, i) => (i === fit.ref.buildIdx ? applyEdits(b, fit.edits) : b)) }
    return evaluate(pieces, owned, config(edited), settings, {}).evaluations[pieces.length - 1]
  }
  return { ev, fits, after, settings, cfg, pieces, result }
}

/** Four pieces of `set` worn by `owner`, leaving the flower free. */
const wornSet = (set: string, owner: string): GoodArtifact[] => [
  art({ setKey: set, location: owner, slotKey: 'plume', mainStatKey: 'atk', level: 20 }),
  art({ setKey: set, location: owner, slotKey: 'sands', mainStatKey: 'atk_', level: 20 }),
  art({ setKey: set, location: owner, slotKey: 'goblet', mainStatKey: 'pyro_dmg_', level: 20 }),
  art({ setKey: set, location: owner, slotKey: 'circlet', mainStatKey: 'critDMG_', level: 20 }),
]

describe('closest build', () => {
  it("adds a set the build doesn't list, at the lowest tier that counts, and the piece is then kept", () => {
    const { ev, fits, after } = setup({ Diluc: [build()] }, [art({ lock: true })])
    expect(ev.action).toBe('unlock')
    expect(fits).toHaveLength(1)
    expect(fits[0]).toMatchObject({
      outcome: 'keep',
      setIssue: 'unlisted',
      mainIssue: false,
      edits: [{ kind: 'tier', set: 'ScarletProof', from: null, to: 2 }],
    })
    expect(after(fits[0]).grade).toBe('keep')
  })

  it('adds at tier 3 when every tier counts', () => {
    const { fits } = setup({ Diluc: [build()] }, [art()], { setMatch: '4pc-all' })
    expect(fits[0].edits).toEqual([{ kind: 'tier', set: 'ScarletProof', from: null, to: 3 }])
  })

  it('raises a tier-3 set to tier 2', () => {
    const { fits, after } = setup({ Diluc: [build()] }, [art({ setKey: 'CrimsonWitchOfFlames' })])
    expect(fits[0]).toMatchObject({ setIssue: 'tier', edits: [{ kind: 'tier', set: 'CrimsonWitchOfFlames', from: 3, to: 2 }] })
    expect(after(fits[0]).grade).toBe('keep')
  })

  it('allows a main stat the build turns down', () => {
    const sands = art({ setKey: 'GladiatorsFinale', slotKey: 'sands', mainStatKey: 'enerRech_' })
    const { fits, after } = setup({ Diluc: [build()] }, [sands])
    expect(fits[0]).toMatchObject({ setIssue: null, mainIssue: true, edits: [{ kind: 'main', slot: 'sands', main: 'enerRech_' }] })
    expect(after(fits[0]).grade).toBe('keep')
  })

  it('ranks the set above the 4pc set the character wears', () => {
    // Wearing tier-2 Shimenawa: an unlisted set has to come in at tier 1 to count.
    const { fits, after } = setup({ Diluc: [build()] }, [...wornSet('ShimenawasReminiscence', 'Diluc'), art()])
    expect(fits[0]).toMatchObject({
      setIssue: 'unlisted',
      worn: { set: 'ShimenawasReminiscence', tier: 2 },
      edits: [{ kind: 'tier', set: 'ScarletProof', from: null, to: 1 }],
    })
    expect(after(fits[0]).grade).toBe('keep')
  })

  it('drops a tier-1 worn set to tier 2 so another set can outrank it', () => {
    const piece = art({ setKey: 'ShimenawasReminiscence' })
    const { ev, fits, after } = setup({ Diluc: [build()] }, [...wornSet('GladiatorsFinale', 'Diluc'), piece])
    expect(ev.reason).toMatch(/already wear a set they rank as high/)
    expect(fits[0]).toMatchObject({
      setIssue: 'worn',
      worn: { set: 'GladiatorsFinale', tier: 1 },
      edits: [
        { kind: 'tier', set: 'GladiatorsFinale', from: 1, to: 2 },
        { kind: 'tier', set: 'ShimenawasReminiscence', from: 2, to: 1 },
      ],
    })
    expect(after(fits[0]).grade).toBe('keep')
  })

  it("counts the other pieces an edit lets into the build's cap", () => {
    const better = art({ substats: [...CRIT_LINES.slice(0, 2), { key: 'atk_', value: 5.8 }, CRIT_LINES[3]] })
    const { fits, after } = setup({ Diluc: [build()] }, [better, better, art()])
    expect(fits[0]).toMatchObject({ outcome: 'cut', edits: [{ kind: 'tier', set: 'ScarletProof', from: null, to: 2 }] })
    expect(fits[0].cand.rank).toBe(3)
    expect(after(fits[0]).grade).toBe('marginal')
  })

  it("makes no edits when the substats or what's worn stand in the way", () => {
    const weak = art({
      setKey: 'GladiatorsFinale',
      substats: [
        { key: 'def', value: 23 },
        { key: 'hp', value: 299 },
        { key: 'def_', value: 7.3 },
        { key: 'eleMas', value: 23 },
      ],
    })
    const { fits } = setup({ Diluc: [build()] }, [weak])
    expect(fits[0]).toMatchObject({ outcome: 'substats', edits: [], setIssue: null })
  })

  it("never lists the set of a piece that can be the build's off-set piece", () => {
    const circlet = (cd: number) =>
      art({ slotKey: 'circlet', mainStatKey: 'critRate_', substats: [{ key: 'critDMG_', value: cd }, ...CRIT_LINES.slice(2), { key: 'atk_', value: 5.8 }] })
    const kept = setup({ Diluc: [build()] }, [circlet(7.8)])
    expect(kept.fits[0]).toMatchObject({ outcome: 'keep', edits: [] })
    expect(kept.fits[0].cand.setMatch.kind).toBe('off')

    // The lane keeps one off-set piece per build and slot, ranked by gain: the better circlet goes first, whatever its set.
    const { ev, fits, pieces, cfg, settings } = setup({ Diluc: [build()] }, [circlet(14), circlet(7.8)])
    expect(ev.grade).toBe('marginal')
    expect(fits[0]).toMatchObject({ outcome: 'cut', edits: [], setIssue: null })
    const ahead = piecesAhead(ev.piece, pieces, fits[0].cand.ref, cfg, settings)
    expect(ahead?.lane).toBe('off-set')
    expect(ahead?.ahead.map((a) => a.piece.id)).toEqual([pieces[0].id])
  })

  it("allows only the main stat for an off-set piece the build doesn't count", () => {
    const emCirclet = art({ slotKey: 'circlet', mainStatKey: 'eleMas', substats: [...CRIT_LINES.slice(0, 2), { key: 'atk_', value: 5.8 }, CRIT_LINES[3]] })
    const { fits, after } = setup({ Diluc: [build()] }, [emCirclet])
    expect(fits[0]).toMatchObject({ outcome: 'keep', setIssue: null, mainIssue: true, edits: [{ kind: 'main', slot: 'circlet', main: 'eleMas' }] })
    expect(fits[0].cand.setMatch.kind).toBe('off')
    expect(after(fits[0]).grade).toBe('keep')
  })

  it('lists the pieces ranked above one the slot cap cuts', () => {
    const better = art({ setKey: 'GladiatorsFinale', substats: [...CRIT_LINES.slice(0, 2), { key: 'atk_', value: 5.8 }, CRIT_LINES[3]] })
    const { fits, pieces, cfg, settings } = setup({ Diluc: [build()] }, [better, better, art({ setKey: 'GladiatorsFinale' })])
    expect(fits[0].outcome).toBe('cut')
    const ahead = piecesAhead(pieces[2], pieces, fits[0].cand.ref, cfg, settings)
    expect(ahead?.lane).toBe('slot')
    expect(ahead?.ahead.map((a) => a.cand.rank)).toEqual([1, 2])
    expect(piecesAhead(pieces[0], pieces, fits[0].cand.ref, cfg, settings)).toBeNull()
  })

  it('puts builds that keep the piece first, then the ones nearest the substat bar', () => {
    const support = (name: string, substats: Record<string, number>) => build({ name, substats, sets4: [{ set: 'ScarletProof', tier: 1 }] })
    const { fits } = setup(
      {
        Bennett: [support('Healer', { hp_: 1, enerRech_: 1, hp: 0.3 })],
        Diluc: [build()],
        Xiangling: [support('Sub-DPS', { enerRech_: 1, critRate_: 0.5, critDMG_: 0.5, eleMas: 0.5 })],
      },
      [art()],
    )
    expect(fits.map((f) => [f.ref.char, f.outcome])).toEqual([
      ['Diluc', 'keep'],
      ['Xiangling', 'substats'],
      ['Bennett', 'substats'],
    ])
  })

  it('puts builds that would need the main stat allowed after every build that takes it', () => {
    // Diluc would keep an Anemo DMG goblet if he took one; Sucrose takes them, but its substats miss her bar.
    const goblet = art({ slotKey: 'goblet', mainStatKey: 'anemo_dmg_' })
    const sucrose = build({ name: 'Support', mainStats: { goblet: ['anemo_dmg_'] }, substats: { eleMas: 1, enerRech_: 1 } })
    const { fits } = setup({ Diluc: [build()], Sucrose: [sucrose] }, [goblet])
    expect(fits.map((f) => [f.ref.char, f.outcome, f.mainIssue])).toEqual([
      ['Sucrose', 'substats', false],
      ['Diluc', 'keep', true],
    ])
  })

  it('judges builds that are switched off when no evaluation is passed', () => {
    const cfg = config({ Diluc: [build()] })
    const settings = defaultSettings(cfg)
    const pieces = loadPieces({ format: 'GOOD', version: 3, characters: [], artifacts: [art()] })
    const ref = { char: 'Diluc', buildIdx: 0, build: build(), priority: 'ignore' as const, confidence: 'consensus' as const, cap: 3, owned: false }
    const [fit] = fitPiece(pieces[0], pieces, [ref], cfg, settings)
    expect(fit).toMatchObject({ outcome: 'keep', edits: [{ kind: 'tier', set: 'ScarletProof', from: null, to: 2 }] })
  })
})

describe('applyEdits', () => {
  it("resolves '*' and the avoid list when allowing a main stat", () => {
    const anyGoblet = build({ mainStats: { goblet: ['*'] }, avoidMainStats: { goblet: ['hydro_dmg_'] } })
    const b = applyEdits(anyGoblet, [{ kind: 'main', slot: 'goblet', main: 'hydro_dmg_' }])
    expect(mainStatOk(b, { slotKey: 'goblet', mainStatKey: 'hydro_dmg_' })).toBe(true)
    expect(mainStatOk(b, { slotKey: 'goblet', mainStatKey: 'eleMas' })).toBe(true)
    expect(b.avoidMainStats?.goblet).toBeUndefined()
  })

  it('adds a set or moves its tier', () => {
    const b = applyEdits(build(), [
      { kind: 'tier', set: 'ScarletProof', from: null, to: 2 },
      { kind: 'tier', set: 'CrimsonWitchOfFlames', from: 3, to: 1 },
    ])
    expect(b.sets4).toContainEqual({ set: 'ScarletProof', tier: 2 })
    expect(b.sets4).toContainEqual({ set: 'CrimsonWitchOfFlames', tier: 1 })
  })
})
