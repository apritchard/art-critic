# Notes for coding agents

Art Critic is a local Vite + React + TypeScript app that tells one Genshin Impact player which artifacts to lock, level, feed, farm, reroll or swap. `docs/manual.md` is the user-facing manual and spells out every rule and number the app uses. Read the relevant section before changing behavior, and update it in the same change. README.md is the short tour (setup, the three workflows and screenshots): update it too when a workflow or a highlight it shows changes.

## Commands

- `npm run dev`: the only way to run the app, at http://localhost:5317. `start.bat` runs `npm install` first if needed. There's no production build, because the API is middleware inside the Vite dev server.
- `npm test`: every vitest suite. For one file, run `npx vitest run src/engine/farm.test.ts`; for one test, add `-t "part of its name"`.
- `npm run typecheck`: `tsc --noEmit` over `src/`, `server/` and `vite.config.ts`. There's no linter, so typecheck plus tests are the gate.
- Node 22.12 or newer (vitest 5 requires it).

## How it fits together

- **`server/artCriticPlugin.ts`** is a Vite plugin. Its `configureServer` serves:
  - `/api/exports` and `/api/exports/:name`: Irminsul GOOD exports in `imports/`, newest first;
  - `POST /api/exports/:name?modified=<ms>`: the header's Load export button. `saveExport` checks the body is a GOOD export and copies it into `imports/` with the original's modified time. It never overwrites: the same bytes reuse the existing file, and a different file with a taken name gets ` (2)`. It answers `{ name }`, the name it saved under;
  - `/api/config` and `/api/domains`: the two JSON files at the repo root;
  - `/api/game-data`;
  - `GET` and `PUT /api/state`: `state/user-state.json`, written atomically.

  It answers only local Host headers (`isLocalHost`), because its middleware runs before Vite's own host check. Requests that change files also need a local `Origin` when there is one (`isLocalOrigin`), since a website can POST to localhost without a preflight. It pushes the HMR custom events `art-critic:exports-changed` (with the file's name and `mtime`, so the page can ignore the copy it just loaded) and `art-critic:game-data-changed`. Server files import each other with the `.ts` extension, which Vite's native config loader needs.
- **`server/gameData.ts`** downloads Genshin Optimizer's `allStat_gen.json` and trims it to the `GameData` shape in `src/engine/er.ts`. It keeps `data/game-data.json` (gitignored) under a week old. Without that file the ER model is null and ER features switch off rather than break.
- **`src/state/store.tsx`** is the only stateful layer. It:
  - fetches everything and validates the export (`parseExport`);
  - builds `pieces` as `applyEquips(loadPieces(export), equips)`;
  - layers the user's build overrides onto the config (`applyOverrides`);
  - merges saved settings over `defaultSettings`;
  - builds the ER model.

  `PersistedState` is saved by a debounced PUT, retried on failure, and flushed on `pagehide`. Done marks and equips are keyed by export file name, and cleared when that file's modified time changes (`exportMtimes`). The Building list (`building`, who the user is working on now) is not: it outlives exports.
