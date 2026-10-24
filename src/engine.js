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
    const rir = Math.max(0, Math.min(6, 10 - rpe));
    return weight / pctForRTF(reps + rir);
  }
  function expectedRIR(pctOf1RM, reps) { return Math.max(0, rtfForPct(pctOf1RM) - reps); }
  function plannedRPE(pctOf1RM, reps) { return Math.min(10, Math.max(5, Math.round((10 - expectedRIR(pctOf1RM, reps)) * 2) / 2)); }

  // ---------- Loading ----------
  function roundTo(x, inc) { return Math.round(x / inc) * inc; }
  function plateLoad(total, bar, plates) {
    let perSide = (total - bar) / 2, out = [];
    if (perSide < 0) return { plates: [], exact: total === bar, short: 0 };
    const sorted = plates.slice().sort((a, b) => b - a);
    for (const p of sorted) { while (perSide >= p - 1e-9) { out.push(p); perSide -= p; } }
    return { plates: out, exact: perSide < 1e-9, short: perSide };
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
  // Week-to-week: +2.5-3% load and 0-1 set in Build, load only in Strength (pp.79-82, 338-339).
  const BLOCKS = [
    {
      id: 'build', name: 'Build', focus: 'Muscle and work capacity', weeks: 4, deload: true,
      primary:   [{ sets: 3, reps: 8, pct: 0.775 }, { sets: 4, reps: 8, pct: 0.80 }, { sets: 4, reps: 8, pct: 0.825 }, { sets: 4, reps: 7, pct: 0.85 }],
      secondary: [{ sets: 3, reps: 8, pct: 0.75 }, { sets: 3, reps: 8, pct: 0.775 }, { sets: 4, reps: 8, pct: 0.80 }, { sets: 4, reps: 8, pct: 0.825 }],
      accessory: [{ sets: 2, reps: 12 }, { sets: 3, reps: 12 }, { sets: 3, reps: 12 }, { sets: 3, reps: 12 }],
      plus: 2, light: { vol: 0.5, int: 0.9 }, deloadA: { vol: 0.5, int: 0.9 }, deloadB: { vol: 0.5, int: 0.5 },
      variation: { squat_variation: 'belt_squat', bench_variation: 'close_grip', hinge_variation: 'rdl' },
    },
    {
      id: 'strength', name: 'Strength', focus: 'Heavier, fewer reps', weeks: 3, deload: true,
      primary:   [{ sets: 4, reps: 5, pct: 0.85 }, { sets: 4, reps: 4, pct: 0.90 }, { sets: 4, reps: 3, pct: 0.95 }],
      secondary: [{ sets: 3, reps: 5, pct: 0.80 }, { sets: 3, reps: 5, pct: 0.83 }, { sets: 3, reps: 4, pct: 0.86 }],
      accessory: [{ sets: 2, reps: 10 }, { sets: 3, reps: 10 }, { sets: 3, reps: 8 }],
      plus: 1, light: { vol: 0.7, int: 0.7 }, deloadA: { vol: 0.7, int: 0.7 }, deloadB: { vol: 0.5, int: 0.5 },
      variation: { squat_variation: 'paused_squat', bench_variation: 'paused_bench', hinge_variation: 'paused_deadlift' },
    },
    {
      id: 'peak', name: 'Peak & Test', focus: 'Express strength, set new maxes', weeks: 2, deload: false, test: true,
      primary:   [{ sets: 3, reps: 3, pct: 0.95 }, { sets: 3, reps: 2, pct: 1.0 }],
      secondary: [{ sets: 3, reps: 4, pct: 0.80 }, { sets: 2, reps: 3, pct: 0.80 }],
      accessory: [{ sets: 2, reps: 10 }, { sets: 1, reps: 10 }],
      plus: 0, light: { vol: 0.9, int: 0.5 }, deloadA: { vol: 0.9, int: 0.5 }, deloadB: { vol: 0.5, int: 0.5 },
      variation: { squat_variation: 'comp_squat', bench_variation: 'comp_bench', hinge_variation: 'comp_deadlift' },
    },
  ];
  // Active rest: 50% volume / 50% intensity, non-competition lifts (pp.155, 343).
  const REST = { primary: { sets: 2, reps: 5, pct: 0.50 }, secondary: { sets: 2, reps: 6, pct: 0.50 }, accessory: { sets: 2, reps: 12 },
    variation: { squat_primary: 'high_bar_squat', bench_primary: 'close_grip', deadlift_primary: 'paused_deadlift', bench_secondary: 'spoto_press', squat_variation: 'tempo_squat', bench_variation: 'larsen_press', hinge_variation: 'rdl' } };
  const TEST = { warmups: [{ reps: 5, pct: 0.55 }, { reps: 3, pct: 0.70 }, { reps: 2, pct: 0.80 }, { reps: 1, pct: 0.90 }, { reps: 1, pct: 0.97 }, { reps: 1, pct: 1.03 }], backoff: { sets: 2, reps: 3, pct: 0.80 } };

  // Hard weekly caps on working sets for each competition pattern (comp lift + barbell variants).
  // Set additions can never climb past these, so the volume that buried you stays out of reach.
  const CAPS = { squat: 12, bench: 16, deadlift: 9 };
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
    { id: 'B', name: 'Bench day', slots: [
      { key: 'bench_primary', role: 'primary', tm: 'bench' },
      { key: 'press_secondary', role: 'secondary', tm: 'bench' },
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
      { key: 'hinge_variation', role: 'secondary', tm: 'deadlift' },
      { key: 'back_vertical', role: 'accessory' },
      { key: 'delts', role: 'accessory', optional: true },
      { key: 'triceps', role: 'accessory' }] },
  ];

  // ---------- Readiness ----------
  // sleep, energy, motivation: 1 (worst) .. 5 (best). soreness: 1 (fresh) .. 5 (wrecked).
  function readinessScore(r) {
    const s = (v) => (v - 1) / 4;
    const score = 100 * (0.30 * s(r.sleep) + 0.25 * s(r.energy) + 0.25 * (1 - s(r.soreness)) + 0.20 * s(r.motivation));
    const color = score >= 60 ? 'green' : score >= 40 ? 'yellow' : 'red';
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
    if (sw[slot.key]) id = sw[slot.key];
    else if (rest && REST.variation[slot.key]) id = REST.variation[slot.key];
    else if (block.variation && block.variation[slot.key]) id = block.variation[slot.key];
    else id = SWAPS[slot.key][0];
    if (id === 'high_bar_squat' || id === 'low_bar_squat') id = otherSquat(state);
    return id;
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
    const P = state.program, block = BLOCKS[P.blockIdx];
    const rest = P.special && P.special.type === 'rest';
    const isDeload = !rest && block.deload && P.week > block.weeks;
    const isTest = !rest && block.test && P.week > block.weeks;
    return { block, rest, isDeload, isTest, wk: Math.min(P.week, block.weeks) - 1, day: DAYS[P.dayIdx] };
  }

  function buildSession(state, mode) {
    const P = state.program, S = state.settings;
    const { block, rest, isDeload, isTest, wk, day } = position(state);
    mode = MODES[mode] ? mode : 'full';
    const out = { block: rest ? 'rest' : block.id, blockName: rest ? 'Easy week' : block.name, week: P.week, isDeload, isTest, isRest: rest, dayId: day.id, dayName: day.name, mode, exercises: [], notes: [] };
    const firstHalf = P.dayIdx < 2;
    const lastWk = block.weeks - 1;

    for (const slot of day.slots) {
      const exId = resolveExercise(state, slot, block, rest);
      const ex = EX[exId], lift = slot.tm || null;
      const item = { slotKey: slot.key, ex: exId, name: exerciseName(state, exId), role: slot.role, lift, load: ex.load, optional: !!slot.optional, cue: ex.cue || null, sets: [],
        rest: slot.role === 'primary' ? S.restPrimary : slot.role === 'secondary' ? S.restSecondary : S.restAccessory };

      // --- Test week: primaries work up to a heavy single ---
      if (isTest && slot.role === 'primary') {
        const tm = tmOf(state, lift);
        for (const w of TEST.warmups) item.sets.push({ w: roundTo(tm * w.pct, S.increment), reps: w.reps, pct: w.pct, kind: w.pct >= 0.97 ? 'test' : 'warm', rpeTarget: w.pct >= 1.03 ? 9 : w.pct >= 0.97 ? 8 : null });
        item.sets.push({ w: null, reps: 1, pct: null, kind: 'test', rpeTarget: 9, open: true });
        for (let i = 0; i < TEST.backoff.sets; i++) item.sets.push({ w: roundTo(tm * TEST.backoff.pct, S.increment), reps: TEST.backoff.reps, pct: TEST.backoff.pct, kind: 'work', rpeTarget: 7 });
        item.note = 'Work up to one single at RPE 9 (one clean rep left). Add 2-5% to the last line if the single before it was RPE 8 or less. Stop there, then do the back-off sets.';
        out.exercises.push(item);
        continue;
      }

      if (ex.tm) {
        // ----- Barbell lift loaded from a TM -----
        let base, volF = 1, intF = 1, why = null;
        if (rest) { base = REST[slot.role]; }
        else if (isDeload || isTest) {
          base = block[slot.role][lastWk];
          const d = firstHalf ? block.deloadA : block.deloadB; volF = d.vol; intF = d.int;
          if (isTest) { volF = 0.5; intF = 0.7; }
        } else {
          base = block[slot.role][wk];
          if (mode === 'light') { volF = block.light.vol; intF = block.light.int; }
        }
        const adj = (!rest && !isDeload && !isTest) ? ((P.loadAdj && P.loadAdj[lift]) || 0) : 0;
        let sets = base.sets;
        if (!rest && !isDeload && !isTest && mode === 'full') sets += ((P.setAdj && P.setAdj[lift]) || 0);
        sets = Math.max(1, Math.round(sets * volF + 1e-9));
        if (volF < 1 && sets < 2 && base.sets >= 3) sets = 2;
        const pct = (base.pct + adj) * intF;
        const w = roundTo(tmOf(state, lift) * ex.mult * pct, S.increment);
        const pct1rm = w / (state.lifts[lift].oneRM * ex.mult);
        const rpe = plannedRPE(pct1rm, base.reps);
        const plusOk = mode === 'full' && !isDeload && !isTest && !rest && block.plus > 0;
        if (S.warmupSets !== false) for (const st of warmups(Math.max(w, S.barWeight), S.barWeight, S.increment, slot.role)) item.sets.push({ w: st.w, reps: st.reps, kind: 'warm' });
        for (let i = 0; i < sets; i++) {
          const ind = i === 0 && plusOk;
          item.sets.push({ w, reps: base.reps, pct, kind: 'work', ind, plus: ind ? block.plus : 0, rpeTarget: rpe });
        }
        item.pctTM = pct; item.rpeTarget = rpe;
        if (w < S.barWeight) item.sets.forEach(x => x.w = S.barWeight);
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
        let sets = sch.sets + ((!rest && !isDeload && !isTest && mode === 'full' && P.setAdj && P.setAdj.acc) || 0);
        sets = Math.max(1, Math.min(ACC_CAP, Math.round(sets * volF + 1e-9)));
        const w0 = accWeight(state, exId);
        const w = w0 == null ? null : ex.load === 'bw' ? null : roundTo(w0 * intF, ex.load === 'db' ? S.dbIncrement : 5);
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
    if (isDeload) out.notes.push(firstHalf ? 'Deload, first half: half the sets, loads kept high so nothing detrains.' : 'Deload, second half: half the sets at half the load. It is meant to feel easy.');
    if (rest) out.notes.push('Active rest: everything at about half volume and half load, on variations. Technique practice, not work.');
    return out;
  }

  function estimateMinutes(sess) {
    let s = 8;
    for (const e of sess.exercises) {
      const warm = e.sets.filter(x => x.kind === 'warm').length, n = e.sets.length - warm;
      s += n * (e.rest / 60 + 0.75) + warm * 1.1 + (warm ? 0.5 : e.role === 'primary' ? 5 : e.role === 'secondary' ? 3 : 1);
    }
    return Math.round(s);
  }

  // Warm-up ramp to the first working weight. Fractions are of the WORKING weight, not the 1RM:
  // reps fall as load rises, jumps shrink near the top, and the last step is a single at ~90% so
  // the first work set is not a surprise. A heavier target earns more steps; the second barbell
  // lift of a session (already warm) gets a shorter ramp. Steps closer than 10 lb are dropped.
  function warmups(target, bar, increment, role) {
    const steps = [{ w: bar, reps: role === 'primary' ? 10 : 8 }];
    if (target <= bar + 20) return steps;
    const full = target >= 300 ? [[0.35, 8], [0.5, 5], [0.62, 4], [0.72, 3], [0.82, 2], [0.9, 1]]
      : target >= bar * 3 ? [[0.4, 8], [0.55, 5], [0.7, 3], [0.82, 2], [0.9, 1]]
      : [[0.5, 5], [0.7, 3], [0.85, 1]];
    const short = target >= bar * 3 ? [[0.5, 5], [0.7, 3], [0.85, 1]] : [[0.6, 4], [0.8, 2]];
    const ramp = role === 'primary' ? full : short;
    let last = bar;
    for (const [r, reps] of ramp) {
      const w = roundTo(target * r, increment);
      if (w >= last + 10 && w <= target - 10) { steps.push({ w, reps }); last = w; }
    }
    return steps;
  }

  // ---------- Weekly review: this week's sessions -> next week's set / load adjustments ----------
  // Book rules: easy week -> add a set or two / take a bigger jump (pp.159-160); can't match last
  // week's reps -> MRV passed (pp.126, 338-339); too much fatigue -> light sessions, not unplanned
  // deloads (p.160); recovering easily week after week -> slowly raise sets (p.322).
  function weeklyReview(state, weekSessions) {
    const P = state.program, block = BLOCKS[P.blockIdx];
    const log = [], flags = Object.assign({ squat: 0, bench: 0, deadlift: 0 }, P.flags || {});
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
        if (!e.lift || e.role === 'accessory') continue;
        const work = e.sets.filter(x => x.kind === 'work' && x.done);
        if (!work.length) continue;
        const missed = work.filter(x => (x.actualReps != null ? x.actualReps : x.reps) < x.reps).length;
        const deltas = work.filter(x => x.rpe != null && x.rpeTarget != null).map(x => x.rpe - x.rpeTarget);
        const rpeDelta = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
        const g = EX[e.ex].group === 'push' ? 'push' : EX[e.ex].group === 'legs' ? 'legs' : 'hinge';
        per[e.lift].push({ role: e.role, missed, rpeDelta, difficulty: s.post ? s.post.difficulty : 2, soreness: s.soreness ? s.soreness[g] : null, light: s.mode === 'light' });
      }
    }
    const names = { squat: 'Squat', bench: 'Bench', deadlift: 'Deadlift' };
    for (const lift of ['squat', 'bench', 'deadlift']) {
      const rows = per[lift].filter(r => !r.light);
      if (!rows.length) { log.push(`${names[lift]}: no overload session logged this week, holding.`); continue; }
      const prim = rows.find(r => r.role === 'primary') || rows[0];
      let score = 0, why = [];
      if (prim.missed > 0 || prim.rpeDelta >= 1.5) { score -= 2; why.push(prim.missed ? `missed reps on ${prim.missed} set${prim.missed > 1 ? 's' : ''}` : 'felt much harder than planned'); }
      else if (prim.rpeDelta >= 0.75) { score -= 1; why.push('felt harder than planned'); }
      else if (prim.rpeDelta <= -0.75) { score += 1; why.push('felt easier than planned'); }
      if (prim.difficulty === 1) { score += 1; why.push('session rated easy'); }
      else if (prim.difficulty === 3) { score -= 1; why.push('session rated very hard'); }
      else if (prim.difficulty === 4) { score -= 2; why.push('session crushed you'); }
      if (prim.soreness === 1 && score >= 0) { score += 1; why.push('recovered by the next session'); }
      else if (prim.soreness === 3) { score -= 1; why.push('still sore at the next session'); }
      else if (prim.soreness === 4) { score -= 2; why.push('very sore at the next session'); }

      const cap = CAPS[lift];
      if (score >= 2 && !lastWeek) {
        const canAdd = setAdj[lift] < 2 && weeklySets(state, lift) + 1 <= cap;
        if (canAdd) { setAdj[lift] += 1; log.push(`${names[lift]}: +1 set next week (${why.join(', ')}).`); }
        else if (score >= 3 && loadAdj[lift] < 0.05) { loadAdj[lift] += 0.025; log.push(`${names[lift]}: at the set cap, so a bigger jump next week (+2.5%).`); }
        else log.push(`${names[lift]}: recovering well, holding at the weekly set cap.`);
        flags[lift] = 0;
      } else if (score <= -4) {
        setAdj[lift] = Math.max(-2, setAdj[lift] - 1); loadAdj[lift] = Math.max(-0.10, loadAdj[lift] - 0.05); flags[lift] += 1;
        log.push(`${names[lift]}: -1 set and -5% next week (${why.join(', ')}).`);
      } else if (score <= -2) {
        setAdj[lift] = Math.max(-2, setAdj[lift] - 1); loadAdj[lift] = Math.max(-0.10, loadAdj[lift] - 0.025); flags[lift] += 1;
        log.push(`${names[lift]}: -1 set and -2.5% next week (${why.join(', ')}).`);
      } else {
        if (score >= 1) flags[lift] = Math.max(0, flags[lift] - 1);
        log.push(`${names[lift]}: holding (${why.length ? why.join(', ') : 'on target'}).`);
      }
    }
    const anyFlag = Object.values(flags).some(f => f > 0);
    if (block.id === 'build' && !anyFlag && crushed === 0 && !lastWeek && setAdj.acc < 1) { setAdj.acc += 1; log.push('Accessories: +1 set next week.'); }
    if (anyFlag && setAdj.acc > 0) { setAdj.acc -= 1; log.push('Accessories: -1 set to free up recovery.'); }

    const flaggedLifts = Object.keys(flags).filter(l => flags[l] >= 2);
    const suggestDeload = !lastWeek && (flaggedLifts.length >= 2 || (reds >= 2 && lights < 2) || crushed >= 2);
    if (suggestDeload) log.push(`Fatigue is stacking up (${[flaggedLifts.length >= 2 ? 'two lifts flagged twice' : null, reds >= 2 ? 'two red check-ins' : null, crushed >= 2 ? 'two crushing sessions' : null].filter(Boolean).join(', ')}). Consider taking the deload week now.`);
    return { setAdj, loadAdj, flags, log, suggestDeload };
  }

  function weeklySets(state, lift) {
    const saved = state.program.dayIdx;
    let n = 0;
    for (let d = 0; d < DAYS.length; d++) {
      state.program.dayIdx = d;
      const s = buildSession(state, 'full');
      for (const e of s.exercises) if (e.lift === lift && e.role !== 'accessory' && EX[e.ex].mult >= 0.8) n += e.sets.filter(x => x.kind === 'work').length;
    }
    state.program.dayIdx = saved;
    return n;
  }

  // ---------- End-of-meso: Training Max update ----------
  // Rep PRs (reps + RPE on the indicator sets) estimate the 1RM between tests (p.86); the test
  // week sets it directly.
  function mesoReview(state, mesoSessions, isTestBlock) {
    const log = [], upd = {};
    const names = { squat: 'Squat', bench: 'Bench', deadlift: 'Deadlift' };
    for (const lift of ['squat', 'bench', 'deadlift']) {
      let best = 0, clean = true, anyData = false;
      for (const s of mesoSessions) {
        if (!s || s.skipped || s.isDeload || s.isRest || s.mode === 'light') continue;
        for (const e of s.exercises) {
          if (e.lift !== lift || EX[e.ex].mult !== 1 || e.role !== 'primary') continue;
          for (const x of e.sets) {
            if (!x.done || x.kind === 'warm') continue;
            anyData = true;
            const reps = x.actualReps != null ? x.actualReps : x.reps;
            if (reps < x.reps) clean = false;
            const w = x.actualW != null ? x.actualW : x.w;
            if (x.rpe != null && x.rpe >= 7 && reps > 0 && w) best = Math.max(best, e1rm(w, reps, x.rpe));
          }
        }
      }
      if (!anyData) { log.push(`${names[lift]}: no data this block, 1RM held.`); continue; }
      const cur = state.lifts[lift].oneRM;
      const flagged = (state.program.flags || {})[lift] >= 2;
      const capUp = isTestBlock ? 1.12 : 1.05;
      let next = cur, how = '';
      if (best >= cur * 1.01) { next = Math.min(best, cur * capUp); how = isTestBlock ? 'from your test single' : 'estimated from your logged sets'; }
      else if (isTestBlock && best > 0 && best < cur * 0.97) { next = Math.max(best, cur * 0.95); how = 'test came in under the old max'; }
      else if (clean && !flagged) { next = cur + (lift === 'bench' ? 2.5 : 5); how = 'clean block, small bump'; }
      else if (flagged) { next = cur * 0.975; how = 'flagged twice, easing off'; }
      next = roundTo(next, 2.5);
      if (next !== cur) { upd[lift] = next; log.push(`${names[lift]} 1RM ${cur} -> ${next} (${how}).`); }
      else log.push(`${names[lift]} 1RM held at ${cur}.`);
    }
    return { oneRM: upd, log };
  }

  function applyTM(state, lift, oneRM) {
    state.lifts[lift].oneRM = oneRM;
    state.lifts[lift].tm = roundTo(oneRM * state.settings.tmPct, state.settings.increment);
  }

  // ---------- Program position ----------
  function totalWeeks(block) { return block.weeks + (block.deload || block.test ? 1 : 0); }
  function nextBlockIdx(state) {
    const P = state.program;
    if (P.nextBlockOverride != null) { const i = P.nextBlockOverride; P.nextBlockOverride = null; return i; }
    let i = (P.blockIdx + 1) % BLOCKS.length;
    if (BLOCKS[i].test && state.settings.includePeak === false) i = (i + 1) % BLOCKS.length;
    return i;
  }
  // Returns {weekDone, mesoDone} so the app can run reviews.
  function advanceDay(state) {
    const P = state.program, block = BLOCKS[P.blockIdx];
    const res = { weekDone: false, mesoDone: false, restDone: false };
    P.dayIdx += 1;
    if (P.dayIdx < DAYS.length) return res;
    P.dayIdx = 0; res.weekDone = true;
    if (P.special && P.special.type === 'rest') {
      P.special.weeksLeft -= 1;
      if (P.special.weeksLeft <= 0) { P.special = null; res.restDone = true; }
      return res;
    }
    P.week += 1;
    if (P.week > totalWeeks(block)) {
      res.mesoDone = true;
      // Remember the set counts this block tolerated, to start from next time (p.322).
      state.learned = state.learned || {};
      const l = {}; for (const k of ['squat', 'bench', 'deadlift']) l[k] = Math.max(-1, Math.min(2, (P.setAdj[k] || 0) - ((P.flags[k] || 0) >= 2 ? 1 : 0)));
      state.learned[block.id] = l;
      P.week = 1; P.blockIdx = nextBlockIdx(state); P.mesoCount = (P.mesoCount || 0) + 1;
      const nb = BLOCKS[P.blockIdx], start = (state.learned[nb.id]) || {};
      P.setAdj = { squat: start.squat || 0, bench: start.bench || 0, deadlift: start.deadlift || 0, acc: 0 };
      P.loadAdj = { squat: 0, bench: 0, deadlift: 0 }; P.flags = { squat: 0, bench: 0, deadlift: 0 };
    }
    return res;
  }
  function startDeloadNow(state) {
    const P = state.program, block = BLOCKS[P.blockIdx];
    P.dayIdx = 0;
    if (block.deload || block.test) P.week = block.weeks + 1;
    else { P.special = { type: 'rest', weeksLeft: 1 }; }
  }
  function startActiveRest(state, weeks) { state.program.special = { type: 'rest', weeksLeft: weeks || 2 }; state.program.dayIdx = 0; }
  function positionLabel(state) {
    const { block, rest, isDeload, isTest } = position(state), P = state.program;
    const label = rest ? `${P.special.weeksLeft} wk left` : isDeload ? 'Deload' : isTest ? 'Test week' : `Week ${P.week} of ${block.weeks}`;
    return { block: rest ? { id: 'rest', name: 'Easy week' } : block, week: P.week, weeks: totalWeeks(block), isDeload, isTest, isRest: rest, day: DAYS[P.dayIdx], label };
  }

  // Double progression for self-loaded exercises.
  function accessoryProgress(state, exItem) {
    if (!exItem || exItem.load === 'bw' || !exItem.repRange) return null;
    const done = exItem.sets.filter(x => x.done);
    if (!done.length) return null;
    const w = done[0].w; if (w == null) return null;
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
      settings: { units: 'lb', barWeight: 45, plates: [45, 35, 25, 10, 5, 2.5], increment: 5, dbIncrement: 5, tmPct: 0.9, deadliftStyle: 'conventional', squatStyle: 'lowbar', cardioMin: 60, cardioWatts: 110, warmupSets: true, days: ['Mon', 'Tue', 'Thu', 'Fri'], restPrimary: 180, restSecondary: 120, restAccessory: 90, age: null, includePeak: true, name: '' },
      lifts: { squat: { oneRM: 0, tm: 0 }, bench: { oneRM: 0, tm: 0 }, deadlift: { oneRM: 0, tm: 0 } },
      acc: {},
      program: { blockIdx: 0, week: 1, dayIdx: 0, mesoCount: 0, setAdj: { squat: 0, bench: 0, deadlift: 0, acc: 0 }, loadAdj: { squat: 0, bench: 0, deadlift: 0 }, flags: { squat: 0, bench: 0, deadlift: 0 }, swaps: {}, special: null, nextBlockOverride: null, pendingDeload: false, lightRestOfWeek: false, startedAt: null },
      learned: {},
      current: null,
      sessions: [],
      log: [],
      setupDone: false,
    };
  }

  root.Engine = { RM, pctForRTF, rtfForPct, e1rm, expectedRIR, plannedRPE, roundTo, plateLoad, EX, SWAPS, BLOCKS, REST, TEST, CAPS, ACC_CAP, DAYS, MODES,
    readinessScore, sorenessFromGroups, buildSession, warmups, exerciseName, swapOptions, weeklyReview, weeklySets, mesoReview, applyTM, advanceDay, startDeloadNow, startActiveRest,
    positionLabel, position, totalWeeks, accessoryProgress, cardioKcal, defaultState, estimateMinutes };
})(typeof window !== 'undefined' ? window : globalThis);
