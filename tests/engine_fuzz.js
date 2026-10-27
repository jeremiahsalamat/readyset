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
expect(E.liftCorrection([{ w: 200, reps: 5, rpe: 5.5, first: true }], 200, 5, 7) === null, 'sub-6 RPE only -> null');
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
console.log(`${checks} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
