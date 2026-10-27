/* Readyset state sanitizer. Every state object that comes from outside the running page
   (localStorage, a pasted backup, the cloud gist, the artifact store) passes through here before
   use. It rebuilds a fresh state from a whitelist of fields, coerces every value to its type and
   range, and drops anything unknown, so a corrupted or tampered backup can neither crash the page
   nor inject markup, and no prototype keys ever reach the live state. */
(function (root) {
  'use strict';
  const E = root.Engine;
  const LIFTS = ['squat', 'bench', 'deadlift'];
  const SLOT_KEYS = Object.keys(E.SWAPS);
  const BLOCK_IDS = E.BLOCKS.map(b => b.id).concat('rest');
  const own = (o, k) => o != null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
  const get = (o, k) => (own(o, k) ? o[k] : undefined);
  const isObj = (o) => o != null && typeof o === 'object' && !Array.isArray(o);
  function num(v, min, max, def) { const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v; if (typeof n !== 'number' || !Number.isFinite(n)) return def; return Math.min(max, Math.max(min, n)); }
  function int(v, min, max, def) { const n = num(v, min, max, def); return n == null ? n : Math.round(n); }
  function bool(v) { return v === true; }
  function str(v, max, def) { if (typeof v !== 'string') return def == null ? '' : def; return v.length > max ? v.slice(0, max) : v; }
  function oneOf(v, list, def) { return list.includes(v) ? v : def; }
  function dateStr(v, def) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : def; }
  function idStr(v, def) { return typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : def; }
  function numOrNull(v, min, max) { const n = num(v, min, max, null); return n; }

  function sanitizeSet(x) {
    if (!isObj(x)) return null;
    const kind = oneOf(get(x, 'kind'), ['warm', 'work', 'backoff', 'test'], 'work');
    const reps = int(get(x, 'reps'), 0, 50, 5);
    return {
      w: numOrNull(get(x, 'w'), 0, 2000), reps, pct: numOrNull(get(x, 'pct'), 0, 2), kind,
      ind: bool(get(x, 'ind')), plus: int(get(x, 'plus'), 0, 5, 0), rpeTarget: numOrNull(get(x, 'rpeTarget'), 1, 10), open: bool(get(x, 'open')),
      done: bool(get(x, 'done')), actualW: numOrNull(get(x, 'actualW'), 0, 2000), actualReps: numOrNull(get(x, 'actualReps'), 0, 50) == null ? null : int(get(x, 'actualReps'), 0, 50, null),
      rpe: numOrNull(get(x, 'rpe'), 5, 10), manualW: bool(get(x, 'manualW')), doneAt: numOrNull(get(x, 'doneAt'), 0, 4e12),
    };
  }
  function sanitizeExercise(e, state) {
    if (!isObj(e)) return null;
    const exId = get(e, 'ex');
    if (!own(E.EX, exId)) return null;
    const ex = E.EX[exId];
    const slotKey = oneOf(get(e, 'slotKey'), SLOT_KEYS, null);
    if (!slotKey) return null;
    const sets = (Array.isArray(get(e, 'sets')) ? get(e, 'sets') : []).slice(0, 40).map(sanitizeSet).filter(Boolean);
    const role = oneOf(get(e, 'role'), ['primary', 'secondary', 'accessory'], 'accessory');
    const lift = oneOf(get(e, 'lift'), LIFTS, null);
    const rr = get(e, 'repRange');
    const out = {
      slotKey, ex: exId, name: E.exerciseName(state, exId), role, lift: ex.tm ? lift : null, load: ex.load, optional: bool(get(e, 'optional')), cue: ex.cue || null, sets,
      rest: int(get(e, 'rest'), 15, 900, 90), pctTM: numOrNull(get(e, 'pctTM'), 0, 2), rpeTarget: numOrNull(get(e, 'rpeTarget'), 1, 10), plannedW: numOrNull(get(e, 'plannedW'), 0, 2000),
      target: numOrNull(get(e, 'target'), 0, 2000), est: numOrNull(get(e, 'est'), 0, 3000), hitFloor: bool(get(e, 'hitFloor')), cut: int(get(e, 'cut'), 0, 20, 0),
      repRange: Array.isArray(rr) && rr.length === 2 ? [int(rr[0], 1, 50, 10), int(rr[1], 1, 50, 13)] : null,
      needsWeight: bool(get(e, 'needsWeight')), startHint: ex.startHint || null, adjNote: str(get(e, 'adjNote'), 240, null) || null, note: str(get(e, 'note'), 240, null) || null,
    };
    return out;
  }
  function sanitizeSession(s, state) {
    if (!isObj(s)) return null;
    const id = idStr(get(s, 'id'), null); if (!id) return null;
    const blockIdx = int(get(s, 'blockIdx'), 0, E.BLOCKS.length - 1, 0), dayIdx = int(get(s, 'dayIdx'), 0, E.DAYS.length - 1, 0);
    const blockId = oneOf(get(s, 'block'), BLOCK_IDS, E.BLOCKS[blockIdx].id);
    const r = get(s, 'readiness'), p = get(s, 'post'), c = get(s, 'cardio'), so = get(s, 'soreness');
    const out = {
      id, ts: num(get(s, 'ts'), 0, 4e12, 0), date: dateStr(get(s, 'date'), '2000-01-01'), skipped: bool(get(s, 'skipped')),
      mesoCount: int(get(s, 'mesoCount'), 0, 10000, 0), blockIdx, dayIdx, week: int(get(s, 'week'), 1, 12, 1),
      block: blockId, blockName: blockId === 'rest' ? 'Easy week' : E.BLOCKS[blockIdx].name, dayId: E.DAYS[dayIdx].id, dayName: E.DAYS[dayIdx].name,
      mode: oneOf(get(s, 'mode'), Object.keys(E.MODES), 'full'), isDeload: bool(get(s, 'isDeload')), isTest: bool(get(s, 'isTest')), isRest: bool(get(s, 'isRest')) || blockId === 'rest',
      readiness: isObj(r) ? { score: int(get(r, 'score'), 0, 100, 50), color: oneOf(get(r, 'color'), ['green', 'yellow', 'red'], 'yellow') } : null,
      post: isObj(p) ? { difficulty: int(get(p, 'difficulty'), 0, 4, 0) } : null,
      cardio: isObj(c) ? { min: int(get(c, 'min'), 0, 600, 0), watts: numOrNull(get(c, 'watts'), 0, 2000), kcal: int(get(c, 'kcal'), 0, 10000, 0) } : null,
      durationMin: int(get(s, 'durationMin'), 0, 600, 0), notes: str(get(s, 'notes'), 1000), calibrated: bool(get(s, 'calibrated')),
      skippedSlots: (Array.isArray(get(s, 'skippedSlots')) ? get(s, 'skippedSlots') : []).filter(k => SLOT_KEYS.includes(k)).slice(0, 10),
      soreness: isObj(so) ? { legs: int(get(so, 'legs'), 1, 4, 1), push: int(get(so, 'push'), 1, 4, 1), hinge: int(get(so, 'hinge'), 1, 4, 1) } : null,
      exercises: (Array.isArray(get(s, 'exercises')) ? get(s, 'exercises') : []).slice(0, 12).map(e => sanitizeExercise(e, state)).filter(Boolean),
      notesList: undefined,
    };
    delete out.notesList;
    const pn = get(s, 'planNotes');
    out.planNotes = Array.isArray(pn) ? pn.slice(0, 4).map(x => str(x, 200)).filter(Boolean) : [];
    const phase = oneOf(get(s, 'phase'), ['lift', 'post', 'cardio'], null);
    if (phase) {
      out.phase = phase; out.startedAt = num(get(s, 'startedAt'), 0, 4e12, Date.now()); out.finishedAt = numOrNull(get(s, 'finishedAt'), 0, 4e12);
      out.cardioMin = int(get(s, 'cardioMin'), 0, 600, 0); out.estMinutes = int(get(s, 'estMinutes'), 0, 600, 0);
      out.setLightRest = bool(get(s, 'setLightRest'));
      const cr = get(s, 'cardioRun');
      out.cardioRun = isObj(cr) ? { start: num(get(cr, 'start'), 0, 4e12, 0), pausedTotal: num(get(cr, 'pausedTotal'), 0, 4e12, 0), paused: bool(get(cr, 'paused')), pausedAt: numOrNull(get(cr, 'pausedAt'), 0, 4e12) } : null;
    }
    return out;
  }
  // opts.trusted: true only for the device's own storage; anything pasted, shared or fetched is
  // untrusted and can never carry a cloud token, a gist id or an undo snapshot.
  function sanitizeState(raw, opts) {
    const trusted = !!(opts && opts.trusted);
    const d = E.defaultState();
    if (!isObj(raw)) return d;
    const S = isObj(get(raw, 'settings')) ? get(raw, 'settings') : {};
    const s = d.settings;
    s.units = 'lb';
    s.barWeight = num(get(S, 'barWeight'), 5, 100, 45);
    const PL = [55, 45, 35, 25, 15, 10, 5, 2.5, 1.25];
    const plates = Array.isArray(get(S, 'plates')) ? get(S, 'plates').map(Number).filter(p => PL.includes(p)) : [];
    s.plates = (plates.length ? Array.from(new Set(plates)) : [45, 35, 25, 10, 5, 2.5]).sort((a, b) => b - a);
    s.increment = s.plates.includes(1.25) ? 2.5 : s.plates.includes(2.5) ? 5 : 10;
    s.dbIncrement = oneOf(num(get(S, 'dbIncrement'), 1, 10, 5), [2.5, 5], 5);
    s.tmPct = oneOf(num(get(S, 'tmPct'), 0.5, 1, 0.9), [0.85, 0.875, 0.9, 0.925], 0.9);
    s.deadliftStyle = oneOf(get(S, 'deadliftStyle'), ['conventional', 'sumo'], 'conventional');
    s.squatStyle = oneOf(get(S, 'squatStyle'), ['lowbar', 'highbar'], 'lowbar');
    s.cardioMin = int(get(S, 'cardioMin'), 0, 240, 60);
    s.cardioWatts = int(get(S, 'cardioWatts'), 30, 600, 110);
    s.warmupSets = get(S, 'warmupSets') !== false;
    s.autoCalibrate = get(S, 'autoCalibrate') !== false;
    s.notify = bool(get(S, 'notify'));
    s.includePeak = get(S, 'includePeak') !== false;
    const DAYS7 = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const days = Array.isArray(get(S, 'days')) ? get(S, 'days').filter(x => DAYS7.includes(x)) : [];
    s.days = days.length ? Array.from(new Set(days)) : ['Mon', 'Tue', 'Thu', 'Fri'];
    s.restPrimary = int(get(S, 'restPrimary'), 30, 600, 180); s.restSecondary = int(get(S, 'restSecondary'), 30, 600, 120); s.restAccessory = int(get(S, 'restAccessory'), 15, 600, 90);
    s.age = numOrNull(get(S, 'age'), 10, 100);
    s.name = str(get(S, 'name'), 40);
    const tok = get(S, 'gistToken'); s.gistToken = trusted && typeof tok === 'string' && /^[A-Za-z0-9_]{20,255}$/.test(tok) ? tok : null;
    const gid = get(S, 'gistId'); s.gistId = trusted && typeof gid === 'string' && /^[a-f0-9]{8,64}$/.test(gid) ? gid : null;

    const L = isObj(get(raw, 'lifts')) ? get(raw, 'lifts') : {};
    for (const k of LIFTS) {
      const src = isObj(get(L, k)) ? get(L, k) : {};
      const oneRM = num(get(src, 'oneRM'), 0, 2000, 0);
      d.lifts[k] = { oneRM, tm: oneRM ? E.roundTo(oneRM * s.tmPct, s.increment) : 0, est: numOrNull(get(src, 'est'), 0, 3000), estDate: dateStr(get(src, 'estDate'), null), blockStartRM: numOrNull(get(src, 'blockStartRM'), 0, 2000) || oneRM || null };
    }
    const A = isObj(get(raw, 'acc')) ? get(raw, 'acc') : {};
    d.acc = {};
    for (const k of Object.keys(A)) if (own(E.EX, k) && isObj(A[k])) { const w = numOrNull(get(A[k], 'weight'), 0, 2000); if (w != null) d.acc[k] = { weight: w, updated: dateStr(get(A[k], 'updated'), null) }; }

    const P = isObj(get(raw, 'program')) ? get(raw, 'program') : {};
    const p = d.program;
    p.blockIdx = int(get(P, 'blockIdx'), 0, E.BLOCKS.length - 1, 0);
    p.week = int(get(P, 'week'), 1, E.totalWeeks(E.BLOCKS[p.blockIdx]), 1);
    p.dayIdx = int(get(P, 'dayIdx'), 0, E.DAYS.length - 1, 0);
    p.mesoCount = int(get(P, 'mesoCount'), 0, 10000, 0);
    const SA = isObj(get(P, 'setAdj')) ? get(P, 'setAdj') : {};
    p.setAdj = { squat: int(get(SA, 'squat'), -2, 2, 0), bench: int(get(SA, 'bench'), -2, 2, 0), deadlift: int(get(SA, 'deadlift'), -2, 2, 0), acc: int(get(SA, 'acc'), -1, 1, 0) };
    const LA = isObj(get(P, 'loadAdj')) ? get(P, 'loadAdj') : {};
    p.loadAdj = { squat: num(get(LA, 'squat'), -0.1, 0.05, 0), bench: num(get(LA, 'bench'), -0.1, 0.05, 0), deadlift: num(get(LA, 'deadlift'), -0.1, 0.05, 0) };
    const FL = isObj(get(P, 'flags')) ? get(P, 'flags') : {};
    p.flags = { squat: int(get(FL, 'squat'), 0, 9, 0), bench: int(get(FL, 'bench'), 0, 9, 0), deadlift: int(get(FL, 'deadlift'), 0, 9, 0) };
    const SW = isObj(get(P, 'swaps')) ? get(P, 'swaps') : {};
    p.swaps = {};
    for (const k of Object.keys(SW)) if (SLOT_KEYS.includes(k) && E.SWAPS[k].includes(SW[k])) p.swaps[k] = SW[k];
    const SP = get(P, 'special');
    p.special = isObj(SP) && (get(SP, 'type') === 'rest' || get(SP, 'type') === 'deload') ? { type: get(SP, 'type'), weeksLeft: int(get(SP, 'weeksLeft'), 1, 4, 1), resumeDayIdx: int(get(SP, 'resumeDayIdx'), 0, 3, 0) } : null;
    const nbo = get(P, 'nextBlockOverride'); p.nextBlockOverride = nbo == null ? null : int(nbo, 0, E.BLOCKS.length - 1, null);
    p.pendingDeload = bool(get(P, 'pendingDeload')); p.lightRestOfWeek = bool(get(P, 'lightRestOfWeek'));
    p.volumeDial = int(get(P, 'volumeDial'), -2, 2, 0); p.blockClean = get(P, 'blockClean') !== false; p.readinessBase = numOrNull(get(P, 'readinessBase'), 0, 100);
    const CD = isObj(get(P, 'calibDrops')) ? get(P, 'calibDrops') : {};
    p.calibDrops = {}; for (const k of LIFTS) { const n = int(get(CD, k), 0, 50, 0); if (n) p.calibDrops[k] = n; }
    p.chronicSince = num(get(P, 'chronicSince'), 0, 4e12, 0);
    p.macroPos = int(get(P, 'macroPos'), 0, E.MACRO.length - 1, 0);
    if (E.MACRO[p.macroPos].block !== E.BLOCKS[p.blockIdx].id) { const i = E.MACRO.findIndex(m => m.block === E.BLOCKS[p.blockIdx].id); p.macroPos = i >= 0 ? i : 0; }
    p.variantSet = oneOf(get(P, 'variantSet'), ['A', 'B'], 'A');
    const RC = isObj(get(P, 'runCeil')) ? get(P, 'runCeil') : {};
    p.runCeil = { squat: int(get(RC, 'squat'), 0, 3, 1), bench: int(get(RC, 'bench'), 0, 3, 1), deadlift: int(get(RC, 'deadlift'), 0, 3, 1) };
    p.macroRough = int(get(P, 'macroRough'), 0, 10, 0);
    p.startedAt = dateStr(get(P, 'startedAt'), null);

    const LE = isObj(get(raw, 'learned')) ? get(raw, 'learned') : {};
    d.learned = {};
    for (const b of E.BLOCKS) if (isObj(get(LE, b.id))) { const o = get(LE, b.id); d.learned[b.id] = { squat: int(get(o, 'squat'), -1, 3, 0), bench: int(get(o, 'bench'), -1, 3, 0), deadlift: int(get(o, 'deadlift'), -1, 3, 0) }; }

    const sessions = Array.isArray(get(raw, 'sessions')) ? get(raw, 'sessions') : [];
    const seen = new Set();
    d.sessions = sessions.slice(0, 3000).map(x => sanitizeSession(x, d)).filter(x => x && !seen.has(x.id) && seen.add(x.id)).sort((a, b) => a.ts - b.ts);
    const cur = sanitizeSession(get(raw, 'current'), d);
    d.current = cur && cur.phase ? cur : null;
    d.log = (Array.isArray(get(raw, 'log')) ? get(raw, 'log') : []).slice(0, 300).filter(isObj).map(l => ({ date: dateStr(get(l, 'date'), '2000-01-01'), msg: str(get(l, 'msg'), 300) })).filter(l => l.msg);
    const LR = get(raw, 'lastReport');
    d.lastReport = isObj(LR) && Array.isArray(get(LR, 'lines')) ? { title: str(get(LR, 'title'), 100, 'Update'), lines: get(LR, 'lines').slice(0, 30).map(l => str(l, 300)).filter(Boolean) } : null;
    const U = trusted ? get(raw, 'undo') : null;
    if (isObj(U) && typeof get(U, 'snap') === 'string' && get(U, 'snap').length < 400000) {
      let ok = false; try { const sn = JSON.parse(get(U, 'snap')); ok = isObj(sn) && isObj(get(sn, 'program')); } catch (e) { ok = false; }
      d.undo = ok ? { label: str(get(U, 'label'), 100, 'Undo'), snap: get(U, 'snap'), removeSessionId: idStr(get(U, 'removeSessionId'), null), restoreSession: sanitizeSession(get(U, 'restoreSession'), d) } : null;
      if (d.undo && !d.undo.removeSessionId) delete d.undo.removeSessionId;
      if (d.undo && !d.undo.restoreSession) delete d.undo.restoreSession;
    } else d.undo = null;
    const T = get(raw, 'timer');
    d.timer = isObj(T) ? { end: num(get(T, 'end'), 0, 4e12, 0), total: int(get(T, 'total'), 1, 3600, 90), label: str(get(T, 'label'), 60) } : null;
    d.extraCardio = (Array.isArray(get(raw, 'extraCardio')) ? get(raw, 'extraCardio') : []).slice(0, 2000).filter(isObj).map(c => ({ date: dateStr(get(c, 'date'), '2000-01-01'), min: int(get(c, 'min'), 1, 600, 30), kcal: int(get(c, 'kcal'), 0, 10000, 0) }));
    d.lastBackupAt = numOrNull(get(raw, 'lastBackupAt'), 0, 4e12);
    d.lastBackupKind = oneOf(get(raw, 'lastBackupKind'), ['clipboard', 'file', 'cloud'], null);
    d.lastCloudBackup = numOrNull(get(raw, 'lastCloudBackup'), 0, 4e12);
    d.cloudError = trusted ? (str(get(raw, 'cloudError'), 200, null) || null) : null;
    d.lastCloudBackup = trusted ? d.lastCloudBackup : null;
    d.migratedV2 = bool(get(raw, 'migratedV2'));
    d.setupDone = bool(get(raw, 'setupDone')) && LIFTS.every(k => d.lifts[k].oneRM > 0);
    d.updatedAt = num(get(raw, 'updatedAt'), 0, 4e12, 0);
    d.version = 2;
    return d;
  }
  root.Engine.sanitizeState = sanitizeState;
  root.Engine.sanitizeSession = sanitizeSession;
})(typeof window !== 'undefined' ? window : globalThis);
