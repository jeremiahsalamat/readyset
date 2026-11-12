/* ReadySet interface core: the storage packer and a few decisions of the interface, kept apart from
   app.js as plain functions of their inputs (no page, no globals) so tests/app_units.js can run them
   in node. app.js calls these; build.py inlines this file between the sanitizer and app.js. */
(function (root) {
  'use strict';
  const E = root.Engine;

  // ---------- Storage packing ----------
  // What is stored leaves out everything the sanitizer rebuilds on load: nulls, empty strings,
  // flags whose missing value already means false (never the three that default to true), zero
  // counters, and exercise text that comes from the catalog. No deep copy is made on every tap.
  const DROP_FALSE = new Set(['ind', 'open', 'done', 'manualW', 'hitFloor', 'autoStopped', 'needsWeight', 'optional', 'skipped', 'isDeload', 'isTest', 'isRest', 'paused', 'setLightRest', 'calibrated', 'timerSrc', 'autoReps', 'autoW', 'minTyped', 'macroWasFlagged']);
  const DROP_ZERO = new Set(['plus', 'cut']);
  const DROP_ALWAYS = new Set(['cue', 'startHint', 'load']);
  // A finished session also leaves out a done set's weight and reps where they are the plan's own
  // (most sets: about a third of what years of sessions take on disk), and says so with pk: 1; the
  // sanitizer puts them back, so the state in memory is the same as before. Only when that is exact:
  // a done set with no weight or reps on record (an old build's, or a sim's) would come back with
  // the plan's, so such a session is stored as it is. The open session (it has a phase) never is.
  function compactSession(s) {
    let exact = true, saved = false;
    const exercises = s.exercises.map(e => {
      if (!e || !Array.isArray(e.sets)) return e;
      let own = null;
      e.sets.forEach((x, i) => {
        if (!x || x.done !== true) return;
        if ((x.actualW == null && x.w != null) || x.actualReps == null) { exact = false; return; }
        const sameW = x.actualW === x.w, sameR = x.actualReps === x.reps;
        if (!sameW && !sameR) return;
        const y = Object.assign({}, x); if (sameW) delete y.actualW; if (sameR) delete y.actualReps;
        (own = own || e.sets.slice())[i] = y;
      });
      if (!own) return e;
      saved = true; return Object.assign({}, e, { sets: own });
    });
    return exact && saved ? Object.assign({}, s, { exercises, pk: 1 }) : s;
  }
  const isStoredSession = (v) => typeof v.id === 'string' && Array.isArray(v.exercises) && !v.phase;
  function packer(k, v) {
    if (k === 'kind' && v === 'work') return undefined;
    if ((k === 'dayId' || k === 'dayName' || k === 'blockName') && typeof v === 'string') return undefined;
    if (v === null || v === '' || v === undefined) return undefined;
    if (v === false && DROP_FALSE.has(k)) return undefined;
    if (v === 0 && DROP_ZERO.has(k)) return undefined;
    if (DROP_ALWAYS.has(k) && typeof v === 'string') return undefined;
    if (typeof v === 'object' && !Array.isArray(v) && isStoredSession(v)) return compactSession(v);
    return v;
  }
  function pack(v) { return JSON.stringify(v, packer); }
  // The whole state as stored, with each logged session packed once and kept: a set tick then
  // re-packs the program and the open session, not years of history. A logged session is only
  // ever changed in place by touchSession's callers (the next check-in's soreness, a calibration
  // replay); everything else replaces or removes it. The bytes are exactly pack(v)'s, and saveNow
  // writes an uncached pack on the way out after any save, so a missed touch cannot outlive the session.
  const packCache = new WeakMap();
  function touchSession(sess) { if (sess && typeof sess === 'object') packCache.delete(sess); }
  function packState(v) {
    const list = Array.isArray(v.sessions) ? v.sessions : null;
    if (!list || !list.length) return pack(v);
    const parts = new Array(list.length);
    for (let i = 0; i < list.length; i++) {
      const x = list[i];
      let j = x && typeof x === 'object' ? packCache.get(x) : undefined;
      if (j === undefined) { j = JSON.stringify(x, packer); if (j === undefined) j = 'null'; if (x && typeof x === 'object') packCache.set(x, j); }
      parts[i] = j;
    }
    const rest = pack(Object.assign({}, v, { sessions: [] })), at = rest.indexOf('"sessions":[]');
    return at < 0 ? pack(v) : rest.slice(0, at + 12) + parts.join(',') + rest.slice(at + 12);
  }

  // ---------- Dates of sessions logged after the fact ----------
  const isoOf = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }; // the phone's own date, as app.js todayISO
  function noonTs(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d, 12, 0, 0).getTime(); }
  // A past session is stamped noon of its date (now, for today), except on the day of a restart or a
  // max set by hand: there it counts after that moment, as the plan it was logged against does.
  function backTs(program, date, now) {
    let ts = date === isoOf(now) ? now : noonTs(date);
    for (const b of [program.chronicSince, program.calibBaseTs]) if (b && isoOf(b) === date && ts <= b) ts = b + 1;
    return ts;
  }
  // A session put on a date after the fact (a backfill: was = Infinity, it is the next planned one;
  // or an edit that moves it) keeps its place among the sessions already on that date (noon is not
  // always between them), so "Last session", the next soreness answer and the block replay still
  // follow the order the plan ran in.
  function editTs(sessions, program, id, was, date, now) {
    let ts = backTs(program, date, now), lo = -Infinity, hi = Infinity;
    for (const b of [program.chronicSince, program.calibBaseTs]) if (b && isoOf(b) === date) lo = Math.max(lo, b + 1);
    for (const x of sessions) { if (x.id === id || x.date !== date) continue; const t = x.ts || 0; if (t < was) lo = Math.max(lo, t + 1); else hi = Math.min(hi, t); }
    if (ts < lo) ts = lo;
    if (ts >= hi && hi - 1 >= lo) ts = hi - 1;
    return ts;
  }

  // ---------- Typed numbers ----------
  function cleanW(v) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.min(2000, Math.round(n * 4) / 4) : null; }
  function cleanReps(v) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.min(30, Math.round(n)) : null; }
  // A number that is probably a typo (a dropped or doubled digit, a weight under the empty bar, 18
  // reps for 8): asked about once before it can move the next sets or the maxes. Warm-ups are free.
  function oddEntry(state, e, x, w, r) {
    if (x.kind === 'warm') return null;
    if (w != null && e.load !== 'bw' && x.okW !== w) {
      const bar = state.settings.barWeight;
      let msg = null, use = null;
      if (e.load === 'bar' && w < bar) { msg = `${w} lb is lighter than the empty bar (${bar} lb).`; use = x.w != null && x.w >= bar ? x.w : bar; }
      else if (w === 0) { msg = '0 lb.'; use = x.w; }
      else {
        let ref = x.w != null ? x.w : (e.target || e.plannedW || null), lo = 0.6, hi = 1.4;
        if (x.open && e.lift && state.lifts[e.lift]) { ref = state.lifts[e.lift].oneRM * ((E.EX[e.ex] || {}).mult || 1); lo = 0.75; hi = 1.15; }
        else if (!e.lift) { lo = 0.5; hi = 2; }
        else if (x.kind === 'test' && ref > 0 && state.lifts[e.lift] && state.lifts[e.lift].oneRM > 0) hi = Math.min(hi, state.lifts[e.lift].oneRM * ((E.EX[e.ex] || {}).mult || 1) * 1.15 / ref); // a test line you make is a floor for the new max (mesoReview), so over 115% of the max is asked about, as on the open single
        if (ref > 0 && (w < ref * lo || w > ref * hi)) { msg = `${w} lb against a planned ${Math.round(ref * 2) / 2} lb.`; use = x.open ? null : Math.round(ref * 4) / 4; }
      }
      if (msg) return { field: 'w', v: w, msg, use };
    }
    if (r != null && x.reps > 0 && x.okR !== r) {
      const top = e.repRange ? e.repRange[1] : x.reps;
      if (r > top + 8) return { field: 'r', v: r, msg: `${r} reps against a planned ${e.repRange ? e.repRange[0] + '–' + e.repRange[1] : x.reps}.`, use: top };
    }
    return null;
  }

  // ---------- A max, Training Max %, bar or plate change mid-session ----------
  // One main-lift exercise of the open session, rewritten in place: a new plan moves every set not
  // lifted yet (unless its weight was typed) and re-aims the effort; the same plan (a plate or bar
  // change, or another lift's max) only re-rounds the opener single, since the work sets already sit
  // on the plan. Warm-ups are built again for a new plan, or when the plates can no longer make
  // one, unless a warm-up was already lifted (or it is a test, or warm-ups are off). Returns null for
  // an exercise this does not apply to, else { moved: sets moved, rebuilt: warm-ups rebuilt }.
  function rebaseExercise(state, e, isTest) {
    const S = state.settings;
    if (!e.lift || !E.EX[e.ex].tm) return null;
    const tm = state.lifts[e.lift].tm, mult = E.EX[e.ex].mult;
    const first = e.sets.find(x => x.kind === 'work');
    if (!first || first.pct == null) return null;
    let moved = 0, rebuilt = false;
    const planned = E.loadRound(state, tm * mult * first.pct), same = planned === e.plannedW;
    if (same) { // what is not lifted yet must still be a weight the plates make
      e.sets.forEach(x => { if (x.done || x.manualW || x.pct == null || x.kind === 'work') return; x.w = E.loadRound(state, tm * mult * x.pct); }); // the opener single
    } else {
      e.plannedW = planned;
      e.sets.forEach(x => { if (x.done || x.manualW || x.pct == null) return; x.w = E.loadRound(state, tm * mult * x.pct); x.actualW = null; moved++; });
      const one = state.lifts[e.lift].oneRM * mult; // the planned effort follows the new max, so the auto-correction aims right
      if (one > 0 && e.pctTM != null) { const nr = E.plannedRPE(planned / one, first.reps); e.rpeTarget = nr; e.sets.forEach(x => { if (!x.done && x.kind === 'work') x.rpeTarget = nr; }); }
    }
    const unloadable = same && e.sets.some(x => x.kind === 'warm' && !x.done && !x.manualW && x.w != null && E.loadRound(state, x.w) !== x.w);
    if ((!same || unloadable) && !isTest && !e.sets.some(x => x.kind === 'warm' && x.done) && S.warmupSets !== false) {
      const fresh = E.warmups(planned, S.barWeight, S.increment, e.role, S.plates).map(st => ({ w: st.w, reps: st.reps, kind: 'warm', done: false, actualReps: null, rpe: null, actualW: null }));
      const rest = e.sets.filter(x => x.kind !== 'warm'), single = rest.find(x => x.kind === 'single');
      if (single && single.w) { const ws = E.openerWarm(single.w, fresh.length ? fresh[fresh.length - 1].w : S.barWeight, S.barWeight, S.increment, S.plates); if (ws) fresh.push({ w: ws, reps: 1, kind: 'warm', done: false, actualReps: null, rpe: null, actualW: null }); }
      const delta = fresh.length - (e.sets.length - rest.length);
      if (delta) rest.forEach(y => { if (y.carriedFrom != null) y.carriedFrom += delta; });
      e.sets = fresh.concat(rest); rebuilt = true;
    }
    return { moved, rebuilt };
  }

  // ---------- Coming back after a gap ----------
  // Tiers of the layoff rule: 1 under 14 days, 2 for 14-20, 3 for 21-41, 4 from 42.
  function layoffTier(gap) { return gap >= 42 ? 4 : gap >= 21 ? 3 : gap >= 14 ? 2 : 1; }
  // What was already taken for the gap after `newest`: "date:tier:cut"; an older bare date stays
  // handled (as tier 3), as it always was.
  function layoffHandled(handled, newest) { const [d, t, c] = String(handled || '').split(':'); return d === newest ? { tier: Number(t) || 3, cut: Number(c) || 0 } : { tier: 0, cut: 0 }; }
  // Offer the rule once per gap and tier: from 7 days, and a deload or easy week is light enough for a
  // short gap, not for a long one.
  function layoffOffer(gap, handledTier, pos) { return gap >= 7 && layoffTier(gap) > handledTier && (gap >= 14 || (!pos.isRest && !pos.isDeload)); }

  // ---------- The claude.ai copy: the account store (window.claude.use('db')) ----------
  // Only the artifact build has an account store; the phone app never calls these. Sessions merge by
  // id, so a delete that never reached the store would come back on the next open. The state keeps
  // the ids it deleted (the newest 300) and the merge leaves those out; a session put back by Undo
  // or a backup restore comes off the list.
  const DELETED_CAP = 300;
  function noteDeleted(list, id) { return (Array.isArray(list) ? list.filter(x => x !== id) : []).concat(id).slice(-DELETED_CAP); }
  function noteLive(list, ids) { const live = new Set([].concat(ids)); return (Array.isArray(list) ? list : []).filter(x => !live.has(x)); }
  // local: this browser's copy (or null); remote: the account's state document; remoteSessions: its
  // sessions. The newer state is adopted, and its list of deleted ids is the one that counts; a
  // session the adopted local copy still holds is never dropped by it. Returns the merged state and
  // the writes that bring the account up to date.
  function mergeAccount(local, remote, remoteSessions) {
    const localSessions = (local && Array.isArray(local.sessions)) ? local.sessions : [];
    const localNewer = !!local && (local.updatedAt || 0) > (remote.updatedAt || 0);
    const adopted = localNewer ? local : remote;
    const localIds = new Set(localSessions.map(x => x && x.id));
    const listed = Array.isArray(adopted.deletedIds) ? adopted.deletedIds.filter(id => typeof id === 'string') : null;
    const gone = new Set((listed || []).filter(id => !(localNewer && localIds.has(id))));
    // Sessions are merged by id, never replaced, so a push that failed cannot lose one.
    const byId = new Map(); for (const x of remoteSessions.concat(localSessions)) { if (!x || !x.id || gone.has(x.id)) continue; const o = byId.get(x.id); if (!o || (x.savedAt || x.ts || 0) > (o.savedAt || o.ts || 0)) byId.set(x.id, x); }
    const merged = Array.from(byId.values()).sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const state = Object.assign({}, adopted, { sessions: merged });
    if (listed) state.deletedIds = listed.filter(id => gone.has(id));
    const newerHere = (x) => { const r = remoteSessions.find(y => y && y.id === x.id); return !r || (x.savedAt || x.ts || 0) > (r.savedAt || r.ts || 0); };
    const pushSessions = localSessions.filter(x => x && x.id && !gone.has(x.id) && newerHere(x));
    const deleteIds = remoteSessions.filter(x => x && x.id && gone.has(x.id)).map(x => x.id); // the deletes that did not land, again
    return { state, pushAll: localNewer, pushSessions, deleteIds };
  }
  // Both reads, then the merge. Throws on a failed or slow read, so the caller writes nothing.
  async function accountOpen(db, local, ms) {
    const timeout = (p) => { let t; return Promise.race([p, new Promise((res, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); })]).finally(() => clearTimeout(t)); };
    const snap = await timeout(db.doc('app/state').get());
    if (!snap.exists) return { state: local, pushAll: !!local, pushSessions: [], deleteIds: [] };
    const remote = snap.data();
    const q = await timeout(db.collection('sessions').limit(5000).get());
    return mergeAccount(local, remote, q.docs.map(d => d.data()));
  }

  root.AppCore = { compactSession, packer, pack, packState, touchSession, isoOf, noonTs, backTs, editTs, cleanW, cleanReps, oddEntry, rebaseExercise, layoffTier, layoffHandled, layoffOffer, noteDeleted, noteLive, mergeAccount, accountOpen, DELETED_CAP };
})(typeof window !== 'undefined' ? window : globalThis);
