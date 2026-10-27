// Fitness-fatigue simulation against the CURRENT engine (TUNE, inserted deloads, volume dial, chronic triggers).
// Fatigue F per lift accrues from each set (reps * (w/true)^3 / 40 * costMult), decays tau 8 d. True max =
// base * (1 + gains) - lossPerF * F; gains accrue 0.3%/wk only while F < cap. Felt RPE = table RPE + rpePerF * F
// + noise; reported RPE = felt + bias. Readiness answers, soreness and the post-session rating are driven by F.
// Usage: node sim4.js <engine.js> <normal|fragile|sturdy|overreach> <variant> [bias] [verbose]
require(process.argv[2]); const E = globalThis.Engine;
const profile = process.argv[3] || 'normal', variant = process.argv[4] || 'app', bias = Number(process.argv[5] || 0), verbose = process.argv[6] === 'verbose';
let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const gauss = () => (rnd() + rnd() + rnd() - 1.5) * 1.1;
const st = E.defaultState();
E.applyTM(st, 'squat', 365); E.applyTM(st, 'bench', 255); E.applyTM(st, 'deadlift', 425);
st.settings.includePeak = true; st.setupDone = true;
const base = { squat: 365, bench: 255, deadlift: 425 };
const PF = {
  normal:    { rpePerF: 0.9, lossPerF: 0.04, gain: 0.003, cap: 1.0 },
  fragile:   { rpePerF: 1.6, lossPerF: 0.08, gain: 0.003, cap: 0.8 },
  sturdy:    { rpePerF: 0.6, lossPerF: 0.02, gain: 0.004, cap: 1.3 },
  overreach: { rpePerF: 1.6, lossPerF: 0.10, gain: 0.003, cap: 0.6, costMult: 2.5 },
};
const pf = PF[profile] || PF.normal;
// Variants. 'app' = engine as app.js wires it today (no mesoSessions, dial not applied, week filter keeps deload
// sessions). 'wired' = engine fully wired (mesoSessions passed, dial applied, week filter drops deload sessions and
// sessions before an inserted deload). Others are proposals on top of 'wired'.
const V = {
  app: { app: true },
  wired: {},
  yellowLoad: { yellowLoadF: 0.975 },
  stop: { stop: true },
  trend: { trend: true },
  autoLight: { autoLight: true },
  upSlow: { upSlow: true },             // calibration rises capped at +5% per block after the first block
  allowRiseOnly: { allowRiseOnly: true }, // fatigue allowance applied to the rise test only
  all: { yellowLoadF: 0.975, stop: true, trend: true, autoLight: true, upSlow: true, allowRiseOnly: true },
};
const v = V[variant] || V.wired;
if (process.argv[7]) E.applyTune(process.argv[7]);
if (v.allowRiseOnly) { // monkey-patch: allowance 0 for the drop test by re-running calibrate with allowance only when it would rise
  const orig = E.calibrate;
  E.calibrate = function (state, sess) {
    const a = E.TUNE.calibrate.allowance; E.TUNE.calibrate.allowance = 0;
    const snap = JSON.parse(JSON.stringify(state.lifts));
    const log = orig(state, sess);
    E.TUNE.calibrate.allowance = a;
    // if nothing dropped, re-run with allowance from the snapshot to let rises through
    const dropped = ['squat', 'bench', 'deadlift'].some(l => state.lifts[l].oneRM < snap[l].oneRM);
    if (!dropped) { state.lifts = snap; return orig(state, sess); }
    return log;
  };
}
let F = { squat: 0, bench: 0, deadlift: 0 }, lastTs = null, week = 0, gainAcc = { squat: 0, bench: 0, deadlift: 0 };
const truth = (l) => Math.max(0.6, 1 + gainAcc[l] - pf.lossPerF * F[l]) * base[l];
const acc = { belt_squat: 135, leg_curl: 90, lat_pulldown: 120, low_row: 120, leg_ext: 100, tri_pushdown: 50, db_curl: 30, face_pull: 40, lateral_raise: 15 };
let lastDeloadTs = -1;
const sessionsOfWeek = () => st.sessions.filter(s => s.mesoCount === st.program.mesoCount && s.week === st.program.week && s.blockIdx === st.program.blockIdx && !s.isRest && (v.app || (!s.isDeload && s.ts > lastDeloadTs)));
const sessionsOfMeso = () => st.sessions.filter(s => s.mesoCount === st.program.mesoCount && s.blockIdx === st.program.blockIdx && !s.isRest && (v.app || (!s.isDeload && s.ts > lastDeloadTs)));
const log = [], track = [];
const stats = { sessions: 0, light: 0, trim: 0, reds: 0, yellows: 0, deloads: 0, over2: 0, misses: 0, crushed: 0, peakF: 0, sets: 0, stops: 0, autoLight: 0, dialMin: 0, dialMax: 0, upCal: 0, downCal: 0, deloadWeeks: 0 };
let lightBlock = false; const weekHist = []; let blockUpPct = {}; let blockRef = {};
function stressOf(reps, wNorm, l) { const r = wNorm / truth(l); return reps * Math.pow(r, 3); }
for (let i = 0; i < 26 * 4; i++) {
  const P = st.program, pos = E.position(st);
  if (P.dayIdx === 0) { week++; if (pos.isDeload || pos.rest) { lightBlock = false; stats.deloadWeeks++; } for (const l in gainAcc) if (F[l] < pf.cap) gainAcc[l] += pf.gain; }
  const ts = i * 1.75;
  if (lastTs != null) for (const l in F) F[l] *= Math.exp(-(ts - lastTs) / 8);
  lastTs = ts;
  const Fmean = (F.squat + F.bench + F.deadlift) / 3;
  const r = { sleep: 3.4 - 0.8 * Fmean + gauss() * 0.9, energy: 3.5 - 1.2 * Fmean + gauss() * 0.9, soreness: 2.2 + 1.3 * Fmean + gauss() * 0.9, motivation: 3.5 - 0.8 * Fmean + gauss() * 0.6 };
  for (const k in r) r[k] = Math.max(1, Math.min(5, Math.round(r[k])));
  const rs = E.readinessScore(r);
  if (rs.color === 'red') stats.reds++; if (rs.color === 'yellow') stats.yellows++;
  let mode = (P.lightRestOfWeek || lightBlock) ? 'light' : rs.color === 'green' ? 'full' : rs.color === 'yellow' ? 'trim' : 'light';
  if (pos.isDeload || pos.rest) mode = 'full';
  // app.js: a second red in the week switches the rest of the week to light
  if (rs.color === 'red' && !pos.isDeload && !pos.rest && P.dayIdx < 3 && !P.lightRestOfWeek) { const redsWk = sessionsOfWeek().filter(s => s.readiness && s.readiness.color === 'red').length + 1; if (redsWk >= 2) P.lightRestOfWeek = true; }
  const s = E.buildSession(st, mode);
  if (mode === 'light') stats.light++; if (mode === 'trim') stats.trim++;
  Object.assign(s, { id: 's' + i, ts, date: '2026-01-01', readiness: rs, mesoCount: P.mesoCount, blockIdx: P.blockIdx, dayIdx: P.dayIdx, mode, skippedSlots: [] });
  let worst = 0;
  for (const e of s.exercises) {
    if (e.needsWeight && acc[e.ex] == null) acc[e.ex] = 100;
    const work = e.sets.filter(x => x.kind === 'work');
    if (e.lift && e.pctTM != null) {
      e.plannedW = work[0].w;
      if (v.yellowLoadF && mode === 'trim' && !pos.isDeload && !pos.rest && !pos.isTest) {
        const w2 = E.roundTo(work[0].w * v.yellowLoadF, 5); work.forEach(y => y.w = w2); e.plannedW = w2;
        e.rpeTarget = Math.max(5, e.rpeTarget - 0.5); work.forEach(y => y.rpeTarget = e.rpeTarget);
      }
    }
    const evidence = []; let stopped = false;
    e.sets.forEach((x) => {
      if (stopped) { x.done = false; return; }
      x.done = true;
      if (x.kind === 'warm') { x.actualW = x.w; x.actualReps = x.reps; return; }
      const mult = E.EX[e.ex].mult;
      let w = x.actualW != null ? x.actualW : x.w;
      if (!e.lift || e.pctTM == null || !(mult > 0)) { x.actualW = acc[e.ex]; x.actualReps = x.reps; x.rpe = 8; stats.sets++; return; }
      if (x.open) { w = Math.round(truth(e.lift) * 0.97 / 5) * 5; x.actualW = w; }
      const t = truth(e.lift) * mult; const rtf = E.rtfForPct(w / t);
      let felt = 10 - (rtf - x.reps) + pf.rpePerF * F[e.lift] + gauss() * 0.4;
      let reps = x.reps;
      if (felt > 10) { reps = Math.max(1, x.reps - Math.round(felt - 10)); felt = 10; stats.misses++; }
      else if (x.ind && x.plus && felt <= 7.5) { reps = x.reps + Math.min(x.plus, Math.round(8 - felt)); felt = Math.min(10, felt + (reps - x.reps)); }
      let rpe = Math.max(5, Math.min(10, Math.round((felt + bias) * 2) / 2)); if (reps < x.reps) rpe = 10;
      x.actualReps = reps; x.rpe = rpe; x.actualW = w; stats.sets++;
      F[e.lift] += stressOf(reps, w / mult, e.lift) * (mult === 1 ? 1 : 0.6) / 40 * (pf.costMult || 1);
      const over = rpe - Math.max(0, reps - x.reps) - (x.rpeTarget || rpe); worst = Math.max(worst, over); if (over >= 2) stats.over2++;
      if (x.kind === 'work' && !pos.isDeload && !pos.rest && !pos.isTest) {
        const first = work.indexOf(x) === 0;
        evidence.push({ w, reps, rpe, first });
        const c = E.liftCorrection(evidence, e.plannedW, work[0].reps, e.rpeTarget);
        if (c) { const tgt = Math.max(45, E.roundTo(c.w, 5)); work.forEach(y => { if (!y.done) y.actualW = tgt; }); }
        if (v.stop && (reps < x.reps || (!first && over >= 2))) { stopped = true; stats.stops++; }
      }
    });
  }
  stats.sessions++;
  s.post = { difficulty: worst >= 2.5 ? 4 : worst >= 1.5 ? 3 : worst <= -1 ? 1 : 2 }; if (s.post.difficulty === 4) stats.crushed++;
  const sore = (l) => Math.max(1, Math.min(4, Math.round(1 + 1.6 * F[l] + Math.max(0, gauss()) * 0.5)));
  s.soreness = { legs: sore('squat'), push: sore('bench'), hinge: sore('deadlift') };
  // per-block cap on calibration rises (proposal)
  const before = { squat: st.lifts.squat.oneRM, bench: st.lifts.bench.oneRM, deadlift: st.lifts.deadlift.oneRM };
  const cal = E.calibrate(st, s); s.calibrated = true; if (cal.length) log.push(`  w${week} [cal] ` + cal.join(' | '));
  for (const l of ['squat', 'bench', 'deadlift']) {
    if (st.lifts[l].oneRM > before[l]) { stats.upCal++; if (v.upSlow && P.mesoCount > 0) { const ref = blockRef[l] || before[l]; const cap = E.roundTo(ref * 1.05, 2.5); if (st.lifts[l].oneRM > cap) E.applyTM(st, l, Math.max(before[l], cap)); } }
    if (st.lifts[l].oneRM < before[l]) stats.downCal++;
  }
  s.implied = {}; for (const l of ['squat', 'bench', 'deadlift']) { const r2 = E.sessionEstimate(s, l, st.lifts[l].oneRM); if (r2) s.implied[l] = r2.est; }
  st.sessions.push(s);
  stats.peakF = Math.max(stats.peakF, Fmean);
  if (P.dayIdx === 3) {
    const willEndMeso = !pos.rest && !pos.inserted && P.week >= E.totalWeeks(pos.block);
    if (!pos.rest && !pos.isDeload && !pos.isTest) {
      const ws = sessionsOfWeek(); const prevFlags = Object.assign({}, P.flags);
      const rv = v.app ? E.weeklyReview(st, ws) : E.weeklyReview(st, ws, sessionsOfMeso());
      P.setAdj = rv.setAdj; P.loadAdj = rv.loadAdj; P.flags = rv.flags; if (!v.app) P.volumeDial = rv.volumeDial;
      log.push(...rv.log.map(l => `  w${week} [${pos.block.id} ${P.week}] ${l}`));
      const wkMean = {}, rpeOver = {};
      for (const l of ['squat', 'bench', 'deadlift']) {
        const vals = ws.filter(x => x.implied && x.implied[l] && x.mode !== 'light').map(x => x.implied[l]); wkMean[l] = vals.length ? vals.reduce((a, b) => a + b) / vals.length : null;
        const d = []; for (const x of ws) for (const e of x.exercises) if (e.lift === l && e.role === 'primary') for (const y of e.sets) if (y.kind === 'work' && y.done && y.rpe != null) d.push(y.rpe - Math.max(0, (y.actualReps != null ? y.actualReps : y.reps) - y.reps) - y.rpeTarget);
        rpeOver[l] = d.length ? d.reduce((a, b) => a + b) / d.length : null;
      }
      weekHist.push({ block: pos.block.id, meso: P.mesoCount, week: P.week, wkMean, rpeOver, flags: Object.assign({}, rv.flags), prevFlags });
      let suggest = rv.suggestDeload;
      const a = weekHist[weekHist.length - 2], b = weekHist[weekHist.length - 1];
      if (v.trend && a && a.meso === b.meso && P.week < pos.block.weeks) {
        const decl = ['squat', 'bench', 'deadlift'].filter(l => a.wkMean[l] && b.wkMean[l] && b.wkMean[l] < a.wkMean[l] * 0.97).length;
        const hot = ['squat', 'bench', 'deadlift'].filter(l => a.rpeOver[l] != null && b.rpeOver[l] != null && a.rpeOver[l] >= 1 && b.rpeOver[l] >= 1).length;
        if (decl >= 2 || hot >= 2) { suggest = true; log.push(`  w${week} [trend] deload: declining ${decl}, hot ${hot}`); }
      }
      if (v.autoLight && !suggest && a && a.meso === b.meso && P.week < pos.block.weeks) {
        const twice = ['squat', 'bench', 'deadlift'].filter(l => b.flags[l] >= 2 && prevFlags[l] >= 1 && b.flags[l] > prevFlags[l]).length;
        if (twice >= 1 && !lightBlock) { lightBlock = true; stats.autoLight++; log.push(`  w${week} [autoLight] rest of block light`); }
      }
      if (suggest) { stats.deloads++; log.push(`  >> deload suggested (${rv.reasons.join('; ')}), taken`); }
      // advance first (as the app does: review runs after the week closes), then insert the deload
      E.advanceDay(st);
      if (suggest) { E.startDeloadNow(st); lastDeloadTs = ts; if (!v.app) { P.calibDrops = {}; } }
      if (willEndMeso) { /* not reachable here: last week has no review */ }
      stats.dialMin = Math.min(stats.dialMin, P.volumeDial || 0); stats.dialMax = Math.max(stats.dialMax, P.volumeDial || 0);
      track.push({ week, block: pos.block.id + P.week, F: Fmean.toFixed(2), rs: rs.score, dial: P.volumeDial || 0, squat: [st.lifts.squat.oneRM, Math.round(truth('squat'))], bench: [st.lifts.bench.oneRM, Math.round(truth('bench'))], deadlift: [st.lifts.deadlift.oneRM, Math.round(truth('deadlift'))], sets: E.weeklySets(st, 'squat') + '/' + E.weeklySets(st, 'bench') + '/' + E.weeklySets(st, 'deadlift') });
      continue;
    }
    if (willEndMeso) { const mr = E.mesoReview(st, sessionsOfMeso(), !!pos.block.test); for (const l of ['squat', 'bench', 'deadlift']) if (mr.oneRM[l]) E.applyTM(st, l, mr.oneRM[l]); log.push(...mr.log.map(l => `  w${week} [${pos.block.id} END] ${l}`)); }
    track.push({ week, block: pos.block.id + (pos.inserted ? '-iD' : pos.isDeload ? '-D' : pos.isTest ? '-T' : pos.rest ? '-R' : P.week), F: Fmean.toFixed(2), rs: rs.score, dial: P.volumeDial || 0, squat: [st.lifts.squat.oneRM, Math.round(truth('squat'))], bench: [st.lifts.bench.oneRM, Math.round(truth('bench'))], deadlift: [st.lifts.deadlift.oneRM, Math.round(truth('deadlift'))], sets: E.weeklySets(st, 'squat') + '/' + E.weeklySets(st, 'bench') + '/' + E.weeklySets(st, 'deadlift') });
    const res = E.advanceDay(st);
    if (res.mesoDone) { for (const l of ['squat', 'bench', 'deadlift']) blockRef[l] = st.lifts[l].oneRM; }
    continue;
  }
  E.advanceDay(st);
}
if (verbose) { console.log(log.join('\n')); for (const t of track) console.log(`w${String(t.week).padStart(2)} ${t.block.padEnd(11)} F=${t.F} rs=${String(t.rs).padStart(3)} dial ${String(t.dial).padStart(2)} sets ${t.sets.padEnd(8)} S ${t.squat[0]}/${t.squat[1]}  B ${t.bench[0]}/${t.bench[1]}  D ${t.deadlift[0]}/${t.deadlift[1]}`); }
const last = track[track.length - 1];
const trueGain = ['squat', 'bench', 'deadlift'].map(l => ((last[l][1] / base[l] - 1) * 100).toFixed(1) + '%').join(' ');
const appErr = ['squat', 'bench', 'deadlift'].map(l => ((last[l][0] / last[l][1] - 1) * 100).toFixed(1) + '%').join(' ');
console.log(`${profile.padEnd(9)} ${variant.padEnd(13)} bias ${String(bias).padEnd(4)} | gain ${trueGain} | err ${appErr} | peakF ${stats.peakF.toFixed(2)} | light ${String(stats.light).padStart(2)} trim ${String(stats.trim).padStart(2)} reds ${String(stats.reds).padStart(2)} | deloads ${stats.deloads} dlWks ${stats.deloadWeeks} autoL ${stats.autoLight} dial ${stats.dialMin}..${stats.dialMax} | miss ${String(stats.misses).padStart(3)} over2 ${String(stats.over2).padStart(3)} crushed ${String(stats.crushed).padStart(2)} stops ${String(stats.stops).padStart(2)} | cal +${stats.upCal} -${stats.downCal} | sets ${stats.sets}`);
