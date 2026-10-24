# Readyset: the program and why it is built this way

Readyset is a four-day powerlifting program that adapts to how you recover. Everything below is
condensed from Israetel, Hoffmann & Smith, *Scientific Principles of Strength Training* (2020).
Page numbers refer to that book. Where the app makes a choice the book leaves open, it says so.

## The shape of a cycle (12 weeks)

| Block | Weeks | Main lifts | Loads (as % of 1RM, TM = 90%) | Sets per lift per session | Then |
|---|---|---|---|---|---|
| Build | 4 | sets of 7-8 | 70% → 77% (+~3%/week) | 3 → 4, plus up to +2 earned | 1 deload week |
| Strength | 3 | sets of 5, 4, 3 | 76% → 86% | 4, plus up to +2 earned | 1 deload week |
| Peak & Test | 2 | triples then doubles | 85% → 90% | 3 | test week: one single at RPE 9 per lift |

The sequence is the book's hypertrophy → basic strength → peaking order (p.281), each phase at
least three weeks (p.284), with the hypertrophy phase at 4:1 accumulation to deload and the
strength phase at 3:1, which are the book's recommended starting mesocycle lengths (pp.338-339).
The Peak & Test block is optional (Settings). The book says peaking is "only a good idea if you've
got something to show for it" (p.285); without it the app alternates Build and Strength and updates
your maxes from your logged sets instead of a test.

Intensities live inside the book's zones: hypertrophy 60-75% 1RM for 6-10 reps (p.338), strength
75-90% for 3-6 reps (p.339), peaking 85-95% for 1-3 reps (p.340). Nothing above 90% appears outside
the Peak block, because "any training beyond 90% if the meet is far away" is the book's definition
of going too heavy too often (p.167). The Build block never exceeds 80%, which is where the book
says hypertrophy volume stops being sustainable (p.60).

## The week

| Day | Main lift | Second lift | Accessories |
|---|---|---|---|
| A Squat day | Competition squat | Competition bench (moderate) | leg curl, lat pulldown, abs (optional) |
| B Bench day | Competition bench | Overhead press | low row, triceps, biceps (optional) |
| C Deadlift day | Competition deadlift | Squat variation | leg extension, face pull, abs (optional) |
| D Bench variation day | Bench variation | Hinge variation | pulldown or row, lateral raise (optional), triceps |

That gives squats twice a week, bench muscles three times with one true overload, and one heavy
deadlift plus a hinge variation. This matches the book's lift-specific frequency guidance: quads at
least twice, bench muscles at least twice with the bench itself overloaded about once, heavy
deadlifts once for most lifters (pp.219-220). Two back-to-back rest days are "noticeably more
effective" (p.145), so Mon/Tue/Thu/Fri is the default. Heavy squat, bench and deadlift never fall
on three consecutive days (p.235).

Sessions are sized to about 50-65 minutes of lifting with 3 / 2 / 1.5 minute rests. The book gives
no rest-period numbers; those are conventional.

### Variations rotate once per block

| Slot | Build | Strength | Peak |
|---|---|---|---|
| Squat variation | belt squat | paused squat | competition squat (light) |
| Bench variation | close-grip bench | long-pause bench | competition bench (light) |
| Hinge variation | Romanian deadlift | paused deadlift | competition deadlift (light) |

The book wants exercises changed "once every mesocycle", not weekly (p.250), with variants
different enough to feel different: grips and stances at least a hand-width apart (p.265). The
close-grip cue in the app says exactly that. The competition lifts stay in every block because the
book accepts that as "quite sound" (p.268); the variation lives in the second slots.

## Weekly volume

| Pattern | Build wk 1 | Build wk 4 | Strength | Ceiling the app can climb to |
|---|---|---|---|---|
| Squat (comp + barbell variants) | 6 | 8 | 7 | 12 |
| Bench (comp + barbell variants) | 9 | 12 | 10 | 16 |
| Deadlift (comp + paused/deficit) | 3 | 4 | 7 | 9 |

These start low on purpose. The book's advice for anyone coming off a program that buried them is
to "start with a much lower volume than they use, and ease in. Increasing volume when you're
recovered is MUCH easier and safer than decreasing volume when you're already beat up" (p.164). The
weekly review then climbs toward your real maximum recoverable volume, which the book says to find
by adding sets slowly "until you're regularly overreaching in the week before deloads" (p.322). The
set counts you tolerated in a block are remembered and become the starting point the next time that
block runs (p.322). The ceilings exist so that no amount of good weeks can rebuild the volume that
wore you down.

## How it adapts

### Before a session: the check-in (6 taps)

Sleep, energy, motivation, and soreness by region, combined into a 0-100 readiness score.

| Score | What happens | Why |
|---|---|---|
| 60+ green | As planned. First set of each main lift may take bonus reps (max +2 in Build, +1 in Strength, none in Peak) | Rep PRs are "the most common" powerlifting PRs (p.86); failure is avoided (p.97) |
| 40-59 yellow | Loads unchanged. Bonus reps and any earned extra sets dropped | "Most of those times, an overload is quite possible" (p.96); the plan comes first |
| under 40 red | Light session recommended (Build: half the sets at 90% load; Strength: 70% / 70%; Peak: 90% / 50%), or rest and keep the session for next time | The book's light-session recipe (pp.148-149). Light beats a day off for both fatigue and fitness (p.179) |

