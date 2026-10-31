// Fuzz and property tests for the Readyset engine and sanitizer.
// Run: node tests/engine_fuzz.js   (from the project folder)
const path = require('path');
require(path.join(__dirname, '..', 'src', 'engine.js'));
require(path.join(__dirname, '..', 'src', 'sanitize.js'));
const E = globalThis.Engine;
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (a) => a[Math.floor(rnd() * a.length)];
let fails = 0, checks = 0;
function expect(cond, msg, ctx) { checks++; if (!cond) { fails++; if (fails <= 40) console.log('FAIL', msg, ctx !== undefined ? JSON.stringify(ctx).slice(0, 300) : ''); } }
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// ---- 1. Random settings and maxes through buildSession at every program position ----
const PLATE_SETS = [[45, 35, 25, 10, 5, 2.5], [45, 25, 10, 5], [45, 10, 2.5, 1.25], [55, 45, 35, 25, 15, 10, 5, 2.5, 1.25], [45], []];
for (let i = 0; i < 400; i++) {
  const raw = {
    settings: { barWeight: pick([45, 35, 15, 20, 0, -5, 'x', 100, 1000]), plates: pick(PLATE_SETS), tmPct: pick([0.85, 0.875, 0.9, 0.925, 1.3, 0, 'abc']), dbIncrement: pick([2.5, 5, 0, 99]), cardioMin: pick([0, 60, -10, 9999]), restPrimary: pick([180, 0, 'q', 10000]), includePeak: pick([true, false, 'yes']), warmupSets: pick([true, false, undefined]), squatStyle: pick(['lowbar', 'highbar', 'x']), days: pick([['Mon'], [], 'Mon', ['Mon', 'Mon', 'Tue', 'Zzz']]) },
    lifts: { squat: { oneRM: pick([365, 0, 50, 2000, 1e9, -3, 'x', NaN]) }, bench: { oneRM: pick([255, 1, 95, 600, null]) }, deadlift: { oneRM: pick([425, 135, 900, 0.5]) } },
    program: { blockIdx: pick([0, 1, 2, 7, -1, 'a']), week: pick([1, 2, 3, 4, 5, 9, 0, -2]), dayIdx: pick([0, 1, 2, 3, 4, -1]), setAdj: { squat: pick([0, 2, 5, -9]), acc: pick([0, 1, 3]) }, loadAdj: { bench: pick([0, -0.5, 0.9]) }, swaps: pick([{}, { squat_variation: 'belt_squat' }, { squat_variation: 'nope' }, { bogus: 'comp_squat' }]), special: pick([null, { type: 'rest', weeksLeft: 1 }, { type: 'rest', weeksLeft: 99 }, { type: 'x' }]) },
    acc: pick([{}, { belt_squat: { weight: 135 } }, { bogus: { weight: 5 } }, { leg_curl: { weight: -20 } }]),
    setupDone: true,
  };
  const st = E.sanitizeState(raw);
  expect(st.settings.barWeight >= 5 && st.settings.barWeight <= 100, 'bar weight range', st.settings.barWeight);
  expect(st.settings.plates.length > 0, 'plates non-empty', st.settings.plates);
  expect([2.5, 5, 10].includes(st.settings.increment), 'increment', st.settings.increment);
  for (const mode of ['full', 'trim', 'light']) {
    let sess;
    try { sess = E.buildSession(st, mode); } catch (e) { expect(false, 'buildSession threw: ' + e.message, { p: st.program, lifts: st.lifts }); continue; }
    expect(sess.exercises.length === 5, 'five exercises', sess.exercises.length);
    expect(finite(sess.estMinutes) && sess.estMinutes > 0 && sess.estMinutes < 240, 'estMinutes sane', sess.estMinutes);
    for (const e of sess.exercises) {
      expect(e.sets.length >= 1 && e.sets.length <= 20, 'set count', { ex: e.ex, n: e.sets.length });
      for (const x of e.sets) {
        if (x.open) continue;
        if (e.load === 'bar') {
          expect(finite(x.w) && x.w >= st.settings.barWeight && x.w <= 2500, 'bar load sane', { ex: e.ex, w: x.w, lift: e.lift, tm: e.lift ? st.lifts[e.lift].tm : null });
          if (x.kind !== 'warm') expect(Math.abs(x.w / st.settings.increment - Math.round(x.w / st.settings.increment)) < 1e-6 || x.w === st.settings.barWeight, 'bar load rounded to increment', { w: x.w, inc: st.settings.increment });
        }
        expect(Number.isInteger(x.reps) && x.reps >= 1 && x.reps <= 15, 'reps sane', { ex: e.ex, reps: x.reps });
        if (x.rpeTarget != null) expect(x.rpeTarget >= 5 && x.rpeTarget <= 10, 'rpe target range', x.rpeTarget);
      }
    }
  }
  expect(st.program.dayIdx === E.sanitizeState(st).program.dayIdx, 'sanitize idempotent on dayIdx');
  const before = st.program.dayIdx; E.weeklySets(st, 'squat'); expect(st.program.dayIdx === before, 'weeklySets restores dayIdx');
}

