# Readyset autoregulation and fatigue-management review

Reviewed: `C:\Users\Jerm\Documents\PowerliftingApp\src\engine.js` as saved at **2026-10-26 22:07:44** (785 lines,
snapshot in `scratchpad\review_autoreg\engine_snapshot.js`). The file was being edited while this review ran
(692 -> 768 -> 785 lines; a `TUNE` table, chronic deload triggers, a `volumeDial`, inserted deloads, an
"every set on target" bonus and a `freshWeek` guard all appeared mid-review). Everything below is against the
snapshot; `app.js` (21:48 version) and `PROGRAM_GUIDE.md` were read for the UI side. Nothing in the app was edited.

Lifter context: intermediate, 4 days/week at home, burnt out on J&T 2.0; priority 1 is never being buried
again, priority 2 is sustainable strength and muscle.

## Method

1. Static reading of readiness, modes, `liftCorrection`, `sessionEstimate`/`calibrate`/`fatigueAllowance`,
   `weeklyReview`, deload triggers, `volumeDial`, `startDeloadNow`, and the `BLOCKS` light/deload recipes.
2. Enumeration probes (`review_autoreg\probe.js`): all 625 check-in combinations, the correction response
   table per block, the weekly score space, the fatigue allowance.
3. The parent's harness `sim2.js` (hidden true max, no fatigue dynamics) and a new fitness-fatigue harness
   `review_autoreg\sim4.js`: fatigue per lift accrues from each set (reps x (load/true)^3), decays with
   tau 8 days, depresses the true max, raises felt RPE, and drives sleep/energy/soreness/motivation answers,
   next-session soreness and the post-session rating. Profiles: `normal`, `fragile`, `sturdy`, `overreach`
   (a J&T-style burnout candidate: every set costs 2.5x the fatigue). Reporting bias -1 = the lifter logs RPE one
   point lower than felt (the under-reporter). Variants monkey-patch proposed rules. `app` = engine as app.js
   wires it today; `wired` = engine fully wired (see Bugs). 26 weeks, 104 sessions, same seed everywhere.
   Limitation: the harness does not reward volume, so "same gain with fewer sets" is not evidence that fewer
   sets are free; it is evidence about fatigue, misses, overshoots and max tracking only.

Headline numbers (overreach profile, bias 0, 26 weeks): app-as-wired peak fatigue 0.88, 27 sets at RPE >= target+2,
6 "crushed" sessions, 6 missed sets, bench true max down 11% mid-block. With the yellow load nudge + stop rule
+ allowance-on-rise-only ("all"): peak fatigue 0.71, 12 overshoots, 3 crushed, 1 miss, and the best true gains
of any variant (squat +6.6%, deadlift +3.8% vs +4.7%/-0.7%). For the normal lifter those same rules cost nothing
(misses 1 -> 0, gains unchanged). For the under-reporter (bias -1) they cut misses from 11-20 to 2-4.

## Prioritized rule changes

Format: change -> numbers; basis; effect on fatigue / on progress; confidence.

### P1. Wire the new engine features into app.js (they are only half live)
- `afterSession()` calls `E.weeklyReview(state, sessionsOfWeek())` with no third argument, so
  `mesoSessions` falls back to the week: "4 red check-ins this block" and "4 light sessions this block" can
  only fire if every session of one week was red/light. Pass `sessionsOfMeso()`.
- The review returns `volumeDial`, and nothing in app.js stores it (`P.volumeDial = r.volumeDial`), so the dial
  can only move up (in `advanceDay`) and never down. Store it.
- `sessionsOfWeek()`/`sessionsOfMeso()` keep deload sessions (`isDeload`) and, after an inserted deload, the
  sessions logged before it under the same week number. The repeated week's review then re-scores old
  sessions (the same "two crushing sessions" can re-fire) and dilutes RPE deltas with deload sets. Exclude
  `isDeload` sessions and any session before the last inserted deload (tag sessions with a `pass` counter or
  compare `ts` to the insertion time). Also reset `P.calibDrops` and `P.readinessBase` when a deload is inserted;
  today `calibDrops` persists, so "max lowered twice this block" stays true for the rest of the block.
