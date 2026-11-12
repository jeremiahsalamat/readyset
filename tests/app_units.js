// Unit tests for the interface code that app.js keeps in src/appcore.js: storage packing, the
// timestamps of sessions logged after the fact, the typo check, the mid-session rebase, the layoff
// rule's tiers, and the claude.ai copy's merge (with a stubbed account store).
// Run: node tests/app_units.js   (from the project folder; no build needed)
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
require(path.join(SRC, 'engine.js')); require(path.join(SRC, 'sanitize.js')); require(path.join(SRC, 'appcore.js'));
const E = globalThis.Engine, C = globalThis.AppCore;
let fails = 0, checks = 0;
function expect(cond, msg, ctx) { checks++; if (!cond) { fails++; console.log('FAIL', msg, ctx !== undefined ? JSON.stringify(ctx).slice(0, 400) : ''); } }
const clone = (x) => JSON.parse(JSON.stringify(x));
const mk = (settings) => E.sanitizeState({ lifts: { squat: { oneRM: 365 }, bench: { oneRM: 255 }, deadlift: { oneRM: 425 } }, setupDone: true, settings: settings || {} });
const at = (y, m, d, h, min) => new Date(y, m - 1, d, h, min || 0, 0).getTime(); // the phone's local time

// ---------- editTs: where a session logged after the fact lands among that date's sessions ----------
{
  const P = { chronicSince: 0, calibBaseTs: 0 }, now = at(2026, 11, 7, 18);
  const day = '2026-11-03', noon = at(2026, 11, 3, 12);
  expect(C.editTs([], P, 'x', Infinity, day, now) === noon, 'an empty past date: noon', C.editTs([], P, 'x', Infinity, day, now) - noon);
  expect(C.editTs([], P, 'x', Infinity, '2026-11-07', now) === now, 'today: now');
  // Two sessions that day, both after noon: a backfill (the next planned one) goes after them both.
  const two = [{ id: 'a', date: day, ts: at(2026, 11, 3, 17) }, { id: 'b', date: day, ts: at(2026, 11, 3, 19) }];
  expect(C.editTs(two, P, 'x', Infinity, day, now) === at(2026, 11, 3, 19) + 1, 'a backfill goes after the sessions already on its date', C.editTs(two, P, 'x', Infinity, day, now));
  // An edit moving a session onto that date keeps its old place: after what was before it, before what was after it.
  const mid = at(2026, 11, 3, 18);
  expect(C.editTs(two, P, 'x', mid, day, now) === at(2026, 11, 3, 17) + 1, 'an edit lands right after the session it ran after, before the one it ran before', C.editTs(two, P, 'x', mid, day, now) - mid);
  expect(C.editTs(two, P, 'x', at(2026, 11, 1, 12), day, now) === noon, 'an edit from an earlier date goes before them (noon is before both)');
  const early = [{ id: 'a', date: day, ts: at(2026, 11, 3, 9) }, { id: 'b', date: day, ts: at(2026, 11, 3, 10) }];
  expect(C.editTs(early, P, 'x', at(2026, 11, 1, 12), day, now) === at(2026, 11, 3, 9) - 1, 'and before them when they are both before noon', C.editTs(early, P, 'x', at(2026, 11, 1, 12), day, now));
  expect(C.editTs(early, P, 'x', Infinity, day, now) === noon, 'a backfill after two morning sessions stays at noon');
  expect(C.editTs(two, P, 'a', two[0].ts, day, now) === noon, 'a session does not order against itself');
  // A restart or a max set by hand that day: the session counts after it.
  const reset = at(2026, 11, 3, 15);
  expect(C.editTs([], { chronicSince: reset, calibBaseTs: 0 }, 'x', Infinity, day, now) === reset + 1, 'after a restart that day');
  expect(C.editTs([], { chronicSince: 0, calibBaseTs: reset }, 'x', Infinity, day, now) === reset + 1, 'after a max reset that day');
  expect(C.backTs({ chronicSince: at(2026, 11, 2, 15), calibBaseTs: 0 }, day, now) === noon, 'a restart on another date does not move it');
  expect(C.editTs([{ id: 'a', date: day, ts: reset + 1 }], { chronicSince: reset, calibBaseTs: 0 }, 'x', 0, day, now) === reset + 1, 'squeezed before a later session, still never before a restart that day');
  expect(C.backTs({ chronicSince: 0, calibBaseTs: reset }, day, now) === reset + 1 && C.backTs({ chronicSince: at(2026, 11, 3, 9), calibBaseTs: 0 }, day, now) === noon, 'backTs: after a reset that day, unless noon already is');
  // No room between two sessions one millisecond apart: never before the one it came after.
  const t0 = noon + 100, tight = [{ id: 'a', date: day, ts: t0 }, { id: 'b', date: day, ts: t0 + 1 }];
  const t = C.editTs(tight, P, 'x', t0 + 0.5, day, now);
  expect(t === t0 + 1, 'never before the session it came after', t - t0);
}