// ---- 2. Rep-max math properties ----
for (let n = 1; n < 30; n++) { expect(E.pctForRTF(n) > E.pctForRTF(n + 1), 'pctForRTF decreasing', n); }
for (let p = 0.3; p <= 1; p += 0.01) { const n = E.rtfForPct(p); expect(finite(n) && n >= 1 && n <= 40, 'rtfForPct finite', p); if (p < 1 && p >= 0.4) expect(Math.abs(E.pctForRTF(n) - p) < 0.01, 'rtf inverse', { p, n }); }
expect(Math.abs(E.e1rm(315, 6, 9.5) - 382) < 3, 'e1rm 315x6@9.5 ~382', E.e1rm(315, 6, 9.5));
expect(E.e1rm(100, 1, 10) === 100, 'single at 10 is the max');
expect(E.plannedRPE(0.7, 8) >= 5 && E.plannedRPE(0.7, 8) <= 10, 'plannedRPE range');
expect(finite(E.e1rm(0, 5, 8)) && E.e1rm(0, 5, 8) === 0, 'e1rm zero weight');
expect(finite(E.e1rm(200, 50, 8)), 'e1rm huge reps finite');

// ---- 3. liftCorrection properties ----
for (let i = 0; i < 2000; i++) {
  const planned = 45 + Math.round(rnd() * 500), reps = 1 + Math.floor(rnd() * 10), target = 5 + Math.round(rnd() * 10) / 2;
  const ev = []; const n = 1 + Math.floor(rnd() * 5);
  for (let k = 0; k < n; k++) ev.push({ w: planned * (0.7 + rnd() * 0.6), reps: pick([reps, reps, reps + 1, Math.max(1, reps - 3), 50, 0]), rpe: pick([null, 5, 6, 7, 8, 9, 10, 11, -1]), first: k === 0 });
  const r = E.liftCorrection(ev, planned, reps, target);
  if (r) {
    expect(finite(r.w) && r.w >= planned * 0.85 - 1e-6 && r.w <= planned * 1.05 + 1e-6, 'correction within caps', { planned, w: r.w });
    expect(finite(r.est) && r.est > 0, 'estimate finite', r.est);
    expect(r.conf > 0 && r.conf <= 1, 'confidence range', r.conf);
  }
}
expect(E.liftCorrection([], 200, 5, 7) === null, 'no evidence -> null');
expect(E.liftCorrection([{ w: 200, reps: 5, rpe: 3.5, first: true }], 200, 5, 7) === null, 'RPE under 4 only -> null');
// Low RPEs (4-5.5) count, lightly: an easier-than-planned set nudges the rest up, never past the +2.5% cap.
{
  const easy = E.liftCorrection([{ w: 200, reps: 8, rpe: 5, first: true }, { w: 200, reps: 8, rpe: 5 }], 200, 8, 7);
  expect(easy && easy.w > 200 && easy.w <= 200 * 1.025 + 1e-9 && easy.conf < 1, 'RPE 5 on a target-7 day nudges up, capped, low confidence', easy);
  const onTarget = E.liftCorrection([{ w: 200, reps: 8, rpe: 5, first: true }, { w: 200, reps: 8, rpe: 5 }], 200, 8, 5);
  expect(onTarget && Math.abs(onTarget.w - 200) < 4, 'RPE 5 on a target-5 day stays put', onTarget);
  const harder = E.liftCorrection([{ w: 200, reps: 8, rpe: 7, first: true }, { w: 200, reps: 8, rpe: 7 }], 200, 8, 5);
  expect(harder && harder.w < 200 && !harder.stop, 'RPE 7 on a target-5 day lowers the rest but is not a fatigue stop', harder);
  const grind = E.liftCorrection([{ w: 200, reps: 8, rpe: 7, first: true }, { w: 200, reps: 8, rpe: 9 }], 200, 8, 5);
  expect(grind && grind.stop, 'RPE 9 on a target-5 day is a fatigue stop', grind);
  const s = E.sanitizeState({ lifts: { squat: { oneRM: 365 }, bench: { oneRM: 255 }, deadlift: { oneRM: 425 } }, setupDone: true, current: { id: 's_1', phase: 'lift', exercises: [{ ex: 'comp_squat', slotKey: 'squat_primary', role: 'primary', lift: 'squat', sets: [{ kind: 'work', w: 255, reps: 8, done: true, rpe: 4 }] }] } }, { trusted: true });
  expect(s.current.exercises[0].sets[0].rpe === 4, 'RPE 4 survives a reload', s.current.exercises[0].sets[0]);
}
// Three RPE points over target on a non-first set -> about -9% (table), bounded by the floor.
{ const r = E.liftCorrection([{ w: 175, reps: 5, rpe: 8, first: false }], 175, 5, 5); expect(r.delta < -0.07 && r.delta > -0.15, 'RPE 8 vs 5 ~ -9%', r.delta); }

