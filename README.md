# Readyset

Adaptive four-day powerlifting program for one lifter. Vanilla HTML/CSS/JS, no dependencies.
Program logic is explained in [PROGRAM_GUIDE.md](PROGRAM_GUIDE.md).

## Using it on an iPhone

**The app (installable, works offline):** https://jeremiahsalamat.github.io/readyset/

Open that link in Safari, then Share → *Add to Home Screen*. It installs as a standalone app with
the barbell icon, works with no connection, and keeps your data in the phone's storage, which is
the only copy. *Save backup file* in Settings whenever you like (the newest file is all you need)
and keep it somewhere safe, such as Files or iCloud Drive.

**Backup copy:** the same app is also published as a private claude.ai artifact
(https://claude.ai/artifact/3nBmAmwFdemozpSyvjyNCB). It stores data in your Claude account instead
of on the phone and needs claude.ai to be up. The two copies do not share data; a backup pastes
into either.

## Deploying an update

The site is served by GitHub Pages from the `docs/` folder on `main`. To ship a change:

```bash
python build.py
git add -A
git commit -m "describe the change"
git push
```

Pages rebuilds in about a minute. The installed app checks `version.txt` every time it comes to
the front and reloads itself when a new build is there (immediately when idle, after a tap on the
banner mid-session); all data lives in storage and survives the reload. Each build carries a
content hash of the page, worker, manifest and icons (`meta readyset-build`, `docs/version.txt`,
the service-worker cache name), so an unchanged build never triggers a reload. Never ask the owner to delete and re-add the icon: that
deletes the data.

## Files

```
src/engine.js     training logic: blocks, sessions, readiness, weekly review, TM updates
src/sanitize.js   rebuilds every stored, pasted or synced state from a whitelist
src/appcore.js    the UI's testable parts: storage packing, backfill timestamps, typo check,
                  mid-session rebase, layoff tiers, the claude.ai copy's merge
src/app.js        UI: setup, today, session logger, post-session, cardio, program, history, settings
src/styles.css    design tokens and layout
src/body.html     page shell
build.py          assembles readyset.html (artifact) and docs/ (standalone PWA + icons)
readyset.html     artifact page (no html/head/body wrapper; the publisher adds one)
docs/index.html   standalone app
```

Rebuild after editing anything in `src/`:

```bash
python build.py
```

Preview locally (the `.claude/launch.json` entry serves `docs/` on port 8765):

```bash
python -m http.server 8765 --directory docs
```

## Data and backups

Everything is one JSON state object plus one document per session, stored in the browser.

**On an iPhone, the home-screen app has its own storage, separate from Safari. Deleting the icon
deletes the data.** Never delete or re-add the icon without a backup. Two backups exist:

- **Save backup file:** opens the share sheet (Files, Notes, AirDrop). Saving to iCloud Drive keeps
  the copy off the phone. Restore from the setup screen or Settings with the file picker.
- **Copy backup:** the same JSON on the clipboard, to paste into Notes and back.

Backups are the owner's decision; nothing nags. One optional Settings toggle offers a one-tap backup
card on Today after each completed session (dismissible). Settings shows the last backup and how many
sessions are newer than it. Each file is a complete,
dated snapshot (`readyset-backup-YYYY-MM-DD-HHMM.json`; iOS cannot overwrite a file from the share
sheet), so only the newest is needed and older ones can be deleted. Files are written compactly
(about 10 KB per session) and the share sheet receives the file alone, so no stray text file is saved. *Start over*
erases everything and cannot be undone.

## Tests

```bash
node tests/engine_fuzz.js
node tests/app_units.js
node tests/sw_budget.js
```

Fuzzes the engine and the state sanitizer: random settings, maxes and program positions through
session generation (loads finite, at or above the bar, rounded to the plates; set and rep counts
sane), rep-max math properties, in-session correction caps, readiness ranges, a 240-session walk
through the state machine with random early deloads and easy weeks, degenerate review inputs, and
a hostile backup (prototype keys, markup in names, out-of-range values, unknown exercise ids), and
regression checks for every rule in the guide (openers, bonus-rep caps, earned sets, the stop
rule, calibration guards, the layoff and stall rules, the dial, the readiness triggers), and that the
reviews never write to a logged session; that the time budget covers only the required work; and
that storage compaction is lossless (36 simulated weeks plus hand-made cases round-trip byte for
byte, in the new format and the old one). `app_units.js` covers `src/appcore.js`: the per-session
pack cache against an uncached pack, where a session logged after the fact lands among that date's
sessions, the typo check and number cleaning, the mid-session rebase after a max or plate change,
the layoff rule's tiers, and the claude.ai copy's merge against a stubbed account store (a delete
that never landed stays deleted; Undo and a restore bring a session back). `sw_budget.js` runs the built `docs/sw.js` (so build first)
with stubbed caches and network: a return never waits on the network, offline, updates, fonts, the
captive-portal guard, and one rest banner per deadline (a cancel, a restarted worker, the 5 s limit).

The training rules were tuned with the simulators in `dev/sim/`: `sim2.js` fits the calibration
against a hidden true max; `sim3.js` is a fitness-fatigue model of four lifter types (normal,
fragile, robust, noisy) that scores a rule change by true strength gained at equal or lower
fatigue, never by the app's own numbers. Run one with

```bash
node dev/sim/run3.js fragile baseline 36 7
```

(profile, lens, weeks, seed). The lens is `legacy` (or `baseline`, the old sim3), `A` (the app's
wiring), `B` (A plus realistic rating noise and structural gain) or `F` (B plus load-based
stimulus); judge a change under both B and F, over several seeds. `sim3.run()` takes `preload` and
`patch` hooks for variants, and `dev/sim/variants.js` holds the older named variants (`jt2like`, the
high-volume program that buried the owner, is the yardstick) for scripts that call `applyVariant`. The three review reports the rules came from are in `dev/reviews/`.

## Security

- No server, no accounts, no analytics, no third-party scripts. Network use: Google Fonts for type
  (cached by the service worker for offline use), nothing else.
- Every state object from outside the running page (storage, a pasted or chosen backup)
  is rebuilt through `src/sanitize.js`: whitelisted fields, typed and clamped values, enumerations
  coerced, unknown exercise ids and prototype keys dropped. Rendering escapes all text.
- `docs/index.html` carries a Content Security Policy that allows only the page's own scripts by
  hash, so injected markup cannot execute, and no network calls except to its own origin and fonts.
- The service worker caches same-origin GET responses and font files only.
- If the saved data ever fails to load, the app shows a recovery card (copy the stored data,
  start over) instead of a dead page.
- Known limits: `username.github.io` is one origin for every GitHub Pages project under that
  account, so do not host other projects there (they would share this app's storage); a meta
  CSP cannot stop framing, so the app blanks itself when framed.

## Changing the program

- Block schemes (sets, reps, % of Training Max per week, the opener, per-lift overrides) are the
  `BLOCKS` table in `src/engine.js`; the 22-week sequence and variation sets are `MACRO`.
- Weekly set ceilings per phase are `CAPS_BY_BLOCK`. The four-day layout is `DAYS`. Exercises and
  swap lists are `EX` and `SWAPS`.
- Every threshold (readiness bands, correction caps and the stop rule, calibration guards, deload
  triggers, the dial, the session time budget) is in `TUNE`; `applyTune(name)` holds the presets
  the simulator sweeps. The weekly review scoring is `weeklyReview`; the layoff and stall rules
  are `layoffAdjust` and `stallCheck`.