- **`src/engine/`** is pure TypeScript with no React, and is where the unit tests live.
  - **`evaluate()`** is the core. For every active character build it runs the manual's four layers:
    1. set and main-stat match (`match.ts`);
    2. the substat gate;
    3. the projected upgrade chance;
    4. the cap per character, build and slot.

    It returns an `EvaluationResult`: `evaluations` per piece (verdict and lock/unlock action), `characters` summaries and `activeBuilds`. Its optional last argument is the Building list, which only sets `ActiveBuild.building`: it orders lists and picks, never verdicts. `standing()` ranks a build for those orders (2 Building, 1 ★ Priority or anyone while nobody is ★, 0 otherwise); `levelPriority`, `rerollPriority`, `planRerolls`' spares and `freeSwaps`' first pick all use it or the same order, and `FarmScope` has a `'building'` scope that falls back to `'priority'`, then `'all'`. Layers 1–4 and the cap live in `judge()`, which takes any list of builds; each build is judged on its own, so `fit.ts` passes it edited copies. A piece still to level is measured against the best finished spare for its build and slot when that beats what's worn (`Candidate.spare`), and finished pieces take no cap place: they're kept if they beat what's worn. For an on-set candidate, that spare must be one the character could put on without breaking their sets (`Judgement.wearable`, which is `swapSetFit` from `farm.ts`); an off-set candidate meets every spare, since it's judged as if the off-set slot moved to its slot. `bestOtherSpare` in `fit.ts` applies the same rule.
  - **`fit.ts`** `fitPiece` is Closest build: for one piece, each active build that doesn't count it is edited just enough that it does (`applyEdits` from `builds.ts`), judged by `judge()` so the cap counts what the edits let in, and ranked closest to keeping it first. Builds that run the piece's set (`onSet`: it's in their `sets4` at any tier, or a 2pc pair takes it) come before the rest, which could only use it off-set; within each, builds that need the main stat allowed come last (a different build, not a tweak). The panel shows the two as groups, the off-set one folded. The main stat is allowed; the set is listed (`setEdits`) only for a piece that can't be an off-set piece, since off-set pieces can be of any set. `sidelined` says why a build that runs the set counts it only off-set (a tier that doesn't count, or the worn set). `setEdits` and `sidelined` mirror the set layer (`matchSet`, `commitmentOf`), so change them together. `piecesAhead` lists what the cap ranks above a cut piece in its slot: in that slot's off-set lane (off-set candidates are ranked per build and slot, by gain) or its cap pool. `bestOtherSpare` finds a build's best other finished spare for a +20's slot, picked as step 4 of `judge()` picks the spare bar; the Upgrade row shows it, since finished pieces are only measured against what's worn. The UI is `FitPanel.tsx`, at the top of the Builds editor and in the Artifacts tab's inspector (`PieceInspector.tsx`).
  - **The planners** take that result plus `pieces`:
    - `farm.ts` `planFarming`: free swaps (Characters → Quick wins), and domain, Strongbox and Elixir rankings from simulated drop pools (the Spend tab);
    - `reroll.ts` `planRerolls`: worn +20s against themselves, and spare +20s against the piece they'd replace (`rerollOdds`' `bar`), for the character each gains most, leaving out `freeSwaps`' spares and the slots they fill. `spareReroll` judges one spare for one character, for both this and Improve. `rerollPriority` in `inventory.ts` turns either into the Artifacts grid's ⟳ badge;
    - `improve.ts` `improveCharacter`: one character's options per slot (a character's page in the Characters tab);
    - `board.ts` `characterBoard`: the Characters board, from a `FarmPlan` and `planRerolls`' options: each character's worn build, slot ratings, ER, and per slot the best free swap, reroll and piece to level (`FIX_MIN_GAIN`);
    - `fodder.ts` `planFeedOrBox` (Spend → Fodder, from the `FarmPlan` and the export's `materials`): splits the +0 pieces marked to unlock between feeding and Strongbox crafts by gain per EXP. `levelingOutlook` is the expected EXP and gain of leveling stop by stop under the upgrade-chance layer only; `allocate` spends one EXP budget on queue pieces and crafts, best rate first; `queue.pieces` lists the queue in that order, with what the budget funds (Spend → Fodder's "Best pieces to level"). Its game constants (`LEVEL_EXP`, fodder and material EXP) are quoted in the manual.

    Each judges a character by the build they're wearing (`currentBuilds` and `wearing` in `farm.ts`): a listed 4pc set worn, then usable slots, then the Roster ratings (`ratingsOf`), never raw totals, which favor builds that weigh more stats. All three decide whether a swap keeps a character's sets fit with `setsFit` / `swapSetFit` in `farm.ts`: every bonus stays, or only 2pc bonuses go and what's left still makes a listed 4pc or one of the build's `sets2` pairs, at least as well as before. The 2pc categories come from the config, so they take it as an argument.
  - **`projection.ts`** is the roll maths: remaining rolls, exact final-value distributions on a 0.05 grid, `chanceToBeat`, and threshold scaling (`lineCeiling`, `thresholdScale`).
  - **`er.ts`** totals Energy Recharge from ascension, weapon, artifacts and 2pc bonuses. A build's `erTarget` gives a minimum (`erNeed`, the low end) and a cap (`erCap`, the high end, or the one number). Free swaps and rerolls won't take a character below the minimum. Where the total and target are known, free swaps and Improve's finished pieces value pieces with `withoutER` weights plus `erChangeValue`: the change in the total, at the build's ER weight up to the cap and 0 past it. Don't also count ER lines by weight there, or ER is counted twice. Rerolls drop the ER weight only when the line is all spare (`rerollTerms`, and `spareTerms` for spare pieces). Triage and Roster ratings keep the plain weight.
