# Readyset

Adaptive four-day powerlifting program for one lifter. Vanilla HTML/CSS/JS, no dependencies.
Program logic is explained in [PROGRAM_GUIDE.md](PROGRAM_GUIDE.md).

## Using it on an iPhone

**Option 1 (zero setup): the published artifact.** Open the claude.ai artifact link in Safari, sign
in once, then Share → *Add to Home Screen*. Your data is stored in the artifact's own database, so
it follows your Claude account across devices. Needs a connection to load.

**Option 2 (true offline app): host the `docs/` folder.** Drag the `docs/` folder onto Netlify Drop
(app.netlify.com/drop), or push it to a GitHub Pages repo, or any static host. Open the URL in
Safari and *Add to Home Screen*. It installs as a standalone app with an icon, works offline, and
stores data in the phone's browser storage. Use *Copy backup* in Settings now and then.

Both copies are the same code; only the storage differs.

## Files

```
src/engine.js     training logic: blocks, sessions, readiness, weekly review, TM updates
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

## Data

Everything is one JSON state object plus one document per session. *Copy backup* in Settings puts
the whole thing on the clipboard; *Restore from backup* reads it back. *Start over* erases it.

## Changing the program

- Block schemes (sets, reps, % of Training Max per week) are the `BLOCKS` table in `src/engine.js`.
- Weekly set ceilings are `CAPS`. The four-day layout is `DAYS`. Exercises and swap lists are
  `EX` and `SWAPS`.
- Readiness thresholds are in `readinessScore`; the weekly review scoring is `weeklyReview`.