// ---------- cleanW / cleanReps ----------
{
  expect(C.cleanW('102.6') === 102.5 && C.cleanW('102.4') === 102.5 && C.cleanW('45') === 45, 'weights round to a quarter pound');
  expect(C.cleanW('-5') === null && C.cleanW('abc') === null && C.cleanW('Infinity') === null, 'nonsense weights are none');
  expect(C.cleanW('5000') === 2000, 'weights stop at 2000');
  expect(C.cleanReps('7.6') === 8 && C.cleanReps('31') === 30 && C.cleanReps('-1') === null && C.cleanReps('x') === null, 'reps round and stop at 30');
  expect(C.cleanW('') === 0, 'an empty field reads as 0 (app.js checks for empty before calling)');
}

// ---------- oddEntry: the typo check ----------
{
  const st = mk();
  const main = { load: 'bar', lift: 'squat', ex: 'comp_squat', plannedW: 265 }, acc = { load: 'stack', lift: null, ex: 'lat_pulldown', target: 120, repRange: [10, 13] };
  const work = { kind: 'work', w: 265, reps: 5 };
  expect(C.oddEntry(st, main, work, 265, 5) === null, 'the plan itself is not odd');
  expect(C.oddEntry(st, main, work, 245, 5) === null && C.oddEntry(st, main, work, 285, 5) === null, 'a sensible change is not odd');
  const drop = C.oddEntry(st, main, work, 26.5, null);
  expect(drop && drop.field === 'w' && drop.use === 265, 'a dropped digit is asked about, offering the plan', drop);
  expect(C.oddEntry(st, main, work, 2650, null).field === 'w', 'a doubled digit is asked about');
  const under = C.oddEntry(st, main, work, 40, null);
  expect(under && /empty bar/.test(under.msg) && under.use === 265, 'under the empty bar', under);
  expect(C.oddEntry(st, acc, { kind: 'work', w: 120, reps: 10 }, 0, null).msg === '0 lb.', 'zero');
  expect(C.oddEntry(st, main, Object.assign({}, work, { okW: 26.5 }), 26.5, null) === null, 'a weight you confirmed is not asked again');
  expect(C.oddEntry(st, main, { kind: 'warm', w: 135, reps: 5 }, 13.5, 50) === null, 'warm-ups are free');
  expect(C.oddEntry(st, { load: 'bw', lift: null, ex: 'hanging_raise' }, { kind: 'work', w: null, reps: 12 }, 500, null) === null, 'a bodyweight weight is not checked');
  expect(C.oddEntry(st, acc, { kind: 'work', w: 120, reps: 10 }, 230, null) === null && C.oddEntry(st, acc, { kind: 'work', w: 120, reps: 10 }, 250, null).field === 'w', 'accessories get a wider band (half to double)');
  const open = { kind: 'single', w: null, reps: 1, open: true }, rm = st.lifts.squat.oneRM;
  expect(C.oddEntry(st, main, open, Math.round(rm * 0.8), null) === null && C.oddEntry(st, main, open, Math.round(rm * 0.7), null).use === null, 'an open single is checked against the max, with no weight offered');
  const reps = C.oddEntry(st, main, work, null, 18);
  expect(reps && reps.field === 'r' && reps.use === 5, '18 reps for 5 is asked about', reps);
  expect(C.oddEntry(st, main, work, null, 13) === null, '13 for 5 is a real (if odd) set');
  expect(C.oddEntry(st, acc, { kind: 'work', w: 120, reps: 10 }, null, 21) === null && C.oddEntry(st, acc, { kind: 'work', w: 120, reps: 10 }, null, 22).field === 'r', 'a rep range checks against its top');
  expect(C.oddEntry(st, main, Object.assign({}, work, { okR: 18 }), null, 18) === null, 'reps you confirmed are not asked again');
}

