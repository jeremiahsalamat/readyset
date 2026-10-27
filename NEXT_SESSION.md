# NEXT_SESSION — training-logic optimization pass (paused 2026-10-26)

The owner paused mid-task ("I'm about to max out on usage credits… when I type 'Resume.' later,
resume and finish all these processes"). Everything below is the state to resume from.

## Where things are

- **Branch `wip-training-logic`** holds all work in progress (engine, sanitizer, app, docs build).
  **`main` is what the live site serves** (GitHub Pages from `docs/`) and the published artifact;
  neither has any of this pass yet. Finish on the branch, verify, then merge into `main`, push,
  rebuild and republish the artifact (`readyset.html`) as before.
- Tests: `node tests/engine_fuzz.js` → 62,366 checks, 0 failures at pause. `python build.py` builds
  (LF only, CSP hashes self-checked). `node -e "new Function(require('fs').readFileSync('./src/app.js','utf8'))"` parses.
- Simulation harness (fitness-fatigue model, the thing to score every rule change with):
  `node dev/sim/run3.js <normal|fragile|robust|noisy> <variant> [weeks] [seed] [verbose]`
  (`run3.js` hardcodes the engine path `C:/Users/Jerm/Documents/PowerliftingApp/src/engine.js`; `variants.js`
  patches tables or applies `E.applyTune(name)` presets). Judge a change by true strength gain at
  equal or lower fatigue (fat mean / over-line days / grinds / reds), never by the app's own 1RM.
  Reference numbers at pause (36 weeks, seed 7): normal +3.6/4.7/4.1 % fat 4.9 %; robust +5.1/6.3/5.6 %
  dial +1; fragile +1.5/1.5/1.7 % fat 7.5 % dial −1; `jt2like` (what buried him) fragile −1 to −6 %, 197
  over-line days, injuries.
- Three review reports are in `dev/reviews/` (`review_program.md`, `review_longterm.md`; the
  autoregulation review `review_autoreg.md` was still being written when paused — check
  `C:\Users\Jerm\AppData\Local\Temp\claude\C--Users-Jerm-Documents-Trainers-ControlResonantTrainer\9a70d320-4da5-42da-a7b5-2ba4d84d8362\scratchpad\review_autoreg.md`
  and copy it into `dev/reviews/` if it exists; if not, its brief was: readiness score/thresholds, in-session
  correction vs RTS fatigue stops, calibration robustness to RPE error, earlier burnout prediction,
  light/deload recipes). Book notes `notes_A/B/C.md` are there too.

## Done on the branch (engine unless noted)

1. `TUNE` object: every threshold in one place; `applyTune(preset)` for sweeps.
2. Chronic-fatigue deload triggers in `weeklyReview(state, weekSessions, mesoSessions)`: reds/light
   sessions per block (window restarts after an inserted deload via `P.chronicSince`), a lift's max
   lowered twice or down 6 % in the block (`P.calibDrops` per lift), readiness fallen ≥15 points below
   the block's week-1 baseline and under 55; chronic signals only from week 2; in the last
   accumulation week a single chronic signal is ignored (planned overreach).
3. **Volume dial** `P.volumeDial` (−2..+2): lasting set offset on every lift; −1 on chronic signals
   (then, at −2, the Training Max % steps down 2.5 at a time to 85 %); +1 after a clean block in which
   every lift reached learned ≥2. Shown and hand-settable on the Program tab (`data-action="dial"`).
4. **Inserted deload**: "Deload now" / accepting the suggestion inserts a deload week
   (`P.special = {type:'deload'}`) and the block resumes at the same week (it used to skip the rest of
   the block). Peak has no deload → easy week instead. Easy week mid-week resumes the same day.
5. Review scoring: "every set on target" scores +1 (so volume can climb when the lifter just hits the
   numbers); week 1 after a deload earns nothing for "easier"/"easy"/"recovered" (freshness ≠ capacity).
6. Earned sets never reach Peak; phase caps `CAPS_BY_BLOCK` Build 14/18/10, Strength 12/16/9,
   Peak 8/12/6 via `capFor(state, lift)`; earned sets land on the competition lift first, variants only
   from the second step (program review says primary only — see pending #2).
7. **22-week macro** `MACRO` = Build A, Build B, Strength A, Strength B, Peak (optional), then an
   automatic easy week (2 weeks if ≥2 blocks were rough); `P.macroPos`, `P.variantSet`; each block has
   `variation` (A) and `variationB`. Volume search: `P.runCeil` = learned+1 (max 3); learned +1 if the
   run was clean and reached its ceiling, −1 if a lift was flagged twice.
8. Calibration: min RPE 6.5 for evidence; `calibDrops` per lift.
9. App: weekly review passes meso sessions and applies dial/TM%; Program tab shows the macro strip,
   the dial, variant set, phase caps; deload prompt wording. Sanitizer covers all new fields.

## Pending, in order (do these, then verify, then ship)

### A. Program-review items (dev/reviews/review_program.md) — the batch that was being applied when paused
1. **Bonus reps**: primary slot only, and capped so the set stops at RPE 9:
   `plus = max(0, min(block.plus, floor(expectedRIR(pct1rm, reps)) − 1))` → Build +2/+1/0/0, Strength +1/+1/+1.
2. **Earned sets to the primary only** (`setAdj` applied only when `slot.role === 'primary' && ex.mult === 1`).
3. **Peak & Test opt-in, default off** (`settings.includePeak: false` in `defaultState`; sanitizer
   `bool(get(S,'includePeak'))` — the owner's stored `true` survives; setup checkbox default unchecked), and
   **Strength week 3 opens with one single** at 1.02×TM, RPE 8 target (scheme `opener: {pct:1.02, rpe:8}`,
   set `kind:'single'` after warm-ups, full/trim modes only), counted in `sessionEstimate` at weight 1
   (no first-set discount). App: render `kind==='single'` as "opener"; guide: set safeties for it.
4. **DAYS**: Day B secondary = `hinge_variation`, Day D secondary = `press_secondary` (hinge no longer
   24 h after the heavy pull; Friday upper only).
5. **Build deadlift 6s**: `primaryByLift.deadlift = [{3,6,.80},{4,6,.825},{4,6,.85},{4,5,.875}]`, used via a
   `schemeFor(w)` helper in `buildSession` (role primary + lift deadlift in Build).
6. **Build A squat variation = paused squat** (barbell twice a week; belt squat stays a swap). Build B =
   other bar position (already).
7. **Calibration guard rails**: a lift's calibrated max may rise at most once per calendar week
   (`L.upWeekKey = mesoCount-week`), and a downward move needs `confHigh ≥ 1.5` (evidence from sets with
   target/reported RPE ≥ 7) or `est < 0.95×cur`.
8. **Time gate**: `canAdd` also requires next week's heaviest session `estimateMinutes ≤ 70`; warm-up ramp
   for targets ≥ 300 lb = bar + [0.5×5, 0.65×3, 0.78×2, 0.88×1].
9. Strength/Peak primary rest = `restPrimary + 60 s` (Build unchanged).
10. `cardioMin` default 40 for new setups (owner's stored 60 stays); guide: 1,500 kcal/week is a ceiling,
    100-150 min/week of easy cycling is enough.
11. **Layoff rule** (engine `layoffAdjust(state, days)` called from the check-in): 7-13 days missed → repeat
    the current week at −5 % loads with earned sets cleared; 14-20 → restart the block at week 1, 1RM −5 %;
    ≥21 → restart at Build week 1, 1RM −10 %. Show the result on the check-in card.
12. Guide text: within-zone rep undulation is endorsed (the "no mixing rep zones" sentence is too strong).
### B. Long-term-review items still open (dev/reviews/review_longterm.md)
13. **Silent stall rule** (P1-P5): per lift, smoothed estimate at the end of each macro's last Strength
    deload → `L.hist[]`; stall = <1 % gain over a macro and never flagged ≥2 → next macro: Build learned +1,
    then (next stalled macro) alternate variation set for that lift, then bench-only secondary swap; fatigue
    stall (<1 % with a flag) → learned −1 and a 2-week easy block. Log a coach note after three stalled macros.
14. Optional cycle adaptation A1-A4 (Build×3 if Strength gained <1 % unflagged; Strength×3 if ≥2 %; skip
    Peak if nothing to show). Lower priority than 13.
15. Learned fatigue allowance per lift (post-deload rebound ≥3 % → allowance +0.01, cap 0.06; <1 % → −0.01).
16. Guide sentence: small surplus in Build, maintenance in Strength and Peak.
### C. Autoregulation review (when `review_autoreg.md` exists): apply its prioritized rule changes,
    scoring each with `run3.js` across profiles and 3 seeds.
### D. Verify and ship
- `node tests/engine_fuzz.js` (add regression checks for A1-A11, the macro and the dial);
- `run3.js` normal/fragile/robust/noisy × seeds 3/7/11, 36 and 72 weeks, baseline vs `jt2like`;
- browser at phone size (`.claude/launch.json` → copy to the primary cwd's `.claude/`, `preview_start readyset`):
  setup with Peak unchecked, a session with the opener single, Program tab macro strip and dial, deload-now
  then next session (inserted deload), restore of an old-format backup (`migrate` + sanitizer);
- update `PROGRAM_GUIDE.md` (macro, dial, chronic triggers, inserted deload, phase caps, opener single,
  deadlift 6s, new day layout, cardio ceiling, layoff rule, stall rule) and README;
- merge `wip-training-logic` into `main`, `python build.py`, commit, `git push`, publish `readyset.html`
  to the artifact; update the memory note; tell the owner what changed and what to expect on first open.

## Gotchas learned this session
- Bash heredocs in this environment mangle backslash escapes (`\n`, `\r`): write patch scripts with the
  Write tool and run `python -I file.py`; never put `\\n` literals through a heredoc.
- `grep -c $'\r'` is unreliable here; check line endings with a Python script (`b.count(bytes([13]))`).
- `node` cannot `require` `/c/...` POSIX paths; use `C:/...`.
- Building while the artifact watcher re-reads `readyset.html` can throw EINVAL once; rerun.
- On iOS a home-screen web app has its own storage: never advise deleting/re-adding the icon without a backup.
