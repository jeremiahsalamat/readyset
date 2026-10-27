// 26-week simulation with a hidden "true" 1RM per lift. RPE on each set comes from the rep-max
// table at (weight / true max), plus in-block fatigue and reporting noise. The in-session
// correction and the between-session calibration both run, mirroring app.js. The question: do the
// app's maxes track the true ones without ratcheting down, and does training stay sane?
require(process.argv[2]);
const E = globalThis.Engine;
let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const gauss = () => (rnd() + rnd() + rnd() - 1.5) * 1.1;
const profile = process.argv[3] || 'normal';
const st = E.defaultState();
E.applyTM(st, 'squat', 365); E.applyTM(st, 'bench', 255); E.applyTM(st, 'deadlift', 425);
st.settings.includePeak = true; st.setupDone = true;
// True maxes: the entered numbers are 5% high for 'overestimated', right for 'normal', 6% low for 'sandbagged'.
const f0 = profile === 'overestimated' ? 0.94 : profile === 'sandbagged' ? 1.06 : 1.0;
const truth = { squat: 365 * f0, bench: 255 * f0, deadlift: 425 * f0 };
const gainPerWeek = profile === 'nonresponder' ? 0.000 : 0.003; // ~0.3% per week of real strength gain
const fatigueRPE = profile === 'fragile' ? 1.2 : 0.7; // extra RPE by the last week of a block
const noise = profile === 'noisy' ? 0.8 : 0.4;
const acc = { belt_squat: 135, leg_curl: 90, lat_pulldown: 120, low_row: 120, leg_ext: 100, tri_pushdown: 50, db_curl: 30, face_pull: 40, lateral_raise: 15 };
const sessionsOfWeek = () => st.sessions.filter(s => s.mesoCount === st.program.mesoCount && s.week === st.program.week && s.blockIdx === st.program.blockIdx && !s.isRest);
const sessionsOfMeso = () => st.sessions.filter(s => s.mesoCount === st.program.mesoCount && s.blockIdx === st.program.blockIdx && !s.isRest);
const log = [], track = [];
let week = 0;
function rpeFor(lift, mult, w, reps, wk, weeks) {
  const t = truth[lift] * mult;
  const rtf = E.rtfForPct(w / t);
  const fat = weeks > 1 ? fatigueRPE * (wk - 1) / (weeks - 1) : 0;
  let rpe = 10 - (rtf - reps) + fat + gauss() * noise;
  return Math.max(5, Math.min(10.5, Math.round(rpe * 2) / 2));
}
for (let i = 0; i < 26 * 4; i++) {
  const P = st.program, pos = E.position(st);
  if (P.dayIdx === 0) { week++; for (const l in truth) truth[l] *= 1 + gainPerWeek; }
  const r = { sleep: 3 + Math.round(gauss()), energy: 3 + Math.round(gauss()), soreness: 3 - Math.round(gauss()), motivation: 3 + Math.round(gauss() * 0.5) };
  for (const k in r) r[k] = Math.max(1, Math.min(5, r[k]));
  const rs = E.readinessScore(r);
  let mode = P.lightRestOfWeek ? 'light' : rs.color === 'green' ? 'full' : rs.color === 'yellow' ? 'trim' : 'light';
  if (pos.isDeload || pos.rest) mode = 'full';
  const s = E.buildSession(st, mode);
  Object.assign(s, { id: 's' + i, ts: Date.UTC(2026, 0, 5) + i * 1.75 * 864e5, date: '2026-01-01', readiness: rs, mesoCount: P.mesoCount, blockIdx: P.blockIdx, dayIdx: P.dayIdx, mode, skippedSlots: [] });
  const blk = E.BLOCKS[P.blockIdx];
  let worst = 0;
  for (const e of s.exercises) {
    if (e.needsWeight && acc[e.ex] == null) acc[e.ex] = 100;
    const work = e.sets.filter(x => x.kind === 'work');
    if (e.lift && e.pctTM != null) e.plannedW = work[0].w;
    const evidence = [];
    e.sets.forEach((x, idx) => {
      x.done = true;
      if (x.kind === 'warm') { x.actualW = x.w; x.actualReps = x.reps; return; }
      const mult = E.EX[e.ex].mult;
      let w = x.actualW != null ? x.actualW : x.w;
      if (!e.lift) { x.actualW = acc[e.ex]; x.actualReps = x.reps; return; }
      if (x.open) { w = Math.round(truth[e.lift] * 0.97 / 5) * 5; x.actualW = w; }
      const wk = pos.isDeload || pos.isTest ? blk.weeks : Math.min(P.week, blk.weeks);
      let rpe = rpeFor(e.lift, mult, w, x.reps, pos.rest ? 1 : wk, blk.weeks);
      let reps = x.reps;
      if (rpe > 10) { reps = Math.max(1, x.reps - Math.round(rpe - 10)); rpe = 10; }
      else if (x.ind && x.plus && rpe <= 7.5) { reps = x.reps + Math.min(x.plus, Math.round(8 - rpe)); rpe = Math.min(10, rpe + (reps - x.reps)); }
      x.actualReps = reps; x.rpe = rpe; x.actualW = w;
      worst = Math.max(worst, rpe - (x.rpeTarget || rpe));
      // in-session correction, as app.js does it
      if (x.kind === 'work' && e.lift && !pos.isDeload && !pos.rest && !pos.isTest) {
        const first = work.indexOf(x) === 0;
        evidence.push({ w, reps, rpe, first });
        const c = E.liftCorrection(evidence, e.plannedW, work[0].reps, e.rpeTarget);
        if (c) { const tgt = Math.max(45, E.roundTo(c.w, 5)); work.forEach(y => { if (!y.done) y.actualW = tgt; }); }
      }
    });
  }
  s.post = { difficulty: worst >= 2.5 ? 4 : worst >= 1.5 ? 3 : worst <= -1 ? 1 : 2 };
  s.soreness = { legs: 1 + Math.round(Math.max(0, gauss())), push: 1 + Math.round(Math.max(0, gauss())), hinge: 1 + Math.round(Math.max(0, gauss())) };
  s.cardio = { min: 45 };
  const cal = E.calibrate(st, s); s.calibrated = true; if (cal.length) log.push(`  w${week} [cal] ` + cal.join(' | '));
  st.sessions.push(s);
  const wasLastDay = P.dayIdx === 3;
  if (wasLastDay) {
    P.lightRestOfWeek = false;
    const willEndMeso = !pos.rest && P.week >= E.totalWeeks(pos.block);
    if (!pos.rest && !pos.isDeload && !pos.isTest) { const rv = E.weeklyReview(st, sessionsOfWeek()); P.setAdj = rv.setAdj; P.loadAdj = rv.loadAdj; P.flags = rv.flags; log.push(...rv.log.map(l => `  w${week} [${pos.block.id} ${P.week}] ${l}`)); if (rv.suggestDeload) { log.push('  >> deload suggested, taken'); E.startDeloadNow(st); P.dayIdx = 3; } }
    if (willEndMeso) { const mr = E.mesoReview(st, sessionsOfMeso(), !!pos.block.test); for (const l of ['squat', 'bench', 'deadlift']) if (mr.oneRM[l]) E.applyTM(st, l, mr.oneRM[l]); log.push(...mr.log.map(l => `  w${week} [${pos.block.id} END] ${l}`)); }
    track.push({ week, block: pos.block.id + (pos.isDeload ? '-D' : pos.isTest ? '-T' : pos.rest ? '-R' : P.week), squat: [st.lifts.squat.oneRM, Math.round(truth.squat)], bench: [st.lifts.bench.oneRM, Math.round(truth.bench)], deadlift: [st.lifts.deadlift.oneRM, Math.round(truth.deadlift)] });
  }
  E.advanceDay(st);
}
if (process.argv[4] === 'verbose') console.log(log.join('\n'));
console.log(`profile=${profile}  (app 1RM / true 1RM) by week`);
for (const t of track) console.log(`w${String(t.week).padStart(2)} ${t.block.padEnd(10)} S ${t.squat[0]}/${t.squat[1]}  B ${t.bench[0]}/${t.bench[1]}  D ${t.deadlift[0]}/${t.deadlift[1]}`);
const last = track[track.length - 1];
const err = ['squat', 'bench', 'deadlift'].map(l => ((last[l][0] / last[l][1] - 1) * 100).toFixed(1) + '%').join(' ');
console.log('final app-vs-true error:', err, '| calibrations:', log.filter(l => l.includes('[cal]')).length, '| deloads suggested:', log.filter(l => l.includes('>> deload')).length);