- `applyTune` presets `strictDeload`/`laxDeload` set keys that do not exist (`calibDropsBlock`,
  `readinessAvgWeek`); `defaultState().program.calibDrops` is `0` where the code expects an object.
- Basis: code reading. Effect: makes the intended chronic triggers and the dial actually work; prevents double
  deload suggestions. Confidence: high.

### P2. Yellow should nudge the load, not only the volume
- Yellow: loads -2.5% (one rounding step at these weights), target RPE -0.5, bonus reps off, earned sets off
  (as now). Green and red unchanged.
- Basis: JuggernautAI and RTS both answer low readiness with a small load/RPE change rather than a volume-only
  change; "the plan comes first" (Israetel p.96) is kept because sets and reps are unchanged. In the
  simulation this single change cut missed sets for the under-reporter from 11 -> 3 (normal), 18 -> 9
  (fragile), 20 -> 6 (overreach), overshoots >= 2 RPE from 20 -> 7 (overreach, bias -1), peak fatigue 0.84 ->
  0.77, with true gains unchanged or better in every profile.
- Effect: fatigue clearly down on so-so days (which are 45-60% of all days under the current scoring, see P4);
  progress unchanged (2.5% at RPE 6-8 is inside the noise of the RPE scale). Confidence: high.

### P3. Add an explicit exercise stop rule (RTS "RPE stop")
- Stop the exercise and log the remaining sets as cut when: (a) any set misses reps; (b) a non-first set lands
  >= target + 2 after the correction has already moved the load; (c) the correction hits the 85% floor (today
  this only "offers" to cut; make it the default with an undo).
- Basis: Tuchscherer's fatigue-percent / RPE-stop logic: once the day's e1RM has dropped past the allowed
  fatigue (3-7%), more sets add fatigue without adding stimulus; a missed rep is already a 4-6% e1RM drop.
  Simulation (overreach, bias 0): peak fatigue 0.88 -> 0.69, overshoots 27 -> 13, misses 6 -> 1, deadlift true
  gain -0.7% -> +3.1%; 8 stops in 26 weeks. Normal lifter: 0 stops, no change.
- Effect: fatigue down sharply on the days that matter; progress up (less junk fatigue). Confidence: high for
  (a), medium-high for (b)/(c).

### P4. Keep green at 60, move red to 35, and stop a single bad answer from forcing a light day
- `TUNE.readiness = { green: 60, yellow: 35 }`.
- Today 3/3/3/3 = 50 (yellow), sleep 1 with everything else average = 35 (red), soreness 5 alone = 38 (red),
  2/2/2/2 = 38 (red); 176 of 625 combinations are red. With red < 35, red needs at least two poor answers
  (1/2/3/3 = 29, 2/2/4/3 = 30 stay red).
- Basis: one night of bad sleep has small effects on maximal strength (Knowles et al. 2018 review; partial
  restriction barely moves 1RM), and wellness items have good sensitivity but poor specificity on a single
  day (Saw et al. 2016). Keeping green at 60 is deliberate: in the simulation lowering green to 55
  (`readyLax`) halved trimmed days with no change for the normal lifter but raised overshoots 20 -> 23 and
  crushed sessions 6 -> 7 for the overreacher; raising it to 65 (`readyStrict`) produced 37 light sessions in
  26 weeks. With P2 in place a yellow day is a mild, cheap adjustment, so a high green bar costs little.
- Effect: fewer unnecessary light sessions (progress up a little), no fatigue cost because red still exists for
  genuinely bad days. Confidence: medium.
