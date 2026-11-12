// Fitness-fatigue simulator of the ReadySet engine: dev/sim/sim3.js as a function, with the app's real
// wiring available (appLike) and optional model corrections. With {rng:'orig'} and nothing else it
// reproduces the old sim3 exactly, including its bugs (test-week primaries never simulated, one date,
// no fatigue stop, soreness read early, no tmPctChosen, no est after a test).
// A model, not the truth: it tests control logic and compares variants by direction. It does not give
// gain rates or absolute fatigue levels. Report every gain under more than one stimulus model.
//
// CLI (same output line as the old sim3): node sim3.js <engine.js> [profile] [lens] [weeks] [seed]
//   lens: legacy (old sim3), A (app wiring), B (A + realistic noise, structural gain), F (B + load-based stimulus)
const path = require('path');
const ENGINE = path.join(__dirname, '..', '..', 'src', 'engine.js');
const PHS = {
  normal:  { tauFit: 42, tauFat: 9,  kFit: 0.0022, kFat: 0.0115, noise: 0.45, ceiling: 1.35, satur: 12 },
  fragile: { tauFit: 42, tauFat: 14, kFit: 0.0019, kFat: 0.0160, noise: 0.45, ceiling: 1.30, satur: 10 },
  robust:  { tauFit: 42, tauFat: 7,  kFit: 0.0025, kFat: 0.0085, noise: 0.45, ceiling: 1.40, satur: 14 },
  noisy:   { tauFit: 42, tauFat: 9,  kFit: 0.0022, kFat: 0.0115, noise: 0.90, ceiling: 1.35, satur: 12 },
};
function freshEngine(enginePath) {
  const p = enginePath || ENGINE;
  delete require.cache[require.resolve(p)];
  delete globalThis.Engine;
  require(p);
  const sp = path.join(path.dirname(p), 'sanitize.js');
  if (require('fs').existsSync(sp)) { delete require.cache[require.resolve(sp)]; require(sp); }
  return globalThis.Engine;
}
function makeRng(kind, s0) {
  if (kind === 'orig') { let seed = s0; return () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648; }
  // mulberry32, seeded through a hash so nearby seeds are unrelated
  let a = (Math.imul(s0 ^ 0x9e3779b9, 0x85ebca6b) ^ 0x2f6e2b1) >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const LIFTS = ['squat', 'bench', 'deadlift'];
function run(opts) {
  opts = Object.assign({ profile: 'normal', peak: true, macros: 3, weeks: null, seed: 7, rng: 'good', appLike: false }, opts || {});
  const E = freshEngine(opts.engine);
  if (opts.preload) opts.preload(E);
  const rnd = makeRng(opts.rng, opts.seed);
  const gauss = () => (rnd() + rnd() + rnd() - 1.5) * 1.1;
  const PH = Object.assign({}, PHS[opts.profile], opts.ph || {});
  const sessStim = { squat: 0, bench: 0, deadlift: 0 };
  const START = opts.start || { squat: 365, bench: 255, deadlift: 425 };
  const body = {};
  const C = opts.C || null; // corrected-model options: { G, D50, sM, kFitScale, loadTerm }
  if (C && C.kFitScale != null) PH.kFit *= C.kFitScale;
  if (C && C.G != null && PH.gScale == null) PH.gScale = ({ normal: 1, fragile: 0.85, robust: 1.15, noisy: 1 })[opts.profile];
  const fit0 = opts.fit0 != null ? opts.fit0 : 0;
  for (const l of LIFTS) body[l] = { base: START[l] / (1 + fit0), fit: fit0, fat: 0, struct: 0 };
  const weekDose = { squat: 0, bench: 0, deadlift: 0 }; const acute = { squat: 0, bench: 0, deadlift: 0 };
  const allStall = [];
  const fresh0 = {}; for (const l of LIFTS) fresh0[l] = body[l].base * (1 + body[l].fit);
  // day-to-day capacity wobble that is NOT fatigue (sleep, food, stress): a per-session multiplier
  let dayMult = { squat: 1, bench: 1, deadlift: 1 }, sessBias = 0;
  const capFresh = (l) => body[l].base * (1 + body[l].struct + body[l].fit);
  const cap = (l) => body[l].base * (1 + body[l].struct + body[l].fit - body[l].fat - acute[l]) * dayMult[l];
  const fatigueLevel = () => Math.max(...LIFTS.map(l => body[l].fat));
  const st = E.defaultState();
  for (const l of LIFTS) E.applyTM(st, l, opts.entered ? opts.entered[l] : START[l]);
  st.settings.includePeak = !!opts.peak; st.setupDone = true;
  if (opts.appLike) st.settings.tmPctChosen = st.settings.tmPct;
  if (opts.patch) opts.patch(E, st);
  const acc = { belt_squat: 135, leg_curl: 90, lat_pulldown: 120, low_row: 120, leg_ext: 100, tri_pushdown: 50, db_curl: 30, face_pull: 40, lateral_raise: 15 };
  const inBlock = (s) => { const P = st.program; return s.mesoCount === P.mesoCount && s.blockIdx === P.blockIdx && !s.isRest && (!opts.appLike || (!s.isDeload && !(P.chronicSince && (s.ts || 0) < P.chronicSince))); };
  const sessionsOfWeek = () => st.sessions.filter(s => inBlock(s) && s.week === st.program.week);
  const sessionsOfMeso = () => st.sessions.filter(inBlock);
  const newM = () => ({ fatSum: 0, fatPeak: 0, fatN: 0, overDays: 0, deepDays: 0, hardSessions: 0, crushed: 0, deloads: 0, injuries: 0, reds: 0, lights: 0, sessions: 0, grinds: 0, readinessSum: 0, setsByBlock: {}, stops: 0, cutSets: 0, trackSum: {squat:0,bench:0,deadlift:0}, trackFreshSum: {squat:0,bench:0,deadlift:0}, trackN: 0, maxMin: 0, over75: 0, weeks: 0, relSum: 0, relN: 0, tonnage: 0, dialPath: [], tmPath: [], flagsCount: 0, setAdds: 0, setCuts: 0, calUp: 0, calDown: 0, rpeOverSum:0, rpeOverN:0 });
  let M = newM(); const macros = []; const allM = newM();
  let day = 0, week = 0, takeDeload = false, macroWeekStart = 0;
  const weekly = []; let gapDone = false, gapWeek = null;
  const decayDay = () => { for (const l of LIFTS) { body[l].fit *= Math.exp(-1 / PH.tauFit); body[l].fat *= Math.exp(-1 / PH.tauFat); if (opts.structRate) {/* structure does not decay */} } };
  const dayPass = (n) => { for (let i = 0; i < n; i++) { decayDay(); day++; const f = fatigueLevel(); M.fatSum += f; M.fatN++; M.fatPeak = Math.max(M.fatPeak, f); if (f > 0.08) M.overDays++; if (f > 0.14) { M.deepDays++; for (const l of LIFTS) body[l].fit -= 0.0015; if (rnd() < 0.02) { M.injuries++; for (const l of LIFTS) body[l].fit -= 0.03; } } } };
  let trueRpe = 0;
  const rpeFor = (l, mult, w, reps) => {
    let rtf = E.rtfForPct(w / (cap(l) * mult));
    if (opts.tableK) rtf = 1 + (rtf - 1) * (opts.tableK[l] != null ? opts.tableK[l] : 1);
    trueRpe = 10 - (rtf - reps);
    const rpe = 10 - (rtf - reps) + gauss() * PH.noise + sessBias * (opts.sessBiasSD || 0) + (opts.ratingBias || 0);
    return Math.max(5, Math.min(11, Math.round(rpe * 2) / 2));
  };
  const train = (l, mult, w, reps, rpe, exId) => {
    const rel = w / (cap(l) * mult);
    const rir = Math.max(0, 10 - rpe);
    // Stimulus model. Default is sim3's. 'load' (the corrected copy) drops the RIR dependence for
    // strength and credits load and reps instead; see the audit notes.
    let effReps;
    if (opts.stimModel === 'load') effReps = rel >= 0.6 ? Math.min(reps, 6) * 0.55 * (0.4 + 0.8 * Math.min(1, rel)) : 0;
    else effReps = rel >= 0.6 ? Math.max(0, Math.min(reps, 5) - Math.max(0, rir - 1)) * (0.5 + 0.7 * Math.min(1, rel)) : 0;
    const specificity = opts.specificity ? (mult >= 1 ? 1 : mult >= 0.8 ? opts.specificity.close : opts.specificity.far) : 1;
    effReps *= specificity;
    const b = body[l];
    const before = sessStim[l], after = before + effReps;
    const sat = (x) => PH.satur * (1 - Math.exp(-x / PH.satur));
    const stim = (sat(after) - sat(before)) * Math.max(0, 1 - (opts.bluntK != null ? opts.bluntK : 4) * b.fat);
    sessStim[l] = after;
    const fatigue = reps * rel * rel * (rpe >= 9.5 ? 1.8 : rpe >= 9 ? 1.35 : rpe >= 8 ? 1.1 : 1) * (mult < 1 ? 0.8 : 1);
    if (opts.structRate) {
      // Slow structural compartment (no decay), the part of adaptation Banister's model leaves out:
      // diminishing with how far this lift already is above where it started toward the ceiling.
      const room = Math.max(0, (PH.ceiling - 1 - b.struct - b.fit) / (PH.ceiling - 1));
      b.struct += opts.structRate * stim * room;
    }
    b.fit += PH.kFit * stim * Math.max(0, (PH.ceiling - 1 - b.fit - b.struct) / (PH.ceiling - 1));
    b.fat += PH.kFat * fatigue / 10;
    if (opts.cross) { const o = l === 'squat' ? 'deadlift' : l === 'deadlift' ? 'squat' : null; if (o) body[o].fat += opts.cross * PH.kFat * fatigue / 10; }
    if (opts.acutePerSet) acute[l] += opts.acutePerSet;
    if (C && rel >= 0.6) {
      const frac = String(exId).startsWith('comp_') ? 1 : mult >= 0.8 ? 0.75 : 0.4; // fractional set counting (Pelland): specific sets count most
      const loadF = C.loadTerm === false ? 1 : Math.max(0.6, Math.min(1.2, 0.6 + (rel - 0.6) / 0.3 * 0.6)); // heavier is more specific to 1RM
      weekDose[l] += frac * loadF;
    }
    M.tonnage += reps * w;
  };
  const GAPS = [1, 2, 1, 3];
  const maxI = opts.weeks ? opts.weeks * 4 : 4000;
  let macrosDone = 0;
  const snapMacro = () => {
    const P = st.program;
    const r = { macro: macrosDone + 1, weeks: week - macroWeekStart, fresh: {}, app: {}, tmPct: st.settings.tmPct, dial: P.volumeDial || 0, learned: JSON.parse(JSON.stringify(st.learned || {})), M };
    for (const l of LIFTS) { r.fresh[l] = capFresh(l); r.app[l] = st.lifts[l].oneRM; }
    macros.push(r); M = newM(); macroWeekStart = week;
  };
  for (let i = 0; i < maxI; i++) {
    if (opts.phAt && st.program.dayIdx === 0 && week === opts.phAt.week) Object.assign(PH, opts.phAt.ph);
    if (opts.weekHook && st.program.dayIdx === 0) opts.weekHook(st, E, week);
    if (opts.reload && st.program.dayIdx === 0) { const again = E.sanitizeState(JSON.parse(JSON.stringify(st)), { trusted: true }); for (const k of Object.keys(st)) delete st[k]; Object.assign(st, again); }
    if (opts.gapAt && !gapDone && st.program.dayIdx === 0 && week === opts.gapAt.week) {
      gapDone = true; dayPass(opts.gapAt.days); gapWeek = week; E.layoffAdjust(st, opts.gapAt.days);
      const t = Date.UTC(2026, 0, 5) + day * 864e5; st.program.chronicSince = t - 1; st.program.calibBaseTs = t - 1;
    }
    const P = st.program, pos = E.position(st);
    for (const l of LIFTS) { sessStim[l] = 0; acute[l] = 0; }
    if (P.dayIdx === 0) week++;
    if (opts.dayCV) for (const l of LIFTS) dayMult[l] = 1 + gauss() / 0.55 * opts.dayCV;
    if (opts.sessBiasSD) sessBias = gauss() / 0.55;
    const f = fatigueLevel();
    const base = (opts.blindReadiness ? 3.8 : 4.3 - 15 * f) + (opts.answerOffset || 0);
    const r = { sleep: Math.round(base + gauss()), energy: Math.round(base + gauss()), soreness: Math.round(opts.blindReadiness ? 2 + gauss() : 1.6 + 14 * f + gauss()), motivation: Math.round(base + gauss() * 0.7) };
    for (const k in r) r[k] = Math.max(1, Math.min(5, r[k]));
    const rs = E.readinessScore(r); M.readinessSum += rs.score;
    if (rs.color === 'red') M.reds++;
    const forced = !!P.lightRestOfWeek;
    let mode = P.lightRestOfWeek ? 'light' : rs.color === 'green' ? 'full' : rs.color === 'yellow' ? 'trim' : 'light';
    if (pos.isDeload || pos.rest) mode = 'full';
    if (mode === 'light') M.lights++; if (mode === 'trim') M.trims = (M.trims || 0) + 1;
    const s = E.buildSession(st, mode);
    Object.assign(s, { id: 's' + i, ts: Date.UTC(2026, 0, 5) + day * 864e5, date: new Date(Date.UTC(2026, 0, 5) + day * 864e5).toISOString().slice(0, 10), readiness: rs, mesoCount: P.mesoCount, blockIdx: P.blockIdx, dayIdx: P.dayIdx, mode, skippedSlots: [] });
    if (!opts.appLike) s.date = '2026-01-01';
    // maxMin/over75: the whole session; maxReq/overReq75: without the optional slots, what the time budget covers (engines before F7 have no required estimate: same figure)
    if (!pos.isDeload && !pos.rest && !pos.isTest) { const req = E.estimateMinutes.length > 1 ? E.estimateMinutes(s, true) : s.estMinutes; M.maxMin = Math.max(M.maxMin, s.estMinutes); if (s.estMinutes > 75) M.over75++; M.maxReq = Math.max(M.maxReq || 0, req); if (req > 75) M.overReq75 = (M.overReq75 || 0) + 1; }
    let worst = 0; const overByEx = [];
    const bk = pos.rest ? 'rest' : pos.isDeload ? 'deload' : pos.isTest ? 'test' : pos.block.id;
    for (const e of s.exercises) {
      if (e.needsWeight && acc[e.ex] == null) acc[e.ex] = 100;
      const work = e.sets.filter(x => x.kind === 'work');
      if (e.lift && e.pctTM != null) e.plannedW = work[0].w;
      const evidence = [];
      let stopped = false; let overSum = 0, overN = 0;
      const sc = (x) => { if (e.lift && E.EX[e.ex].mult >= 0.8 && x.kind === 'work') { const d = M.setsByBlock[bk] = M.setsByBlock[bk] || { squat: 0, bench: 0, deadlift: 0, weekKeys: new Set() }; d[e.lift]++; d.weekKeys.add(week); } };
      for (const x of e.sets) {
        if (stopped && x.kind === 'work') { x.done = false; M.cutSets++; continue; }
        x.done = true;
        if (x.kind === 'warm') { x.actualW = x.w; x.actualReps = x.reps; continue; }
        const testLine = opts.appLike && e.lift && pos.isTest && e.role === 'primary';
        if (!e.lift || (e.pctTM == null && !testLine)) { x.actualW = acc[e.ex]; x.actualReps = x.reps; continue; }
        const mult = E.EX[e.ex].mult;
        let w = x.actualW != null ? x.actualW : x.w;
        if (x.open) { w = Math.round(cap(e.lift) * 0.97 / 5) * 5; }
        if (!(w > 0) || !(cap(e.lift) > 0)) throw new Error('BAD');
        let rpe = rpeFor(e.lift, mult, w, x.reps), reps = x.reps; const rpeBase = Math.min(10, rpe);
        if (rpe > 10) { reps = Math.max(1, x.reps - Math.round(rpe - 10)); rpe = 10; }
        else if (x.ind && x.plus && rpe <= 7.5) { const extra = Math.min(x.plus, Math.round(8 - rpe)); reps = x.reps + extra; rpe = Math.min(10, rpe + extra); trueRpe += extra; }
        x.actualReps = reps; x.rpe = rpe; x.actualW = w;
        if (rpe >= 9.5) M.grinds++;
        train(e.lift, mult, w, reps, opts.trueTrain ? Math.max(0, Math.min(10, trueRpe)) : rpe, e.ex); // trueTrain: stimulus and fatigue from the real effort, not the rating
        sc(x);
        worst = Math.max(worst, rpeBase - (x.rpeTarget || rpeBase)); overSum += rpeBase - (x.rpeTarget || rpeBase); overN++;
        M.rpeOverSum += rpeBase - (x.rpeTarget || rpeBase); M.rpeOverN++;
        if (x.kind === 'work' || x.kind === 'single') { M.relSum += w / (capFresh(e.lift) * mult) ; M.relN++; }
        if (!opts.appLike) {
          if (x.kind === 'work' && !pos.isDeload && !pos.rest && !pos.isTest) {
            evidence.push({ w, reps, rpe, first: work.indexOf(x) === 0 });
            const c = E.liftCorrection(evidence, e.plannedW, work[0].reps, e.rpeTarget);
            if (c) { const tgt = Math.max(45, E.roundTo(c.w, 5)); work.forEach(y => { if (!y.done) y.actualW = tgt; }); }
          }
        } else if ((x.kind === 'work' || x.kind === 'single') && !pos.isDeload && !pos.rest && !pos.isTest) {
          // as recalcExercise runs it: opener counts, misses flagged (the engine's own rule when it has one), Peak ceiling, the fatigue stop cuts the rest
          evidence.push({ w, reps, rpe, first: x === work[0], missed: E.missedSet ? E.missedSet(x) : reps < x.reps, target: x.kind === 'single' ? x.rpeTarget : null, planned: x.reps });
          const C = E.TUNE.correction;
          const up = pos.block.test ? C.ceilPeak : (mode === 'light' && C.ceilLight != null) ? C.ceilLight : C.ceil;
          const c = E.liftCorrection(evidence, e.plannedW, work[0].reps, e.rpeTarget, { down: C.floor, up, inc: st.settings.increment });
          if (c) {
            const tgt = E.correctedLoad ? E.correctedLoad(st, c.w, e.plannedW, up) : E.loadRound(st, c.w); work.forEach(y => { if (!y.done) y.actualW = tgt; });
            if (c.stop && work.some(y => !y.done && y !== x)) { stopped = true; M.stops++; }
          }
        }
      }
      if (stopped) e.sets = e.sets.filter(x => x.done || x.kind !== 'work');
      if (overN) overByEx.push(overSum / overN);
    }
    if (opts.ratingMean) worst = overByEx.length ? Math.max(...overByEx) : 0; // a rating follows the session's overall feel, not its single noisiest set
    s.post = { difficulty: worst >= 2.5 ? 4 : worst >= 1.5 ? 3 : worst <= -1 ? 1 : 2 };
    if (s.post.difficulty >= 3) M.hardSessions++; if (s.post.difficulty === 4) M.crushed++;
    M.sessions++;
    const sorenessNow = { legs: Math.max(1, Math.min(4, Math.round(1 + 12 * f + Math.max(0, gauss())))), push: Math.max(1, Math.min(4, Math.round(1 + 10 * f + Math.max(0, gauss())))), hinge: Math.max(1, Math.min(4, Math.round(1 + 12 * f + Math.max(0, gauss())))) };
    if (opts.appLike) { const last = st.sessions[st.sessions.length - 1]; if (last) last.soreness = sorenessNow; s.soreness = null; } else s.soreness = sorenessNow;
    s.cardio = { min: 45 };
    const beforeRM = {}; for (const l of LIFTS) beforeRM[l] = st.lifts[l].oneRM;
    const cal = E.calibrate(st, s); s.calibrated = true;
    for (const l of LIFTS) { if (st.lifts[l].oneRM > beforeRM[l]) M.calUp++; else if (st.lifts[l].oneRM < beforeRM[l]) M.calDown++; }
    if (forced && mode === 'light') s.forcedLight = true;
    st.sessions.push(s);
    if (rs.color === 'red' && !forced && !pos.isDeload && !pos.rest && !pos.isTest && P.dayIdx < 3 && sessionsOfWeek().filter(x => x.readiness && x.readiness.color === 'red').length >= 2) P.lightRestOfWeek = true;
    const wasLastDay = P.dayIdx === 3;
    let endedMacro = false;
    if (wasLastDay && C) for (const l of LIFTS) {
      const b = body[l], D = weekDose[l];
      b.struct += C.G * (PH.gScale || 1) * (D / (D + C.D50)) * Math.max(0, 1 - (opts.bluntK != null ? opts.bluntK : 4) * b.fat) / (1 + b.struct / C.sM);
      weekDose[l] = 0;
    }
    if (wasLastDay) {
      P.lightRestOfWeek = false;
      const willEndMeso = !pos.rest && P.week >= E.totalWeeks(pos.block);
      if (!pos.rest && !pos.isDeload && !pos.isTest) {
        const before = Object.assign({}, P.setAdj);
        const rv = E.weeklyReview(st, sessionsOfWeek(), sessionsOfMeso()); P.setAdj = rv.setAdj; P.loadAdj = rv.loadAdj; P.flags = rv.flags; if (rv.volumeDial != null) { if (rv.volumeDial !== P.volumeDial) M.dialPath.push(`w${week} ${pos.block.id} ${P.volumeDial || 0}>${rv.volumeDial}`); P.volumeDial = rv.volumeDial; }
        for (const l of LIFTS) { if (rv.setAdj[l] > before[l]) M.setAdds++; else if (rv.setAdj[l] < before[l]) M.setCuts++; }
        if (rv.tmPct != null && rv.tmPct !== st.settings.tmPct) { M.tmPath.push(`w${week} ${st.settings.tmPct}>${rv.tmPct}`); st.settings.tmPct = rv.tmPct; for (const l of LIFTS) E.applyTM(st, l, st.lifts[l].oneRM); }
        if (rv.reasons && rv.reasons.length) { M.reasons = M.reasons || {}; for (const r0 of rv.reasons) { const k = r0.replace(/[0-9]+/g, 'N').replace(/squat|bench|deadlift/g, 'lift').slice(0, 34); M.reasons[k] = (M.reasons[k] || 0) + 1; } }
        if (rv.suggestDeload) { M.deloads++; takeDeload = !(opts.deloadDecline && rnd() < opts.deloadDecline); }
      }
      if (willEndMeso) { const mr = E.mesoReview(st, sessionsOfMeso(), !!pos.block.test); for (const l of LIFTS) if (mr.oneRM[l]) { E.applyTM(st, l, mr.oneRM[l]); if (opts.appLike && pos.block.test) st.lifts[l].est = mr.oneRM[l]; } }
      const fresh = {}, app = {};
      for (const l of LIFTS) { fresh[l] = capFresh(l); app[l] = st.lifts[l].oneRM; M.trackFreshSum[l] += st.lifts[l].oneRM / capFresh(l); M.trackSum[l] += st.lifts[l].oneRM / (capFresh(l) * (1 - body[l].fat / (1 + body[l].fit + body[l].struct))); }
      M.trackN++; M.weeks++;
      weekly.push({ week, block: pos.block.id + (pos.isDeload ? '-D' : pos.isTest ? '-T' : pos.rest ? '-R' : P.week), mv: P.macroPos, fat: LIFTS.map(l => body[l].fat), fresh, app, dial: P.volumeDial || 0, setAdj: Object.assign({}, P.setAdj), tm: st.settings.tmPct, sets: LIFTS.map(l => E.weeklySets(st, l)) });
    }
    const dialBefore = P.volumeDial || 0, tmBefore = st.settings.tmPct, wasMacroPos = P.macroPos;
    const res = E.advanceDay(st);
    if ((P.volumeDial || 0) !== dialBefore) M.dialPath.push(`w${week} ${pos.block.id} clean ${dialBefore}>${P.volumeDial}`);
    if (st.settings.tmPct !== tmBefore) M.tmPath.push(`w${week} clean ${tmBefore}>${st.settings.tmPct}`);
    if (res.stall) { allStall.push({ week, macro: macrosDone + 1, lines: res.stall.lines }); }
    if (res.restDone && P.macroPos === 0 && P.blockIdx === 0 && P.week === 1 && !P.special) endedMacro = true;
    if (takeDeload) { takeDeload = false; E.startDeloadNow(st); st.program.chronicSince = Date.UTC(2026, 0, 5) + day * 864e5; }
    dayPass(GAPS[i % 4]);
    if (endedMacro) { snapMacro(); macrosDone++; if (!opts.weeks && macrosDone >= opts.macros) break; }
  }
  // sim3 end-of-run metric: 10 clean days, then capacity
  if (M.fatN) snapMacro();
  for (let i = 0; i < 10; i++) decayDay();
  for (const l of LIFTS) { dayMult[l] = 1; acute[l] = 0; }
  const endFresh = {}, endCap = {};
  for (const l of LIFTS) { endFresh[l] = capFresh(l); endCap[l] = cap(l); }
  return { gapWeek, macros, weekly, st, body, endFresh, endCap, fresh0, start: START, stalls: allStall, E, weeksRun: week };
}

// ---- lenses ----
const fit0 = { normal: 0.022, fragile: 0.012, robust: 0.027, noisy: 0.022 };
const C_DEF = { G: 0.0016, D50: 4, sM: 0.10, kFitScale: 0.5 };
const lens = {
  legacy: (profile) => ({ profile, peak: true, rng: 'orig' }),
  A: (profile) => ({ profile, peak: true, appLike: true }),
  // Realistic reporting noise (per-set RPE SD ~0.5, session bias SD ~0.3, day capacity CV 2.5%): working values, not measured ones.
  B: (profile) => ({ profile, peak: true, appLike: true, fit0: fit0[profile], C: Object.assign({}, C_DEF), ph: { noise: profile === 'noisy' ? 1.35 : 0.9 }, sessBiasSD: 0.3, dayCV: 0.025, trueTrain: true, ratingMean: true }),
  F: (profile) => Object.assign(lens.B(profile), { stimModel: 'load' }),
};
module.exports = { run, freshEngine, PHS, LIFTS, lens };
if (require.main === module) {
  const [, , engine, profile = 'normal', ln = 'A', weeks = '36', seed = '7'] = process.argv;
  const o = Object.assign(lens[ln](profile), { engine: path.resolve(engine), weeks: Number(weeks), seed: Number(seed) });
  const r = run(o), g = LIFTS.map(l => ((r.endCap[l] / r.fresh0[l] - 1) * 100).toFixed(1) + '%');
  const M = r.macros.reduce((a, m) => { for (const k of ['fatSum', 'fatN', 'overDays', 'deepDays', 'hardSessions', 'crushed', 'grinds', 'deloads', 'stops']) a[k] = (a[k] || 0) + m.M[k]; a.fatPeak = Math.max(a.fatPeak || 0, m.M.fatPeak); return a; }, {});
  console.log(`${profile} ${ln} dial ${r.st.program.volumeDial || 0} tm ${r.st.settings.tmPct} (${g.join(' ')}) | fat mean ${(100 * M.fatSum / M.fatN).toFixed(1)}% peak ${(100 * M.fatPeak).toFixed(1)}% over-line days ${M.overDays} deep ${M.deepDays} | hard ${M.hardSessions} crushed ${M.crushed} grinds ${M.grinds} | deloads ${M.deloads} stops ${M.stops}`);
}
