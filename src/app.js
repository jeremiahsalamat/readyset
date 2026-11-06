/* Readyset UI. Vanilla JS, one render() per view, event delegation on data-action. */
(function () {
  'use strict';
  // Never run inside another site's frame (meta CSP cannot set frame-ancestors).
  try { if (window.top !== window.self) { document.documentElement.innerHTML = ''; return; } } catch (e) { document.documentElement.innerHTML = ''; return; }
  const E = window.Engine;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LIFTS = ['squat', 'bench', 'deadlift'];
  const LIFTNAME = { squat: 'Squat', bench: 'Bench', deadlift: 'Deadlift' };
  const DIFF = ['', 'Easy', 'Solid', 'Very hard', 'Crushed me'];
  const FELT = ['', 'easy', 'solid', 'very hard', 'crushing']; // the same answers in a sentence ("felt very hard")
  const DAYSHORT = { A: 'SQ', B: 'BP', C: 'DL', D: 'BV' }; // squat, bench press, deadlift, bench variation
  const arrows = (l) => esc(l).replace(/ -&gt; /g, ' → ');

  let state = null;
  let view = 'today';
  const ui = { checkin: null, sheet: null, timer: null, confirm: null, setupStep: 0, draft: null, expand: {}, cardioRun: null, importText: '' };

  // ---------- Dates ----------
  function todayISO(d) { d = d || new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  // One formatter each, not a new one per label. UTC on both sides, so a date never shifts when the phone changes time zone.
  let DF, DFL; const utcDay = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  function fmtDate(iso) { DF = DF || new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }); return DF.format(utcDay(iso)); }
  function fmtDateLong(iso) { DFL = DFL || new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }); return DFL.format(utcDay(iso)); }
  function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 864e5); }

  // ---------- Storage ----------
  // Every state object that enters from outside the running page is rebuilt by the sanitizer:
  // the device's own storage is trusted (it may carry the undo snapshot); anything pasted or shared
  // is not. A state that cannot even build a session is refused rather than kept.
  function cleanState(raw, trusted) {
    const st = E.sanitizeState(raw, { trusted });
    E.positionLabel(st);
    const dayIdx = st.program.dayIdx;
    for (let d = 0; d < E.DAYS.length; d++) { st.program.dayIdx = d; E.buildSession(st, 'full'); }
    st.program.dayIdx = dayIdx;
    return st;
  }
  const Store = {
    key: 'readyset.v1', db: null, timer: null, chain: Promise.resolve(), lastError: null, last: null, unreadable: null, size: 0,
    // null when nothing is stored; a value that is stored but cannot be read is kept aside (never
    // overwritten) and reported, so the recovery screen can offer it.
    loadLocal() {
      let t = null; try { t = localStorage.getItem(this.key); } catch (e) { return null; }
      if (!t) return null;
      this.size = t.length;
      try { const v = JSON.parse(t); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch (e) { /* fall through */ }
      this.unreadable = t; return null;
    },
    saveLocal(s) {
      let json; try { json = pack(s); } catch (e) { return; }
      if (json === this.last) return; // nothing changed since the last write (app switches, double saves)
      const ok = () => { if (this.lastError) { this.lastError = null; try { renderSaveBar(); } catch (e) { /* before the page is ready */ } } };
      try { localStorage.setItem(this.key, json); this.last = json; this.size = json.length; ok(); }
      catch (e) {
        // Full: try once more without the Undo copy (the one large optional item). The live state is
        // never trimmed piecemeal: if that write lands, the Undo goes as a whole, so no half of it can run.
        if (s.undo) { try { const j2 = pack(Object.assign({}, s, { undo: null })); localStorage.setItem(this.key, j2); this.last = j2; this.size = j2.length; s.undo = null; ok(); return; } catch (e2) { /* still full */ } }
        this.lastError = 'This phone could not save your latest sets (storage full or blocked). Keep Readyset open, finish the session, then tap Save backup. A backup includes a session once it is finished.';
        try { renderSaveBar(); } catch (e3) { /* before the page is ready */ }
      }
    },
    async init() {
      let local = this.loadLocal();
      try {
        if (window.claude && typeof window.claude.use === 'function') {
          const db = await Promise.race([window.claude.use('db'), new Promise(r => setTimeout(() => r(null), 5000))]);
          if (db) {
            const timeout = (p) => Promise.race([p, new Promise((res, rej) => setTimeout(() => rej(new Error('timeout')), 8000))]);
            const snap = await timeout(db.doc('app/state').get());
            if (snap.exists) {
              const remote = snap.data();
              const q = await timeout(db.collection('sessions').limit(5000).get());
              const remoteSessions = q.docs.map(d => d.data());
              const localSessions = (local && Array.isArray(local.sessions)) ? local.sessions : [];
              // Sessions are merged by id, never replaced, so a push that failed cannot lose one.
              const byId = new Map(); for (const x of remoteSessions.concat(localSessions)) { if (!x || !x.id) continue; const o = byId.get(x.id); if (!o || (x.savedAt || x.ts || 0) > (o.savedAt || o.ts || 0)) byId.set(x.id, x); }
              const merged = Array.from(byId.values()).sort((a, b) => (a.ts || 0) - (b.ts || 0));
              const localNewer = local && (local.updatedAt || 0) > (remote.updatedAt || 0);
              local = Object.assign({}, localNewer ? local : remote, { sessions: merged });
              this.db = db; // only after both reads and the merge worked: a failed read is never followed by writes over the account copy
              if (localNewer) this.pushAll(local);
              for (const x of localSessions) { const r = remoteSessions.find(y => y && y.id === x.id); if (!r || (x.savedAt || x.ts || 0) > (r.savedAt || r.ts || 0)) this.pushSession(x); }
            } else if (local) {
              this.db = db; this.pushAll(local);
            } else { this.db = db; }
          }
        }
      } catch (e) { this.db = null; /* fall back to local, and write nothing to the account */ }
      return local;
    },
    save(s) {
      s.updatedAt = Date.now();
      this.saveLocal(s);
      if (!this.db) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.pushState(s), 1200);
    },
    flush() { if (this.db && this.timer) { clearTimeout(this.timer); this.timer = null; this.pushState(state); } },
    pushState(s) {
      if (!this.db) return;
      const copy = Object.assign({}, s); delete copy.sessions;
      copy.settings = Object.assign({}, s.settings);
      this.chain = this.chain.then(() => this.db.doc('app/state').set(copy)).catch(() => {});
    },
    pushSession(sess) {
      if (!this.db) return;
      this.chain = this.chain.then(() => this.db.doc('sessions/' + sess.id).set(sess)).catch(() => {});
    },
    pushAll(s) { this.pushState(s); for (const x of s.sessions || []) this.pushSession(x); },
    deleteSession(id) { if (this.db) this.chain = this.chain.then(() => this.db.doc('sessions/' + id).delete()).catch(() => {}); },
  };
  function save() { Store.save(state); }
  // A failed save is not a one-off toast: a bar stays at the top of every screen until a save works.
  function renderSaveBar() {
    const old = $('#save-bar'); if (old) old.remove();
    if (!Store.lastError) return;
    const bar = document.createElement('div'); bar.id = 'save-bar'; bar.className = 'update-bar save-bar'; bar.setAttribute('role', 'alert');
    bar.innerHTML = `<span>${esc(Store.lastError)}</span><button class="btn sm" data-action="share-backup">Save backup</button>`;
    const app = $('#app'); if (app) app.insertBefore(bar, app.firstChild);
  }

  // ---------- Backups ----------
  // The phone's storage is the only copy of the data, and on iOS deleting the home-screen icon
  // deletes it. So: a share-sheet backup file (Files, iCloud Drive, AirDrop) and a clipboard copy,
  // and a banner on Today whenever a session is newer than the last backup.
  // kind: how this copy is being saved. The copy records its own time, so data restored from it
  // knows that everything in it was backed up.
  // iOS never replaces a file from the share sheet (it saves "name 2"), so each backup gets a dated
  // name that sorts by time. Every file is a complete snapshot: only the newest is ever needed.
  function backupName() {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return `readyset-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
  }
  // What is stored leaves out everything the sanitizer rebuilds on load: nulls, empty strings,
  // flags whose missing value already means false (never the three that default to true), zero
  // counters, and exercise text that comes from the catalog. A year of sessions stays well under
  // 1 MB, and no deep copy is made on every tap.
  const DROP_FALSE = new Set(['ind', 'open', 'done', 'manualW', 'hitFloor', 'autoStopped', 'needsWeight', 'optional', 'skipped', 'isDeload', 'isTest', 'isRest', 'paused', 'setLightRest', 'calibrated', 'timerSrc', 'autoReps', 'autoW', 'minTyped', 'macroWasFlagged']);
  const DROP_ZERO = new Set(['plus', 'cut']);
  const DROP_ALWAYS = new Set(['cue', 'startHint', 'load']);
  function packer(k, v) {
    if (k === 'kind' && v === 'work') return undefined;
    if ((k === 'dayId' || k === 'dayName' || k === 'blockName') && typeof v === 'string') return undefined;
    if (v === null || v === '' || v === undefined) return undefined;
    if (v === false && DROP_FALSE.has(k)) return undefined;
    if (v === 0 && DROP_ZERO.has(k)) return undefined;
    if (DROP_ALWAYS.has(k) && typeof v === 'string') return undefined;
    return v;
  }
  function pack(v) { return JSON.stringify(v, packer); }
  function backupJSON(kind) {
    const copy = Object.assign({}, state); copy.settings = Object.assign({}, state.settings);
    for (const k of ['current', 'undo', 'timer', 'backupOffer']) delete copy[k];
    copy.lastBackupAt = Date.now(); copy.lastBackupKind = kind || 'file';
    return pack(copy);
  }
  let sizeCache = { key: '', text: '' };
  function backupSizeText() {
    const last = state.sessions[state.sessions.length - 1];
    const key = `${state.sessions.length}:${last ? (last.savedAt || last.ts || 0) : 0}:${state.lastBackupAt || 0}`;
    if (sizeCache.key !== key) { const n = backupJSON('file').length; sizeCache = { key, text: n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB` }; }
    return sizeCache.text;
  }
  function noteBackup(kind) { state.lastBackupAt = Date.now(); state.lastBackupKind = kind; state.backupOffer = false; Store.saveLocal(state); }
  function sessionsSinceBackup() { const t = state.lastBackupAt || 0; return state.sessions.filter(s => !s.skipped && (s.savedAt || s.ts || 0) > t).length; }
  // Share the backup file. A backup counts only when the share sheet reports success; a share that
  // fails for any reason (one already open, not allowed) just says so. The download fallback is for
  // browsers without a share sheet, where it is the only way to hand over a file.
  let sharing = false;
  async function shareBackup() {
    if (sharing) return;
    const json = backupJSON('file'), name = backupName();
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      sharing = true;
      try { await navigator.share({ files: [file] }); /* file only: a title or text is saved as a second file */ noteBackup('file'); toast('Backup shared'); render(); }
      catch (e) { if (!(e && e.name === 'AbortError')) toast('The share sheet did not open. Try again.'); }
      sharing = false;
      return;
    }
    try {
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
      noteBackup('file'); toast('Backup file saved'); render();
    } catch (e) { copyBackup(); }
  }
  function copyBackup() { const txt = backupJSON('clipboard'); const ok = () => { noteBackup('clipboard'); toast('Backup copied. Paste it into Notes.'); render(); }; if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, () => fallbackCopy(txt)); else fallbackCopy(txt); }
  function addLog(msg) { state.log.unshift({ date: todayISO(), msg }); if (state.log.length > 200) state.log.length = 200; }

  // ---------- Toast / confirm ----------
  // Unused home-bar padding. Where an iPhone home-screen app ends above the screen's bottom edge
  // (iOS sized it as screen minus status bar), the home indicator is outside the app, so the gap kept
  // for it under the tab labels is wasted and comes out. This only ever removes padding: nothing is
  // sized or placed beyond the height iOS reports, so the tab bar cannot leave the screen.
  function fitBottom() {
    let endsShort = false;
    try {
      if (navigator.standalone === true && screen.width > 0 && screen.height > 0 && document.body) {
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;visibility:hidden;height:0;padding-top:env(safe-area-inset-top,0px)';
        document.body.appendChild(probe); const top = probe.offsetHeight; probe.remove();
        const portrait = window.innerHeight >= window.innerWidth;
        const long = Math.max(screen.width, screen.height), shortSide = Math.min(screen.width, screen.height);
        const fillsWidth = Math.abs(window.innerWidth - (portrait ? shortSide : long)) <= 2;
        const gap = (portrait ? long : shortSide) - window.innerHeight;
        endsShort = fillsWidth && top > 0 && gap > 0 && Math.abs(gap - top) <= 4;
      }
    } catch (e) { endsShort = false; }
    if (endsShort) document.documentElement.style.setProperty('--sab', '8px'); // a small gap, so the bar does not sit flush on the edge
    else document.documentElement.style.removeProperty('--sab');
  }
  fitBottom();
  window.addEventListener('resize', fitBottom);
  let chartRz = 0; window.addEventListener('resize', () => { clearTimeout(chartRz); chartRz = setTimeout(() => { if (view === 'history' && state && state.setupDone) drawCharts(); }, 150); });
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (view === 'history' && state && state.setupDone) drawCharts(); }); } catch (e) { /* older browsers */ }
  document.addEventListener('toggle', (ev) => { const el = ev.target; if (el && el.classList && el.classList.contains('session-item') && el.dataset.id) { ui.histOpen = ui.histOpen || {}; if (el.open) ui.histOpen[el.dataset.id] = 1; else delete ui.histOpen[el.dataset.id]; } }, true);
  window.addEventListener('orientationchange', () => setTimeout(fitBottom, 250));
  let fitRaf = 0;
  try { if (window.ResizeObserver) new ResizeObserver(() => { if (!fitRaf) fitRaf = requestAnimationFrame(() => { fitRaf = 0; fitBottom(); }); }).observe(document.documentElement); } catch (e) { /* events above still cover it */ }
  function toast(msg, ms) {
    document.querySelectorAll('.toast').forEach(x => x.remove()); // one at a time: a newer message replaces the older
    const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); t.textContent = msg;
    t.addEventListener('click', () => t.remove());
    document.body.appendChild(t); setTimeout(() => t.remove(), ms || Math.min(7000, 1800 + String(msg).length * 45));
  }

  // ---------- Rest timer ----------
  // What iOS allows a home-screen web app: its JavaScript (the page's and the service worker's)
  // runs while Readyset is on screen and for a few seconds after you switch away; then iOS freezes
  // it until you come back. So an alert can only fire on time while Readyset is open. Built around
  // that: on screen the page chimes; in those first seconds away the service worker posts the one
  // banner (the page only tells it the rest is due, since iOS shows every notification it is given)
  // and keeps its deadline on disk; nothing frozen alerts late on top of you; the bar shows the clock
  // time the rest ends, and after it ends, how long ago (Rest done +1:10).
  let audioCtx = null;
  function tone(f, at, dur) { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.frequency.value = f; g.gain.setValueAtTime(0.2, at); g.gain.exponentialRampToValueAtTime(0.0001, at + dur); o.connect(g); g.connect(audioCtx.destination); o.start(at); o.stop(at + dur + 0.05); }
  // A rising three-note chime. Web Audio follows the Silent switch, so the bar flashes as well.
  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const play = () => { const t0 = audioCtx.currentTime + 0.03; tone(880, t0, 0.22); tone(1175, t0 + 0.26, 0.22); tone(1568, t0 + 0.52, 0.4); };
      const asked = Date.now();
      if (audioCtx.state === 'running') play(); else audioCtx.resume().then(() => { if (Date.now() - asked < 1500) play(); }, () => {});
    } catch (e) { /* no audio */ }
    flashTimer();
  }
  // iOS starts audio suspended outside a tap and suspends it again after a call or an app switch,
  // so every tap during a session wakes it (nothing happens when it is already running).
  // A context can also come back from an app switch dead, reading 'running' with its clock stopped
  // (WebKit bugs 276016, 291892): it is replaced on the next tap.
  let audioSick = false;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !audioCtx) return;
    const c = audioCtx, t0 = c.currentTime;
    setTimeout(() => { if (c === audioCtx) audioSick = c.state === 'running' && c.currentTime === t0; }, 700);
  });
  function unlockAudio() { try {
    if (audioSick && audioCtx) { try { audioCtx.close().catch(() => {}); } catch (e) { /* ignore */ } audioCtx = null; }
    audioSick = false;
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state !== 'running') { const c = audioCtx; c.resume().catch(() => {}); setTimeout(() => { if (c === audioCtx && c.state !== 'running') audioSick = true; }, 700); } // a tap could not wake it: the next tap replaces it
  } catch (e) { /* ignore */ } }
  function flashTimer() { const el = $('#timer'); if (!el) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  function postSw(msg) { try { const c = navigator.serviceWorker && navigator.serviceWorker.controller; if (c) { c.postMessage(msg); return true; } } catch (e) { /* ignore */ } return false; }
  function alertsOn() { try { return !!(state.settings.notify && 'Notification' in window && Notification.permission === 'granted'); } catch (e) { return false; } }
  // Hand the deadline to the service worker (again): a worker iOS restarted, or one a new build put
  // in place, picks it up from disk.
  function armSw() { const t = state && state.timer; if (t && !t.firedAt && alertsOn()) { if (t.end > Date.now()) postSw({ type: 'rest-schedule', at: t.end, body: t.label ? `Next: ${t.label}` : 'Next set' }); } else postSw({ type: 'rest-cancel' }); } // a deadline just passed is left alone: the worker's fired marker stops a second banner
  function clearRestNotes() { try { if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) navigator.serviceWorker.getRegistration().then(reg => (reg && reg.getNotifications ? reg.getNotifications() : [])).then(ns => (ns || []).forEach(n => n.close())).catch(() => {}); } catch (e) { /* ignore */ } }
  function clearRestNotesSoon() { [1500, 6000].forEach(ms => setTimeout(() => { if (document.visibilityState === 'visible') clearRestNotes(); }, ms)); } // a worker thawing with us can post after the first clear, up to its 5 s limit
  let clockMemo = { at: 0, text: '' }; // asked every second; a date formatter is not free
  function clockAt(ts) { if (clockMemo.at !== ts) clockMemo = { at: ts, text: new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) }; return clockMemo.text; }
  function startTimer(seconds, label, src) {
    stopTimer(true);
    const end = Date.now() + seconds * 1000;
    if (src) src.timerSrc = true; // the set that started it: unticking or deleting that set stops it
    state.timer = { end, total: seconds, label: label || '', firedAt: 0 };
    ui.timer = { end, total: seconds, fired: false };
    armSw(); keepAwake();
    tickTimer(); scheduleTick();
  }
  function resumeTimer() {
    const t = state.timer; if (!t || !state.current) return;
    if (Date.now() - t.end > 60 * 60000) { state.timer = null; return; } // over an hour ago: that rest is history
    ui.timer = { end: t.end, total: t.total, fired: !!t.firedAt };
    armSw(); tickTimer(); scheduleTick();
  }
  // One tick just after each whole second (no 4-per-second polling); a frozen page catches up on return.
  function scheduleTick() {
    if (!ui.timer) return;
    clearTimeout(ui.timer.to);
    const left = ui.timer.end - Date.now();
    const ms = left > 0 ? (left % 1000) + 15 : 1000 - ((-left) % 1000) + 15;
    ui.timer.to = setTimeout(() => { tickTimer(); scheduleTick(); }, Math.max(30, Math.min(1015, ms)));
  }
  function stopTimer(quiet) {
    if (ui.timer) clearTimeout(ui.timer.to);
    ui.timer = null;
    if (state && state.current) state.current.exercises.forEach(e => e.sets.forEach(x => { if (x.timerSrc) delete x.timerSrc; }));
    if (state && state.timer) { state.timer = null; if (!quiet) postSw({ type: 'rest-cancel' }); }
    const el = $('#timer'); if (el) el.remove();
  }
  function tickTimer() {
    if (!ui.timer) return;
    let el = $('#timer');
    if (!el) {
      el = document.createElement('div'); el.id = 'timer'; el.className = 'timer'; el.setAttribute('role', 'timer');
      el.innerHTML = '<span class="t-main"><span class="t-time"></span><small class="t-sub"></small></span><span class="t-btns"></span>';
      document.body.appendChild(el);
    }
    const now = Date.now(), left = Math.ceil((ui.timer.end - now) / 1000);
    if (left <= 0 && !ui.timer.fired) {
      const late = -left, visible = document.visibilityState === 'visible';
      if (visible || (alertsOn() && late <= 3)) {
        ui.timer.fired = true;
        if (state.timer && visible) { state.timer.firedAt = now; Store.saveLocal(state); } // hidden, it is only handed over: if iOS closes everything before the banner, a reopen still announces it
        if (visible) { postSw({ type: 'rest-cancel' }); clearRestNotes(); clearRestNotesSoon(); if (late <= 300) beep(); else flashTimer(); } // on screen: the chime, and no worker thawed later repeats it
        else { ui.timer.handed = true; if (!postSw({ type: 'rest-due', at: ui.timer.end, body: state.timer && state.timer.label ? `Next: ${state.timer.label}` : 'Next set' })) notifyRestDone(); } // still running just after you switched away: the worker posts the banner (or already has)
      } // hidden with nothing sent: the rest is announced (chime or flash) the moment you are back
    }
    el.classList.toggle('over', left <= 0);
    const a = Math.abs(left);
    const txt = left <= 0 ? `Rest done ${a >= 60 ? '+' + Math.floor(a / 60) + ':' + String(a % 60).padStart(2, '0') : '+' + a + 's'}` : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    const lab = state.timer && state.timer.label;
    const blocked = state.settings.notify && 'Notification' in window && Notification.permission === 'denied';
    const sub = left > 0 ? (blocked ? 'Alerts blocked in iPhone Settings' : `until ${clockAt(ui.timer.end)}${lab ? ' · ' + lab : ''}`) : (lab ? `Next: ${lab}` : 'Next set');
    const t1 = el.querySelector('.t-time'), t2 = el.querySelector('.t-sub');
    if (t1.textContent !== txt) t1.textContent = txt; // text only, so a tap mid-tick still lands on its button
    if (t2.textContent !== sub) t2.textContent = sub;
    const btns = el.querySelector('.t-btns');
    if (!btns.firstChild) btns.innerHTML = '<button data-action="timer-add" aria-label="Add 30 seconds">+30s</button><button data-action="timer-stop">Done</button>';
    if (left <= -3600) { stopTimer(); save(); }
  }

  // Notifications: a backup for the first seconds after switching away (see above).
  function enableNotify() {
    if (!('Notification' in window)) { toast('Notifications are not available in this browser'); state.settings.notify = false; render(); return; }
    let done = false;
    const finish = (p) => { if (done) return; done = true; state.settings.notify = p === 'granted'; if (p !== 'granted') toast('Notifications were not allowed'); armSw(); save(); render(); };
    try { const r = Notification.requestPermission(finish); if (r && typeof r.then === 'function') r.then(finish, () => finish('denied')); }
    catch (e) { finish('denied'); }
  }
  function notifyRestDone() {
    try {
      if (!alertsOn()) return;
      const t = state.timer, body = t && t.label ? `Next: ${t.label}` : 'Next set';
      const opts = { body, tag: 'readyset-rest-' + (t ? t.end : 0) };
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
        navigator.serviceWorker.getRegistration().then(reg => { if (reg && reg.showNotification) reg.showNotification('Rest done', opts); else new Notification('Rest done', opts); }).catch(() => { try { new Notification('Rest done', opts); } catch (e) { /* ignore */ } });
      } else new Notification('Rest done', opts);
    } catch (e) { /* notifications unavailable */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !(ui.timer && !ui.timer.fired)) { clearRestNotes(); clearRestNotesSoon(); } // back in the app: an old 'Rest done' banner has done its job
    if (!ui.timer) return;
    if (document.visibilityState === 'visible') { tickTimer(); scheduleTick(); if (ui.timer && ui.timer.handed) { ui.timer.handed = false; if (state.timer) { state.timer.firedAt = Date.now(); Store.saveLocal(state); } flashTimer(); } } // a banner you may have missed: the bar says it too
    if (ui.timer && !ui.timer.fired) armSw(); // hide: the newest worker gets the deadline right before iOS freezes the page
  });
  window.addEventListener('pageshow', () => { if (ui.timer) { tickTimer(); scheduleTick(); } });

  // ---------- Wake lock ----------
  // The screen stays on while lifting (and while the bike clock runs), so the timer can alert.
  // One request at a time; if iOS drops it (Low Power Mode, a call) it is asked for again.
  let wakeLock = null, wakePending = false;
  function wantAwake() { const s = state && state.current; return !!(s && !s.backfill && (s.phase === 'lift' || (s.phase === 'cardio' && s.cardioRun && !s.cardioRun.paused))); }
  async function keepAwake() {
    if (wakeLock && wakeLock.released === true) wakeLock = null; // its release event never reached us across a freeze
    if (!navigator.wakeLock || wakeLock || wakePending || !wantAwake() || document.visibilityState !== 'visible') return;
    wakePending = true;
    try {
      const l = await navigator.wakeLock.request('screen');
      if (!wantAwake() || document.visibilityState !== 'visible') { try { l.release(); } catch (e) { /* ignore */ } wakePending = false; return; } // finished while the request was out
      wakeLock = l; ui.wakeFail = false;
      l.addEventListener('release', () => { if (wakeLock === l) wakeLock = null; if (document.visibilityState === 'visible' && wantAwake()) setTimeout(keepAwake, 800); });
    } catch (e) { ui.wakeFail = true; }
    wakePending = false;
  }
  function releaseAwake() { const l = wakeLock; wakeLock = null; try { if (l) l.release(); } catch (e) { /* ignore */ } }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state && state.current) keepAwake(); });

  // ---------- Helpers ----------
  function pctLabel(e) { return e.pctTM != null ? Math.round(e.pctTM * 100) + '% TM' : ''; }
  // The sessions the reviews read: this block's training sessions, not deload or easy-week ones, and
  // not those logged before an inserted deload (the block resumes at the same week afterwards).
  function inBlock(s) { const P = state.program; return s.mesoCount === P.mesoCount && s.blockIdx === P.blockIdx && !s.isRest && !s.isDeload && !(P.chronicSince && (s.ts || 0) < P.chronicSince); }
  function sessionsOfWeek() { const P = state.program; return state.sessions.filter(s => inBlock(s) && s.week === P.week); }
  function sessionsOfMeso() { return state.sessions.filter(inBlock); }
  function newestSessionDate() { let d = null; for (const s of state.sessions) if (!s.skipped && (!d || s.date > d)) d = s.date; return d; } // skipping days is not training: a run of skips is still a layoff
  function lastSession() { for (let i = state.sessions.length - 1; i >= 0; i--) if (!state.sessions[i].skipped) return state.sessions[i]; return null; }
  function plateText(w) {
    const r = E.plateLoad(w, state.settings.barWeight, state.settings.plates);
    if (w <= state.settings.barWeight) return 'Empty bar';
    const counts = {}; r.plates.forEach(p => counts[p] = (counts[p] || 0) + 1);
    const parts = Object.keys(counts).sort((a, b) => b - a).map(p => counts[p] > 1 ? `${p}×${counts[p]}` : `${p}`);
    return (parts.length ? parts.join(' · ') + ' per side' : 'Empty bar') + (r.exact ? '' : ` (${Math.round(r.short * 2 * 100) / 100} lb short)`);
  }
  function platesShort(w) {
    if (w <= state.settings.barWeight) return 'bar';
    const r = E.plateLoad(w, state.settings.barWeight, state.settings.plates), counts = {};
    r.plates.forEach(p => counts[p] = (counts[p] || 0) + 1);
    return Object.keys(counts).sort((a, b) => b - a).map(p => counts[p] > 1 ? `${p}×${counts[p]}` : `${p}`).join('+\u200b'); // breaks only between plates
  }
  // The session preview: one row per exercise. Name and role on the left; sets × reps and the
  // working weight on the right; the RPE, the plates and an opener on small lines underneath.
  const ROLE = { primary: 'Main lift', secondary: 'Second lift', accessory: 'Accessory' };
  function previewPlan(plan) {
    const lb = (w, e) => `${w}<small>${e.load === 'db' ? ' lb ea' : ' lb'}</small>`;
    const rows = plan.exercises.map(e => {
      const work = e.sets.filter(x => x.kind === 'work' || x.kind === 'backoff'), f = work[0] || e.sets[0];
      const test = e.sets.some(x => x.kind === 'test'), opener = e.sets.find(x => x.kind === 'single');
      let sr, wt; const sub = [];
      if (test) {
        sr = '1 × 1'; wt = 'Max';
        sub.push(`Work up to a single at RPE 9, then ${work.length} × ${f.reps}${f.w ? ` @ ${f.w} lb` : ''}`);
      } else {
        sr = `${work.length} × ${e.repRange ? `${e.repRange[0]}–${e.repRange[1]}` : `${f.reps}${f.plus ? '+' : ''}`}`;
        wt = f.w ? lb(f.w, e) : e.load === 'bw' ? 'bodyweight' : '—';
        if (e.rpeTarget != null && e.pctTM != null) sub.push(`RPE ~${e.rpeTarget}`);
        if (e.load === 'bar' && f.w) sub.push(f.w <= state.settings.barWeight ? 'empty bar' : `${platesShort(f.w)} per side`);
        if (!f.w && e.needsWeight) sub.push('pick a starting weight in the session');
      }
      const role = `${ROLE[e.role] || 'Accessory'}${e.optional ? ' <span class="pv-tag">optional</span>' : ''}`;
      return `<li class="pv-row${e.role === 'primary' ? ' main' : ''}">
        <span class="pv-name">${esc(e.name)}</span><span class="pv-sr num">${sr}</span>
        <span class="pv-role">${role}</span><span class="pv-w num">${wt}</span>
        ${sub.length ? `<span class="pv-sub">${esc(sub.join(' · '))}</span>` : ''}
        ${opener ? `<span class="pv-sub pv-open">Opener: one single @ ${opener.w} lb${opener.rpeTarget != null ? `, RPE ~${opener.rpeTarget}` : ''}</span>` : ''}
      </li>`;
    }).join('');
    return `<div class="pv-panel"><ol class="pv-list" role="list" aria-label="Exercises">${rows}</ol></div>`;
  }
  function previewTime(plan, mode) {
    const pills = [`<span class="pv-pill"><b class="num">~${plan.estMinutes}</b> min lifting</span>`];
    if (plan.cardioMin) pills.push(`<span class="pv-pill"><b class="num">${plan.cardioMin}</b> min easy bike</span>`);
    if (mode && mode !== 'full') pills.push(`<span class="pv-pill quiet">${esc(E.MODES[mode].label)}</span>`);
    return `<div class="pv-time" role="group" aria-label="Time estimate">${pills.join('')}</div>`;
  }
  function hr(v) { const h = Math.floor(v / 60), m = v % 60; return h ? `${h}h ${m ? m + 'm' : ''}`.trim() : `${m}m`; }

  // ---------- Foldable cards ----------
  // Every card on Today, Program, History and Settings folds from its header. What you fold stays
  // folded on this device: a display preference, so it lives outside the training data and backups.
  const FOLD_KEY = 'readyset.folds';
  const folds = (() => { try { const v = JSON.parse(localStorage.getItem(FOLD_KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (e) { return {}; } })();
  function saveFolds() { try { localStorage.setItem(FOLD_KEY, JSON.stringify(folds)); } catch (e) { /* only a preference */ } }
  function isFolded(id, def) { return Object.prototype.hasOwnProperty.call(folds, id) ? folds[id] === true : !!def; }
  function foldHead(id, title, closed, sum, tag) {
    return `<${tag} class="fold-h"><button class="fold-head" data-action="card-fold" data-id="${id}" aria-expanded="${!closed}"><span class="fold-t">${title}${sum ? `<span class="fold-sum">${sum}</span>` : ''}</span><svg class="fold-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg></button></${tag}>`;
  }
  // o.closed: folded until you choose otherwise. o.sum: one line shown while folded. o.tools: controls beside the title.
  function foldCard(id, title, body, o) {
    o = o || {}; const closed = isFolded(id, o.closed);
    return `<section class="card fold${closed ? ' closed' : ''}" data-fold="${id}"${o.dom ? ` id="${o.dom}"` : ''}><div class="fold-top">${foldHead(id, title, closed, o.sum, 'h3')}${o.tools || ''}</div><div class="fold-body"${closed ? ' inert' : ''}><div class="fold-inner">${body}</div></div></section>`;
  }
  function setCardFold(sec, closed) {
    sec.classList.toggle('closed', closed); folds[sec.dataset.fold] = closed;
    const b = sec.querySelector('.fold-head'), body = sec.querySelector('.fold-body');
    if (b) b.setAttribute('aria-expanded', String(!closed));
    if (body) { if (closed) body.setAttribute('inert', ''); else body.removeAttribute('inert'); } // folded fields are out of reach of the keyboard's next-field arrows
  }
  const FOLD_ALL = '<div class="fold-all"><button class="btn sm quiet" data-action="fold-tab">Collapse all</button></div>';
  function syncFoldSums(html) { // typed fields skip render(), so the one-line summaries are refreshed on their own
    const tmp = document.createElement('div'); tmp.innerHTML = html;
    tmp.querySelectorAll('[data-fold]').forEach(s => { const fresh = s.querySelector('.fold-sum'), live = document.querySelector(`#main [data-fold="${s.dataset.fold}"] .fold-sum`); if (fresh && live) live.innerHTML = fresh.innerHTML; });
  }
  function syncFoldAll() { const b = document.querySelector('[data-action="fold-tab"]'); if (b) b.textContent = [...document.querySelectorAll('#main [data-fold]')].some(s => !s.classList.contains('closed')) ? 'Collapse all' : 'Expand all'; }

  // ---------- Views ----------
  // The content area between the header and the tab bar is the only thing that scrolls (see
  // styles.css): the tab bar sits outside it, so iOS delivers taps on it even mid-glide.
  function scroller() { return document.getElementById('scroller') || document.scrollingElement || document.documentElement; }
  function scrollToY(y) { const sc = scroller(); sc.scrollTop = Math.max(0, y || 0); }
  let anchor = null; // { sel, fallback, top }: the element a tap came from, held still across a re-render
  let lastRenderDay = '';
  function anchorFor(t, a) {
    let ei, si = null;
    if (a === 'rpe-pick' && ui.sheet) { ei = ui.sheet.ei; si = ui.sheet.si; }
    else { const ex = t.closest('.ex[data-ei]'); if (!ex) return null; ei = ex.dataset.ei; const row = t.closest('.set[data-si]'); if (row) si = row.dataset.si; }
    const fallback = `.ex[data-ei="${ei}"]`, sel = si != null ? `${fallback} .set[data-si="${si}"]` : fallback;
    const el = document.querySelector(sel); if (!el) return null;
    const card = document.querySelector(fallback);
    return { sel, fallback, top: el.getBoundingClientRect().top, fallbackTop: card ? card.getBoundingClientRect().top : el.getBoundingClientRect().top };
  }
  function render() {
    const main = $('#main');
    if (!state.setupDone) { $('#tabbar').hidden = true; $('#pos').textContent = 'Setup'; main.innerHTML = renderSetup(); return; }
    $('#tabbar').hidden = false;
    document.querySelectorAll('#tabbar button').forEach(b => { if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    const pos = E.positionLabel(state);
    $('#pos').textContent = `${pos.block.name} · ${pos.label}`;
    lastRenderDay = todayISO();
    main.querySelectorAll('canvas').forEach(c => { c.width = c.height = 0; }); // their pixels are freed now, not at the next garbage collection
    main.innerHTML = (view === 'today' && !state.current && Store.size + asideData().length > 2e6 ? `<div class="callout warn">Readyset's storage is ${Math.round((Store.size + asideData().length) / 26214)}% full. Save a backup; older sessions will soon need compressing.</div>` : '') + (state.current || ui.checkin ? '' : renderUndo()) + (view === 'settings' ? renderRestoreConfirm() : '') + (view === 'today' ? renderToday() : view === 'program' ? renderProgram() : view === 'history' ? renderHistory() : renderSettings());
    if (view === 'history') drawCharts(); // before the anchor below: an undrawn canvas has a different height
    syncFoldAll();
    // Keep whatever you just tapped exactly where it was on screen, even when text above it grew,
    // shrank or folded away (iOS Safari has no scroll anchoring of its own).
    if (anchor) {
      let el = document.querySelector(anchor.sel), was = anchor.top;
      if (!el) { el = document.querySelector(anchor.fallback); was = anchor.fallbackTop; }
      if (el) { const dy = el.getBoundingClientRect().top - was; if (Math.abs(dy) >= 1) scroller().scrollTop += dy; }
      anchor = null;
    }
    if (view === 'today' && state.current && state.current.phase === 'cardio' && state.current.cardioRun) tickCardio(); // self-schedules; no animation frame needed, so it also starts while the page is hidden
  }

  // ---------- Setup wizard ----------
  function draft() {
    if (!ui.draft) {
      const s = state.settings;
      ui.draft = { name: s.name || '', squat: state.lifts.squat.oneRM || '', bench: state.lifts.bench.oneRM || '', deadlift: state.lifts.deadlift.oneRM || '', calc: {}, tmPct: s.tmPct, barWeight: s.barWeight, plates: s.plates.slice(), dbIncrement: s.dbIncrement, days: s.days.slice(), cardioMin: s.cardioMin, cardioWatts: s.cardioWatts, deadliftStyle: s.deadliftStyle, squatStyle: s.squatStyle || 'lowbar', easyWeek: true, includePeak: s.includePeak === true };
    }
    return ui.draft;
  }
  // A blank state while a real program is stored can only mean the first read failed: never build or restore over it.
  function storedProgramMissed() { if (Store.db) return false; try { const v = Store.loadLocal(); return !!(v ? E.sanitizeState(v, { trusted: true }).setupDone : Store.unreadable); } catch (e) { return true; } }
  function asideData() { try { return localStorage.getItem(Store.key + '.unreadable') || ''; } catch (e) { return ''; } }
  function renderSetup() {
    const d = draft(), step = ui.setupStep;
    const steps = `<div class="steps">${[0, 1, 2, 3].map(i => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>`;
    if (step === 0) return `
      <div class="card"><h1>Readyset</h1>
      <p>A four-day powerlifting program that reads your recovery and adjusts itself. Built on Renaissance Periodization principles.</p>
      <p class="muted small">Setup takes about two minutes.</p>
      ${steps}
      <label class="f">Your name (optional)<input id="d-name" data-draft="name" value="${esc(d.name)}" placeholder="Jerm"></label>
      <button class="btn primary block" data-action="setup-next">Start</button>
      ${asideData() ? '<button class="btn block" data-action="recover-aside">Bring back the data set aside after an error</button>' : ''}
      <button class="btn quiet block" data-action="setup-restore">Already have a backup? Restore it</button>
      ${ui.setupRestore ? `<div class="stack">
        ${filePick('Restore from a backup file', 'primary')}
        <label class="f">Or paste backup text<textarea id="import-text" rows="3"></textarea></label><button class="btn" data-action="import">Restore from text</button>
      </div>` : ''}</div>`;
    if (step === 1) return `
      <div class="card"><h2>Current maxes</h2>
      <p class="small muted">Enter a recent 1RM, or tap "from a set" and use a clean set with a rep or two left. Loads run off ${Math.round(d.tmPct * 1000) / 10}% of these, which calibrate from your sets, so a rough, conservative start is fine.</p>
      ${steps}
      ${LIFTS.map(l => `
        <div class="stack">
          <div class="row between"><span class="label" style="font-weight:600">${LIFTNAME[l]} 1RM</span><button class="btn sm quiet" data-action="setup-calc" data-lift="${l}">${d.calc[l] ? 'hide' : 'from a set'}</button></div>
          <div class="row"><label class="f" style="flex:1"><span class="tiny">lb</span><input id="d-${l}" type="number" inputmode="decimal" data-draft="${l}" value="${esc(d[l])}" placeholder="e.g. 315"></label></div>
          ${d.calc[l] ? `<div class="row small" style="align-items:flex-end">
            <label class="f" style="flex:1">Weight<input id="c-w-${l}" type="number" inputmode="decimal" data-calc="${l}:w" value="${esc(d.calc[l].w || '')}"></label>
            <label class="f" style="flex:1">Reps<input id="c-r-${l}" type="number" inputmode="numeric" data-calc="${l}:r" value="${esc(d.calc[l].r || '')}"></label>
            <label class="f" style="flex:1">RPE<input id="c-e-${l}" type="number" inputmode="decimal" step="0.5" min="5" max="10" data-calc="${l}:e" value="${esc(d.calc[l].e || '')}" placeholder="8"></label>
            <button class="btn sm" data-action="setup-apply-calc" data-lift="${l}">Use</button></div>` : ''}
        </div>`).join('')}
      <label class="f">Training Max as % of 1RM
        <select id="d-tm" data-draft="tmPct"><option value="0.85" ${d.tmPct == 0.85 ? 'selected' : ''}>85% (very conservative)</option><option value="0.875" ${d.tmPct == 0.875 ? 'selected' : ''}>87.5%</option><option value="0.9" ${d.tmPct == 0.9 ? 'selected' : ''}>90% (recommended)</option><option value="0.925" ${d.tmPct == 0.925 ? 'selected' : ''}>92.5%</option></select></label>
      <div class="grid2">
      <label class="f">Your squat<select id="d-sq" data-draft="squatStyle"><option value="lowbar" ${d.squatStyle === 'lowbar' ? 'selected' : ''}>Low-bar</option><option value="highbar" ${d.squatStyle === 'highbar' ? 'selected' : ''}>High-bar</option></select></label>
      <label class="f">Your deadlift<select id="d-dl" data-draft="deadliftStyle"><option value="conventional" ${d.deadliftStyle === 'conventional' ? 'selected' : ''}>Conventional</option><option value="sumo" ${d.deadliftStyle === 'sumo' ? 'selected' : ''}>Sumo</option></select></label>
      </div>
      <p class="small muted">Your competition lifts. The other bar position appears as a variation.</p>
      <div class="btnrow"><button class="btn" data-action="setup-back">Back</button><button class="btn primary" data-action="setup-next">Next</button></div></div>`;
    if (step === 2) return `
      <div class="card"><h2>Equipment</h2>${steps}
      <label class="f">Bar weight (lb)<input id="d-bar" type="number" inputmode="decimal" data-draft="barWeight" value="${esc(d.barWeight)}"></label>
      <div class="stack"><span class="tiny">Plates you own (per side)</span>
        <div class="chips">${[55, 45, 35, 25, 15, 10, 5, 2.5, 1.25].map(p => `<button data-action="setup-plate" data-p="${p}" aria-pressed="${d.plates.includes(p)}">${p}</button>`).join('')}</div>
        <p class="small muted">Loads round to totals these plates can make (${E.loadStep(d.plates)} lb jumps).</p></div>
      <label class="f">Dumbbell step (lb)<select id="d-dbi" data-draft="dbIncrement"><option value="2.5" ${d.dbIncrement == 2.5 ? 'selected' : ''}>2.5</option><option value="5" ${d.dbIncrement == 5 ? 'selected' : ''}>5</option></select></label>
      <p class="small muted">Assumes a rack, bench, barbell, adjustable dumbbells, belt squat, lat pulldown, low row, leg curl and leg extension. Swap anything later in Program.</p>
      <div class="btnrow"><button class="btn" data-action="setup-back">Back</button><button class="btn primary" data-action="setup-next">Next</button></div></div>`;
    return `
      <div class="card"><h2>Schedule</h2>${steps}
      <div class="stack"><span class="tiny">Training days (pick 4)</span>
        <div class="chips">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => `<button data-action="setup-day" data-d="${x}" aria-pressed="${d.days.includes(x)}">${x}</button>`).join('')}</div></div>
      <div class="grid2">
        <label class="f">Easy bike after lifting (min)<input id="d-cm" type="number" inputmode="numeric" data-draft="cardioMin" value="${esc(d.cardioMin)}"></label>
        <label class="f">Usual easy watts (optional)<input id="d-cw" type="number" inputmode="numeric" data-draft="cardioWatts" value="${esc(d.cardioWatts)}"></label>
      </div>
      <p class="small muted">Keep extra cardio easy and under about 1,500 kcal a week. The app tracks your total.</p>
      <label class="row" style="gap:10px;font-weight:600"><input type="checkbox" id="d-easy" data-draft="easyWeek" ${d.easyWeek ? 'checked' : ''} style="width:22px;height:22px"> Start with one easy week <span class="muted small" style="font-weight:500">(if your last program beat you up)</span></label>
      <label class="row" style="gap:10px;font-weight:600"><input type="checkbox" id="d-peak" data-draft="includePeak" ${d.includePeak ? 'checked' : ''} style="width:22px;height:22px"> Include the 3-week Peak &amp; Test block <span class="muted small" style="font-weight:500">(optional: maxes already calibrate every session)</span></label>
      <div class="btnrow"><button class="btn" data-action="setup-back">Back</button><button class="btn primary" data-action="setup-finish">Build my program</button></div></div>`;
  }
  function finishSetup() {
    if (storedProgramMissed()) { location.reload(); return; }
    const d = draft();
    const barW = Math.round(Math.min(100, Math.max(5, Number(d.barWeight) || 45)) * 2) / 2;
    const bad = LIFTS.filter(l => !(Number(d[l]) >= barW && Number(d[l]) <= 2000));
    if (bad.length) { toast(`Enter a ${LIFTNAME[bad[0]]} max between ${barW} and 2000 lb`); ui.setupStep = 1; render(); return; }
    if (d.days.length !== 4) { toast('Pick exactly four training days'); render(); return; }
    const s = state.settings;
    s.name = d.name.trim(); s.tmPct = Number(d.tmPct); s.barWeight = barW; s.plates = d.plates.slice().sort((a, b) => b - a);
    s.increment = Math.min(10, E.loadStep(s.plates)); s.dbIncrement = Number(d.dbIncrement); s.days = d.days.slice();
    s.cardioMin = Math.max(0, Number(d.cardioMin) || 0); s.cardioWatts = Number(d.cardioWatts) || 110; s.deadliftStyle = d.deadliftStyle; s.squatStyle = d.squatStyle; s.includePeak = !!d.includePeak;
    s.tmPctChosen = s.tmPct;
    for (const l of LIFTS) E.applyTM(state, l, Math.round(Number(d[l]) * 2) / 2);
    state.program.startedAt = todayISO();
    if (d.easyWeek) E.startActiveRest(state, 1);
    state.setupDone = true; state.migratedV2 = true; // a fresh program has nothing to migrate
    addLog(`Program started. 1RMs: squat ${state.lifts.squat.oneRM}, bench ${state.lifts.bench.oneRM}, deadlift ${state.lifts.deadlift.oneRM}. Training maxes at ${Math.round(s.tmPct * 1000) / 10}%.`);
    state = cleanState(state, true); // the same clamps a reload applies, so what you see is what is stored
    ui.draft = null; view = 'today'; save(); render();
  }

  // A deload taken now: in a block's last planned week the block's own deload runs and the next
  // block follows; earlier, a week is inserted and the block resumes; Peak has no deload week, so
  // an easy week stands in.
  function layoffTier(gap) { return gap >= 42 ? 4 : gap >= 21 ? 3 : gap >= 14 ? 2 : 1; }
  function layoffHandled(newest) { const [d, t, c] = String(state.program.layoffHandled || '').split(':'); return d === newest ? { tier: Number(t) || 3, cut: Number(c) || 0 } : { tier: 0, cut: 0 }; } // "date:tier:cut already taken"; an older bare date stays handled, as it always was
  function deloadEffect(ask) {
    const P = state.program, b = E.BLOCKS[P.blockIdx];
    if (!b.deload) return ask ? 'Peak has no deload week: take an easy week (half sets, half loads)? The block resumes afterwards.' : 'Best to take an easy week now (half sets, half loads); the block resumes afterwards.';
    const next = P.week >= b.weeks;
    return ask ? `Deload this week? ${next ? 'The next block follows.' : 'The block resumes afterwards.'}` : `Best to deload now; ${next ? 'the next block follows' : 'the block resumes afterwards'}.`;
  }

  // ---------- Today ----------
  function renderToday() {
    if (state.current) {
      if (state.current.phase === 'lift' || state.current.phase === 'edit') return renderSession();
      if (state.current.phase === 'post') return renderPost();
      if (state.current.phase === 'cardio') return renderCardio();
    }
    // A check-in left open for hours (or since another day) is stale: start a fresh one.
    if (ui.checkin && (Date.now() - (ui.checkin.at || 0) > 3 * 3600000 || ui.checkin.day !== todayISO())) ui.checkin = null;
    if (ui.checkin) return renderCheckin();
    const pos = E.positionLabel(state), P = state.program;
    // The preview shows the session you will most likely get: light for the rest of a two-red week,
    // trimmed while pushing on past a deload suggestion (a deload, easy or test week runs as planned).
    const lightWk = pos.isRest || pos.isDeload || pos.isTest;
    const planMode = lightWk ? 'full' : P.lightRestOfWeek ? 'light' : P.pushOn ? 'trim' : 'full';
    const plan = E.buildSession(state, planMode);
    const last = lastSession();
    let html = '';
    if (P.pendingDeload && !lightWk) html += `<div class="card"><h3>Deload suggested</h3><p>Fatigue stacked up in your weekly review (see Program). ${deloadEffect(false)}${state.lastReport && state.lastReport.lines.some(l => /^Volume dial [-+]?\d/.test(l)) ? ' The volume dial has stepped down either way.' : ''}</p><div class="btnrow"><button class="btn primary" data-action="deload-now">Deload this week</button><button class="btn" data-action="deload-later">Push on</button></div></div>`;
    if (P.lightRestOfWeek) html += `<div class="callout warn">The rest of this week runs light after two red check-ins. It still counts.</div>`;
    else if (P.pushOn && !lightWk) html += `<div class="callout warn">Pushing on past a deload suggestion: no bonus reps or earned sets, loads 2.5% down. Still heavy? "Deload now" is in Program.</div>`;
    // Coming back after a gap: offer the layoff rule once per gap (the book: ease back in, do not
    // resume where you left off, p.250).
    const newest = newestSessionDate(), gap = newest ? daysBetween(newest, todayISO()) : 0;
    if (gap >= 7 && layoffTier(gap) > layoffHandled(newest).tier && (gap >= 14 || (!pos.isRest && !pos.isDeload))) { // a deload or easy week is light enough for a short gap, not for a long one
      const what = gap < 14 ? (pos.isTest ? 'one more heavy week 5% lighter, then the test' : 'repeat this week 5% lighter, earned sets cleared') : gap < 21 ? 'restart this block at week 1, maxes 2.5% lower, first week 2.5% lighter' : gap < 42 ? `restart ${E.BLOCKS[P.blockIdx].test ? 'the last Strength block' : 'this block'} at week 1, maxes 5% lower, first week 5% lighter` : 'restart at Build week 1, maxes 10% lower (raise them by hand if the weights feel light)';
      html += `<div class="card"><h3>${gap} days since your last session</h3><p>Old loads after a layoff are how people get hurt. The rule for this gap: ${what}.</p>
        <div class="btnrow"><button class="btn primary" data-action="layoff-ease">Ease back in</button><button class="btn" data-action="layoff-skip">Carry on as planned</button></div></div>`;
    }
    if (state.backupOffer && !Store.db && state.settings.backupOffer) html += `<div class="callout row between offer-bar"><span>Back up this session? <span class="muted small">(${backupSizeText()})</span></span><span class="row nowrap" style="gap:6px"><button class="btn sm primary" data-action="share-backup">Save backup</button><button class="btn sm quiet icon" data-action="offer-dismiss" aria-label="Not now">✕</button></span></div>`;
    const heroClosed = isFolded('today-plan');
    html = FOLD_ALL + html;
    html += `<section class="card accent hero fold${heroClosed ? ' closed' : ''}" data-fold="today-plan">
      <div class="row between hero-top"><span class="tiny">${pos.isRest ? 'Easy week' : pos.isDeload ? 'Deload week' : pos.isTest ? 'Test week' : `${esc(pos.block.name)} block · ${esc(pos.label)}`}</span><span class="tiny">${fmtDateLong(todayISO())}</span></div>
      ${foldHead('today-plan', esc(plan.dayName), heroClosed, '', 'h1')}
      ${previewTime(plan, planMode)}
      <div class="fold-body"${heroClosed ? ' inert' : ''}><div class="fold-inner">${previewPlan(plan)}${plan.notes.map(n => `<p class="small pv-note">${esc(n)}</p>`).join('')}</div></div>
      <button class="btn block cta" data-action="checkin">Check in and start</button>
    </section>
    <div class="row between small hero-after"><button class="btn sm quiet" data-action="skip-session">Skip this session</button>${ui.backfill ? '' : '<button class="btn sm quiet" data-action="backfill-open">Log a past session</button>'}</div>`;
    if (ui.backfill) html += renderBackfill(plan);
    // What happened after the last session: three lines, the rest on a tap (a week review can run long).
    if (state.lastReport) {
      const repKey = state.lastReport.title + '|' + state.lastReport.lines.length, lines = mergeHolds(state.lastReport.lines), many = lines.length > 3 && ui.reportAll !== repKey;
      const foldKey = state.lastReport.title + '|' + state.lastReport.lines.join('\n');
      if (folds._report !== foldKey) { folds._report = foldKey; delete folds['today-report']; saveFolds(); } // a new report always opens
      const cls = (l) => l.includes('-1 set') || l.includes('easing') || /(\d+(?:\.\d+)?) -> (\d+(?:\.\d+)?)/.test(l) && Number(RegExp.$2) < Number(RegExp.$1) ? 'warn' : l.includes('+1 set') || l.includes('->') ? 'good' : '';
      html += foldCard('today-report', esc(state.lastReport.title), `${(many ? lines.slice(0, 3) : lines).map(l => `<div class="callout ${cls(l)}">${arrows(l)}</div>`).join('')}<div class="row between">${many ? `<button class="btn sm quiet" data-action="report-all">Show all ${lines.length}</button>` : '<span></span>'}<button class="btn sm quiet" data-action="dismiss-report">Dismiss</button></div>`, { sum: lines.length ? arrows(lines[0]) : '' });
    }

    if (last) {
      const d = daysBetween(last.date, todayISO());
      const when = d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
      html += foldCard('today-last', 'Last session', `<div class="row between"><div><b>${esc(last.dayName)}</b> <span class="muted small">${fmtDate(last.date)} (${when})</span></div>${last.readiness ? `<span class="pill ${last.readiness.color}">Readiness ${last.readiness.score}</span>` : ''}</div>
        <div class="small muted">${last.post ? DIFF[last.post.difficulty] : ''}${last.durationMin ? ` · ${last.durationMin} min` : ''}${last.cardio && last.cardio.min ? ` · bike ${last.cardio.min} min` : ''}${last.mode && last.mode !== 'full' && E.MODES[last.mode] ? ` · ${E.MODES[last.mode].label}` : ''}</div>`, { sum: `${esc(last.dayName)}, ${when}` });
    }
    html += renderWeekBrief();
    return html;
  }
  // Logging a session after the fact: the next planned session, dated back, with no check-in or
  // timer. It then goes through exactly the same completion, calibration and review as a live one.
  function renderBackfill(plan) {
    const b = ui.backfill;
    if (!b) return '';
    return `<div class="card"><h3>Log a past session</h3>
      <p class="small muted">Logs <b>${esc(plan.dayName)}</b>, the next planned session, on the date you pick. It counts like any other.</p>
      <div class="grid2"><label class="f">Date<input id="bf-date" type="date" value="${esc(b.date)}" max="${todayISO()}" min="${backfillMin()}" data-backfill="date"></label>
      <label class="f">How it was run<select id="bf-mode" data-backfill="mode">${['full', 'trim', 'light'].map(m => `<option value="${m}" ${b.mode === m ? 'selected' : ''}>${E.MODES[m].label}</option>`).join('')}</select></label></div>
      <div class="btnrow"><button class="btn primary" data-action="backfill-start">Open the session</button><button class="btn" data-action="backfill-cancel">Cancel</button></div></div>`;
  }
  // The earliest date a past session can take: the plan runs in order, so not before the newest
  // logged session (or a layoff restart), and not more than 60 days back.
  function backfillMin() {
    const m = new Date(); m.setDate(m.getDate() - 60); let min = todayISO(m);
    const newest = newestSessionDate(); if (newest && newest > min) min = newest;
    const cs = state.program.chronicSince; if (cs) { const c = tsISO(cs); if (c > min) min = c; }
    return min;
  }
  function startBackfill() {
    const b = ui.backfill; if (!b) return;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : null, min = backfillMin();
    if (!date || date > todayISO() || date < min) { toast(`Pick a date from ${fmtDate(min)} to today`); return; }
    const mode = E.MODES[b.mode] ? b.mode : 'full';
    ui.backfill = null;
    startSession(mode, { date });
  }
  function renderWeekBrief() {
    const P = state.program, pos = E.positionLabel(state);
    // An easy week or an inserted deload shares the week number with the week around it, so the
    // kind of week has to match as well.
    const done = state.sessions.filter(s => s.mesoCount === P.mesoCount && s.blockIdx === P.blockIdx && s.week === P.week && !!s.isRest === !!pos.isRest && !!s.isDeload === !!pos.isDeload && !(P.chronicSince && (s.ts || 0) < P.chronicSince));
    const dots = E.DAYS.map((d, i) => { const s = done.find(x => x.dayIdx === i); const st = s ? (s.skipped ? 'skipped' : 'done') : i === P.dayIdx ? 'next' : 'to come'; return `<span class="pill ${s ? (s.skipped ? 'skipped' : 'green') : i === P.dayIdx ? 'accent' : ''}" title="${esc(d.name)}: ${st}" aria-label="${esc(d.name)}: ${st}">${DAYSHORT[d.id] || d.id}</span>`; }).join(' ');
    const sets = LIFTS.map(l => `<div class="kpi"><span class="tiny">${LIFTNAME[l]} sets</span><span class="v num">${E.weeklySets(state, l)}<small>/ ${E.capFor(state, l)}</small></span></div>`).join('');
    const kcal = weekCardio();
    return foldCard('today-week', 'This week', `<div class="grid3">${sets}</div>
      <div class="row between small"><span class="muted">Easy cardio</span><span class="num"><b>${kcal.min} min</b> · ~${kcal.kcal} kcal, limit about 1,500</span></div>
      <div class="bar"><i style="width:${Math.min(100, kcal.kcal / 15)}%;background:${kcal.kcal > 1500 ? 'var(--warn)' : 'var(--accent)'}"></i></div>`, { tools: `<div class="row week-dots" data-action="card-fold" style="gap:4px">${dots}</div>` });
  }
  function extraThisWeek() {
    const t = new Date(), day = (t.getDay() + 6) % 7; const mon = new Date(t); mon.setDate(t.getDate() - day); const monISO = todayISO(mon);
    return (state.extraCardio || []).map((c, i) => ({ c, i })).filter(x => x.c.date >= monISO);
  }
  function weekCardio() {
    const t = new Date(), day = (t.getDay() + 6) % 7; const mon = new Date(t); mon.setDate(t.getDate() - day); const monISO = todayISO(mon);
    let min = 0, kcal = 0;
    for (const s of state.sessions) if (s.date >= monISO && s.cardio && s.cardio.min) { min += s.cardio.min; kcal += s.cardio.kcal || E.cardioKcal(s.cardio.min, state.settings.cardioWatts); }
    for (const c of state.extraCardio || []) if (c.date >= monISO) { min += c.min; kcal += c.kcal; }
    return { min, kcal };
  }

  // ---------- Check-in ----------
  function startCheckin() {
    const last = lastSession();
    ui.checkin = { sleep: 0, energy: 0, motivation: 0, groups: { legs: 0, push: 0, hinge: 0 }, askGroups: !!last && !last.soreness, result: null, choice: null, at: Date.now(), day: todayISO() };
    ui.backfill = null;
    render(); scrollToY(0);
  }
  function renderCheckin() {
    const c = ui.checkin;
    // plain: words only. Soreness runs best-to-worst while the other scales run worst-to-best, so
    // numbers on both would point opposite ways.
    const seg = (key, labels, plain) => `<div class="seg${plain ? ' plain' : ''}">${labels.map((t, i) => `<button data-action="ci" data-k="${key}" data-v="${i + 1}" aria-pressed="${(key.includes(':') ? c.groups[key.split(':')[1]] : c[key]) === i + 1}">${plain ? `<span>${t}</span>` : `${i + 1}<small>${t}</small>`}</button>`).join('')}</div>`;
    const SORE = ['Fresh', 'Slightly sore', 'Sore', 'Very sore'];
    if (c.result) {
      const r = c.result, pos = E.positionLabel(state);
      const lightWeek = pos.isDeload || pos.isRest || pos.isTest;
      const plan = E.buildSession(state, c.choice || r.mode);
      const explain = pos.isTest ? `Test week: a test stays as planned; readiness is just recorded.${r.color === 'red' ? ' On a red day, testing another day is the better call.' : ''}`
        : lightWeek ? `${pos.isRest ? 'Easy week' : 'Deload week'}: already as light as it gets, so readiness is just recorded.${r.color === 'red' ? ' If you feel wrecked, rest today and keep this session.' : ''}`
        : state.program.lightRestOfWeek ? 'Runs light: the rest of this week is light after two red check-ins.'
        : state.program.pushOn && r.color !== 'red' ? 'Runs trimmed while you push on past a deload suggestion: no bonus reps or earned sets, loads 2.5% down.'
        : r.color === 'green' ? `Loads and sets as planned.${plan.exercises.some(e => e.sets.some(x => x.plus > 0)) ? ' A + on the first set means bonus reps if it moves well.' : ''}`
        : r.color === 'yellow' ? 'Trimmed: loads 2.5% down, no bonus reps or earned sets. Same reps, same planned sets.'
        : `A light session (fewer sets, lighter loads) clears fatigue better than a day off or grinding through.${state.program.pushOn ? ' Pushing on this week, so the alternative is trimmed, not full.' : ''}`;
      return `<div class="card">
        <div class="row between"><h2>Readiness ${r.score}</h2><span class="pill ${r.color}">${r.color === 'green' ? 'Good to go' : r.color === 'yellow' ? 'So-so' : 'Rough day'}</span></div>
        <p>${explain}</p>
        ${r.color === 'red' && lightWeek ? `<button class="btn block" data-action="ci-rest">Rest today, keep this session for next time</button>` : ''}
        ${r.color === 'red' && !lightWeek ? `<div class="seg wrap">
            <button data-action="ci-choice" data-v="light" aria-pressed="${c.choice === 'light'}">Light session<small>recommended</small></button>
            ${state.program.lightRestOfWeek ? '' : `<button data-action="ci-choice" data-v="${state.program.pushOn ? 'trim' : 'full'}" aria-pressed="${c.choice === (state.program.pushOn ? 'trim' : 'full')}">${state.program.pushOn ? 'Trimmed' : 'As planned'}<small>if it's not fatigue</small></button>`}
          </div>
          <button class="btn block" data-action="ci-rest">Rest today, keep this session for next time</button>` : ''}
        <h3>${esc(plan.dayName)}</h3>${previewTime(plan, c.choice || r.mode)}${previewPlan(plan)}
        <div class="btnrow"><button class="btn" data-action="ci-back">Back</button><button class="btn primary" data-action="start-session" data-mode="${c.choice || r.mode}">Start ${E.MODES[c.choice || r.mode].label.toLowerCase()}</button></div>
      </div>`;
    }
    return `<div class="card">
      <h2>Check in</h2><p class="small muted">Be honest, then trust the plan. ${c.askGroups ? 6 : 4} taps.</p>
      ${c.askGroups ? `<div class="q"><span class="label">How sore are you since the last session?</span>
        ${['legs|Legs', 'push|Chest, shoulders, arms', 'hinge|Lower back, hips, hamstrings'].map(x => { const [k, t] = x.split('|'); return `<span class="tiny">${t}</span>${seg('g:' + k, SORE, true)}`; }).join('')}</div>` :
        `<div class="q"><span class="label">How sore are you overall?</span>${seg('g:legs', SORE, true)}</div>`}
      <div class="q"><span class="label">Sleep last night</span>${seg('sleep', ['Awful', 'Poor', 'OK', 'Good', 'Great'])}</div>
      <div class="q"><span class="label">Energy and mood</span>${seg('energy', ['Drained', 'Low', 'OK', 'Good', 'Great'])}</div>
      <div class="q"><span class="label">Motivation to train</span>${seg('motivation', ['None', 'Low', 'OK', 'Good', 'Fired up'])}</div>
      <div class="btnrow"><button class="btn" data-action="ci-cancel">Cancel</button><button class="btn primary" data-action="ci-submit">See today's plan</button></div>
    </div>`;
  }
  function submitCheckin() {
    const c = ui.checkin;
    if (!c.sleep || !c.energy || !c.motivation || !c.groups.legs || (c.askGroups && (!c.groups.push || !c.groups.hinge))) { toast('Answer every question'); return; }
    const soreness = E.sorenessFromGroups(c.groups);
    const r = E.readinessScore({ sleep: c.sleep, energy: c.energy, soreness, motivation: c.motivation });
    r.answers = { sleep: c.sleep, energy: c.energy, motivation: c.motivation, groups: Object.assign({}, c.groups) };
    r.mode = state.program.lightRestOfWeek ? 'light' : r.color === 'green' ? (state.program.pushOn ? 'trim' : 'full') : r.color === 'yellow' ? 'trim' : 'light';
    const pos = E.positionLabel(state);
    const lightWeek = pos.isDeload || pos.isRest || pos.isTest;
    if (lightWeek) r.mode = 'full';
    c.result = r; c.choice = r.color === 'red' && !lightWeek ? 'light' : null;
    const last = lastSession();
    if (last && c.askGroups) { last.soreness = Object.assign({}, c.groups); Store.pushSession(last); }
    save(); render();
  }
  function noonTs(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d, 12, 0, 0).getTime(); }
  function dayTs(iso) { return iso === todayISO() ? Date.now() : noonTs(iso); }
  // A past session is stamped noon of its date, except on the day of a restart or a max set by
  // hand: there it counts after that moment, as the plan it was logged against does.
  function backTs(date) {
    const P = state.program; let ts = dayTs(date);
    for (const b of [P.chronicSince, P.calibBaseTs]) if (b && tsISO(b) === date && ts <= b) ts = b + 1;
    return ts;
  }
  function startSession(mode, back) {
    const c = back ? null : ui.checkin, P = state.program;
    const sess = E.buildSession(state, mode);
    const pos = E.position(state);
    const planNotes = Array.isArray(sess.notes) ? sess.notes : [];
    Object.assign(sess, { id: 's_' + Date.now(), ts: Date.now(), date: todayISO(), phase: 'lift', startedAt: Date.now(), readiness: c ? c.result : null, mesoCount: P.mesoCount, blockIdx: P.blockIdx, dayIdx: P.dayIdx, notes: '', planNotes, skippedSlots: [] });
    if (back) { sess.backfill = true; sess.date = back.date; sess.ts = backTs(back.date); }
    if (P.lightRestOfWeek && mode === 'light' && !back) sess.forcedLight = true;
    if (c && c.result) { delete sess.readiness.mode; }
    sess.exercises.forEach(e => { e.sets.forEach(x => { x.done = false; x.actualReps = null; x.rpe = null; x.actualW = null; }); const w0 = e.sets.find(x => x.kind === 'work'); if (w0 && e.lift) e.plannedW = w0.w; });
    state.current = sess; ui.checkin = null; ui.backfill = null; ui.lastEi = null; ui.openWarm = {}; ui.editSets = {}; ui.lastDeleted = null; ui.todayScroll = 0; ui.quietUntil = performance.now() + 600;
    if (c && c.result && c.result.color === 'red') {
      const redsThisWeek = sessionsOfWeek().filter(s => s.readiness && s.readiness.color === 'red').length + 1;
      if (redsThisWeek >= 2 && !P.lightRestOfWeek && !pos.isDeload && !pos.rest && !pos.isTest && P.dayIdx < 3) { P.lightRestOfWeek = true; sess.setLightRest = true; addLog('Second red check-in: the rest of this week runs light.'); }
    }
    unlockAudio(); keepAwake(); save(); render(); scrollToY(0);
  }
  function restToday() { ui.checkin = null; addLog('Rested instead of training; the session stays queued.'); save(); render(); scrollToY(0); }
  // General undo: snapshot everything a program-level action can change (position, maxes, learned
  // set counts, the report and log) before the action, and offer one Undo until the next session.
  function snapshot(label, extra) {
    state.undo = Object.assign({ label, snap: JSON.stringify({ program: state.program, lifts: state.lifts, learned: state.learned, acc: state.acc, lastReport: state.lastReport || null, logLen: state.log.length, logHead: state.log[0] || null, tmPct: state.settings.tmPct }) }, extra || {});
  }
  function undoLast() {
    const u = state.undo; if (!u) return;
    let snap; try { snap = JSON.parse(u.snap); } catch (e) { state.undo = null; save(); render(); return; }
    // The snapshot goes through the same sanitizer as any stored state before it is restored.
    const settings = Object.assign({}, state.settings, Number.isFinite(snap.tmPct) ? { tmPct: snap.tmPct } : {});
    const clean = E.sanitizeState({ settings, lifts: snap.lifts, program: snap.program, learned: snap.learned, acc: snap.acc, lastReport: snap.lastReport, setupDone: true }, { trusted: false });
    state.settings.tmPct = clean.settings.tmPct;
    state.program = clean.program; state.lifts = clean.lifts; state.learned = clean.learned; state.lastReport = clean.lastReport;
    if (snap.acc) state.acc = clean.acc;
    // New lines go on top, so everything above the entry that was on top at the snapshot is the action's.
    const h = snap.logHead, hi = h ? state.log.findIndex(x => x && x.date === h.date && x.msg === h.msg) : -1;
    if (hi >= 0) state.log.splice(0, hi);
    else if (h === null) state.log.length = 0;
    else { const logLen = Number.isFinite(snap.logLen) ? Math.max(0, snap.logLen) : state.log.length; state.log.splice(0, Math.max(0, state.log.length - logLen)); }
    if (u.removeSessionId) { const i = state.sessions.findIndex(x => x.id === u.removeSessionId); if (i >= 0) { state.sessions.splice(i, 1); Store.deleteSession(u.removeSessionId); } }
    if (u.restoreSession) { state.sessions.push(u.restoreSession); state.sessions.sort((a, b) => (a.ts || 0) - (b.ts || 0)); Store.pushSession(u.restoreSession); }
    // A delete or an edit re-read the block's other sessions; read them again as they are now, so
    // their per-session records match the maxes that are back.
    const rs = u.restoreSession;
    if (rs && !rs.skipped && inBlock(rs) && (rs.ts || 0) > (state.program.calibBaseTs || 0)) recalibrateBlock(null);
    state.undo = null;
    save(); render(); toast(`Undone: ${u.label}`);
  }
  function renderUndo() { return state.undo ? `<div class="callout warn row between"><span>${esc(state.undo.label)}.</span><span class="row nowrap" style="gap:6px"><button class="btn sm" data-action="undo">Undo</button><button class="btn sm quiet icon" data-action="undo-dismiss" aria-label="Dismiss">✕</button></span></div>` : ''; }
  function skipSession() {
    const P = state.program, pos = E.positionLabel(state);
    const s = { id: 's_' + Date.now(), ts: Date.now(), date: todayISO(), skipped: true, dayId: pos.day.id, dayName: pos.day.name, mesoCount: P.mesoCount, blockIdx: P.blockIdx, dayIdx: P.dayIdx, week: P.week, isRest: pos.isRest, isDeload: pos.isDeload, exercises: [] };
    snapshot(`Skipped ${pos.day.name}`, { removeSessionId: s.id });
    state.sessions.push(s); Store.pushSession(s);
    addLog(`Skipped ${pos.day.name}.`);
    afterSession(s.id);
    save(); render();
  }

  // ---------- Session ----------
  function renderSession() {
    const s = state.current;
    const doneSets = s.exercises.reduce((n, e) => n + (s.skippedSlots.includes(e.slotKey) ? 0 : e.sets.filter(x => x.done && x.kind !== 'warm').length), 0);
    const totalSets = s.exercises.reduce((n, e) => n + (s.skippedSlots.includes(e.slotKey) ? 0 : e.sets.filter(x => x.kind !== 'warm').length), 0);
    const editing = s.phase === 'edit';
    let html = `<div class="row between"><div><h2>${editing ? 'Editing: ' : ''}${esc(s.dayName)}</h2><div class="small muted">${esc(s.blockName)} · ${s.isDeload ? 'Deload' : s.isRest ? 'Easy week' : s.isTest ? 'Test week' : 'Week ' + s.week} · ${E.MODES[s.mode].label}${s.readiness ? ` · readiness ${s.readiness.score}` : ''}${s.backfill ? ` · logged for ${fmtDate(s.date)}` : ''}</div></div><span class="pill">${doneSets}/${totalSets} sets</span></div>`;
    if (!editing && !s.backfill && s.date < todayISO()) html += `<div class="callout warn">Started ${fmtDateLong(s.date)} and still open. Finish or discard it; it stays dated ${fmtDate(s.date)}.</div>`;
    if (editing) html += `<div class="card"><label class="f">Date<input id="edit-date" type="date" value="${esc(s.editDate || s.date)}" max="${todayISO()}" data-edit="date"></label>
      <div class="grid2"><label class="f">Bike after (min)<input id="edit-cardio" type="number" inputmode="numeric" value="${s.cardio && s.cardio.min ? s.cardio.min : ''}" placeholder="0" data-edit="cardio"></label>
      <label class="f"><span>Watts <span class="opt">(optional)</span></span><input id="edit-watts" type="number" inputmode="numeric" value="${s.cardio && s.cardio.watts ? s.cardio.watts : ''}" placeholder="${esc(state.settings.cardioWatts)}" data-edit="watts"></label></div>
      <div class="q"><span class="label">Overall, that session was</span><div class="seg wrap">${[1, 2, 3, 4].map(v => `<button data-action="post-diff" data-v="${v}" aria-pressed="${!!s.post && s.post.difficulty === v}">${DIFF[v]}</button>`).join('')}</div></div>
      <p class="small muted">Retype, tick or untick any set. Saving re-reads the block's maxes if this session is in the current block.</p></div>`;
    for (const n of (Array.isArray(s.planNotes) ? s.planNotes : [])) html += `<div class="callout">${esc(n)}</div>`;
    // The exercise you are on: the one you last ticked while it has sets left, else the first
    // unfinished one. Its next set is highlighted; finished exercises above fold to one line.
    const live = (e) => !s.skippedSlots.includes(e.slotKey) && e.sets.some(x => !x.done);
    const lastEi = ui.lastEi != null ? ui.lastEi : (Number.isInteger(s.lastEi) ? s.lastEi : null);
    const cur = lastEi != null && s.exercises[lastEi] && live(s.exercises[lastEi]) ? lastEi : s.exercises.findIndex(live);
    // Folding: you can fold or unfold any exercise (remembered for the session); left alone, an
    // exercise folds itself once every set is done and you have moved on to another one.
    const folded = (e, ei) => e.fold === 'closed' || (e.fold !== 'open' && !editing && e.sets.length > 0 && e.sets.every(x => x.done) && ei !== lastEi);
    const shown = s.exercises.filter(e => !s.skippedSlots.includes(e.slotKey));
    const anyOpen = s.exercises.some((e, ei) => !s.skippedSlots.includes(e.slotKey) && !folded(e, ei));
    if (shown.length > 1) html += `<div class="row between session-tools"><span class="small muted">Swipe a set left to delete it.</span><button class="btn sm quiet" data-action="fold-all" data-v="${anyOpen ? 'closed' : 'open'}">${anyOpen ? 'Collapse all' : 'Expand all'}</button></div>`;
    const setText = (x) => `${x.actualW != null ? x.actualW : (x.w != null ? x.w : 'bw')}×${x.actualReps != null ? x.actualReps : x.reps}${x.rpe != null ? '@' + x.rpe : ''}`;
    s.exercises.forEach((e, ei) => {
      const skipped = s.skippedSlots.includes(e.slotKey);
      if (!skipped && folded(e, ei)) {
        const work = e.sets.filter(x => x.kind !== 'warm'), doneWork = work.filter(x => x.done);
        const allDone = e.sets.every(x => x.done);
        const next = e.sets.find(x => !x.done && x.kind !== 'warm');
        const nextW = next ? (next.actualW != null ? next.actualW : next.w) : null;
        const sub = allDone ? (doneWork.map(setText).join(', ') || 'done')
          : `${doneWork.length}/${work.length} sets done${next ? ` · next ${nextW != null ? nextW + '×' : ''}${next.reps}` : ''}`;
        html += `<section class="ex collapsed${allDone ? '' : ' todo'}" data-ei="${ei}"><button class="ex-sum" data-action="ex-fold" data-ei="${ei}" data-v="open" aria-expanded="false" aria-label="Show ${esc(e.name)}">
          <span class="tick" aria-hidden="true">${allDone ? '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>' : `<span class="num">${doneWork.length}</span>`}</span>
          <span class="sum-main"><b>${esc(e.name)}</b><span class="small muted num">${sub}</span></span><span class="chev"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></span></button></section>`;
        return;
      }
      const first = e.sets.find(x => x.kind === 'work' || x.kind === 'test') || e.sets[0];
      const nextSet = e.sets.find(x => !x.done && x.kind !== 'warm' && (x.actualW != null || x.w != null));
      const nextW = nextSet ? (nextSet.actualW != null ? nextSet.actualW : nextSet.w) : null;
      const swaps = editing ? [] : E.swapOptions(state, e.slotKey).filter(x => x !== e.ex);
      html += `<section class="ex" data-ei="${ei}">
        <div class="ex-head"><div><div class="name">${esc(e.name)}</div>
          <div class="meta">${e.role === 'primary' ? 'Main lift' : e.role === 'secondary' ? 'Second lift' : 'Accessory'}${e.optional ? ' · optional' : ''}${e.pctTM != null ? ` · ${pctLabel(e)}` : ''}${e.rpeTarget != null && !s.isTest ? ` · aim RPE ${e.rpeTarget}${e.rpeTarget < 6 ? ', easy' : ''}` : ''}${e.repRange ? ` · ${e.repRange[0]}–${e.repRange[1]} reps; all at ${e.repRange[1]} adds weight` : ''}</div></div>
          <div class="ex-tools">${skipped ? `<button class="btn sm quiet" data-action="toggle-skip" data-ei="${ei}">Undo skip</button>` : ''}${skipped ? '' : `<button class="fold-btn" data-action="ex-fold" data-ei="${ei}" data-v="closed" aria-expanded="true" aria-label="Fold ${esc(e.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg></button>`}</div></div>
        ${e.cue ? `<div class="ex-note">${esc(e.cue)}</div>` : ''}${e.note ? `<div class="ex-note">${esc(e.note)}</div>` : ''}
        ${e.adjNote ? `<div class="ex-note adj">${esc(e.adjNote)}</div>` : ''}
        ${!skipped && (e.hitFloor && e.sets.some(x => x.kind === 'work' && !x.done)) ? `<div class="ex-note"><button class="btn sm" data-action="cut-sets" data-ei="${ei}">Cut the remaining sets</button></div>` : ''}
        ${!skipped && e.cut ? `<div class="ex-note"><button class="btn sm quiet" data-action="restore-sets" data-ei="${ei}">Restore ${e.cut} cut set${e.cut > 1 ? 's' : ''}</button></div>` : ''}
        ${skipped ? '' : renderSets(e, ei, ei === cur && !editing ? e.sets.findIndex(x => !x.done) : -1)}
        ${skipped ? '' : `<div class="ex-foot">
          ${e.load === 'bar' && nextW ? `<span class="plates">Next work set <b>${nextW}</b> = ${esc(plateText(nextW))}</span>` : e.load === 'bar' && first && first.w ? `<span class="plates">All work sets done</span>` : e.needsWeight ? `<span class="small muted">${esc(e.startHint || 'Enter a working weight')}</span>` : '<span></span>'}
          <span class="foot-tools">${ui.lastDeleted && ui.lastDeleted.sid === s.id && ui.lastDeleted.ei === ei ? `<button class="btn sm primary" data-action="undo-del" data-ei="${ei}">Undo delete</button>` : ''}${e.optional && !(ui.editSets && ui.editSets[ei]) ? `<button class="btn sm quiet" data-action="toggle-skip" data-ei="${ei}">Skip</button>` : ''}<button class="btn sm ${ui.editSets && ui.editSets[ei] ? 'primary' : ''}" data-action="edit-sets" data-ei="${ei}">${ui.editSets && ui.editSets[ei] ? 'Done' : 'Remove sets'}</button>${swaps.length && !(ui.editSets && ui.editSets[ei]) ? `<select class="btn sm" data-action="swap" data-ei="${ei}" aria-label="Swap exercise"><option value="">Swap…</option>${swaps.map(x => `<option value="${x}">${esc(E.exerciseName(state, x))}</option>`).join('')}</select>` : ''}</span>
        </div>`}
        ${!skipped && e.load === 'bar' && first && first.w && !s.isTest && e.role !== 'accessory' && !e.sets.some(x => x.kind === 'warm') ? `<details class="warm"><summary class="tiny">Warm-up ramp</summary>${E.warmups(first.w, state.settings.barWeight, state.settings.increment, e.role, state.settings.plates).map(w => `<span class="num">${w.w} × ${w.reps}</span>`).join('')}</details>` : ''}
      </section>`;
    });
    if (editing) return html + `<div class="card"><label class="f">Notes<textarea id="sess-notes" data-action="notes" rows="2" maxlength="1000" placeholder="Anything worth remembering">${esc(s.notes)}</textarea></label>
      <button class="btn primary block" data-action="edit-save">Save changes</button>
      ${ui.confirm === 'cancel-edit' ? `<div class="callout warn">Throw away the changes you made here? <div class="btnrow" style="margin-top:8px"><button class="btn sm danger" data-action="edit-cancel-confirm">Discard changes</button><button class="btn sm" data-action="confirm-cancel">Keep editing</button></div></div>` : ''}
      <button class="btn quiet block" data-action="edit-cancel">Cancel editing</button></div>`;
    if (sessionComplete(s)) html += `<div class="callout good">Every set is logged. Check your numbers, then tap Finish lifting.</div>`;
    html += `<div class="card"><label class="f">Notes<textarea id="sess-notes" data-action="notes" rows="2" maxlength="1000" placeholder="Anything worth remembering">${esc(s.notes)}</textarea></label>
      <button class="btn primary block" data-action="finish-lifting">Finish lifting</button>
      ${ui.confirm === 'finish' ? `<div class="callout warn">${totalSets - doneSets === 1 ? '1 set is' : `${totalSets - doneSets} sets are`} not ticked. Finish anyway? <div class="btnrow" style="margin-top:8px"><button class="btn sm primary" data-action="finish-confirm">Yes, finish</button><button class="btn sm" data-action="confirm-cancel">Keep going</button></div></div>` : ''}
      <button class="btn quiet block" data-action="abandon">Discard this session</button>
      ${ui.confirm === 'abandon' ? `<div class="callout bad">Throw away everything logged today? <div class="btnrow" style="margin-top:8px"><button class="btn sm danger" data-action="abandon-confirm">Discard</button><button class="btn sm" data-action="confirm-cancel">Keep</button></div></div>` : ''}
    </div>`;
    return html;
  }
  function renderSets(e, ei, nextSi) {
    const s = state.current;
    // Once the warm-ups are done and the first working set is ticked, they fold into one row.
    const warm = e.sets.filter(x => x.kind === 'warm');
    const editingSets = !!(ui.editSets && ui.editSets[ei]);
    const foldWarm = !editingSets && s.phase !== 'edit' && warm.length > 0 && warm.every(x => x.done) && e.sets.some(x => x.kind !== 'warm' && x.done) && !(ui.openWarm && ui.openWarm[ei]);
    const warmRow = foldWarm ? `<button class="set warm-sum" data-action="warm-open" data-ei="${ei}"><span class="n">W</span><span class="small muted">Warm-up done · ${warm.length} set${warm.length > 1 ? 's' : ''}, up to ${Math.max(...warm.map(x => (x.actualW != null ? x.actualW : x.w) || 0))}</span><span class="small muted">Show</span></button>` : '';
    const editHint = editingSets ? `<div class="ex-note">Tap × on a set you skipped. Removed sets don't count anywhere.</div>` : '';
    return `${editHint}<div class="sets">${warmRow}${e.sets.map((x, si) => {
      if (foldWarm && x.kind === 'warm') return '';
      const w = x.actualW != null ? x.actualW : x.w;
      const reps = x.actualReps != null ? x.actualReps : '';
      const kind = x.kind === 'warm' ? 'warm-up' : x.kind === 'single' ? 'opener' : x.kind === 'test' ? (x.open ? 'top single' : 'single') : x.ind ? `top set` : '';
      const prevTyped = e.repRange ? e.sets.slice(0, si).reverse().find(y => y.done && y.actualReps != null && !y.autoReps && y.kind === x.kind) : null;
      const said = setLabel(e, si), repsPh = prevTyped ? String(prevTyped.actualReps) : `${x.reps}${x.plus ? '+' : ''}`;
      return `<div class="set${x.done ? ' done' : ''}${x.kind === 'warm' ? ' is-warm' : ''}${si === nextSi ? ' next' : ''}" data-si="${si}"><button class="swipe-del" data-action="del-set" data-ei="${ei}" data-si="${si}" tabindex="-1" aria-label="Delete this set">Delete</button>
        <span class="n">${x.kind === 'warm' ? 'W' : x.kind === 'single' ? 'O' : si + 1 - e.sets.filter((y, j) => j < si && (y.kind === 'warm' || y.kind === 'single')).length}</span>
        <div class="field"><input id="w-${ei}-${si}" type="number" inputmode="decimal" step="${e.load === 'db' ? state.settings.dbIncrement : e.load === 'bw' ? 1 : 2.5}" data-set="w" data-ei="${ei}" data-si="${si}" aria-label="${esc(e.name)}, ${said} weight" value="${w == null ? '' : w}" placeholder="${e.load === 'bw' ? 'bw' : '—'}"><span class="u">${e.load === 'bar' && w != null ? esc(platesShort(w)) : e.load === 'bw' ? 'added lb' : e.load === 'db' ? 'lb each' : 'lb'}</span></div>
        <div class="field"><input id="r-${ei}-${si}" type="number" inputmode="numeric" data-set="r" data-ei="${ei}" data-si="${si}" aria-label="${esc(e.name)}, ${said} reps" value="${reps}" placeholder="${repsPh}"><span class="u">${kind ? `<span class="kind">${kind}</span>` : `reps`}</span></div>
        ${x.kind === 'warm' ? '<span></span>' : `<button class="rpe ${x.rpe == null ? 'empty' : ''}" data-action="rpe" data-ei="${ei}" data-si="${si}" aria-label="${x.rpe == null ? 'RPE not set' : `RPE ${x.rpe}`}">${x.rpe == null ? (x.rpeTarget != null ? `~${x.rpeTarget}` : 'RPE') : x.rpe}</button>`}
        ${editingSets ? `<button class="del" data-action="del-set" data-ei="${ei}" data-si="${si}" aria-label="Delete this set"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` : `<button class="ok" data-action="done" data-ei="${ei}" data-si="${si}" aria-label="${x.done ? 'Undo set' : 'Set done'}"><svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg></button>`}
      </div>`;
    }).join('')}</div>`;
  }
  // Clamp what the set fields accept: a slip of the thumb must not become evidence.
  function cleanW(v) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.min(2000, Math.round(n * 4) / 4) : null; }
  function cleanReps(v) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.min(30, Math.round(n)) : null; }
  // A number that is probably a typo (a dropped or doubled digit, a weight under the empty bar, 18
  // reps for 8): asked about once before it can move the next sets or the maxes. Warm-ups are free.
  function oddEntry(e, x, w, r) {
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
  function openCheck(ei, si, odd, then) {
    applyPendingType();
    ui.sheet = { kind: 'check', ei, si, odd, then }; ui.quietUntil = performance.now() + 400; // the tap that left the field must not answer it
    renderSheet();
    const b = document.querySelector('.sheet .btn.primary'); if (b) try { b.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }
  function setField(ei, si, which, val, fromTyping) {
    const e = state.current && state.current.exercises[ei], x = e && e.sets[si];
    if (!x) return;
    const before = e.sets.length;
    const v = val === '' || val == null ? null : (which === 'w' ? cleanW(val) : cleanReps(val));
    // A likely typo is kept as typed but goes nowhere until you answer the check.
    if (!fromTyping && v != null) {
      const odd = oddEntry(e, x, which === 'w' ? v : null, which === 'r' ? v : null);
      if (odd) { openCheck(ei, si, odd, 'none'); return; } // nothing is stored until you answer; closing the check leaves the old value
    }
    if (which === 'w') {
      const shown = x.actualW != null ? x.actualW : x.w;
      delete x.autoW;
      x.actualW = v;
      if (!x.done) { x.manualW = v != null && (!!x.manualW || v !== shown); delete x.carriedFrom; if (e.needsWeight && v != null) e.needsWeight = false; }
      // On leaving the field (not while typing) a working weight carries to the later undone work
      // sets you have not typed into yourself. They remember where it came from, so editing this set
      // again, ticked or not, updates them too, and clearing it releases them. Warm-ups and test
      // attempts change one at a time.
      if (!fromTyping && x.kind === 'work') e.sets.forEach((y, j) => {
        if (j <= si || y.done || y.kind !== 'work') return;
        if (x.done ? y.carriedFrom === si : (!y.manualW || y.carriedFrom === si)) { y.actualW = v; y.manualW = v != null && v !== y.w; if (y.manualW) y.carriedFrom = si; else delete y.carriedFrom; }
      });
    } else { x.actualReps = v; delete x.autoReps; }
    // A field edit re-aims the remaining sets but never cuts them: the fatigue stop waits for a
    // tick or an RPE, so the tap that follows a blur always lands where you aimed it.
    if (!fromTyping || x.done) recalcExercise(ei, true, fromTyping, true);
    save();
    if (e.sets.length !== before) { render(); return; } // sets came back (a corrected reading undid a cut)
    if (!fromTyping) patchExercise(ei);
    if (which === 'w') { const u = $(`#w-${ei}-${si}`); if (u && u.nextElementSibling && e.load === 'bar') u.nextElementSibling.textContent = v != null ? platesShort(v) : 'lb'; }
  }
  // Refresh one exercise's inputs, plate readouts, note and footer in place (no rebuild), so the
  // tap that follows a blur is never swallowed.
  function patchExercise(ei) {
    const s = state.current, e = s.exercises[ei]; if (!e) return;
    e.sets.forEach((x, si) => {
      const w = x.actualW != null ? x.actualW : x.w;
      const inp = $(`#w-${ei}-${si}`);
      if (inp && document.activeElement !== inp) { const v = w == null ? '' : String(w); if (inp.value !== v) inp.value = v; if (inp.nextElementSibling && e.load === 'bar') inp.nextElementSibling.textContent = w != null ? platesShort(w) : 'lb'; }
      const rin = $(`#r-${ei}-${si}`);
      if (rin && document.activeElement !== rin) { const v = x.actualReps != null ? String(x.actualReps) : ''; if (rin.value !== v) rin.value = v; }
    });
    const sec = document.querySelector(`.ex[data-ei="${ei}"]`); if (!sec) return;
    const note = sec.querySelector('.ex-note.adj'); if (note) note.textContent = e.adjNote || ''; else if (e.adjNote) { const d = document.createElement('div'); d.className = 'ex-note adj'; d.textContent = e.adjNote; const head = sec.querySelector('.ex-head'); head && head.insertAdjacentElement('afterend', d); }
    const nextSet = e.sets.find(x => !x.done && x.kind !== 'warm' && (x.actualW != null || x.w != null));
    const nextW = nextSet ? (nextSet.actualW != null ? nextSet.actualW : nextSet.w) : null;
    const foot = sec.querySelector('.plates'); if (foot && e.load === 'bar') foot.innerHTML = nextW ? `Next work set <b>${nextW}</b> = ${esc(plateText(nextW))}` : 'All work sets done';
  }
  // Every set of every exercise you are doing is ticked (skipped exercises do not count).
  function sessionComplete(s) {
    return !!s && s.phase === 'lift' && s.exercises.every(e => s.skippedSlots.includes(e.slotKey) || e.sets.every(x => x.done || x.kind === 'warm'));
  }
  // After any change to the sets: when nothing is left to lift, there is nothing to rest for.
  function afterSetChange() { if (sessionComplete(state.current)) { stopTimer(); if (ui.confirm === 'finish') ui.confirm = null; } }
  function markDone(ei, si) {
    const e = state.current.exercises[ei], x = e.sets[si];
    const wEl = $(`#w-${ei}-${si}`), rEl = $(`#r-${ei}-${si}`);
    if ((wEl && wEl.validity && wEl.validity.badInput) || (rEl && rEl.validity && rEl.validity.badInput)) { toast('Use digits and one decimal point'); return false; }
    if (wEl && wEl.value !== '') { const v = cleanW(wEl.value); if (v !== x.actualW) delete x.autoW; x.actualW = v; }
    else if (x.actualW == null && x.w != null) { x.actualW = x.w; x.autoW = true; }
    if (rEl && rEl.value !== '') { const v = cleanReps(rEl.value); if (v !== x.actualReps) delete x.autoReps; x.actualReps = v; }
    else if (x.actualReps == null) {
      // A rep range: take the reps you typed on the set before, rather than the bottom of the range.
      const prev = e.repRange ? e.sets.slice(0, si).reverse().find(y => y.done && y.actualReps != null && !y.autoReps && y.kind === x.kind) : null;
      x.actualReps = prev ? prev.actualReps : x.reps; x.autoReps = true;
    }
    if (x.actualW == null && e.load !== 'bw') { toast('Enter the weight first'); wEl && wEl.focus(); return false; }
    const odd = oddEntry(e, x, x.actualW, x.actualReps);
    if (odd) { openCheck(ei, si, odd, 'tick'); return false; }
    x.done = true; x.doneAt = Date.now();
    if (state.current.backfill || state.current.phase === 'edit') return true; // nothing to rest for
    if (sessionComplete(state.current)) { stopTimer(); return true; } // the last set: lifting is over
    const sc = state.current; let label = e.name;
    if (!e.sets.some(y => !y.done)) { const order = sc.exercises.map((n, k) => k).filter(k => k !== ei); const k = order.find(j => j > ei && !sc.skippedSlots.includes(sc.exercises[j].slotKey) && sc.exercises[j].sets.some(y => !y.done)); const k2 = k != null ? k : order.find(j => !sc.skippedSlots.includes(sc.exercises[j].slotKey) && sc.exercises[j].sets.some(y => !y.done)); if (k2 != null) label = sc.exercises[k2].name; }
    if (x.kind === 'warm') { const lastWarm = !e.sets.slice(si + 1).some(y => y.kind === 'warm'); startTimer(lastWarm ? Math.min(120, e.rest) : 60, label, x); }
    else startTimer(e.rest, label, x);
    return true;
  }
  function toggleDone(ei, si) {
    const e = state.current && state.current.exercises[ei], x = e && e.sets[si];
    if (!x) { render(); return; }
    if (x.done) {
      // Unticking undoes the tick: its rating, and the weight or reps it filled in for you, go too,
      // so ticking it again asks again.
      x.done = false; x.rpe = null; delete x.doneAt;
      if (x.autoReps) { x.actualReps = null; delete x.autoReps; }
      if (x.autoW) { x.actualW = null; delete x.autoW; }
      if (x.timerSrc) stopTimer();
      recalcExercise(ei, true); afterSetChange(); save(); render(); return;
    }
    applyPendingType();
    if (!markDone(ei, si)) return;
    recalcExercise(ei);
    afterSetChange();
    save(); render();
    // A main-lift set is logged (and its rest started) at once; then you are asked how hard it was.
    const si2 = e.sets.indexOf(x); // a fatigue stop may have moved it
    if (x.done && si2 >= 0 && x.kind !== 'warm' && e.lift && (e.pctTM != null || x.kind === 'test') && x.rpe == null) { ui.sheet = { ei, si: si2, fromTick: true, resting: !!(ui.timer && !ui.timer.fired) }; renderSheet(); }
  }
  // In-session autoregulation. Every done working set with an RPE (or a miss) is evidence of
  // today's strength; the rep-max table turns that into the weight that would land the planned
  // reps at the target RPE, and the remaining sets are set to it. Re-run from scratch on ANY edit
  // (tick, untick, RPE change, weight or rep change), so changing your mind is always honoured.
  // Sets you typed a weight into yourself are left alone. Deload, easy and test weeks are exempt.
  // typing: true while a field is still being typed into; the stop rule waits for the final value.
  // noCut: a field edit; it may re-aim and restore, never cut.
  function recalcExercise(ei, quiet, typing, noCut) {
    const s = state.current, e = s && s.exercises[ei];
    // Back-dated and edited sessions are records of what was lifted: nothing is re-aimed.
    if (!s || !e || !e.lift || e.pctTM == null || s.isDeload || s.isRest || s.isTest || s.phase === 'edit' || s.backfill) return;
    const work = e.sets.filter(x => x.kind === 'work');
    if (!work.length) return;
    if (e.plannedW == null) e.plannedW = work[0].w;
    const evidence = [];
    // The opener single (Strength week 3) is evidence too, read against its own RPE target.
    e.sets.filter(x => x.kind === 'single' || x.kind === 'work').forEach(x => {
      if (!x.done) return;
      let reps = x.actualReps != null ? x.actualReps : x.reps;
      let rpe = x.rpe; if (rpe == null && reps < x.reps) rpe = 10;
      const w = x.actualW != null ? x.actualW : x.w;
      const zero = reps === 0; // a set that did not go up at all: the strongest miss there is
      if (zero) { reps = 1; rpe = 10; }
      if (rpe == null || !w || !reps) return;
      evidence.push({ w, reps, rpe, first: x === work[0], missed: zero || reps < x.reps, target: x.kind === 'single' ? x.rpeTarget : null, planned: x.reps });
    });
    const C = E.TUNE.correction, peak = !!(E.BLOCKS[s.blockIdx] && E.BLOCKS[s.blockIdx].test);
    const r = E.liftCorrection(evidence, e.plannedW, work[0].reps, e.rpeTarget, { down: C.floor, up: peak ? C.ceilPeak : s.mode === 'light' ? C.ceilLight : C.ceil, inc: state.settings.increment }); // a light session is not pushed up: it exists to cut fatigue
    const missedAny = evidence.some(x => x.missed);
    // The fatigue stop cut sets on a reading that has since been corrected (a typo fixed, an RPE
    // changed, the set unticked): the sets come back on their own.
    if (e.autoCut > 0 && !(r && r.stop) && !typing) { putBackCut(e, e.autoCut); e.autoCut = 0; e.autoStopped = false; if (!quiet) toast(`${e.name}: the cut sets are back`); }
    const target = r ? E.loadRound(state, r.w) : e.plannedW;
    const before = e.target || e.plannedW;
    let changed = 0;
    e.sets.forEach(x => {
      if (x.kind !== 'work' || x.done || x.manualW) return;
      const cur = x.actualW != null ? x.actualW : x.w;
      if (target !== cur) { x.actualW = target === x.w ? null : target; changed++; }
    });
    e.target = target; e.est = r ? Math.round(r.est) : null; e.hitFloor = !!(r && (r.hitFloor || missedAny));
    const estTxt = evidence.some(x => x.rpe >= 6.5); // sets further from failure than that cannot say what a max is
    e.adjNote = !r ? null
      : Math.abs(target / e.plannedW - 1) < 0.005 ? (estTxt ? `On target (estimate ~${e.est}).` : 'On target.')
      : `${estTxt ? `Estimate ~${e.est}: next` : 'Next'} sets ${target > e.plannedW ? 'up' : 'down'} to ${target} (${target > e.plannedW ? '+' : ''}${((target / e.plannedW - 1) * 100).toFixed(1)}%).${r.hitFloor ? " Today's floor." : missedAny ? ' Reps were missed.' : ''}`;
    // The stop rule (a miss, a set still 2+ over target after a correction, or the floor): the
    // remaining sets come off automatically, once; "Restore" puts them back if you know better.
    if (e.autoStopped && e.cut && e.adjNote) e.adjNote += ' Remaining sets cut by the fatigue stop.';
    if (r && r.stop && !e.autoStopped && !typing && !noCut) {
      const keep = e.sets.filter(x => x.done || x.kind !== 'work'), removed = e.sets.length - keep.length;
      if (removed > 0) {
        e.autoStopped = true; e.autoCut = removed; e.cut = (e.cut || 0) + removed; e.sets = keep;
        e.adjNote = `${e.adjNote} Fatigue stop: ${removed} set${removed > 1 ? 's' : ''} cut. Restore below if you know better.`;
        if (!quiet) toast(`${e.name}: remaining sets cut`);
        return removed;
      }
    }
    if (changed && !quiet && target !== before) toast(`${e.name}: remaining sets ${target > before ? 'up' : 'down'} to ${target}`);
    return changed;
  }
  // Settings changed a max mid-session: rebase every undone set of that lift on the new TM.
  function rebaseSession() {
    const s = state.current; if (!s || s.phase !== 'lift') return;
    const S = state.settings; let n = 0;
    for (let ei = 0; ei < s.exercises.length; ei++) {
      const e = s.exercises[ei]; if (!e.lift || !E.EX[e.ex].tm) continue;
      const tm = state.lifts[e.lift].tm, mult = E.EX[e.ex].mult;
      const first = e.sets.find(x => x.kind === 'work');
      if (!first || first.pct == null) continue;
      const planned = E.loadRound(state, tm * mult * first.pct);
      if (planned === e.plannedW) continue;
      e.plannedW = planned;
      e.sets.forEach(x => { if (x.done || x.manualW || x.pct == null) return; x.w = E.loadRound(state, tm * mult * x.pct); x.actualW = null; n++; });
      const one = state.lifts[e.lift].oneRM * mult; // the planned effort follows the new max, so the auto-correction aims right
      if (one > 0 && e.pctTM != null) { const nr = E.plannedRPE(planned / one, first.reps); e.rpeTarget = nr; e.sets.forEach(x => { if (!x.done && x.kind === 'work') x.rpeTarget = nr; }); }
      if (!s.isTest && !e.sets.some(x => x.kind === 'warm' && x.done) && S.warmupSets !== false) {
        const fresh = E.warmups(planned, S.barWeight, S.increment, e.role, S.plates).map(st => ({ w: st.w, reps: st.reps, kind: 'warm', done: false, actualReps: null, rpe: null, actualW: null }));
        const rest = e.sets.filter(x => x.kind !== 'warm'), single = rest.find(x => x.kind === 'single');
        if (single && single.w) { const ws = E.openerWarm(single.w, fresh.length ? fresh[fresh.length - 1].w : S.barWeight, S.barWeight, S.increment, S.plates); if (ws) fresh.push({ w: ws, reps: 1, kind: 'warm', done: false, actualReps: null, rpe: null, actualW: null }); }
        const delta = fresh.length - (e.sets.length - rest.length);
        if (delta) rest.forEach(y => { if (y.carriedFrom != null) y.carriedFrom += delta; });
        e.sets = fresh.concat(rest);
        if (ui.lastDeleted && ui.lastDeleted.ei === ei) ui.lastDeleted = null;
        if (ui.sheet && ui.sheet.ei === ei) { ui.sheet = null; renderSheet(); }
      }
      recalcExercise(ei, true);
    }
    if (n) toast('Remaining sets rebased to the new max');
  }
  function deleteSet(ei, si) {
    const s = state.current; if (!s) return;
    const e = s.exercises[ei]; if (!e || !e.sets[si]) return;
    applyPendingType();
    const x = e.sets[si];
    if (x.kind !== 'warm' && e.sets.filter(y => y.kind !== 'warm').length <= 1) { toast('Keep at least one working set'); return; }
    e.sets.splice(si, 1);
    const released = [];
    e.sets.forEach(y => { if (y.carriedFrom != null) { if (y.carriedFrom === si) { released.push({ y, w: y.actualW, m: !!y.manualW, done: y.done }); delete y.carriedFrom; if (!y.done) { y.manualW = false; y.actualW = null; } } else if (y.carriedFrom > si) y.carriedFrom--; } });
    if (x.timerSrc) { stopTimer(); delete x.timerSrc; }
    if (ui.editSets) delete ui.editSets[ei]; // one deletion, then the ticks come back
    ui.lastDeleted = { sid: s.id, ei, si, set: x, released }; ui.lastEi = ei; s.lastEi = ei;
    if (ui.sheet && ui.sheet.ei === ei) { ui.sheet = null; renderSheet(); }
    toast(`${x.kind === 'warm' ? 'Warm-up' : 'Set'} removed. Undo is under ${e.name}.`);
    if (x.kind !== 'warm') recalcExercise(ei, true);
    afterSetChange();
    save(); render();
  }
  function undoDeleteSet(ei) {
    const s = state.current, u = ui.lastDeleted;
    if (!s || !u || u.sid !== s.id || u.ei !== ei || !s.exercises[ei]) return;
    const e = s.exercises[ei], at = Math.min(u.si, e.sets.length);
    e.sets.forEach(y => { if (y.carriedFrom != null && y.carriedFrom >= at) y.carriedFrom++; });
    e.sets.splice(at, 0, u.set);
    for (const r of u.released || []) if (e.sets.includes(r.y) && !r.y.done) { r.y.actualW = r.w; r.y.manualW = r.m; r.y.carriedFrom = at; }
    ui.lastDeleted = null; ui.lastEi = ei; s.lastEi = ei;
    if (u.set.kind !== 'warm') recalcExercise(ei, true);
    save(); render(); toast('Set restored');
  }
  function cutSets(ei) {
    const s = state.current, e = s.exercises[ei];
    const keep = e.sets.filter(x => x.done || x.kind !== 'work');
    const removed = e.sets.length - keep.length;
    if (!removed) return;
    e.cut = (e.cut || 0) + removed; e.sets = keep; e.autoCut = 0; // cut by you: they stay cut
    e.adjNote = `${removed} set${removed > 1 ? 's' : ''} cut.`;
    afterSetChange();
    save(); render();
  }
  function putBackCut(e, count) {
    const n = Math.min(e.cut || 0, count != null ? count : e.cut || 0); if (!(n > 0)) return;
    const last = e.sets.filter(x => x.kind === 'work').slice(-1)[0];
    for (let i = 0; i < n; i++) e.sets.push({ w: last ? last.w : e.plannedW, reps: last ? last.reps : 5, pct: last ? last.pct : null, kind: 'work', rpeTarget: e.rpeTarget, done: false, actualReps: null, rpe: null, actualW: null });
    e.cut = (e.cut || 0) - n;
  }
  function restoreSets(ei) {
    const s = state.current, e = s.exercises[ei];
    if (!(e.cut > 0)) return;
    putBackCut(e); e.autoCut = 0; recalcExercise(ei, true); save(); render();
  }
  function openRpe(ei, si) { if (ui.sheet && ui.sheet.kind === 'check') return; ui.sheet = { ei, si }; renderSheet(); }
  function setLabel(e, si) { const x = e.sets[si]; return x.kind === 'warm' ? 'warm-up' : x.kind === 'single' ? 'opener' : `set ${si + 1 - e.sets.filter((y, j) => j < si && (y.kind === 'warm' || y.kind === 'single')).length}`; }
  function renderSheet() {
    const ov = $('#overlay');
    if (!ui.sheet || !state.current) { ov.innerHTML = ''; return; }
    const { ei, si } = ui.sheet, e = state.current.exercises[ei], x = e && e.sets[si];
    if (!x) { ui.sheet = null; ov.innerHTML = ''; return; }
    if (ui.sheet.kind === 'check') {
      const o = ui.sheet.odd;
      ov.innerHTML = `<div class="sheet-bg" data-action="sheet-close"><div class="sheet" data-stop="1" role="dialog" aria-modal="true" aria-labelledby="sheet-h">
        <h2 id="sheet-h">Check this ${o.field === 'w' ? 'weight' : 'number'}</h2>
        <p>${esc(e.name)} · ${setLabel(e, si)}: ${esc(o.msg)} A typo?</p>
        <p class="small muted">Until you answer, it does not move your next sets or your maxes.</p>
        <div class="btnrow">${o.use != null ? `<button class="btn primary" data-action="check-use">Use ${o.use}${o.field === 'w' ? ' lb' : ' reps'}</button>` : `<button class="btn primary" data-action="check-fix">Fix it</button>`}<button class="btn" data-action="check-keep">Keep ${o.v}</button></div>
      </div></div>`;
      return;
    }
    const opts = [4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
    const tips = { 4: '6+ left', 5: '5 left', 6: '4 left', 7: '3 left', 8: '2 left', 9: '1 left', 10: 'max' };
    ov.innerHTML = `<div class="sheet-bg" data-action="sheet-close"><div class="sheet" data-stop="1" role="dialog" aria-modal="true" aria-labelledby="sheet-h">
      <div class="row between"><h2 id="sheet-h">${ui.sheet.fromTick ? 'Logged. How hard was it?' : 'How hard was that set?'}</h2><button class="btn sm quiet" data-action="sheet-close">${ui.sheet.fromTick ? 'Skip' : 'Close'}</button></div>
      ${ui.sheet.fromTick ? `<p class="small">Logged${ui.sheet.resting ? ', rest running' : ''}. An RPE adjusts the next sets and feeds your max. Optional.</p>` : ''}
      <p class="small muted">${esc(e.name)} · ${setLabel(e, si)}${x.rpeTarget != null ? ` · planned about RPE ${x.rpeTarget}` : ''}. RPE 8 means two clean reps were left.</p>
      <div class="rpegrid">${opts.map(v => `<button class="${v === x.rpeTarget ? 'target' : ''}" data-action="rpe-pick" data-v="${v}" aria-pressed="${v === x.rpe}">${v}<small>${tips[v] || ''}</small></button>`).join('')}${ui.sheet.fromTick ? `<button data-action="rpe-pick" data-v="skip">—<small>skip</small></button>` : `<button data-action="rpe-pick" data-v="">—<small>clear</small></button>`}</div>
    </div></div>`;
  }
  function swapExercise(ei, exId) {
    const s = state.current, e = s.exercises[ei];
    if (!exId || !E.swapOptions(state, e.slotKey).includes(exId)) return;
    if (e.sets.some(x => x.done && x.kind !== 'warm')) { toast('Untick the logged sets first, or keep this exercise today'); render(); return; }
    const P = state.program; delete P.swaps[e.slotKey];
    const planned = (E.buildSession(state, s.mode).exercises.find(x => x.slotKey === e.slotKey) || {}).ex;
    if (exId === planned) toast(`Back to the plan's ${E.exerciseName(state, exId)}`); // swapping back un-pins the slot, so the variations rotate again
    else { P.swaps[e.slotKey] = exId; toast(`${E.exerciseName(state, exId)} pinned (change in Program)`); }
    // Rebuild this exercise only, from a fresh plan under the same mode.
    const fresh = E.buildSession(state, s.mode).exercises.find(x => x.slotKey === e.slotKey);
    fresh.sets.forEach(x => { x.done = false; x.actualReps = null; x.rpe = null; x.actualW = null; });
    s.exercises[ei] = fresh;
    addLog(`${E.exerciseName(state, exId)} now fills the ${e.slotKey.replace(/_/g, ' ')} slot.`);
    if (ui.lastDeleted && ui.lastDeleted.ei === ei) ui.lastDeleted = null;
    if (ui.editSets) delete ui.editSets[ei];
    afterSetChange();
    save(); render();
  }
  function finishLifting(force) {
    const s = state.current;
    const open = s.exercises.reduce((n, e) => n + (s.skippedSlots.includes(e.slotKey) ? 0 : e.sets.filter(x => !x.done && x.kind !== 'warm').length), 0);
    if (open > 0 && !force) { ui.confirm = 'finish'; render(); return; }
    ui.confirm = null; stopTimer(); releaseAwake();
    ui.todayScroll = scroller().scrollTop; // "Back to the sets" returns here
    s.phase = 'post'; s.finishedAt = Date.now();
    let lastDone = 0; s.exercises.forEach(e => e.sets.forEach(x => { if (x.done && x.doneAt) lastDone = Math.max(lastDone, x.doneAt); }));
    let end = lastDone && s.finishedAt - lastDone > 30 * 60000 ? lastDone + 5 * 60000 : s.finishedAt; // left open long after the last set
    if (!lastDone && s.finishedAt - s.startedAt > 3 * 3600000) end = s.startedAt + (s.estMinutes || 60) * 60000; // nothing ticked and left open for hours
    s.durationMin = s.backfill ? 0 : Math.min(600, Math.max(1, Math.round((end - s.startedAt) / 60000)));
    s.post = s.post && s.post.difficulty ? s.post : { difficulty: 0 };
    ui.quietUntil = performance.now() + 600;
    save(); render(); scrollToY(0);
  }
  function abandon() {
    const s = state.current; stopTimer(); releaseAwake();
    if (s && s.setLightRest) { state.program.lightRestOfWeek = false; const i = state.log.findIndex(l => l && /Second red check-in/.test(l.msg) && l.date === todayISO()); if (i >= 0) state.log.splice(i, 1); }
    state.current = null; ui.confirm = null; ui.sheet = null; renderSheet();
    save(); render(); scrollToY(0);
  }

  // ---------- Post-session ----------
  function renderPost() {
    const s = state.current;
    const est = bestE1rm(s);
    return `<div class="card">
      <h2>How did that go?</h2>
      <div class="small muted">${s.backfill ? `Logged for ${fmtDate(s.date)}` : `${s.durationMin} min of lifting`}${est.length ? ' · ' + est.map(x => `${LIFTNAME[x.lift]} today's estimate ~${Math.round(x.e1rm)}`).join(' · ') : ''}</div>
      <div class="q"><span class="label">Overall, that session was</span>
        <div class="seg wrap">${[1, 2, 3, 4].map(v => `<button data-action="post-diff" data-v="${v}" aria-pressed="${s.post.difficulty === v}">${DIFF[v]}<small>${['', 'plenty left', 'hard, felt right', 'barely got through', 'should have gone light'][v]}</small></button>`).join('')}</div></div>
      <p class="small muted">This, your RPEs and your next soreness set next week's sets.</p>
      <button class="btn primary block" data-action="post-next">${state.settings.cardioMin ? 'Next: easy bike' : 'Save session'}</button>
      <button class="btn quiet block" data-action="post-back">Back to the sets</button>
    </div>`;
  }
  // Today's estimate per lift, the same statistic the calibration reads (weighted mean of the rated sets).
  function bestE1rm(s) {
    const out = [];
    for (const l of LIFTS) { const r = E.sessionEstimate(s, l, state.lifts[l].oneRM); if (r) out.push({ lift: l, e1rm: r.est }); }
    return out;
  }

  // ---------- Cardio ----------
  function renderCardio() {
    const s = state.current, target = s.cardioMin || state.settings.cardioMin, dr = s.cardioDraft || {};
    const run = s.cardioRun; // lives on the session, so a suspended app comes back with the clock still right
    const elapsed = run ? Math.floor(((run.paused ? run.pausedAt : Date.now()) - run.start - run.pausedTotal) / 1000) : (s.cardio && s.cardio.sec) || 0;
    const mm = Math.floor(elapsed / 60), ss = elapsed % 60;
    return `<div class="card">
      <h2>Easy bike</h2>
      <p class="small muted">${target} min at a pace you could talk through. Legs heavy? Go easier, not shorter.</p>
      <div class="kpi" style="align-items:center"><span class="v num" id="cardio-clock" style="font-size:3.4rem">${mm}:${String(ss).padStart(2, '0')}</span><span class="tiny">${run && !run.paused ? 'running' : run && run.paused ? 'paused' : 'ready'}</span></div>
      <div class="btnrow">${s.backfill ? '' : !run ? `<button class="btn primary" data-action="cardio-start">Start timer</button>` : run.paused ? `<button class="btn primary" data-action="cardio-resume">Resume</button>` : `<button class="btn" data-action="cardio-pause">Pause</button>`}</div>
      <hr class="sep">
      <div class="grid2">
        <label class="f">Minutes done<input id="cardio-min" type="number" inputmode="numeric" data-cardio="min" value="${dr.minTyped && dr.min != null ? dr.min : run ? Math.round(elapsed / 60) : (s.cardio && s.cardio.min) || ''}" placeholder="${target}"></label>
        <label class="f"><span>Average watts <span class="opt">(optional)</span></span><input id="cardio-w" type="number" inputmode="numeric" data-cardio="watts" value="${dr.watts != null ? dr.watts : (s.cardio && s.cardio.watts) || ''}" placeholder="${state.settings.cardioWatts}"></label>
      </div>
      ${ui.confirm === 'cardio-long' && ui.cardioLong ? `<div class="callout warn">The bike clock shows ${hr(ui.cardioLong.clock)}. Was it left running? <div class="btnrow" style="margin-top:8px"><button class="btn sm primary" data-action="cardio-log-target">Log ${ui.cardioLong.target} min</button><button class="btn sm" data-action="cardio-log-clock">Log ${hr(ui.cardioLong.clock)}</button></div></div>` : ''}
      <div class="btnrow"><button class="btn primary" data-action="cardio-save">Save session</button><button class="btn" data-action="cardio-skip">No bike today</button></div>
      <button class="btn quiet block" data-action="cardio-back">Back</button>
    </div>`;
  }
  let cardioTick = null; // one chain only
  function tickCardio() {
    clearTimeout(cardioTick); cardioTick = null;
    const s = state.current;
    if (!s || s.phase !== 'cardio' || !s.cardioRun || view !== 'today') return;
    const run = s.cardioRun, el = $('#cardio-clock');
    if (el && !run.paused) { const e = Math.max(0, Math.floor((Date.now() - run.start - run.pausedTotal) / 1000)); el.textContent = `${Math.floor(e / 60)}:${String(e % 60).padStart(2, '0')}`; const m = $('#cardio-min'); if (m && document.activeElement !== m && !(s.cardioDraft && s.cardioDraft.minTyped)) m.value = Math.round(e / 60); }
    if (!run.paused) cardioTick = setTimeout(tickCardio, 1000); // a paused clock needs no ticking; Resume renders and restarts it
  }
  function saveCardio(skip, force) {
    const s = state.current; if (!s) return;
    if (skip) s.cardio = { min: 0 };
    else {
      const run = s.cardioRun, target = s.cardioMin || state.settings.cardioMin, dr = s.cardioDraft || {};
      const el = $('#cardio-min'), wEl = $('#cardio-w');
      const clockMin = run ? Math.round(Math.max(0, (run.paused ? run.pausedAt : Date.now()) - run.start - run.pausedTotal) / 60000) : 0;
      let min;
      if (dr.minTyped && dr.min != null) min = dr.min;
      else if (run) {
        // A clock left running for hours is asked about rather than logged.
        if (!force && clockMin > Math.max(120, target * 1.5)) { ui.confirm = 'cardio-long'; ui.cardioLong = { clock: clockMin, target }; render(); return; }
        min = clockMin;
      } else if (el && el.value !== '') min = Number(el.value) || 0;
      else { min = target; toast(`Logged the ${target} min target. Change it in History if you rode more or less.`); } // an empty field means the plan, as it does for sets
      min = Math.min(600, Math.max(0, Math.round(min)));
      const wIn = dr.watts != null ? dr.watts : Number(wEl && wEl.value); const watts = wIn > 0 ? Math.min(2000, Math.round(wIn)) : null;
      s.cardio = { min, watts, kcal: E.cardioKcal(min, watts || state.settings.cardioWatts) };
    }
    s.cardioRun = null; delete s.cardioDraft; clearTimeout(cardioTick); ui.confirm = null; ui.cardioLong = null;
    completeSession();
  }

  // ---------- Completing a session, reviews ----------
  function completeSession() {
    const s = state.current;
    let undoBackfill = null; // a past session moves the plan on and calibrates, so it gets an Undo like a skip
    if (s.backfill) { snapshot(`Logged ${s.dayName} for ${fmtDate(s.date)}`, { removeSessionId: s.id }); undoBackfill = state.undo; }
    // Accessory double progression.
    const reducedDay = s.isDeload || s.isRest || s.isTest || s.mode === 'light';
    for (const e of s.exercises) {
      if (e.lift || s.skippedSlots.includes(e.slotKey)) continue;
      const prevW = state.acc[e.ex] ? state.acc[e.ex].weight : null, prevSuspect = state.acc[e.ex] ? state.acc[e.ex].suspect : null;
      const p = reducedDay ? null : E.accessoryProgress(state, { load: e.load, repRange: e.repRange, prevW, prevSuspect, sets: e.sets.map(x => ({ done: x.done, w: x.actualW != null ? x.actualW : x.w, reps: x.reps, actualReps: x.actualReps, okW: x.okW })) });
      if (p) { state.acc[e.ex] = p.suspect ? { weight: p.weight, updated: s.date, suspect: p.suspect } : { weight: p.weight, updated: s.date }; if (p.suspect) addLog(`${e.name}: ${p.suspect} looks like a typo; next time stays ${p.weight}. Real? Change it in Settings.`); }
      else { const d = e.sets.find(x => x.done && x.actualW > 0); if (d && !state.acc[e.ex]) state.acc[e.ex] = { weight: d.actualW, updated: s.date }; }
    }
    // Calibrate the maxes from what was actually lifted today.
    const predates = (s.ts || 0) <= (state.program.calibBaseTs || 0);
    if (predates) s.calibrated = true;
    const cal = predates ? [`${s.dayName} predates your last max reset, so the maxes stay.`] : calibrateSession(s);
    cal.forEach(addLog);
    delete s.cardioRun; delete s.cardioDraft; delete s.setLightRest;
    s.exercises.forEach(e => { delete e.fold; e.sets.forEach(x => { delete x.doneAt; delete x.timerSrc; }); }); delete s.lastEi;
    s.savedAt = Date.now(); delete s.phase;
    state.current = null; state.undo = undoBackfill; stopTimer();
    state.sessions.push(s); Store.pushSession(s);
    if (s.backfill) { state.sessions.sort((a, b) => (a.ts || 0) - (b.ts || 0)); addLog(`${s.dayName} logged after the fact for ${fmtDate(s.date)}.`); }
    afterSession(s.id);
    if (cal.length) {
      const fresh = state.lastReport && state.lastReport.sessionId === s.id;
      if (fresh) state.lastReport.lines = cal.concat(state.lastReport.lines).slice(0, 30);
      else if (state.lastReport && !/^(Maxes |Session |Back after)/.test(state.lastReport.title)) state.lastReport.lines = cal.concat(state.lastReport.lines).slice(0, 30); // an unread review stays, with today's lines first
      else { const moved = cal.some(l => / -> /.test(l)); state.lastReport = { title: moved ? `Maxes calibrated from ${fmtDate(s.date)}` : `Maxes held after ${fmtDate(s.date)}`, lines: cal.slice(0, 30), sessionId: s.id }; }
    }
    releaseAwake();
    if (state.settings.backupOffer && !Store.db) state.backupOffer = true; // the one-tap offer on Today
    ui.quietUntil = performance.now() + 700; // a second tap on Save must not land on whatever Today shows there
    save(); render(); scrollToY(0);
    setTimeout(() => applyUpdateIfSafe(false), 1500);
  }
  function afterSession(sid) {
    const P = state.program, pos = E.position(state);
    const wasLastDay = P.dayIdx === E.DAYS.length - 1;
    const lines = [];
    let title = null;
    if (wasLastDay) {
      P.lightRestOfWeek = false; P.pushOn = false; P.pendingDeload = false; // a suggestion not taken lapses; this week's review can raise it again
      const willEndMeso = !pos.rest && P.week >= E.totalWeeks(pos.block);
      if (!pos.rest && !pos.isDeload && !pos.isTest) {
        const r = E.weeklyReview(state, sessionsOfWeek(), sessionsOfMeso());
        P.setAdj = r.setAdj; P.loadAdj = r.loadAdj; P.flags = r.flags;
        if (r.volumeDial != null) P.volumeDial = r.volumeDial;
        if (r.tmPct != null && r.tmPct !== state.settings.tmPct) { state.settings.tmPct = r.tmPct; LIFTS.forEach(l => E.applyTM(state, l, state.lifts[l].oneRM)); }
        r.log.forEach(l => { addLog(l); lines.push(l); });
        if (r.suggestDeload) P.pendingDeload = true;
        title = `Week ${P.week} review`;
      }
      if (willEndMeso) {
        const mr = E.mesoReview(state, sessionsOfMeso(), !!pos.block.test);
        for (const l of LIFTS) if (mr.oneRM[l]) { E.applyTM(state, l, mr.oneRM[l]); if (pos.block.test) state.lifts[l].est = mr.oneRM[l]; }
        mr.log.forEach(l => { addLog(l); lines.push(l); });
        title = `${pos.block.name} block complete`;
        P.pendingDeload = false;
      }
    }
    const res = E.advanceDay(state);
    if (res.restDone) { const nb = E.BLOCKS[P.blockIdx]; lines.push(`${pos.inserted ? 'Deload' : 'Easy'} week done. ${nb.name} picks up next session.`); addLog(`${pos.inserted ? 'Deload' : 'Easy'} week complete.`); title = title || 'Light week complete'; }
    if (res.tmUp) { lines.push(`A clean block: the Training Max comes back up to ${Math.round(res.tmUp * 1000) / 10}% of 1RM.`); addLog(`Training Max back up to ${Math.round(res.tmUp * 1000) / 10}%.`); }
    if (res.dialUp) { lines.push(P.volumeDial > 0 ? `Volume dial up to +${P.volumeDial}: a clean block earns one more set per barbell exercise.` : `Volume dial back up to ${P.volumeDial}: a clean block earns a set back per barbell exercise.`); addLog(`Volume dial up to ${P.volumeDial > 0 ? '+' : ''}${P.volumeDial}.`); }
    if (res.stall) { for (const l of res.stall.lines) { lines.push(l); addLog(l); } }
    if (res.setLines) { for (const l of res.setLines) { lines.push(l); addLog(l); } }
    if (res.mesoDone) { const nb = E.BLOCKS[P.blockIdx]; lines.push(P.special ? `Macro complete: ${P.special.weeksLeft > 1 ? `a ${P.special.weeksLeft}-week easy break` : 'an easy week'} first, then ${nb.name} starts again.` : `Next up: ${nb.name} block (${nb.focus.toLowerCase()}), variation set ${P.variantSet || 'A'}.`); }
    if (lines.length) state.lastReport = { title: title || 'Update', lines, sessionId: sid || null };
  }

  // ---------- The change log, as read ----------
  // Same-day entries under one date, oldest first within the day; housekeeping lines and all but
  // the last by-hand dial setting of a day left out; "holding" lines with one reason merged.
  const LOG_NOISE = /^(No sets changed|Set counts and flags from past|This week's review will|It comes before the maxes|It predates the last max reset|Maxes re-read .*: unchanged|Deload and easy-week sessions (do not|leave)|A test (week )?sets the maxes once)/;
  function mergeHolds(lines) { // "Squat: x." and "Bench: x." say the same thing once
    const out = [], seen = {};
    for (const l of lines) {
      const m = /^(Squat|Bench|Deadlift)(: .+)$/.exec(l);
      if (!m) { out.push(l); continue; }
      const at = seen[m[2]];
      if (at != null && !out[at].slice(0, out[at].indexOf(':')).includes(m[1])) out[at] = out[at].replace(':', `, ${m[1]}:`);
      else { seen[m[2]] = out.length; out.push(l); }
    }
    return out;
  }
  function tidyLog(log) {
    const days = [];
    for (const l of log) {
      if (!l || !l.msg || LOG_NOISE.test(l.msg)) continue;
      let g = days[days.length - 1]; if (!g || g.date !== l.date) days.push(g = { date: l.date, lines: [] });
      if (/^Volume dial set to .* by hand\.$/.test(l.msg) && g.lines.some(x => /^Volume dial set to/.test(x))) continue; // the log is newest first: this one was overwritten the same day
      g.lines.push(l.msg);
    }
    days.forEach(g => { g.lines = mergeHolds(g.lines.slice().reverse()); });
    return days;
  }

  // ---------- Program ----------
  function renderProgram() {
    const P = state.program, pos = E.positionLabel(state);
    const macro = E.MACRO.filter(m => !(m.block === 'peak' && state.settings.includePeak === false));
    let cells = '';
    macro.forEach((m, mi) => {
      const b = E.BLOCKS.find(x => x.id === m.block);
      for (let w = 1; w <= E.totalWeeks(b); w++) {
        const isD = w > b.weeks;
        const now = !(pos.isRest && P.special && P.special.macroEnd) && mi === (P.macroPos || 0) && w === P.week; // an inserted easy week marks the week it pauses
        cells += `<div class="w ${isD ? 'deload' : b.id} ${now ? 'now' : ''}" title="${b.name} ${m.variant} week ${w}">${isD ? (b.test ? 'T' : 'D') : b.id[0].toUpperCase() + w}</div>`;
      }
    });
    cells += `<div class="w deload ${pos.isRest && P.special && P.special.macroEnd ? 'now' : ''}" title="Easy week">E</div>`;
    const macroWeeks = macro.reduce((n, m) => n + E.totalWeeks(E.BLOCKS.find(x => x.id === m.block)), 0) + 1;
    const week = [0, 1, 2, 3].map(d => { const saved = P.dayIdx; P.dayIdx = d; const s = E.buildSession(state, 'full'); P.dayIdx = saved; return s; });
    const sets = LIFTS.map(l => { const n = E.weeklySets(state, l), cap = E.capFor(state, l); return `<div class="stack"><div class="row between small"><span>${LIFTNAME[l]} pattern</span><span class="num"><b>${n}</b> / ${cap} sets</span></div><div class="bar"><i style="width:${Math.min(100, n / cap * 100)}%"></i></div></div>`; }).join('');
    const adj = LIFTS.map(l => `<tr><td>${LIFTNAME[l]}</td><td class="num">${state.lifts[l].oneRM}</td><td class="num">${state.lifts[l].tm}</td><td class="num">${P.setAdj[l] > 0 ? '+' : ''}${P.setAdj[l]}</td><td class="num">${P.loadAdj[l] ? (P.loadAdj[l] > 0 ? '+' : '') + Math.round(P.loadAdj[l] * 1000) / 10 + '%' : '—'}</td><td>${P.flags[l] ? '⚑'.repeat(P.flags[l]) : ''}</td></tr>`).join('');
    const slotKeys = Object.keys(E.SWAPS).filter(k => E.SWAPS[k].length > 1);
    const blk = pos.isRest || pos.isDeload ? null : pos.block;
    const vA = (P.variantSet || 'A') === 'A';
    const blockOf = (id) => E.BLOCKS.find(b => b.id === id), pctRange = (rows) => `${Math.round(rows[0].pct * state.settings.tmPct * 100)}-${Math.round(rows[rows.length - 1].pct * state.settings.tmPct * 100)}%`;
    const blockText = {
      build: `Sets of 7-8 at ${pctRange(blockOf('build').primary)} of 1RM (deadlift 5-6 at ${pctRange(blockOf('build').primaryByLift.deadlift)}), about 3% heavier each week, plus a set when you recover well. Variations: ${vA ? 'paused squat, close-grip, RDL' : 'the other bar position, Larsen press, deficit deadlift'}.`,
      strength: `Sets of 5, 4, then 3 at ${pctRange(blockOf('strength').primary)} of 1RM, then a deload. Week 3 opens with a single at about RPE 8. Variations: ${vA ? 'paused squat, long-pause bench, paused deadlift' : 'the other bar position, Spoto press, block pull'}.`,
      peak: `Heavy triples, then doubles, at ${pctRange(blockOf('peak').primary)}. Then a test week: work up to a single at RPE 9, and your new maxes come from it.`,
    };
    const dial = P.volumeDial || 0, pinned = slotKeys.filter(k => P.swaps[k]).length;
    const SLOT = { bench_secondary: 'Second bench', press_secondary: 'Second press', back_vertical: 'Vertical pull', back_horizontal: 'Row', delts: 'Side delts' };
    const slotName = (k) => SLOT[k] || k.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
    const log = tidyLog(state.log);
    let logShown = log, logMore = 0;
    if (!ui.logAll) { let n = 0; logShown = []; for (const g of log) { if (n >= 5 && logShown.length) break; logShown.push(g); n += g.lines.length; } logMore = log.slice(logShown.length).reduce((m, g) => m + g.lines.length, 0); }
    return FOLD_ALL + foldCard('prog-macro', `${macroWeeks}-week macro`, `<div class="timeline" style="grid-template-columns:repeat(${Math.min(12, macroWeeks)},1fr)">${cells}</div>
        <div class="row small muted" style="gap:14px"><span><span class="dot" style="background:var(--good)"></span> Build ×2</span><span><span class="dot" style="background:var(--accent)"></span> Strength ×2</span>${state.settings.includePeak !== false ? '<span><span class="dot" style="background:var(--bad)"></span> Peak + test</span>' : ''}<span>D deload · E easy week</span></div>
        ${blk ? `<p><b>${esc(blk.name)} ${esc(P.variantSet || 'A')}:</b> ${blockText[blk.id]}</p>` : `<p><b>${pos.isDeload ? 'Deload week' : 'Easy week'}:</b> ${pos.isDeload ? `fewer sets at reduced loads; ${pos.inserted ? 'the block then resumes' : 'the next block follows'}.` : 'half the sets at half the loads, on variations.'}</p>`}
        <label class="f dial-row"><span>Volume dial <span class="muted" style="font-weight:500">adds or removes a set on every barbell exercise. It drops with chronic fatigue; a clean Build block earns it back.</span></span><select id="dial" data-action="dial"><option value="-2" ${dial === -2 ? 'selected' : ''}>−2 (two fewer per exercise)</option><option value="-1" ${dial === -1 ? 'selected' : ''}>−1</option><option value="0" ${dial === 0 ? 'selected' : ''}>0 (as written)</option><option value="1" ${dial === 1 ? 'selected' : ''}>+1</option><option value="2" ${dial === 2 ? 'selected' : ''}>+2 (two more per exercise)</option></select></label>`, { sum: `Now: ${esc(pos.label)}${dial ? ` · dial ${dial > 0 ? '+' : ''}${dial}` : ''}` })
      + foldCard('prog-week', "This week's plan", week.map((s, di) => `<details ${di === P.dayIdx ? 'open' : ''}><summary class="row between" style="padding:6px 26px 6px 0;min-height:44px"><b>${esc(s.dayName)}</b><span class="small muted">${s.estMinutes} min</span></summary>
          <div class="tablewrap"><table>${s.exercises.map(e => { const work = e.sets.filter(x => x.kind === 'work' || x.kind === 'backoff'), f = work[0] || e.sets[0], op = e.sets.find(x => x.kind === 'single'), tst = e.sets.some(x => x.kind === 'test'); return `<tr><td>${esc(e.name)}${e.optional ? ' <span class="muted small">(opt.)</span>' : ''}</td><td class="num">${tst ? 'single + ' : op ? `1×1 + ` : ''}${work.length}×${f.reps}${f.plus ? '+' : ''}</td><td class="num">${op ? `${op.w} / ` : ''}${f.w != null ? f.w : (e.load === 'bw' ? 'bw' : '?')}</td><td class="muted small">${e.pctTM != null ? pctLabel(e) : ''}</td></tr>`; }).join('')}</table></div></details>`).join(''), { sum: `${week.length} sessions, about ${Math.max(...week.map(s => s.estMinutes))} min at most` })
      + foldCard('prog-sets', 'Weekly working sets', `${sets}<p class="small muted">Competition lift plus close variations. The cap is the weekly total sets can't pass; sets are added only while you recover.</p>`, { closed: true, sum: LIFTS.map(l => `${LIFTNAME[l]} ${E.weeklySets(state, l)}/${E.capFor(state, l)}`).join(' · ') })
      + foldCard('prog-maxes', 'Maxes and adjustments', `<div class="tablewrap"><table><tr><th>Lift</th><th class="num">1RM</th><th class="num">TM</th><th class="num">Sets</th><th class="num">Load</th><th>Flags</th></tr>${adj}</table></div>
        <p class="small muted">Sets and Load: this week's changes. A flag marks a hard week (missed reps, a crushing session, lasting soreness); two flags each on two lifts suggest a deload.</p>
        ${state.current ? '<p class="small muted">Deload and easy-week changes wait until this session is finished.</p>' : `<div class="btnrow">${pos.isRest || pos.isDeload || pos.isTest ? '' : '<button class="btn" data-action="deload-now-confirm">Deload now</button>'}${pos.isRest || pos.isDeload ? '' : '<button class="btn" data-action="rest-now-confirm">Easy week</button>'}</div>`}
        ${ui.confirm === 'deload' ? `<div class="callout warn">${deloadEffect(true)}<div class="btnrow" style="margin-top:8px"><button class="btn sm primary" data-action="deload-now">Yes</button><button class="btn sm" data-action="confirm-cancel">No</button></div></div>` : ''}
        ${ui.confirm === 'rest' ? `<div class="callout warn">Insert an easy week (half sets, half loads)? Best once or twice a year, or when life gets heavy.<div class="btnrow" style="margin-top:8px"><button class="btn sm primary" data-action="rest-now">Yes</button><button class="btn sm" data-action="confirm-cancel">No</button></div></div>` : ''}
        <label class="f">After this block, run<select id="next-block" data-action="next-block"><option value="">the normal sequence</option>${E.BLOCKS.map((b, i) => `<option value="${i}" ${P.nextBlockOverride === i ? 'selected' : ''}>${b.name}</option>`).join('')}</select></label>`, { sum: LIFTS.map(l => `${LIFTNAME[l]} ${state.lifts[l].oneRM}`).join(' · ') })
      + foldCard('prog-swaps', 'Exercise choices', `<p class="small muted">Variations rotate each block. Pin one if your equipment or joints prefer it; pick (auto) to undo.</p>
        <div class="swap-list">${slotKeys.map(k => { const vset = pos.block && ((P.variantSet === 'B' && pos.block.variationB) || pos.block.variation); const def = (pos.isRest && E.REST.variation[k]) || (vset && vset[k]) || E.SWAPS[k][0]; const defName = E.exerciseName(state, (def === 'high_bar_squat' || def === 'low_bar_squat') ? (state.settings.squatStyle === 'highbar' ? 'low_bar_squat' : 'high_bar_squat') : def); return `<label class="swap-row${P.swaps[k] ? ' pinned' : ''}"><span>${slotName(k)}</span><select id="swap-${k}" data-action="pin-swap" data-k="${k}"><option value="">${esc(defName)} (auto)</option>${E.swapOptions(state, k).map(x => `<option value="${x}" ${P.swaps[k] === x ? 'selected' : ''}>${esc(E.exerciseName(state, x))}</option>`).join('')}</select></label>`; }).join('')}</div>`, { closed: true, sum: pinned ? `${pinned} pinned, the rest automatic` : 'All automatic' })
      + foldCard('prog-why', 'Why things changed', log.length ? `<div class="loglist">${logShown.map(g => `<div class="item"><span class="d">${fmtDate(g.date)}</span><span class="lg">${g.lines.map(m => `<span>${arrows(m)}</span>`).join('')}</span></div>`).join('')}</div>${logMore ? `<button class="btn sm quiet" data-action="log-all">Show ${logMore} older</button>` : ''}` : '<p class="muted small">Nothing yet. Weekly reviews land here.</p>', { sum: log.length ? arrows(log[0].lines[log[0].lines.length - 1]) : 'Nothing yet' });
  }

  // ---------- History ----------
  function renderHistory() {
    const done = state.sessions.filter(s => !s.skipped).slice().reverse();
    const thisWeek = weekStart(Date.now()), WEEK = 7 * 864e5;
    const latest = {};
    const trend = LIFTS.map(l => { const w = weeklyEst(l); const last = w[w.length - 1], prev = w[w.length - 2]; const lastWk = last ? weekStart(last.x) : 0; const label = lastWk === thisWeek ? 'this week' : lastWk === thisWeek - WEEK ? 'last week' : last ? `week of ${fmtDate(tsISO(lastWk))}` : ''; const adjacent = prev && weekStart(prev.x) === lastWk - WEEK; if (last) latest[l] = Math.round(last.y); return `<div class="stack"><div class="row between"><b>${LIFTNAME[l]}</b><span class="small muted num">1RM ${state.lifts[l].oneRM} · TM ${state.lifts[l].tm}${last ? ` · ${label} ~${Math.round(last.y)}${adjacent ? ` (${last.y >= prev.y ? '+' : ''}${Math.round(last.y - prev.y)})` : ''}` : ''}</span></div><canvas id="c-${l}" height="130" style="height:130px" class="tap-chart" data-action="chart-pick" data-lift="${l}" role="img" aria-label="${LIFTNAME[l]} estimated max by week. Tap a dot for that session's details."></canvas>${chartDetail(l)}</div>`; }).join('');
    return FOLD_ALL + foldCard('hist-trend', 'Estimated 1RM, week by week', `${trend}<div class="row small muted" style="gap:14px"><span><span class="dot" style="background:var(--accent)"></span> weekly average</span><span><span class="dot" style="background:var(--muted)"></span> sessions</span><span>dashed: 1RM</span></div><p class="small"><b>Tap a dot</b> for its session: each set, the max it implies, how much it counted.</p><p class="small muted">Bigger dots carry more weight. Sets under RPE 6.5 count lightly here and rarely move your 1RM, so the line can sit apart from it.</p>`, { dom: 'trend-card', sum: LIFTS.filter(l => latest[l]).map(l => `${LIFTNAME[l]} ~${latest[l]}`).join(' · ') || 'No rated heavy sets yet' })
      + foldCard('hist-ready', 'Readiness', '<canvas id="c-ready" height="140" style="height:140px"></canvas>', { sum: (() => { const r = done.find(s => s.readiness); return r ? `Latest ${r.readiness.score}` : 'No check-ins yet'; })() })
      + foldCard('hist-sessions', 'Sessions', `${done.length ? (ui.histAll ? done : done.slice(0, 60)).map((s, i) => `<details class="session-item" style="display:block" data-id="${s.id}" ${ui.histOpen && ui.histOpen[s.id] ? 'open' : ''}><summary class="hist-row"><span class="hist-main"><b>${esc(s.dayName)}</b><span class="muted small">${fmtDate(s.date)} · ${esc(s.blockName || '')} wk ${s.week}${s.mode && s.mode !== 'full' ? ' · ' + E.MODES[s.mode].label : ''}</span></span><span class="hist-ready">${s.readiness ? `<span class="pill ${s.readiness.color}" title="Readiness">${s.readiness.score}</span>` : '<span class="muted small" aria-label="No check-in">–</span>'}</span><span class="hist-diff">${s.post && s.post.difficulty ? `<span class="pill">${DIFF[s.post.difficulty]}</span>` : ''}</span></summary>
          <div class="tablewrap" style="margin-top:8px"><table>${s.exercises.map(e => `<tr><td>${esc(e.name)}</td><td class="small num">${e.sets.filter(x => x.done && x.kind !== 'warm').map(x =>`${x.actualW != null ? x.actualW : (x.w != null ? x.w : 'bw')}×${x.actualReps != null ? x.actualReps : x.reps}${x.rpe != null ? '@' + x.rpe : ''}`).join(', ') || '<span class="muted">skipped</span>'}</td></tr>`).join('')}</table></div>
          <div class="small muted" style="margin-top:6px">${s.durationMin ? s.durationMin + ' min' : ''}${s.cardio && s.cardio.min ? ` · bike ${s.cardio.min} min` : ''}${s.backfill ? ' · logged after the fact' : ''}${s.edited ? ' · edited' : ''}${s.notes ? ' · ' + esc(s.notes) : ''}</div>
          <div class="btnrow" style="margin-top:6px">${ui.confirmDel === s.id ? `<span class="small">Delete this session for good?</span><button class="btn sm danger-fill" data-action="delete-session" data-id="${s.id}" data-sure="1">Yes, delete</button><button class="btn sm" data-action="delete-cancel">Keep</button>` : `<button class="btn sm" data-action="edit-session" data-id="${s.id}">Edit</button><button class="btn sm quiet" data-action="delete-session" data-id="${s.id}" style="color:var(--bad)">Delete</button>`}</div></details>`).join('') : '<p class="empty">No sessions yet. Your first check-in is on Today.</p>'}
        ${done.length > 60 && !ui.histAll ? `<button class="btn sm" data-action="hist-all">Show all ${done.length}</button>` : ''}`, { sum: done.length ? `${done.length} logged, latest ${fmtDate(done[0].date)}` : 'None yet' });
  }
  // ---------- Editing a logged session ----------
  function startEdit(id) {
    if (state.current) { toast('Finish or discard the open session first'); return; }
    const sess = state.sessions.find(x => x.id === id); if (!sess || sess.skipped) return;
    let copy; try { copy = JSON.parse(JSON.stringify(sess)); } catch (e) { return; }
    copy.phase = 'edit'; copy.editOf = sess.id; copy.editDate = sess.date;
    copy.skippedSlots = Array.isArray(copy.skippedSlots) ? copy.skippedSlots : [];
    copy.post = copy.post || { difficulty: 0 }; copy.notes = copy.notes || '';
    state.current = copy; ui.confirm = null; ui.checkin = null; ui.backfill = null; view = 'today'; ui.lastEi = null; ui.openWarm = {}; ui.editSets = {}; ui.lastDeleted = null;
    copy.exercises.forEach(e => { e.fold = 'open'; }); // an edit starts with everything visible
    save(); render(); scrollToY(0);
  }
  function applyEditField(t) {
    const s = state.current; if (!s || s.phase !== 'edit') return;
    const k = t.dataset.edit;
    if (k === 'date') { if (/^\d{4}-\d{2}-\d{2}$/.test(t.value)) s.editDate = t.value; }
    else if (k === 'cardio' || k === 'watts') {
      const c = s.cardio || {};
      let min = c.min || 0, watts = c.watts || null;
      if (k === 'cardio') min = t.value === '' ? 0 : Math.min(600, Math.max(0, Math.round(Number(t.value) || 0)));
      else { const w = Number(t.value); watts = t.value !== '' && w > 0 ? Math.min(2000, Math.round(w)) : null; }
      s.cardio = { min, watts, kcal: min ? E.cardioKcal(min, watts || state.settings.cardioWatts) : 0 };
    }
    clearTimeout(editSaveTimer); editSaveTimer = setTimeout(() => Store.saveLocal(state), 400);
  }
  let editSaveTimer = null;
  function editSig(x) { return JSON.stringify({ d: x.editDate || x.date, sk: x.skippedSlots || [], p: x.post ? x.post.difficulty : 0, c: x.cardio ? [x.cardio.min || 0, x.cardio.watts || null] : [0, null], n: x.notes || '', e: (x.exercises || []).map(e => [e.ex, (e.sets || []).map(y => [y.kind, y.done ? 1 : 0, y.actualW, y.actualReps, y.rpe])]) }); }
  function openSessionsCard() { if (isFolded('hist-sessions')) { folds['hist-sessions'] = false; saveFolds(); } }
  function showSessionInHistory(id) {
    openSessionsCard();
    ui.histOpen = ui.histOpen || {}; ui.histOpen[id] = 1; render();
    const el = document.querySelector(`.session-item[data-id="${id}"]`), sc = scroller();
    scrollToY(el ? sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8 : 0);
  }
  function cancelEdit(force) {
    const s = state.current; if (!s) return;
    const orig = state.sessions.find(x => x.id === s.editOf);
    if (!force && orig && editSig(orig) !== editSig(s)) { ui.confirm = 'cancel-edit'; render(); return; }
    const id = s.editOf; state.current = null; ui.confirm = null; view = 'history'; save(); showSessionInHistory(id);
  }
  function saveEdit() {
    const s = state.current; if (!s || s.phase !== 'edit') return;
    const P = state.program;
    const idx = state.sessions.findIndex(x => x.id === s.editOf); if (idx < 0) { state.current = null; save(); render(); return; }
    const original = state.sessions[idx];
    const dEl = $('#edit-date'); const newDate = dEl && /^\d{4}-\d{2}-\d{2}$/.test(dEl.value) ? dEl.value : (s.editDate || s.date);
    if (newDate > todayISO()) { toast('The date cannot be in the future'); return; }
    const cEl = $('#edit-cardio'); const cm = cEl ? Math.min(600, Math.max(0, Math.round(Number(cEl.value) || 0))) : (s.cardio ? s.cardio.min : 0);
    const wEl = $('#edit-watts'); const wIn = wEl ? Number(wEl.value) : (s.cardio && s.cardio.watts) || 0; const cw = wIn > 0 ? Math.min(2000, Math.round(wIn)) : null;
    const nEl = $('#sess-notes'); if (nEl) s.notes = nEl.value.slice(0, 1000);
    // Every tick in the editor is "as logged": a set left unticked is one that was not done.
    s.exercises.forEach(e => e.sets.forEach(x => { if (x.done && x.actualReps == null) x.actualReps = x.reps; if (x.done && x.actualW == null && x.w != null) x.actualW = x.w; }));
    if (newDate !== s.date) { s.date = newDate; s.ts = backTs(newDate); }
    s.cardio = cm > 0 ? { min: cm, watts: cw, kcal: E.cardioKcal(cm, cw || state.settings.cardioWatts) } : { min: 0 };
    s.exercises.forEach(e => { delete e.fold; e.sets.forEach(x => { delete x.doneAt; delete x.timerSrc; }); }); delete s.lastEi;
    delete s.phase; delete s.editOf; delete s.editDate; delete s.startedAt; delete s.finishedAt; delete s.cardioRun; delete s.setLightRest;
    s.edited = true; s.calibrated = true; s.savedAt = Date.now();
    snapshot(`Edited ${s.dayName} (${fmtDate(s.date)})`, { removeSessionId: s.id, restoreSession: original });
    state.sessions[idx] = s; state.sessions.sort((a, b) => (a.ts || 0) - (b.ts || 0)); Store.pushSession(s);
    state.current = null; view = 'history';
    const lines = [`${s.dayName} (${fmtDate(s.date)}) edited.`];
    const sig = (x) => JSON.stringify({ d: x.date, sk: x.skippedSlots || [], p: x.post ? x.post.difficulty : 0, e: (x.exercises || []).map(e => [e.ex, (e.sets || []).map(y => [y.kind, y.done ? 1 : 0, y.actualW, y.actualReps, y.rpe])]) });
    if (sig(original) !== sig(s)) { // nothing to explain when only the notes or cardio changed
      if (s.isDeload || s.isRest) lines.push('Deload and easy-week sessions leave the maxes alone.');
      else if (s.isTest) lines.push('A test sets the maxes once, at its end, so this edit leaves them alone.');
      else if (!inBlock(s) || (s.ts || 0) <= (P.calibBaseTs || 0)) lines.push('It predates the last max reset, so the maxes stay.');
      else lines.push(...recalibrateBlock(sessionsOfWeek().some(x => x.id === s.id) ? "This week's review will use the fix." : 'Set counts and flags from past reviews stay.'));
      lines.forEach(addLog); state.lastReport = { title: 'Session edited', lines };
    }
    if (sig(original) !== sig(s)) { const acc = reAccessories(s, true, original.date); if (acc.length) { acc.forEach(addLog); state.lastReport.lines = state.lastReport.lines.concat(acc); } }
    save(); showSessionInHistory(s.id); toast('Session updated');
  }
  // An accessory's next weight came from the session that was just edited or deleted, and nothing
  // newer has used the exercise: work it out again from what the log now says.
  function reAccessories(sess, edited, oldDate) {
    const out = [];
    const nextFrom = (x, y) => { // the weight a logged exercise leads to; a deliberate edit gets no typo check
      const reduced = x.isDeload || x.isRest || x.isTest || x.mode === 'light';
      const p = reduced ? null : E.accessoryProgress(state, { load: y.load, repRange: y.repRange, prevW: null, prevSuspect: null, sets: y.sets.map(z => ({ done: z.done, w: z.actualW != null ? z.actualW : z.w, reps: z.reps, actualReps: z.actualReps, okW: z.okW })) });
      if (p) return { weight: p.weight, updated: x.date };
      const d = y.sets.filter(z => z.done && z.actualW > 0).pop();
      return d ? { weight: d.actualW, updated: x.date } : null;
    };
    for (const e of sess.exercises || []) {
      const a = state.acc[e.ex]; if (e.lift || !a || a.updated !== (oldDate || sess.date) || (sess.skippedSlots || []).includes(e.slotKey)) continue;
      const usedIt = (x) => !x.skipped && x.id !== sess.id && (x.exercises || []).some(y => y.ex === e.ex && (y.sets || []).some(z => z.done));
      if (state.sessions.some(x => usedIt(x) && (x.ts || 0) > (sess.ts || 0))) continue;
      const olders = state.sessions.filter(x => usedIt(x) && (x.ts || 0) < (sess.ts || 0));
      const older = olders.filter(x => !(x.isDeload || x.isRest || x.isTest || x.mode === 'light') && !(x.skippedSlots || []).includes(e.slotKey)).pop();
      if (!edited && olders.length && !older) continue; // only reduced work left to go on: keep what is there
      const next = edited ? nextFrom(sess, e) : older ? nextFrom(older, older.exercises.find(y => y.ex === e.ex)) : null;
      if (next) state.acc[e.ex] = next; else if (!edited) delete state.acc[e.ex];
      const now = state.acc[e.ex] ? state.acc[e.ex].weight : null;
      if (now !== a.weight) out.push(now != null ? `${e.name}: next time ${now}.` : `${e.name}: pick a new starting weight next time.`);
    }
    return out;
  }
  // After an edit inside the current block: put the maxes back to where the block started and
  // re-read every session of the block in date order, so the edit lands exactly as if it had been
  // logged that way. Set counts and flags from past weekly reviews are left as they were.
  function recalibrateBlock(note) {
    const P = state.program, out = [];
    if (state.settings.autoCalibrate === false) return ['Auto-calibration is off, so the maxes are unchanged.'];
    const before = {}; LIFTS.forEach(l => { before[l] = state.lifts[l].oneRM; });
    for (const l of LIFTS) { const L = state.lifts[l]; if (!(L.blockStartRM > 0)) return ['No block start on record for the maxes, so they are unchanged.']; }
    for (const l of LIFTS) { const L = state.lifts[l]; E.applyTM(state, l, L.blockStartRM); L.est = L.estAtBlockStart != null ? L.estAtBlockStart : null; L.upKey = null; L.lbHits = 0; L.lbKey = null; L.easyRun = 0; L.easyKey = null; if (L.ratedAtBlockStart != null) L.rated = L.ratedAtBlockStart; }
    P.calibDrops = {}; P.fatigueBase = {};
    const sessions = state.sessions.filter(s => inBlock(s) && !s.skipped && (s.ts || 0) > (P.calibBaseTs || 0)).sort((a, b) => (a.ts || 0) - (b.ts || 0));
    for (const sess of sessions) { calibrateSession(sess); Store.pushSession(sess); }
    const moved = LIFTS.filter(l => state.lifts[l].oneRM !== before[l]);
    out.push(moved.length ? `Maxes re-read from this block's ${sessions.length} session${sessions.length === 1 ? '' : 's'}: ${moved.map(l => `${LIFTNAME[l]} ${before[l]} -> ${state.lifts[l].oneRM}`).join(', ')}.` : `Maxes re-read from this block's ${sessions.length} session${sessions.length === 1 ? '' : 's'}: unchanged.`);
    if (note) out.push(note);
    return out;
  }
  // Calibrates the maxes from one session and keeps, on the session, what that did (History shows it).
  function calibrateSession(sess) {
    const before = {}; LIFTS.forEach(l => { before[l] = state.lifts[l].oneRM; });
    const lines = E.calibrate(state, sess); sess.calibrated = true;
    sess.calib = {}; LIFTS.forEach(l => { sess.calib[l] = [before[l], state.lifts[l].oneRM]; });
    if (lines.length) sess.calibLines = lines.slice(0, 6); else delete sess.calibLines;
    return lines;
  }
  let cssCache = null; // one getComputedStyle per chart draw, not one per colour
  function cssVar(n) { if (!cssCache) cssCache = { cs: getComputedStyle(document.documentElement), v: {} }; if (!(n in cssCache.v)) cssCache.v[n] = cssCache.cs.getPropertyValue(n).trim(); return cssCache.v[n]; }
  function tsISO(ts) { return todayISO(new Date(ts)); }
  // Per-session max estimates (confidence-weighted) and their weekly averages.
  let estCache = null; // { st, key, by: { lift: points } }: one pass per change of the log, not per draw
  function sessionEsts(lift) {
    let mx = 0; for (const s of state.sessions) mx = Math.max(mx, s.savedAt || s.ts || 0);
    const key = `${state.sessions.length}|${mx}|${LIFTS.map(l => state.lifts[l].oneRM).join(',')}`;
    if (!estCache || estCache.st !== state || estCache.key !== key) estCache = { st: state, key, by: {} };
    if (estCache.by[lift]) return estCache.by[lift];
    const out = [];
    // Every rated set shows on the chart (RPE 4 and up, low ratings weighted low); a wide clamp
    // around the current max keeps one mistyped weight from flattening the whole scale.
    const ref = state.lifts[lift].oneRM;
    for (const s of state.sessions) { if (s.skipped || s.isDeload || s.isRest) continue; const r = E.sessionEstimate(s, lift, ref, { minRpe: 4, clamp: [0.5, 1.5] }); if (r) out.push({ x: s.ts, y: r.est, conf: r.conf, id: s.id }); }
    return (estCache.by[lift] = out);
  }
  function weekStart(ts) { const d = new Date(ts); const day = (d.getDay() + 6) % 7; d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - day); return d.getTime(); }
  function weeklyEst(lift) {
    const by = {};
    for (const p of sessionEsts(lift)) { const k = weekStart(p.x); by[k] = by[k] || { n: 0, d: 0, c: 0 }; by[k].n += p.y * p.conf; by[k].d += p.conf; by[k].c++; }
    return Object.keys(by).map(Number).sort((a, b) => a - b).map(k => ({ x: k + 3.5 * 864e5, y: by[k].n / by[k].d, wk: k, count: by[k].c }));
  }
  const chartHits = {}; // lift -> [{ id, px, py }] in CSS pixels of its canvas
  // Only the trend card is rebuilt for a chart tap; the session list and the readiness chart stay.
  function redrawTrend() {
    const card = document.getElementById('trend-card');
    if (!card) { render(); return; }
    const tmp = document.createElement('div'); tmp.innerHTML = renderHistory();
    const fresh = tmp.querySelector('#trend-card'); if (!fresh) { render(); return; }
    card.querySelectorAll('canvas').forEach(c => { c.width = c.height = 0; });
    card.replaceWith(fresh);
    drawCharts(true); // first: the anchor must measure the final layout
    if (anchor) { const el = document.querySelector(anchor.sel); if (el) { const dy = el.getBoundingClientRect().top - anchor.top; if (Math.abs(dy) >= 1) scroller().scrollTop += dy; } anchor = null; }
  }
  function drawCharts(trendOnly) {
    cssCache = null;
    const ready = [];
    for (const s of state.sessions) if (!s.skipped && s.readiness) ready.push({ x: s.ts, y: s.readiness.score, c: s.readiness.color });
    for (const l of LIFTS) {
      const sess = sessionEsts(l), weekly = weeklyEst(l);
      const sel = ui.chartSel && ui.chartSel.lift === l ? sess.find(p => p.id === ui.chartSel.id) || null : null;
      const selWk = sel ? weekly.find(w => w.wk === weekStart(sel.x)) || null : null;
      const m = lineChart($('#c-' + l), [{ pts: sess, color: cssVar('--muted'), dots: true, noline: true, faint: true, sized: true }, { pts: weekly, color: cssVar('--accent'), dots: true }], { hline: state.lifts[l].oneRM, hlineColor: cssVar('--fg'), sel, selWk, selColor: cssVar('--accent') });
      chartHits[l] = m ? sess.map(p => ({ id: p.id, px: m.X(p.x), py: m.Y(p.y) })) : [];
    }
    if (!trendOnly) lineChart($('#c-ready'), [{ pts: ready, color: cssVar('--accent'), dots: true }], { min: 0, max: 100, bands: [[0, E.TUNE.readiness.yellow, cssVar('--bad-soft')], [E.TUNE.readiness.yellow, E.TUNE.readiness.green, cssVar('--warn-soft')], [E.TUNE.readiness.green, 100, cssVar('--good-soft')]] });
  }
  function lineChart(cv, series, opt) {
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 320, H = parseFloat(cv.style.height) || Number(cv.getAttribute('height')); // the height attribute holds H x dpr after a draw
    cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
    const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    const all = series.flatMap(s => s.pts);
    const padL = 40, padR = 10, padT = 10, padB = 22;
    ctx.font = '11px ' + cssVar('--body'); ctx.fillStyle = cssVar('--muted'); ctx.strokeStyle = cssVar('--line');
    if (!all.length) { ctx.fillText(opt.hline ? `No logged sets yet. Current 1RM ${opt.hline}.` : 'No data yet', padL, H / 2); return null; }
    let xs = all.map(p => p.x), ys = all.map(p => p.y).concat(opt.hline ? [opt.hline] : []);
    let x0 = Math.min(...xs), x1 = Math.max(...xs); if (x1 === x0) { x0 -= 864e5 * 3; x1 += 864e5 * 3; }
    let y0 = opt.min != null ? opt.min : Math.min(...ys), y1 = opt.max != null ? opt.max : Math.max(...ys);
    if (opt.min == null) { const r = Math.max(10, (y1 - y0) * 0.15); y0 = Math.floor((y0 - r) / 10) * 10; y1 = Math.ceil((y1 + r) / 10) * 10; }
    const X = x => padL + (x - x0) / (x1 - x0) * (W - padL - padR), Y = y => padT + (1 - (y - y0) / (y1 - y0)) * (H - padT - padB);
    if (opt.bands) for (const [a, b, c] of opt.bands) { ctx.fillStyle = c; ctx.fillRect(padL, Y(b), W - padL - padR, Y(a) - Y(b)); }
    ctx.fillStyle = cssVar('--muted');
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) { const y = y0 + (y1 - y0) * i / ticks; ctx.beginPath(); ctx.moveTo(padL, Y(y)); ctx.lineTo(W - padR, Y(y)); ctx.stroke(); ctx.fillText(Math.round(y), 4, Y(y) + 4); }
    const d0 = new Date(x0), d1 = new Date(x1); ctx.fillText(d0.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), padL, H - 6); const t = d1.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); ctx.fillText(t, W - padR - ctx.measureText(t).width, H - 6);
    if (opt.hline != null) { ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = opt.hlineColor || cssVar('--fg'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(padL, Y(opt.hline)); ctx.lineTo(W - padR, Y(opt.hline)); ctx.stroke(); ctx.restore(); }
    for (const s of series) {
      if (!s.pts.length) continue;
      ctx.globalAlpha = s.faint ? 0.45 : 1;
      if (!s.noline) { ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.beginPath(); s.pts.forEach((p, i) => i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))); ctx.stroke(); }
      ctx.fillStyle = s.color;
      // A session dot grows with the weight of its evidence (more and harder sets read bigger).
      s.pts.forEach((p, i) => { if (s.dots || i === s.pts.length - 1) { ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), s.sized ? 2.5 + Math.min(2.5, (p.conf || 0) * 0.6) : s.faint ? 2.5 : 3.5, 0, Math.PI * 2); ctx.fill(); } });
      if (!s.faint && !opt.sel) { const last = s.pts[s.pts.length - 1]; ctx.fillText(Math.round(last.y), Math.min(W - padR - 28, X(last.x) + 6), Y(last.y) - 6); }
      ctx.globalAlpha = 1;
    }
    if (opt.sel) {
      const sx = X(opt.sel.x), sy = Y(opt.sel.y), c = opt.selColor || cssVar('--accent');
      ctx.save(); ctx.strokeStyle = c; ctx.globalAlpha = 0.55; ctx.setLineDash([2, 3]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(sx, padT); ctx.lineTo(sx, H - padB); ctx.stroke(); ctx.restore();
      if (opt.selWk) { ctx.save(); ctx.strokeStyle = c; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X(opt.selWk.x), Y(opt.selWk.y), 6, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
      ctx.save(); ctx.lineWidth = 2; ctx.strokeStyle = c; ctx.fillStyle = cssVar('--surface'); ctx.beginPath(); ctx.arc(sx, sy, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(sx, sy, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.font = '600 12px ' + cssVar('--body'); const txt = '~' + Math.round(opt.sel.y), tw = ctx.measureText(txt).width;
      const tx = Math.min(W - padR - tw, Math.max(padL + 2, sx - tw / 2)), ty = sy - 12 < padT + 10 ? sy + 20 : sy - 12;
      ctx.globalAlpha = 0.92; ctx.fillStyle = cssVar('--surface'); ctx.fillRect(tx - 4, ty - 12, tw + 8, 16); ctx.globalAlpha = 1; // a plate behind the value keeps it legible over dots and lines
      ctx.fillStyle = cssVar('--fg'); ctx.fillText(txt, tx, ty); ctx.restore();
    }
    return { X, Y };
  }
  // The card under a chart for the session picked on it: the sets behind the dot, what each one
  // implied and how much it counted, that week's average, and what the calibration did with it.
  function chartDetail(lift) {
    const sel = ui.chartSel; if (!sel || sel.lift !== lift) return '';
    const pts = sessionEsts(lift), i = pts.findIndex(p => p.id === sel.id);
    const s = i >= 0 ? state.sessions.find(x => x.id === sel.id) : null; if (!s) return '';
    const r = E.sessionEstimate(s, lift, state.lifts[lift].oneRM, { minRpe: 4, clamp: [0.5, 1.5], detail: true }); if (!r) return '';
    const est = Math.round(r.est), counted = r.sets.filter(x => !x.skip), notCounted = r.sets.filter(x => x.skip);
    const read = r.confHigh >= 2 ? 'Strong read' : r.conf >= 1.2 ? 'Fair read' : 'Light read';
    const readWhy = r.confHigh >= 2 ? 'hard sets with a clear RPE' : r.conf >= 1.2 ? 'moderate sets' : 'easy or few sets, so it counts lightly';
    const cb = s.calib && s.calib[lift], refThen = cb ? cb[0] : state.lifts[lift].oneRM, diff = est - refThen;
    const vs = diff === 0 ? `right at the 1RM of ${refThen}` : `${Math.abs(diff)} ${diff > 0 ? 'over' : 'under'} the 1RM of ${refThen}`;
    // Sets grouped by exercise, in the order they were lifted.
    const groups = []; for (const x of counted) { let g = groups[groups.length - 1]; if (!g || g.name !== x.name) groups.push(g = { name: x.name, sets: [] }); g.sets.push(x); }
    const setRow = x => {
      const why = []; if (!x.comp) why.push('variation'); if (x.first) why.push('first set'); if (x.rpe < 7) why.push('easy'); if (x.missed) why.push('missed reps, read as RPE 10'); if (x.capped) why.push('capped as an outlier');
      const pct = Math.round(x.wt * 100), tag = x.kind === 'single' ? ' single' : x.kind === 'test' ? ' test' : '';
      return `<div class="pt-set"><span class="num">${x.w} × ${x.reps} @ ${x.rpe}${tag ? `<span class="muted small">${tag}</span>` : ''}</span><span class="num pt-imp">${Math.round(x.implied)}</span><span class="small muted pt-why">${pct === 100 ? 'counts fully' : `counts ${pct}%`}${why.length ? ' · ' + why.join(', ') : ''}</span></div>`;
    };
    const skipBy = {}; notCounted.forEach(x => { skipBy[x.skip] = (skipBy[x.skip] || 0) + 1; });
    const skipText = Object.keys(skipBy).map(k => `${skipBy[k]} ${skipBy[k] === 1 ? 'set' : 'sets'} ${k === 'no RPE' ? 'without an RPE' : k === 'too easy' ? 'under RPE 4' : k === 'too many reps' ? 'over 20 reps' : k === 'reps far over plan' ? 'far over the planned reps' : k === 'looks like a typo' ? 'far from the planned weight (likely typos)' : 'without a weight'}`).join(', ');
    const weekly = weeklyEst(lift), wk = weekStart(s.ts), wi = weekly.findIndex(w => w.wk === wk), w = weekly[wi], pw = wi > 0 ? weekly[wi - 1] : null;
    const adj = w && pw && pw.wk === wk - 7 * 864e5, wd = adj ? Math.round(w.y - pw.y) : 0;
    const weekLine = w ? `Week of ${fmtDate(tsISO(wk))}: average ~${Math.round(w.y)} from ${w.count} session${w.count === 1 ? '' : 's'}${adj ? ` (${wd >= 0 ? '+' : ''}${wd} vs the week before)` : ''}.` : '';
    const calLine = (s.calibLines || []).find(x => x.startsWith(LIFTNAME[lift]));
    const calText = s.isTest ? 'Test day: the max is set from the test at the end of the week.'
      : cb ? (cb[0] !== cb[1] ? `1RM ${cb[0]} → ${cb[1]} after this session.` : `1RM held at ${cb[0]} after this session.`) + (calLine && cb[0] === cb[1] ? ` ${calLine.replace(/^[A-Za-z]+:\s*/, '').replace(/^./, c => c.toUpperCase())}` : '')
      : '';
    const pill = s.readiness ? `<span class="pill ${s.readiness.color}" title="Readiness">${s.readiness.score}</span>` : '';
    return `<div class="pt-card" role="region" aria-label="${LIFTNAME[lift]} session details">
      <div class="pt-head"><div class="pt-title"><b>${esc(s.dayName)}</b><span class="small muted">${fmtDateLong(s.date)} · ${esc(s.blockName || '')} wk ${s.week}${s.mode && s.mode !== 'full' ? ' · ' + E.MODES[s.mode].label : ''}</span></div>${pill}<button class="btn icon sm quiet" data-action="chart-close" data-lift="${lift}" aria-label="Close details"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class="pt-big"><span class="pt-num num">~${est}</span><span class="small muted">estimated ${LIFTNAME[lift].toLowerCase()} max from this session, ${vs}</span></div>
      <div class="small"><b>${read}</b> <span class="muted">(${readWhy}): ${counted.length} rated set${counted.length === 1 ? '' : 's'}${s.post && s.post.difficulty ? `, felt ${FELT[s.post.difficulty]}` : ''}.</span></div>
      ${groups.map(g => `<div class="pt-ex"><div class="tiny">${esc(g.name)}</div>${g.sets.map(setRow).join('')}</div>`).join('')}
      ${skipText ? `<p class="small muted">Not counted: ${skipText}.</p>` : ''}
      ${weekLine ? `<p class="small muted">${weekLine}</p>` : ''}${calText ? `<p class="small">${esc(calText)}</p>` : ''}
      <div class="btnrow pt-nav"><button class="btn sm" data-action="chart-step" data-lift="${lift}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Earlier session">‹ Earlier</button><span class="small muted num">${i + 1} of ${pts.length}</span><button class="btn sm" data-action="chart-step" data-lift="${lift}" data-dir="1" ${i === pts.length - 1 ? 'disabled' : ''} aria-label="Later session">Later ›</button><button class="btn sm quiet" data-action="chart-open" data-id="${s.id}">Full session</button></div>
    </div>`;
  }

  // ---------- Settings ----------
  function renderSettings() {
    const s = state.settings;
    const lastBak = state.lastBackupAt ? new Date(state.lastBackupAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '', since = sessionsSinceBackup();
    return FOLD_ALL + foldCard('set-maxes', 'Maxes', `<div class="grid3">${LIFTS.map(l => `<label class="f">${LIFTNAME[l]} 1RM<input id="set-1rm-${l}" type="number" inputmode="decimal" data-setting="1rm:${l}" value="${ui.pendingMax && ui.pendingMax.l === l ? ui.pendingMax.v : state.lifts[l].oneRM}"></label>`).join('')}</div>
        ${ui.pendingMax ? `<div class="callout warn">${LIFTNAME[ui.pendingMax.l]} 1RM ${state.lifts[ui.pendingMax.l].oneRM} → ${ui.pendingMax.v}? A ${Math.round(Math.abs(ui.pendingMax.v / state.lifts[ui.pendingMax.l].oneRM - 1) * 100)}% change; calibration restarts from it.<div class="btnrow" style="margin-top:8px"><button class="btn sm primary" data-action="max-apply">Set ${ui.pendingMax.v}</button><button class="btn sm" data-action="max-cancel">Keep ${state.lifts[ui.pendingMax.l].oneRM}</button></div></div>` : ''}
        <div class="grid2">
        <label class="f">Your squat<select id="set-sq" data-setting="squatStyle"><option value="lowbar" ${s.squatStyle !== 'highbar' ? 'selected' : ''}>Low-bar</option><option value="highbar" ${s.squatStyle === 'highbar' ? 'selected' : ''}>High-bar</option></select></label>
        <label class="f">Your deadlift<select id="set-dl" data-setting="deadliftStyle"><option value="conventional" ${s.deadliftStyle !== 'sumo' ? 'selected' : ''}>Conventional</option><option value="sumo" ${s.deadliftStyle === 'sumo' ? 'selected' : ''}>Sumo</option></select></label>
        </div>
        <label class="f">Training Max %<select id="set-tm" data-setting="tmPct"><option value="0.85" ${s.tmPct == 0.85 ? 'selected' : ''}>85%</option><option value="0.875" ${s.tmPct == 0.875 ? 'selected' : ''}>87.5%</option><option value="0.9" ${s.tmPct == 0.9 ? 'selected' : ''}>90%</option><option value="0.925" ${s.tmPct == 0.925 ? 'selected' : ''}>92.5%</option></select></label>
        <p class="small muted" id="tm-line">${esc(tmLine())}</p>
        <label class="row" style="gap:10px;font-weight:600"><input type="checkbox" id="set-cal" data-setting="autoCalibrate" ${s.autoCalibrate !== false ? 'checked' : ''} style="width:22px;height:22px"> Calibrate maxes from my sets <span class="muted small" style="font-weight:500">(down at once, up slowly)</span></label>`, { sum: LIFTS.map(l => `${LIFTNAME[l]} ${state.lifts[l].oneRM}`).join(' · ') })
      + foldCard('set-equip', 'Equipment', `<div class="grid2"><label class="f">Bar weight<input id="set-bar" type="number" inputmode="decimal" data-setting="barWeight" value="${s.barWeight}"></label><label class="f">Dumbbell step<select id="set-dbi" data-setting="dbIncrement"><option value="2.5" ${s.dbIncrement == 2.5 ? 'selected' : ''}>2.5</option><option value="5" ${s.dbIncrement == 5 ? 'selected' : ''}>5</option></select></label></div>
        <div class="stack"><span class="tiny">Plates per side</span><div class="chips">${[55, 45, 35, 25, 15, 10, 5, 2.5, 1.25].map(p => `<button data-action="set-plate" data-p="${p}" aria-pressed="${s.plates.includes(p)}">${p}</button>`).join('')}</div></div>
        <div class="stack"><span class="tiny">Accessory working weights</span><div class="tablewrap"><table>${Object.keys(state.acc).length ? Object.keys(state.acc).map(k => `<tr><td>${esc(E.EX[k] ? E.EX[k].name : k)}</td><td class="num"><span class="acc-in"><input id="acc-${k}" type="number" inputmode="decimal" data-setting="acc:${k}" value="${state.acc[k].weight}" aria-label="${esc(E.EX[k] ? E.EX[k].name : k)} working weight"><span class="small muted">${E.EX[k] && E.EX[k].load === 'db' ? 'lb each' : 'lb'}</span></span></td></tr>`).join('') : '<tr><td class="muted small">These appear once you enter them in a session.</td></tr>'}</table></div></div>`, { closed: true, sum: `${s.barWeight} lb bar · ${s.plates.length} plate sizes` })
      + foldCard('set-sched', 'Schedule and cardio', `<div class="stack"><span class="tiny">Training days</span><span class="small muted">These days are only a note: the four sessions run in order, whenever you train.</span><div class="chips">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => `<button data-action="set-day" data-d="${x}" aria-pressed="${s.days.includes(x)}">${x}</button>`).join('')}</div></div>
        <div class="grid2"><label class="f">Bike after lifting (min)<input id="set-cm" type="number" inputmode="numeric" data-setting="cardioMin" value="${s.cardioMin}"></label><label class="f">Usual easy watts<input id="set-cw" type="number" inputmode="numeric" data-setting="cardioWatts" value="${s.cardioWatts}"></label></div>
        <div class="grid3"><label class="f">Main rest (sec)<input id="set-r1" type="number" inputmode="numeric" data-setting="restPrimary" value="${s.restPrimary}"></label><label class="f">Second rest (sec)<input id="set-r2" type="number" inputmode="numeric" data-setting="restSecondary" value="${s.restSecondary}"></label><label class="f">Accessory rest (sec)<input id="set-r3" type="number" inputmode="numeric" data-setting="restAccessory" value="${s.restAccessory}"></label></div>
        <label class="row" style="gap:10px;font-weight:600"><input type="checkbox" id="set-peak" data-setting="includePeak" ${s.includePeak === true ? 'checked' : ''} style="width:22px;height:22px"> Include the Peak &amp; Test block</label>
        <label class="row" style="gap:10px;font-weight:600"><input type="checkbox" id="set-warm" data-setting="warmupSets" ${s.warmupSets !== false ? 'checked' : ''} style="width:22px;height:22px"> Show warm-up sets</label>
        <label class="row" style="gap:10px;font-weight:600"><input type="checkbox" id="set-notify" data-setting="notify" ${s.notify ? 'checked' : ''} style="width:22px;height:22px"> Notify me when a rest ends <span class="muted small" style="font-weight:500">(only while Readyset is open or just after you switch away; iPhone pauses web apps)</span></label>`, { closed: true, sum: `Bike ${s.cardioMin} min · rests ${s.restPrimary}/${s.restSecondary}/${s.restAccessory} s` })
      + foldCard('set-extra', 'Extra cardio', `<label class="f">Easy cardio today (min, off-day bike or walk)<div class="row"><input id="extra-cardio" type="number" inputmode="numeric" placeholder="30" style="flex:1"><button class="btn sm" data-action="extra-cardio">Log</button></div></label>
        ${extraThisWeek().length ? `<div class="stack">${extraThisWeek().map(({ c, i }) => `<div class="row between small"><span>${fmtDate(c.date)} · ${c.min} min · ~${c.kcal} kcal</span><button class="btn sm quiet" data-action="extra-del" data-i="${i}" aria-label="Remove ${c.min} minutes on ${fmtDate(c.date)}">Remove</button></div>`).join('')}</div>` : ''}`, { closed: true, sum: extraThisWeek().length ? `${extraThisWeek().reduce((m, x) => m + x.c.min, 0)} min this week` : 'None this week' })
      + foldCard('set-data', 'Data and backups', `${Store.db ? '<p class="small muted">Synced to your Claude account.</p>' : `
        <div class="callout bad">Deleting the home-screen icon deletes this data. Never delete or re-add it without a backup.</div>
        <p class="small">A backup is your whole log in one dated file (${backupSizeText()}). Save it to Files or iCloud Drive; only the newest matters.</p>
        <label class="row" style="gap:10px;font-weight:600"><input type="checkbox" data-setting="backupOffer" ${s.backupOffer ? 'checked' : ''} style="width:22px;height:22px"> Offer a one-tap backup after each session</label>`}
        <div class="btnrow">${Store.db ? '' : '<button class="btn" data-action="share-backup">Save backup file</button>'}<button class="btn" data-action="export">Copy backup</button></div>
        ${Store.lastError ? `<div class="callout bad">${esc(Store.lastError)}</div>` : ''}
        <p class="small muted">${lastBak ? `Last backup ${lastBak} (${state.lastBackupKind === 'restore' ? 'restored from a backup' : state.lastBackupKind})` : 'No backup yet'}${since ? ` · ${since} session${since > 1 ? 's' : ''} since` : ''}.</p>
        <button class="btn block" data-action="import-toggle">Restore from a backup file or text</button>
        ${ui.showImport ? `${filePick('Choose a backup file', 'primary block')}<label class="f">Or paste the backup text<textarea id="import-text" rows="4"></textarea></label><button class="btn" data-action="import">Restore from text</button>` : ''}
        ${asideData() ? `<div class="callout">A copy set aside after an error is using ${Math.max(1, Math.round(asideData().length / 1024))} KB.<div class="btnrow" style="margin-top:8px"><button class="btn sm" data-action="aside-copy">Copy it</button>${ui.confirm === 'aside' ? '<button class="btn sm danger" data-action="aside-del">Delete for good</button><button class="btn sm" data-action="confirm-cancel">Keep</button>' : '<button class="btn sm quiet" data-action="aside-del-confirm">Delete</button>'}</div></div>` : ''}
        <button class="btn danger block" data-action="reset-confirm">Start over</button>
        ${ui.confirm === 'reset' ? `<div class="callout bad">This erases the program and every session, for good. Copy a backup first if anything is worth keeping. <div class="btnrow" style="margin-top:8px"><button class="btn sm danger" data-action="reset">Erase everything</button><button class="btn sm" data-action="confirm-cancel">Cancel</button></div></div>` : ''}`, { closed: true, sum: lastBak ? `Last backup ${lastBak}${since ? `, ${since} since` : ''}` : 'No backup yet' })
      + `<p class="small muted" style="text-align:center">Readyset${BUILD ? ` · build ${esc(BUILD.slice(0, 7))}` : ''} · principles from Israetel, Hoffmann &amp; Smith, Scientific Principles of Strength Training (2020). Not medical advice.${BUILD ? ` <button class="btn sm quiet" data-action="check-update">Check for updates</button>` : ''}${returnsLine()}</p>`;
  }
  function tmLine() {
    return `Training maxes: squat ${state.lifts.squat.tm}, bench ${state.lifts.bench.tm}, deadlift ${state.lifts.deadlift.tm}. Barbell loads run off these.${LIFTS.some(l => state.lifts[l].est) ? ` Recent estimates: ${LIFTS.filter(l => state.lifts[l].est).map(l => `${LIFTNAME[l].toLowerCase()} ~${Math.round(state.lifts[l].est)}`).join(', ')}.` : ''}`;
  }
  // Numeric settings: an empty field keeps the old value; everything is clamped to a sane range.
  const SETTING_RANGES = { barWeight: [5, 100], cardioMin: [0, 240], cardioWatts: [30, 600], restPrimary: [30, 600], restSecondary: [30, 600], restAccessory: [15, 600] };
  // From now on the maxes as they stand are the base a block replay starts from (see recalibrateBlock).
  function markCalibBase() {
    state.program.calibBaseTs = state.current && state.current.phase !== 'edit' ? Math.min(Date.now(), (state.current.ts || Date.now()) - 1) : Date.now();
    state.program.fatigueBase = {};
    for (const l of LIFTS) { const L = state.lifts[l]; L.blockStartRM = L.oneRM; L.floorRM = L.oneRM; L.estAtBlockStart = L.est == null ? null : L.est; L.ratedAtBlockStart = L.rated || 0; }
  }
  function applySetting(key, val) {
    const s = state.settings;
    const n = val === '' || val == null ? NaN : Number(val);
    if (key.startsWith('1rm:')) {
      const l = key.split(':')[1]; if (!LIFTS.includes(l)) return;
      const old = state.lifts[l].oneRM, bar = s.barWeight;
      if (!(n >= bar && n <= 2000)) { ui.pendingMax = null; toast(`A 1RM between ${bar} and 2000 lb`); return 'reset'; }
      const v = Math.round(n * 2) / 2;
      if (v === old) { ui.pendingMax = null; return; }
      if (old > 0 && Math.abs(v / old - 1) > 0.15 && !(ui.pendingMax && ui.pendingMax.ok)) { ui.pendingMax = { l, v }; return 'confirm'; } // a dropped or doubled digit is asked about first
      ui.pendingMax = null; state.undo = null; // the Undo snapshot holds the maxes: it cannot outlive a hand-set one
      E.applyTM(state, l, v); state.lifts[l].est = null; markCalibBase(); addLog(`${LIFTNAME[l]} 1RM set to ${v} by hand.`); rebaseSession();
    }
    else if (key === 'tmPct') { if ([0.85, 0.875, 0.9, 0.925].includes(n)) { state.undo = null; s.tmPct = n; s.tmPctChosen = n; LIFTS.forEach(l => E.applyTM(state, l, state.lifts[l].oneRM)); addLog(`Training Max set to ${Math.round(n * 1000) / 10}% by hand.`); rebaseSession(); } }
    else if (key === 'autoCalibrate') { s.autoCalibrate = !!val; if (val) { state.undo = null; markCalibBase(); } }
    else if (key.startsWith('acc:')) { const k = key.split(':')[1]; if (Object.prototype.hasOwnProperty.call(E.EX, k) && n >= 0 && n <= 2000) state.acc[k] = { weight: n, updated: null }; }
    else if (key === 'includePeak') s.includePeak = !!val;
    else if (key === 'warmupSets') s.warmupSets = !!val;
    else if (key === 'notify') { if (val) enableNotify(); else { s.notify = false; postSw({ type: 'rest-cancel' }); } }
    else if (key === 'backupOffer') { s.backupOffer = !!val; if (!val) state.backupOffer = false; }
    else if (key === 'squatStyle') { if (['lowbar', 'highbar'].includes(val)) { s.squatStyle = val; if (state.current) toast('Applies from the next session'); } }
    else if (key === 'deadliftStyle') { if (['conventional', 'sumo'].includes(val)) { s.deadliftStyle = val; if (state.current) toast('Applies from the next session'); } }
    else if (key === 'dbIncrement') { if ([2.5, 5].includes(n)) s.dbIncrement = n; }
    else if (SETTING_RANGES[key]) {
      const [lo, hi] = SETTING_RANGES[key];
      if (!Number.isFinite(n)) return 'reset';
      const v = key === 'barWeight' ? Math.round(Math.min(hi, Math.max(lo, n)) * 2) / 2 : Math.min(hi, Math.max(lo, Math.round(n)));
      if (v !== n) toast(`Kept to ${v} (allowed ${lo}–${hi})`);
      s[key] = v;
      const cur = state.current;
      if (cur && /^rest/.test(key)) { // the open session uses the new rests from its next set
        const heavy = E.BLOCKS[cur.blockIdx] && E.BLOCKS[cur.blockIdx].id !== 'build' && !cur.isRest;
        cur.exercises.forEach(e => { e.rest = e.role === 'primary' ? s.restPrimary + (heavy ? 60 : 0) : e.role === 'secondary' ? s.restSecondary : s.restAccessory; });
      }
      if (cur && key === 'cardioMin' && cur.phase !== 'edit') cur.cardioMin = cur.mode === 'light' ? Math.round(v * 0.5) : v;
      if (key === 'barWeight') { LIFTS.forEach(l => E.applyTM(state, l, state.lifts[l].oneRM)); rebaseSession(); }
      save(); return v !== n ? 'reset' : undefined;
    }
    save();
  }

  // ---------- Events ----------
  let lastTap = { t: -1e9, x: 0, y: 0, a: '' };
  const REPEATABLE = new Set(['timer-add', 'chart-step', 'chart-pick']); // tapping these twice on purpose is normal
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-action],[data-view]');
    if (!t || !booted) return;
    if (ev.isTrusted && state && state.current) unlockAudio();
    if (t.dataset.view) {
      // Leaving a session for another tab and coming back returns you to the same spot.
      if (view === 'today' && state.current) ui.todayScroll = scroller().scrollTop;
      if (view === 'history' && t.dataset.view !== 'history') ui.histAll = false;
      if (ui.pendingMax) toast(`${LIFTNAME[ui.pendingMax.l]} 1RM not changed (it needed a confirm)`);
      view = t.dataset.view; ui.confirm = null; ui.pendingRestore = null; ui.backfill = null; ui.confirmDel = null; ui.showImport = false; ui.setupRestore = false; ui.pendingMax = null; render();
      scrollToY(view === 'today' && state.current ? (ui.todayScroll || 0) : 0); return;
    }
    const a = t.dataset.action, d = t.dataset;
    if (t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
    if (ev.isTrusted && performance.now() < (ui.quietUntil || 0)) return; // the screen just changed under the finger
    if (ev.isTrusted && t.tagName !== 'INPUT') {
      const now = ev.timeStamp || performance.now(), near = Math.abs(ev.clientX - lastTap.x) < 32 && Math.abs(ev.clientY - lastTap.y) < 32;
      if (now - lastTap.t < 380 && near && !(a === lastTap.a && REPEATABLE.has(a))) return;
      lastTap = { t: now, x: ev.clientX, y: ev.clientY, a };
    }
    anchor = anchorFor(t, a); Promise.resolve().then(() => { anchor = null; });
    if (a === 'done' || a === 'rpe') { ui.lastEi = Number(d.ei); if (state.current) state.current.lastEi = ui.lastEi; }
    switch (a) {
      case 'ex-fold': { const e = state.current && state.current.exercises[Number(d.ei)]; if (e) { e.fold = d.v === 'closed' ? 'closed' : 'open'; if (e.fold === 'closed' && ui.editSets) delete ui.editSets[Number(d.ei)]; save(); render(); } break; }
      case 'fold-all': { const s = state.current; if (s) { s.exercises.forEach(e => { e.fold = d.v === 'closed' ? 'closed' : 'open'; }); if (d.v === 'closed') ui.editSets = {}; save(); render(); } break; }
      case 'edit-sets': { ui.editSets = ui.editSets || {}; const i = Number(d.ei); if (ui.editSets[i]) delete ui.editSets[i]; else { applyPendingType(); ui.editSets[i] = true; } render(); break; }
      case 'del-set': deleteSet(Number(d.ei), Number(d.si)); break;
      case 'undo-del': undoDeleteSet(Number(d.ei)); break;
      case 'warm-open': ui.openWarm = ui.openWarm || {}; ui.openWarm[Number(d.ei)] = true; render(); break;
      case 'setup-next': if (ui.setupStep === 1) { const bad = LIFTS.filter(l => !(Number(draft()[l]) > 0)); if (bad.length) { toast(`Enter a ${LIFTNAME[bad[0]]} max`); return; } } ui.setupStep++; render(); scrollToY(0); break;
      case 'setup-back': ui.setupStep = Math.max(0, ui.setupStep - 1); render(); break;
      case 'setup-calc': { const dr = draft(); dr.calc[d.lift] = dr.calc[d.lift] ? null : {}; render(); break; }
      case 'setup-apply-calc': { const dr = draft(), c = dr.calc[d.lift] || {}; const w = Number(c.w), r = Number(c.r), e = Number(c.e) || 8; if (w > 0 && r > 0) { dr[d.lift] = Math.round(E.e1rm(w, r, e) / 2.5) * 2.5; dr.calc[d.lift] = null; render(); } else toast('Enter weight and reps'); break; }
      case 'setup-plate': { const dr = draft(), p = Number(d.p); dr.plates = dr.plates.includes(p) ? dr.plates.filter(x => x !== p) : dr.plates.concat(p); render(); break; }
      case 'setup-day': { const dr = draft(); dr.days = dr.days.includes(d.d) ? dr.days.filter(x => x !== d.d) : dr.days.concat(d.d); render(); break; }
      case 'setup-finish': finishSetup(); break;
      case 'checkin': startCheckin(); break;
      case 'ci': { const c = ui.checkin; if (d.k.startsWith('g:')) c.groups[d.k.slice(2)] = Number(d.v); else c[d.k] = Number(d.v); render(); break; }
      case 'ci-submit': submitCheckin(); break;
      case 'ci-cancel': ui.checkin = null; render(); scrollToY(0); break;
      case 'ci-back': ui.checkin.result = null; render(); break;
      case 'ci-choice': ui.checkin.choice = d.v; render(); break;
      case 'ci-rest': restToday(); break;
      case 'start-session': startSession(d.mode); break;
      case 'skip-session': if (window.__skipArmed) { window.__skipArmed = false; skipSession(); } else { window.__skipArmed = true; toast('Tap again to skip this session'); setTimeout(() => { window.__skipArmed = false; }, 3000); } break;
      case 'done': toggleDone(Number(d.ei), Number(d.si)); break;
      case 'rpe': openRpe(Number(d.ei), Number(d.si)); break;
      case 'rpe-pick': {
        const sh = ui.sheet, e = sh && state.current && state.current.exercises[sh.ei], x = e && e.sets[sh.si];
        ui.sheet = null; renderSheet();
        if (!x) { render(); break; }
        if (d.v === 'skip') break; // the set is already logged; it just has no rating
        const v = d.v === '' ? null : Number(d.v);
        if (!x.done && v != null && !markDone(sh.ei, sh.si)) { if (ui.sheet && ui.sheet.kind === 'check') ui.sheet.rpe = v; break; } // rating an unticked set logs it; a weight check may come first and keeps the rating
        x.rpe = v; ui.lastEi = sh.ei; state.current.lastEi = sh.ei;
        recalcExercise(sh.ei); afterSetChange(); save(); render(); break;
      }
      case 'check-use': case 'check-keep': case 'check-fix': {
        const sh = ui.sheet; ui.sheet = null; renderSheet();
        const e = sh && state.current && state.current.exercises[sh.ei], x = e && e.sets[sh.si]; if (!x || !sh.odd) break;
        const o = sh.odd;
        if (a === 'check-fix') { render(); const inp = $(`#${o.field === 'w' ? 'w' : 'r'}-${sh.ei}-${sh.si}`); if (inp) { inp.focus(); inp.select && inp.select(); } break; }
        const val = a === 'check-use' ? o.use : o.v;
        if (o.field === 'w') { if (a === 'check-keep') x.okW = val; } else if (a === 'check-keep') x.okR = val;
        // "Use" the plan's own weight on a set not yet lifted: it goes back to following the plan (and
        // the auto-correction), as if nothing had been typed.
        const back = a === 'check-use' && o.field === 'w' && !x.done && val === x.w;
        const inp = $(`#${o.field === 'w' ? 'w' : 'r'}-${sh.ei}-${sh.si}`); if (inp) inp.value = back ? '' : val;
        if (o.field === 'w' && !x.done && !back) x.manualW = true; // your number: the auto-correction leaves it alone
        if (back) { x.manualW = false; setField(sh.ei, sh.si, 'w', null, false); } else setField(sh.ei, sh.si, o.field, val, false);
        if (sh.rpe != null) x.rpe = sh.rpe; // a rating picked before the check
        if (sh.then === 'tick' && !x.done) toggleDone(sh.ei, sh.si); else render();
        break;
      }
      case 'cut-sets': cutSets(Number(d.ei)); break;
      case 'restore-sets': restoreSets(Number(d.ei)); break;
      case 'sheet-close': if (ev.target === t || ev.target.closest('[data-stop]') == null || t.tagName === 'BUTTON') { const was = ui.sheet; ui.sheet = null; renderSheet(); if (was && was.kind === 'check') render(); } break;
      case 'toggle-skip': { const s = state.current, e = s.exercises[Number(d.ei)]; const i = s.skippedSlots.indexOf(e.slotKey); if (i >= 0) s.skippedSlots.splice(i, 1); else s.skippedSlots.push(e.slotKey); afterSetChange(); save(); render(); break; }
      case 'finish-lifting': finishLifting(false); break;
      case 'post-back': { const s = state.current; if (s && s.phase === 'post') { s.phase = 'lift'; delete s.finishedAt; save(); render(); scrollToY(ui.todayScroll || 0); keepAwake(); } break; }
      case 'cardio-back': { const s = state.current; if (s && s.phase === 'cardio') { const r = s.cardioRun; if (r && !r.paused) { r.paused = true; r.pausedAt = Date.now(); } s.phase = 'post'; clearTimeout(cardioTick); releaseAwake(); ui.confirm = null; save(); render(); scrollToY(0); } break; }
      case 'cardio-log-target': { const s = state.current; if (s && ui.cardioLong) { s.cardioDraft = Object.assign({}, s.cardioDraft, { min: ui.cardioLong.target, minTyped: true }); saveCardio(false, true); } break; }
      case 'cardio-log-clock': saveCardio(false, true); break;
      case 'edit-cancel-confirm': cancelEdit(true); break;
      case 'finish-confirm': finishLifting(true); break;
      case 'abandon': ui.confirm = 'abandon'; render(); break;
      case 'abandon-confirm': abandon(); break;
      case 'confirm-cancel': ui.confirm = null; render(); break;
      case 'post-diff': state.current.post = state.current.post || { difficulty: 0 }; state.current.post.difficulty = Number(d.v); save(); if (state.current.phase === 'edit') { document.querySelectorAll('[data-action="post-diff"]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.v) === state.current.post.difficulty))); } else render(); break;
      case 'edit-session': startEdit(d.id); break;
      case 'card-fold': { const sec = t.closest('[data-fold]'); if (sec) { setCardFold(sec, !sec.classList.contains('closed')); saveFolds(); syncFoldAll(); } break; }
      case 'fold-tab': { const all = [...document.querySelectorAll('#main [data-fold]')], close = all.some(s => !s.classList.contains('closed')); all.forEach(s => setCardFold(s, close)); saveFolds(); syncFoldAll(); break; }
      case 'log-all': ui.logAll = true; render(); break;
      case 'chart-pick': case 'chart-step': case 'chart-close': {
        const lift = d.lift; if (!LIFTS.includes(lift)) break;
        const cv = document.getElementById('c-' + lift); if (cv) anchor = { sel: '#c-' + lift, fallback: '#c-' + lift, top: cv.getBoundingClientRect().top, fallbackTop: cv.getBoundingClientRect().top };
        if (a === 'chart-close') { ui.chartSel = null; redrawTrend(); break; }
        if (a === 'chart-step') { const pts = sessionEsts(lift), i = ui.chartSel ? pts.findIndex(p => p.id === ui.chartSel.id) : -1, ni = Math.max(0, Math.min(pts.length - 1, i + Number(d.dir))); if (pts[ni]) ui.chartSel = { lift, id: pts[ni].id }; redrawTrend(); break; }
        const hits = chartHits[lift] || []; if (!hits.length) break;
        const rc = t.getBoundingClientRect(), px = ev.clientX - rc.left, py = ev.clientY - rc.top;
        let best = null, bd = Infinity; for (const h of hits) { const dd = Math.abs(h.px - px) + Math.abs(h.py - py) * 0.35; if (dd < bd) { bd = dd; best = h; } }
        if (best) { ui.chartSel = { lift, id: best.id }; redrawTrend(); }
        break;
      }
      case 'chart-open': {
        ui.histOpen = ui.histOpen || {}; ui.histOpen[d.id] = 1;
        const done = state.sessions.filter(s => !s.skipped).slice().reverse(); if (done.findIndex(s => s.id === d.id) >= 60) ui.histAll = true;
        openSessionsCard(); render();
        const el = document.querySelector(`.session-item[data-id="${d.id}"]`), sc = scroller();
        if (el) scrollToY(sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8);
        break;
      }
      case 'hist-all': ui.histAll = true; render(); break;
      case 'report-all': ui.reportAll = state.lastReport ? state.lastReport.title + '|' + state.lastReport.lines.length : null; render(); break;
      case 'edit-save': saveEdit(); break;
      case 'edit-cancel': cancelEdit(false); break;
      case 'backfill-open': { const y = new Date(); y.setDate(y.getDate() - 1); let dt = todayISO(y); const mn = backfillMin(); if (dt < mn) dt = mn; ui.backfill = { date: dt, mode: 'full' }; ui.checkin = null; render(); break; }
      case 'backfill-cancel': ui.backfill = null; render(); break;
      case 'backfill-start': startBackfill(); break;
      case 'layoff-ease': { const newest = newestSessionDate(); if (!newest) break; snapshot('Eased back in after a layoff'); ui.checkin = null; const gapNow = daysBetween(newest, todayISO()), had = layoffHandled(newest).cut, lines = E.layoffAdjust(state, gapNow, had); state.program.layoffHandled = `${newest}:${layoffTier(gapNow)}:${Math.max(had, E.layoffCut(gapNow))}`; lines.forEach(addLog); if (lines.length) state.lastReport = { title: 'Back after a layoff', lines }; save(); render(); break; }
      case 'layoff-skip': { const newest = newestSessionDate(); if (newest) state.program.layoffHandled = `${newest}:${layoffTier(daysBetween(newest, todayISO()))}:${layoffHandled(newest).cut}`; } addLog('Carried on as planned after a layoff.'); save(); render(); break;
      case 'post-next': if (!state.current.post || !state.current.post.difficulty) { toast('Pick how it went first'); return; } if (state.current.cardioMin || state.settings.cardioMin) { state.current.phase = 'cardio'; ui.quietUntil = performance.now() + 500; save(); render(); scrollToY(0); } else { state.current.cardio = { min: 0 }; completeSession(); } break;
      case 'cardio-start': state.current.cardioRun = { start: Date.now(), pausedTotal: 0, paused: false }; ui.cardioTapAt = Date.now(); keepAwake(); save(); render(); break;
      case 'cardio-pause': { const r = state.current.cardioRun; if (r && Date.now() - (ui.cardioTapAt || 0) > 1200) { r.paused = true; r.pausedAt = Date.now(); releaseAwake(); save(); render(); } break; } // a slow double tap on Start must not pause
      case 'cardio-resume': { const r = state.current.cardioRun; if (r && r.paused) { r.pausedTotal += Date.now() - (r.pausedAt || Date.now()); r.paused = false; r.pausedAt = null; ui.cardioTapAt = Date.now(); keepAwake(); save(); render(); } break; }
      case 'cardio-save': saveCardio(false); break;
      case 'cardio-skip': saveCardio(true); break;
      case 'timer-add': if (ui.timer) { ui.timer.end = Math.max(ui.timer.end, Date.now()) + 30000; ui.timer.fired = false; if (state.timer) { state.timer.end = ui.timer.end; state.timer.firedAt = 0; } armSw(); tickTimer(); scheduleTick(); Store.saveLocal(state); } break;
      case 'timer-stop': stopTimer(); Store.saveLocal(state); break;
      case 'dismiss-report': state.lastReport = null; ui.reportAll = false; delete folds._report; delete folds['today-report']; saveFolds(); save(); render(); break;
      case 'undo': undoLast(); break;
      case 'undo-dismiss': state.undo = null; save(); render(); break;
      case 'offer-dismiss': state.backupOffer = false; save(); render(); break;
      case 'apply-update': applyUpdateIfSafe(true); break;
      case 'check-update': { lastUpdateCheck = 0; checkForUpdate(true).then(r => { if (r === 'latest') toast('You have the latest version'); else if (r === 'guarded') toast('An update is waiting: close the app fully and reopen it'); else if (r === 'failed') toast('Could not reach the server. Try again with a connection'); }); break; }
      case 'deload-now-confirm': if (state.current) { toast('Finish or discard the open session first'); break; } ui.confirm = 'deload'; render(); break;
      case 'rest-now-confirm': if (state.current) { toast('Finish or discard the open session first'); break; } ui.confirm = 'rest'; render(); break;
      case 'deload-now': { if (state.current) { toast('Finish or discard the open session first'); break; } snapshot('Deload started early'); const ok = E.startDeloadNow(state); ui.confirm = null; ui.checkin = null; if (ok) addLog('Deload started early.'); else { state.undo = null; toast('Already in a light week'); } save(); render(); break; }
      case 'deload-later': snapshot('Deload suggestion dismissed'); state.program.pendingDeload = false; state.program.pushOn = true; addLog('Deload suggestion declined; this week runs trimmed (no bonus reps or earned sets, loads 2.5% down).'); save(); render(); break;
      case 'rest-now': { if (state.current) { toast('Finish or discard the open session first'); break; } snapshot('Easy week inserted'); const ok = E.startActiveRest(state, 1); ui.confirm = null; ui.checkin = null; if (ok) addLog('Easy week inserted.'); else { state.undo = null; toast('Already in a light week'); } save(); render(); break; }
      case 'set-plate': { const s = state.settings, p = Number(d.p); if (s.plates.includes(p) && s.plates.length === 1) { toast('Keep at least one plate size'); break; } s.plates = (s.plates.includes(p) ? s.plates.filter(x => x !== p) : s.plates.concat(p)).sort((a, b) => b - a); s.increment = Math.min(10, E.loadStep(s.plates)); LIFTS.forEach(l => E.applyTM(state, l, state.lifts[l].oneRM)); rebaseSession(); save(); render(); break; }
      case 'set-day': { const s = state.settings; s.days = s.days.includes(d.d) ? s.days.filter(x => x !== d.d) : s.days.concat(d.d); save(); render(); break; }
      case 'extra-del': { const i = Number(d.i), c = (state.extraCardio || [])[i]; if (c) { state.extraCardio.splice(i, 1); save(); toast(`Removed ${c.min} min`); render(); } break; }
      case 'extra-cardio': { const m = Math.min(600, Math.max(0, Math.round(Number($('#extra-cardio').value) || 0))); if (m > 0) { state.extraCardio = state.extraCardio || []; state.extraCardio.push({ date: todayISO(), min: m, kcal: E.cardioKcal(m, state.settings.cardioWatts) }); save(); toast(`Logged ${m} min`); render(); } break; }
      case 'export': copyBackup(); break;
      case 'share-backup': shareBackup(); break;
      case 'import-toggle': ui.showImport = !ui.showImport; render(); break;
      case 'import': restoreFromText(($('#import-text') || {}).value || ''); break;
      case 'restore-confirm': if (ui.pendingRestore) applyRestore(ui.pendingRestore); break;
      case 'restore-cancel': ui.pendingRestore = null; render(); break;
      case 'setup-restore': ui.setupRestore = !ui.setupRestore; render(); break;
      case 'recover-aside': { const a = asideData(); if (!restoreFromText(a, true) && !state.setupDone) recoveryCard(new Error('This copy cannot be read by this version. Copy it somewhere safe; a later update may read it.'), a); break; }
      case 'aside-copy': { const a = asideData(); if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(a).then(() => toast('Copied'), () => toast('Could not copy')); else toast('Could not copy'); break; }
      case 'aside-del-confirm': ui.confirm = 'aside'; render(); break;
      case 'aside-del': try { localStorage.removeItem(Store.key + '.unreadable'); } catch (e) { /* ignore */ } ui.confirm = null; render(); toast('Removed'); break;
      case 'reset-confirm': ui.confirm = 'reset'; render(); break;
      case 'reset': { stopTimer(); releaseAwake(); for (const s of state.sessions) Store.deleteSession(s.id); state = E.defaultState(); ui.confirm = null; ui.setupStep = 0; ui.draft = null; ui.checkin = null; ui.sheet = null; ui.pendingRestore = null; ui.backfill = null; ui.showImport = false; ui.editSets = {}; ui.lastDeleted = null; ui.lastEi = null; renderSheet(); save(); render(); break; }
      case 'delete-cancel': ui.confirmDel = null; render(); break;
      case 'max-apply': if (ui.pendingMax) { const pm = ui.pendingMax; ui.pendingMax = { l: pm.l, v: pm.v, ok: true }; applySetting('1rm:' + pm.l, pm.v); ui.pendingMax = null; render(); } break;
      case 'max-cancel': ui.pendingMax = null; render(); break;
      case 'delete-session': { if (state.current) { toast('Finish or discard the open session first'); break; } if (!d.sure) { ui.confirmDel = d.id; render(); break; } ui.confirmDel = null; const i = state.sessions.findIndex(s => s.id === d.id); if (i >= 0) { const s = state.sessions[i]; const inWeek = sessionsOfWeek().some(x => x.id === s.id); snapshot(`Deleted ${s.dayName} (${fmtDate(s.date)})`, { restoreSession: s }); state.sessions.splice(i, 1); Store.deleteSession(d.id);
        if (!s.skipped && inBlock(s) && (s.ts || 0) > (state.program.calibBaseTs || 0)) { const lines = [`${s.dayName} (${fmtDate(s.date)}) deleted.`].concat(recalibrateBlock(inWeek ? 'This week\'s review will leave it out.' : null)); lines.forEach(addLog); state.lastReport = { title: 'Session deleted', lines, sessionId: null }; }
        const acc = s.skipped ? [] : reAccessories(s, false); if (acc.length) { acc.forEach(addLog); if (state.lastReport && state.lastReport.title === 'Session deleted') state.lastReport.lines = state.lastReport.lines.concat(acc); else state.lastReport = { title: 'Session deleted', lines: acc, sessionId: null }; }
        save(); render(); toast('Deleted. Undo is at the top of History.'); } break; }
    }
  });
  // Restore a backup (pasted text or a chosen file). Untrusted: it goes through the sanitizer and can
  // never carry an undo snapshot or anything outside the whitelist.
  function restoreFromText(txt, fromAside) {
    let fresh;
    try {
      if (txt.length > 20e6) throw new Error('too large');
      const obj = JSON.parse(String(txt).replace(/^\uFEFF/, ''));
      if (!obj || typeof obj !== 'object' || !obj.settings || !obj.program) throw new Error('bad');
      fresh = cleanState(obj, false);
      if (!fresh.setupDone) throw new Error('no maxes');
    } catch (e) { toast('That does not look like a Readyset backup'); return false; }
    if (state.current) { toast('Finish or discard the session in progress first'); return false; }
    if (!state.setupDone && !fromAside && storedProgramMissed()) { location.reload(); return false; }
    if (state.setupDone && state.sessions.some(x => !x.skipped)) { ui.pendingRestore = fresh; render(); scrollToY(0); return false; }
    return applyRestore(fresh, fromAside);
  }
  function sessionSpan(list) {
    const done = list.filter(x => !x.skipped); if (!done.length) return 'no sessions';
    let newest = done[0].date; for (const x of done) if (x.date > newest) newest = x.date;
    return `${done.length} session${done.length === 1 ? '' : 's'}, newest ${fmtDate(newest)}`;
  }
  function renderRestoreConfirm() {
    const f = ui.pendingRestore; if (!f) return '';
    const newest = (l) => l.filter(x => !x.skipped).reduce((m, x) => (x.date > m ? x.date : m), '');
    const older = newest(f.sessions) < newest(state.sessions);
    return `<div class="card"><h3>Replace this phone's data?</h3>
      <div class="callout">Backup: ${esc(sessionSpan(f.sessions))}</div>
      <div class="callout">On this phone now: ${esc(sessionSpan(state.sessions))}</div>
      ${older ? `<div class="callout bad">This backup is older than what is on this phone. Sessions after ${fmtDate(newest(f.sessions) || '2000-01-01')} would be lost.</div>` : ''}
      <div class="btnrow"><button class="btn danger" data-action="restore-confirm">Replace</button><button class="btn" data-action="restore-cancel">Cancel</button></div></div>`;
  }
  function applyRestore(fresh, fromAside) { // fromAside: this phone's own copy, not a backup: its session stays and it has not been backed up
    ui.pendingRestore = null;
    if (!fromAside) { fresh.lastBackupAt = Date.now(); fresh.lastBackupKind = 'restore'; }
    try {
      const oldIds = state.sessions.map(x => x.id), prev = state;
      if (!fromAside) fresh.current = null;
      fresh.timer = null;
      stopTimer();
      try { state = fresh; migrate(); } catch (e) { state = prev; throw e; }
      if (fromAside) { try { localStorage.removeItem(Store.key + '.unreadable'); } catch (e) { /* ignore */ } }
      postSw({ type: 'rest-cancel' }); Store.pushAll(state);
      for (const id of oldIds) if (!state.sessions.some(x => x.id === id)) Store.deleteSession(id);
      save(); ui.showImport = false; ui.setupRestore = false; ui.checkin = null; ui.confirm = null; view = 'today';
      { const n = state.sessions.filter(x => !x.skipped).length; toast(`Restored: ${n} session${n === 1 ? "" : "s"}`); } render();
      return true;
    } catch (e) { toast('That does not look like a Readyset backup'); return false; }
  }
  function restoreFromFile(input) {
    const f = input.files && input.files[0]; input.value = '';
    if (!f) return;
    if (f.size > 20e6) { toast('That file is too large to be a Readyset backup'); return; }
    const r = new FileReader();
    r.onload = () => restoreFromText(String(r.result || ''));
    r.onerror = () => toast('Could not read that file');
    r.readAsText(f);
  }
  // A real file input inside a button-styled label: tapping it opens the Files picker on iPhone.
  function filePick(label, extraClass) {
    return `<label class="btn file-pick ${extraClass || ''}">${label}<input type="file" accept=".json,application/json,text/json,text/plain" data-action="import-file" aria-label="${label}"></label>`;
  }
  function fallbackCopy(txt) { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; } ta.remove(); if (ok) { noteBackup('clipboard'); toast('Backup copied. Paste it into Notes.'); render(); } else toast('Copy failed. Use Save backup file instead.'); }
  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset.draft) { const dr = draft(); dr[t.dataset.draft] = t.type === 'checkbox' ? t.checked : t.value; return; }
    if (t.dataset.calc) { const [l, k] = t.dataset.calc.split(':'); const dr = draft(); dr.calc[l] = dr.calc[l] || {}; dr.calc[l][k] = t.value; return; }
    if (t.dataset.set) { clearTimeout(typeTimer); pendingType = null; if (t.validity && t.validity.badInput) { toast('Use digits and one decimal point'); return; } setField(Number(t.dataset.ei), Number(t.dataset.si), t.dataset.set, t.value); return; }
    if (t.dataset.setting) {
      const hadPending = !!ui.pendingMax;
      const r = applySetting(t.dataset.setting, t.type === 'checkbox' ? t.checked : t.value);
      // Re-render for taps (selects, checkboxes) and for a value that needs an answer; for typed
      // fields only refresh the dependent text, so the next tap after leaving a field is not
      // swallowed by a rebuild. A value that was refused or clamped shows what was kept.
      if (t.tagName === 'SELECT' || t.type === 'checkbox' || r === 'confirm' || (hadPending && !ui.pendingMax)) render();
      else {
        if (r === 'reset') { const k = t.dataset.setting; t.value = k.startsWith('1rm:') ? state.lifts[k.split(':')[1]].oneRM : state.settings[k]; }
        const el = $('#tm-line'); if (el) el.textContent = tmLine();
        if (view === 'settings') syncFoldSums(renderSettings());
      }
      return;
    }
    if (t.dataset.action === 'import-file') { restoreFromFile(t); return; }
    if (t.dataset.edit) { applyEditField(t); return; }
    if (t.dataset.backfill && ui.backfill) { ui.backfill[t.dataset.backfill] = t.value; return; }
    if (t.dataset.action === 'swap') { swapExercise(Number(t.dataset.ei), t.value); return; }
    if (t.dataset.action === 'notes') { state.current.notes = t.value.slice(0, 1000); save(); return; }
    if (['next-block', 'dial', 'pin-swap'].includes(t.dataset.action)) state.undo = null;
    if (t.dataset.action === 'next-block') { state.program.nextBlockOverride = t.value === '' ? null : Number(t.value); save(); return; }
    if (t.dataset.action === 'dial') { const v = Math.max(-2, Math.min(2, Math.round(Number(t.value)) || 0)); if (v !== (state.program.volumeDial || 0)) { state.program.volumeDial = v; addLog(`Volume dial set to ${v > 0 ? '+' : ''}${v} by hand.`); save(); render(); } return; }
    if (t.dataset.action === 'pin-swap') { if (t.value === '') delete state.program.swaps[t.dataset.k]; else state.program.swaps[t.dataset.k] = t.value; save(); render(); return; }
  });
  // iOS swallows a tap made while the page is still gliding after a flick: it only stops the glide,
  // and no click follows. That is right for page content, but the tab bar and the rest timer are
  // fixed controls, so they act on the touch itself: a touch that lifts within 10px of where it
  // started, on the same button, is a tap. preventDefault stops the browser's own click from
  // following, so it never fires twice.
  // Swipe a set row left to reveal Delete. Horizontal moves only; vertical ones scroll as usual
  // (touch-action: pan-y on the row). One row open at a time; any other touch closes it.
  const SWIPE_W = 84;
  let swipe = null;
  function closeSwipes(except) { document.querySelectorAll('.set.open').forEach(r => { if (r !== except) { r.classList.remove('open'); r.style.removeProperty('--sx'); } }); }
  document.addEventListener('touchstart', (ev) => {
    const row = ev.target.closest && ev.target.closest('.set[data-si]');
    closeSwipes(row);
    if (!row || ev.touches.length !== 1 || ev.target.closest('.swipe-del')) { swipe = null; return; }
    swipe = { row, x: ev.touches[0].clientX, y: ev.touches[0].clientY, base: row.classList.contains('open') ? -SWIPE_W : 0, mode: null };
  }, { passive: true });
  document.addEventListener('touchmove', (ev) => {
    if (!swipe) return;
    const p = ev.touches[0], dx = p.clientX - swipe.x, dy = p.clientY - swipe.y;
    if (!swipe.mode) { if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; swipe.mode = Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'scroll'; if (swipe.mode === 'swipe') swipe.row.classList.add('swiping'); }
    if (swipe.mode !== 'swipe') return;
    const sx = Math.max(-SWIPE_W - 16, Math.min(0, swipe.base + dx));
    swipe.row.style.setProperty('--sx', sx + 'px');
  }, { passive: true });
  const endSwipe = () => {
    const s = swipe; swipe = null; if (!s || s.mode !== 'swipe') return;
    const sx = parseFloat(s.row.style.getPropertyValue('--sx')) || 0;
    s.row.classList.remove('swiping');
    if (sx < -SWIPE_W / 2) { s.row.classList.add('open'); s.row.style.setProperty('--sx', -SWIPE_W + 'px'); }
    else { s.row.classList.remove('open'); s.row.style.removeProperty('--sx'); }
  };
  document.addEventListener('touchend', endSwipe, { passive: true });
  document.addEventListener('touchcancel', endSwipe, { passive: true });
  const FAST = '#tabbar button, #timer button';
  let fastTap = null;
  document.addEventListener('touchstart', (ev) => {
    const el = ev.target.closest && ev.target.closest(FAST);
    fastTap = el && ev.touches.length === 1 ? { el, x: ev.touches[0].clientX, y: ev.touches[0].clientY } : null;
  }, { passive: true });
  document.addEventListener('touchmove', (ev) => {
    if (!fastTap) return; const p = ev.touches[0];
    if (Math.abs(p.clientX - fastTap.x) > 10 || Math.abs(p.clientY - fastTap.y) > 10) fastTap = null;
  }, { passive: true });
  document.addEventListener('touchcancel', () => { fastTap = null; }, { passive: true });
  document.addEventListener('touchend', (ev) => {
    const f = fastTap; fastTap = null; if (!f) return;
    const p = ev.changedTouches[0];
    if (Math.abs(p.clientX - f.x) > 10 || Math.abs(p.clientY - f.y) > 10) return;
    const hit = document.elementFromPoint(p.clientX, p.clientY);
    if (!hit || hit.closest(FAST) !== f.el) return;
    ev.preventDefault();
    const act = document.activeElement;
    if (act && act !== document.body && typeof act.blur === 'function') act.blur();
    if (state && state.current) unlockAudio();
    f.el.click();
  }, { passive: false });
  let typeTimer = null, pendingType = null, notesTimer = null;
  function applyPendingType(commit) {
    clearTimeout(typeTimer); typeTimer = null;
    const p = pendingType; pendingType = null;
    if (p && state.current && state.current.exercises[p.ei]) setField(p.ei, p.si, p.which, p.val, !commit);
  }
  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.dataset.draft && t.type !== 'checkbox') draft()[t.dataset.draft] = t.value;
    if (t.dataset.calc) { const [l, k] = t.dataset.calc.split(':'); const dr = draft(); dr.calc[l] = dr.calc[l] || {}; dr.calc[l][k] = t.value; }
    // Save set inputs as you type, so a closed app mid-entry loses nothing.
    if (t.dataset.set && state.current) { if (t.validity && t.validity.badInput) return; clearTimeout(typeTimer); pendingType = { ei: Number(t.dataset.ei), si: Number(t.dataset.si), which: t.dataset.set, val: t.value }; typeTimer = setTimeout(applyPendingType, 350); }
    if (t.dataset.cardio && state.current) {
      const dr = state.current.cardioDraft = state.current.cardioDraft || {}, n = t.value === '' ? null : Math.round(Number(t.value));
      if (t.dataset.cardio === 'min') { dr.min = Number.isFinite(n) ? Math.min(600, Math.max(0, n)) : null; dr.minTyped = t.value !== ''; } else dr.watts = Number.isFinite(n) && n > 0 ? Math.min(2000, n) : null;
      clearTimeout(notesTimer); notesTimer = setTimeout(() => Store.saveLocal(state), 400);
    }
    if (t.dataset.edit) applyEditField(t);
    // Notes save as you type too (they used to wait for the box to lose focus).
    if (t.dataset.action === 'notes' && state.current) { state.current.notes = t.value.slice(0, 1000); clearTimeout(notesTimer); notesTimer = setTimeout(() => Store.saveLocal(state), 400); }
  });
  // Closing or switching away from the app: write whatever is half-typed right now. iOS can kill a
  // backgrounded web app without warning, and these events are the last chance to save.
  // Only once the stored data has loaded cleanly: before that (or on the recovery screen) the
  // in-memory state is a blank default, and saving it would overwrite what is on the device.
  let booted = false;
  // ---------- Self-update ----------
  // iOS keeps a home-screen web app alive for days, so it keeps running old code long after a new
  // version is published. Each time the app comes to the front it asks the server which build is
  // current; a different one is loaded by reloading the page, which keeps every bit of data (it all
  // lives in storage). The reload waits for a safe moment: not while typing, and not mid-session
  // unless you tap the banner.
  const BUILD = ((document.querySelector('meta[name="readyset-build"]') || {}).content || '').trim();
  let lastUpdateCheck = 0, reloading = false;
  // Resolves to 'latest' | 'update' | 'guarded' | 'failed' | 'off' | 'throttled'.
  function checkForUpdate(force) {
    if (!BUILD || !location.protocol.startsWith('http') || reloading) return Promise.resolve('off');
    if (!force && Date.now() - lastUpdateCheck < 60000) return Promise.resolve('throttled');
    lastUpdateCheck = Date.now();
    return fetch('./version.txt', { cache: 'no-store', signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined }).then(r => (r.ok ? r.text() : '')).then(v => {
      v = (v || '').trim();
      if (!/^[a-f0-9]{6,64}$/.test(v)) return 'failed';
      if (v === BUILD) return 'latest';
      // Reloaded for this version already and still running the old one (a stale cache in the way):
      // do not loop. The next launch, or the next change on the server, tries again.
      try { const g = JSON.parse(sessionStorage.getItem('rs-reloaded-for') || 'null'); if (g && g.v === v && Date.now() - g.at < 600000) return 'guarded'; } catch (e) { /* an older format */ }
      ui.updateReady = v;
      try { if (navigator.serviceWorker && !(state && state.current)) navigator.serviceWorker.getRegistration().then(reg => reg && reg.update()).catch(() => {}); } catch (e) { /* ignore */ }
      applyUpdateIfSafe();
      return 'update';
    }).catch(() => 'failed');
  }
  // Anything that lives only in memory (a check-in in progress, a half-filled setup, a session, the
  // RPE sheet, a restore waiting for confirmation, a focused field) makes the update wait for a tap.
  function updateBusy() {
    const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    return !!(typing || sharing || !state || state.current || !state.setupDone || ui.checkin || ui.backfill || ui.pendingRestore || ui.sheet || ui.confirm || ui.showImport || ui.setupRestore || ui.confirmDel);
  }
  function applyUpdateIfSafe(byTap) {
    if (!ui.updateReady || reloading) return;
    if (!byTap && document.visibilityState !== 'visible') return;
    if (!byTap && updateBusy()) { renderUpdateBar(); return; }
    reloading = true;
    // The service worker serves its stored copy, so that copy is refreshed first, and the reload
    // happens only with the new page in hand: nothing else would change, and a running page is never
    // given up for nothing. The page stays usable during the wait, however slow the signal.
    let gone = false;
    const go = (fresh) => {
      if (gone) return; gone = true;
      if (!fresh) { reloading = false; renderUpdateBar(); if (byTap) toast('Update not downloaded yet. Try again in a moment.'); return; }
      if (!byTap && (updateBusy() || document.visibilityState !== 'visible')) { reloading = false; renderUpdateBar(); return; } // something started while the copy was refreshing
      saveNow();
      try { sessionStorage.setItem('rs-view', view); sessionStorage.setItem('rs-ui', JSON.stringify({ checkin: ui.checkin && !ui.checkin.result ? ui.checkin : null, backfill: ui.backfill || null })); } catch (e) { /* ignore */ }
      try { sessionStorage.setItem('rs-reloaded-for', JSON.stringify({ v: String(ui.updateReady), at: Date.now() })); } catch (e) { /* ignore */ }
      setTimeout(() => location.reload(), 50);
    };
    fetch(location.pathname, { cache: 'no-cache' }).then(r => r.text()).then(t => go(t.includes('<meta name="readyset-build"') && !t.includes(`content="${BUILD}"`)), () => go(false));
    setTimeout(() => go(false), 20000);
  }
  function renderUpdateBar() {
    if (!ui.updateReady || $('#update-bar')) return;
    const bar = document.createElement('div'); bar.id = 'update-bar'; bar.className = 'update-bar';
    bar.innerHTML = `<span>${state && state.current ? 'New version ready. Your sets are saved; it installs when you finish, or tap now.' : 'New version ready. Everything is saved.'}</span><button class="btn sm" data-action="apply-update">Update now</button>`;
    const app = $('#app'); if (app) app.insertBefore(bar, app.firstChild);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (booted) noteReturn(false);
    if (booted && state && lastRenderDay && lastRenderDay !== todayISO() && !ui.sheet && !(document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName))) render();
    if (ui.updateReady) applyUpdateIfSafe(); else checkForUpdate(false);
  });
  setInterval(() => { if (document.visibilityState === 'visible') checkForUpdate(false); }, 30 * 60000);
  // A new service worker taking over is a hint, not proof (the first install and a page that already
  // loaded the new build both fire it): confirm against version.txt before doing anything.
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('controllerchange', () => { armSw(); lastUpdateCheck = 0; checkForUpdate(true); }); // armSw also resends a cancel lost during the swap
  function saveNow() {
    if (!state || !booted) return;
    if (!state.setupDone && !state.sessions.length) return; // a blank state never saves itself on the way out
    try {
      applyPendingType(true);
      clearTimeout(notesTimer); notesTimer = null;
      try { sessionStorage.setItem('rs-scroll', JSON.stringify({ view, y: scroller().scrollTop, ts: ui.todayScroll || 0, id: state.current ? state.current.id + ':' + state.current.phase : '' })); sessionStorage.setItem('rs-sheet', ui.sheet && !ui.sheet.kind ? JSON.stringify(ui.sheet) : ''); } catch (e) { /* ignore */ }
      const n = $('#sess-notes'); if (n && state.current) state.current.notes = n.value.slice(0, 1000);
      Store.saveLocal(state); Store.flush();
    } catch (e) { /* never block closing */ }
  }
  document.addEventListener('touchend', () => { if (booted && state && state.current) { unlockAudio(); keepAwake(); } }, { passive: true }); // iOS wants a gesture for both, and a page it reopened has had none
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
  window.addEventListener('pagehide', saveNow);
  window.addEventListener('storage', (e) => {
    if (e.key !== Store.key || !booted || reloading) return;
    if (e.newValue !== Store.last) Store.last = null; // what is on disk is not ours any more: the next save writes again
    if (!e.newValue) return;
    let up = 0; try { up = (JSON.parse(e.newValue) || {}).updatedAt || 0; } catch (x) { return; }
    if (up <= (state.updatedAt || 0)) return;
    if (!state.current) { reloading = true; booted = false; try { sessionStorage.setItem('rs-view', view); } catch (x) { /* ignore */ } location.reload(); } // booted off: this page must not save its older copy on the way out
    else toast('Readyset is open in another window. Finish here, or close that one, so neither overwrites the other.');
  });
  // The page itself never scrolls, but iOS can nudge it up to make room for the keyboard and leave
  // it there; put it back once no field has focus.
  document.addEventListener('focusout', () => setTimeout(() => {
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
    if (window.scrollY || document.documentElement.scrollTop) window.scrollTo(0, 0);
  }, 120));

  // ---------- Boot ----------
  async function boot() {
    let h = (location.hash || '').replace('#', '');
    try { const v = sessionStorage.getItem('rs-view'); if (v) { h = v; sessionStorage.removeItem('rs-view'); } else { const sv = JSON.parse(sessionStorage.getItem('rs-scroll') || 'null'); if (sv && sv.view && sv.id) { h = sv.view; ui.todayScroll = sv.ts || 0; } } } catch (e) { /* ignore */ } // iOS reopened the page mid-session: the tab you were on
    if (['today', 'program', 'history', 'settings'].includes(h)) view = h;
    state = E.defaultState();
    $('#main').innerHTML = '<p class="empty">Loading…</p>';
    let loaded = null;
    try { loaded = await Store.init(); } catch (e) { loaded = null; }
    if (Store.unreadable) { try { localStorage.setItem(Store.key + '.unreadable', Store.unreadable); } catch (e) { /* no room */ } }
    if (!loaded && Store.unreadable) { recoveryCard(new Error('The stored data could not be read.'), Store.unreadable); return; }
    try {
      if (loaded) state = cleanState(loaded, true);
      migrate();
      render();
      booted = true;
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persisted().then(p => p || navigator.storage.persist()).catch(() => {}); } catch (e) { /* not available */ }
    } catch (e) {
      // Never leave a dead page: whatever is stored can still be copied out or replaced.
      recoveryCard(e);
      return;
    }
    if (state.current && state.current.phase === 'lift' && state.timer) resumeTimer(); else postSw({ type: 'rest-cancel' });
    if (document.visibilityState === 'visible') clearRestNotes();
    keepAwake(); // lifting, or the bike clock running
    // Back where you were: after an update or iOS reopening the app, the same screen position (or,
    // in a session, the set you are on) and a half-answered check-in.
    try {
      const sv = JSON.parse(sessionStorage.getItem('rs-scroll') || 'null'); sessionStorage.removeItem('rs-scroll');
      const keyNow = state.current ? state.current.id + ':' + state.current.phase : '';
      const restoreSpot = () => {
        if (sv && sv.view === view && sv.id === keyNow && sv.y > 0) scrollToY(sv.y);
        else if (state.current && state.current.phase === 'lift' && view === 'today') { const el = document.querySelector('.set.next') || document.querySelector('.ex:not(.collapsed)'); if (el) { const sc = scroller(); scrollToY(sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top - sc.clientHeight * 0.3); } }
      };
      restoreSpot();
      if (document.fonts && document.fonts.status === 'loading') { // the real fonts re-wrap the text: put the spot back, unless you have already touched the page
        const y = scroller().scrollTop; let touched = false;
        document.addEventListener('touchstart', () => { touched = true; }, { once: true, passive: true, capture: true });
        document.fonts.ready.then(() => { if (!touched && scroller().scrollTop === y) restoreSpot(); }).catch(() => {});
      }
      const su = JSON.parse(sessionStorage.getItem('rs-ui') || 'null'); sessionStorage.removeItem('rs-ui');
      if (su && !state.current) { if (su.checkin && Date.now() - (su.checkin.at || 0) < 3 * 3600000) ui.checkin = su.checkin; if (su.backfill) ui.backfill = su.backfill; if (ui.checkin || ui.backfill) render(); }
    } catch (e) { /* nothing to restore */ }
    try { const sh = JSON.parse(sessionStorage.getItem('rs-sheet') || 'null'); sessionStorage.removeItem('rs-sheet'); if (sh && state.current) { const ex = state.current.exercises[sh.ei], x = ex && ex.sets[sh.si]; if (x && x.done && x.rpe == null) { ui.sheet = sh; renderSheet(); } } } catch (e) { /* nothing to restore */ }
    noteReturn(true);
    setTimeout(() => checkForUpdate(true), 3000);
    if (state.current && state.current.phase === 'cardio' && state.current.cardioRun) tickCardio();
  }
  // How returns to a session really go on this phone: iOS reopened the page, or it only woke up.
  // The time is what the page can see; anything longer than that is iOS itself. Device-only, not in backups.
  function noteReturn(cold) {
    try {
      if (!state || !state.current) return;
      const t0 = performance.now();
      requestAnimationFrame(() => setTimeout(() => { try {
        const k = Store.key + '.opens', o = JSON.parse(localStorage.getItem(k) || '{}');
        if (cold) { const n = performance.getEntriesByType('navigation')[0]; o.cold = (o.cold || 0) + 1; o.resp = n ? Math.round(n.responseEnd) : 0; o.paint = Math.round(performance.now()); }
        else { o.thaw = (o.thaw || 0) + 1; o.thawMs = Math.round(performance.now() - t0); }
        localStorage.setItem(k, JSON.stringify(o));
      } catch (e) { /* only a measurement */ } }, 0));
    } catch (e) { /* only a measurement */ }
  }
  function returnsLine() {
    try { const o = JSON.parse(localStorage.getItem(Store.key + '.opens') || '{}'); if (!o.cold && !o.thaw) return ''; return `<br>Mid-session returns: ${o.cold || 0} reopened (last ${o.paint || 0} ms to draw), ${o.thaw || 0} resumed (last ${o.thawMs || 0} ms).`; } catch (e) { return ''; }
  }
  function recoveryCard(err, rawIn) {
    const raw = rawIn || (() => { try { return localStorage.getItem(Store.key) || ''; } catch (e) { return ''; } })();
    $('#tabbar').hidden = true;
    $('#main').innerHTML = `<div class="card"><h2>Something in the saved data could not be read</h2>
      <p class="small muted">${esc(String(err && err.message || err))}</p>
      <p>Your stored data is below. Copy it somewhere safe, then start over or restore from a backup.</p>
      <label class="f">Stored data<textarea id="recovery-text" rows="5" readonly>${esc(raw)}</textarea></label>
      <div class="btnrow"><button class="btn" id="recovery-copy">Copy stored data</button><button class="btn danger" id="recovery-reset">Start over</button></div></div>`;
    $('#recovery-copy').addEventListener('click', () => { const ta = $('#recovery-text'); ta.select(); try { document.execCommand('copy'); } catch (e) { /* ignore */ } if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(raw).catch(() => {}); toast('Copied'); });
    let sure = false;
    $('#recovery-reset').addEventListener('click', (ev) => { if (!sure) { sure = true; ev.target.textContent = 'Erase it: tap again'; return; } booted = false; try { if (raw) localStorage.setItem(Store.key + '.unreadable', raw); } catch (e) { try { localStorage.removeItem(Store.key); localStorage.setItem(Store.key + '.unreadable', raw); } catch (e2) { /* no room for a copy */ } } try { localStorage.removeItem(Store.key); } catch (e) { /* ignore */ } location.reload(); });
  }
  // One-time upgrade steps for data saved by earlier versions.
  function migrate() {
    if (!state.migratedV2 && state.setupDone) {
      // Run every already-logged session through the calibration it never had, oldest first.
      const lines = [];
      for (const sess of state.sessions) {
        if (sess.skipped || sess.calibrated) continue;
        const l = calibrateSession(sess);
        l.forEach(x => { addLog(x); lines.push(`${fmtDate(sess.date)}: ${x}`); });
      }
      if (state.sessions.some(x => !x.skipped)) lines.push(`Maxes now: squat ${state.lifts.squat.oneRM}, bench ${state.lifts.bench.oneRM}, deadlift ${state.lifts.deadlift.oneRM}. From here on they calibrate after every session.`);
      if (lines.length) state.lastReport = { title: 'Your logged sessions, re-read by the new calibration', lines };
      state.migratedV2 = true; save();
    }
  }
  boot();
})();