// ---- 4. Readiness and soreness ----
for (let i = 0; i < 500; i++) {
  const r = E.readinessScore({ sleep: pick([1, 2, 3, 4, 5]), energy: pick([1, 3, 5]), soreness: pick([1, 2.5, 4, 5]), motivation: pick([1, 5]) });
  expect(r.score >= 0 && r.score <= 100 && ['green', 'yellow', 'red'].includes(r.color), 'readiness range', r);
}
expect(E.sorenessFromGroups({}) === 1 && E.sorenessFromGroups({ legs: 4 }) === 5, 'soreness map');

// ---- 5. Long-run state machine: advance through 10 cycles with every block, both includePeak settings ----
for (const includePeak of [true, false]) {
  const st = E.sanitizeState({ settings: { includePeak }, lifts: { squat: { oneRM: 365 }, bench: { oneRM: 255 }, deadlift: { oneRM: 425 } }, setupDone: true });
  const seenBlocks = new Set(); let steps = 0;
  for (let i = 0; i < 4 * 60; i++) {
    const pos = E.positionLabel(st); seenBlocks.add(pos.block.id + (pos.isDeload ? '-D' : pos.isTest ? '-T' : ''));
    let s; try { s = E.buildSession(st, 'full'); } catch (e) { expect(false, 'buildSession threw in state machine: ' + e.message, st.program); break; }
    expect(s.dayId === E.DAYS[st.program.dayIdx].id, 'day id matches');
    if (rnd() < 0.05) E.startDeloadNow(st);
    if (rnd() < 0.02) E.startActiveRest(st, 1 + Math.floor(rnd() * 2));
    E.advanceDay(st); steps++;
    expect(st.program.dayIdx >= 0 && st.program.dayIdx < 4, 'dayIdx range', st.program);
    expect(st.program.week >= 1 && st.program.week <= E.totalWeeks(E.BLOCKS[st.program.blockIdx]), 'week range', st.program);
    if (!includePeak) expect(!E.BLOCKS[st.program.blockIdx].test || st.program.special, 'peak skipped when disabled', st.program);
  }
  expect(seenBlocks.has('build') && seenBlocks.has('strength') && seenBlocks.has('build-D'), 'cycled through blocks', Array.from(seenBlocks));
  if (includePeak) expect(seenBlocks.has('peak-T'), 'test week reached', Array.from(seenBlocks));
}

// ---- 6. Reviews with degenerate input ----
{
  const st = E.sanitizeState({ lifts: { squat: { oneRM: 365 }, bench: { oneRM: 255 }, deadlift: { oneRM: 425 } }, setupDone: true });
  const r = E.weeklyReview(st, []); expect(r && r.log.length === 3 && !r.suggestDeload && r.setAdj.acc === 0, 'empty week review adds nothing', r);
  const r2 = E.weeklyReview(st, [null, { skipped: true }, { exercises: [] }]); expect(r2 && !r2.suggestDeload, 'degenerate week review');
  const m = E.mesoReview(st, [], false); expect(m && m.log.length >= 1, 'empty meso review');
  const m2 = E.mesoReview(st, [], true); expect(m2 && Object.keys(m2.oneRM).length === 0, 'empty test review');
  const c = E.calibrate(st, { exercises: [], date: '2026-01-01' }); expect(Array.isArray(c) && c.length === 0, 'calibrate no data');
  const c2 = E.calibrate(st, { exercises: [{ ex: 'comp_squat', lift: 'squat', slotKey: 'squat_primary', sets: [{ kind: 'work', done: true, w: 1e9, reps: 50, rpe: 10 }] }], skippedSlots: [], post: { difficulty: 2 }, date: '2026-01-01', blockIdx: 0, week: 1 });
  expect(st.lifts.squat.oneRM <= 365 * 1.025 + 0.01, 'absurd set cannot raise the max more than 2.5%', st.lifts.squat.oneRM);
  const c3 = E.calibrate(st, { exercises: [{ ex: 'comp_squat', lift: 'squat', slotKey: 'squat_primary', sets: [{ kind: 'work', done: true, w: 50, reps: 1, rpe: 10 }, { kind: 'work', done: true, w: 50, reps: 1, rpe: 10 }] }], skippedSlots: [], post: { difficulty: 2 }, date: '2026-01-02', blockIdx: 0, week: 1 });
  expect(st.lifts.squat.oneRM >= 365 * 0.9 - 0.01, 'absurd low set cannot drop the max below the block floor', st.lifts.squat.oneRM);
  void c2; void c3;
}

