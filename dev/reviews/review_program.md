# Readyset program review against the evidence-based powerlifting canon

Scope: `src/engine.js` (BLOCKS, DAYS, REST, TEST, CAPS, buildSession, warmups, weeklyReview, calibrate, advanceDay) and `PROGRAM_GUIDE.md`, checked against Reactive Training Systems (Tuchscherer), Juggernaut / JuggernautAI, Stronger By Science (Nuckols), The Strength Athlete, Calgary Barbell, Helms' Muscle & Strength Pyramids, Barbell Medicine, Sheiko, and the volume / frequency / proximity-to-failure / deload literature. Lifter: intermediate (3+ yr), home gym, 4 x 50-70 min, strength first and some muscle, no meet, must not be buried by fatigue (burnt out on GZCL J&T 2.0, which runs an AMRAP on every T1 top set plus heavy T2 volume).

## Verdict

The skeleton is canonical. Block order (hypertrophy -> strength -> optional peak), mesocycle lengths (4+1 / 3+1), rep ranges, intensities, weekly load jumps, 2x squat / 3x bench / 1x heavy deadlift + hinge, once-per-block exercise rotation, the TM-based loading, the RPE-driven in-session load drops and the "start low, earn sets" volume ramp would all pass review at RTS, Juggernaut, SBS, TSA or Calgary Barbell, and they match the book's own tables. The structure's problems are not the shape but a handful of details that quietly add fatigue (bonus reps to failure, earned sets multiplied across every variant, block-start volume carried over at the previous block's ceiling, a hinge variation 24 h after heavy deadlifts, deadlift 8s, 4 h of cardio a week) and two places where it under-delivers on strength (one barbell-squat session a week in Build; a 3-week strength phase alternated with a 5-week hypertrophy phase, with three of every twelve weeks spent peaking/testing for a meet that does not exist).

### What the engine actually prescribes (TM = 90% 1RM; the `RM[]` table is the RTS RPE-10 chart, so "planned RPE" is on the RTS scale)

| Block / week | Primary | % 1RM | Planned RPE, set 1 | With bonus reps |
|---|---|---|---|---|
| Build 1 | 3x8 | 69.75 | 6 | +2 -> 8 |
| Build 2 | 4x8 | 72.0 | 7 | +2 -> 9 |
| Build 3 | 4x8 | 74.25 | 8 | +2 -> 10 (failure) |
| Build 4 | 4x7 | 76.5 | 8 | +2 -> 10 (failure) |
| Strength 1 | 4x5 | 76.5 | 6 | +1 -> 7 |
| Strength 2 | 4x4 | 81.0 | 7 | +1 -> 8 |
| Strength 3 | 4x3 | 85.5 | 7.5-8 | +1 -> 8.5-9 |
| Peak 1 / 2 | 3x3 / 3x2 | 85.5 / 90 | 8 / 8 | none |
| Test | ramp 50-93%, single @9, 2x3 @72% | | | |

Weekly barbell sets per competition pattern (counted toward CAPS; mult >= 0.8 only): Build squat 3-4 (belt squat does not count), bench 9-12, deadlift 3-4; Strength squat 7, bench 10, deadlift 7; plus up to +2 earned per lift, applied to every counted exercise (so +3 bench sets per step in Build, +2 squat / +2 deadlift per step in Strength).

Session length (estimateMinutes), Build week 4, Day A with three accessories: ~68 min; ~75 min with two earned sets; then 60 min of cardio.

---

## Prioritized recommendations

### 1. Cap bonus reps at RPE 9 and allow them on the primary slot only. (HIGH)

Current: `plus: 2` (Build) / `1` (Strength) on the first set of every TM-loaded exercise, including the Day-A bench, close grip, OHP, RDL and paused squat. In Build weeks 3-4 the planned first set is already RPE 8, so +2 reps is a set to failure on the squat and deadlift, twice a session, in the two highest-fatigue weeks.

Change: `plus = Math.max(0, Math.min(block.plus, Math.floor(expectedRIR(pct1rm, reps) - 1)))`, and only when `slot.role === 'primary'`. That yields Build +2 / +1 / 0 / 0 and Strength +1 / +1 / +1, with every bonus set stopping at or before RPE 9.

Basis: the book's own no-failure rule (p.97) and the canon's hard ceiling (RTS: nothing above @9 in training; Helms: 1-3 RIR for compounds; Grgic et al. 2022 and Refalo et al. 2023: training to failure adds fatigue without adding strength or hypertrophy). The weekly AMRAP is the single feature of J&T 2.0 most often blamed for its fatigue.

Effect: progress unchanged (rep PRs remain available in Build 1-2 and all Strength weeks; the first set still serves as the indicator for `liftCorrection`); fatigue clearly down in Build 3-4. Confidence: high.

### 2. Earned sets go to the primary only; the next block starts one set below the tolerated count. (HIGH)

Current: `setAdj` lands on every counted exercise of the lift (`ex.mult >= 0.8`), so one "+1 set" step is +3 bench sets a week in Build and +2 squat / +2 deadlift sets in Strength. `advanceDay` then carries `learned[block]` (up to +2) into week 1 of the next instance of that block, so a Build that finished at 6 sets of 8 begins the next Build at 5 sets of 8 in its RPE-6 week with no room to earn more.

Change: in `buildSession` add `sa` only when `slot.role === 'primary'`; in `advanceDay` set `P.setAdj[k] = Math.max(-1, (learned[k] || 0) - 1)`.

Basis: the book adds 0-1 set per week (p.338) and starts every mesocycle below MRV and ramps to it (p.127); RP's MEV -> MRV ramp restarts each meso; SBS, RTS and Calgary add sets to the main movement, not to each variant.

Effect: progress same (the primary carries the strength stimulus); fatigue down, this removes the largest hidden volume jump in the program. Confidence: high.

### 3. Make Peak & Test opt-in (default off) and anchor the max with one single @8 in Strength week 3. (HIGH)

Current: `includePeak: true`, so every 12 weeks spends 2 low-volume weeks plus a test week (three RPE-9 singles in one week, in a home gym without a spotter) for a number no meet needs.

Change: `includePeak: false` by default; offer Peak & Test as something to run every second or third macro, or when he wants a number. Strength week 3 primary becomes `{ single: { pct: 1.02, rpe: 8 }, sets: 3, reps: 3, pct: 0.95 }`: one single at 102% TM (~92% 1RM, which is "x1 @8" on the RTS chart), then the 3x3 at 85.5% as now. The single feeds `calibrate` with a high-confidence e1RM.

Basis: the book itself (p.285: peaking "only if you've got something to show for it"; p.302: heavy 1-3s give an intermediate too little volume to gain strength). RTS (x1 @8 then backoffs), SBS, Barbell Medicine and Helms all use singles @8 as the routine e1RM anchor; RPE-based e1RM from sets at RPE 8-9 is within roughly 3-5% of a tested max (Helms et al. 2017; Zourdos et al. 2016), which is inside the noise of a max taken on a random Tuesday anyway. Caveat: the book says nothing over 90% when no meet is near (p.167); the canon treats one rep at 92% per lift per meso as far cheaper than a 3-week peak/test block, and it is.

Effect: progress up (three of every twelve weeks return to productive work; strength phases reach the book's 2-4 months); fatigue down, the riskiest sets in the program disappear by default. Confidence: high for default-off, medium for the single @8.

### 4. Macro sequence Build -> Strength -> Strength (13 weeks) instead of alternating one meso each. (MEDIUM)

Current: Build (5) and Strength (4) alternate one-for-one, so the strength phase is 3 working weeks before the next hypertrophy phase.

Change: a `SEQUENCE = ['build', 'strength', 'strength']` (Peak optional after it). The second Strength instance inherits the recalibrated 1RM and the `learned` set counts, so it is automatically heavier, and takes its own variation set (squat: the other bar position, bench: `spoto_press`, hinge: `deficit_deadlift` or `block_pull`) so the once-per-meso rotation holds. If he wants the muscle side weighted more, `['build', 'build', 'strength', 'strength']` (18 weeks) is the book's "2-3 months each".

Basis: book pp.284-285, 290, 313 (intermediates "maximally benefit from extended 3-6 month strength phases"; phases usually 2-3 months); Juggernaut runs three 4-week waves per quality; SBS programs run 21 weeks with intensity waves.

Effect: progress up on the stated priority (strength); fatigue neutral, the weekly recipes are unchanged. Confidence: medium.

### 5. Move the hinge variation off the day after deadlifts. (MEDIUM)

Current: Day C (Thu) heavy deadlift, Day D (Fri) RDL / paused deadlift 24 h later.

Change in DAYS: B = `bench_primary`, `hinge_variation`, `back_horizontal`, `triceps`, `biceps` (optional); D = `bench_variation`, `press_secondary`, `back_vertical`, `delts` (optional), `triceps`. Lower-body loading becomes Mon (squat), Tue (light hinge), Thu (deadlift + squat variation), with Friday upper-only, so Monday's squat follows three days without a bar on the back. Optional second swap: `bench_secondary` (A) <-> `bench_variation` (D), so the day before heavy bench is close grip rather than competition bench at near-identical loads.

Basis: the book's deadlift / hamstring SRA (pp.135, 140, 219-220); TSA and Calgary Barbell space the heavy pull and its variation by ~3 days.

Effect: fatigue down on the erectors and hamstrings; progress neutral to slightly up (heavy deadlift and heavy squat each get a fresher day). Confidence: medium.

### 6. Build deadlift: sets of 6, not 8. (MEDIUM)

Current: Build primary applies 8s to the deadlift (3-4x8 at 70-76.5%, planned RPE 6-8). Deadlift reps-at-percentage run about one rep below squat and bench, so these sets land a point harder than planned (the calibrator then quietly drags the deadlift 1RM down to compensate).

Change: a per-lift override in Build, `primaryByLift.deadlift = [{3,6,0.80},{4,6,0.825},{4,6,0.85},{4,5,0.875}]` = 72 / 74.25 / 76.5 / 78.75% 1RM, planned RPE 5 / 6 / 7 / 7 on the chart, i.e. about 6 / 7 / 8 / 8 in deadlift reality. The RDL carries the hamstring hypertrophy.

Basis: book p.135 (deadlift the most fatiguing lift), p.140 (hamstrings), p.219-220; TSA, Calgary and Juggernaut hypertrophy blocks keep the deadlift at 5-6 and push higher reps onto RDL / SLDL.

Effect: fatigue down (erector and hamstring), progress neutral, hypertrophy unchanged. Confidence: medium.

### 7. Build squat variation: a barbell variant for 3 sets, with belt squat as the fallback. (MEDIUM; **adds fatigue**)

Current: Build's `squat_variation` default is belt squat (no TM), so the barbell squat is practised once a week for 3-4 sets in Build, below the 5-9 weekly sets that the strength dose-response literature puts in the productive range and below the book's "at least two technique sessions a week, including overload sessions" (p.224).

Change: `variation.squat_variation = 'paused_squat'` in Build, on the secondary scheme: 3x8 at 57-63% of the competition 1RM (= 67-74% of a paused max, RPE 5 -> 8 across the block), fixed at 3 sets (no earned sets on secondaries after item 2). Belt squat stays selectable in the `quads` accessory slot and as a swap.

Basis: Ralston et al. 2017 (5-9 weekly sets per lift outperform < 5; 10+ adds little), Grgic et al. 2018 (higher frequency helps strength when it raises weekly volume); every 4-day canon template squats with a barbell twice.

Effect: squat progress up (6-7 barbell sets and two grooves a week instead of 3-4 and one). **Adds roughly 24 reps of moderate axial loading to deadlift day.** Worth it if squat progress matters more than keeping Thursday light; if deadlift day already rates "very hard", keep belt squat and accept once-a-week squatting in Build. Confidence: medium.

### 8. Calibration guard rails. (MEDIUM-HIGH)

Current: `calibrate` may raise a 1RM 2.5% per session; bench is touched on three days, so an optimistic RPE week can lift the bench TM 7.5% on top of the programmed +2.5%. A down-move needs only `conf >= 1`, which four RPE-6.5 sets reach, even though RPE reporting at 3-4 RIR is the least reliable.

Change: (a) cap the calibrated rise at +2.5% per lift per week; (b) sets planned at RPE <= 6.5 cannot trigger a downward move on their own (require `conf >= 1.5` from sets planned >= 7, or `est < 0.95 * cur`).

Basis: Helms et al. 2017 and Zourdos et al. 2016 (RPE accuracy deteriorates beyond ~3 RIR); JuggernautAI and RTS smooth e1RM across sessions rather than acting on one.

Effect: fatigue down (no runaway TM from RPE optimism), progress unchanged. Confidence: medium-high.

### 9. A time gate on earned sets, and a shorter warm-up ramp. (MEDIUM)

Change: in `weeklyReview`, `canAdd` also requires `estimateMinutes` of next week's heaviest session <= 70 (settings `sessionCapMin`). Warm-ups for targets >= 300 lb: 7 sets / 33 reps today; use bar + `[[0.5,5],[0.65,3],[0.78,2],[0.88,1]]` (about 21 reps, -2 min per primary).

Basis: Juggernaut and RTS warm-up calculators use 4-5 steps; the owner's constraint is ~60 min.

Effect: fatigue slightly down, time protected, progress neutral. Confidence: medium.

### 10. Cardio default 30-40 min, not 60. (MEDIUM-HIGH)

Current: 60 min post-lift x4 = 4 h and ~1,600 kcal a week, treating the book's ~1,500 kcal ceiling as a target.

Change: `cardioMin: 35`; guide wording "1,500 kcal/week is a ceiling; 100-150 min a week of easy cycling is enough for health". Keep one longer easy ride on an off day if he enjoys it.

Basis: Barbell Medicine (2-3 x 20-45 min), Helms (low impact, 2-3 sessions, separated from lifting where possible), Wilson et al. 2012 (interference scales with duration and frequency; cycling interferes less than running).

Effect: fatigue down (-1.5 h/week and less post-lift AMPK), progress neutral to slightly up. Confidence: medium-high.

### 11. A missed-week rule. (MEDIUM, one rule, no UI)

Current: nothing handles a layoff; the lifter returns to the week he left.

Change: missed <= 1 week -> repeat the week at -5% load with earned sets cleared; missed 2+ weeks -> restart the block at week 1 with the 1RM -5% (3+ weeks: -10%, and start in Build).

Basis: RTS, SBS and Helms all publish a version of this; most injuries in returning lifters come from resuming at pre-layoff loads.

Effect: fatigue and injury risk down after breaks; progress neutral. Confidence: medium.

### 12. One bodyweight number per week. (LOW-MEDIUM)

Change: an optional weekly bodyweight field in the weekly review with a one-line target: +0.25-0.5% per week in Build, hold in Strength.

Basis: Helms and RP make the weekly bodyweight trend part of progression; the book says to eat hypercalorically only during the high-volume phase (p.302).

Effect: progress (hypertrophy needs a surplus; most stalls at this level are diet, not programming); no fatigue. Confidence: medium.

### 13. Strength-block light session and second-half deload intensities. (LOW)

Current: Strength light = 70% vol / 70% int -> 3x4 at 57-60% 1RM (RPE ~2); deload second half 50/50 -> 2x3 at ~43% (Strength) or 2x7 at ~38% (Build).

Option: `light.int` 0.85 in Strength (-> 65-73%, RPE 4-5) and `deloadB.int` 0.7 in both blocks (-> 53-60%). The book prescribes the current numbers; the canon (RTS, Juggernaut, Helms) deloads at -10-20% intensity and half the sets. **Slightly more work on red days and in the deload's second half**, probably worth it for groove retention but not for fatigue. Confidence: low.

### 14. Block-dependent primary rest. (LOW)

Change: `restPrimary` 180 s in Build, 240 s in Strength and Peak (+3-4 min per session). Basis: Schoenfeld et al. 2016 (3 min > 1 min for strength), RTS / SBS 3-5 min for heavy triples. Effect: slight strength gain per set; fatigue neutral. Confidence: low-medium.

### 15. Guide text: within-zone undulation is endorsed, not forbidden. (LOW)

PROGRAM_GUIDE says "No mixing of rep zones inside a week"; the book bans 12s / 6s / 2s in one week but calls 6 / 4 / 2 within a strength range "an effective way to provide variation and manage fatigue" (pp.274-276). The layout already undulates by day (heavy primary, moderate secondary, light variation), which is what the canon's heavy/light/medium days do, so no rep-undulation change is needed; fix the sentence.

Also note, not a program change: a single @9 on bench in a home gym needs safeties set; the guide should say so where it describes the test week.

---

## Answers to the five questions

**1. Block structure.** Lengths, intensities, reps and weekly jumps are where the canon puts them: Build 70-77% x 7-8 at RPE 6 -> 8, +2.5% TM/week (RP, Juggernaut hypertrophy waves, Calgary 4x8 @ ~70%); Strength 5 / 4 / 3 at 76.5 / 81 / 85.5%, +5% TM/week (Juggernaut 5s/3s waves, TSA 4x3 @ 85%, RTS x3 @8 then backoffs); Peak 3x3 / 3x2 at 85.5 / 90%. Top-set-plus-backoff: the indicator set plus `liftCorrection` already behaves as an RTS "fatigue stop" (each set's RPE re-aims the rest); the thing that breaks it is the bonus reps (item 1). A formal backoff (-4% Strength / -6% Build after set 1) would trim per-session fatigue a little and keep the heaviest rep fresh; adopt it only for Strength week 3 and Peak if at all (`backoff: 0.96`). Rep undulation inside the Strength week is not needed (item 15). The 2-week peak + test is not worth its three weeks without a meet; replace with the single @8 and e1RM (item 3), keep Peak & Test as an occasional opt-in.

**2. Weekly layout and caps.** Squat 2x / bench 3x / deadlift 1x heavy + hinge is the TSA / Calgary / Juggernaut 4-day shape and matches the book (pp.219-220). Two fixes: the hinge variation sits 24 h after the heavy pull (item 5), and Build's second squat day has no barbell (item 7). CAPS 12 / 16 / 9 are sensible ceilings for this lifter (RP quad MRV ~18-20 including everything; SBS lifts peak at ~12-15 sets; deadlift 6-9 is common coach practice); they only bind on bench in Build and deadlift in Strength, which is where they should. Accessory choices (leg curl, pulldown / row, pushdown, leg extension, face pull) are the low-fatigue machine picks the book allows "when fatigue must be kept down" (p.134) and the canon uses; nothing to add.

**3. Starting volume and "earn sets".** 3-4 sets per primary per session is right for a lifter who was buried: week 1 at RPE 6 is the RP MEV week and Juggernaut's wave start. Weekly totals in the 5-9 range per lift are where the strength dose-response flattens (Ralston 2017); bench (9-12) is there, squat and deadlift (3-4 barbell sets in Build) are under it, which items 6-7 address on the squat side and the RDL already covers on the hinge side. The earn-sets mechanism is sound; its implementation multiplies each step across variants and restarts blocks at the previous ceiling (item 2).

**4. Deload, light session, test week, warm-ups, rest, cardio.** Fixed deloads every 4-5 weeks with an early-deload trigger is the right policy for this lifter (Coleman et al. 2024 found deloads cost nothing for strength or size; Bell et al. 2022 found most coaches use one week every 4-8). Recipes are the book's and lighter than the canon's (item 13, optional). Yellow "trim" (hold load, drop bonus reps and earned sets) is exactly what JuggernautAI does for mid readiness. Test week ramp and RPE-9 single are standard; make it opt-in (item 3). Warm-up ramp is good but long at heavy loads (item 9). Rest times are the canon's floor (item 14). Cardio is health-level work but double what is needed (item 10).

**5. What the canon has that the structure lacks**, inside the owner's constraints: a routine single @8 to anchor e1RM (item 3); strength phases longer than one meso (item 4); a layoff rule (item 11); a weekly bodyweight trend (item 12); a weekly ceiling on calibrated TM rises (item 8). Pause / tempo work, once-per-meso rotation with proper variant distance, and a 50/50 active-rest block are already present. Specialization blocks and extra technique days are not warranted for a no-meet intermediate at four days.

---

## Weekly barbell sets per lift, current vs. with items 2, 4, 6, 7

| | Build now | Build proposed | Strength now | Strength proposed |
|---|---|---|---|---|
| Squat (comp + barbell variants) | 3-4 (+2 earned) | 3-4 comp + 3 paused = 6-7 (+2 on comp -> max 9) | 4 + 3 = 7 (+2 x2 -> 11) | 7 (+2 on comp -> 9) |
| Bench | 9-12 (+3 per step -> 15) | 9-12 (+1 per step -> 14) | 10 (+3 per step -> 16) | 10 (+1 per step -> 12) |
| Deadlift | 3-4 x8 (+2) | 3-4 x6/x5 (+2 -> 6), RDL on Tue | 4 + 3 = 7 (+2 x2 -> 9, cap) | 7 (+2 on comp -> 9) |

Caps 12 / 16 / 9 remain valid and are now reached only by the primary.

## Leave alone

TM at 90%; the RTS chart in `RM[]`; the RPE drift allowance (`fatigueAllowance`); the readiness score and trim / light modes; the weekly review scoring; the second-red-check-in rule; once-per-block exercise rotation and the hand-width variant rule; accessory double progression and `ACC_CAP` 4; the active-rest block; Mon / Tue / Thu / Fri.
