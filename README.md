# Readyset

Adaptive four-day powerlifting program for one lifter. Vanilla HTML/CSS/JS, no dependencies.
Program logic is explained in [PROGRAM_GUIDE.md](PROGRAM_GUIDE.md).

## Using it on an iPhone

**The app (installable, works offline):** https://jeremiahsalamat.github.io/readyset/

Open that link in Safari, then Share → *Add to Home Screen*. It installs as a standalone app with
the barbell icon, works with no connection, and keeps your data in the phone's storage. Use *Copy
backup* in Settings every few weeks and paste it somewhere safe (Notes works).

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

Pages rebuilds in about a minute. The phone picks up the new version the next time the app is
opened with a connection (the service worker is network-first).

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

## Data and backups

Everything is one JSON state object plus one document per session, stored in the browser.

**On an iPhone, the home-screen app has its own storage, separate from Safari. Deleting the icon
deletes the data.** Never delete or re-add the icon without a backup. Three backups exist:

- **Cloud (recommended):** Settings → *Turn on automatic cloud backup*. It writes a private gist
  in your GitHub account about 15 s after every change, and *Restore from cloud* brings it back on
  a new phone or a re-added icon. Needs a fine-grained GitHub token with only the Gists permission.
- **Save backup file:** opens the share sheet (Files, Notes, AirDrop).
- **Copy backup:** the same JSON on the clipboard.

Today shows a red banner whenever there are sessions newer than the last backup. *Start over*
erases everything and cannot be undone.

## Changing the program

- Block schemes (sets, reps, % of Training Max per week) are the `BLOCKS` table in `src/engine.js`.
- Weekly set ceilings are `CAPS`. The four-day layout is `DAYS`. Exercises and swap lists are
  `EX` and `SWAPS`.
- Readiness thresholds are in `readinessScore`; the weekly review scoring is `weeklyReview`.