- Weights: optional. Sleep .30 / energy .30 / soreness .20 / motivation .20 would match Saw 2016 (fatigue and
  sleep quality most responsive; mood least) and avoid double-counting soreness, which already has its own
  per-region channel in the weekly review. Low priority, low-medium confidence. Do not add a stress tap: the
  Hooper index has one, but Saw found stress/mood less responsive than fatigue and sleep, and "energy" already
  absorbs it; the extra tap would buy little.

### P5. Fix the readiness-trend deload trigger (it fires for healthy lifters) and decouple it from the dial
- Today: baseline = week-1 average of the block; trigger = weekly average < 55 and >= 15 below baseline, from
  week 2. Week 1 follows a deload, so the baseline is a post-deload high. In the simulation "readiness fell
  from 66 to 49" fired in Build week 3 for the normal AND the sturdy lifter, suggested a deload, and turned
  the dial to -1 (which then never recovered: 21% fewer sets for the rest of the run).
- Change: baseline = rolling mean of the lifter's last 12 non-deload, non-week-1 check-ins (fallback: all
  previous check-ins); trigger = weekly average < 45 and >= 15 below baseline, for two consecutive weeks
  (or one week < 40). A readiness-only chronic signal suggests the deload but does NOT move the dial.
- Basis: wellness monitoring validity rests on individual baselines and z-scores (Gallo et al. 2016 use
  >= 1.5 SD from a rolling mean; Saw 2016; Hooper & Mackinnon 1995); a fixed week-1 anchor inside a block
  measures the deload rebound, not chronic fatigue.
- Effect: removes false deloads (progress up); genuine decline still caught because the other chronic
  triggers (calibration drops, reds, lights, flags) remain. Confidence: high.

### P6. Make the volume dial a slow two-way control, not a ratchet
- Today it steps down every week a chronic signal is present (and `calibDrops` persists, so it can step down
  twice in one block), and steps up only after a block that was clean AND finished at learned >= +1 on all
  three lifts. In practice it only goes down.
- Change: at most -1 per block, and only on a chronic signal that is not readiness-only; +1 after any clean
  block when the dial is below 0 (no "+1 on every lift" condition needed to recover a step); keep the extra
  "+1 on every lift" condition only for stepping above 0.
- Basis: Israetel's MRV search is bidirectional (p.322); a ratchet converges on the floor regardless of the
  lifter. Effect: progress protected; fatigue unaffected (the step down still happens when fatigue is real).
  Confidence: high.

### P7. Apply the fatigue allowance to the rise test only
- Today `est = r.est * (1 + 0..3%)` is used for both the drop and the rise test. In Build week 4 a lifter whose
  sets imply 95% of the stored max is read as 97.9% and no drop happens; combined with the 3% drop threshold
  the max does not move until the true decline is ~6%. That contradicts "fatigue management is the priority".
- Change: drop test on the raw estimate; rise test on the allowed estimate (or just set `allowance` to
  0.015). Simulation (`allowRiseOnly`): max error 0.8/1.5/0.8% -> 0.1/0.6/0.2% (normal); fragile misses 1 -> 0,
  crushed 1 -> 0; overreach misses 6 -> 1, overshoots 20 -> 13, squat true gain +4.4% -> +6.0%.
- Effect: fatigue down, progress up (the next block starts from an honest number and the 2.5%/session rise
  recovers it in 1-2 sessions when the lifter is fresh). Confidence: high.

### P8. Trust a bad first set more than a good one
- Today every first set counts half. Change: first-set weight 0.5 when it lands at or below target, 1.0 when
  it lands >= target + 1.5 or misses. Keep the 85% floor.
- Basis: at a fixed load RPE rises set to set (Helms et al. 2017; Hackett et al. 2012), so a hard first set
  predicts harder later sets, not an anomaly; the "first set feels heaviest" effect is real only for
  under-warmed lifters, and the app already builds a full warm-up ramp. Simulation (`fullCorrection`
  preset): overreach peak fatigue 0.84 -> 0.78, true gains better (bench -4.3% -> -3.9%, squat +4.4 -> +5.5%);
  the opposite preset (`gentleCorrection`, 0.35 / floor 0.88) was the worst variant tested (31 overshoots, 10
  crushed). Effect: fatigue down on bad days; progress unaffected on normal days (no change for the normal
  profile). Confidence: medium.

