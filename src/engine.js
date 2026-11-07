/* Readyset engine — pure training logic, no DOM.
   Loads are fractions of the Training Max (TM). TM defaults to 90% of the lifter's 1RM, so a
   "100% TM" set is a ~90% 1RM set. %1RM figures in comments assume that default.
   Sources: Israetel, Hoffmann & Smith, Scientific Principles of Strength Training (2020); page
   numbers in comments refer to that book. */
(function (root) {
  'use strict';

  // ---------- Rep-max math (reps-to-failure -> fraction of 1RM) ----------
  const RM = [0, 1.0, 0.955, 0.922, 0.892, 0.863, 0.837, 0.811, 0.786, 0.762, 0.739, 0.717, 0.694, 0.672, 0.650, 0.630];
  function pctForRTF(n) {
    if (n <= 1) return 1;
    if (n >= 15) return RM[15] * Math.pow(0.978, n - 15);
    const lo = Math.floor(n), hi = Math.ceil(n), f = n - lo;
    return RM[lo] + (RM[hi] - RM[lo]) * f;
  }
  function rtfForPct(p) {
    if (p >= 1) return 1;
    for (let n = 1; n < 40; n++) {
      const a = pctForRTF(n), b = pctForRTF(n + 1);
      if (p <= a && p >= b) return n + (a - p) / (a - b);
    }
    return 40;
  }
  function e1rm(weight, reps, rpe) {
    if (!(weight > 0) || !(reps > 0) || !(rpe >= 0)) return 0;
    const rir = Math.max(0, Math.min(6, 10 - rpe));
    return weight / pctForRTF(Math.min(reps, 30) + rir);
  }
  const MAX_EVIDENCE_REPS = 20; // a set logged with more reps than this is a typo, not evidence
  function expectedRIR(pctOf1RM, reps) { return Math.max(0, rtfForPct(pctOf1RM) - reps); }
  function plannedRPE(pctOf1RM, reps) { return Math.min(10, Math.max(5, Math.round((10 - expectedRIR(pctOf1RM, reps)) * 2) / 2)); }

  // ---------- Loading ----------
  function roundTo(x, inc) { return Math.round(x / inc) * inc; }
  function floorTo(x, inc) { return Math.floor(x / inc + 1e-9) * inc; }
  // The barbell step: one pair of the smallest plate. Totals are the bar plus whole steps, so a
  // 45 lb bar with no 2.5s gets 45, 55, 65... (never a total that leaves 2.5 per side).
  function loadStep(plates) { const ps = (plates || []).filter(p => typeof p === 'number' && p > 0); return ps.length ? 2 * Math.min(...ps) : 5; }
  // The per-side amounts (in quarter pounds, up to 1000 lb a side) a set of plates can make.
  const reachMemo = new Map();
  function reachable(ps) {
    const key = ps.join(','); if (reachMemo.has(key)) return reachMemo.get(key);
    const U = 4, max = 1000 * U, units = ps.map(p => Math.round(p * U)).filter(p => p > 0), ok = new Uint8Array(max + 1); ok[0] = 1;
    for (let a = 1; a <= max; a++) for (const p of units) if (p <= a && ok[a - p]) { ok[a] = 1; break; }
    if (reachMemo.size > 50) reachMemo.clear();
    reachMemo.set(key, ok); return ok;
  }
  // A barbell total the plates can make: the nearest one to x (ties go up, as rounding did), never
  // under the bar. With a full set of small plates this is the bar plus whole pairs of the smallest.
  function barRound(x, bar, step, plates) {
    const grid = bar + Math.max(0, roundTo(x - bar, step > 0 ? step : 5));
    const ps = (plates || []).filter(p => typeof p === 'number' && p > 0);
    if (!ps.length) return grid;
    const ok = reachable(ps), U = 4, maxA = ok.length - 1, t = Math.max(0, (x - bar) / 2 * U);
    if (t >= maxA) return grid;
    let lo = Math.floor(t + 1e-9), hi = Math.ceil(t - 1e-9);
    while (lo > 0 && !ok[lo]) lo--;
    while (hi < maxA && !ok[hi]) hi++;
    const a = !ok[hi] ? lo : (hi - t) <= (t - lo) ? hi : lo;
    return bar + 2 * a / U;
  }
  function loadRound(state, x) { const S = state.settings; return barRound(x, S.barWeight > 0 ? S.barWeight : 45, S.increment > 0 ? S.increment : 5, S.plates); }
  // The in-session correction's weight on the plates: the nearest total, except that it never
  // passes the cap over the planned weight (a +2.5% cap on 300 is 307.5: 305, not 310).
  function correctedLoad(state, w, plannedW, up) {
    let t = loadRound(state, w);
    if (!(plannedW > 0)) return t;
    const ceil = plannedW * (up > 0 ? up : TUNE.correction.ceil), half = (state.settings.increment > 0 ? state.settings.increment : 5) / 2;
    for (let k = 1; t > ceil + 1e-9 && t > plannedW && k <= 40; k++) { const c = loadRound(state, t - k * half); if (c < t) { t = Math.max(plannedW, c); k = 0; } }
    return t;
  }
  // The last warm-up before a near-max opener single: one single at about 90% of it, when the jump
  // from the ramp would be more than 10% (engine and mid-session rebases use the same rule).
  function openerWarm(ow, lastWarm, bar, inc, plates) { if (ow - lastWarm > ow * 0.1) { const ws = barRound(ow * 0.9, bar, inc, plates); if (ws > lastWarm + 5 && ws < ow) return ws; } return null; }
  // Plates per side for a total. Largest plates first when that lands exactly; otherwise the fewest
  // plates that make it (plate sets without 5s: 10+10+10 for 30, which a greedy pick misses), and
  // failing that the closest load under it.
  const plateMemo = new Map();
  function plateLoad(total, bar, plates) {
    const perSide0 = (total - bar) / 2;
    if (!(perSide0 >= 0)) return { plates: [], exact: total === bar, short: 0 };
    const sorted = (plates || []).filter(p => typeof p === 'number' && p > 0).sort((a, b) => b - a);
    const key = total + '|' + bar + '|' + sorted.join(',');
    if (plateMemo.has(key)) return plateMemo.get(key);
    let perSide = perSide0; const greedy = [];
    for (const p of sorted) { while (perSide >= p - 1e-9) { greedy.push(p); perSide -= p; } }
    let res = { plates: greedy, exact: perSide < 1e-9, short: Math.round(perSide * 100) / 100 };
    const U = 4, target = Math.floor(perSide0 * U + 1e-9), ps = sorted.map(p => Math.round(p * U));
    if (!res.exact && target <= 6000 && ps.length && ps.every(p => p > 0)) {
      const cnt = new Array(target + 1).fill(Infinity), via = new Array(target + 1).fill(-1); cnt[0] = 0;
      for (let a = 1; a <= target; a++) for (let i = 0; i < ps.length; i++) { const p = ps[i]; if (p <= a && cnt[a - p] + 1 < cnt[a]) { cnt[a] = cnt[a - p] + 1; via[a] = i; } }
      let a = target; while (a > 0 && cnt[a] === Infinity) a--;
      if (a > target - Math.round(perSide * U) || a === target) {
        const out = []; for (let b = a; b > 0; b -= ps[via[b]]) out.push(sorted[via[b]]);
        out.sort((x, y) => y - x);
        res = { plates: out, exact: a === target && Math.abs(target / U - perSide0) < 1e-9, short: Math.round((perSide0 - a / U) * 100) / 100 };
      }
    }
    if (plateMemo.size > 2000) plateMemo.clear();
    plateMemo.set(key, res);
    return res;
  }

  // ---------- Exercise catalog (home-gym equipment) ----------
  // tm: which TM the load comes from; mult: fraction of that TM equal to a "100%" prescription.
  // Variants must differ meaningfully from the competition lift (grip/stance >= one hand-width,
  // p.265), so each barbell variant carries a cue.
  const EX = {
    comp_squat:      { name: 'Competition Squat', tm: 'squat', mult: 1.0, load: 'bar', group: 'legs', muscles: ['quads', 'glutes'] },
    paused_squat:    { name: 'Paused Squat', tm: 'squat', mult: 0.85, load: 'bar', group: 'legs', muscles: ['quads', 'glutes'], cue: '2-count pause in the hole, stay tight, drive up' },
    tempo_squat:     { name: 'Tempo Squat', tm: 'squat', mult: 0.80, load: 'bar', group: 'legs', muscles: ['quads', 'glutes'], cue: '3 s down, no pause, normal up' },
    high_bar_squat:  { name: 'High-Bar Squat', tm: 'squat', mult: 0.88, load: 'bar', group: 'legs', muscles: ['quads', 'glutes'], cue: 'Bar on traps, upright torso, quads do the work' },
    low_bar_squat:   { name: 'Low-Bar Squat', tm: 'squat', mult: 1.0, load: 'bar', group: 'legs', muscles: ['glutes', 'hamstrings', 'quads'], cue: 'Bar on rear delts, hips back, forward lean, drive the hips up' },
    belt_squat:      { name: 'Belt Squat', tm: null, load: 'belt', group: 'legs', muscles: ['quads', 'glutes'], startHint: 'Pick a weight you could do for about 15 reps' },
    comp_bench:      { name: 'Competition Bench', tm: 'bench', mult: 1.0, load: 'bar', group: 'push', muscles: ['chest', 'triceps', 'delts'] },
    close_grip:      { name: 'Close-Grip Bench', tm: 'bench', mult: 0.90, load: 'bar', group: 'push', muscles: ['triceps', 'chest'], cue: 'Grip at least one hand-width (3-4 in) narrower than competition' },
    paused_bench:    { name: 'Long-Pause Bench', tm: 'bench', mult: 0.90, load: 'bar', group: 'push', muscles: ['chest', 'triceps'], cue: '3-count pause on the chest, stay tight' },
    spoto_press:     { name: 'Spoto Press', tm: 'bench', mult: 0.90, load: 'bar', group: 'push', muscles: ['chest', 'triceps'], cue: 'Pause 1 in off the chest for 2 s' },
    larsen_press:    { name: 'Larsen Press', tm: 'bench', mult: 0.85, load: 'bar', group: 'push', muscles: ['chest', 'triceps'], cue: 'Legs straight out, no leg drive' },
    ohp:             { name: 'Overhead Press', tm: 'bench', mult: 0.62, load: 'bar', group: 'push', muscles: ['delts', 'triceps'] },
    db_incline:      { name: 'Incline DB Press', tm: null, load: 'db', group: 'push', muscles: ['chest', 'delts', 'triceps'], startHint: 'Per dumbbell, about a 12-rep weight' },
    db_shoulder:     { name: 'Seated DB Shoulder Press', tm: null, load: 'db', group: 'push', muscles: ['delts', 'triceps'], startHint: 'Per dumbbell, about a 12-rep weight' },
    comp_deadlift:   { name: 'Competition Deadlift', tm: 'deadlift', mult: 1.0, load: 'bar', group: 'hinge', muscles: ['hamstrings', 'glutes', 'back'] },
    paused_deadlift: { name: 'Paused Deadlift', tm: 'deadlift', mult: 0.80, load: 'bar', group: 'hinge', muscles: ['hamstrings', 'glutes', 'back'], cue: '2-count pause just below the knee on the way up' },
    deficit_deadlift:{ name: 'Deficit Deadlift', tm: 'deadlift', mult: 0.85, load: 'bar', group: 'hinge', muscles: ['hamstrings', 'glutes', 'back'], cue: 'Stand on a 1-2 in plate' },
    rdl:             { name: 'Romanian Deadlift', tm: 'deadlift', mult: 0.60, load: 'bar', group: 'hinge', muscles: ['hamstrings', 'glutes', 'back'], cue: 'Soft knees, hips back, bar to mid-shin, no bounce' },
    block_pull:      { name: 'Block Pull', tm: 'deadlift', mult: 1.05, load: 'bar', group: 'hinge', muscles: ['back', 'glutes'], cue: 'Bar just below the knee' },
    lat_pulldown:    { name: 'Lat Pulldown', tm: null, load: 'machine', group: 'pull', muscles: ['back', 'biceps'], startHint: 'About a 12-rep weight' },
    low_row:         { name: 'Low Row', tm: null, load: 'machine', group: 'pull', muscles: ['back', 'biceps'], startHint: 'About a 12-rep weight' },
    db_row:          { name: 'Chest-Supported DB Row', tm: null, load: 'db', group: 'pull', muscles: ['back', 'biceps'], startHint: 'Per dumbbell, about a 12-rep weight' },
    face_pull:       { name: 'Face Pull', tm: null, load: 'machine', group: 'pull', muscles: ['rear delts', 'back'], startHint: 'Light, about a 15-rep weight (pulldown station)' },
    leg_curl:        { name: 'Seated Leg Curl', tm: null, load: 'machine', group: 'legs', muscles: ['hamstrings'], startHint: 'About a 12-rep weight' },
    leg_ext:         { name: 'Leg Extension', tm: null, load: 'machine', group: 'legs', muscles: ['quads'], startHint: 'About a 12-rep weight' },
    split_squat:     { name: 'DB Split Squat', tm: null, load: 'db', group: 'legs', muscles: ['quads', 'glutes'], startHint: 'Per dumbbell, about a 12-rep weight' },
    tri_pushdown:    { name: 'Triceps Pushdown', tm: null, load: 'machine', group: 'arms', muscles: ['triceps'], startHint: 'About a 12-rep weight (pulldown station)' },
    db_oh_tri:       { name: 'DB Overhead Triceps Extension', tm: null, load: 'db', group: 'arms', muscles: ['triceps'], startHint: 'One dumbbell, about a 12-rep weight' },
    db_curl:         { name: 'DB Curl', tm: null, load: 'db', group: 'arms', muscles: ['biceps'], startHint: 'Per dumbbell, about a 12-rep weight' },
    machine_curl:    { name: 'Low-Row Station Curl', tm: null, load: 'machine', group: 'arms', muscles: ['biceps'], startHint: 'About a 12-rep weight' },
    lateral_raise:   { name: 'DB Lateral Raise', tm: null, load: 'db', group: 'arms', muscles: ['delts'], startHint: 'Per dumbbell, about a 15-rep weight' },
    hanging_raise:   { name: 'Hanging Knee Raise', tm: null, load: 'bw', group: 'core', muscles: ['abs'] },
    cable_crunch:    { name: 'Pulldown Crunch', tm: null, load: 'machine', group: 'core', muscles: ['abs'], startHint: 'About a 15-rep weight' },
  };

  // Which exercises may fill each slot (first = default when the block names none).
  const SWAPS = {
    squat_primary: ['comp_squat'],
    bench_primary: ['comp_bench'],
    deadlift_primary: ['comp_deadlift'],
    bench_secondary: ['comp_bench', 'spoto_press', 'larsen_press', 'paused_bench'],
    squat_variation: ['belt_squat', 'paused_squat', 'tempo_squat', 'high_bar_squat', 'low_bar_squat', 'comp_squat'],
    bench_variation: ['close_grip', 'paused_bench', 'spoto_press', 'larsen_press', 'comp_bench'],
    hinge_variation: ['rdl', 'paused_deadlift', 'deficit_deadlift', 'block_pull', 'comp_deadlift'],
    press_secondary: ['ohp', 'db_shoulder', 'db_incline'],
    hamstrings: ['leg_curl', 'rdl'],
    quads: ['leg_ext', 'belt_squat', 'split_squat'],
    back_vertical: ['lat_pulldown', 'db_row'],
    back_horizontal: ['low_row', 'db_row', 'lat_pulldown'],
    rear_delts: ['face_pull', 'lateral_raise'],
    triceps: ['tri_pushdown', 'db_oh_tri'],
    biceps: ['db_curl', 'machine_curl'],
    delts: ['lateral_raise', 'face_pull'],
    abs: ['hanging_raise', 'cable_crunch'],
  };

  // ---------- Blocks ----------
  // pct is of (TM x exercise mult). With TM = 90% 1RM:
  //   Build:    primaries 70-77% 1RM for 7-8 reps (hypertrophy zone 60-75%, 6-10 reps; pp.17, 338)
  //   Strength: primaries 76-86% 1RM for 3-5 reps (75-90%, 3-6 reps; pp.18, 62, 339)
  //   Peak:     primaries 85-90% for 1-3 reps, then a test week (p.340)
  // Week-to-week: +2.5-3% load and 0-1 barbell set in Build, load only in Strength except week 2's
  // third second-lift and accessory set (pp.79-82, 338-339). Accessories take total weekly sets up by 30-40% from week 1 to 2.
  const BLOCKS = [
    {
      id: 'build', name: 'Build', focus: 'Muscle and work capacity', weeks: 4, deload: true,
      primary:   [{ sets: 3, reps: 8, pct: 0.775 }, { sets: 4, reps: 8, pct: 0.80 }, { sets: 4, reps: 8, pct: 0.825 }, { sets: 4, reps: 7, pct: 0.85 }],
      // The erectors pay for 8s and deadlift reps-at-percentage may run a rep under squat and bench (weak
      // evidence; the RPE and e1RM math does not assume it), so the deadlift builds with 5-6s at 72-79%
      // 1RM and the RDL carries the hamstring volume.
      primaryByLift: { deadlift: [{ sets: 3, reps: 6, pct: 0.80 }, { sets: 4, reps: 6, pct: 0.825 }, { sets: 4, reps: 6, pct: 0.85 }, { sets: 4, reps: 5, pct: 0.875 }] },
      secondary: [{ sets: 3, reps: 8, pct: 0.75 }, { sets: 3, reps: 8, pct: 0.775 }, { sets: 4, reps: 8, pct: 0.80 }, { sets: 4, reps: 8, pct: 0.825 }],
      accessory: [{ sets: 2, reps: 12 }, { sets: 3, reps: 12 }, { sets: 3, reps: 12 }, { sets: 3, reps: 12 }],
      plus: 2, light: { vol: 0.5, int: 0.9 }, deloadA: { vol: 0.5, int: 0.9 }, deloadB: { vol: 0.5, int: 0.5 },
      // Two variation sets, alternating between the two runs of the block in a macro (p.250: rotate
      // once per mesocycle; p.252: change the force line periodically). The squat variation is a
      // barbell squat so the squat is grooved twice a week (5-9 weekly sets per lift is where the
      // strength dose-response sits); the belt squat stays one swap away.
      variation: { squat_variation: 'paused_squat', bench_variation: 'close_grip', hinge_variation: 'rdl' },
      variationB: { squat_variation: 'high_bar_squat', bench_variation: 'larsen_press', hinge_variation: 'deficit_deadlift' },
      // The deficit pull follows the same reasoning as the deadlift: 6s, not 8s (load up to keep the effort).
      secondaryByEx: { deficit_deadlift: [{ sets: 3, reps: 6, pct: 0.80 }, { sets: 3, reps: 6, pct: 0.825 }, { sets: 4, reps: 6, pct: 0.85 }, { sets: 4, reps: 6, pct: 0.875 }] },
    },
    {
      id: 'strength', name: 'Strength', focus: 'Heavier, fewer reps', weeks: 3, deload: true,
      // Week 3 opens with one single at ~92% 1RM (RPE 8 on the chart) before the triples: the
      // routine max anchor coaches use instead of a test week, and strong evidence for calibration.
      // Week 1 keeps the second lift at 2 sets so the Build -> Strength step in counted barbell sets
      // stays under ~30%, while reps and tonnage roughly halve (the week-2 scheme brings the third set back; earned sets go to the competition lift only).
      primary:   [{ sets: 4, reps: 5, pct: 0.85 }, { sets: 4, reps: 4, pct: 0.90 }, { sets: 3, reps: 3, pct: 0.95, opener: { pct: 1.02, rpe: 8 } }],
      secondary: [{ sets: 2, reps: 5, pct: 0.80 }, { sets: 3, reps: 5, pct: 0.83 }, { sets: 3, reps: 4, pct: 0.86 }],
      accessory: [{ sets: 2, reps: 10 }, { sets: 3, reps: 10 }, { sets: 3, reps: 8 }],
      plus: 1, light: { vol: 0.7, int: 0.7 }, deloadA: { vol: 0.7, int: 0.7 }, deloadB: { vol: 0.5, int: 0.5 },
      variation: { squat_variation: 'paused_squat', bench_variation: 'paused_bench', hinge_variation: 'paused_deadlift' },
      variationB: { squat_variation: 'high_bar_squat', bench_variation: 'spoto_press', hinge_variation: 'block_pull' },
    },
    {
      id: 'peak', name: 'Peak & Test', focus: 'Express strength, set new maxes', weeks: 2, deload: false, test: true,
      primary:   [{ sets: 3, reps: 3, pct: 0.95 }, { sets: 3, reps: 2, pct: 1.0 }],
      secondary: [{ sets: 3, reps: 4, pct: 0.80 }, { sets: 2, reps: 3, pct: 0.80 }],
      accessory: [{ sets: 2, reps: 10 }, { sets: 1, reps: 10 }],
      plus: 0, light: { vol: 0.5, int: 0.8 }, deloadA: { vol: 0.9, int: 0.5 }, deloadB: { vol: 0.5, int: 0.5 },
      variation: { squat_variation: 'comp_squat', bench_variation: 'comp_bench', hinge_variation: 'comp_deadlift' },
    },
  ];
  // The macro: two hypertrophy mesocycles, two strength mesocycles, an optional peak and test, then
  // an easy week (intermediates: 2-3 months per phase, pp.285, 313, 338-339; active rest once or
  // twice a year, p.155). Each block's second run uses its alternate variation set.
  const MACRO = [{ block: 'build', variant: 'A' }, { block: 'build', variant: 'B' }, { block: 'strength', variant: 'A' }, { block: 'strength', variant: 'B' }, { block: 'peak', variant: 'A' }];
  const blockIndex = (id) => BLOCKS.findIndex(b => b.id === id);
  // Active rest: 50% volume / 50% intensity, non-competition lifts (pp.155, 343).
  const REST = { primary: { sets: 2, reps: 5, pct: 0.50 }, secondary: { sets: 2, reps: 6, pct: 0.50 }, accessory: { sets: 2, reps: 12 },
    variation: { squat_primary: 'high_bar_squat', bench_primary: 'close_grip', deadlift_primary: 'paused_deadlift', bench_secondary: 'spoto_press', squat_variation: 'tempo_squat', bench_variation: 'larsen_press', hinge_variation: 'rdl' } };
  const TEST = { warmups: [{ reps: 5, pct: 0.55 }, { reps: 3, pct: 0.70 }, { reps: 2, pct: 0.80 }, { reps: 1, pct: 0.90 }, { reps: 1, pct: 0.97 }, { reps: 1, pct: 1.03 }], backoff: { sets: 2, reps: 3, pct: 0.80 } };

  // ---------- Tunable thresholds (one place, so simulations can sweep them) ----------
  const TUNE = {
    // Red needs at least two poor answers (one bad night barely moves maximal strength); yellow is
    // the common so-so day and gets a small load nudge rather than a volume cut.
    readiness: { green: 50, yellow: 35 },
    trim: { load: 0.975 },
    // In-session: a hard first set counts in full (RPE rises set to set at a fixed load, so a hard
    // first set predicts harder later sets); an easy day may push the remaining sets up by at most
    // 2.5% (never in Peak). Stop rules: a miss, a non-first set 2+ over target, or the floor.
    correction: { firstSetWeight: 0.5, firstSetHardWeight: 1.0, floor: 0.85, ceil: 1.025, ceilPeak: 1.0, ceilLight: 1.0, minRpe: 4, lowRpeWeight: 0.35, stopOver: 2, stopMin: 8.5, floorStep: 0.925, floorHard: 1 },
    sessionCapMin: 75, // the top of the owner's 60-75 minute budget for the required work (optional slots are extra, never counted); estimates assume a full rest after every set
    calibrate: { downAt: 0.97, downMax: 0.95, downConfHigh: 1.5, downSure: 0.95, upAt: 1.02, upMax: 1.025, upFastAt: 1.04, allowance: 0.03, blockFloor: 0.90, blockFloorMissed: 0.85, minRpe: 6.5 },
    review: { add: 2, cut: -2, bigCut: -4, onTarget: 1 },
    // Deload-now triggers: within the week, and across the block (chronic under-recovery that
    // stays under the weekly triggers: many reds, repeated calibration drops, readiness trend).
    deload: { flaggedLifts: 2, redsWeek: 2, crushedWeek: 2, redsBlock: 4, calibDropsLift: 2, calibDropPct: 0.06, lightsBlock: 4, readinessDrop: 15, readinessLow: 45, readinessAbs: 50, readinessVeryLow: 40, readinessWeeks: 2, chronicFromWeek: 2, dialStepsPerBlock: 1, readinessMovesDial: true },
    // Volume dial: a lasting, program-wide set offset (-2..+2) that finds the lifter's recoverable
    // volume across blocks. Down one step whenever block-level fatigue forces a deload; up one step
    // after a block that stayed clean while already adding sets.
    dial: { min: -2, max: 2, autoMax: 0 }, // above 0 by hand only (+1 is 68-71 min of required work, inside the budget since the optional slots left it)
  };

  // Hard weekly caps on working sets for each competition pattern (comp lift + barbell variants).
  // Set additions can never climb past these, so the volume that buried you stays out of reach.
  const CAPS = { squat: 12, bench: 16, deadlift: 9 };
  // Each phase has its own recoverable volume (pp.123-126): hypertrophy highest, peaking lowest.
  const CAPS_BY_BLOCK = { build: { squat: 14, bench: 18, deadlift: 10 }, strength: { squat: 12, bench: 16, deadlift: 9 }, peak: { squat: 8, bench: 12, deadlift: 6 } };
  function capFor(state, lift) { const b = BLOCKS[clampProgram(state).blockIdx]; return (CAPS_BY_BLOCK[b.id] || CAPS)[lift]; }
  const ACC_CAP = 4;

  // ---------- Four-day layout ----------
  // Squat 2x, bench muscles 3x (one overload), deadlift heavy 1x + a hinge variant (pp.219-220).
  const DAYS = [
    { id: 'A', name: 'Squat day', slots: [
      { key: 'squat_primary', role: 'primary', tm: 'squat' },
      { key: 'bench_secondary', role: 'secondary', tm: 'bench' },
      { key: 'hamstrings', role: 'accessory' },
      { key: 'back_vertical', role: 'accessory' },
      { key: 'abs', role: 'accessory', optional: true }] },
    // The hinge variation sits on bench day: two days before the heavy pull and the day after the
    // squat, not 24 h after the deadlift (deadlift and hamstring recovery is the slowest, pp.135,
    // 140, 219-220). Friday is upper body only, so Monday's squat follows three days without a bar.
    { id: 'B', name: 'Bench day', slots: [
      { key: 'bench_primary', role: 'primary', tm: 'bench' },
      { key: 'hinge_variation', role: 'secondary', tm: 'deadlift' },
      { key: 'back_horizontal', role: 'accessory' },
      { key: 'triceps', role: 'accessory' },
      { key: 'biceps', role: 'accessory', optional: true }] },
    { id: 'C', name: 'Deadlift day', slots: [
      { key: 'deadlift_primary', role: 'primary', tm: 'deadlift' },
      { key: 'squat_variation', role: 'secondary', tm: 'squat' },
      { key: 'quads', role: 'accessory' },
      { key: 'rear_delts', role: 'accessory' },
      { key: 'abs', role: 'accessory', optional: true }] },
    { id: 'D', name: 'Bench variation day', slots: [
      { key: 'bench_variation', role: 'secondary', tm: 'bench' },
      { key: 'press_secondary', role: 'secondary', tm: 'bench' },
      { key: 'back_vertical', role: 'accessory' },
      { key: 'delts', role: 'accessory', optional: true },
      { key: 'triceps', role: 'accessory' }] },
  ];

  // ---------- Readiness ----------
  // sleep, energy, motivation: 1 (worst) .. 5 (best). soreness: 1 (fresh) .. 5 (wrecked).
  function readinessScore(r) {
    r = r || {};
    const s = (v) => { const n = Number(v); return (Number.isFinite(n) ? Math.min(5, Math.max(1, n)) - 1 : 2) / 4; };
    const score = 100 * (0.30 * s(r.sleep) + 0.25 * s(r.energy) + 0.25 * (1 - s(r.soreness)) + 0.20 * s(r.motivation));
    const color = score >= TUNE.readiness.green ? 'green' : score >= TUNE.readiness.yellow ? 'yellow' : 'red';
    return { score: Math.round(score), color };
  }
  // Soreness by muscle group (1 none .. 4 very sore) -> the 1..5 soreness answer.
  function sorenessFromGroups(g) {
    const m = Math.max(g.legs || 1, g.push || 1, g.hinge || 1);
    return { 1: 1, 2: 2.5, 3: 4, 4: 5 }[m] || 1;
  }
  // Modes. 'full' = the plan. 'trim' (yellow) keeps the loads (most so-so days still allow an
  // overload, p.96) but drops bonus reps and any earned set additions. 'light' (red) is the
  // book's light session for the block: volume and intensity as fractions of the overload day
  // (pp.148-149). Light beats a day off for both fatigue and fitness (p.179).
  const MODES = { full: { label: 'As planned' }, trim: { label: 'Trimmed' }, light: { label: 'Light session' } };

  // ---------- Session generation ----------
  function tmOf(state, lift) { return state.lifts[lift].tm; }
  // The "other" bar position is the variation: high-bar for a low-bar competitor and vice versa.
  function otherSquat(state) { return state.settings.squatStyle === 'highbar' ? 'low_bar_squat' : 'high_bar_squat'; }
  function resolveExercise(state, slot, block, rest) {
    const sw = state.program.swaps || {};
    let id;
    const vset = (state.program.variantSet === 'B' && block.variationB) ? block.variationB : block.variation;
    if (sw[slot.key] && EX[sw[slot.key]] && SWAPS[slot.key].includes(sw[slot.key])) id = sw[slot.key];
    else if (rest && REST.variation[slot.key]) id = REST.variation[slot.key];
    else if (vset && vset[slot.key]) id = vset[slot.key];
    else id = SWAPS[slot.key][0];
    if (id === 'high_bar_squat' || id === 'low_bar_squat') id = otherSquat(state);
    if (!EX[id]) id = SWAPS[slot.key][0];
    return id;
  }
  function clampProgram(state) {
    const P = state.program;
    if (!(P.blockIdx >= 0 && P.blockIdx < BLOCKS.length)) P.blockIdx = 0;
    const tw = totalWeeks(BLOCKS[P.blockIdx]);
    if (!(P.week >= 1 && P.week <= tw)) P.week = Math.min(Math.max(1, Math.round(P.week) || 1), tw);
    if (!(P.dayIdx >= 0 && P.dayIdx < DAYS.length)) P.dayIdx = 0;
    if (P.special && !(P.special.weeksLeft > 0)) P.special.weeksLeft = 1;
    if (P.special && P.special.type !== 'rest' && P.special.type !== 'deload') P.special = null;
    if (typeof P.calibDrops !== 'object' || !P.calibDrops) P.calibDrops = {};
    P.setAdj = Object.assign({ squat: 0, bench: 0, deadlift: 0, acc: 0 }, P.setAdj || {});
    P.loadAdj = Object.assign({ squat: 0, bench: 0, deadlift: 0 }, P.loadAdj || {});
    P.flags = Object.assign({ squat: 0, bench: 0, deadlift: 0 }, P.flags || {});
    return P;
  }
  function exerciseName(state, exId) {
    if (exId === 'comp_squat') return `Competition Squat (${state.settings.squatStyle === 'highbar' ? 'high-bar' : 'low-bar'})`;
    if (exId === 'comp_deadlift') return `Competition Deadlift (${state.settings.deadliftStyle === 'sumo' ? 'sumo' : 'conventional'})`;
    return EX[exId].name;
  }
  // Swap choices for a slot, hiding the bar position that is already the competition squat.
  function swapOptions(state, slotKey) {
    const hide = state.settings.squatStyle === 'highbar' ? 'high_bar_squat' : 'low_bar_squat';
    return (SWAPS[slotKey] || []).filter(x => x !== hide);
  }
  function accWeight(state, ex) { const a = (state.acc || {})[ex]; return a && a.weight != null ? a.weight : null; }
  function position(state) {
    const P = clampProgram(state), block = BLOCKS[P.blockIdx];
    const rest = !!(P.special && P.special.type === 'rest');
    const inserted = !!(P.special && P.special.type === 'deload'); // a deload week taken early; the block resumes after it
    const isDeload = !rest && ((block.deload && P.week > block.weeks) || inserted);
    const isTest = !rest && !inserted && block.test && P.week > block.weeks;
    return { block, rest, isDeload, isTest, inserted, wk: Math.min(P.week, block.weeks) - 1, day: DAYS[P.dayIdx] };
  }

  function buildSession(state, mode) {
    const P = state.program, S = state.settings;
    const { block, rest, isDeload, isTest, inserted, wk, day } = position(state);
    mode = MODES[mode] ? mode : 'full';
    const out = { block: rest ? 'rest' : block.id, blockName: rest ? 'Easy week' : block.name, week: P.week, isDeload, isTest, isRest: rest, dayId: day.id, dayName: day.name, mode, exercises: [], notes: [] };
    const firstHalf = P.dayIdx < 2;
    const lastWk = inserted ? Math.max(0, Math.min(P.week, block.weeks) - 1) : block.weeks - 1; // an inserted deload is relative to the week it interrupts

    const inc = S.increment > 0 ? S.increment : 5, bar = S.barWeight > 0 ? S.barWeight : 45;
    for (const slot of day.slots) {
      const exId = resolveExercise(state, slot, block, rest);
      const ex = EX[exId];
      // A TM-loaded exercise in an accessory slot (RDL for hamstrings) takes its lift from the
      // exercise and follows the second-lift scheme.
      const lift = ex.tm ? (slot.tm || ex.tm) : null;
      const schemeRole = slot.role === 'accessory' && ex.tm ? 'secondary' : slot.role;
      const heavyBlock = block.id !== 'build' && !rest; // heavy triples and singles earn +60 s on the main lift
      const item = { slotKey: slot.key, ex: exId, name: exerciseName(state, exId), role: slot.role, lift, load: ex.load, optional: !!slot.optional, cue: ex.cue || null, sets: [],
        rest: slot.role === 'primary' ? S.restPrimary + (heavyBlock ? 60 : 0) : slot.role === 'secondary' ? S.restSecondary : S.restAccessory };

      // --- Test week: primaries work up to a heavy single ---
      if (isTest && slot.role === 'primary') {
        const tm = tmOf(state, lift);
        const firstW = barRound(tm * TEST.warmups[0].pct, bar, inc, S.plates);
        let prevW = 0;
        if (S.warmupSets !== false) for (const st of warmups(firstW, bar, inc, 'lead', S.plates)) { item.sets.push({ w: st.w, reps: st.reps, kind: 'warm' }); prevW = st.w; }
        for (const w of TEST.warmups) {
          if (w.pct < 0.8 && S.warmupSets === false) continue; // the 80% and 90% lines are part of the test, not generic warm-ups
          const tw = barRound(tm * w.pct, bar, inc, S.plates);
          if (tw <= prevW && w.pct < 0.97) continue; // never repeat a weight or step back
          item.sets.push({ w: tw, reps: w.reps, pct: w.pct, kind: w.pct >= 0.97 ? 'test' : 'warm', rpeTarget: w.pct >= 0.97 ? plannedRPE(tw / state.lifts[lift].oneRM, w.reps) : null }); prevW = tw;
        }
        item.sets.push({ w: null, reps: 1, pct: null, kind: 'test', rpeTarget: 9, open: true });
        const bw = barRound(tm * TEST.backoff.pct, bar, inc, S.plates);
        for (let i = 0; i < TEST.backoff.sets; i++) item.sets.push({ w: bw, reps: TEST.backoff.reps, pct: TEST.backoff.pct, kind: 'work', rpeTarget: plannedRPE(bw / state.lifts[lift].oneRM, TEST.backoff.reps) });
        item.note = 'Work up to a single at RPE 9 (one clean rep left). Add 2-5% to the last line if the one before was RPE 8 or less. Then the back-off sets.';
        out.exercises.push(item);
        continue;
      }

      if (ex.tm) {
        // ----- Barbell lift loaded from a TM -----
        let base, volF = 1, intF = 1;
        const schemeFor = (w) => (schemeRole === 'primary' && block.primaryByLift && block.primaryByLift[lift]) ? block.primaryByLift[lift][w] : (schemeRole === 'secondary' && block.secondaryByEx && block.secondaryByEx[exId]) ? block.secondaryByEx[exId][w] : block[schemeRole][w];
        if (rest) { base = REST[schemeRole]; }
        else if (isDeload || isTest) {
          base = schemeFor(lastWk);
          const d = firstHalf ? block.deloadA : block.deloadB; volF = d.vol; intF = d.int;
          if (isTest) { volF = 0.5; intF = 0.7; }
        } else {
          base = schemeFor(wk);
          if (mode === 'light') { volF = block.light.vol; intF = block.light.int; }
          else if (mode === 'trim') intF = TUNE.trim.load; // yellow day: a one-step load nudge, sets and reps unchanged
        }
        const adj = (!rest && !isDeload && !isTest) ? ((P.loadAdj && P.loadAdj[lift]) || 0) : 0;
        if (!rest && !isDeload && !isTest && P.layoffPct) intF *= 1 + P.layoffPct; // after a layoff: a flat cut off every barbell load this week
        let sets = base.sets;
        // Earned extra sets go to the competition lift only (coaches add sets to the main movement,
        // not to each variant), only on a green day; a reduction applies on every kind of day and to
        // every close variant. Earned sets never reach the Peak block ("few or no sets added", p.340).
        if (!rest && !isDeload && !isTest && ex.mult >= 0.8 && !block.test) {
          const sa = (P.setAdj && P.setAdj[lift]) || 0;
          const isComp = ex.mult === 1 && slot.role === 'primary';
          sets += sa > 0 ? (mode === 'full' && isComp ? sa : 0) : sa;
        }
        if (!rest && !isDeload && !isTest) sets = Math.max(2, sets + (block.test ? Math.min(0, P.volumeDial || 0) : (P.volumeDial || 0))); // a positive dial never reaches the Peak
        sets = Math.max(1, Math.round(sets * volF + 1e-9));
        if (volF < 1 && sets < 2 && base.sets >= 3) sets = 2;
        const pct = (base.pct + adj) * intF;
        const intended = tmOf(state, lift) * ex.mult * pct; // the load the plan asks for, before the plates
        const w = barRound(intended, bar, inc, S.plates);
        const oneRM = state.lifts[lift].oneRM * ex.mult;
        const pct1rm = oneRM > 0 ? w / oneRM : 1;
        // When the empty bar is well over the planned load (a light lifter's OHP or close-grip),
        // fewer reps keep the planned effort instead of prescribing sets to failure.
        let reps = base.reps;
        if (w > intended * 1.1 && oneRM > 0) { const want = Math.max(8, plannedRPE(Math.min(1, intended / oneRM), base.reps)); while (reps > 3 && plannedRPE(pct1rm, reps) > want) reps--; }
        const rpe = plannedRPE(pct1rm, reps);
        if (rpe >= 9.5 && w === bar && w > intended) item.note = 'The empty bar is near your max here: keep two reps in reserve, or pin a dumbbell variation in Program.';
        // Bonus reps: primary slot only, and never past RPE 9 (no sets to failure, p.97).
        const plusOk = mode === 'full' && !isDeload && !isTest && !rest && block.plus > 0 && slot.role === 'primary';
        const dl = lift === 'deadlift'; // at most one bonus rep, with a rep held back: 6s were chosen over 8s because the erectors pay for reps
        const plus = plusOk ? Math.max(0, Math.min(dl ? Math.min(1, block.plus) : block.plus, Math.floor(expectedRIR(pct1rm, reps) - (dl ? 1 : 0)) - 1)) : 0;
        if (S.warmupSets !== false) for (const st of warmups(w, bar, inc, schemeRole, S.plates)) item.sets.push({ w: st.w, reps: st.reps, kind: 'warm' });
        if (base.opener && slot.role === 'primary' && mode !== 'light' && !isDeload && !isTest && !rest) {
          const layF = 1 + (P.layoffPct || 0), ow = barRound(tmOf(state, lift) * ex.mult * base.opener.pct * (mode === 'trim' ? TUNE.trim.load : 1) * layF, bar, inc, S.plates);
          const lastWarm = item.sets.filter(x => x.kind === 'warm').reduce((m, x) => Math.max(m, x.w || 0), bar);
          const ws = S.warmupSets !== false ? openerWarm(ow, lastWarm, bar, inc, S.plates) : null;
          if (ws) item.sets.push({ w: ws, reps: 1, kind: 'warm' });
          const chartOp = oneRM > 0 ? plannedRPE(ow / oneRM, 1) : base.opener.rpe, opRpe = Math.abs(chartOp - base.opener.rpe) > 0.5 ? chartOp : base.opener.rpe; // the chart's number when a lowered Training Max moves it
          item.sets.push({ w: ow, reps: 1, pct: base.opener.pct * (mode === 'trim' ? TUNE.trim.load : 1) * layF, kind: 'single', rpeTarget: opRpe });
          const opLeft = Math.round(10 - opRpe);
          item.note = `Opener: one single at about RPE ${opRpe} (about ${opLeft} clean rep${opLeft === 1 ? '' : 's'} left), then the working sets. Set the safeties.`;
        }
        for (let i = 0; i < sets; i++) {
          const ind = i === 0 && plus > 0;
          item.sets.push({ w, reps, pct, kind: 'work', ind, plus: ind ? plus : 0, rpeTarget: rpe });
        }
        item.pctTM = pct; item.rpeTarget = rpe;
      } else {
        // ----- Self-loaded (belt squat, dumbbells, machines): double progression -----
        let sch, volF = 1, intF = 1;
        if (rest) { sch = REST.accessory; intF = 0.8; }
        else if (isDeload || isTest) { sch = block.accessory[lastWk]; volF = 0.5; intF = firstHalf && !isTest ? 0.9 : 0.7; }
        else {
          const s = block[slot.role][wk];
          sch = slot.role === 'accessory' ? s : { sets: s.sets, reps: Math.max(8, s.reps + 2) };
          if (mode === 'light') { volF = block.light.vol; intF = Math.max(0.7, block.light.int); }
        }
        let sets = sch.sets;
        if (!rest && !isDeload && !isTest) { const sa = (P.setAdj && P.setAdj.acc) || 0; sets += mode === 'full' ? sa : Math.min(0, sa); sets = Math.max(1, sets + Math.min(0, P.volumeDial || 0)); }
        sets = Math.max(1, Math.min(ACC_CAP, Math.round(sets * volF + 1e-9)));
        const w0 = accWeight(state, exId);
        const accStep = ex.load === 'db' ? (S.dbIncrement > 0 ? S.dbIncrement : 5) : 5;
        const w = w0 == null ? null : ex.load === 'bw' ? null : intF === 1 ? w0 : Math.max(Math.min(w0, accStep), floorTo(w0 * intF, accStep));
        for (let i = 0; i < sets; i++) item.sets.push({ w, reps: sch.reps, kind: 'work', rpeTarget: 8 });
        item.repRange = [sch.reps, sch.reps + 3];
        item.needsWeight = w0 == null && ex.load !== 'bw';
        item.startHint = ex.startHint;
      }
      out.exercises.push(item);
    }
    const cardioF = mode === 'light' ? 0.5 : 1;
    out.cardioMin = Math.round(S.cardioMin * cardioF);
    out.estMinutes = estimateMinutes(out);
    if (isDeload) out.notes.push((inserted ? 'Early deload; the block then resumes. ' : '') + (firstHalf ? 'Deload, first half: fewer sets, lighter loads.' : 'Deload, second half: fewer sets at half the load. It should feel easy.'));
    if (rest) out.notes.push('Easy week: about half the sets and load, on variations. Technique practice, not work.');
    return out;
  }

  // Minutes of lifting, warm-ups and full rests included. required: without the optional slots
  // (abs, biceps, lateral raise). The time budget is for the required work, so what the program
  // prescribes stays time-efficient, while an optional extra the lifter chooses to do may run the
  // session longer and never stops a main lift earning a set.
  function estimateMinutes(sess, required) {
    let s = 8;
    for (const e of sess.exercises) {
      if (required && e.optional) continue;
      const warm = e.sets.filter(x => x.kind === 'warm').length, n = e.sets.length - warm;
      s += n * (e.rest / 60 + 0.75) + warm * 1.1 + (warm ? 0.5 : e.role === 'primary' ? 5 : e.role === 'secondary' ? 3 : 1);
    }
    return Math.round(s);
  }

  // Warm-up ramp to the first working weight. Fractions are of the WORKING weight, not the 1RM:
  // reps fall as load rises, jumps shrink near the top, and the last step is a single at ~90% so
  // the first work set is not a surprise. A heavier target earns more steps; the second barbell
  // lift of a session (already warm) gets a shorter ramp. Steps closer than 10 lb are dropped.
  function warmups(target, bar, increment, role, plates) {
    const steps = [{ w: bar, reps: role === 'primary' ? 10 : 8 }];
    if (target <= bar + 20) return steps;
    const full = target >= 450 ? [[0.3, 5], [0.45, 5], [0.6, 3], [0.72, 2], [0.82, 1], [0.9, 1]]
      : target >= 300 ? [[0.4, 5], [0.55, 3], [0.7, 2], [0.8, 1], [0.9, 1]]
      : target >= bar * 3 ? [[0.4, 8], [0.55, 5], [0.7, 3], [0.82, 2], [0.9, 1]]
      : [[0.5, 5], [0.7, 3], [0.85, 1]];
    const short = target >= bar * 3 ? [[0.5, 5], [0.7, 3], [0.85, 1]] : [[0.6, 4], [0.8, 2]];
    const ramp = role === 'primary' ? full : role === 'lead' ? [[0.5, 5], [0.75, 3]] : short; // 'lead': into the test week's own lines, no singles
    let last = bar;
    for (const [r, reps] of ramp) {
      const w = barRound(target * r, bar, increment, plates);
      if (w >= last + 10 && w <= target - 10) { steps.push({ w, reps }); last = w; }
    }
    return steps;
  }

  // ---------- In-session correction (what a coach does between sets) ----------
  // evidence: the done working sets so far [{w, reps, rpe, first}]. A missed set is RPE 10 at the
  // reps achieved; bonus reps count as reps. Each set implies a 1RM via the rep-max table; the
  // weight that would land the planned reps at the target RPE comes back from the same table.
  // Confidence: the first set alone counts half (it often feels heaviest for reasons that are not
  // fitness); sets below RPE 6 are too far from failure to say much and count half too.
  function liftCorrection(evidence, plannedW, reps, targetRPE, caps) {
    const C = TUNE.correction;
    caps = caps || { down: C.floor, up: C.ceil };
    if (!(plannedW > 0) || !(reps > 0) || !(targetRPE >= 1)) return null;
    const rows = (evidence || []).filter(x => x.w > 0 && x.reps > 0 && x.reps <= MAX_EVIDENCE_REPS && !(x.planned > 0 && x.reps > x.planned + 8) && Number.isFinite(x.rpe) && x.rpe >= C.minRpe && x.rpe <= 10);
    if (!rows.length) return null;
    let num = 0, den = 0;
    for (const x of rows) {
      const hard = x.missed || x.rpe >= (x.target != null ? x.target : targetRPE) + Math.max(0, x.reps - (x.planned || x.reps)) + 1.5; // bonus reps raise the RPE by design
      const wt = (x.first ? (hard ? C.firstSetHardWeight : C.firstSetWeight) : 1) * (x.rpe < 6 ? C.lowRpeWeight : x.rpe < 7 ? 0.5 : 1);
      num += wt * e1rm(x.w, x.reps, x.rpe); den += wt;
    }
    const est = num / den;
    const ideal = est * pctForRTF(reps + Math.max(0, 10 - targetRPE));
    const conf = Math.min(1, den);
    let w = plannedW + (ideal - plannedW) * conf;
    // The floor starts at 85% of the plan. Carrying on at the floor and finding a set still too hard
    // (a full RPE over target) lowers it another step, and again for each such set: the floor is a
    // brake on one bad reading, not a weight the exercise is stuck at.
    let floor = plannedW * caps.down;
    const ceil = plannedW * caps.up;
    for (const x of rows) {
      const tgt = x.target != null ? x.target : targetRPE;
      const nearFloor = x.w <= floor + Math.max(floor * 0.01, (caps.inc || 0) / 2) + 1e-9; // the loaded weight is the floor rounded to the plates
      if (!x.first && nearFloor && (x.missed || x.rpe >= tgt + C.floorHard)) floor *= C.floorStep;
    }
    const hitFloor = w < floor - 1e-9;
    w = Math.max(floor, Math.min(ceil, w));
    // RTS-style stop: a miss, a later set still 2+ over target after a correction, or the floor.
    const last = rows[rows.length - 1];
    const stop = rows.some(x => x.missed) || (rows.length >= 2 && !last.first && last.w < plannedW * 0.995 && last.rpe >= (last.target != null ? last.target : targetRPE) + C.stopOver && last.rpe >= C.stopMin) || hitFloor;
    return { w, est, ideal, conf, hitFloor, stop, delta: w / plannedW - 1 };
  }

  // ---------- Between sessions: calibrate the 1RM from what was actually lifted ----------
  // Every working set with an RPE (or a miss) on a competition lift or a close barbell variant
  // implies a 1RM. The session estimate is their confidence-weighted mean (variants half weight,
  // first sets half weight, RPE 6-6.5 half weight). Fatigue management is the priority, so the
  // 1RM follows a low session at once (up to 5% per session) but rises only on the smoothed
  // estimate, by at most 2.5% per session, and never after a session that crushed you.
  // `ref` (the current 1RM) bounds each implied max to 0.7-1.3x so one mistyped set cannot swing it.
  // Returns the confidence-weighted estimate, plus confHigh (weight from sets near failure: reported
  // RPE >= 7.5 or planned >= 7), which the drop rule requires so that far-from-failure sets can lower
  // a max only when the shortfall is large.
  // opts.minRpe: the calibration ignores sets under RPE 6.5 (vague evidence of a max); the History
  // chart passes a lower floor so every rated set shows, with far-from-failure sets weighted low.
  // opts.clamp: how far an implied max may sit from ref before it is pulled in (a typo guard).
  function sessionEstimate(sess, lift, ref, opts) {
    const minRpe = opts && opts.minRpe != null ? opts.minRpe : TUNE.calibrate.minRpe;
    const clamp = (opts && opts.clamp) || [0.7, 1.3];
    const detail = opts && opts.detail ? [] : null;
    let num = 0, den = 0, n = 0, confHigh = 0;
    for (const e of sess.exercises || []) {
      if (e.lift !== lift || !EX[e.ex] || !EX[e.ex].tm || EX[e.ex].mult < 0.8) continue;
      if ((sess.skippedSlots || []).includes(e.slotKey)) continue;
      const work = (e.sets || []).filter(x => (x.kind === 'work' || x.kind === 'single' || x.kind === 'test') && x.done);
      const firstWork = work.find(x => x.kind === 'work');
      const name = e.name || EX[e.ex].name;
      work.forEach((x) => {
        let reps = x.actualReps != null ? x.actualReps : x.reps;
        let rpe = x.rpe, missed = false; if (rpe == null && reps < x.reps) { rpe = 10; missed = true; }
        if (opts && opts.floorRpe && Number.isFinite(rpe) && rpe >= minRpe && rpe < opts.floorRpe) rpe = opts.floorRpe; // read an easy set as harder than it was: a cautious lower bound
        if (reps === 0) { reps = 1; rpe = 10; missed = true; } // a set that did not go up: the weight is at least a max
        const w = x.actualW != null ? x.actualW : x.w;
        const tooMany = reps > MAX_EVIDENCE_REPS || (x.reps > 0 && reps > x.reps + 8);
        if (!Number.isFinite(rpe) || rpe < minRpe || rpe > 10 || !(reps > 0) || tooMany || !(w > 0)) {
          if (detail) detail.push({ name, w, reps, rpe: Number.isFinite(rpe) ? rpe : null, skip: !Number.isFinite(rpe) ? 'no RPE' : rpe < minRpe ? 'too easy' : reps > MAX_EVIDENCE_REPS ? 'too many reps' : tooMany ? 'reps far over plan' : 'no weight' });
          return;
        }
        const raw = e1rm(w, reps, rpe) / EX[e.ex].mult;
        // A set implying under 60% or over 150% of the current max is a typo (a dropped or doubled
        // digit), not a reading: the calibration leaves it out. The chart passes its own clamp.
        if (!(opts && opts.clamp) && x.w > 0 && x.okW !== w && (w < x.w * 0.6 || w > x.w * 1.4)) { if (detail) detail.push({ name, w, reps, rpe, skip: 'looks like a typo' }); return; }
        let implied = raw;
        if (ref > 0) implied = Math.min(ref * clamp[1], Math.max(ref * clamp[0], implied));
        const comp = String(e.ex).startsWith('comp_'); // the competition lift itself; a same-multiplier variation (the other bar position) is still a variation
        const wt = (comp ? 1 : 0.5) * (x === firstWork ? 0.5 : 1) * (rpe < 6 ? 0.35 : rpe < 7 ? 0.5 : 1);
        num += wt * implied; den += wt; n++;
        if (rpe >= 7.5 || (x.rpeTarget != null && x.rpeTarget >= 7)) confHigh += wt;
        if (detail) detail.push({ name, kind: x.kind, w, reps, rpe, missed, implied, capped: Math.abs(implied - raw) > 0.5, wt, comp, first: x === firstWork });
      });
    }
    return den ? { est: num / den, conf: den, confHigh, n, sets: detail || undefined } : null;
  }
  // Fatigue allowance: the book expects RPE to climb through a block and the last accumulation
  // week to be a planned overreach, so an implied max late in a block is read a little higher.
  function fatigueAllowance(sess) {
    const block = BLOCKS[sess.blockIdx != null ? sess.blockIdx : 0];
    if (!block || !sess.week || sess.isRest) return 0;
    const wk = Math.min(sess.week, block.weeks);
    return block.weeks > 1 ? TUNE.calibrate.allowance * (wk - 1) / (block.weeks - 1) : 0;
  }
  function calibrate(state, sess) {
    const log = [];
    if (state.settings.autoCalibrate === false || sess.isTest || sess.isDeload || sess.isRest || sess.skipped) return log;
    const crushed = sess.post && sess.post.difficulty === 4;
    const names = { squat: 'Squat', bench: 'Bench', deadlift: 'Deadlift' };
    const allow = 1 + fatigueAllowance(sess);
    for (const lift of ['squat', 'bench', 'deadlift']) {
      const L = state.lifts[lift];
      const cur = L.oneRM;
      if (!(cur > 0)) continue;
      const r = sessionEstimate(sess, lift, cur);
      const K = TUNE.calibrate;
      const weekKey = `${sess.mesoCount || 0}-${sess.week || 0}`;
      if (!r) {
        // Sets under RPE 6.5 cannot say how much was left, but read as if each were RPE 6.5 they
        // still prove a floor. Two sessions in a row whose floor clears the max by 4% raise it
        // (2.5% at most, once a week), so a max entered too low cannot stay stuck there.
        const lb = sessionEstimate(sess, lift, cur, { minRpe: 4, floorRpe: K.minRpe });
        if (!lb) { if (sessionEstimate(sess, lift, cur, { minRpe: 4, clamp: [0.5, 1.5] })) log.push(`${names[lift]}: sets far from plan left out as likely typos; 1RM stays ${cur}. Real? Fix them in History.`); continue; }
        const over = lb.est > cur * K.upFastAt;
        L.lbHits = over ? (L.lbKey === sess.date ? (L.lbHits || 1) : (L.lbHits || 0) + 1) : 0; L.lbKey = sess.date;
        if (over && L.lbHits >= 2 && !crushed && L.upKey !== weekKey) {
          const next = Math.max(minMax(state), roundTo(Math.min(lb.est, cur * K.upMax), 2.5));
          if (next > cur) { applyTM(state, lift, next); L.upKey = weekKey; L.lbHits = 0; log.push(`${names[lift]} 1RM ${cur} -> ${next} (easy sets, but they show at least ${Math.round(lb.est)}).`); continue; }
        }
        // A max set far too low leaves every prescribed set so easy that no RPE can prove it: after
        // three such sessions in a row, say so plainly instead of holding in silence.
        if (L.easyKey !== sess.date) { L.easyRun = (L.easyRun || 0) + 1; L.easyKey = sess.date; }
        log.push(over ? `${names[lift]}: all under RPE 6.5, at least ${Math.round(lb.est)}; one more like this raises the 1RM from ${cur}.`
          : L.easyRun >= 3 ? `${names[lift]}: ${L.easyRun} sessions under RPE 6.5. Too easy? Raise ${cur} in Settings, or rate a heavier top set.`
          : `${names[lift]}: all under RPE 6.5, too easy to read; 1RM stays ${cur}.`);
        continue;
      }
      L.lbHits = 0; L.easyRun = 0;
      // The fatigue allowance applies to the rise test only: a late-block decline is still acted on
      // from the raw estimate (fatigue management is the priority), while the smoothed estimate that
      // can raise the max reads late-block sets a little higher.
      const raw = r.est, est = r.est * (L.est == null ? 1 : allow);
      L.est = L.est == null ? est : 0.5 * L.est + 0.5 * est;
      L.est = Math.min(cur * 1.15, Math.max(cur * 0.7, L.est)); L.estDate = sess.date; L.rated = (L.rated || 0) + 1;
      let next = cur, how = '';
      // Only sets that count toward the estimate can count as a miss (OHP or RDL misses do not gate bench or deadlift).
      const missed = (sess.exercises || []).some(e => e.lift === lift && EX[e.ex] && EX[e.ex].tm && EX[e.ex].mult >= 0.8 && (e.sets || []).some(x => (x.kind === 'work' || x.kind === 'single') && x.done && x.actualReps != null && x.actualReps < x.reps));
      const start = L.floorRM || L.blockStartRM || cur; // floorRM is set only at block starts, layoffs and maxes set by hand (a deload taken early does not reset it)
      const floor = Math.min(cur, start * (missed ? K.blockFloorMissed : K.blockFloor)); // calibration alone cannot take more than 10% in a block, and the floor never lifts a max
      const sureDown = r.confHigh >= K.downConfHigh || raw < cur * K.downSure || missed;
      if (raw < cur * K.downAt && sureDown && (r.conf >= 1 || L.est < cur * K.downAt)) {
        next = Math.max(r.conf >= 1 ? raw : L.est, cur * K.downMax, floor);
        how = `today's sets read about ${Math.round(raw)}; heavier sets re-check it`;
      } else if (!crushed && !missed && L.upKey !== weekKey && ((L.est > cur * K.upAt && r.conf >= 1) || (est > cur * K.upFastAt && r.conf >= 1.5 && r.confHigh > 0))) {
        // At most one rise per lift per week, and the fast path needs a set near failure.
        next = Math.min(Math.max(L.est, est > cur * K.upFastAt ? est : 0), cur * K.upMax);
        how = `your sets estimate about ${Math.round(Math.max(L.est, est))}`;
      }
      next = how ? Math.max(minMax(state), roundTo(next, 2.5)) : cur; // a max typed off the 2.5 grid is not 'changed' by rounding alone
      if (next !== cur) {
        applyTM(state, lift, next); log.push(`${names[lift]} 1RM ${cur} -> ${next} (${how}).`);
        if (next < cur) {
          const P = state.program; P.calibDrops = (typeof P.calibDrops === 'object' && P.calibDrops) ? P.calibDrops : {};
          // The first week of the program can only be correcting the number he entered: no fatigue has
          // accumulated yet. It does not count as a drop, and the 6% test starts over from the new max.
          if (sess.week === 1 && !(sess.mesoCount > 0) && !(sess.blockIdx > 0)) { P.fatigueBase = (typeof P.fatigueBase === 'object' && P.fatigueBase) ? P.fatigueBase : {}; P.fatigueBase[lift] = next; }
          else P.calibDrops[lift] = (P.calibDrops[lift] || 0) + 1;
        }
        else L.upKey = weekKey;
      }
    }
    return log;
  }

  // ---------- Weekly review: this week's sessions -> next week's set / load adjustments ----------
  // Book rules: easy week -> add a set or two / take a bigger jump (pp.159-160); can't match last
  // week's reps -> MRV passed (pp.126, 338-339); too much fatigue -> light sessions, not unplanned
  // deloads (p.160); recovering easily week after week -> slowly raise sets (p.322).
  function weeklyReview(state, weekSessions, mesoSessions) {
    const P = state.program, block = BLOCKS[P.blockIdx];
    const log = [], flags = Object.assign({ squat: 0, bench: 0, deadlift: 0 }, P.flags || {});
    const D = TUNE.deload;
    const setAdj = Object.assign({ squat: 0, bench: 0, deadlift: 0, acc: 0 }, P.setAdj || {});
    const loadAdj = Object.assign({ squat: 0, bench: 0, deadlift: 0 }, P.loadAdj || {});
    const lastWeek = P.week >= block.weeks;
    const per = { squat: [], bench: [], deadlift: [] };
    let crushed = 0, reds = 0, lights = 0;
    for (const s of weekSessions) {
      if (!s || s.skipped) continue;
      if (s.readiness && s.readiness.color === 'red') reds++;
      if (s.mode === 'light') lights++;
      if (s.post && s.post.difficulty === 4) crushed++;
      for (const e of s.exercises) {
        if (!e.lift || e.role === 'accessory' || !EX[e.ex] || EX[e.ex].mult < 0.8) continue; // RDL, OHP and the like do not speak for the lift
        const work = e.sets.filter(x => x.kind === 'work' && x.done);
        if (!work.length) continue;
        const missed = work.filter(x => (x.actualReps != null ? x.actualReps : x.reps) < x.reps).length;
        // Bonus reps raise the RPE by design: compare after taking the extra reps back out.
        const deltas = work.filter(x => Number.isFinite(x.rpe) && x.rpeTarget != null && !((x.actualReps != null ? x.actualReps : x.reps) > x.reps + 8) && !(x.manualW && x.actualW != null && x.w > 0 && x.actualW < x.w * 0.97))
          .map(x => x.rpe - Math.min(Math.max(0, (x.actualReps != null ? x.actualReps : x.reps) - x.reps), Math.max(x.plus || 0, 2)) - x.rpeTarget);
        const rpeDelta = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
        const g = EX[e.ex].group === 'push' ? 'push' : EX[e.ex].group === 'legs' ? 'legs' : 'hinge';
        per[e.lift].push({ role: e.role, missed, rpeDelta, rated: deltas.length, difficulty: s.post ? s.post.difficulty : 2, soreness: s.soreness ? s.soreness[g] : null, light: s.mode === 'light' });
      }
    }
    const names = { squat: 'Squat', bench: 'Bench', deadlift: 'Deadlift' };
    const calib = state.settings.autoCalibrate !== false; // loads are then handled by per-session calibration
    const cutLines = [];
    for (const lift of ['squat', 'bench', 'deadlift']) {
      const rows = per[lift].filter(r => !r.light);
      if (!rows.length) { log.push(`${names[lift]}: no overload session logged this week, holding.`); continue; }
      const prim = rows.find(r => r.role === 'primary') || rows[0];
      let score = 0, why = [];
      // Week 1 follows a deload: feeling fresh then is the deload working, not spare capacity.
      const freshWeek = P.week === 1;
      if (freshWeek && calib && !prim.missed && prim.rpeDelta >= 0.75) why.push('felt harder; not counted in week 1'); // the max has already answered it, and one week cannot show accumulated fatigue
      else if (prim.missed > 0 || prim.rpeDelta >= 1.5) { score -= 2; why.push(prim.missed ? `missed reps on ${prim.missed} set${prim.missed > 1 ? 's' : ''}` : 'felt much harder than planned'); }
      else if (prim.rpeDelta >= 0.75) { score -= 1; why.push('felt harder than planned'); }
      else if (prim.rpeDelta <= -0.75) { if (!freshWeek) { score += 1; why.push('felt easier than planned'); } else why.push('felt easier, as expected after a deload'); }
      else if (TUNE.review.onTarget && prim.rated) { score += TUNE.review.onTarget; why.push('main sets on target'); } // hitting the numbers week after week is the signal to add (p.322); sets without an RPE say nothing
      else if (!prim.rated) why.push('no RPEs logged, so no read on effort');
      if (prim.difficulty === 1) { if (!freshWeek) { score += 1; why.push('session rated easy'); } else why.push('session rated easy, as expected after a deload'); }
      else if (prim.difficulty === 3) { score -= 1; why.push('session rated very hard'); }
      else if (prim.difficulty === 4) { score -= 2; why.push('session crushed you'); }
      if (prim.soreness === 1 && score >= 0 && !freshWeek) { score += 1; why.push('recovered by the next session'); }
      else if (prim.soreness === 3) { score -= 1; why.push('still sore at the next session'); }
      else if (prim.soreness === 4) { score -= 2; why.push('very sore at the next session'); }
      if (rows.some(r => r !== prim && r.missed > 0)) { score -= 1; why.push('missed reps on a second lift'); } // blocks an earned set; does not cut on its own

      const cap = capFor(state, lift);
      if (block.test) { log.push(`${names[lift]}: peaking, sets stay as written.`); continue; }
      if (score >= TUNE.review.add && !lastWeek) {
        // Count next week's sets honestly; each run of a block may climb one step above what the
        // last run tolerated (the book's slow search for MRV, p.322), never past the phase cap, and
        // never into a session longer than the time budget. When "on target" is the only positive,
        // a set is added at most every second week (add volume slowly after a burnout, p.164).
        const ceil = (P.runCeil && P.runCeil[lift] != null) ? P.runCeil[lift] : 2;
        const soft = why.includes('main sets on target') && !why.includes('session rated easy') && !why.includes('felt easier than planned');
        const addedLastWeek = P.lastAddWeek && P.lastAddWeek[lift] === P.week - 1;
        const hypo = { setAdj: setAdj[lift] + 1, week: P.week + 1 };
        const all = Object.assign({}, setAdj, { [lift]: setAdj[lift] + 1 });
        const underCeil = setAdj[lift] < ceil, underCap = weeklySetsWith(state, lift, hypo) <= cap;
        let inTime = blockMaxMinutesWith(state, setAdj, all) <= TUNE.sessionCapMin;
        // A main-lift set outranks the accessory set: give the accessory set back if that makes room.
        let accBack = false;
        if (!inTime && setAdj.acc > 0 && underCeil && underCap && !(soft && addedLastWeek)) { const noAcc = Object.assign({}, all, { acc: setAdj.acc - 1 }); if (blockMaxMinutesWith(state, setAdj, noAcc) <= TUNE.sessionCapMin) { inTime = true; accBack = true; } }
        const canAdd = underCeil && underCap && inTime && !(soft && addedLastWeek);
        if (canAdd && accBack) { setAdj.acc -= 1; log.push(`Accessories: -1 set to make room for the ${names[lift].toLowerCase()} set.`); }
        if (canAdd) { setAdj[lift] += 1; P.lastAddWeek = Object.assign({}, P.lastAddWeek || {}, { [lift]: P.week }); log.push(`${names[lift]}: +1 set next week (${why.join(', ')}).`); }
        else if (soft && addedLastWeek) log.push(`${names[lift]}: on target; a set was added last week, so holding to let it settle.`);
        else if (score >= 3 && !calib && loadAdj[lift] < 0.05) { loadAdj[lift] += 0.025; log.push(`${names[lift]}: at the set cap, so a bigger jump next week (+2.5%).`); }
        else log.push(`${names[lift]}: recovering well, holding (${!inTime ? `the required work would pass ${TUNE.sessionCapMin} minutes` : !underCap ? 'at the weekly set cap' : 'at this block\'s set ceiling'}).`);
        flags[lift] = 0;
      } else if (score <= -2) {
        const big = score <= -4;
        cutLines.push({ at: log.length, lift, was: weeklySetsWith(state, lift, { setAdj: setAdj[lift], week: P.week + 1 }), why: why.join(', '), pct: calib ? '' : big ? ' and -5%' : ' and -2.5%' });
        setAdj[lift] = Math.max(-2, setAdj[lift] - 1); if (!calib) loadAdj[lift] = Math.max(-0.10, loadAdj[lift] - (big ? 0.05 : 0.025)); flags[lift] += 1;
        log.push(''); // written below, once next week's dial is known
      } else {
        if (score >= 1) flags[lift] = Math.max(0, flags[lift] - 1);
        log.push(`${names[lift]}: holding (${why.length ? why.join(', ') : 'on target'}).`);
      }
    }
    const anyFlag = Object.values(flags).some(f => f > 0);
    const trained = weekSessions.some(s => s && !s.skipped && s.mode !== 'light');
    if (block.id === 'build' && trained && !anyFlag && crushed === 0 && !lastWeek && setAdj.acc < 1) {
      // Accessories are decided after the lifts, against the set counts the lifts just earned, and a
      // lift that later needs the time takes the accessory set back (above).
      if (blockMaxMinutesWith(state, setAdj, Object.assign({}, setAdj, { acc: setAdj.acc + 1 })) <= TUNE.sessionCapMin) { setAdj.acc += 1; log.push('Accessories: +1 set next week.'); }
      else log.push(`Accessories: holding (the required work would pass ${TUNE.sessionCapMin} minutes).`);
    }
    if (anyFlag && setAdj.acc > 0) { setAdj.acc -= 1; log.push('Accessories: -1 set to free up recovery.'); }

    const flaggedLifts = Object.keys(flags).filter(l => flags[l] >= 2);
    // Block-level signals: chronic under-recovery hides under the weekly triggers when light
    // sessions and calibration keep absorbing it.
    // Only overload sessions since the last inserted deload count toward the chronic window.
    const since = P.chronicSince || 0;
    const meso = (mesoSessions || weekSessions).filter(s => s && !s.skipped && !s.isDeload && !s.isRest && (s.ts || 0) > since);
    const redsBlock = meso.filter(s => s.readiness && s.readiness.color === 'red').length;
    const lightsBlock = meso.filter(s => s.mode === 'light' && !s.forcedLight).length; // days forced light by the two-red rule are one bad week, not chronic fatigue
    const scored = weekSessions.filter(s => s && !s.skipped && s.readiness && s.readiness.score != null);
    const readinessAvg = scored.length ? scored.reduce((a, s) => a + s.readiness.score, 0) / scored.length : null;
    // The lifter's own readiness baseline: a rolling mean of the last 12 check-ins outside week 1
    // (week 1 follows a deload and would anchor the baseline to the rebound).
    P.readinessHist = Array.isArray(P.readinessHist) ? P.readinessHist : [];
    if (P.week >= 2) { for (const s of scored) P.readinessHist.push(s.readiness.score); P.readinessHist = P.readinessHist.slice(-12); }
    P.readinessBase = P.readinessHist.length >= 4 ? P.readinessHist.reduce((a, b) => a + b, 0) / P.readinessHist.length : null;
    const drops = (typeof P.calibDrops === 'object' && P.calibDrops) ? P.calibDrops : {};
    const names2 = { squat: 'squat', bench: 'bench', deadlift: 'deadlift' };
    const droppedLift = Object.keys(drops).find(l => drops[l] >= D.calibDropsLift);
    const sunkLift = ['squat', 'bench', 'deadlift'].find(l => { const b = (P.fatigueBase && P.fatigueBase[l]) || state.lifts[l].blockStartRM; return b > 0 && state.lifts[l].oneRM < b * (1 - D.calibDropPct); });
    const reasons = [], chronic = [];
    if (flaggedLifts.length >= D.flaggedLifts) reasons.push('two lifts flagged twice');
    if (reds >= D.redsWeek) reasons.push('two red check-ins this week');
    if (crushed >= D.crushedWeek) reasons.push('two crushing sessions');
    if (P.week >= D.chronicFromWeek) { // chronic signals need more than one week of evidence
      if (redsBlock >= D.redsBlock) chronic.push(`${redsBlock} red check-ins this block`);
      if (lightsBlock >= D.lightsBlock) chronic.push(`${lightsBlock} light sessions this block`);
      if (droppedLift) chronic.push(`${names2[droppedLift]} max lowered twice this block`);
      else if (sunkLift) chronic.push(`${names2[sunkLift]} max down ${Math.round(D.calibDropPct * 100)}% this block`);
    }
    // Readiness trend: under readinessAbs for two weeks running, or one week under readinessVeryLow.
    // It suggests a deload and can move the dial, but on its own it never lowers the Training Max.
    let readinessOnly = false;
    // The level under readinessAbs is what counts; a drop against the lifter's own baseline only
    // changes how the reason is worded, since readinessLow sits below readinessAbs.
    const lowRel = readinessAvg != null && scored.length >= 3 && P.readinessBase != null && readinessAvg < D.readinessLow && readinessAvg < P.readinessBase - D.readinessDrop;
    const lowAbs = readinessAvg != null && scored.length >= 3 && readinessAvg < D.readinessAbs;
    if (lowRel || lowAbs) P.readinessLowWeeks = (P.readinessLowWeeks || 0) + 1; else P.readinessLowWeeks = 0;
    if (P.week >= D.chronicFromWeek && ((P.readinessLowWeeks >= D.readinessWeeks) || (readinessAvg != null && scored.length >= 3 && readinessAvg < D.readinessVeryLow))) { readinessOnly = chronic.length === 0; chronic.push(P.readinessBase != null && lowRel ? `readiness ${Math.round(readinessAvg)} against your usual ${Math.round(P.readinessBase)}` : `readiness has sat at ${Math.round(readinessAvg)} for ${Math.max(1, P.readinessLowWeeks)} week${P.readinessLowWeeks > 1 ? 's' : ''}`); }
    const all = reasons.concat(chronic);
    const suggestDeload = !lastWeek && all.length > 0;
    // Chronic signals mean the volume itself is above what this lifter recovers from: turn the dial
    // down for the blocks ahead, not just this week. At most one step per block, and not for a
    // single signal in the planned-overreach week. A readiness-only signal (two straight weeks in
    // the yellow zone, which starts under 50: all "OK" with slightly sore legs scores 53 and is a
    // normal day) moves it too; in simulation that is what keeps a fragile lifter's fatigue down.
    let volumeDial = P.volumeDial || 0, tmPct = state.settings.tmPct;
    if (chronic.length && (!readinessOnly || D.readinessMovesDial) && (P.dialMovesBlock || 0) < D.dialStepsPerBlock && (!lastWeek || chronic.length >= 2)) {
      P.dialMovesBlock = (P.dialMovesBlock || 0) + 1; P.macroDialDown = true;
      if (volumeDial > TUNE.dial.min) { const was = barbellSetsAtDial(state, volumeDial, setAdj); volumeDial -= 1; log.push(lastWeek ? `Volume dial ${volumeDial > 0 ? '+' : ''}${volumeDial} from the next block, until a clean Build block earns it back.` : `Volume dial ${volumeDial > 0 ? '+' : ''}${volumeDial}: ${was} -> ${barbellSetsAtDial(state, volumeDial, setAdj)} barbell sets next week, until a clean Build block earns it back.`); }
      else if (tmPct > 0.85 && !readinessOnly) { tmPct = Math.round((tmPct - 0.025) * 1000) / 1000; log.push(`Volume is at its floor, so the Training Max drops to ${Math.round(tmPct * 1000) / 10}% of 1RM.`); }
    }
    for (const c of cutLines) {
      const now = weeklySetsWith(state, c.lift, { setAdj: setAdj[c.lift], week: P.week + 1, volumeDial });
      log[c.at] = lastWeek ? `${names[c.lift]}: flagged (${c.why}); next week is the deload.` // that week's count does not follow from this cut
        : now === c.was ? `${names[c.lift]}: already at the fewest sets${c.pct} (${c.why}).`
        : `${names[c.lift]}: ${c.was} -> ${now} sets next week${c.pct} (${c.why}).`;
    }
    if (all.length) P.blockClean = false;
    if (suggestDeload) log.push(`Fatigue is stacking up (${all.join(', ')}). Take the deload week now.`);
    return { setAdj, loadAdj, flags, log, suggestDeload, reasons: all, volumeDial, tmPct };
  }

  function weeklySets(state, lift) { return weeklySetsWith(state, lift, null); }
  // All barbell working sets of next week at a given dial (for the log; the dial step is larger than "one set").
  function barbellSetsAtDial(state, dial, setAdj) {
    const P = JSON.parse(JSON.stringify(state.program)); P.volumeDial = dial; P.setAdj = Object.assign({}, setAdj); P.week = Math.min(P.week + 1, BLOCKS[P.blockIdx].weeks); P.special = null;
    const probe = Object.assign({}, state, { program: P });
    let n = 0;
    for (let d = 0; d < DAYS.length; d++) { P.dayIdx = d; for (const e of buildSession(probe, 'full').exercises) if (e.lift) n += e.sets.filter(x => x.kind === 'work').length; }
    return n;
  }
  // Longest session left in this block (next week to its last accumulation week) that a change of
  // set counts from baseAdj to newAdj lengthens, in minutes of required work (optional slots are
  // left out: they are the lifter's choice, not the plan's). 0 when no session gets longer.
  function blockMaxMinutesWith(state, baseAdj, newAdj, fromWeek) {
    const P0 = state.program, block = BLOCKS[P0.blockIdx];
    const base = JSON.parse(JSON.stringify(P0)), P = JSON.parse(JSON.stringify(P0));
    base.setAdj = Object.assign({}, baseAdj); P.setAdj = Object.assign({}, newAdj); base.special = null; P.special = null;
    const probeBase = Object.assign({}, state, { program: base }), probe = Object.assign({}, state, { program: P });
    let m = 0;
    for (let w = fromWeek != null ? fromWeek : Math.min(P0.week + 1, block.weeks); w <= block.weeks; w++) {
      base.week = w; P.week = w;
      for (let d = 0; d < DAYS.length; d++) {
        base.dayIdx = d; P.dayIdx = d;
        const before = estimateMinutes(buildSession(probeBase, 'full'), true), after = estimateMinutes(buildSession(probe, 'full'), true);
        if (after > before) m = Math.max(m, after);
      }
    }
    return m;
  }

  // Longest session of the week (minutes) under a hypothetical adjustment: the time budget gate.
  // Longest session, in minutes, among the days that the hypothetical change actually lengthens
  // (a set added to the deadlift must not be blocked by a long bench day).
  // Count a week's working sets for a lift pattern, optionally under a hypothetical set adjustment
  // and week. Works on a copy of the program so nothing is left modified, whatever happens.
  function weeklySetsWith(state, lift, hypo) {
    const P0 = state.program;
    const P = JSON.parse(JSON.stringify(P0));
    if (hypo) {
      if (hypo.setAdj != null) P.setAdj = Object.assign({}, P.setAdj, { [lift]: hypo.setAdj });
      if (hypo.week != null) P.week = Math.min(hypo.week, BLOCKS[P.blockIdx].weeks);
      if (hypo.volumeDial != null) P.volumeDial = hypo.volumeDial;
      if (hypo.noSpecial) P.special = null;
    }
    const probe = Object.assign({}, state, { program: P });
    let n = 0;
    for (let d = 0; d < DAYS.length; d++) {
      P.dayIdx = d;
      const s = buildSession(probe, 'full');
      for (const e of s.exercises) if (e.lift === lift && EX[e.ex].mult >= 0.8) n += e.sets.filter(x => x.kind === 'work').length;
    }
    return n;
  }

  // ---------- End-of-meso: Training Max update ----------
  // Rep PRs (reps + RPE on the indicator sets) estimate the 1RM between tests (p.86); the test
  // week sets it directly.
  function mesoReview(state, mesoSessions, isTestBlock) {
    const log = [], upd = {};
    const names = { squat: 'Squat', bench: 'Bench', deadlift: 'Deadlift' };
    if (state.settings.autoCalibrate !== false && !isTestBlock) {
      log.push(`Maxes calibrate every session, so no reset: squat ${state.lifts.squat.oneRM}, bench ${state.lifts.bench.oneRM}, deadlift ${state.lifts.deadlift.oneRM}.`);
      return { oneRM: upd, log };
    }
    for (const lift of ['squat', 'bench', 'deadlift']) {
      let best = 0, clean = true, anyData = false, failW = Infinity, topW = 0, topMade = 0, topEasy = 0;
      for (const s of mesoSessions) {
        if (!s || s.skipped || s.isDeload || s.isRest || s.mode === 'light') continue;
        for (const e of s.exercises) {
          if (e.lift !== lift || EX[e.ex].mult !== 1 || e.role !== 'primary') continue;
          for (const x of e.sets || []) {
            if (!x.done || x.kind === 'warm') continue;
            anyData = true;
            const reps = x.actualReps != null ? x.actualReps : x.reps;
            if (reps < x.reps) clean = false;
            const w = x.actualW != null ? x.actualW : x.w;
            if (isTestBlock && x.kind !== 'test') continue; // Peak sets and back-offs were read by calibration; the test is the singles
            if (isTestBlock && reps === 0 && w > 0) { failW = Math.min(failW, w); continue; } // a single that did not go up: the max is under it
            if (isTestBlock && reps >= 1 && w > topMade) topMade = w;
            const rpe = x.rpe != null ? x.rpe : null;
            if (isTestBlock && rpe != null && rpe < 7 && reps >= 1 && w > topEasy) topEasy = w;
            if (rpe == null || rpe < 7 || rpe > 10 || !(reps > 0) || reps > MAX_EVIDENCE_REPS || !(w > 0)) continue;
            const read = e1rm(w, reps, rpe);
            if (!isTestBlock) best = Math.max(best, read);
            else if (w > topW || (w === topW && read > best)) { topW = w; best = read; } // the heaviest rated single: the best of several noisy readings runs high
          }
        }
      }
      if (!anyData) { log.push(`${names[lift]}: no data this block, 1RM held.`); continue; }
      const cur = state.lifts[lift].oneRM;
      const flagged = (state.program.flags || {})[lift] >= 2;
      const capUp = isTestBlock ? 1.12 : 1.05;
      let next = cur, how = '';
      if (isTestBlock && failW < Infinity && failW > topMade && (best === 0 || best >= failW)) best = Math.max(topMade, failW * 0.975); // a miss caps the estimate just under the missed weight, never under a weight he made
      if (isTestBlock && best > 0) best = Math.max(best, topMade);
      else if (isTestBlock && topMade > cur) best = topMade; // singles with no RPE prove a floor: they can raise the max, not lower it
      if (isTestBlock && topEasy > topW && best < cur && failW === Infinity) best = cur; // a heavier single felt easy: a lighter line cannot lower the max
      if (isTestBlock && best > 0) { next = Math.min(cur * capUp, Math.max(cur * 0.95, best)); how = next >= cur ? 'from your test single' : failW < Infinity ? 'a missed test single' : 'test came in under the old max'; }
      else if (best >= cur * 1.01) { next = Math.min(best, cur * capUp); how = 'estimated from your logged sets'; }
      else if (clean && !flagged && !isTestBlock) { next = cur + (lift === 'bench' ? 2.5 : 5); how = 'clean block, small bump'; }
      else if (flagged) { next = cur * 0.975; how = 'flagged twice, easing off'; }
      next = how ? Math.max(minMax(state), roundTo(next, 2.5)) : cur;
      if (next !== cur) { upd[lift] = next; log.push(`${names[lift]} 1RM ${cur} -> ${next} (${how}).`); }
      else log.push(`${names[lift]} 1RM held at ${cur}.`);
    }
    return { oneRM: upd, log };
  }

  function minMax(state) { const b = state.settings.barWeight; return b > 0 ? b : 45; } // a 1RM under the empty bar is not a max
  function applyTM(state, lift, oneRM) {
    state.lifts[lift].oneRM = oneRM;
    state.lifts[lift].tm = roundTo(oneRM * state.settings.tmPct, 2.5);
    if (state.lifts[lift].blockStartRM == null) state.lifts[lift].blockStartRM = oneRM;
    if (state.lifts[lift].floorRM == null) state.lifts[lift].floorRM = oneRM;
  }

  // ---------- Program position ----------
  function totalWeeks(block) { return block.weeks + (block.deload || block.test ? 1 : 0); }
  // Advance along the macro. Returns the next block index and sets the variant set; at the end of
  // the macro an easy week is queued (one week, two after a rough macro) before it starts again.
  function nextBlockIdx(state) {
    const P = state.program;
    if (P.nextBlockOverride != null) {
      const i = P.nextBlockOverride; P.nextBlockOverride = null;
      if (BLOCKS[i]) { P.variantSet = 'A'; const mp = MACRO.findIndex(m => m.block === BLOCKS[i].id); if (mp >= 0) P.macroPos = mp; return i; }
    }
    let pos = (Number.isInteger(P.macroPos) ? P.macroPos : -1) + 1;
    const endMacro = () => { const rough = (P.macroRough || 0) >= 2 || (P.stallRest || 0) >= 2; P.special = { type: 'rest', weeksLeft: rough ? 2 : 1, resumeDayIdx: 0, macroEnd: true }; P.macroRough = 0; P.stallRest = 0; };
    if (pos >= MACRO.length) { pos = 0; endMacro(); }
    if (MACRO[pos].block === 'peak' && state.settings.includePeak === false) { pos = 0; endMacro(); }
    P.macroPos = pos; P.variantSet = MACRO[pos].variant;
    return blockIndex(MACRO[pos].block);
  }
  // Returns {weekDone, mesoDone} so the app can run reviews.
  function advanceDay(state) {
    const P = clampProgram(state), block = BLOCKS[P.blockIdx];
    const res = { weekDone: false, mesoDone: false, restDone: false, dialUp: false };
    const rest = !!(P.special && P.special.type === 'rest');
    P.dayIdx += 1;
    if (P.dayIdx < DAYS.length) return res;
    P.dayIdx = 0; res.weekDone = true;
    if (P.special && (P.special.type === 'rest' || P.special.type === 'deload')) {
      P.special.weeksLeft = (P.special.weeksLeft > 0 ? P.special.weeksLeft : 1) - 1;
      if (P.special.weeksLeft <= 0) { const back = P.special.resumeDayIdx; P.special = null; res.restDone = true; if (back > 0 && back < DAYS.length) P.dayIdx = back; }
      return res;
    }
    P.week += 1; P.layoffPct = 0;
    if (P.week > totalWeeks(block)) {
      res.mesoDone = true;
      for (const k of ['squat', 'bench', 'deadlift']) if (((P.flags || {})[k] || 0) >= 2) state.lifts[k].macroWasFlagged = true;
      // The volume search, one step per run (p.322): a run that stayed clean and reached its
      // ceiling raises what the next run of this block starts from; a lift flagged twice lowers it.
      state.learned = state.learned || {};
      const prev = state.learned[block.id] || {};
      const l = {};
      for (const k of ['squat', 'bench', 'deadlift']) {
        const end = (P.setAdj || {})[k] || 0, flagged = ((P.flags || {})[k] || 0) >= 2, ceil = (P.runCeil || {})[k];
        const was = prev[k] || 0;
        l[k] = flagged ? Math.max(-1, Math.min(was, end) - 1) : (ceil != null && end >= ceil && P.blockClean !== false) ? Math.min(3, was + 1) : was;
      }
      if (!block.test && !rest) state.learned[block.id] = l; // the Peak block never learns or inherits set counts
      if (P.blockClean === false) P.macroRough = (P.macroRough || 0) + 1;
      // The dial is two-way: any clean block recovers a step below zero; stepping above zero needs a
      // clean block that was already adding sets on every lift.
      const dial = P.volumeDial || 0, chosen = state.settings.tmPctChosen;
      // The high-volume Build block is where the dial was lost, so only a clean Build earns it back
      // (a low-volume Strength block is clean for a fragile lifter almost every time). A Training
      // Max that was lowered at the dial's floor comes back first, one step per clean block.
      if (P.blockClean !== false && !rest && !block.test && chosen && state.settings.tmPct < chosen - 1e-9) {
        state.settings.tmPct = Math.min(chosen, Math.round((state.settings.tmPct + 0.025) * 1000) / 1000); res.tmUp = state.settings.tmPct;
        for (const k of ['squat', 'bench', 'deadlift']) applyTM(state, k, state.lifts[k].oneRM);
      } else if (P.blockClean !== false && !rest && !block.test && dial < TUNE.dial.autoMax && (dial < 0 ? block.id === 'build' : ['squat', 'bench', 'deadlift'].every(k => l[k] >= 2))) {
        P.volumeDial = dial + 1; res.dialUp = true;
        if (dial >= 0) { for (const k of ['squat', 'bench', 'deadlift']) l[k] = Math.max(-1, l[k] - 1); state.learned[block.id] = l; }
      }
      // End of a macro: the silent stall check (same phase to same phase, one change per lift).
      const endingMacro = (P.macroPos || 0) >= MACRO.length - 1 || (MACRO[(P.macroPos || 0) + 1] && MACRO[(P.macroPos || 0) + 1].block === 'peak' && state.settings.includePeak === false);
      if (endingMacro && !rest && (P.mesoCount || 0) - (P.stallMeso != null ? P.stallMeso : -99) >= 3) { P.stallMeso = P.mesoCount || 0; res.stall = stallCheck(state); if (res.stall && res.stall.restWeeks) P.stallRest = res.stall.restWeeks; }
      P.blockClean = true; P.dialMovesBlock = 0; P.lastAddWeek = {}; P.readinessLowWeeks = 0;
      P.week = 1; P.blockIdx = nextBlockIdx(state); P.mesoCount = (P.mesoCount || 0) + 1;
      for (const k of ['squat', 'bench', 'deadlift']) { state.lifts[k].blockStartRM = state.lifts[k].oneRM; state.lifts[k].floorRM = state.lifts[k].oneRM; state.lifts[k].estAtBlockStart = state.lifts[k].est == null ? null : state.lifts[k].est; state.lifts[k].ratedAtBlockStart = state.lifts[k].rated || 0; }
      const nb = BLOCKS[P.blockIdx], start = nb.test ? {} : ((state.learned[nb.id]) || {});
      P.setAdj = { squat: start.squat || 0, bench: start.bench || 0, deadlift: start.deadlift || 0, acc: 0 };
      const zero = { squat: 0, bench: 0, deadlift: 0, acc: 0 };
      for (let guard = 0; guard < 9 && blockMaxMinutesWith(state, zero, P.setAdj, 1) > TUNE.sessionCapMin; guard++) { const k = ['squat', 'bench', 'deadlift'].filter(x => P.setAdj[x] > 0).sort((a, b) => P.setAdj[b] - P.setAdj[a])[0]; if (!k) break; P.setAdj[k] -= 1; }
      if (!nb.test) for (const k of ['squat', 'bench', 'deadlift']) if (P.setAdj[k]) {
        const written = weeklySetsWith(state, k, { setAdj: 0, week: 1, noSpecial: true }), now = weeklySetsWith(state, k, { setAdj: P.setAdj[k], week: 1, noSpecial: true });
        if (now !== written) (res.setLines = res.setLines || []).push(`${k[0].toUpperCase() + k.slice(1)}: starts this block at ${now} sets a week, not ${written} (from how the last run went).`);
      }
      P.runCeil = {}; for (const k of ['squat', 'bench', 'deadlift']) P.runCeil[k] = nb.test ? 0 : Math.min(3, (start[k] || 0) + 1);
      P.loadAdj = { squat: 0, bench: 0, deadlift: 0 }; P.flags = { squat: 0, bench: 0, deadlift: 0 }; P.calibDrops = {}; P.fatigueBase = {}; P.chronicSince = 0; P.layoffPct = 0;
    }
    return res;
  }
  // Stall rule, run at the end of each macro. One macro under 1% is inside the noise of the reading
  // (it fires on about half of macros at normal progress), so it takes two in a row. Then a lift never
  // flagged twice needs more stimulus (its Build run starts one set higher, if a session has room and
  // the dial did not step down this macro); one flagged needs less (a set fewer and a 2-week easy block).
  function buildHasRoom(state, k) {
    const P = JSON.parse(JSON.stringify(state.program)); P.blockIdx = blockIndex('build'); P.special = null;
    const probe = Object.assign({}, state, { program: P }), zero = { squat: 0, bench: 0, deadlift: 0, acc: 0 };
    const cur = Object.assign({}, zero, (state.learned || {}).build || {}), want = Object.assign({}, cur, { [k]: (cur[k] || 0) + 1 });
    for (const v of ['A', 'B']) { P.variantSet = v; if (blockMaxMinutesWith(probe, zero, want, 1) > TUNE.sessionCapMin) return false; }
    return true;
  }
  function stallCheck(state) {
    const out = { lines: [], restWeeks: 0 };
    const names = { squat: 'Squat', bench: 'Bench', deadlift: 'Deadlift' };
    state.learned = state.learned || {};
    for (const k of ['squat', 'bench', 'deadlift']) {
      const L = state.lifts[k], est = L.est != null ? L.est : L.oneRM;
      const prev = L.macroEst, rated = (L.rated || 0) - (L.macroRated || 0);
      L.macroEst = est; L.macroRated = L.rated || 0;
      if (prev == null || !(prev > 0)) continue;
      if (rated < 4) { L.stallRun = 0; continue; } // too few sessions with an RPE to call it a stall (sets without RPEs never move the estimate)
      const gain = est / prev - 1;
      if (gain >= 0.01) { L.stallRun = 0; continue; }
      L.stallRun = (L.stallRun || 0) + 1;
      if (L.stallRun < 2) continue;
      L.stallRun = 0;
      const flagged = !!L.macroWasFlagged;
      if (flagged) {
        for (const b of ['build', 'strength']) { state.learned[b] = state.learned[b] || {}; state.learned[b][k] = Math.max(-1, (state.learned[b][k] || 0) - 1); }
        out.restWeeks = 2;
        out.lines.push(`${names[k]} did not move for two macros and was flagged: one set fewer per exercise next macro, two easy weeks first.`);
      } else if (state.program.macroDialDown) {
        continue; // recovery was already the limiter this macro: no more stimulus
      } else if (!buildHasRoom(state, k)) {
        out.lines.push(`${names[k]} did not move for two macros (${Math.round(prev)} to ${Math.round(est)}), but the session budget has no room for another set.`);
      } else {
        state.learned.build = state.learned.build || {};
        state.learned.build[k] = Math.min(3, (state.learned.build[k] || 0) + 1);
        out.lines.push(`${names[k]} did not move for two macros (${Math.round(prev)} to ${Math.round(est)}): its Build runs start one set higher.`);
      }
    }
    for (const k of ['squat', 'bench', 'deadlift']) state.lifts[k].macroWasFlagged = false;
    state.program.macroDialDown = false;
    return out.lines.length ? out : null;
  }
  // Layoff: coming back after a gap. 7-13 days: repeat the current week 5% lighter with earned sets
  // cleared. 14-20: restart the block at week 1, maxes 2.5% lower, first week 2.5% lighter. 21-41:
  // restart the block (from Peak, the last Strength block) at week 1, maxes 5% lower, first week 5%
  // lighter. 42+: restart the macro at Build week 1 with maxes 10% lower. Returns the log lines.
  function layoffCut(days) { return days >= 42 ? 0.10 : days >= 21 ? 0.05 : days >= 14 ? 0.025 : 0; }
  // prior: the cut already taken for this same gap, when a tougher tier is accepted later.
  function layoffAdjust(state, days, prior) {
    const P = clampProgram(state), lines = [], had = prior > 0 && prior < 1 ? prior : 0;
    if (!(days >= 7)) return lines;
    const was = position(state); // before anything below changes the week
    P.chronicSince = Date.now(); P.calibBaseTs = Date.now(); P.calibDrops = {}; P.fatigueBase = {}; P.readinessLowWeeks = 0;
    const cut = (whole) => { const f = whole > had ? 1 - (1 - whole) / (1 - had) : 0; for (const k of ['squat', 'bench', 'deadlift']) if (state.lifts[k].oneRM > 0) { const v = Math.max(minMax(state), roundTo(state.lifts[k].oneRM * (1 - f), 2.5)); applyTM(state, k, v); state.lifts[k].blockStartRM = v; state.lifts[k].floorRM = v; state.lifts[k].est = null; } };
    P.pendingDeload = false; P.lightRestOfWeek = false; P.pushOn = false;
    if (!(days < 14 && (was.isDeload || was.rest))) P.special = null; // a short gap inside a light week keeps that week
    if (days < 14 && (was.isDeload || was.rest)) { lines.push(`${days} days off: this light week already covers it, so it runs as planned.`); }
    else if (days < 14 && was.isTest) { P.week = Math.max(1, BLOCKS[P.blockIdx].weeks); P.dayIdx = 0; P.layoffPct = -0.05; lines.push(`${days} days off before a test: one more heavy week first, 5% lighter, then the test.`); }
    else if (days < 14) {
      for (const k of ['squat', 'bench', 'deadlift']) P.setAdj[k] = Math.min(0, P.setAdj[k] || 0);
      P.setAdj.acc = Math.min(0, P.setAdj.acc || 0); const midWeek = P.dayIdx > 0; P.dayIdx = 0; P.layoffPct = -0.05;
      lines.push(`${days} days off: ${midWeek ? 'this week starts again' : 'the coming week runs'} 5% lighter with earned sets cleared.`);
    } else if (days < 21) {
      P.week = 1; P.dayIdx = 0; P.setAdj = { squat: 0, bench: 0, deadlift: 0, acc: 0 }; P.flags = { squat: 0, bench: 0, deadlift: 0 }; P.layoffPct = -0.025; cut(0.025);
      lines.push(`${days} days off: the block restarts at week 1, maxes 2.5% lower and the first week 2.5% lighter.`);
    } else if (days < 42) {
      if (BLOCKS[P.blockIdx].test) { P.blockIdx = blockIndex('strength'); P.macroPos = MACRO.map(m => m.block).lastIndexOf('strength'); P.variantSet = MACRO[P.macroPos].variant; } // a test two weeks after a long break is too soon
      P.week = 1; P.dayIdx = 0; P.setAdj = { squat: 0, bench: 0, deadlift: 0, acc: 0 }; P.flags = { squat: 0, bench: 0, deadlift: 0 }; P.layoffPct = -0.05; cut(0.05);
      lines.push(`${days} days off: the ${BLOCKS[P.blockIdx].name} block restarts at week 1, maxes 5% lower and the first week 5% lighter.`);
    } else {
      P.week = 1; P.dayIdx = 0; P.macroPos = 0; P.variantSet = 'A'; P.blockIdx = blockIndex('build'); P.setAdj = { squat: 0, bench: 0, deadlift: 0, acc: 0 }; P.flags = { squat: 0, bench: 0, deadlift: 0 }; P.layoffPct = 0; cut(0.10);
      lines.push(`${days} days off: starting again from Build week 1 with maxes 10% lower (sets this easy read them back slowly: raise them by hand if the weights feel light).`);
    }
    if (days >= 14) {
      const b = BLOCKS[P.blockIdx], start = b.test ? {} : ((state.learned || {})[b.id] || {});
      P.runCeil = {}; for (const k of ['squat', 'bench', 'deadlift']) { P.runCeil[k] = b.test ? 0 : Math.min(3, (start[k] || 0) + 1); state.lifts[k].macroEst = null; state.lifts[k].stallRun = 0; }
      P.blockClean = true; P.dialMovesBlock = 0; P.lastAddWeek = {};
    }
    for (const k of ['squat', 'bench', 'deadlift']) { const L = state.lifts[k]; L.blockStartRM = L.oneRM; L.estAtBlockStart = L.est == null ? null : L.est; L.ratedAtBlockStart = L.rated || 0; }
    return lines;
  }
  // Named tuning presets for simulation sweeps (and nothing else).
  function applyTune(name) {
    const presets = {
      strictDeload: { deload: { redsBlock: 3, lightsBlock: 3, calibDropsLift: 2, readinessLow: 50 } },
      laxDeload: { deload: { redsBlock: 99, lightsBlock: 99, calibDropsLift: 99, calibDropPct: 9, readinessLow: 0 } },
      gentleCorrection: { correction: { firstSetWeight: 0.35, firstSetHardWeight: 0.35, floor: 0.88 } },
      fullCorrection: { correction: { firstSetWeight: 1.0 } },
      noStop: { correction: { stopOver: 99 } },
      readyStrict: { readiness: { green: 65, yellow: 45 } },
      readyLax: { readiness: { green: 55, yellow: 30 } },
      noTrim: { trim: { load: 1 } },
      dialFree: { deload: { dialStepsPerBlock: 9 } },
      absOff: { deload: { readinessAbs: 0 } },
      abs45: { deload: { readinessAbs: 45 } },
      abs55: { deload: { readinessAbs: 55 } },
      abs50dial: { deload: { readinessAbs: 50, readinessMovesDial: true } },
      abs55dial: { deload: { readinessAbs: 55, readinessMovesDial: true } },
      abs50w1: { deload: { readinessAbs: 50, readinessWeeks: 1 } },
      readyMovesDial: { deload: { readinessMovesDial: true } },
      readyOld: { deload: { readinessLow: 55, readinessWeeks: 1 } },
      readyBoth: { deload: { readinessLow: 55, readinessWeeks: 1, readinessMovesDial: true, dialStepsPerBlock: 9 } },
      dropEasy: { calibrate: { downConfHigh: 0 } },
      noOnTarget: { review: { onTarget: 0 } },
      allowanceBoth: { calibrate: { allowance: 0 } },
    };
    const p = presets[name]; if (!p) return false;
    for (const k of Object.keys(p)) Object.assign(TUNE[k], p[k]);
    return true;
  }
  function startDeloadNow(state) {
    const P = clampProgram(state), block = BLOCKS[P.blockIdx];
    if (P.special) return false; // already in an easy or deload week
    P.pendingDeload = false; P.lightRestOfWeek = false; P.pushOn = false;
    if (block.deload) {
      if (P.week > block.weeks) return false; // already in the block's own deload
      if (P.week === block.weeks) { P.week = block.weeks + 1; P.dayIdx = 0; P.chronicSince = Date.now(); P.calibBaseTs = Date.now(); P.calibDrops = {}; P.fatigueBase = {}; P.readinessLowWeeks = 0; for (const k of ['squat', 'bench', 'deadlift']) { state.lifts[k].blockStartRM = state.lifts[k].oneRM; state.lifts[k].estAtBlockStart = state.lifts[k].est == null ? null : state.lifts[k].est; state.lifts[k].ratedAtBlockStart = state.lifts[k].rated || 0; } return true; } // one week left: deload, overreach, deload would be the result, so the planned deload comes now
      // Insert a deload week now; the block resumes at the same week afterwards (an unplanned
      // deload should cost a week, not the rest of the block). The chronic-fatigue window restarts.
      P.special = { type: 'deload', weeksLeft: 1, resumeDayIdx: P.dayIdx > 0 ? P.dayIdx : 0 }; P.dayIdx = 0;
      P.chronicSince = Date.now(); P.calibBaseTs = Date.now(); P.calibDrops = {}; P.fatigueBase = {}; P.readinessLowWeeks = 0; // the replay starts here, from the maxes as they are now
      for (const k of ['squat', 'bench', 'deadlift']) { state.lifts[k].blockStartRM = state.lifts[k].oneRM; state.lifts[k].estAtBlockStart = state.lifts[k].est == null ? null : state.lifts[k].est; state.lifts[k].ratedAtBlockStart = state.lifts[k].rated || 0; }
    }
    else startActiveRest(state, 1); // the Peak block has no deload week; an easy week stands in (never the test week)
    return true;
  }
  // An easy week inserted mid-week resumes the interrupted week at the same day afterwards.
  function startActiveRest(state, weeks) {
    const P = clampProgram(state);
    if (P.special) return false; // already in an easy or deload week
    P.pendingDeload = false; P.lightRestOfWeek = false; P.pushOn = false;
    P.special = { type: 'rest', weeksLeft: weeks > 0 ? Math.min(4, Math.round(weeks)) : 1, resumeDayIdx: P.dayIdx > 0 ? P.dayIdx : 0 };
    P.dayIdx = 0;
    return true;
  }
  function positionLabel(state) {
    const { block, rest, isDeload, isTest, inserted } = position(state), P = state.program;
    const label = rest ? `${P.special.weeksLeft} wk left` : inserted ? `Deload, then week ${P.week}` : isDeload ? 'Deload' : isTest ? 'Test week' : `Week ${P.week} of ${block.weeks}`;
    return { block: rest ? { id: 'rest', name: 'Easy week' } : block, week: P.week, weeks: totalWeeks(block), isDeload, isTest, isRest: rest, inserted, day: DAYS[P.dayIdx], label };
  }

  // Double progression for self-loaded exercises.
  function accessoryProgress(state, exItem) {
    if (!exItem || exItem.load === 'bw' || !exItem.repRange) return null;
    const done = exItem.sets.filter(x => x.done);
    if (!done.length) return null;
    const ws = done.map(x => x.w).filter(v => v != null && v > 0);
    if (!ws.length) return null;
    const freq = {}; ws.forEach(v => { freq[v] = (freq[v] || 0) + 1; });
    const w = Number(Object.keys(freq).sort((a, b) => freq[b] - freq[a] || Number(b) - Number(a))[0]);
    const prev = exItem.prevW, confirmed = done.some(x => x.okW === w) || exItem.prevSuspect === w; // you kept it at the check, or it came up twice
    if (prev > 0 && !confirmed && Math.abs(w - prev) > 20 && (w > prev * 2 || w < prev / 2)) return { weight: prev, msg: 'kept', suspect: w };
    const top = exItem.repRange[1], bottom = exItem.repRange[0];
    const reps = done.map(x => (x.actualReps != null ? x.actualReps : x.reps));
    const inc = exItem.load === 'db' ? state.settings.dbIncrement : 5;
    if (reps.every(r => r >= top)) return { weight: w + inc, msg: `+${inc}` };
    if (reps.some(r => r < bottom)) return { weight: Math.max(inc, w - inc), msg: `-${inc}` };
    return { weight: w, msg: 'hold' };
  }

  // Cardio: rough kcal for easy BikeErg work. Book guideline: keep extra cardio under ~1,500
  // kcal/week, low impact, and judge it by whether the lifts keep improving (pp.351-353).
  function cardioKcal(minutes, watts) {
    const w = watts || 110; // an easy, conversational pace for most people
    return Math.round(minutes * w * 0.0143 * 4.2); // ~ W x 0.06 kcal/min at ~24% efficiency
  }

  function defaultState() {
    return {
      version: 1,
      settings: { units: 'lb', barWeight: 45, plates: [45, 35, 25, 10, 5, 2.5], increment: 5, dbIncrement: 5, tmPct: 0.9, deadliftStyle: 'conventional', squatStyle: 'lowbar', cardioMin: 40, cardioWatts: 110, warmupSets: true, autoCalibrate: true, notify: false, days: ['Mon', 'Tue', 'Thu', 'Fri'], restPrimary: 180, restSecondary: 120, restAccessory: 90, age: null, includePeak: false, name: '' },
      lifts: { squat: { oneRM: 0, tm: 0 }, bench: { oneRM: 0, tm: 0 }, deadlift: { oneRM: 0, tm: 0 } },
      acc: {},
      program: { blockIdx: 0, week: 1, dayIdx: 0, mesoCount: 0, macroPos: 0, variantSet: 'A', setAdj: { squat: 0, bench: 0, deadlift: 0, acc: 0 }, runCeil: { squat: 1, bench: 1, deadlift: 1 }, loadAdj: { squat: 0, bench: 0, deadlift: 0 }, flags: { squat: 0, bench: 0, deadlift: 0 }, swaps: {}, special: null, nextBlockOverride: null, pendingDeload: false, lightRestOfWeek: false, startedAt: null, volumeDial: 0, blockClean: true, readinessBase: null, calibDrops: {}, fatigueBase: {}, chronicSince: 0, macroRough: 0 },
      learned: {},
      current: null,
      sessions: [],
      log: [],
      setupDone: false,
    };
  }

  root.Engine = { RM, pctForRTF, rtfForPct, e1rm, expectedRIR, plannedRPE, roundTo, floorTo, loadStep, barRound, loadRound, correctedLoad, openerWarm, plateLoad, EX, SWAPS, BLOCKS, MACRO, REST, TEST, CAPS, ACC_CAP, DAYS, MODES,
    readinessScore, sorenessFromGroups, buildSession, warmups, exerciseName, swapOptions, liftCorrection, sessionEstimate, calibrate, fatigueAllowance, weeklyReview, weeklySets, mesoReview, applyTM, advanceDay, startDeloadNow, startActiveRest,
    positionLabel, position, totalWeeks, accessoryProgress, cardioKcal, defaultState, estimateMinutes, weeklySetsWith, clampProgram, MAX_EVIDENCE_REPS, TUNE, applyTune, CAPS_BY_BLOCK, capFor, layoffAdjust, layoffCut, stallCheck };
})(typeof window !== 'undefined' ? window : globalThis);