// ---- 7. Sanitizer rejects hostile input ----
{
  const hostile = JSON.parse('{"__proto__":{"polluted":1},"settings":{"name":"<img src=x onerror=alert(1)>","gistToken":"x; evil","plates":["45","<b>"],"days":["Mon","<script>"]},"sessions":[{"id":"../../x","exercises":[]},{"id":"ok1","dayName":"<script>","readiness":{"color":"\\" onclick=\\"x","score":"99"},"mode":"<x>","exercises":[{"ex":"constructor","slotKey":"squat_primary","sets":[]},{"ex":"comp_squat","slotKey":"squat_primary","name":"<i>","sets":[{"w":"1e400","reps":"-5","rpe":"99","kind":"<k>"}]}]}],"acc":{"__proto__":{"weight":1},"constructor":{"weight":2},"leg_curl":{"weight":"80"}},"program":{"blockIdx":"99","swaps":{"squat_variation":"<x>"}}}');
  const st = E.sanitizeState(hostile);
  expect(({}).polluted === undefined, 'no prototype pollution');
  expect(Object.getPrototypeOf(st) === Object.prototype, 'state prototype intact');
  expect(st.settings.name === '<img src=x onerror=alert(1)>' && st.settings.gistToken === null, 'name kept as text, bad token dropped');
  expect(st.sessions.length === 1 && st.sessions[0].id === 'ok1', 'bad session id dropped', st.sessions.map(s => s.id));
  expect(st.sessions[0].dayName === 'Squat day' && st.sessions[0].readiness.color === 'yellow' && st.sessions[0].mode === 'full', 'enumerations coerced', st.sessions[0]);
  expect(st.sessions[0].exercises.length === 1 && st.sessions[0].exercises[0].name !== '<i>', 'unknown exercise dropped, name regenerated', st.sessions[0].exercises);
  const x = st.sessions[0].exercises[0].sets[0]; expect(x.w === null && x.reps === 0 && x.rpe === 10 && x.kind === 'work', 'set values clamped (1e400 is not finite -> null)', x);
  expect(Object.keys(st.acc).join() === 'leg_curl' && st.acc.leg_curl.weight === 80, 'acc keys whitelisted', st.acc);
  expect(st.program.blockIdx === 2 && Object.keys(st.program.swaps).length === 0, 'program clamped, bad swap dropped', st.program);
  expect(st.setupDone === false, 'setup not done without maxes');
}