### P9. Cap how far a green day can push the load up
- In-session ceiling 105% -> 102.5% in Build and Strength, 100% in Peak. Two easy sets can today raise the
  remaining sets 5% (probe: Strength week 3 4x3 at 86% becomes 90% triples; Peak doubles at 90% become
  94.5%), which breaches the guide's own "nothing above 90% outside Peak" and double-dips with bonus reps.
- Basis: RTS never raises a planned top set above its RPE target in-session; velocity-based practice treats a
  faster-than-expected set as a reason to keep the load and bank the reps, not to add load mid-exercise.
  Effect: fatigue down (fewer surprise RPE 9s); progress unaffected (bonus reps and calibration already carry
  the information to the next session). Confidence: medium-high.

### P10. Do not auto-convert the rest of a block to light after two flagged weeks; make the deload the default
- Simulation (`autoLight`, overreach): 18 light sessions in 26 weeks, true deadlift -3.3% vs -0.7%, peak
  fatigue unchanged (0.83 vs 0.84). Three light weeks clear less fatigue than one inserted deload and cost
  more training. Israetel's "light sessions, not deloads" (p.160) is a rule for one bad week; two flagged
  weeks is functional overreaching (Meeusen et al. 2013 consensus: reduce load for days to weeks).
- Change: keep the suggestion, but pre-select "Deload this week" as the primary action (already is) and, if
  the lifter chooses "Push on", switch the remainder of the current week to light automatically and re-ask
  next week. Effect: fatigue down vs auto-light; progress up. Confidence: medium-high.

### P11. Slow the earned-set climb a little
- The new "every set on target" +1 plus "recovered by the next session" +1 reaches the +2 threshold in any
  ordinary good week, so a set is added every week until the cap. Change: in Build, allow +1 set at most every
  second week (or require score >= 3 when "on target" is the only positive). Simulation showed no difference
  (`noOnTarget`) because yellow days drop earned sets anyway, so this is about the weeks when P4 makes more
  days green.
- Basis: Israetel's own advice for a lifter coming off burnout is to add volume slowly (p.164, p.322);
  Helms' MEV->MRV progression adds 1 set per lift every 1-2 weeks. Effect: fatigue slightly down; progress
  essentially unchanged over a 4-week block. Confidence: medium-low.

### P12. Soften the Build -> Strength volume step
- Counted barbell sets per lift jump from 2-3 (Build week 1 after a deload) to 5-7 in Strength week 1 because
  paused squat/paused deadlift (mult 0.8-0.85) start counting while belt squat/RDL did not. Change: Strength
  week 1 secondary 3 sets -> 2 sets (primary 4 -> 3 if the previous Build block flagged any lift), and let the
  review add them back.
- Basis: week-over-week load jumps > ~30% are the one acute:chronic ratio finding that survives the ACWR
  critique (Gabbett 2016; Impellizzeri et al. 2020); Foster monotony/strain are structural here (fixed 4-day
  template) and not actionable. Effect: fatigue down at the single largest step in the cycle; progress
  unaffected (one set for one week). Confidence: medium-low.

### P13. Small correctness fixes
- `weeklyReview` compares RPE on bonus-rep sets to the target without subtracting the extra reps: a +2 bonus
  set at RPE 8 on a target-6 set contributes +2 to "felt harder than planned". Use
  `rpe - max(0, actualReps - reps) - rpeTarget`.
- `sessionEstimate` and `liftCorrection` let a non-finite RPE through (`NaN < 6` is false); `e1rm` then returns 0
  and the 0.7x clamp drives the max down 5% per session. Guard with `Number.isFinite`.