// ---------- rebaseExercise: the sets not lifted yet, after a max, TM %, bar or plate change ----------
{
  const plan = (st) => { st.program.dayIdx = 0; const s = E.buildSession(st, 'full'); const e = s.exercises.find(x => x.slotKey === 'squat_primary'); e.plannedW = e.sets.find(x => x.kind === 'work').w; return e; }; // plannedW: set when the session starts
  // A new max: every set not lifted yet moves, typed and lifted ones stay, the effort re-aims, warm-ups follow.
  {
    const st = mk(), e = plan(st);
    const work = e.sets.filter(x => x.kind === 'work'), warm = e.sets.filter(x => x.kind === 'warm');
    work[0].done = true; work[0].actualW = work[0].w; work[1].manualW = true; work[1].actualW = work[1].w + 10; work[2].actualW = work[2].w + 5;
    const lifted = work[0].w, typed = work[1].actualW, oldPlan = e.plannedW, warmBefore = clone(warm);
    E.applyTM(st, 'squat', 395);
    const r = C.rebaseExercise(st, e, false);
    const w2 = e.sets.filter(x => x.kind === 'work');
    expect(e.plannedW > oldPlan && r.moved === w2.length - 2, 'a new max moves the plan and the sets not lifted or typed', { r, oldPlan, now: e.plannedW });
    expect(w2[0].w === lifted && w2[0].done && w2[1].actualW === typed && w2[1].manualW, 'a lifted set and a typed weight stay as they are');
    expect(w2[2].actualW === null && w2[2].w === E.loadRound(st, st.lifts.squat.tm * w2[2].pct), 'a correction on a set not lifted yet gives way to the new plan', w2[2]);
    expect(w2.slice(2).every(x => x.rpeTarget === e.rpeTarget) && e.rpeTarget === E.plannedRPE(e.plannedW / st.lifts.squat.oneRM, w2[0].reps), 'the planned effort follows the new max');
    expect(r.rebuilt && JSON.stringify(e.sets.filter(x => x.kind === 'warm').map(x => x.w)) !== JSON.stringify(warmBefore.map(x => x.w)), 'warm-ups are built for the new plan', r);
  }
  {
    const st = mk(), e = plan(st); e.sets.find(x => x.kind === 'warm').done = true;
    E.applyTM(st, 'squat', 395);
    const warm = clone(e.sets.filter(x => x.kind === 'warm')), r = C.rebaseExercise(st, e, false);
    expect(!r.rebuilt && JSON.stringify(e.sets.filter(x => x.kind === 'warm')) === JSON.stringify(warm), 'warm-ups stay once one is lifted');
  }
  {
    const st = mk({ warmupSets: false }), e = plan(st); E.applyTM(st, 'squat', 395);
    expect(!C.rebaseExercise(st, e, false).rebuilt, 'no warm-ups are built with warm-ups off');
    const st2 = mk(), e2 = plan(st2); E.applyTM(st2, 'squat', 395);
    expect(!C.rebaseExercise(st2, e2, true).rebuilt, 'nor in a test');
  }
  // The same plan after a plate change: the work sets stay; warm-ups the plates cannot make are rebuilt.
  {
    const st = mk(), e = plan(st), work = clone(e.sets.filter(x => x.kind === 'work'));
    const w = e.sets.find(x => x.kind === 'warm' && x.w > st.settings.barWeight); w.w += 2.5; // a weight the plates cannot make
    const r = C.rebaseExercise(st, e, false);
    expect(r.moved === 0 && JSON.stringify(e.sets.filter(x => x.kind === 'work')) === JSON.stringify(work), 'the same plan leaves the work sets alone');
    expect(r.rebuilt && e.sets.filter(x => x.kind === 'warm').every(x => E.loadRound(st, x.w) === x.w), 'warm-ups the plates cannot make are built again', e.sets.filter(x => x.kind === 'warm').map(x => x.w));
    const again = clone(e.sets); const r2 = C.rebaseExercise(st, e, false);
    expect(!r2.rebuilt && r2.moved === 0 && JSON.stringify(e.sets) === JSON.stringify(again), 'and once they are loadable, nothing changes');
    const typedWarm = e.sets.find(x => x.kind === 'warm' && x.w > st.settings.barWeight); typedWarm.w += 2.5; typedWarm.manualW = true;
    expect(!C.rebaseExercise(st, e, false).rebuilt, 'a warm-up you typed is yours, even off the plates');
  }
  // Strength week 3's opener single on the same plan: re-rounded to the plates; carried weights keep pointing at their set.
  {
    const st = mk(); st.program.blockIdx = E.BLOCKS.findIndex(b => b.id === 'strength'); st.program.macroPos = E.MACRO.findIndex(m => m.block === 'strength'); st.program.week = 3;
    const e = plan(st), single = e.sets.find(x => x.kind === 'single');
    expect(!!single, 'Strength week 3 opens with a single');
    if (single) {
      const right = single.w; single.w += 1.25;
      const work = e.sets.filter(x => x.kind === 'work'); work[2].carriedFrom = e.sets.indexOf(work[1]); work[2].manualW = true; work[1].manualW = true; work[1].actualW = work[2].actualW = work[1].w + 5;
      const target = e.sets.indexOf(work[1]);
      e.sets.find(x => x.kind === 'warm' && x.w > st.settings.barWeight).w += 2.5;
      const nWarm = e.sets.filter(x => x.kind === 'warm').length, r = C.rebaseExercise(st, e, false);
      const nWarm2 = e.sets.filter(x => x.kind === 'warm').length;
      expect(single.w === right, 'the opener single is re-rounded on the same plan', { was: right, now: single.w });
      expect(r.rebuilt && work[2].carriedFrom === target + (nWarm2 - nWarm) && e.sets[work[2].carriedFrom] === work[1], 'a carried weight still points at the set it came from after the warm-ups change', { from: work[2].carriedFrom, nWarm, nWarm2 });
    }
  }
  // A much higher max adds a warm-up step: a carried weight shifts with the list.
  {
    const st = mk(); st.program.blockIdx = E.BLOCKS.findIndex(b => b.id === 'strength'); st.program.macroPos = E.MACRO.findIndex(m => m.block === 'strength'); st.program.week = 3;
    const e = plan(st), work = e.sets.filter(x => x.kind === 'work');
    work[1].manualW = true; work[1].actualW = work[1].w + 5; work[2].manualW = true; work[2].actualW = work[1].actualW; work[2].carriedFrom = e.sets.indexOf(work[1]);
    const nWarm = e.sets.filter(x => x.kind === 'warm').length; E.applyTM(st, 'squat', 600); C.rebaseExercise(st, e, false);
    expect(e.sets.filter(x => x.kind === 'warm').length === nWarm + 1 && e.sets[work[2].carriedFrom] === work[1], 'a carried weight follows its set when a warm-up is added', work[2].carriedFrom);
  }
  expect(C.rebaseExercise(mk(), { lift: null, ex: 'lat_pulldown', sets: [] }, false) === null, 'accessories are not rebased');
}

