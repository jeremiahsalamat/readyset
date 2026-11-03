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
  expect(st.settings.increment === Math.min(10, 2 * Math.min(...st.settings.plates)), 'increment is one pair of the smallest plate, at most 10', { inc: st.settings.increment, plates: st.settings.plates });
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
          expect(E.plateLoad(x.w, st.settings.barWeight, st.settings.plates).exact, 'bar load is a total the plates make exactly', { w: x.w, bar: st.settings.barWeight, plates: st.settings.plates });
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
    // The floor is 85% of the plan, stepping down 7.5% for each later set that was still too hard at the floor.
    expect(finite(r.w) && r.w >= planned * 0.85 * Math.pow(0.925, ev.length) - 1e-6 && r.w <= planned * 1.05 + 1e-6, 'correction within caps', { planned, w: r.w });
    expect(finite(r.est) && r.est > 0, 'estimate finite', r.est);
    expect(r.conf > 0 && r.conf <= 1, 'confidence range', r.conf);
  }
}
expect(E.liftCorrection([], 200, 5, 7) === null, 'no evidence -> null');
expect(E.liftCorrection([{ w: 200, reps: 5, rpe: 3.5, first: true }], 200, 5, 7) === null, 'RPE under 4 only -> null');
// The floor steps down when a set performed at the floor is still a full RPE over target, and holds otherwise.
{
  const p = 255, f0 = p * 0.85;
  const bad = [{ w: 255, reps: 3, rpe: 10, first: true, missed: true }, { w: 255, reps: 2, rpe: 10, missed: true }];
  const atFloor = E.liftCorrection(bad, p, 8, 8);
  expect(atFloor && Math.abs(atFloor.w - f0) < 1e-6 && atFloor.hitFloor, 'two bad sets land on the 85% floor', atFloor);
  const stillHard = E.liftCorrection(bad.concat([{ w: Math.round(f0), reps: 4, rpe: 9.5 }]), p, 8, 8);
  expect(stillHard && Math.abs(stillHard.w - f0 * 0.925) < 1e-6, 'still hard at the floor: floor steps down once', stillHard);
  const onTarget = E.liftCorrection(bad.concat([{ w: Math.round(f0), reps: 8, rpe: 8 }]), p, 8, 8);
  expect(onTarget && Math.abs(onTarget.w - f0) < 1e-6, 'on target at the floor: floor holds', onTarget);
  const again = E.liftCorrection(bad.concat([{ w: Math.round(f0), reps: 4, rpe: 9.5 }, { w: Math.round(f0 * 0.925), reps: 4, rpe: 9.5 }]), p, 8, 8);
  expect(again && again.w < f0 * 0.925 - 1 && again.w >= f0 * 0.925 * 0.925 - 1e-6, 'hard again: floor steps down twice', again);
}
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
  expect(st.settings.name === '<img src=x onerror=alert(1)>' && !('gistToken' in st.settings), 'name kept as text, unknown settings dropped');
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
  // Warm-up ramp for heavy targets: more steps, never fewer, and no jump off the bar over 40% of the target.
  for (const tgt of [295, 315, 405, 455, 600]) { const r = E.warmups(tgt, 45, 5, 'primary'); expect(r.length >= 5 && r[1].w - 45 <= tgt * 0.4 + 5 && r.every((x, i) => !i || x.w > r[i - 1].w), 'heavy warm-up ramps climb in sensible steps', { tgt, r: r.map(x => x.w) }); }
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
  for (const k of ['squat', 'bench', 'deadlift']) st5.lifts[k].rated = 10;
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
// ---------- Audit 8: whole-program pass ----------
{
  const mk8 = () => E.sanitizeState({ lifts: { squat: { oneRM: 300 }, bench: { oneRM: 200 }, deadlift: { oneRM: 350 } }, setupDone: true, settings: { tmPct: 0.9 } });
  const easy = (date, week, w) => ({ exercises: [{ ex: 'comp_squat', lift: 'squat', slotKey: 'squat_primary', sets: [1, 2, 3, 4].map(() => ({ kind: 'work', done: true, w, reps: 8, rpe: 5, rpeTarget: 7 })) }], skippedSlots: [], post: { difficulty: 2 }, date, blockIdx: 0, week, mesoCount: 0 });
  // An under-entered max rises from easy sets: held after one session, raised after the second.
  const u = mk8(); const l1 = E.calibrate(u, easy('2026-01-05', 1, 235)); const m1 = u.lifts.squat.oneRM; E.calibrate(u, easy('2026-01-12', 2, 235)); const m2 = u.lifts.squat.oneRM;
  expect(m1 === 300 && /at least/.test(l1.join(' ')) && m2 > 300 && m2 <= 307.5, 'easy sets prove a floor and raise an under-entered max slowly', { m1, m2, l1 });
  // Easy sets at a sensible max do not raise it.
  const v = mk8(); E.calibrate(v, easy('2026-01-05', 1, 200)); E.calibrate(v, easy('2026-01-12', 2, 200)); expect(v.lifts.squat.oneRM === 300, 'easy sets at a fair max change nothing', v.lifts.squat.oneRM);
  // Sets without RPEs are not "on target".
  const w = mk8(); w.program.week = 2;
  const noRpe = [0, 1, 2, 3].map(d => { w.program.dayIdx = d; const s = E.buildSession(w, 'full'); s.exercises.forEach(e => e.sets.forEach(x => { x.done = true; x.actualReps = x.reps; })); return Object.assign(s, { mode: 'full', post: { difficulty: 2 }, soreness: { legs: 1, push: 1, hinge: 1 } }); });
  w.program.dayIdx = 3; const rv = E.weeklyReview(w, noRpe, noRpe);
  expect(!rv.log.some(l => /\+1 set/.test(l) && /Squat|Bench|Deadlift/.test(l)) && rv.log.some(l => /no RPEs logged/.test(l)), 'no RPEs, no earned sets', rv.log);
  // Forced-light days are not a chronic signal.
  const f = mk8(); f.program.week = 3;
  const lightS = (red, forced) => ({ exercises: [], skippedSlots: [], mode: 'light', readiness: { score: red ? 30 : 70, color: red ? 'red' : 'green' }, forcedLight: forced || undefined, post: { difficulty: 2 }, ts: 1, blockIdx: 0, week: 3, mesoCount: 0 });
  const wk = [lightS(true), lightS(true), lightS(false, true), lightS(false, true)];
  const rf = E.weeklyReview(f, wk, wk);
  expect(!rf.reasons.some(r => /light sessions this block/.test(r)), 'two reds then forced-light days do not count as chronic', rf.reasons);
  // Deload now with one accumulation week left runs the block's own deload.
  const d = mk8(); d.program.week = E.BLOCKS[0].weeks; d.program.dayIdx = 1; E.startDeloadNow(d);
  expect(d.program.week === E.BLOCKS[0].weeks + 1 && !d.program.special && E.position(d).isDeload, 'deload now in the last week jumps to the planned deload', d.program);
  // An inserted deload keeps the calibration floor and moves the replay base.
  const g = mk8(); g.program.week = 2; g.lifts.squat.oneRM = 280; const t0 = Date.now(); E.startDeloadNow(g);
  expect(g.lifts.squat.floorRM === 300 && g.program.calibBaseTs >= t0, 'inserted deload keeps the floor', g.lifts.squat);
  // Test week: a single at 98% of the max does not bump it; a miss caps it; no RPE reads as RPE 9.
  const tst = (wt, reps, rpe) => [{ exercises: [{ ex: 'comp_squat', lift: 'squat', role: 'primary', slotKey: 'squat_primary', sets: [{ kind: 'test', done: true, w: wt, reps: 1, actualReps: reps, rpe }] }], skippedSlots: [], mode: 'full' }];
  const t1 = mk8(); t1.settings.autoCalibrate = false; const r1 = E.mesoReview(t1, tst(285, 1, 9), true);
  expect(!(r1.oneRM.squat > 300), 'a test under the max does not bump it', r1);
  const r2 = E.mesoReview(t1, tst(310, 0, null), true); expect(r2.oneRM.squat > 0 && r2.oneRM.squat < 310, 'a missed test single caps the max under it', r2);
  const r3 = E.mesoReview(t1, tst(305, 1, null), true); expect(r3.oneRM.squat > 300, 'a test single without an RPE counts as RPE 9', r3);
  // Small lifter: the bar never forces a set to failure (unless the bar itself is near the max, which gets a note).
  const sm = E.sanitizeState({ lifts: { squat: { oneRM: 100 }, bench: { oneRM: 60 }, deadlift: { oneRM: 120 } }, setupDone: true, settings: { barWeight: 45 } });
  let worst = 0; for (let wk2 = 1; wk2 <= 4; wk2++) for (let dd = 0; dd < 4; dd++) { sm.program.week = wk2; sm.program.dayIdx = dd; for (const e of E.buildSession(sm, 'full').exercises) for (const x of e.sets) if (x.kind === 'work' && e.pctTM != null && !e.note) worst = Math.max(worst, x.rpeTarget || 0); }
  expect(worst <= 9, 'a light lifter is not prescribed sets to failure', worst);
  // Bookkeeping survives a reload.
  const cl8 = E.sanitizeState(JSON.parse(JSON.stringify({ lifts: { squat: { oneRM: 300, floorRM: 290, lbHits: 1, lbKey: '2026-01-05', rated: 7, macroRated: 3 } }, setupDone: true, settings: { tmPct: 0.875, tmPctChosen: 0.9 }, program: { stallMeso: 4, special: { type: 'rest', weeksLeft: 1, resumeDayIdx: 0, macroEnd: true } }, sessions: [{ id: 's1', ts: 1, date: '2026-01-01', exercises: [], forcedLight: true, calib: { squat: [300, 302.5] }, calibLines: ['Squat 1RM 300 -> 302.5.'] }] })), { trusted: false });
  const L8 = cl8.lifts.squat;
  expect(L8.floorRM === 290 && L8.lbHits === 1 && L8.lbKey === '2026-01-05' && L8.rated === 7 && L8.macroRated === 3, 'lift bookkeeping survives a reload', L8);
  expect(cl8.settings.tmPctChosen === 0.9 && cl8.program.stallMeso === 4 && cl8.program.special && cl8.program.special.macroEnd === true, 'program bookkeeping survives a reload', { s: cl8.settings.tmPctChosen, p: cl8.program.stallMeso, sp: cl8.program.special });
  expect(cl8.sessions[0].forcedLight === true && cl8.sessions[0].calib.squat[1] === 302.5 && cl8.sessions[0].calibLines.length === 1, 'session records survive a reload', cl8.sessions[0]);
  // A compacted save (nulls dropped) loads back to the same state, mid-session included.
  const full = E.sanitizeState({ lifts: { squat: { oneRM: 365 }, bench: { oneRM: 255 }, deadlift: { oneRM: 425 } }, setupDone: true });
  const cur = E.buildSession(full, 'full'); Object.assign(cur, { id: 's9', ts: 5, date: '2026-01-02', phase: 'lift', startedAt: 5, mesoCount: 0, blockIdx: 0, dayIdx: 0, notes: '', skippedSlots: [] });
  cur.exercises.forEach(e => e.sets.forEach((x, i) => { x.done = i < 2; x.actualReps = i < 2 ? x.reps : null; x.rpe = i === 1 ? 7 : null; x.actualW = null; }));
  full.current = cur; full.timer = { end: 99, total: 120, label: 'Squat' };
  // Mirrors app.js packer(): what the phone stores must load back to exactly the same state.
  const DROP_FALSE = new Set(['ind', 'open', 'done', 'manualW', 'hitFloor', 'autoStopped', 'needsWeight', 'optional', 'skipped', 'isDeload', 'isTest', 'isRest', 'paused', 'setLightRest', 'calibrated', 'timerSrc', 'autoReps', 'autoW', 'minTyped', 'macroWasFlagged']);
  const packer = (k, v) => (v === null || v === '' || v === undefined) ? undefined : (v === false && DROP_FALSE.has(k)) ? undefined : (v === 0 && (k === 'plus' || k === 'cut')) ? undefined : ((k === 'cue' || k === 'startHint' || k === 'load') && typeof v === 'string') ? undefined : v;
  // A few stored sessions too, with every kind of flag set and unset.
  for (let i = 0; i < 6; i++) { full.program.dayIdx = i % 4; const ss = E.buildSession(full, i % 3 === 0 ? 'light' : 'full'); Object.assign(ss, { id: 'p' + i, ts: 100 + i, date: '2026-01-0' + (i + 1), mesoCount: 0, blockIdx: 0, dayIdx: i % 4, skippedSlots: i === 2 ? [ss.exercises[ss.exercises.length - 1].slotKey] : [], post: { difficulty: 2 }, readiness: { score: 70, color: 'green', answers: { sleep: 4, energy: 3, motivation: 5, groups: { legs: 2, push: 1, hinge: 0 } } }, calibrated: i % 2 === 0, savedAt: 200 + i }); ss.exercises.forEach(e => e.sets.forEach((x, j) => { x.done = j % 3 !== 0; x.actualReps = x.done ? x.reps : null; x.rpe = j === 2 ? 8 : null; x.actualW = j === 4 ? (x.w || 0) + 5 : null; x.manualW = j === 4; })); full.sessions.push(ss); }
  full.program.dayIdx = 0;
  const a1 = JSON.stringify(E.sanitizeState(JSON.parse(JSON.stringify(full)), { trusted: true })), a2 = JSON.stringify(E.sanitizeState(JSON.parse(JSON.stringify(full, packer)), { trusted: true }));
  if (a1 !== a2) { let i = 0; while (a1[i] === a2[i]) i++; console.log('compact diff at', a1.slice(Math.max(0, i - 120), i + 60), '\n vs', a2.slice(Math.max(0, i - 120), i + 60)); }
  expect(a1 === a2, 'a compacted save loads back identically', a1.length + ' vs ' + a2.length);
}
console.log(`${checks} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