- Calibration rises: require `r.conf >= 1.5` and at least one counted set at RPE >= 7.5 for the fast path
  (`est > 1.04`). Basis: prediction error grows with distance from failure (Halperin et al. 2022 meta: ~1 rep
  error at >= 3 RIR, larger beyond); sets at RPE 6-7 should be allowed to lower but not to raise a max. A
  per-block rise cap of 5% after the first block is harmless but changed nothing in simulation (rises were
  already under it).

## Per-question evaluation

### 1. Readiness score
Question set (sleep, energy, soreness by region, motivation) matches the Hooper index minus stress and is
the right size for 6 taps. The mapping "yellow keeps loads, drops bonus and earned sets; red = the block's light
session" is defensible and close to Israetel, but it leaves the load untouched on the 45-60% of days that
score yellow (3/3/3/3 = 50), which is where the under-reporting lifter accumulates misses. Field practice (RTS,
JuggernautAI) nudges load/RPE on low readiness; the evidence on wellness scores supports using them as a
small, continuous adjustment with individual baselines rather than a hard gate. Recommended: P2 (-2.5% load,
-0.5 RPE on yellow), P4 (red < 35 so a single bad answer is yellow), P5 (trend vs rolling baseline). Do not nudge
on green; do not add taps.

### 2. In-session correction
The rep-max table gives ~3.0-3.5% per RIR at every rep count, which matches RTS load drops (3-5% per RPE point)
and the velocity-based rule of thumb (a 5-6% load drop per ~0.05 m/s of velocity loss at the same reps). The
half-weight first set makes a +2 RPE first set move the next set only -3% (full evidence would be -6%); given
that RPE normally rises across sets, that is too gentle when the first set is bad (P8). Floors at 85% are
generous and fine; the 105% ceiling is the only place the app can push a day harder than planned (P9). Missed
reps are handled (RPE 10 at reps achieved) but nothing stops the exercise except the floor "offer" (P3). Bonus
reps are capped sensibly (+2/+1/0) and should remain the only in-session upside.

### 3. Calibration
The asymmetry (down at once up to 5%, up 2.5% on a smoothed estimate, never after a crushing session, per-block
floor 10%/15%) is the right shape and is what RTS's "emerging strategies" does informally (act on a bad e1RM now,
raise slowly). sim2 shows the maxes track truth within ~1% in all six of the parent's profiles. Robustness to
RPE inaccuracy: with a -1 reporting bias (lifter logs one point low) the max runs 3-6% high and the only
backstop is missed reps (11-20 in 26 weeks); with +1 bias it runs ~3% low with more deloads. The under-reporting
case is the dangerous one and is fixed mostly by P2/P3/P7, not by the calibration constants. The fatigue
allowance currently hides late-block declines (P7). RPE 6-6.5 half weight and sub-6.5 ignored are fine (the
accuracy literature supports weighting by proximity to failure). The trend of implied maxes across a block is
now covered by `calibDrops >= 2` and "down 6%"; that is enough, provided `calibDrops` resets on an inserted
deload (P1).

### 4. Weekly review and deload triggers
Scoring (missed/RPE drift -2/-1/+1, difficulty +1/-1/-2, soreness +1/-1/-2) spans -6..+3 and is reasonable; the
new "on target +1" makes additions near-automatic (P11). Deload triggers: the weekly ones (two lifts flagged
twice, two reds, two crushing) are slow but the planned deload is never more than 2-3 weeks away, which is the
real protection. The new chronic triggers are the right idea; the readiness-trend one is miscalibrated (P5),
and the dial they feed is a ratchet (P6). Missing or unnecessary: monotony/strain are structural here (not
actionable); a consecutive-high-RPE-weeks trigger added nothing in simulation because calibration drops already
express it; a sleep-only trend is not needed. The one missing signal that matters is the week-over-week set
jump at the block boundary (P12). Second consecutive flagged week -> auto-light rest of block: no (P10).