// ---------- packState: the per-session cache gives exactly pack()'s bytes ----------
{
  const st = mk();
  for (let i = 0; i < 8; i++) { st.program.dayIdx = i % 4; const s = E.buildSession(st, 'full'); Object.assign(s, { id: 'p' + i, ts: 100 + i, date: '2026-01-0' + (i + 1), mesoCount: 0, blockIdx: 0, dayIdx: i % 4, skippedSlots: [], post: { difficulty: 2 }, savedAt: 200 + i }); s.exercises.forEach(e => e.sets.forEach((x, j) => { x.done = j % 4 !== 3; x.actualW = j === 2 ? (x.w || 0) + 5 : x.w; x.actualReps = j === 1 ? x.reps - 1 : x.reps; x.rpe = j === 2 ? 8 : null; })); st.sessions.push(s); }
  const clean = E.sanitizeState(JSON.parse(JSON.stringify(st)), { trusted: true });
  expect(C.packState(clean) === C.pack(clean), 'cached pack = uncached pack');
  expect(C.packState(clean) === C.pack(clean), 'and again, from the cache');
  const last = clean.sessions[clean.sessions.length - 1];
  last.soreness = { legs: 2, push: 1, hinge: 3 };
  expect(C.packState(clean) !== C.pack(clean), 'an untouched change is not seen by the cache (why saveNow writes an uncached pack on the way out)');
  C.touchSession(last);
  expect(C.packState(clean) === C.pack(clean), 'a touched change is');
  clean.current = E.buildSession(clean, 'full'); Object.assign(clean.current, { id: 'c1', ts: 999, date: '2026-01-20', phase: 'lift', startedAt: 999, skippedSlots: [] });
  clean.current.exercises[0].sets[0].done = true; clean.current.exercises[0].sets[0].actualW = clean.current.exercises[0].sets[0].w; clean.current.exercises[0].sets[0].actualReps = clean.current.exercises[0].sets[0].reps;
  expect(C.packState(clean) === C.pack(clean), 'with a session in progress too');
  const stored = JSON.parse(C.pack(clean));
  expect(stored.sessions.every(s => s.pk === 1) && !stored.current.pk && stored.current.exercises[0].sets[0].actualW != null, 'finished sessions are compacted, the open one never');
  expect(JSON.stringify(E.sanitizeState(JSON.parse(C.pack(clean)), { trusted: true })) === JSON.stringify(E.sanitizeState(JSON.parse(JSON.stringify(clean)), { trusted: true })), 'and it all loads back the same');
  const sess = clean.sessions[0], comp = C.compactSession(sess);
  expect(comp !== sess && comp.pk === 1 && sess.pk === undefined && sess.exercises[0].sets.some(x => x.actualW != null), 'compacting copies: the session in memory keeps its values');
  const oldSet = clone(sess); oldSet.exercises[0].sets.find(x => x.done && x.w != null).actualW = null;
  expect(C.compactSession(oldSet) === oldSet, 'a session with a done set and no weight on record is stored as it is');
}

