// Fitness-fatigue simulation of the Readyset engine over many weeks.
//
// Each lift has a hidden base strength, a fitness term (slow, built by stimulating sets) and a
// fatigue term (fast, built by volume x intensity, worse near failure). True capacity on a given
// day = base x (1 + fitness - fatigue). RPE on every set comes from the rep-max table at
// weight / capacity, plus reporting noise. Readiness answers follow the fatigue level. The app's
// own logic (check-in modes, in-session correction, calibration, weekly review, deloads) runs
// exactly as app.js runs it. Output: strength gained, time spent over the fatigue line, hard
// sessions, deloads taken, injuries (a penalty drawn while deeply over the line).
//
// Usage: node sim3.js <engine.js> [profile] [variant] [weeks] [seed] [verbose]
//   profile: normal | fragile | robust | noisy
//   variant: baseline | <name handled below> (engine tables are patched before the run)
require(process.argv[2]);
const E = globalThis.Engine;
const profile = process.argv[3] || 'normal';
const variant = process.argv[4] || 'baseline';
const WEEKS = Number(process.argv[5] || 36);
let seed = Number(process.argv[6] || 7);
const verbose = process.argv[7] === 'verbose';
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const gauss = () => (rnd() + rnd() + rnd() - 1.5) * 1.1;

// ---- physiology ----
const PH = {
  normal:  { tauFit: 42, tauFat: 9,  kFit: 0.0022, kFat: 0.0115, noise: 0.45, ceiling: 1.35, satur: 12 },
  fragile: { tauFit: 42, tauFat: 14, kFit: 0.0019, kFat: 0.0160, noise: 0.45, ceiling: 1.30, satur: 10 },
  robust:  { tauFit: 42, tauFat: 7,  kFit: 0.0025, kFat: 0.0085, noise: 0.45, ceiling: 1.40, satur: 14 },
  noisy:   { tauFit: 42, tauFat: 9,  kFit: 0.0022, kFat: 0.0115, noise: 0.90, ceiling: 1.35, satur: 12 },
}[profile];
// Per-session stimulus saturates (first effective reps count most) and fatigue blunts adaptation;
// deep over the line, fitness is lost (the book's net-negative overreaching).
const sessStim = { squat: 0, bench: 0, deadlift: 0 };
const LIFTS = ['squat', 'bench', 'deadlift'];
const body = {};
for (const l of LIFTS) body[l] = { base: { squat: 365, bench: 255, deadlift: 425 }[l], fit: 0, fat: 0 };
const cap = (l) => body[l].base * (1 + body[l].fit - body[l].fat);
const fatigueLevel = () => Math.max(...LIFTS.map(l => body[l].fat));

// ---- app state ----
const st = E.defaultState();
E.applyTM(st, 'squat', 365); E.applyTM(st, 'bench', 255); E.applyTM(st, 'deadlift', 425);
st.settings.includePeak = true; st.setupDone = true;
if (typeof applyVariant === 'function') applyVariant(E, st, variant);
const acc = { belt_squat: 135, leg_curl: 90, lat_pulldown: 120, low_row: 120, leg_ext: 100, tri_pushdown: 50, db_curl: 30, face_pull: 40, lateral_raise: 15 };
const sessionsOfWeek = () => st.sessions.filter(s => s.mesoCount === st.program.mesoCount && s.week === st.program.week && s.blockIdx === st.program.blockIdx && !s.isRest);
const sessionsOfMeso = () => st.sessions.filter(s => s.mesoCount === st.program.mesoCount && s.blockIdx === st.program.blockIdx && !s.isRest);