- **`src/ui/`** holds one view per tab: Artifacts, Characters (`CharactersPage.tsx`: the board, Quick wins, `RosterPage.tsx`, and a character's page, `ImprovePage.tsx`), Spend (`SpendPage.tsx`: `FarmPage.tsx` per resource, and `RerollPage.tsx` as Dust), Builds and Settings. `App.tsx` routes by URL hash, as `#tab` or `#tab/arg` (for example `#characters/Columbina`, `#characters/board`, `#spend/dust`), and switching tabs pushes a history entry so Back works. `LEGACY_TABS` sends the old Roster, Improve, Farm and Reroll tabs' links to their new homes. The Builds tab also takes `#builds/<char>/<build index>?piece=<piece id>` (`routes.ts`); without a character it opens the piece's closest build. The Artifacts tab (`ArtifactsPage.tsx`) is `#artifacts/<grid|list>?set=<set>&piece=<piece id>`: the grid (`InventoryView.tsx`) or list (`ListView.tsx`) with the inspector (`PieceInspector.tsx`) beside it for `piece`. Its set rail folds away, and the inspector docks at the side or bottom (`Dock`; auto follows `(orientation: portrait)`) at a size dragged from its inner edge: all per-browser layout, kept in localStorage (`useLocal`), not `PersistedState`. It keeps that URL current with `replaceHash`, which adds no history entry and tells `App` the latest URL, so the Builds tab's "← Back to …" link returns to it as it was. The list's Show and Level filters replaced the Triage +0, In progress, +20 review and Level up tabs; `LEGACY_LISTS` maps their old hashes (and `#inventory?piece=`) onto it, so old links and saved tabs still work.
- **`src/engine/inventory.ts`** `inventoryOrder` is the game's inventory order, which the Artifacts grid mirrors cell for cell. It was inferred from in-game screenshots of one set against an export, matching the order on export order (`idx`) and the export's lock states. Check any change against a real screenshot.

## Easy to get wrong

- **The value unit:** a piece's value is Σ weight × (substat value ÷ max 5★ roll). One max CRIT Rate roll is 1.0. Thresholds, bars and gains all use this unit.
- **Piece ids are content fingerprints:** set, slot, main stat, level and substats, plus `#n` for exact duplicates. They don't use position or location. The user's saved done marks and equips refer to these ids, so changing `fingerprint()`, or what `loadPieces` passes it, silently orphans them.
- **Equips are an ordered log** that `applyEquips` replays. Equipping a piece that someone else wears swaps the two, as in-game. Add entries with `addEquip`, and don't dedupe by piece.
- **The JSON files at the root are data, edited by hand:**
  - `genshin_artifact_config.json`: research-generated builds, keyed by GOOD keys. Leave a build's `sets2` empty unless 2pc + 2pc is a common way to run it (Nilou, say), not just a transitional fallback: a pair lets free swaps give up 2pc bonuses, and widens the "Config rule" set match;
  - `genshin_artifact_domains.json`: which sets drop together.

  Edits made in the Builds tab are saved as overrides in `state/user-state.json`, never in the config file.
- **The regression test** (`src/engine/regression.test.ts`) runs over the newest export in `imports/`. That folder is gitignored, so the test is skipped on a fresh clone. Its exact count is pinned to `PROTOTYPE_EXPORT` and the current config: when a config change moves it, update the number and the comment beside it.
- **`STRONGBOX_SETS` in `farm.ts`** is the in-game list as of 7.2, and a test checks every entry exists in the config. The game constants at the top of `farm.ts` (drop rates, 4-line odds, Elixir costs) are quoted in the manual.
- **A new setting** goes in `Settings` (`types.ts`), `defaultSettings` (`evaluate.ts`) and `SettingsPanel.tsx`. Saved settings merge over the defaults, so older state files keep working.

## Working alongside the running app

- The user often has the dev server running with their real data. Don't stop it, and don't let tests or browser automation write `state/user-state.json`. When driving the page headless, intercept `PUT /api/state`.
- On Windows, Vite's watcher sometimes misses an edit. Check what's being served with `curl localhost:5317/src/<path>`. Touching `vite.config.ts` restarts the server, and so does editing anything in `server/`.
- `docs/screenshots/` holds the README images: headless Edge at 2× scale, each cropped to one feature. Use a separate headless instance with its own profile (the user's browser is usually open), and answer every non-GET `/api/*` request in the driver (CDP `Fetch`) so it can't save state.
- Files mix LF and CRLF line endings, and `.gitattributes` normalizes them. `*.bat` must stay CRLF.
