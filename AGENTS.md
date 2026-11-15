# Notes for coding agents

Art Critic is a local Vite + React + TypeScript app that tells one Genshin Impact player which artifacts to lock, level, feed, farm, reroll or swap. README.md is the user-facing manual and spells out every rule and number the app uses. Read the relevant section before changing behavior, and update it in the same change.

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

  `PersistedState` is saved by a debounced PUT, retried on failure, and flushed on `pagehide`. Done marks and equips are keyed by export file name, and cleared when that file's modified time changes (`exportMtimes`).
- **`src/engine/`** is pure TypeScript with no React, and is where the unit tests live.
  - **`evaluate()`** is the core. For every active character build it runs the README's four layers:
    1. set and main-stat match (`match.ts`);
    2. the substat gate;
    3. the projected upgrade chance;
    4. the cap per character, build and slot.

    It returns an `EvaluationResult`: `evaluations` per piece (verdict and lock/unlock action), `characters` summaries and `activeBuilds`.
  - **The planners** take that result plus `pieces`:
    - `farm.ts` `planFarming`: free swaps, and domain, Strongbox and Elixir rankings from simulated drop pools;
    - `reroll.ts` `planRerolls`;
    - `improve.ts` `improveCharacter`: one character's options per slot.

    Each judges a character by the build they're wearing (`currentBuilds` and `wearing` in `farm.ts`).
  - **`projection.ts`** is the roll maths: remaining rolls, exact final-value distributions on a 0.05 grid, `chanceToBeat`, and threshold scaling (`lineCeiling`, `thresholdScale`).
  - **`er.ts`** totals Energy Recharge from ascension, weapon, artifacts and 2pc bonuses. A build's ER minimum is the low end of its `erTarget`. ER is a constraint, not a weight: free swaps and rerolls won't take a character below it.
- **`src/ui/`** holds one view per tab. `App.tsx` routes by URL hash, as `#tab` or `#tab/arg` (for example `#improve/Columbina`).

## Easy to get wrong

- **The value unit:** a piece's value is Σ weight × (substat value ÷ max 5★ roll). One max CRIT Rate roll is 1.0. Thresholds, bars and gains all use this unit.
- **Piece ids are content fingerprints:** set, slot, main stat, level and substats, plus `#n` for exact duplicates. They don't use position or location. The user's saved done marks and equips refer to these ids, so changing `fingerprint()`, or what `loadPieces` passes it, silently orphans them.
- **Equips are an ordered log** that `applyEquips` replays. Equipping a piece that someone else wears swaps the two, as in-game. Add entries with `addEquip`, and don't dedupe by piece.
- **The JSON files at the root are data, edited by hand:**
  - `genshin_artifact_config.json`: research-generated builds, keyed by GOOD keys;
  - `genshin_artifact_domains.json`: which sets drop together.

  Edits made in the Builds tab are saved as overrides in `state/user-state.json`, never in the config file.
- **The regression test** (`src/engine/regression.test.ts`) runs over the newest export in `imports/`. That folder is gitignored, so the test is skipped on a fresh clone. Its exact count is pinned to `PROTOTYPE_EXPORT` and the current config: when a config change moves it, update the number and the comment beside it.
- **`STRONGBOX_SETS` in `farm.ts`** is the in-game list as of 7.2, and a test checks every entry exists in the config. The game constants at the top of `farm.ts` (drop rates, 4-line odds, Elixir costs) are quoted in the README.
- **A new setting** goes in `Settings` (`types.ts`), `defaultSettings` (`evaluate.ts`) and `SettingsPanel.tsx`. Saved settings merge over the defaults, so older state files keep working.

## Working alongside the running app

- The user often has the dev server running with their real data. Don't stop it, and don't let tests or browser automation write `state/user-state.json`. When driving the page headless, intercept `PUT /api/state`.
- On Windows, Vite's watcher sometimes misses an edit. Check what's being served with `curl localhost:5317/src/<path>`. Touching `vite.config.ts` restarts the server, and so does editing anything in `server/`.
- `docs/screenshots/` holds the README images: headless Edge at 2× scale, each cropped to one feature.
- Files mix LF and CRLF line endings, and `.gitattributes` normalizes them. `*.bat` must stay CRLF.