// ---------- The layoff rule's tiers ----------
{
  expect([6, 13, 14, 20, 21, 41, 42, 400].map(C.layoffTier).join() === '1,1,2,2,3,3,4,4', 'tiers at 14, 21 and 42 days', [6, 13, 14, 20, 21, 41, 42, 400].map(C.layoffTier));
  expect(JSON.stringify(C.layoffHandled('2026-10-01:2:1', '2026-10-01')) === '{"tier":2,"cut":1}', 'what was taken for this gap');
  expect(JSON.stringify(C.layoffHandled('2026-10-01', '2026-10-01')) === '{"tier":3,"cut":0}', 'an older bare date stays handled as tier 3');
  expect(JSON.stringify(C.layoffHandled('2026-09-01:4:2', '2026-10-01')) === '{"tier":0,"cut":0}', 'another gap starts fresh');
  expect(JSON.stringify(C.layoffHandled(null, '2026-10-01')) === '{"tier":0,"cut":0}', 'nothing taken');
  const plain = { isRest: false, isDeload: false }, easy = { isRest: true, isDeload: false }, dl = { isRest: false, isDeload: true };
  expect(!C.layoffOffer(6, 0, plain) && C.layoffOffer(7, 0, plain), 'offered from 7 days');
  expect(!C.layoffOffer(10, 0, easy) && !C.layoffOffer(10, 0, dl) && C.layoffOffer(14, 0, dl), 'a deload or easy week covers a short gap, not a long one');
  expect(!C.layoffOffer(10, 1, plain) && C.layoffOffer(15, 1, plain) && !C.layoffOffer(15, 2, plain) && C.layoffOffer(45, 3, plain), 'offered again only when the gap reaches a higher tier');
}