const M = { fatSum: 0, fatPeak: 0, fatN: 0, overDays: 0, deepDays: 0, hardSessions: 0, crushed: 0, deloadsSuggested: 0, injuries: 0, reds: 0, lightSessions: 0, sessions: 0, grindSets: 0, readinessSum: 0 };
let day = 0, week = 0, takeDeload = false;
const log = [], track = [];
function decayDay() { for (const l of LIFTS) { body[l].fit *= Math.exp(-1 / PH.tauFit); body[l].fat *= Math.exp(-1 / PH.tauFat); } }
function dayPass(n) { for (let i = 0; i < n; i++) { decayDay(); day++; const f = fatigueLevel(); M.fatSum += f; M.fatN++; M.fatPeak = Math.max(M.fatPeak, f); if (f > 0.08) M.overDays++; if (f > 0.14) { M.deepDays++; for (const l of LIFTS) body[l].fit -= 0.0015; if (rnd() < 0.02) { M.injuries++; for (const l of LIFTS) body[l].fit -= 0.03; } } } }
function rpeFor(l, mult, w, reps) {
  const rtf = E.rtfForPct(w / (cap(l) * mult));
  const rpe = 10 - (rtf - reps) + gauss() * PH.noise;
  return Math.max(5, Math.min(11, Math.round(rpe * 2) / 2));
}
function train(l, mult, w, reps, rpe) {
  const rel = w / (cap(l) * mult);
  const rir = Math.max(0, 10 - rpe);
  const effReps = rel >= 0.6 ? Math.max(0, Math.min(reps, 5) - Math.max(0, rir - 1)) * (0.5 + 0.7 * Math.min(1, rel)) : 0;
  const b = body[l];
  // saturating per-session stimulus: marginal value falls once ~satur effective reps are banked
  const before = sessStim[l], after = before + effReps;
  const sat = (x) => PH.satur * (1 - Math.exp(-x / PH.satur));
  const stim = (sat(after) - sat(before)) * Math.max(0, 1 - 4 * b.fat); // fatigue blunts adaptation
  sessStim[l] = after;
  const fatigue = reps * rel * rel * (rpe >= 9.5 ? 1.8 : rpe >= 9 ? 1.35 : rpe >= 8 ? 1.1 : 1) * (mult < 1 ? 0.8 : 1);
  b.fit += PH.kFit * stim * Math.max(0, (PH.ceiling - 1 - b.fit) / (PH.ceiling - 1));
  b.fat += PH.kFat * fatigue / 10;
}
// Training days: Mon Tue Thu Fri -> gaps 1,2,1,3
const GAPS = [1, 2, 1, 3];
for (let i = 0; i < WEEKS * 4; i++) {
  const P = st.program, pos = E.position(st);
  for (const l of LIFTS) sessStim[l] = 0;
  if (P.dayIdx === 0) week++;
  const f = fatigueLevel();
  // readiness answers track fatigue (and noise); soreness rises with fatigue
  const base = 4.3 - 15 * f;
  const r = { sleep: Math.round(base + gauss()), energy: Math.round(base + gauss()), soreness: Math.round(1.6 + 14 * f + gauss()), motivation: Math.round(base + gauss() * 0.7) };
  for (const k in r) r[k] = Math.max(1, Math.min(5, r[k]));
  const rs = E.readinessScore(r); M.readinessSum += rs.score;
  if (rs.color === 'red') M.reds++;
  let mode = P.lightRestOfWeek ? 'light' : rs.color === 'green' ? 'full' : rs.color === 'yellow' ? 'trim' : 'light';
  if (pos.isDeload || pos.rest) mode = 'full';
  if (mode === 'light') M.lightSessions++;
  const s = E.buildSession(st, mode);
  Object.assign(s, { id: 's' + i, ts: Date.UTC(2026, 0, 5) + day * 864e5, date: '2026-01-01', readiness: rs, mesoCount: P.mesoCount, blockIdx: P.blockIdx, dayIdx: P.dayIdx, mode, skippedSlots: [] });
  const blk = E.BLOCKS[P.blockIdx];
  let worst = 0;
  for (const e of s.exercises) {
    if (e.needsWeight && acc[e.ex] == null) acc[e.ex] = 100;
    const work = e.sets.filter(x => x.kind === 'work');
    if (e.lift && e.pctTM != null) e.plannedW = work[0].w;
    const evidence = [];
    for (const x of e.sets) {
      x.done = true;
      if (x.kind === 'warm') { x.actualW = x.w; x.actualReps = x.reps; continue; }
      if (!e.lift || e.pctTM == null) { x.actualW = acc[e.ex]; x.actualReps = x.reps; continue; }
      const mult = E.EX[e.ex].mult;
      let w = x.actualW != null ? x.actualW : x.w;
      if (x.open) { w = Math.round(cap(e.lift) * 0.97 / 5) * 5; }
      if (!(w > 0) || !(cap(e.lift) > 0)) { console.log('BAD', week, e.ex, x.kind, 'w=', w, 'cap=', cap(e.lift), JSON.stringify(body[e.lift])); process.exit(2); }
      let rpe = rpeFor(e.lift, mult, w, x.reps), reps = x.reps; const rpeBase = Math.min(10, rpe);
      if (rpe > 10) { reps = Math.max(1, x.reps - Math.round(rpe - 10)); rpe = 10; }
      else if (x.ind && x.plus && rpe <= 7.5) { const extra = Math.min(x.plus, Math.round(8 - rpe)); reps = x.reps + extra; rpe = Math.min(10, rpe + extra); }
      x.actualReps = reps; x.rpe = rpe; x.actualW = w;
      if (rpe >= 9.5) M.grindSets++;
      train(e.lift, mult, w, reps, rpe);
      worst = Math.max(worst, rpeBase - (x.rpeTarget || rpeBase));
      if (x.kind === 'work' && !pos.isDeload && !pos.rest && !pos.isTest) {
        evidence.push({ w, reps, rpe, first: work.indexOf(x) === 0 });
        const c = E.liftCorrection(evidence, e.plannedW, work[0].reps, e.rpeTarget);
        if (c) { const tgt = Math.max(45, E.roundTo(c.w, 5)); work.forEach(y => { if (!y.done) y.actualW = tgt; }); }
      }
    }
  }
  s.post = { difficulty: worst >= 2.5 ? 4 : worst >= 1.5 ? 3 : worst <= -1 ? 1 : 2 };
  if (s.post.difficulty >= 3) M.hardSessions++; if (s.post.difficulty === 4) M.crushed++;
  M.sessions++;
  s.soreness = { legs: Math.max(1, Math.min(4, Math.round(1 + 12 * f + Math.max(0, gauss())))), push: Math.max(1, Math.min(4, Math.round(1 + 10 * f + Math.max(0, gauss())))), hinge: Math.max(1, Math.min(4, Math.round(1 + 12 * f + Math.max(0, gauss())))) };
  s.cardio = { min: 45 };
  const cal = E.calibrate(st, s); s.calibrated = true; if (cal.length && verbose) log.push(`w${week} [cal] ` + cal.join(' | '));
  st.sessions.push(s);
  const wasLastDay = P.dayIdx === 3;
  if (wasLastDay) {
    P.lightRestOfWeek = false;
    const willEndMeso = !pos.rest && P.week >= E.totalWeeks(pos.block);
    if (!pos.rest && !pos.isDeload && !pos.isTest) {
      const rv = E.weeklyReview(st, sessionsOfWeek(), sessionsOfMeso()); P.setAdj = rv.setAdj; P.loadAdj = rv.loadAdj; P.flags = rv.flags; if (rv.volumeDial != null) P.volumeDial = rv.volumeDial;
      if (verbose) log.push(...rv.log.map(l => `w${week} [${pos.block.id} ${P.week}] ${l}`));
      if (rv.tmPct != null && rv.tmPct !== st.settings.tmPct) { st.settings.tmPct = rv.tmPct; for (const l of LIFTS) E.applyTM(st, l, st.lifts[l].oneRM); }
      if (rv.suggestDeload) { M.deloadsSuggested++; if (verbose) log.push('>> deload suggested, taken'); takeDeload = true; }
    }
    if (willEndMeso) { const mr = E.mesoReview(st, sessionsOfMeso(), !!pos.block.test); for (const l of LIFTS) if (mr.oneRM[l]) E.applyTM(st, l, mr.oneRM[l]); }
    track.push({ week, block: pos.block.id + (pos.isDeload ? '-D' : pos.isTest ? '-T' : pos.rest ? '-R' : P.week), fat: fatigueLevel(), caps: LIFTS.map(l => Math.round(cap(l))), app: LIFTS.map(l => st.lifts[l].oneRM) });
  }
  E.advanceDay(st);
  if (takeDeload) { takeDeload = false; E.startDeloadNow(st); st.program.chronicSince = Date.UTC(2026, 0, 5) + day * 864e5; }
  dayPass(GAPS[i % 4]);
}
if (verbose) { console.log(log.join('\n')); for (const t of track) console.log(`w${String(t.week).padStart(2)} ${t.block.padEnd(10)} fat ${(t.fat * 100).toFixed(1)}%  true ${t.caps.join('/')}  app ${t.app.join('/')}`); }
// Let fatigue clear, then report true strength (what a well-timed test would show).
for (let i = 0; i < 10; i++) decayDay();
const gain = LIFTS.map(l => ((cap(l) / body[l].base - 1) * 100).toFixed(1) + '%');
const total = LIFTS.reduce((a, l) => a + cap(l), 0);
console.log(`${profile.padEnd(8)} ${variant.padEnd(16)} dial ${st.program.volumeDial} tm ${Math.round(st.settings.tmPct*1000)/10}% total ${Math.round(total)} (${gain.join(' ')}) | fat mean ${(100 * M.fatSum / M.fatN).toFixed(1)}% peak ${(100 * M.fatPeak).toFixed(1)}% over-line days ${M.overDays} deep ${M.deepDays} injuries ${M.injuries} | hard ${M.hardSessions} crushed ${M.crushed} grinds ${M.grindSets} | reds ${M.reds} light ${M.lightSessions} deloads ${M.deloadsSuggested} | readiness ${(M.readinessSum / M.sessions).toFixed(0)}`);