A second red check-in in one week switches the rest of that week to light sessions. That is the
book's rule for a week that goes wrong: "Use Extra Light Sessions, not Deloads" (p.160).

### During a session: RPE adjusts the rest of the exercise

When you log a working set's RPE at 1.5 or more above its target, the remaining sets of that
exercise drop 5% (1.0 above drops 2.5%), to a floor of −10% for the exercise. A set 1.5 or more
below target raises the remaining sets 2.5%, once per exercise. The note under the exercise says
what happened and why. Deload, easy and test weeks are exempt because their loads are light on
purpose. The weekly review then sees the loads you actually lifted and the RPEs you logged, so a
day where the Training Max was slightly off is corrected on the spot without distorting next week.

### After a session: one tap

Easy / Solid / Very hard / Crushed me. Together with the RPE you log on each set and the soreness
you report at the next check-in, this feeds the weekly review.

### Every four sessions: the weekly review

For each competition lift the app scores the week:

- Missed reps or RPE 1.5+ above plan: −2. RPE 0.75+ above plan: −1. Below plan: +1.
- Session rated easy: +1. Very hard: −1. Crushed: −2.
- Fully recovered by the next session: +1. Still sore: −1. Very sore: −2.

Score +2 or better adds a set next week (until the ceiling; at the ceiling a very easy week earns a
bigger load jump instead). Score −2 or worse removes a set and takes 2.5% off next week's loads
(−5% at −4) and raises a flag. Two flags on two lifts, two red check-ins, or two crushing sessions
in a week make the app suggest taking the deload now. Nothing is added in the last accumulation
week, which the book expects to be the overreaching week before the deload (p.117).

The signals come straight from the book's MRV indicators: not matching last week's reps (p.126,
pp.338-339), the bar feeling disproportionately heavy, low desire to train, poor sleep (p.77),
being dull and tired instead of sore (p.125).

### Deload weeks

First half of the week: half the sets at 90% of the overload load (Build) or 70% / 70% (Strength).
Second half: half the sets at half the load. That is the book's deload table (pp.152-153). The book
is blunt that "if your deload is tough, you're not dropping the fatigue you should be" (p.174).

### Training Max updates

Every barbell load is a percentage of a Training Max, 90% of your 1RM by default, so a session is
always doable on a mediocre day. At the end of each block:

- If your logged sets (weight × reps at RPE 7+) estimate a higher 1RM, the 1RM rises to that, capped
  at +5% per block (+12% after a test week).
- A clean block with no flags and no missed reps earns +5 lb (squat, deadlift) or +2.5 lb (bench).
- A lift flagged twice in a block drops 2.5%.
- The Peak block's test single sets the 1RM directly.

### Accessories

Self-loaded work (belt squat, dumbbells, machines) uses double progression: when every set reaches
the top of the rep range, the weight goes up next time. Accessory sets sit at 2-3 per exercise and
only climb when no lift is flagged. The book caps isolation work at about 30% of a hypertrophy
program and wants little or none in strength phases (pp.338-339); biceps, lateral raises and abs
are marked optional so they are the first thing to drop on a short day.

## Cardio

The BikeErg block after lifting is for health and recovery, not training stress. The book's
guidance on cardio for powerlifters: keep it low impact (biking is fine, running is not), keep it
under roughly 1,500 kcal per week, and judge the dose by whether the lifts keep improving rather
than by how it feels (pp.351-353). Four sessions of 60 minutes at an easy 110 W is about 1,600 kcal,
so the app shows a weekly running estimate against that guideline. Practical reading of that:

- 45-60 minutes after lifting at a pace where nose breathing is comfortable is a sensible default.
- If you want the full 90 minutes some days, keep it at the very easy end and watch the weekly total.
- A light session day halves the cardio target.
- Off-day walking or easy biking can be logged in Settings and counts toward the weekly total.

## What the app deliberately does not do

- No sets to failure and no AMRAP sets; bonus reps are capped (p.97, p.133).
- No training above 90% outside the Peak block (p.167).
- No week-to-week exercise rotation (p.273).
- No "lighter weight, more reps" deloads; both volume and intensity drop (pp.173-174).
- No mixing of rep zones inside a week; each block keeps one focus (pp.41-42, 304-305).
- No unplanned deloads from a single bad day; a bad day becomes a light session (p.160).

## Honest limits

- RPE is a skill. For the first few weeks, log it conservatively; the review tolerates noise but
  consistent over- or under-reporting will push the volume the wrong way.
- 1RM estimates from sets of 7-8 are rough. The Peak block's test single is the real number.
- The readiness score weights are a design choice (sleep 30%, energy 25%, soreness 25%,
  motivation 20%); the book names these signals but gives no formula.
- This is a program, not a coach. Pain, illness, and life stress still need your own judgment.
