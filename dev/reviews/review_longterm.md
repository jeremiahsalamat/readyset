# Long-term progression review: Readyset engine (months-to-years horizon)

Scope: `src/engine.js` (BLOCKS, CAPS, advanceDay/learned, weeklyReview, calibrate, mesoReview, startActiveRest, accessoryProgress) and `PROGRAM_GUIDE.md`, read against the book notes (B: fatigue/SRA, C: variation, phase potentiation, individual differences, periodization) and the common practice of RP, Juggernaut, Helms, Nuckols and Barbell Medicine. Lifter: intermediate, 4 days, ~1 hour, home gym, previously buried by fatigue, wants maximal sustainable strength and muscle. Nothing in the app was edited; throwaway scripts are in `...\scratchpad\review_longterm\` (`vol.js`, `sim_long.js`, patched engine copies).

## What the numbers say today

Weekly counted sets (comp lift + barbell variants with mult >= 0.8; belt squat, OHP, RDL not counted), base vs. the +2 learned ceiling, and the hard CAPS:

| Block | Squat | Bench | Deadlift | Quads (all exercises) | Chest | Session min |
|---|---|---|---|---|---|---|
| Build wk1 / wk4 (base) | 3 / 4 | 9 / 12 | 3 / 4 | 8 / 11 | 9 / 12 | 54 / 67 |
| Build wk4 at +2 | 6 | 18 (cap 16 binds at +1) | 6 | 13 | 18 | 76 |
| Strength (base) | 7 | 10 | 7 | 9-10 | 10 | 58-65 |
| Strength at +2 | 11 | 16 | 11 (cap 9 binds at +1) | 14 | 16 | 69-76 |
| Peak wk1 (base / +2) | 6 / 10 | 9 / 15 | 6 / 10 | | | 55 / 66 |
| CAPS | 12 | 16 | 9 | | | |

78-week simulation (`sim2.js` logic, hidden true max, 0.3%/wk flat gain):

| Engine | Profile | Primary-lift set additions in 78 wk | learned at end | Deloads suggested |
|---|---|---|---|---|
| as shipped | normal | **0** (2 removals) | build S -1, B -1, D 0; strength 0/0/0 | 0 |
| as shipped | fragile | 7 | build S +1; strength S +1, B +1; **peak S +1, D +2** | 0 |
| add at score >= 1 | normal | 17 | +2 everywhere (DL strength +1, cap) | 0 |

Three structural findings fall out of that table and drive the priorities below:

1. **Volume never climbs for a normal lifter.** The set-add rule needs score >= 2, and the only cheap +1 ("felt easier than planned", rpeDelta <= -0.75) is exactly the signal per-session calibration removes: as soon as sets come in easy, the 1RM rises (up to 2.5%/session) and the next session is re-aimed at the planned RPE. The remaining +2 (session "easy" AND soreness 1 at the next check-in) is rare for an honest intermediate. Result: the lifter does 3-4 squat and 3-4 deadlift sets a week in Build, 7 in Strength, forever. That is the never-ending sub-maximal cruise. The book's floor for a hypertrophy phase is 15 sets per muscle per week (p.338); the app sits at 8-11 for quads with no path up.
2. **The fragile lifter gets more sets than the robust one.** In-block fatigue above the 3% allowance pulls the calibrated max down in weeks 3-4; after the deload the first week comes in "easier than planned" and "recovered", score hits +2, and sets are added, i.e. the review reads post-deload freshness as spare recovery capacity. The direction is backwards for the one lifter who must not be buried.
3. **Earned and learned sets reach the Peak block.** `buildSession` applies `setAdj` to any mult >= 0.8 exercise in any non-deload week, and `advanceDay` stores a `learned.peak`. The fragile run ended with deadlift +2 in Peak: 5 sets of 3 at 86% then 5 sets of 2 at 90%, the week before a max test. The book: peaking MRV is "far lower", "few or no sets added" (pp.126, 340).

A fourth point about the harness: with no volume-to-fatigue link, any looser add-rule saturates at +2 within one cycle and looks free. The current sim cannot evaluate volume rules at all (section 5).

## 1. The fixed 12-week cycle (Build 4+1, Strength 3+1, Peak 2+test)

**Against the book and current practice.** For an intermediate the book wants hypertrophy "usually 2-3 months" and strength "usually 2-3 months" (ch.10) or "3-4 months" (ch.8), each phase never under 3 weeks, and peaking "only if you've got something to show for it"; without a meet, "string together hypertrophy phases with strength phases" (p.285). RP's own templates run two mesocycles per phase; Juggernaut's Powerlifting AI runs ~2 hypertrophy mesos, 2 strength, 1 peak; Helms and Barbell Medicine both run 8-12-week hypertrophy/GPP emphases before a strength emphasis for non-competing intermediates. The app's single 4-week Build is at the bottom of every range and the Peak+test takes 25% of the year. Testing a single every 12 weeks is not harmful, but 4 of 12 weeks (Peak + two deloads... effectively Peak + test + deload) are weeks in which nothing new is built, and the test's main product, a 1RM number, is something calibration already provides to within ~1-2% (sim error -0.4..-1.4%).

**Connective tissue.** The book's rule "a break from training past 80% 1RM for at least a month every ~4 months" (p.209) is actually satisfied by the Build block (all loads <= 77%), which is one reason to keep Build at the top of the macro and make it longer rather than shorter.

**Recommended default macro (no new UI; `BLOCKS` order becomes a sequence table):**

Build (4+1) -> Build (4+1, alternate variations) -> Strength (3+1) -> Strength (3+1, alternate variations) -> Peak (2+test, optional) -> 1 easy week = 22 weeks, ~2.4 macros/year.

Time split 45% hypertrophy / 36% strength / 14% peak+test / 5% active rest, versus 42/33/25/0 today. Two tests and two easy weeks a year matches "active rest once or twice a year" (p.155) and "intermediate: average-length active rest" (p.313).

**Cycle-to-cycle adaptation, using only data already stored (block-end 1RMs, flags, learned):**

| Rule | Signal | Response | Why |
|---|---|---|---|
| A1 Hypertrophy is the limiter | Strength #1 ends with calibrated 1RM gain < 1% on >= 2 lifts and no lift flagged >= 2 | Next macro runs Build x3 (15 wk) and Strength x2 | Strength gains stalled on unchanged muscle (p.284 d, p.301) |
| A2 Strength responder | Strength #1 ends with mean 1RM gain >= 2% across lifts and no flags | Add Strength #3 (cap 3 mesos = 12 wk, book: 3-4 months for intermediates, never > 6) | "intermediates maximally benefit from extended (3-6 month) strength phases" (p.313) |
| A3 Hypertrophy MRV hit | Build #2 ends with >= 2 lifts flagged >= 2 | Skip Build #3 if scheduled; Strength is the re-sensitising low-volume phase | p.250, p.301 |
| A4 Nothing to show | Every lift's calibrated 1RM at the end of Strength #2 <= its value at the end of the previous macro's Strength #2 + 1% | Skip Peak this macro (go straight to the easy week), keep `includePeak` as the user override | p.285 |
| A5 Automatic active rest | End of each macro (after the test or, if skipped, after Strength #2's deload) | `startActiveRest(state, 1)`; 2 weeks if the macro contained >= 2 unplanned easy weeks or >= 3 lifts-flagged-twice events | p.155 (1-3 wk, 1-2x/yr); connective tissue and psychological fatigue are what deloads do not clear (p.154) |

Expected effect: progress up (longer, resensitised Build; strength phases long enough to realise the muscle), fatigue neutral-to-down (two tests a year instead of four; an automatic easy week twice a year; a 3-week stretch at 86-90% only after 18 weeks below 90%). Confidence: high on the shape (it is the book's own and the common coaching default), medium on the exact thresholds (1%/2% are set above the ~1.4% calibration lag seen in the sim so they do not fire on noise).

Minimal version if the owner wants fewer moving parts: adopt the 22-week sequence (A5 included) and skip A1-A4. That alone fixes the biggest mismatch.

## 2. Learned set counts and CAPS

**What `learned` does today.** At block end: `learned[block] = clamp(setAdj - (flagged ? 1 : 0), -1, 2)`. Next run of that block starts week 1 at that value and can climb at most to +2. Three problems:

- It never moves for a normal lifter (finding 1), so it is not finding MRV; it is recording the floor.
- Starting week 1 at the previous end-count deletes the book's ramp ("start below MRV and ramp toward/just over it only in the final week", p.127, 153). Learned 2 in Build means week 1 = 5 sets of comp squat, week 4 = 6, instead of 3 -> 6.
- The +2 ceiling is both the within-run cap and the all-time cap. A lifter whose true MRV is +3 or +4 on squat can never get there; one whose MRV is +1 gets pushed to +2 by the same rule. MRV discovery needs the ceiling to move by one step per run in the direction the run earned.
- `+1 setAdj` lands on every counted exercise at once: bench +3 sets/week per step (comp bench, bench_secondary, close-grip), squat +2 in Strength. Bench moves 9 -> 12 -> 15 in two steps; coaches move 1-2 sets per muscle per week.

**Proposed learned loop (the book's p.322 loop made explicit):**

- L1 Start of a run: `setAdj = max(-1, learned - 1)`. Ceiling for the run: `min(learned + 1, 3)`, always under the hard CAPS. So each run can reach one step above the last tolerated level, never two.
- L2 End of a run: if no lift flag reached 2 and the ceiling was reached -> `learned += 1` (max 3). If flagged >= 2 -> `learned = max(-1, endSetAdj - 1)`. Otherwise unchanged. One step per 4-5-week run = +1 set per exercise per mesocycle, which is what RP/Helms describe as "slowly raise the set numbers".
- L3 Set additions go to the primary exercise first; variants get a set only at step 2 (`sets += role === 'primary' ? sa : max(0, sa - 1)`). Bench then climbs 1 set/week per step, squat/deadlift 1.
- L4 No `setAdj` and no `learned` in Peak; in Strength the add rule needs score >= 2 and at most +1 per run (book: "few or no sets added", p.339); in Build score >= 1 adds (0-1 set/week, p.338). See section 3 for the score fix that makes "score >= 1" reachable.
- L5 Separate the entry from the memory: `learned` is per block id (Build and Build #2 share it, which is right: same intensity zone, same MRV).

**CAPS.** Squat 12 / bench 16 / deadlift 9 counted sets are sensible ceilings for a fatigue-averse intermediate: they sit inside the book's strength-phase 10-20 sets per body part (quads also get belt squat and leg extension on top) and under RP's published landmarks (quads MRV ~20, chest ~22, hamstrings ~20 per muscle, all exercises). Deadlift 9 leaves exactly one step above the Strength base (7 -> 9), which is defensible (deadlift is the most fatiguing lift, p.135; many coaches hold 6-10 hard pulling sets a week) but it means the deadlift's MRV search is one step long. Two refinements, both small:

- C1 Phase-specific caps, because the four MRVs differ (p.123-126): Build S 14 / B 18 / D 10; Strength 12 / 16 / 9 (as now); Peak 8 / 12 / 6 (book: 5-10 overloading sets per body part in peaking). The Build ceiling gives the hypertrophy phase room to reach the book's 15-set floor for quads/chest with the uncounted work added.
- C2 Count paused/deficit deadlift at 0.5 toward the deadlift cap only when its pct is <= 0.8 of TM (it is at mult 0.80-0.85, i.e. ~62-66% 1RM, which the book would call sub-overload for strength). Alternatively leave the count and raise the Strength deadlift cap to 10. Low priority.

Expected effect: progress up (volume can actually reach MRV over 3-4 runs instead of never), fatigue controlled (one step per run, flags pull it back by one, hard caps unchanged in Strength). Confidence: high that the loop is needed, medium on step sizes.

## 3. Plateau detection and response

Nothing exists today beyond calibration. The owner declined a "plateau-detection feature"; if it is still essential it is for this reason: without it a lift that stops gaining repeats the identical 12 weeks forever, because every other lever (set count, variation, load via calibration) is static for it, and the rule below needs no screen, no question and no input, only a comparison in `advanceDay` of numbers the app already stores.

**What a coach actually looks at:** the same-phase comparison (end of this strength phase vs. end of the last one), not week-to-week; whether the stall came with fatigue signs (then it is a recovery problem) or without (then it is a stimulus problem); and they change one thing at a time, for one full cycle, before judging.

**Minimum rule set (silent):**

- P1 Signal: per lift, `L.est` (the smoothed estimate) at the end of the macro's last Strength deload, stored as `L.hist[]`. Stall = gain over the macro < 1% AND the lift was not flagged >= 2 in any meso of the macro. "Fatigue stall" = gain < 1% AND flagged >= 2 at least once.
- P2 Window: one full macro (22 weeks). Not shorter: the calibration lag alone is ~1.4% and the test single moves the number by up to 12%. Compare smoothed estimates, never the test-week value.
- P3 Response to a stimulus stall (one change per lift per macro, in this order, advancing one step each stalled macro): (a) that lift's `learned` for Build +1 if the cap allows; (b) switch that lift's variation set to the alternate list for the whole next macro (section 4); (c) for bench only, move the bench_secondary slot from comp bench to Spoto/Larsen for the Build mesos (the book's "technique feels off -> drop the comp lift for several weeks", p.248); (d) if three macros stall, log "coach note: this lift has not moved in 15 months" and stop escalating.
- P4 Response to a fatigue stall: `learned` -1 for that lift in both Build and Strength, and the macro's easy week becomes 2 weeks. Do not also change the variation (two changes at once hide which one worked).
- P5 Noise guard: a stall on all three lifts at once with no flags in the macro is a life/nutrition/under-training signal, not three lift-specific problems; respond with (a) only, for all three, and the guide's sentence about eating at a small surplus in Build.

Expected effect: progress up for the one lift that would otherwise cruise; fatigue neutral (P4 reduces it when fatigue is the cause). Confidence: medium-high on signal and window, medium on the order of responses (volume first is the right bet for a lifter kept at the floor; a coach with eyes on the lifter might pick variation first).

## 4. Exercise rotation and directed variation

**Today:** the three variation slots rotate once per block (Build belt squat / close grip / RDL; Strength paused squat / paused bench / paused deadlift; Peak comp), the same every cycle, forever. Primaries never change. The book accepts always keeping the comp lifts as "quite sound" (p.268), wants variants rotated once per mesocycle (p.250) and says this works "for several mesocycles on end" but not infinitely; connective tissue and technique need the force line to change periodically (p.252).

- V1 Alternate variation sets by run parity (mesoCount of that block id, or simply Build #1 vs #2 in the macro): Build A = belt squat / close grip / RDL; Build B = other-bar squat / Larsen or Spoto / deficit deadlift. Strength A = paused squat / long-pause bench / paused deadlift; Strength B = other-bar squat / Spoto / block pull. All are already in `SWAPS`. User swaps still win. Constant across the macro: the comp lifts as primaries, the rep zone of the block, the day layout. For an intermediate that is what must stay constant; the variant is what moves.
- V2 Keep the variant for the full mesocycle (already true); never rotate inside a block (already true).
- V3 Proclivity without a questionnaire: the app can see which lift gains fastest (`L.hist`). The book's intermediate rule is to feed the responsive lift (p.313, 319): give the fastest-gaining lift first claim on the Build set ceiling (its `learned` ceiling may be +1 above the others). One line of code, zero input. Low priority, low-medium confidence that it matters at this volume level.
- V4 Weak-point work: the book puts limiting-factor training in the advanced category and says intermediates should still favour strong points; the declined weak-point questionnaire is correctly declined for now.

Expected effect: progress modestly up (adaptive resistance), fatigue slightly down (changing force lines reduces repeat micro-injury, p.252); the first week of a new variant brings more DOMS, which the readiness check already handles. Confidence: high on V1/V2 (direct book rule), low on V3.

## 5. Long-term failure modes the per-session and per-block logic cannot see

- F1 **Cruise at the floor** (section 2). Proven in sim: 0 primary additions in 78 weeks.
- F2 **Freshness read as capacity** (finding 2). Fix: in week 1 of any block, "felt easier than planned" earns 0 and soreness 1 earns 0 (the deload makes both true for everyone). Also learn the lifter's fatigue decay: if the first overload session after a deload estimates >= 3% above that lift's last-accumulation-week estimate, raise `fatigueAllowance` for that lift by 1 point (0.03 -> 0.04, cap 0.06); if the rebound is < 1%, lower it by 1 point (floor 0). That is the book's "slow vs fast fatigue dissipation" (p.311) learned from existing data. Confidence medium.
- F3 **Sets in Peak** (finding 3). Fix L4. Confidence high.
- F4 **Chronic under-recovery just under the triggers.** Flags reset every block; reds count per week; a red week that was handled with light sessions does not count (`reds >= 2 && lights < 2`); the deload suggestion never fired in any simulated profile. A lifter doing one light session every week, soreness 2, "solid" every day, never trips anything and never climbs. Add one rolling rule: over the last 4 training weeks (deloads excluded), >= 3 light sessions, or >= 3 red check-ins, or motivation <= 2 at >= 6 of the last 8 check-ins -> insert an easy week after the current week and set `learned` -1 for every lift in the current block. Motivation is already collected and is the book's "desire to train" indicator (p.157). Confidence medium-high.
- F5 **Downward ratchet of the max.** Calibration drops at once (up to 5%/session, floor 90% of block start, 85% with a miss) and rises slowly (2.5%/session, conf >= 1, smoothed). A consistent RPE over-reporter settles at a max where reported RPE equals planned RPE, which is self-limiting, not a runaway; the sim's app-vs-true error stays within -2.2% over 78 weeks in every profile. Not a failure mode on its own, but with F1 it means loads are right while volume is wrong, so the lifter feels fine and gains nothing. No change beyond F1.
- F6 **No automatic long-cycle rest.** Deloads recover the CNS "only 90-95%" each time and connective-tissue microtears accumulate across a macro (p.154); the app offers an easy week only at setup or by hand. Rule A5. Confidence high.
- F7 **Bodyweight and nutrition.** The book: eat hypercalorically only during high-volume training (p.302), 1-2 lb/week in gaining phases (p.365). The owner declined a bodyweight log, correctly: the app does not need the number. One sentence in the guide's Build block ("a small surplus belongs here, maintenance in Strength and Peak") covers it. No app change.
- F8 **Seasonal life stress.** Covered by F4 plus the readiness check-in; no extra input needed. The one addition worth having: when the user inserts an easy week by hand, that block's `learned` should not be updated from it (today a block cut short by an easy week still writes `learned` from a partial run). Confidence high, trivial.
- F9 **Test single every 12 weeks at RPE 9** with a 1.03 x TM warm-up is fine for connective tissue (two singles over 90% per lift per quarter); with the 22-week macro it halves anyway.

## 6. What the simulation must model to judge any of this

The harness has strength gain as a flat 0.3%/week regardless of training (= 17%/year compounding on all three lifts, which is late-novice territory; a true intermediate gains ~3-8%/year), fatigue as a fixed RPE ramp by week-of-block (not by volume), and readiness/soreness as random noise. It therefore cannot distinguish a program that adds sets from one that does not, cannot show a buried lifter, and the 3% fatigue allowance matches the sim's 0.7 RPE ramp by construction. A fitness-fatigue model that a reviewer can defend:

**Per lift, per day t (units: fraction of M0, the starting true 1RM):**

- Session load: `L_t = sum over working sets of r(RIR) * g(pct)`, with `r = 1 for RIR <= 2, 0.75 for 3, 0.5 for 4, 0.25 for >= 5` (effective-set weighting, as RP/Helms count it) and `g = (pct1RM / 0.75)^2` clipped to [0.4, 1.6] so heavy sets cost more fatigue and give more strength signal (p.109). Variants count at their `mult`.
- Fitness: `G_{t+1} = G_t * exp(-1/tauG) + kG * min(L_t, Lsat) * (1 - A_t)`. tauG = 40 d (Busso 2003 and Morton 1990 give 30-50 d for the fitness time constant), Lsat = 8 effective sets per session (diminishing returns), kG tuned so that the shipped Build-Strength-Peak cycle yields 5-7%/year on a "normal" responder; slow responder kG x 0.5, fast x 1.5.
- Short fatigue: `F_{t+1} = F_t * exp(-1/tauF) + kF * L_t^1.3`. tauF = 9 d (range 6-15; Busso's k2/k1 ~ 2 with tau2 ~ 1/3 of tau1); exponent 1.3 makes fatigue superlinear in volume (the book: volume is "the single biggest contributor", p.173). Tune kF so week 4 of base Build costs ~3% (matches the allowance) and twice the volume costs ~8%. Fragile: tauF 15 d, kF x 1.5.
- Slow fatigue (connective tissue, messengers): `C_{t+1} = C_t * exp(-1/tauC) + kC * (sets at >= 85%) + kC2 * weekly L`. tauC = 75 d. It adds to RPE (joints) and injury hazard rather than to M.
- Adaptive resistance: `A_{t+1} = A_t * exp(-1/tauA) + kA * L_t` for the same exercise and intensity zone, tauA = 30 d, capped 0.5, halved on a block or variant change. This is what makes a 2-meso Build with alternate variants differ from one with the same variants.
- MRV: a per-lift weekly MRV (normal: squat 14, bench 18, deadlift 10 effective sets; fragile x 0.7; it rises 5% per macro completed without exceeding it). If the 7-day sum of L exceeds it, kG = 0 for the week and the week's fatigue increment x 1.5 (non-functional overreaching). "Buried" = F > 8% for 3 consecutive weeks; count it.
- True max: `M_t = M0 * (1 + G_t) * (1 - F_t - 0.3 * C_t)`. Set RPE = `10 - (rtf(w / (M_t * mult)) - reps) + beta + N(0, 0.4)`, with reporting bias beta in {0, +0.5, -0.5} as profiles.
- Readiness and soreness derived from F (sleep/energy = 4 - 10*F, soreness = 1 + 15*F, each + noise), so light sessions and flags respond to real fatigue. Session difficulty from the mean RPE delta, not the worst set.
- Life stress: two random 3-week episodes per year with tauF x 1.5 and readiness -1.
- Detraining: G decays at tauG whenever L = 0 (so a 2-week active rest costs ~3% of G, which is the honest price the A5 rule must pay for).

**Outputs to report per profile over 104 weeks:** true 1RM gain, weeks buried, weeks with F > 5%, light sessions, max weekly effective sets reached, app-vs-true tracking error, unplanned easy weeks. Profiles: normal, slow, fast, fragile, over-reporter, under-reporter, life-stress. Judge a rule change by true gain at equal or lower weeks-buried; never by app 1RM.

Confidence in the equations: medium-high for the Banister core (it is the only strength-training model with fitted published parameters), medium for the MRV and adaptive-resistance terms (they encode the book's claims, not fitted data), and the absolute numbers matter less than the ranking of rule variants.

## Prioritised list (numeric rules, basis, effect, confidence)

1. **Make set progression reachable and phase-specific** (fixes F1): in Build, score >= 1 adds a set; "on target" (no misses, rpeDelta < 0.75, difficulty <= 2, soreness <= 2) scores +1; in Strength keep score >= 2 and at most +1 per run; in Peak never; week 1 of a block: "easier than planned" and soreness 1 score 0. Basis: book 0-1 set/week in hypertrophy, few/none in strength, none in peaking; calibration already consumes the "easy" signal. Effect: progress up (volume reaches MRV in 3-4 runs instead of never); fatigue neutral (flags still remove sets; Peak loses the sets it should never have had). Confidence high.
2. **Learned loop as an MRV search** (L1-L3): start at learned-1, ceiling learned+1 (max 3), end-of-run +1 if clean and ceiling reached, -1 if flagged twice; additions go to the primary first. Basis: p.322, RP meso design. Effect: progress up; fatigue down versus today's jump-start (ramp restored). Confidence high.
3. **No earned or learned sets in Peak; phase-specific caps** Build 14/18/10, Strength 12/16/9, Peak 8/12/6. Basis: pp.126, 340. Effect: fatigue down in the riskiest week; progress unchanged. Confidence high.
4. **22-week macro** Build x2 -> Strength x2 -> Peak (optional) -> easy week, with the alternate variation sets on the second run of each block (V1) and an automatic 1-week active rest (A5, 2 weeks after a rough macro). Basis: pp.285, 313, 338-339, 155, 250. Effect: progress up (phases long enough to work; resensitisation); fatigue down (half the test weeks; two active-rest weeks a year; 18 weeks below 90% before each Peak). Confidence high on shape, medium on exact lengths.
5. **Silent stall rule** (P1-P5): per lift, < 1% smoothed gain over a macro, unflagged -> Build learned +1, then alternate variations, then secondary-slot change, one step per macro; flagged -> learned -1 and a 2-week easy block. Basis: coaches compare same-phase to same-phase and change one thing. Effect: progress up for the stalled lift; fatigue down when fatigue caused it. Confidence medium-high. (Essential despite the earlier "not needed": it is the only lever that moves a lift the other rules leave static, and it needs no input.)
6. **Rolling under-recovery rule** (F4): over the last 4 training weeks >= 3 light sessions, or >= 3 reds, or motivation <= 2 at >= 6 of 8 check-ins -> easy week after this week and learned -1 for the block. Basis: p.157 indicators, p.154 accumulation across deloads. Effect: fatigue down; progress neutral (a week lost twice a year at most). Confidence medium-high.
7. **Cycle-to-cycle phase adaptation** (A1-A4): Strength gain < 1% on >= 2 lifts unflagged -> Build x3 next macro; mean gain >= 2% -> Strength x3; Build #2 with >= 2 lifts flagged -> skip to Strength; nothing to show -> skip Peak. Basis: pp.284-285, 301, 313. Effect: progress up for responders either way; fatigue neutral. Confidence medium (thresholds are set above calibration lag, not fitted).
8. **Learned fatigue allowance** (F2): post-deload rebound >= 3% -> allowance +0.01 for that lift (cap 0.06); < 1% -> -0.01 (floor 0). Basis: p.311 individual fatigue dissipation. Effect: fewer false max drops late in blocks for fragile lifters, fewer false "easy" weeks after; fatigue neutral. Confidence medium.
9. **Do not write `learned` from a block cut short by a hand-inserted easy week** (F8). Effect: avoids a spurious -1. Confidence high; trivial.
10. **Guide sentence on nutrition by phase** (F7): small surplus in Build, maintenance in Strength and Peak. No app change. Confidence high.
11. **Proclivity bias** (V3): fastest-gaining lift gets a Build ceiling one step higher. Low priority, low-medium confidence.
12. **Rebuild the simulation** per section 6 before shipping items 1, 2, 4 or 7, and judge every variant by true gain at equal or lower weeks-buried. Without it the current harness will show any volume rule as free and any rest rule as a pure cost.

On the four declined ideas: weak-point questionnaire (still not needed; the book says intermediates feed strong points, and V3 does that silently), bodyweight log (not needed; one guide sentence), short-on-time mode (not needed; the optional accessories already are that), plateau detection (needed in the silent form of item 5, for the reason given there).
