# Art Critic manual

The [README](../README.md) walks through the main workflows. This is the full reference: every screen, rule and number the app uses.

- [Exports](#exports)
- [Configure](#configure): priorities, the Building list and builds
- [The tabs](#the-tabs): Artifacts, Characters, Spend, Builds and Settings
- [Closest build](#closest-build)
- [How a piece is judged](#how-a-piece-is-judged)
- [Farming](#farming): free upgrades and the Spend rankings
- [Energy Recharge](#energy-recharge)

## Exports

Art Critic reads an [Irminsul](https://github.com/konkers/irminsul) GOOD export plus `genshin_artifact_config.json` (builds, set tiers, substat weights) and, for the Spend tab, `genshin_artifact_domains.json` (which sets drop together). Weapon and ascension stats for Energy Recharge come from `data/game-data.json` (see [Energy Recharge](#energy-recharge)).

Press **Load export…** at the top of the page and choose the `.json` Irminsul wrote, wherever it is. The file is copied into `imports/` and loaded.

- Exports in `imports/` are listed newest first in the menu beside the button, and the newest is loaded when the page opens. A copy keeps the original's modified time, so loading an old export doesn't make it the newest.
- Loading the same file again just selects it. A different file with a name that's already in `imports/` is saved as `name (2).json`, so nothing there is overwritten.
- You can also drop the `.json` into `imports/` yourself. The page shows a banner when a new one appears there.

## Configure

Every character comes with a researched build, so you can start right away. It's worth a few minutes to tell the tool who you're building and how. Everything you change is saved in `state/user-state.json` and re-scores live.

**Mark your priorities** in **Characters → Roster**:

1. Owned Lv 80+ characters start as Normal and the rest as Ignored. Change each one as needed:
   - **★ Priority:** who you want good pieces for overall. They keep 5 candidates per slot instead of 3, come first in the To level queue and the Characters tab (after 📌 Building characters), and get first pick of free upgrades. While nobody is 📌 Building, the Spend rankings count only Priority characters once anyone is Priority.
   - **Normal:** counts when judging pieces.
   - **Ignore:** doesn't count. Use it for characters you don't play, so pieces aren't kept locked for them.
2. For a character with more than one build, untick the builds you don't run.
3. Pin who you're **📌 Building** right now with the pin beside their name (here, on the Characters board, or on their page). Priority is who you care about getting good pieces overall; Building is the few you're working on now, toggled in and out as you change who you farm for. They're listed in the header (✕ unpins one) and:
   - come first on the Characters board, in Roster, in the character list, in the To level queue and in the Spend tab's tables, ahead of ★ Priority characters;
   - get first pick of a free upgrade two characters want;
   - are who the resin, Strongbox, Elixir and Feed or box rankings count by default (switch above those rankings). With nobody pinned, those count ★ Priority characters as before;
   - count toward the ⬆ and ⟳ badges' heat, as ★ characters do.

   It changes no verdict: what to lock is still decided by ★ Priority and Normal. Pinning an Ignored character makes them Normal, so they count.

"Reset to defaults" puts everyone back to the Lv 80 rule.

**Set your preferred builds** in the **Builds** tab:

1. Pick a character from the list. Tick "Include unowned" to plan for someone you don't have yet.
2. Change whatever doesn't match how you play them:
   - **4-piece sets:** tier 1 is best, and tiers 1–2 count when deciding what to keep. Add a set from the dropdown, or remove one with ✕.
     - **2pc only:** keeps a set's pieces for the build's 2-piece pairs without preferring its 4pc over them. Nilou's Bloom build runs Tenacity of the Millelith 2pc + Vourukasha's Glow 2pc for 40% HP. Neither 4pc helps Bloom, and either costs her 20% HP, so both are marked, in her C6 hybrid build too. A set marked this way still counts at its tier when keeping pieces. Free upgrades won't give up a 2pc to complete its 4pc, but will take a piece back from its 4pc to make a pair (see [Free upgrades](#farming)). Wearing its 4pc doesn't stop its partner sets counting (see [Sticking to the worn set](#how-a-piece-is-judged)).
   - **2-piece pairs:** two 2pc bonuses the build is happy with instead of a 4pc, such as ATK + ATK. A swap may trade one 2pc bonus for another as long as what's left still makes one of these pairs (see [Free upgrades](#farming)). Add a pair with the two pickers, or remove one with ✕.
     - The config lists pairs only for builds commonly run 2pc + 2pc: Nilou (both builds), Vodyanitsa and Zhongli's shielder build (HP + HP, when someone else holds Tenacity), Illuga (EM + EM, before C2 unlocks Silken Moon's Serenade), Shenhe (ATK + ATK when someone else holds Noblesse, or a Celestial Gift 2pc for ATK + ER toward her 180-200% ER target) and Mona's Hexerei support build (ATK + ER, the same Celestial Gift pairing). Every other build wants a 4pc, so free upgrades won't break one of its 2pc bonuses unless that completes one of its 4pc sets. If you run someone 2pc + 2pc, add the pair.
   - **Main stats:** toggle the sands, goblet and circlet main stats you'd accept.
   - **Substat weights:** pick a preset, or drag the sliders (1 = fully wanted, 0 = useless).
   - **ER target:** for example "120-140%". The low end becomes the build's ER minimum, and ER past the high end counts for nothing (see [Energy Recharge](#energy-recharge)).
3. To run a second build alongside the first, click "+ Copy build", rename it and edit the copy.

"Reset to research config" undoes all edits for that character.

To find which build a particular piece is missing from, open it with [Closest build](#closest-build).

## The tabs

- **Artifacts** is where you work through your pieces. Pick a set in the left rail and apply the same set filter in-game. "« Sets" folds the rail away for more room (a dropdown in the filter bar picks the set instead), and "» Sets" brings it back. It has two views, switched at the top, and an inspector beside them:
  - **Grid** lays out the set's pieces in the same order and grid as the game's inventory, every level and lock state at once, so you can lock and unlock in one pass without filtering further.
    - **In-game:** open the inventory, set Filter → Set to the set picked in the left rail, and add Not Equipped (or tick "Include equipped" here if you don't). Leave "Show 5-star Artifacts in the order of when they were obtained" off. Then work along both grids together.
    - **Each cell** shows the slot, main stat and level, with 🔒 where the piece is locked now, as the game shows it. A green **LOCK** or red **UNLOCK** bar along the bottom says what to change; dimmed cells are already right. Hover a cell for the reason for its verdict.
    - **Click a piece** to open it in the inspector (below), outlined. Click its **LOCK**/**UNLOCK** bar once you've changed it in-game, or use "Mark all done" at the end. The grid doesn't move when you do, since the game only re-sorts when the inventory is opened again. After reopening it, tick "Reopened since marking" to order by the new lock states.
    - **Keys:** <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> move the outline across the grid, <kbd>Space</kbd> marks the outlined piece's lock change done and moves to the next piece with one still to make, <kbd>L</kbd> marks it leveled, <kbd>R</kbd> rerolled, and <kbd>Esc</kbd> closes the inspector.
    - **Substats** (on by default; untick to shrink the cells) lists each piece's lines under it, so you can check you're on the right piece. They're colored like the cards, by how much the build the piece is judged for weighs them, and a line still to be revealed at +4 is in italics.
    - **⬆+4** in the corner marks a piece in the To level queue, with the stop to level it to (⬆+8 for a 3-liner still at +0). It gets hotter with the piece's expected gain once finished: the average improvement over the best the character has (what they wear, or a better finished spare), a miss counting as 0, for a 📌 Building or ★ Priority character (or anyone, when nobody is ★). The steps are fixed, so a hot badge means the same in every set: grey below 0.5 rolls, cyan outline from 0.5, blue from 1 (**high priority**), violet from 2, and glowing magenta from 3. From blue up, the cell gets a stripe of the same color across its top. When it's kept for several of those characters, the badge takes the hottest; within one step, a 📌 Building character comes first. So a sands that gains Dehya (📌) +0.08 and Yelan (★) +2.89 is violet, for Yelan. Hover for the character, the gain, the chance and its value for its EXP. The rail counts each set's high-priority pieces (⬆), and pieces marked leveled show ✓.
    - **⏸+4**, dimmed and with no stripe, marks a piece [on hold](#what-exp-is-worth): still kept and locked, but not worth its EXP right now, because your EXP on hand does more on other pieces. Its color is still its expected gain, so the most likely improvements stay easy to spot. Held pieces don't count as high priority, and the line above the grid counts them (⏸).
    - **⟳** marks a +20 worth a Dust of Enlightenment reroll, rated as in Spend → Dust (below) with the guarantee picked there: a worn piece, or a spare that rerolled could beat what someone wears. It's shaded on the same steps as ⬆, by the expected gain from one reroll (a worse result counting as 0; for a spare, over the piece it would replace), for a 📌 Building or ★ Priority character (or anyone, when nobody is ★): it appears from 0.5 rolls, and from 1 (blue) it's high priority. It's the gain, not the gain per Dust that Spend → Dust sorts by, so it means the same as ⬆. A worn piece worth more moved to someone else gets none. With "Include equipped" off, the line above the grid says how many of the set's equipped pieces have one, as a link that ticks it. Hover for the character, the gain, the chance, the two lines to pick and the Dust. Rerolls are scarcer than pieces to level, so the rail counts each set's rerolls from 0.5 rolls (⟳, in cyan, or blue when one is high priority), not just the high-priority ones. Pieces marked rerolled show ✓.
    - **The order** is level high to low, then flower → circlet, then locked before unlocked, then pieces that started with 4 lines before those that started with 3 (even at +20, when both have 4), then newest first. It was worked out from in-game screenshots and confirmed against more of the same grids.
    - **Per row** sets the grid width: 8 matches the game on PC. Row numbers help keep your place.
    - The export only has 5★ pieces, so any 4★ pieces of the set in your inventory will shift the grid.

  - **List** shows a card per piece with its verdict and why, across sets ("All sets") or one at a time. Two filters do what separate tabs used to:
    - **Show:** **Lock changes** (**LOCK** means keep: level it to the next stop, +4, +8, … (+8 first for a 3-liner), then re-export and check again; **UNLOCK** means feed or salvage it), **To level** (the leveling queue, below) or **Everything**.
    - **Level:** Any, **+0** (what the Triage tab was), **+1–19** (In progress) or **+20 spare** (+20 review: unequipped +20s).
    - Use the sort menu to match the in-game order; "Newest first" follows acquisition order. The slot and main-stat filters help find a specific piece.
    - Click the action button (or press <kbd>Space</kbd>) once you've done it in-game, and the list moves to the next piece. Use <kbd>↑</kbd>/<kbd>↓</kbd> to move and <kbd>Z</kbd> to undo. Click a card's "builds" link to see why it got its verdict, the character its reason names to open the build that decided it (the builds table's names open theirs), "inspect" to open it in the inspector, or "find in grid" to see it outlined in the grid, with its row and place in the row.
  - **To level** is the leveling queue: every piece worth leveling, already locked or not, plus equipped pieces worth finishing. The note above it says what your EXP on hand covers (see [What EXP is worth](#what-exp-is-worth)).
    - Level each piece only to its next stop (+4, +8, …). Every 4 levels adds one roll, and the early stops are cheap: +0 → +4 costs about 6% of the EXP to +20. Then re-export, and the piece is re-scored with what it actually rolled: it either continues or drops to "Stop & feed".
    - A piece that started with 3 lines goes straight from +0 to +8. Its +4 adds no roll, only the 4th line, which the export already shows, so there'd be nothing to re-check there: it's judged at +0 as it will be at +4 (see [Substats](#how-a-piece-is-judged)).
    - Each card leads with its **expected gain** (⬆): the average improvement once finished over the best the character it's kept for has (what they wear, or a better finished spare: see [Upgrade chance](#how-a-piece-is-judged)), a miss counting as 0. It's the same number and color as the grid's [⬆ badge](#the-tabs), for a 📌 Building or ★ Priority character when it's kept for one. The queue sorts by it by default, so it lists the pieces in the same order the grid rates them.
    - Then come the characters it could go to, with the chance it ends up beating the best they have once it reaches +20. "Upgrade chance" sorts by that instead. A character it's likely to beat but who turns it away at the [leveling floor](#how-a-piece-is-judged) shows the floor's chance too ("62% · floor 4%"). Many pieces are sure upgrades, so pieces tied on chance go by expected gain.
    - Then its **value for its EXP**: rolls per 100k EXP (its break-even, below). A piece [on hold](#what-exp-is-worth) shows ⏸ there and on its button: it isn't worth its EXP right now. **Best value** sorts by it, so the pieces your EXP does most on come first, held ones last. Equipped pieces come before them, since finishing those comes out of the EXP first. The other sorts still show the most likely improvements, whatever they cost.
    - With "📌 ★ first" on (the default), pieces kept for a 📌 Building character come first, then those for a ★ Priority one (by chance: pieces that could beat what one wears), and their chips lead each card.
    - The button marks it leveled (separately from lock marks), as <kbd>L</kbd> does in the grid.
  - **The inspector** opens beside either view, for the piece you clicked: its substats, verdict and why, buttons to mark it done, leveled or rerolled (with what leveling or rerolling it is worth), its builds table, and [Closest build](#closest-build): the builds nearest to keeping it, with the set and main-stat edits that would. Edits made there re-score everything at once, so you can watch the verdict change. "edit in Builds →" opens the build in the Builds tab for weights and the rest; its "← Back to Artifacts" link, or the browser's Back button, returns to the grid as you left it, with the piece still open. ✕ (or <kbd>Esc</kbd> in the grid) closes it.
    - **Where it sits:** the switch in its heading docks it at the side (◨) or the bottom (⬓). At the bottom it lays the piece and its nearest builds beside the build on screen's layers, using the width. **Auto**, the default, puts it at the bottom while the window is taller than wide (a portrait monitor) and at the side otherwise.
    - **Its size:** drag its inner edge (left at the side, top at the bottom); double-click the edge for the default size. Each dock remembers its own size.
    - On a window narrower than 900 px, docked at the side, it slides over the grid from the right instead.
  - The view, set and inspected piece are kept in the page's address, so Back and bookmarks return to them. Old links to the Triage, In progress, +20 review, Level up and Inventory tabs open the matching view.
- **◇ Off-set picks**, at the top of the list's set rail, gathers pieces kept as someone's off-set piece. Find these in-game by slot and main stat, not by set.
- **Characters** answers who needs help, and what the cheapest fix is. Its bar switches between three views, and a character's own page:
  - **Board:** every active character in one table, 📌 Building first, then ★ Priority (untick "★ first" to mix them in), then by the sort picked: weakest slot (the default, so the least built come first), average, free gain, new piece, or name (A to Z).
    - Each slot shows how good the piece worn there is for the build they wear, against what's possible with its main stat (100% is a typical well-rolled +20). Red slots are where a new piece helps most; – is empty, a 4★ piece, or a main stat the build doesn't list.
    - Under a slot, **⇄** is a free upgrade waiting (a spare +20 to equip, from Quick wins), **⟳** a Dust reroll worth half a roll or more (of the worn piece, or of a spare for that slot, as Spend → Dust rates it, but not a piece worth more moved to someone else), and **⬆** a piece to level worth half a roll or more once finished (the one that gains them most in that slot, among the pieces triage keeps for the build they wear). Hover a slot to see which pieces. The counts above the table add them up, and "With a fix waiting" hides everyone else.
    - **Free gain** sums their free upgrades (substats and ER). **New piece** is the expected gain from one on-set domain piece, as in Spend → Resin's "Who gains most".
    - Click a row to open that character's page. The 📌 pins them.
  - **Quick wins:** the [free upgrades](#farming), spare +20s to equip now, with the equips made since the export and a way to undo them.
  - **Roster** sets who counts:
    - Default: owned Lv 80+ characters are Normal, the rest are Ignored.
    - ★ Priority characters keep more candidates per slot.
    - Multi-build characters can switch builds on or off.
    - 📌 beside a name puts them on the Building list (see [Configure](#configure)); pinned characters are listed first.
    - The slot cells show how good each equipped piece is, as on the board.
    - Each character shows their total Energy Recharge, and a build flags it when they're under its minimum.
    - Click a name to open their page.

  - **A character's page** (what the Improve tab was) puts every way to improve their pieces side by side, weakest slot first. The rail lists active characters, 📌 Building first, then ★ Priority, then lowest-rated first. "Sort by" switches between Min, their weakest equipped piece, Avg, the average of their five (an empty or unusable slot counts as 0%), and A–Z, by name (📌 Building still first, ★ Priority mixed in; the number shown is Min). Picking one adds a history entry, so Back returns to the last. The heading has the 📌 pin, their Roster choice (★ Priority, Normal or Ignore), their ER against their target, and "Edit build →" for the build they're judged by.
    - Under the set line, the **off-set slot** says which slot can hold a piece of another set while they keep their 4pc: the one that isn't the set, or any one (but only one) when all five are. Options marked "off-set slot" in different slots are alternatives.
    - Each slot's options come in three groups:
      - **Free:** spare +20s that beat what they wear (flagged when Quick wins gives one to someone else), and pieces Ignored characters wear, which cost nothing. ER is judged by what the piece does to the character's total, against their ER target (see [Energy Recharge](#energy-recharge)).
      - **From others:** pieces characters who count are wearing, showing what the current wearer loses.
      - **Spend:** **Level** (unequipped pieces still to level, with the chance they beat the worn piece at +20; pieces marked to unlock are flagged, so you can lock them first), **Reroll** (the worn piece), **Reroll a spare** (unequipped +20s that a reroll could lift past the worn piece, up to 3, judged as in Spend → Dust but for this character; like leveling, pieces that would break a set bonus aren't listed, and spares Quick wins gives to someone else are flagged), **Sanctifying Elixir**, **Strongbox** (per batch of 13) and **Domain** (per 200 resin), with the same odds as in Spend.
    - Each option shows its chance of beating the worn piece, its average gain (a miss counts as no change) and its cost. Pieces that would cost a set bonus are dimmed; pieces that only fit another listed 4pc set say so, and so do pieces that trade a 2pc for another the build lists.
    - "Show N more" under a slot opens what's folded: From others, pieces that would break a set bonus, and options gaining under 0.1. Domain and Strongbox rows always show.
    - Untick **Pieces from other sets** (beside the reroll guarantee) to list only pieces of their own set: the 4pc set they wear, or with no 4pc on, the sets the page says to farm. It hides spares, others' pieces, pieces to level and spares to reroll from any other set, so off-set candidates stop crowding each slot; each slot says how many it hid. Rerolling the worn piece, Elixirs, the Strongbox and domains always show. The choice is remembered.
    - The build switcher looks at a character's other builds.

- **Spend** answers where to spend what you have, one resource at a time, picked in its bar: **Resin** (domains, and who gains most from new pieces), **Strongbox**, **Elixirs**, **Dust** (rerolls, below) and **Fodder** (feed or box). See [Farming](#farming) for how they're ranked. "Rank for" at the top picks whose gains count, and each section's explanation is folded behind its ⓘ.
  - **Dust** ranks +20s by how much a Dust of Enlightenment reroll would help: the ones your characters wear, judged by the build each is wearing, and spares (see below). Switch between them, or show both, at the top.
    - A reroll redoes a piece's upgrades from its starting values, with at least 2 landing on the two lines you pick (3 with Advanced Reshape, 4 with Decreed; switch at the top). The suggested pick is the two lines the build weights most.
    - You can keep the old stats, so a reroll never loses value. "Better" is the chance it comes out ahead, and "Gain" is the average improvement (a worse roll counts as 0), ranked per Dust: 1 for a flower or plume, 2 otherwise.
    - Dots show which lines each upgrade went to, and the row counts how many landed on stats the build doesn't use. It's computed exactly from the starting values in the export.
    - A piece worth at least 2 rolls more to someone else, and better than a real piece they wear, is flagged "Already an upgrade for …". Rerolling would throw that value away.
    - Each row shows the wearer's ER now and on average after the reroll. When the piece's ER line is needed to stay at the build's ER minimum, results that lose it count as no change, and the suggested pick may include ER (sometimes paired with a dead line, so the guaranteed upgrades feed ER and the free ones go to the good lines). When the wearer would still be past their ER target without the line, the line is spare and counts for nothing.
    - **Spare** +20s (unequipped) are judged for each character who could wear one: their build takes its main stat, and putting it on keeps their set bonuses (the same rule as [Free upgrades](#farming)). A reroll has to beat the piece it would replace, so "Better" is the chance it ends up past that piece and "Gain" the average improvement over it. Each spare is listed once, for the character it gains most, 📌 Building first, then ★ Priority while anyone is ★. [Free upgrades](#farming) (Characters → Quick wins) are left out, both the spares it lists and the slots they fill: it says to equip those first, rerolling one of its spares for someone else would undo that, and a slot it fills is getting a better piece than the one a reroll would be measured against. Once a spare is equipped, it's judged as a worn piece.
      - ER works as it does for worn pieces, with the ER total the character would have wearing the spare: results that would leave them below their build's ER minimum (or lower than they are now, when already under it) count as no change. A spare with no ER line that would do that isn't listed. When ER is all spare, neither piece's ER line counts.
      - The row says which piece it would replace, and flags a main stat change: scores compare substats only, so that trade is yours to judge. It also flags a spare triage marks to feed, so you can keep it locked.
    - A gain of 0.5 rolls or more gets the grid's [⟳ badge](#the-tabs), in the same colors: from 1 roll (blue) it's high priority, for a 📌 Building or ★ Priority character when anyone is ★. The heading counts the high-priority pieces not yet marked rerolled. "find in grid" opens the piece in the Artifacts grid, outlined. With "📌 Building, ★ Priority first" on, their pieces lead the list.

- **Builds** edits what each character uses: 4pc sets and tiers, allowed main stats per slot, and substat weights (or a preset). Edits are saved in `state/user-state.json` on top of the config, so "Reset to research config" undoes them. Everything re-scores live. "Character →" opens the character's page in the Characters tab, and when you came from another tab, "← Back to …" returns to it as you left it.
- **Settings** has every threshold, with live keep/toss counts.

**Equips since the export.** Tick a free upgrade in Characters → Quick wins, or press Equip on a spare or another character's piece on a character's page, once you've done it in-game. Every tab then treats the piece as worn until your next export: the character's ratings, farming odds and rerolls update, and the piece it replaced is judged as a spare (taking a piece from another character swaps the two, as the game does). The header counts them (click it for Quick wins), and Quick wins lists them with undo. They belong to the export they were made on, so a new export starts clean, even one saved over the old file.

Settings, roster choices, build edits, the Strongbox list, done marks and equips are saved to `state/user-state.json`. Git ignores `state/` and your exports in `imports/`, so your account data stays on this machine.

### Closest build

For a piece marked UNLOCK that you'd rather keep, Closest build finds the build it's nearest to being kept for, and shows what in that build stands in the way. It's in the Artifacts tab's inspector: click a piece in the grid, or a card's "inspect". A character's name in a card's builds table (or in its reason) opens it in the Builds tab instead, at their build, with the piece pinned above the editor. Either way it shows:

- **Now** is the piece's verdict. It updates as you edit the build below, so you can see the moment it turns into a keep.
- **Nearest to keeping it** lists the active builds, each as if it counted the piece:
  - **Main stat:** a main stat the build doesn't accept is allowed.
  - **Set:** only for a piece that can't be the build's [off-set piece](#how-a-piece-is-judged), since an off-set piece can be of any set. With the default Off-set setting, Rare main stats, that's every flower and plume and every sands, goblet or circlet with a common main stat. The Set row then says so: with Settings → Off-set pieces on Any slot, the piece could fill the build's free slot without listing its set. A set the build doesn't list is added at the lowest tier that counts (tier 2, or tier 3 once Settings counts every tier), and a tier-3 set is raised to tier 2. When the character wears one of the build's 4pc sets, the piece's set has to [outrank it](#how-a-piece-is-judged), and a tier-1 worn set drops to tier 2 to make room.
  - These are the only edits it suggests. A build that already counts the piece, as one of its sets or as its off-set piece, is shown as it is. Substat weights are your call.
  - The edited build is judged by the real rules, cap included, so other pieces the edit lets in compete for the slot too.

  The list comes in two groups:
  - **Run \<set>**: builds that run its set (list it among their 4pc sets at any tier, or take it for one of their 2pc pairs) come first, so you can see why each of them passes on it.
  - **Off-set** holds every other build. Those builds could only use it as their one off-set piece, which a spare of any set can be, so the group is folded into one line with a count and how many would keep it. Click the line to open it. It opens by itself when no active build runs the set, or when it holds the build on screen. With Off-set pieces switched off, or a main stat the Off-set setting leaves out, each of these needs the set added: that's who it would suit as an off-set piece.

  Within each group, builds that already take its main stat come first. Builds that would need it allowed are listed after them, under a label of their own: allowing an Anemo DMG goblet for Nilou makes a different build rather than a tweak, though it can show up a main stat left out by mistake. Builds that would keep it come first, fewest edits first. After them come builds where the cap cuts it (nearest the cap first), then builds it's unlikely to upgrade (likeliest first), then builds whose substat bar it misses (nearest first).

  Each row names what stands in the way ("#4 sands, top 3 kept", "12% to beat current", "<1% to beat spare +20 Obsidian Codex", "4% to reach 80% floor", "substats 1.40 / 1.75"). A build that doesn't count the piece yet names what blocks it first, then what an edit would do: "takes no HP% goblets · if allowed: keeps", "tier 3 doesn't count · at tier 2: #4 sands, top 3 kept", "set not listed · if added: keeps". Colours show where each build stands now, before any edit: green keeps it, yellow passes but the cap cuts it or it's unlikely to beat what they wear (or to reach the [leveling floor](#how-a-piece-is-judged)), and grey doesn't count it (its substats miss the bar, or it needs an edit). So a build that would keep it only with HP% goblets allowed stays grey. The summary under the layers says the same: "Not counted. With edit: …". When a finished spare is what stops a piece still to level, a second line gives its chance against what they wear too ("41% to beat current"). A spare of another set, in a build that runs the piece's own, is one they'd wear in their off-set slot, so it's labelled "off-set:" ("12% to beat off-set: +20 Scroll of the Hero of Cinder City"). Two cases lead with what they wear instead, and the spare follows:
  - **They wear all five pieces of their set**, so that spare only fits because one of the five can go off-set: "<1% to beat current +20 Heart of the Furnace", then "0% to beat off-set: +20 Scroll of the Hero of Cinder City".
  - **The build runs the piece's set, but the character wears another**: "1% to beat current +20 Disenchantment in Deep Shadow", then "<1% to beat off-set: +20 Scroll of the Hero of Cinder City". Until the set counts for them, the piece could only be their off-set piece, which their best spare of any set already beats, but what they wear now says more about the piece.

  The number beside the build is the piece's average gain at +20 over what that character wears, or over their best finished spare; hover it for the gain over what they wear as well. ▲ marks the build it gains most, among those that take its main stat: who it's best for, whether or not they'd keep it. The heading of the group that runs its set names that build too, in case its row is past the first five. Nothing is marked when it gains none of them. Pick a row to edit that build.
- **For the build on screen**, each layer gets a ✓ or ✗: set, main stat, substats, upgrade chance, leveling floor and cap.
  - Each set or main-stat edit has a button that makes it.
  - When a build runs the piece's set but counts it only as its off-set piece, the Set row says why: the set's tier doesn't count, or the 4pc set the character wears outranks it. As an off-set piece it's ranked by gain against spares of every set.
  - When the substats fall short, it lists the weight of each of the piece's lines, so you know which sliders to move.
  - When the cap cuts it, it lists the pieces of its slot ranked above it. In the off-set lane, that's the build's other off-set candidates for the slot, ranked by gain over what the character wears there. Otherwise it's the slot's candidates, ranked by projected value. They're all still to level (finished +20s take no cap place), so they're worth leveling first: one that rolls badly drops back and lets this piece move up. Every one is a link that opens the Artifacts grid at that piece's set, scrolled to it, outlined and open in the inspector, with its row and place in the row, so you can find it in-game.
  - The Upgrade row names and links the piece it's measured against, with both scores. A piece still to level shows its chance to beat it and its average at +20. A finished +20 has no rolls left, so it just beats it or doesn't.
  - When the character's best finished spare beats what they wear, the Upgrade row measures a piece still to level against that spare, ready to equip. For a piece of the build's own set, that's only a spare they could put on without breaking their sets (see [Upgrade chance](#how-a-piece-is-judged)). The row also gives the piece's chance against what they wear, since that's often far better, and the summary under the layers says when it isn't likely to beat even that. When the spare is of another set, it says why they could wear it: all five pieces they wear are of their 4pc set, so that slot can take an off-set piece; or that slot already holds their off-set piece (or nothing). With all five worn, or when the build runs the piece's set but the character wears another, the row leads with what they wear, as the list does, and ends with the chance against the spare, which is what its ✓ or ✗ is for.
  - A finished +20 is only ever measured against what's worn, so one slot can keep several spares that each beat it. So for a +20, the Upgrade row also names the character's best other +20 spare for the slot, when that spare beats what they wear too, by the same rule. If that spare scores higher, they'd equip it first and this one is a backup. Otherwise this one is their best, and the row names the next. When no other +20 spare beats what they wear, it says so. This is shown only: it doesn't change the verdict, and the gain beside the build in the list is still over what they wear.
  - The Floor row shows only for a piece still to level whose [leveling floor](#how-a-piece-is-judged) is above what the character has: its chance of finishing past it, and how what they have rates against a typical +20. The Upgrade row's ✓ is just the chance to beat what they have, so a piece can pass it and still fail the floor.
  - When that piece has a different main stat (a CRIT DMG circlet against a CRIT Rate one, say), the Upgrade row warns you. Scores compare substats only, so that trade is yours to judge, as with free upgrades in Quick wins: a CRIT Rate circlet can push someone with a CRIT Rate weapon past 100%.
  - A build that doesn't count yet (Ignored, switched off, or not owned) says so, and still shows what it would take.
- ✕ closes it. Edits made here are saved like any other build edit, and "Reset to research config" undoes them.

## How a piece is judged

For each active character build, a piece goes through four layers:

1. **Set:** the set must be one of the build's 4pc sets, tier 1–2 by default. You can widen this to all tiers, or also to sets whose 2pc fits one of the build's [2-piece pairs](#configure) (only a few builds list any by default).
   - **Sticking to the worn set:** once a character wears one of their 4pc sets, another set only counts for them if it's ranked a better tier. For example, Vesna in tier-1 Scarlet Proof no longer collects tier-2 VV flowers, but someone in their tier-2 set still collects tier-1 pieces. Pieces they're wearing always count. A 4pc of a set marked [2pc only](#configure) doesn't count here: Nilou in 4pc Vourukasha's Glow still collects Tenacity pieces for her HP + HP pair. There's a Settings toggle to turn this off.
   - **Off-set:** a 4pc build has one free slot, so a piece of any set can qualify as the off-set piece. By default this covers rare main stats only (Elemental/Physical DMG, EM and Healing goblets; CRIT, EM and Healing circlets; ER and EM sands). Each build keeps only its best off-set candidate in each slot, ranked by gain over what it wears there. Which slot ends up holding the off-set piece is open, so a Physical DMG goblet only competes with other goblets, not with a better circlet. Settings → Off-set pieces sets how many are kept per build and slot.
     - A piece this leaves out (a flower, plume or common main stat from a set nobody runs) is still tossed, but its reason says what it would do as an off-set piece: its biggest expected gain over what someone wears in that slot, and how many other spares (any set, any slot) would gain that character more. For example: "No active character uses 4pc Thundersoother · off-set: +2.38 for Lynette, 168 spares better". When no spare beats it, the reason says so ("best spare (Off-set: Any keeps it)"): set Off-set to "Any" in Settings to keep it.
2. **Main stat:** the main stat must be acceptable for the slot, and not on the build's `avoidMainStats` list.
3. **Substats:**
   - At +0, the config rule applies: the sum of the build's weights over the starting lines (including the hidden 4th line of a 3-liner) must reach 1.75 for a 4-liner or 1.5 for a 3-liner.
   - At +0, at least two of those lines must also be stats the build uses at all. Scaling (below) can lower the bar far enough for one line to clear it: an EM goblet for an EM support needs only 0.57, which a single ER line (0.60) reaches. Such a piece is tossed as "1 useful line for Diluc (ER), needs 2". There's a Settings toggle for this.
   - Past +0, the piece is re-scored on its projected +20 value, so a borderline piece whose early rolls missed drops out.
   - A 3-liner at +0 is judged now as it will be at +4. Its +4 adds no roll, only the hidden 4th line the export already gives, so leveling to +4 would show nothing new. Once its lines pass the config rule, it's re-scored straight away on its projected +20 value, and one whose starting rolls are too low is tossed ("Starting rolls low: 2.48 / 2.55 for Diluc (incl. +4 line)"). One that passes is leveled to +8, its first roll. A 3-liner from an export without its hidden line still stops at +4.
   - CRIT circlets with the other CRIT stat as a line always pass.
   - **Scaling:** the thresholds scale so every build needs the same share of what it can reach. There are two parts, each with a Settings toggle:
     - **Main stat:** a piece can't roll its main stat as a substat, so the bar drops by the share of the build's four best weights it blocks. In Nilou's Bloom enabler build, her HP% sands can reach 1.10 (flat HP, ER, EM) against 2.10 for her plume. Without this, 119 build/main-stat pairs in the config could never pass.
     - **Few useful stats:** a build whose four best weights add up to less than a typical CRIT DPS's 3.05 (CRIT Rate, CRIT DMG, ATK%, flat ATK) is measured against 3.05 instead. That's 52 of 144 builds, mostly single-stat supports: Nilou's plume bar becomes 1.75 × 2.10 / 3.05 = 1.20, and her HP% sands 1.75 × 1.10 / 3.05 = 0.63. Their key stat is still effectively required, and builds at 3.05 or more (Skirk, most DPS) are unchanged.
4. **Upgrade chance:** the chance that the finished piece beats the best that character has for the slot. That's what they wear now, or, for a piece still to level, their best finished spare when that's better: an unequipped +20 that passes the set, main stat and substat layers for them. They could equip it today, so a piece is only worth leveling if it could end up past it. A finished piece itself is judged against what they wear.
   - A piece of the build's own set only meets spares they could put on without breaking their sets (the same rule as [Free upgrades](#farming)). So once Mavuika wears 4pc Obsidian Codex with her off-set piece in the circlet, an Obsidian Codex flower is measured against the flower she wears, not against a better flower of another set she'd have to give up the 4pc to wear. Wearing all five, she could put that spare on and keep the 4pc, so it would count.
   - An off-set candidate is judged as if the off-set slot moved to its slot, so it meets every spare for that slot, off-set ones included. The minimum is 20% by default. It is computed exactly from the remaining rolls.
   - **Leveling floor:** a piece still to level also needs that minimum chance of finishing past 80% of a typical well-rolled +20 for the build and its main stat (the 100% of the [Characters board](#the-tabs)'s slot ratings), however weak what they have is. Beating a poor piece isn't enough: one that can't end up good is better replaced by a new drop than leveled. Vesna's flower rates 56%, so a Scarlet Proof flower with ATK%, CRIT DMG, flat ATK and DEF% (projected 60%) has a 62% chance to beat it but only 4% to finish past 80%, and is tossed: "4% to reach 80% floor (5.13) for Vesna · 62% to beat current (56%)".
     - It only decides whether a piece is worth leveling. Its expected gain (the ⬆ badge, the queue's order, what EXP is worth) is still over what the character has, so their weakest slots stay the hottest.
     - Finished +20s aren't held to it, since they need no more EXP: one that beats what's worn is kept as a spare.
     - Rare main stats (the Off-set list: Elemental/Physical DMG, EM and Healing goblets; CRIT, EM and Healing circlets; ER and EM sands) are exempt by default. Every flower drop is a flower, but only 1 circlet in 10 is CRIT Rate, so a better one is far harder to farm.
     - Settings → Upgrade chance sets the floor (0% turns it off) and whether rare main stats are exempt.

Then a **cap** applies: per character, build and slot, only the best 3 unequipped candidates still to level are kept (5 for Priority characters). Finished +20s take no place, since they can't roll any further: one that beats what the character wears is kept as a spare. Good spares still thin out speculative +0s, but through layer 4, by their odds of ending up past the best spare, rather than by taking their place.

The verdicts:

- **Keep:** passed everything.
- **Marginal:** passed everything but the cap. Unlocked by default; there's a setting to keep them locked. The reason says where it ranks and how many are kept, for example "Redundant: #4 sands for Furina, top 3 kept", or for an off-set piece "Redundant: #3 off-set goblet for Eula, top 1 kept".
- **Toss:** failed a layer. The card says which. When it's measured against a finished spare, the reason names the spare's set: "14% to beat Fischl's spare +20 Golden Troupe". When that spare is of another set and the piece counts toward one of the build's sets, the character would wear the spare as their off-set piece, and the reason says so: "<1% to beat Odette's off-set: +20 Scroll of the Hero of Cinder City".

When the character in a reason has more than one active build, the reason says which build it means: "Redundant: #4 sands for Nilou (Bloom enabler), top 3 kept", "0% to beat Nilou's spare +20 Obsidian Codex (C6 hybrid)", or for an off-set piece "off-set: +2.23 for Nilou (C6 hybrid), 31 spares better". A bracket in the build's name is left out unless two of their builds would read the same without it. Keep reasons always name the build.

Equipped pieces are never unlocked. Unequipped +20s are only marked to feed if no active build wants them. A decent +20 that doesn't beat what anyone wears stays locked as a "Backup".

A card's "builds" link shows each layer for every build that could use the piece.


Units: a piece's value is Σ weight × (substat value ÷ max roll), so one max CRIT Rate roll is 1.0.

## Farming

The Spend tab simulates leveled-up 5★ pieces using the game's slot, main stat and substat odds, then scores each against what every active character wears. Characters with several builds are judged by the one they're wearing: its 4pc set first, then how many main stats fit, then which build rates their pieces higher in the Roster (each slot against what that build can reach, so a build that weighs more stats doesn't win just because the same pieces add up to more for it). Switch a build off in Characters → Roster to rule it out.

- **Free upgrades** (in Characters → Quick wins): spare +20s that beat a worn piece without costing the build its set bonuses or taking the character below their build's ER minimum.
  - A swap may give up a 2pc bonus when what's left still makes one of the build's [2-piece pairs](#configure), or completes one of its 4pc sets. Trading a Gladiator's Finale 2pc for a Celestial Gift 2pc is fine once the build lists ATK + Energy Recharge, and the row says what it trades. A 4pc bonus is never traded away, even one the build doesn't list.
  - Sets marked [2pc only](#configure) count for their 2pc alone. Scores don't count the HP a set bonus gives, so without the mark a Vourukasha's Glow piece with better substats could replace Nilou's second Tenacity piece. That would complete 4pc Vourukasha's Glow and cost her 20% HP for a 4pc effect Bloom doesn't use. With both sets marked, she keeps the HP + HP pair. If she's wearing one of their 4pc, a swap back to 2pc + 2pc is fine: it gives up only the 4pc effect, which the row names.
  - ER is judged by what the swap does to the character's total, against their ER target (see [Energy Recharge](#energy-recharge)). So a piece slightly lower on substats can win by completing an ER 2pc for someone short of their target, and a piece can win by trading ER someone has to spare for better lines.

  Each spare and each slot is used once. Rows show the ER change, and flag a swap that changes the main stat (EM goblet → Dendro DMG goblet, say): scores compare substats only, so that trade is yours to judge. 📌 Building characters are listed first and get first pick of a spare two people want, then ★ Priority characters; within each group, biggest gain first. The Spend tab's rankings assume you've made these swaps. Tick one once it's equipped and every tab counts it as worn (see [Equips since the export](#the-tabs)).

- **Where to spend resin:** domains ranked by expected gain from 200 resin (10 runs, about 10.7 five-star drops). It's the per-drop gain times the drops, so slightly optimistic: a second upgrade to the same slot has to beat the first.
  - Each character farms the tier 1–2 set they already wear, or else their build's best-tier sets.
  - Sets that no domain drops are listed separately.
  - **Level first:** gains are measured against what each character wears now, so pieces you've crafted or farmed but not leveled don't lower them yet. A row flags pieces of its sets in the To level queue that triage keeps for the characters it helps (hover for the list; the link opens them in the Artifacts list), so you can level those before spending more. Pieces marked leveled there count once a new export shows them at +20.

- **Feed or box:** whether the +0 pieces marked to unlock do more fed to the To level queue or boxed in the Strongbox. Both end up as expected gain that costs EXP (a crafted piece has to be leveled too), so they're compared by gain per EXP.
  - **EXP on hand:** Sanctifying Unction and Essence from the export's materials (Irminsul writes them), pieces past +0 marked to unlock (always fed, since they give back 80% of the EXP spent on them), and the +0s if fed. Finishing equipped pieces still leveling comes out of it first.
  - **A queue piece** costs the EXP it's likely to take under the app's own rule: level to the next stop, and carry on only while its chance of beating the best the character has, and of finishing past the [leveling floor](#how-a-piece-is-judged) where that's higher, stays at your minimum (20% by default) and, when your EXP can't cover the whole queue, while that's worth its EXP (see [What EXP is worth](#what-exp-is-worth)). A piece dropped part way gives back 80% of the EXP put into it when fed, so its EXP is counted net of that. +0 → +4 is cheap, but most pieces in the queue go on, so a +0 there takes far more on average. Its gain counts only what a piece that's finished brings. The cap and the rescore bar aren't modeled.
  - **A craft** costs its 3 pieces as the 11,340 EXP they'd give, plus the net EXP to level what comes out by the same rule (most crafted pieces are dropped at +0 or their first stop: +4, or +8 for a 3-liner). It's leveled for whichever character farming the set it's likeliest to help. Each further craft of a set is worth less, the way the best of more pieces improves less on the best of fewer. A craft that adds under 0.01 (a hundredth of a max roll) isn't worth its pieces and counts as nothing. The Strongbox ranking's top 3 sets are considered.
  - One EXP budget pays for both, best gain per EXP first, which gives the split: "Box 210 of the 1,400 (70 crafts: …), then feed the other 1,190". Past it, a craft gains less than the EXP it would take from the queue. The note under it says how much of the queue the EXP pays for.
  - **The bar** shows how many times more the best craft gains per EXP than the best use your EXP can't pay for, from 8× feed to 8× box. It weighs crafts by the same rule as the split, so it leans to box exactly when the split boxes some. Hover it for both numbers. At the far box end ("EXP to spare"), the EXP covers everything worth leveling and a craft still adds something. At the far feed end ("nothing worth boxing"), no craft adds enough to be worth its pieces, or there are fewer than 3 +0s.
- **Best pieces to level**, under Feed or box: the queue pieces themselves, in the order the split spends EXP on them, best expected gain per EXP first. Each row names the piece and the stop to level it to, the character (and build) it gains most, its chance to beat the best they have, its expected gain and the EXP it's likely to take (net of what a piece dropped part way gives back), and the gain per 100k EXP it's ranked by. A dashed line marks where your EXP on hand runs out, and the note above the table says how many it reaches. "find in grid" shows the piece in the Artifacts grid, and the tick marks it leveled (as <kbd>L</kbd> does in the grid). It counts the characters "Rank for" picks, like the rest of Spend.
- **Strongbox:** the same ranking per set, for one full batch: 39 five-star pieces in, 13 of the chosen set out. Rows flag pieces to level first the same way.
  - Only sets the Strongbox offers count. The built-in list (`STRONGBOX_SETS` in `src/engine/farm.ts`) is the in-game one as of 7.2: 40 sets, leaving out A Day Carved From Rising Winds, Aubade of Morningstar and Moon, Celestial Gift, Disenchantment in Deep Shadow, Heart of the Furnace and Scarlet Proof. When the game adds sets, tick them under the Strongbox ranking; your list is saved and replaces the built-in one.
- **Sanctifying Elixir:** each character's best craft (slot, main stat, and the two highest-weighted substats).
  - Crafts are ranked per Elixir by the gain they add beyond what ~50 domain runs would likely bring that slot anyway. Easy slots like the plume, which always rolls the right main stat, rarely win.
  - "Farming instead" shows how many runs it takes on average to expect an equally big upgrade.
- **Who gains most:** every active character, with their set bonus status, upgrade chance and expected gain per on-set piece, and the slots that gain comes from. "(none)" marks a slot that's empty, 4★, or has a main stat the build doesn't list.

Resin, Feed or box, Strongbox and Elixir rankings count 📌 Building characters by default, and ★ Priority characters while nobody is pinned. If nobody is Priority either, or you switch the toggle above them, they count every active character. "Who gains most" lists Building characters first.

### What EXP is worth

Leveling costs EXP, and each step costs more than the last: +0 → +4 takes 16,300, +16 → +20 takes 117,175. A step is also cheaper than it looks when the piece is then dropped, since a piece fed to another gives back 80% of the EXP put into it: a speculative +0 → +4 costs about 3,300 if the piece is fed after, while finishing from +16 commits the full 117,175. So when EXP is short, it's worth taking more cheap looks at fresh pieces and finishing fewer pieces that would only gain a little.

- **EXP on hand** is the Feed or box budget: materials, pieces marked to unlock (the +0s as if fed), less finishing equipped pieces still leveling.
- **Who gets it first:** pieces for the characters Spend's "Rank for" counts (📌 Building by default, falling back as the rankings do), best value first. Everyone else's get what's left.
- **What EXP is worth** (a price, in rolls per 100k EXP) is where it runs out. At that price, each piece in the To level queue is leveled the cost-aware way: at each stop, carry on only while what leveling on is expected to bring (stopping the same way later) is worth the EXP it's expected to take, net of what a dropped piece gives back. The price is the one at which the pieces still worth it take all the EXP there is. When the EXP covers every piece, it's worth nothing extra and only the 20% chance (and the leveling floor) counts, as before.
- **A piece's value** is its break-even: the most EXP could be worth and leveling it still pay. Above the price, it's worth leveling now. Below it, it's **on hold** (⏸): still kept, still locked, but your EXP does more on other pieces. Hold changes no verdict: what EXP is worth moves with every export and with whose pieces count, and feeding can't be undone.

With the Building list counted first, their pieces are usually all covered and nothing of theirs is held; the price then applies to everyone else's.

## Energy Recharge

ER isn't worth a fixed amount per roll: short of what a character needs it matters, past it not at all. So wherever a character's total ER is known, the Characters and Spend tabs treat it as a requirement:

- **Total ER** = 100% + ascension stat + weapon substat (and any unconditional refinement bonus) + ER main stats and lines on the equipped artifacts + 20% per active Emblem, Silken Moon's Serenade or Celestial Gift 2pc. The export says which weapon each character holds; the stats come from [Genshin Optimizer](https://github.com/frzyc/genshin-optimizer)'s data. The dev server downloads it from GitHub on first start, trims it into `data/game-data.json` (not committed), and refreshes that file when it's a week old, so new weapons and characters show up without anything to type in. Until the first download succeeds, ER isn't shown or checked.
- **The minimum** is the low end of the build's ER target in Builds ("110-130%" → 110%). Nothing takes a character below it: free upgrades hold such a swap back, and rerolls keep the ER line it needs. A target without a percentage ("Low") sets no minimum, and ER keeps its plain weight.
- **The cap** is the high end of the target ("110-130%" → 130%), or the one number given ("220%+" → 220%). Building toward it is what ER is for, and past it ER is worth nothing.
- **Free upgrades and the finished pieces on a character's page** leave ER lines out of the substat values and count the change in the character's total instead: ER up to the cap is worth the build's ER weight per max roll (6.48%), whether it comes from a line, a main stat or a 2pc bonus, and ER lost under the cap costs the same. ER past the cap adds and costs nothing, so a swap can trade spare ER for better lines. Rows show it as "+0.7 for ER toward 220%" or "−0.4 for ER lost under 130%". Pieces still to level keep ER at its weight, since their ER isn't known yet.
- **Rerolls** count an ER line as worth nothing when the wearer would still be at their cap without it.
- Triage and the Roster's ratings keep ER at its weight: they judge pieces without knowing who will wear them.
- Weapon passives, constellations and team buffs aren't counted. A character whose weapon isn't in the export or the data shows no ER and isn't checked.

Assumptions, all in `src/engine/farm.ts`:
- 4-line chance: 20% for domain pieces, 34% for Strongbox pieces (community figures).
- Elixir pieces start with 4 lines, and at least 2 of their 5 upgrades land on the chosen lines (the 5.5 change).
- Elixir cost: 1 for a flower or plume, 2 for sands, 4 for a goblet, 3 for a circlet.
- About 1.07 five-star drops per domain run, half of them from the set you want.

And in `src/engine/fodder.ts`, for Feed or box:
- EXP to level a 5★ piece: 16,300 to +4, 270,475 to +20 (`LEVEL_EXP`, the game's table).
- A 5★ piece fed to another gives 3,780 EXP plus 80% of the EXP spent on it. Sanctifying Unction gives 2,520, Sanctifying Essence 3,780. Enhancement's chance of bonus EXP isn't counted, and neither are 4★ pieces, which the export doesn't list.
- A Strongbox craft takes 3 five-star pieces.