// ---------- F26: the claude.ai copy's merge, with a stubbed account store ----------
function stubDb(state, sessions, opts) {
  const docs = new Map(); if (state) docs.set('app/state', clone(state)); for (const s of sessions || []) docs.set('sessions/' + s.id, clone(s));
  const o = opts || {}, log = [];
  const db = {
    docs, log,
    doc: (p) => ({ get: async () => { if (o.failGet) throw new Error('offline'); if (o.hang) return new Promise(() => {}); return { exists: docs.has(p), data: () => clone(docs.get(p)) }; }, set: async (v) => { log.push(['set', p]); docs.set(p, clone(v)); }, delete: async () => { log.push(['delete', p]); if (o.failDelete) throw new Error('lost'); docs.delete(p); } }),
    collection: (c) => ({ limit: () => ({ get: async () => ({ docs: [...docs.keys()].filter(k => k.startsWith(c + '/')).map(k => ({ data: () => clone(docs.get(k)) })) }) }) }),
  };
  return db;
}
// What Store.init then writes (app.js applies the same three lists through its chain).
async function apply(db, m) {
  if (m.pushAll && m.state) { const copy = Object.assign({}, m.state); delete copy.sessions; await db.doc('app/state').set(copy); for (const x of m.state.sessions || []) await db.doc('sessions/' + x.id).set(x); }
  for (const x of m.pushSessions) await db.doc('sessions/' + x.id).set(x);
  for (const id of m.deleteIds) await db.doc('sessions/' + id).delete().catch(() => {});
}
// The merge as it was before the deleted-id list (frozen): with no list anywhere, the new one must agree.
function oldMerge(local, remote, remoteSessions) {
  const localSessions = (local && Array.isArray(local.sessions)) ? local.sessions : [];
  const byId = new Map(); for (const x of remoteSessions.concat(localSessions)) { if (!x || !x.id) continue; const o = byId.get(x.id); if (!o || (x.savedAt || x.ts || 0) > (o.savedAt || o.ts || 0)) byId.set(x.id, x); }
  const merged = Array.from(byId.values()).sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const localNewer = local && (local.updatedAt || 0) > (remote.updatedAt || 0);
  return { state: Object.assign({}, localNewer ? local : remote, { sessions: merged }), pushAll: !!localNewer, pushSessions: localSessions.filter(x => { const r = remoteSessions.find(y => y && y.id === x.id); return !r || (x.savedAt || x.ts || 0) > (r.savedAt || r.ts || 0); }) };
}
const S = (id, ts, extra) => Object.assign({ id, ts, date: '2026-10-0' + ts, savedAt: ts * 10, exercises: [] }, extra || {});
let finished = false;
process.on('exit', (code) => { if (!finished && code === 0) { console.log('FAIL the async checks never finished (a promise hung)'); process.exitCode = 1; } });
(async () => {
  // noteDeleted / noteLive
  let l = C.noteDeleted(undefined, 'a'); l = C.noteDeleted(l, 'b'); l = C.noteDeleted(l, 'a');
  expect(l.join() === 'b,a', 'a deleted id is listed once, newest last', l);
  for (let i = 0; i < 400; i++) l = C.noteDeleted(l, 's' + i);
  expect(l.length === C.DELETED_CAP && l[l.length - 1] === 's399' && !l.includes('a'), 'the list keeps the newest 300', l.length);
  expect(C.noteLive(['a', 'b', 'c'], ['b']).join() === 'a,c' && C.noteLive(['a', 'b'], 'a').join() === 'b' && C.noteLive(undefined, 'a').length === 0, 'a live session comes off the list');
  // The sanitizer: kept (the newest 300, valid ids only) when there are any; absent otherwise, so the phone app stores what it always did.
  const sd = E.sanitizeState({ deletedIds: ['s_1', 's_1', 'bad id!', 5, 's_2'] }, { trusted: true });
  expect(!('deletedIds' in E.sanitizeState({ deletedIds: ['s_1'] })) && !('deletedIds' in E.sanitizeState({ deletedIds: ['s_1'] }, { trusted: false })), 'a backup or pasted state cannot bring a list of sessions to delete');
  expect(JSON.stringify(sd.deletedIds) === '["s_1","s_2"]', 'the sanitizer keeps valid ids once', sd.deletedIds);
  expect(!('deletedIds' in E.sanitizeState({})) && !('deletedIds' in E.sanitizeState({ deletedIds: [] })), 'no list, no key');
  expect(E.sanitizeState({ deletedIds: Array.from({ length: 900 }, (_, i) => 's' + i) }, { trusted: true }).deletedIds.length === 300, 'capped on load too');
  { // An open edit of a logged session keeps the names it was logged under, like the stored session (a reload mid-edit used to rename a sumo pull)
    const sumo = E.exerciseName(E.sanitizeState({ settings: { deadliftStyle: 'sumo' }, setupDone: true }), 'comp_deadlift'), conv = E.exerciseName(E.sanitizeState({ settings: { deadliftStyle: 'conventional' }, setupDone: true }), 'comp_deadlift');
    const sess = (phase) => ({ id: 's_9', date: '2026-01-02', ts: 1, phase, exercises: [{ ex: 'comp_deadlift', slotKey: 'deadlift_primary', name: sumo, sets: [{ kind: 'work', w: 300, reps: 5, done: true }] }] });
    const st = E.sanitizeState({ setupDone: true, lifts: { squat: { oneRM: 365 }, bench: { oneRM: 255 }, deadlift: { oneRM: 425 } }, settings: { deadliftStyle: 'conventional' }, sessions: [sess(undefined)], current: Object.assign(sess('edit'), { editOf: 's_9' }) }, { trusted: true });
    expect(sumo !== conv && st.sessions[0].exercises[0].name === sumo && st.current && st.current.exercises[0].name === sumo, 'an open edit keeps the logged exercise names', [sumo, conv, st.current && st.current.exercises[0].name]);
  }
  { // Audit 13: a backup or pasted state can never carry an Undo; the typo check's main-lift band is 60%-140% of the plan.
    const snap = JSON.stringify({ program: {}, lifts: {} });
    expect(E.sanitizeState({ setupDone: true, undo: { label: 'x', snap, removeSessionId: 's_1' } }).undo === null && !!E.sanitizeState({ setupDone: true, undo: { label: 'x', snap } }, { trusted: true }).undo, 'only the device storage keeps an Undo');
    const st = mk(), e = { lift: 'squat', load: 'bar', ex: 'comp_squat' }, x = { kind: 'work', w: 200, reps: 5 };
    const odd = (w) => C.oddEntry(st, e, x, w, null);
    expect(!odd(280) && !!odd(280.5) && !odd(120) && !!odd(119.5), 'main-lift weights are checked outside 60%-140% of the plan', [odd(280), odd(280.5), odd(120), odd(119.5)].map(o => !!o));
    // A planned test line you make is a floor for the new max (decision 4), so it gets the open single's 115%-of-max bound too.
    const rm = st.lifts.squat.oneRM, line = { kind: 'test', w: 340, reps: 1, rpeTarget: 8.5 }, tOdd = (w, y) => C.oddEntry(st, e, y || line, w, null);
    const hi = rm * 1.15, at = tOdd(Math.floor(hi)), over = tOdd(Math.ceil(hi + 0.25));
    expect(!at && !!over && over.use === 340 && !tOdd(204) && !!tOdd(203.5) && !tOdd(Math.ceil(hi + 0.25), Object.assign({}, line, { okW: Math.ceil(hi + 0.25) })), 'a planned test line over 115% of the max is asked about (the plan is offered); the 60% bound and a kept weight are unchanged', [rm, !!at, over, !!tOdd(204), !!tOdd(203.5)]);
  }
  const phone = mk(); expect(C.pack(E.sanitizeState(JSON.parse(C.pack(phone)), { trusted: true })) === C.pack(phone) && !C.pack(phone).includes('deletedIds'), 'the phone app stores no list');

  // 1. Deleted here, the delete never reached the account: it does not come back, and the delete is sent again.
  {
    const remote = { updatedAt: 100, deletedIds: undefined }, sess = [S('s1', 1), S('s2', 2), S('s3', 3)];
    const db = stubDb(remote, sess, { failDelete: true });
    const local = { updatedAt: 200, sessions: [S('s1', 1), S('s3', 3)], deletedIds: ['s2'] };
    const m = await C.accountOpen(db, local, 1000);
    expect(m.state.sessions.map(x => x.id).join() === 's1,s3', 'a delete that never landed stays deleted', m.state.sessions.map(x => x.id));
    expect(m.deleteIds.join() === 's2' && JSON.stringify(m.state.deletedIds) === '["s2"]', 'and is sent again, still listed', m);
    await apply(db, m);
    expect(db.log.some(([k, p]) => k === 'delete' && p === 'sessions/s2'), 'the stub saw the retry');
    // Before the fix (the frozen merge), it came back.
    expect(oldMerge(local, remote, sess).state.sessions.some(x => x.id === 's2'), 'control: the old merge brought it back');
    // The next open, the delete still failing: still gone.
    const m2 = await C.accountOpen(db, Object.assign({}, m.state, { updatedAt: 300 }), 1000);
    expect(!m2.state.sessions.some(x => x.id === 's2'), 'and on every open after');
  }
  // 2. Deleted, then put back by Undo (noteLive): it is kept and pushed.
  {
    const db = stubDb({ updatedAt: 100 }, [S('s1', 1), S('s2', 2)]);
    let ids = C.noteDeleted(undefined, 's2'); ids = C.noteLive(ids, 's2');
    const local = { updatedAt: 200, sessions: [S('s1', 1), S('s2', 2, { savedAt: 99 })], deletedIds: ids };
    const m = await C.accountOpen(db, local, 1000);
    expect(m.state.sessions.some(x => x.id === 's2') && m.deleteIds.length === 0 && m.state.deletedIds.length === 0, 'a session Undo put back stays', m);
  }
  // 3. A session the newer local copy holds is never dropped by its own list (a list that went wrong).
  {
    const db = stubDb({ updatedAt: 100 }, [S('s1', 1), S('s2', 2)]);
    const m = await C.accountOpen(db, { updatedAt: 200, sessions: [S('s1', 1), S('s2', 2)], deletedIds: ['s2'] }, 1000);
    expect(m.state.sessions.some(x => x.id === 's2') && m.deleteIds.length === 0 && m.state.deletedIds.length === 0, 'the local copy wins over its own stale list', m);
  }
  // 4. Deleted on another device (the account's state is newer and lists it): dropped here too.
  {
    const db = stubDb({ updatedAt: 300, deletedIds: ['s2'] }, [S('s1', 1), S('s2', 2)]);
    const m = await C.accountOpen(db, { updatedAt: 200, sessions: [S('s1', 1), S('s2', 2)] }, 1000);
    expect(!m.state.sessions.some(x => x.id === 's2') && m.pushSessions.every(x => x.id !== 's2') && m.deleteIds.join() === 's2', "another device's delete holds here", m);
  }
  // 5. A backup restore that brings a deleted session back: off the list (app.js applyRestore runs noteLive over the backup's sessions).
  {
    const restored = C.noteLive(['s2', 's9'], [S('s1', 1), S('s2', 2)].map(x => x.id));
    const db = stubDb({ updatedAt: 100 }, [S('s1', 1)]);
    const m = await C.accountOpen(db, { updatedAt: 200, sessions: [S('s1', 1), S('s2', 2)], deletedIds: restored }, 1000);
    expect(m.state.sessions.some(x => x.id === 's2') && m.pushSessions.some(x => x.id === 's2') && JSON.stringify(m.state.deletedIds) === '["s9"]', 'a restored session is live again, and pushed', m);
  }
  // 6. No list anywhere: exactly the old merge.
  for (let round = 0; round < 200; round++) {
    const ids = ['a', 'b', 'c', 'd', 'e'], rnd = (k) => (round * 7919 + k * 104729) % 97;
    const remoteS = ids.filter((x, k) => rnd(k) % 3 !== 0).map((x, k) => S(x, k + 1, { savedAt: rnd(k + 10) }));
    const localS = ids.filter((x, k) => rnd(k + 20) % 3 !== 0).map((x, k) => S(x, k + 1, { savedAt: rnd(k + 30) }));
    const local = round % 5 === 0 ? null : { updatedAt: rnd(40), sessions: localS }, remote = { updatedAt: rnd(41) };
    const a = C.mergeAccount(local, remote, remoteS), b = oldMerge(local, remote, remoteS);
    expect(JSON.stringify([a.state, a.pushAll, a.pushSessions]) === JSON.stringify([b.state, b.pushAll, b.pushSessions]) && a.deleteIds.length === 0, 'with no deleted list the merge is the old one', { round });
  }
  // 7. A fresh account, and failures: nothing is written after a failed or slow read.
  {
    const m = await C.accountOpen(stubDb(null, []), { updatedAt: 5, sessions: [S('s1', 1)] }, 1000);
    expect(m.pushAll && m.state.sessions.length === 1, 'an empty account gets everything');
    let threw = false; try { await C.accountOpen(stubDb({ updatedAt: 1 }, [], { failGet: true }), null, 1000); } catch (e) { threw = true; }
    expect(threw, 'a failed read throws (the caller writes nothing)');
    threw = false; const t0 = Date.now(); try { await C.accountOpen(stubDb({ updatedAt: 1 }, [], { hang: true }), null, 50); } catch (e) { threw = /timeout/.test(e.message); }
    expect(threw && Date.now() - t0 < 1000, 'a read that hangs times out');
  }
  finished = true;
  console.log(`${checks} checks, ${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