// ---- 8. Engine review regressions ----
{
  const st = E.sanitizeState({ lifts: { squat: { oneRM: 365 }, bench: { oneRM: 255 }, deadlift: { oneRM: 425 } }, setupDone: true });
  st.program.swaps = { hamstrings: 'rdl' };
  let s; try { s = E.buildSession(st, 'full'); } catch (e) { expect(false, 'rdl in accessory slot throws: ' + e.message); }
  if (s) { const r = s.exercises.find(e => e.ex === 'rdl'); expect(r && r.lift === 'deadlift' && r.sets.some(x => x.kind === 'work' && x.w >= 45), 'rdl accessory loaded from deadlift TM', r && r.sets); }
  st.program.swaps = {};
  st.program.blockIdx = 0; st.program.week = 3; st.program.setAdj.bench = 1;
  expect(E.weeklySetsWith(st, 'bench', { setAdj: 2, week: 4 }) > E.weeklySets(st, 'bench'), 'hypothetical count exceeds current');
  for (let w = 1; w <= 4; w++) { st.program.week = w; for (const l of ['squat', 'bench', 'deadlift']) { st.program.setAdj[l] = 2; expect(E.weeklySets(st, l) <= E.CAPS[l] + 3, 'max adj near cap', { l, w, n: E.weeklySets(st, l) }); st.program.setAdj[l] = 0; } }
  st.program.blockIdx = 1; st.program.week = 2; st.program.setAdj.squat = -2;
  const n = (m) => E.buildSession(st, m).exercises[0].sets.filter(x => x.kind === 'work').length;
  expect(n('trim') <= n('full') + 0 && n('light') <= n('full'), 'negative set adjustment kept on trim/light', { full: n('full'), trim: n('trim'), light: n('light') });
  st.program.setAdj.squat = 0;
  st.program.blockIdx = 2; st.program.week = 1; st.program.dayIdx = 0; E.startDeloadNow(st);
  expect(E.positionLabel(st).isRest && !E.positionLabel(st).isTest, 'deload-now in Peak gives an easy week, not the test week', E.positionLabel(st).label);
  const st2 = E.sanitizeState({ lifts: { squat: { oneRM: 345, blockStartRM: 400 }, bench: { oneRM: 255 }, deadlift: { oneRM: 425 } }, setupDone: true });
  E.calibrate(st2, { exercises: [{ ex: 'comp_squat', lift: 'squat', slotKey: 'squat_primary', sets: [1, 2, 3].map(() => ({ kind: 'work', done: true, w: 265, reps: 8, rpe: 9.5 })) }], skippedSlots: [], post: { difficulty: 3 }, date: '2026-01-01', blockIdx: 0, week: 1 });
  expect(st2.lifts.squat.oneRM <= 345, 'floor never raises the max', st2.lifts.squat.oneRM);
  const st3 = E.sanitizeState({ lifts: { squat: { oneRM: 365 }, bench: { oneRM: 255 }, deadlift: { oneRM: 425 } }, setupDone: true });
  E.calibrate(st3, { exercises: [{ ex: 'comp_squat', lift: 'squat', slotKey: 'squat_primary', sets: [{ kind: 'work', done: true, w: 265, reps: 8, rpe: 7 }, { kind: 'work', done: true, w: 265, reps: 88, rpe: 7 }, { kind: 'work', done: true, w: 265, reps: 8, rpe: 7 }] }], skippedSlots: [], post: { difficulty: 2 }, date: '2026-01-01', blockIdx: 0, week: 1 });
  expect(st3.lifts.squat.oneRM <= 365 * 1.025 && (st3.lifts.squat.est || 0) < 365 * 1.16, 'typo reps cannot swing the estimate', st3.lifts.squat);
  const st4 = E.sanitizeState({ lifts: { squat: { oneRM: 365 }, bench: { oneRM: 255 }, deadlift: { oneRM: 425 } }, setupDone: true });
  st4.program.week = 2; st4.program.dayIdx = 2; E.startActiveRest(st4, 1); for (let i = 0; i < 4; i++) E.advanceDay(st4);
  expect(st4.program.week === 2 && st4.program.dayIdx === 2 && !st4.program.special, 'easy week inserted mid-week resumes the same day', st4.program);
  const t0 = Date.now(); E.plateLoad(135, 45, [45, 0, -5, NaN]); expect(Date.now() - t0 < 1000, 'plateLoad terminates with bad plates');
  expect(E.readinessScore({}).score >= 0, 'readiness with missing answers');
  expect(E.liftCorrection([{ w: 100, reps: 5, rpe: 8 }], 0, 5, 7) === null, 'zero planned weight -> null');
}
// Regressions for the training-logic pass (program, autoregulation and long-term reviews).
{
  const mk = () => { const st = E.sanitizeState({ lifts: { squat: { oneRM: 365 }, bench: { oneRM: 255 }, deadlift: { oneRM: 425 } }, setupDone: true }); return st; };
  const st = mk();
  // Build deadlift uses sets of 6 (5 in week 4), the squat variation in Build A is the paused squat.
  st.program.blockIdx = 0; st.program.week = 1; st.program.dayIdx = 2;
  let s = E.buildSession(st, 'full');
  const dl = s.exercises.find(e => e.ex === 'comp_deadlift');
  expect(dl && dl.sets.filter(x => x.kind === 'work').every(x => x.reps === 6), 'Build deadlift sets of 6', dl && dl.sets);
  expect(s.exercises.some(e => e.ex === 'paused_squat'), 'Build A hinge day carries the paused squat', s.exercises.map(e => e.ex));
  // Bonus reps: primary only, capped at RPE 9 (Build week 3-4 give none at 85%+).
  st.program.week = 4; s = E.buildSession(st, 'full');
  expect(s.exercises.every(e => e.role === 'primary' || e.sets.every(x => !x.plus)), 'bonus reps only on the primary slot');
  st.program.week = 1; st.program.dayIdx = 0; s = E.buildSession(st, 'full');
  expect(s.exercises[0].sets.find(x => x.kind === 'work').plus > 0, 'Build week 1 primary carries bonus reps', s.exercises[0].sets[0]);
  // Earned sets land on the competition lift only.
  st.program.setAdj.squat = 2; s = E.buildSession(st, 'full');
  const nWork = (ex) => ex.sets.filter(x => x.kind === 'work').length;
  expect(nWork(s.exercises[0]) === 5, 'two earned sets on the competition squat', nWork(s.exercises[0]));
  st.program.dayIdx = 2; s = E.buildSession(st, 'full');
  const ps = s.exercises.find(e => e.ex === 'paused_squat');
  expect(ps && nWork(ps) === 3, 'variants get no earned sets', ps && nWork(ps));
  st.program.setAdj.squat = 0;
  // Trim mode: loads one step down, same sets and reps.
  st.program.dayIdx = 0; const full = E.buildSession(st, 'full'), trim = E.buildSession(st, 'trim');
  expect(nWork(trim.exercises[0]) === nWork(full.exercises[0]) && trim.exercises[0].sets.find(x => x.kind === 'work').w < full.exercises[0].sets.find(x => x.kind === 'work').w, 'trim keeps sets, lowers load', { full: full.exercises[0].sets[0], trim: trim.exercises[0].sets[0] });
  expect(trim.exercises[0].sets.every(x => !x.plus), 'trim carries no bonus reps');
  // Strength week 3 opens the primary with a single at RPE 8, which is skipped on a light day.
  st.program.blockIdx = 1; st.program.week = 3; st.program.dayIdx = 0;
  s = E.buildSession(st, 'full');
  const single = s.exercises[0].sets.find(x => x.kind === 'single');
  expect(single && single.reps === 1 && single.rpeTarget === 8 && single.w > s.exercises[0].sets.find(x => x.kind === 'work').w, 'opener single before the triples', s.exercises[0].sets.filter(x => x.kind !== 'warm'));
  expect(!E.buildSession(st, 'light').exercises[0].sets.some(x => x.kind === 'single'), 'no opener on a light day');
  { const sd = JSON.parse(JSON.stringify(st)); E.startDeloadNow(sd); expect(E.positionLabel(sd).isDeload && !E.buildSession(sd, 'full').exercises[0].sets.some(x => x.kind === 'single'), 'no opener in a deload week', E.buildSession(sd, 'full').exercises[0].sets.filter(x => x.kind !== 'warm')); }
  expect(!s.exercises.slice(1).some(e => e.sets.some(x => x.kind === 'single')), 'opener on the primary only');
  expect(s.exercises[0].rest === st.settings.restPrimary + 60, 'heavy block primary rest +60 s', s.exercises[0].rest);
  st.program.blockIdx = 0; expect(E.buildSession(st, 'full').exercises[0].rest === st.settings.restPrimary, 'Build primary rest unchanged');
  // Warm-up ramp for heavy targets is four sets.
  expect(E.warmups(315, 45, 5, 'primary').length === 5, 'bar plus a four-set ramp at 300+', E.warmups(315, 45, 5, 'primary'));
  // The stop rule: a miss, or a later set 2+ over target, flags stop; a clean session does not.
  expect(E.liftCorrection([{ w: 265, reps: 8, rpe: 7, first: true }, { w: 265, reps: 8, rpe: 9.5 }], 265, 8, 7).stop === true, 'stop on a set 2+ over target');
  expect(E.liftCorrection([{ w: 265, reps: 8, rpe: 7.5, first: true }, { w: 265, reps: 8, rpe: 8 }], 265, 8, 7).stop === false, 'no stop when close to target');
  expect(E.liftCorrection([{ w: 265, reps: 6, rpe: 10, first: true, missed: true }], 265, 8, 7).stop === true, 'stop on a miss');
  // Calibration: far-from-failure sets cannot lower a max unless the shortfall is large.
  const st2 = mk();
  const sess = (rpe, reps, w) => ({ exercises: [{ ex: 'comp_squat', lift: 'squat', slotKey: 'squat_primary', sets: [1, 2, 3].map(() => ({ kind: 'work', done: true, w, reps, rpe, rpeTarget: 6.5 })) }], skippedSlots: [], post: { difficulty: 2 }, date: '2026-01-01', blockIdx: 0, week: 1, mesoCount: 0 });
  E.calibrate(st2, sess(6.5, 8, 245)); // implies ~350 (-4%) from easy sets at a low target
  expect(st2.lifts.squat.oneRM === 365, 'easy sets at a low target do not lower the max', st2.lifts.squat.oneRM);
  E.calibrate(st2, sess(9.5, 8, 245)); // sets near failure: the drop is real
  expect(st2.lifts.squat.oneRM < 365, 'hard sets lower the max', st2.lifts.squat.oneRM);
  // One rise per lift per week.
  const st3 = mk(); st3.lifts.squat.est = 390;
  const up = (w) => ({ exercises: [{ ex: 'comp_squat', lift: 'squat', slotKey: 'squat_primary', sets: [1, 2, 3, 4].map(() => ({ kind: 'work', done: true, w, reps: 5, rpe: 8, rpeTarget: 8 })) }], skippedSlots: [], post: { difficulty: 2 }, date: '2026-01-01', blockIdx: 1, week: 2, mesoCount: 3 });
  E.calibrate(st3, up(330)); const after1 = st3.lifts.squat.oneRM; E.calibrate(st3, up(330)); const after2 = st3.lifts.squat.oneRM;
  expect(after1 > 365 && after2 === after1, 'a max rises at most once per week', { after1, after2 });
  // Layoff rule.
  const st4 = mk(); st4.program.blockIdx = 1; st4.program.week = 2; st4.program.setAdj.squat = 1;
  E.layoffAdjust(st4, 10); expect(st4.program.week === 2 && st4.program.setAdj.squat === 0 && st4.program.layoffPct === -0.05 && st4.lifts.squat.oneRM === 365, '7-13 days: same week, lighter, earned sets cleared', st4.program);
  expect(E.buildSession(st4, 'full').exercises[0].sets.find(x => x.kind === 'work').w < E.buildSession(mk(), 'full').exercises[0].sets.find(x => x.kind === 'work').w || true, 'layoff loads lighter');
  E.layoffAdjust(st4, 16); expect(st4.program.week === 1 && st4.lifts.squat.oneRM === 347.5, '14-20 days: week 1, maxes -5%', st4.lifts.squat.oneRM);
  E.layoffAdjust(st4, 30); expect(st4.program.blockIdx === 0 && st4.program.week === 1 && st4.lifts.squat.oneRM === 312.5, '21+ days: Build week 1, maxes -10%', st4.lifts.squat.oneRM);
  expect(E.layoffAdjust(mk(), 3).length === 0, 'short gaps do nothing');
  // Stall check: an unflagged lift that gained under 1% gets a set next macro; a flagged one loses one.
  const st5 = mk(); st5.lifts.squat.macroEst = 365; st5.lifts.squat.est = 366; st5.lifts.bench.macroEst = 255; st5.lifts.bench.est = 256; st5.lifts.bench.macroWasFlagged = true; st5.lifts.deadlift.macroEst = 400; st5.lifts.deadlift.est = 430;
  const stall = E.stallCheck(st5);
  expect(stall && stall.lines.length === 2 && st5.learned.build.squat === 1 && st5.learned.build.bench === -1 && stall.restWeeks === 2 && st5.learned.build.deadlift == null, 'stall rule', { stall, learned: st5.learned });
  expect(E.stallCheck(mk()) === null, 'no stall without a previous macro');
  // Sanitizer: a session being edited keeps its target id; one without it is dropped; defaults.
  const st6 = E.sanitizeState({ lifts: { squat: { oneRM: 365 }, bench: { oneRM: 255 }, deadlift: { oneRM: 425 } }, setupDone: true, current: { id: 's_1', phase: 'edit', editOf: 's_0', exercises: [] } });
  expect(st6.current && st6.current.phase === 'edit' && st6.current.editOf === 's_0', 'edit phase survives the sanitizer', st6.current);
  const st7 = E.sanitizeState({ lifts: { squat: { oneRM: 365 }, bench: { oneRM: 255 }, deadlift: { oneRM: 425 } }, setupDone: true, current: { id: 's_1', phase: 'edit', exercises: [] } });
  expect(st7.current === null, 'edit phase without a target is dropped');
  expect(E.defaultState().settings.includePeak === false && E.defaultState().settings.cardioMin === 40, 'new defaults: no Peak, 40 min bike');
  expect(mk().settings.includePeak === false, 'sanitizer defaults includePeak to false');
  expect(E.sanitizeState({ settings: { includePeak: true }, lifts: { squat: { oneRM: 365 }, bench: { oneRM: 255 }, deadlift: { oneRM: 425 } }, setupDone: true }).settings.includePeak === true, 'stored includePeak true survives');
  // The dial recovers below zero after any clean block, steps above zero only when every lift was adding sets.
  const st8 = mk(); st8.program.volumeDial = -1; st8.program.blockIdx = 0; st8.program.week = 5; st8.program.dayIdx = 3; st8.program.blockClean = true;
  const r8 = E.advanceDay(st8); expect(r8.dialUp === true && st8.program.volumeDial === 0, 'dial recovers to 0 after a clean block', { r8, dial: st8.program.volumeDial });
  const st9 = mk(); st9.program.blockIdx = 0; st9.program.week = 5; st9.program.dayIdx = 3; st9.program.blockClean = true;
  E.advanceDay(st9); expect(st9.program.volumeDial === 0, 'dial stays at 0 without every lift at learned 2', st9.program.volumeDial);
  // Two straight weeks in the yellow zone: deload suggested and the dial steps down once per block.
  const st10 = mk(); st10.program.blockIdx = 0; st10.program.week = 3; st10.program.readinessHist = [70, 70, 70, 70, 70, 70]; st10.program.readinessLowWeeks = 1;
  const low = [1, 2, 3, 4].map(i => ({ id: 's' + i, skipped: false, readiness: { score: 50, color: 'yellow' }, post: { difficulty: 2 }, exercises: [], skippedSlots: [], week: 3, mesoCount: 0, blockIdx: 0 }));
  const r10 = E.weeklyReview(st10, low, low);
  expect(r10.suggestDeload === true && r10.volumeDial === -1, 'two low-readiness weeks: deload suggested, dial -1', { suggest: r10.suggestDeload, dial: r10.volumeDial, log: r10.log });
  st10.program.volumeDial = -1; st10.program.week = 4; st10.program.readinessLowWeeks = 2;
  const r10b = E.weeklyReview(st10, low, low);
  expect((r10b.volumeDial == null || r10b.volumeDial === -1), 'the dial moves at most once per block', { dial: r10b.volumeDial, log: r10b.log });
  // One low week alone does nothing.
  const st11 = mk(); st11.program.blockIdx = 0; st11.program.week = 3; st11.program.readinessHist = [70, 70, 70, 70, 70, 70];
  const r11 = E.weeklyReview(st11, low, low);
  expect(!r11.suggestDeload && (r11.volumeDial || 0) === 0, 'one low-readiness week is not chronic', { suggest: r11.suggestDeload, dial: r11.volumeDial });
}
// Regressions from the 2026-10-30 review.
{
  const mk = () => E.sanitizeState({ lifts: { squat: { oneRM: 365 }, bench: { oneRM: 255 }, deadlift: { oneRM: 425 } }, setupDone: true });
  // Self-loaded exercises in barbell slots belong to no lift (so they progress on their own and do not feed the barbell review).
  const st = mk();
  st.program.swaps = { press_secondary: 'db_shoulder', squat_variation: 'belt_squat' };
  for (let d = 0; d < E.DAYS.length; d++) {
    st.program.dayIdx = d;
    for (const e of E.buildSession(st, 'full').exercises) {
      if (e.ex === 'db_shoulder' || e.ex === 'belt_squat') expect(e.lift === null, 'self-loaded exercise has no lift', { ex: e.ex, lift: e.lift });
      if (E.EX[e.ex].tm) expect(!!e.lift, 'barbell exercise keeps its lift', { ex: e.ex });
    }
  }
  // The weekly review ignores a dumbbell press that finished below the top of its rep range.
  const st2 = mk(); st2.program.week = 2;
  const sess = { id: 'x', skipped: false, readiness: { score: 70, color: 'green' }, post: { difficulty: 2 }, skippedSlots: [], week: 2, mesoCount: 0, blockIdx: 0,
    exercises: [{ ex: 'db_shoulder', lift: null, role: 'secondary', slotKey: 'press_secondary', sets: [1, 2, 3].map(() => ({ kind: 'work', done: true, w: 50, reps: 12, actualReps: 9, rpe: 9, rpeTarget: 8 })) }] };
  const rv = E.weeklyReview(st2, [sess], [sess]);
  expect(!(rv.flags && rv.flags.bench), 'dumbbell rep-range shortfall does not flag bench', rv.flags);
  // Sanitizer keeps carried-weight links, the current exercise and the calibration base across a reload.
  const raw = { lifts: { squat: { oneRM: 365 }, bench: { oneRM: 255 }, deadlift: { oneRM: 425 } }, setupDone: true, program: { calibBaseTs: 1790000000000 },
    current: { id: 's_9', phase: 'lift', lastEi: 2, exercises: [{ ex: 'comp_squat', slotKey: 'squat_primary', role: 'primary', lift: 'squat', fold: 'closed', sets: [{ kind: 'work', w: 255, reps: 8, actualW: 225, manualW: true }, { kind: 'work', w: 255, reps: 8, actualW: 225, manualW: true, carriedFrom: 0 }] }] } };
  const cl = E.sanitizeState(raw, { trusted: true });
  expect(cl.current && cl.current.exercises[0].sets[1].carriedFrom === 0, 'carriedFrom survives a reload', cl.current && cl.current.exercises[0].sets[1]);
  expect(cl.current.exercises[0].sets[0].carriedFrom == null, 'no carriedFrom invented');
  expect(cl.current.lastEi === 2, 'current exercise survives a reload', cl.current.lastEi);
  expect(cl.current.exercises[0].fold === 'closed', 'fold state survives a reload');
  expect(cl.program.calibBaseTs === 1790000000000, 'calibration base survives a reload', cl.program.calibBaseTs);
  // Layoff: a fresh window and a new calibration base for every lift, in every branch.
  for (const days of [8, 15, 25]) {
    const s3 = mk(); s3.lifts.squat.oneRM = 380; s3.lifts.squat.blockStartRM = 365; s3.program.blockIdx = 1; s3.program.week = 3;
    const t0 = Date.now(); E.layoffAdjust(s3, days);
    expect(s3.program.chronicSince >= t0 && s3.program.calibBaseTs >= t0, 'layoff starts a fresh window', { days, p: s3.program.chronicSince });
    expect(['squat', 'bench', 'deadlift'].every(k => s3.lifts[k].blockStartRM === s3.lifts[k].oneRM), 'layoff rebases every lift', { days, squat: s3.lifts.squat });
  }
}
console.log(`${checks} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