### 5. Light and deload recipes
Build light (half sets at 90% load) is the textbook light day and matches RTS/Israetel. Strength light
(70%/70% -> triples at ~60% 1RM) is fine. Peak light (90% volume at 50% load -> doubles at 45% 1RM) is odd;
0.5 volume / 0.8 intensity keeps neural readiness, which is what RTS does in a peaking pivot. Deload first half
(Build 50%/90%, Strength 70%/70%) matches the canon (Bell et al. 2022 scoping review; Coleman et al. 2024
survey: volume -40..-60%, intensity -10..-20%; Helms: 50-60% volume at 85-90% intensity). Deload second half at
50% intensity (39-43% 1RM) is lighter than anyone else uses; it is harmless for fatigue and costs a little
sharpness in the next block's week 1 (simulated RPE ~1 below target there). Optional: deloadB intensity 0.6
(Build) / 0.65 (Strength). Low priority.

## What to leave alone
- Starting volumes, weekly caps (12/16/9) and the +2 earned-set limit: these, plus block lengths of 4/3/2, are the
  main burnout insurance and they worked in every simulated profile (peak fatigue never exceeded 0.6 for
  normal/fragile/sturdy even with the engine as wired).
- The 2.5%/session rise cap and the 0.5/0.5 smoothing.
- The rep-max table and ~3%/RIR correction step.
- The 6-tap check-in.

## Evidence base (short)
- Tuchscherer, RTS manual / "Emerging Strategies": RPE targets, fatigue percents (3-7%), RPE stops, load drops
  3-5% per RPE point, pivot blocks on e1RM stall.
- JuggernautAI: readiness questionnaire adjusts the day's load and set count by small steps.
- Helms et al. 2016 (RIR-based RPE), 2017 (RPE/velocity across sets: RPE rises set to set at fixed load);
  Zourdos et al. 2016; Hackett et al. 2012/2017; Steele et al. 2017; Halperin/Malleron et al. 2022 meta-analysis
  (prediction error ~1 rep near failure, larger far from failure, smaller in trained lifters).
- Velocity-based training (Gonzalez-Badillo & Sanchez-Medina 2010; Weakley et al. 2021): velocity loss
  thresholds 10-20% as the stop rule; ~5% load per RPE-point equivalent.
- Hooper & Mackinnon 1995; Saw, Main & Gastin 2016 (subjective measures outperform objective ones; use
  individual baselines); Gallo et al. 2016 (z-score flags).
- Foster 1998 (monotony/strain); Gabbett 2016 and Impellizzeri et al. 2020 (ACWR and its critique).
- Banister fitness-fatigue model; Meeusen et al. 2013 joint consensus on overreaching/overtraining.
- Bell et al. 2022 (deloading scoping review); Coleman et al. 2024 (deload practices survey); Pritchard et al.
  2015 (tapering); Knowles et al. 2018 (sleep and strength).
- Israetel, Hoffmann & Smith 2020, pages as cited in the engine.

## Files
- Report: `C:\Users\Jerm\AppData\Local\Temp\claude\C--Users-Jerm-Documents-Trainers-ControlResonantTrainer\9a70d320-4da5-42da-a7b5-2ba4d84d8362\scratchpad\review_autoreg.md`
- Snapshot reviewed: `...\scratchpad\review_autoreg\engine_snapshot.js` (engine.js at 22:07:44)
- Probes and harness: `...\scratchpad\review_autoreg\probe.js`, `...\scratchpad\review_autoreg\sim4.js`
  (`node sim4.js <abs path to engine.js> <normal|fragile|sturdy|overreach> <app|wired|yellowLoad|stop|trend|autoLight|upSlow|allowRiseOnly|all> [bias] [verbose] [tunePreset]`)
- Note for the parent: `sim2.js` still runs against the new engine but its end-of-week hack (`P.dayIdx = 3`
  after `startDeloadNow`) now collides with the inserted-deload resume logic and will loop if a deload is ever
  suggested; `sim4.js` advances the day first and then inserts the deload, as app.js does.
