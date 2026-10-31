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

  let state = null;
  let view = 'today';
  const ui = { checkin: null, sheet: null, timer: null, confirm: null, setupStep: 0, draft: null, expand: {}, cardioRun: null, importText: '' };

  // ---------- Dates ----------
  function todayISO(d) { d = d || new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function fmtDate(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
  function fmtDateLong(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
  function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 864e5); }

  // ---------- Storage ----------
  // Every state object that enters from outside the running page is rebuilt by the sanitizer:
  // the device's own storage is trusted (it may carry the cloud token); anything pasted, shared or
  // fetched is not. A state that cannot even build a session is refused rather than kept.
  function cleanState(raw, trusted) {
    const st = E.sanitizeState(raw, { trusted });
    E.positionLabel(st);
    for (let d = 0; d < E.DAYS.length; d++) { st.program.dayIdx = d; E.buildSession(st, 'full'); }
    st.program.dayIdx = E.sanitizeState(raw, { trusted }).program.dayIdx;
    return st;
  }
  const Store = {
    key: 'readyset.v1', db: null, timer: null, chain: Promise.resolve(), remoteOk: false, lastError: null,
    loadLocal() { try { const t = localStorage.getItem(this.key); return t ? JSON.parse(t) : null; } catch (e) { return null; } },
    saveLocal(s) {
      try { localStorage.setItem(this.key, JSON.stringify(s)); if (this.lastError) { this.lastError = null; } }
      catch (e) { if (!this.lastError) { this.lastError = 'Saving to this device failed (storage full or blocked). Back up now.'; try { toast(this.lastError); } catch (e2) { /* before DOM */ } } }
    },
    async init() {
      let local = this.loadLocal();
      try {
        if (window.claude && typeof window.claude.use === 'function') {
          const db = await Promise.race([window.claude.use('db'), new Promise(r => setTimeout(() => r(null), 5000))]);
          if (db) {
            this.db = db;
            const snap = await db.doc('app/state').get();
            if (snap.exists) {
              const remote = snap.data();
              const q = await db.collection('sessions').limit(1000).get();
              const remoteSessions = q.docs.map(d => d.data());
              const localSessions = (local && Array.isArray(local.sessions)) ? local.sessions : [];
              // Sessions are merged by id, never replaced, so a push that failed cannot lose one.
              const byId = new Map(); for (const x of remoteSessions.concat(localSessions)) if (x && x.id && !byId.has(x.id)) byId.set(x.id, x);
              const merged = Array.from(byId.values()).sort((a, b) => (a.ts || 0) - (b.ts || 0));
              const localNewer = local && (local.updatedAt || 0) > (remote.updatedAt || 0);
              local = Object.assign({}, localNewer ? local : remote, { sessions: merged });
              this.remoteOk = true;
              if (localNewer) this.pushAll(local);
              for (const x of localSessions) if (!remoteSessions.some(r => r && r.id === x.id)) this.pushSession(x);
            } else if (local) {
              this.remoteOk = true; this.pushAll(local);
            } else this.remoteOk = true;
          }
        }
      } catch (e) { /* fall back to local */ }
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
      copy.settings = Object.assign({}, s.settings); delete copy.settings.gistToken; delete copy.settings.gistId;
      this.chain = this.chain.then(() => this.db.doc('app/state').set(copy)).catch(() => {});
    },
    pushSession(sess) {
      if (!this.db) return;
      this.chain = this.chain.then(() => this.db.doc('sessions/' + sess.id).set(sess)).catch(() => {});
    },
    pushAll(s) { this.pushState(s); for (const x of s.sessions || []) this.pushSession(x); },
    deleteSession(id) { if (this.db) this.chain = this.chain.then(() => this.db.doc('sessions/' + id).delete()).catch(() => {}); },
  };
  function save() { Store.save(state); Cloud.schedule(); }

  // ---------- Backups ----------
  // The phone's storage is the only copy of the data, and on iOS deleting the home-screen icon
  // deletes it. So: an automatic off-device copy in a private GitHub Gist (the user's own account,
  // written after every change), a share-sheet file, and a clipboard copy.
  function backupJSON() {
    const copy = Object.assign({}, state); copy.settings = Object.assign({}, state.settings);
    for (const k of ['gistToken', 'gistId']) delete copy.settings[k];
    for (const k of ['current', 'undo', 'timer', 'cloudError', 'lastCloudBackup']) delete copy[k];
    return JSON.stringify(copy);
  }
  function noteBackup(kind) { state.lastBackupAt = Date.now(); state.lastBackupKind = kind; Store.saveLocal(state); }
  function sessionsSinceBackup() { const t = state.lastBackupAt || 0; return state.sessions.filter(s => !s.skipped && (s.ts || 0) > t).length; }
  async function shareBackup() {
    const json = backupJSON(), name = `readyset-backup-${todayISO()}.json`;
    try {
      const file = new File([json], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Readyset backup' }); noteBackup('file'); toast('Backup shared'); render(); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try {
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
      noteBackup('file'); toast('Backup file saved'); render();
    } catch (e) { copyBackup(); }
  }
  function copyBackup() { const txt = backupJSON(); const ok = () => { noteBackup('clipboard'); toast('Backup copied. Paste it into Notes.'); render(); }; if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, () => fallbackCopy(txt)); else fallbackCopy(txt); }
  const Cloud = {
    timer: null, busy: false,
    available() { return !!(state && state.settings.gistToken) && !(window.claude && window.claude.use); },
    headers(token) { return { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' }; },
    async req(path, method, body, token) {
      const r = await fetch('https://api.github.com' + path, { method: method || 'GET', headers: this.headers(token || state.settings.gistToken), body: body ? JSON.stringify(body) : undefined });
      if (!r.ok) { const e = new Error(r.status === 401 ? 'GitHub rejected the token' : r.status === 404 ? 'not found' : 'GitHub error ' + r.status); e.status = r.status; throw e; }
      return r.json();
    },
    schedule() { if (!this.available()) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.backup(), 15000); },
    async backup() {
      if (!this.available()) return false;
      if (this.busy) { this.again = true; return false; }
      this.busy = true;
      try {
        const stamp = Date.now();
        const content = backupJSON();
        if (state.settings.gistId) {
          try { await this.req('/gists/' + state.settings.gistId, 'PATCH', { files: { 'readyset-backup.json': { content } } }); }
          catch (e) { if (e.status === 404) { state.settings.gistId = null; this.busy = false; return this.backup(); } throw e; }
        } else {
          const g = await this.req('/gists', 'POST', { description: 'Readyset backup', public: false, files: { 'readyset-backup.json': { content } } });
          state.settings.gistId = g.id;
        }
        state.lastCloudBackup = stamp; state.cloudError = null; state.lastBackupAt = stamp; state.lastBackupKind = 'cloud'; Store.saveLocal(state);
      } catch (e) { state.cloudError = (e && e.message) || 'backup failed'; Store.saveLocal(state); }
      this.busy = false;
      if (this.again) { this.again = false; this.schedule(); }
      // Never rebuild the page under the user's fingers: no re-render during a session or while typing.
      const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if ((view === 'settings' || view === 'today') && !state.current && !typing) render();
      return !state.cloudError;
    },
    async restore(token) {
      const list = await this.req('/gists?per_page=100', 'GET', null, token);
      const mine = (Array.isArray(list) ? list : []).filter(x => x && x.description === 'Readyset backup' && x.files && x.files['readyset-backup.json'] && /^[a-f0-9]{8,64}$/.test(String(x.id)));
      mine.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
      const g = mine[0];
      if (!g) throw new Error('No Readyset backup found in this account');
      const full = await this.req('/gists/' + g.id, 'GET', null, token);
      const f = full.files['readyset-backup.json'];
      let content = f.content;
      if (f.truncated) {
        const u = new URL(String(f.raw_url));
        if (u.protocol !== 'https:' || u.host !== 'gist.githubusercontent.com') throw new Error('That backup is not readable');
        content = await (await fetch(u.href)).text();
      }
      if (typeof content !== 'string' || content.length > 20e6) throw new Error('That backup is too large');
      const obj = JSON.parse(content);
      if (!obj || typeof obj !== 'object' || !obj.settings || !obj.program) throw new Error('That backup is not readable');
      return { obj, gistId: g.id };
    },
  };
  async function connectCloud(token, restoreFirst) {
    token = (token || '').trim(); if (!token) { toast('Paste a token first'); return; }
    ui.cloudBusy = true; render();
    try {
      if (restoreFirst) {
        const r = await Cloud.restore(token);
        const fresh = cleanState(r.obj, false); // the backup is untrusted: it can carry no token, gist id or undo
        fresh.settings.gistToken = token; fresh.settings.gistId = r.gistId; fresh.current = null;
        if (!fresh.setupDone) throw new Error('That backup has no maxes in it');
        stopTimer(); state = fresh; migrate(); Store.pushAll(state);
        state.lastBackupAt = Date.now(); state.lastBackupKind = 'cloud'; state.lastCloudBackup = Date.now();
        ui.cloudBusy = false; ui.setupRestore = false; ui.checkin = null; ui.confirm = null; save(); toast('Restored from your cloud backup'); render(); return;
      }
      state.settings.gistToken = token; state.cloudError = null; save();
      await Cloud.backup();
      ui.cloudBusy = false;
      if (state.cloudError) toast(state.cloudError); else toast('Cloud backup on');
      render();
    } catch (e) { ui.cloudBusy = false; toast((e && e.message) || 'Could not reach GitHub'); render(); }
  }
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
  window.addEventListener('orientationchange', () => setTimeout(fitBottom, 250));
  try { if (window.ResizeObserver) new ResizeObserver(() => fitBottom()).observe(document.documentElement); } catch (e) { /* events above still cover it */ }
  function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2200); }

  // ---------- Audio / vibration for the rest timer ----------
  let audioCtx = null;
  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination); o.frequency.value = 880; g.gain.value = 0.15;
      o.start(); o.stop(audioCtx.currentTime + 0.25);
      setTimeout(() => { const o2 = audioCtx.createOscillator(), g2 = audioCtx.createGain(); o2.connect(g2); g2.connect(audioCtx.destination); o2.frequency.value = 1175; g2.gain.value = 0.15; o2.start(); o2.stop(audioCtx.currentTime + 0.3); }, 300);
    } catch (e) { /* no audio */ }
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) { /* no vibration */ }
  }
  function unlockAudio() { try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) { /* ignore */ } }

  // ---------- Rest timer (persisted, so closing the app mid-rest loses nothing) ----------
  function startTimer(seconds, label) {
    stopTimer();
    const end = Date.now() + seconds * 1000;
    state.timer = { end, total: seconds, label: label || '' };
    ui.timer = { end, total: seconds, fired: false, iv: setInterval(tickTimer, 250) };
    tickTimer();
  }
  function resumeTimer() {
    const t = state.timer; if (!t || !state.current) return;
    if (Date.now() - t.end > 15 * 60000) { state.timer = null; return; } // long gone: forget it
    ui.timer = { end: t.end, total: t.total, fired: Date.now() >= t.end, iv: setInterval(tickTimer, 250) };
    tickTimer();
  }
  function stopTimer() { if (ui.timer) clearInterval(ui.timer.iv); ui.timer = null; if (state && state.timer) { state.timer = null; } const el = $('#timer'); if (el) el.remove(); }
  function tickTimer() {
    if (!ui.timer) return;
    let el = $('#timer');
    if (!el) { el = document.createElement('div'); el.id = 'timer'; el.className = 'timer'; document.body.appendChild(el); }
    const left = Math.ceil((ui.timer.end - Date.now()) / 1000);
    if (left <= 0 && !ui.timer.fired) { ui.timer.fired = true; beep(); notifyRestDone(); }
    el.classList.toggle('over', left <= 0);
    const a = Math.abs(left), txt = left <= 0 ? `Rest done ${a >= 60 ? '+' + Math.floor(a / 60) + ':' + String(a % 60).padStart(2, '0') : '+' + a + 's'}` : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    if (!el.firstChild) el.innerHTML = `<span></span><button data-action="timer-add">+30s</button><button data-action="timer-stop">Done</button>`;
    if (el.firstChild.textContent !== txt) el.firstChild.textContent = txt; // update text only, so a tap mid-tick still lands on its button
    if (left <= -900) { stopTimer(); save(); }
  }
  // Notifications: best effort. iOS shows them only for a home-screen web app, and only while the
  // app is still running; nothing can fire while iOS has suspended it.
  function enableNotify() {
    if (!('Notification' in window)) { toast('Notifications are not available in this browser'); state.settings.notify = false; render(); return; }
    Notification.requestPermission().then(p => {
      state.settings.notify = p === 'granted';
      if (p !== 'granted') toast('Notifications were not allowed');
      save(); render();
    }).catch(() => { state.settings.notify = false; save(); render(); });
  }
  function notifyRestDone() {
    try {
      if (!state.settings.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
      const t = state.timer, body = t && t.label ? `Next set: ${t.label}` : 'Next set';
      const opts = { body, tag: 'readyset-rest', renotify: true, silent: false };
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
        navigator.serviceWorker.getRegistration().then(reg => { if (reg && reg.showNotification) reg.showNotification('Rest done', opts); else new Notification('Rest done', opts); }).catch(() => { try { new Notification('Rest done', opts); } catch (e) { /* ignore */ } });
      } else new Notification('Rest done', opts);
    } catch (e) { /* notifications unavailable */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && ui.timer) tickTimer(); });

  // ---------- Wake lock ----------
  let wakeLock = null;
  async function keepAwake() { try { if (navigator.wakeLock && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) { wakeLock = null; } }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state && state.current) keepAwake(); });

  // ---------- Helpers ----------
  function lbl(n) { return n == null ? '—' : String(n); }
  function pctLabel(e) { return e.pctTM != null ? Math.round(e.pctTM * 100) + '% TM' : ''; }
  // The sessions the reviews read: this block's training sessions, not deload or easy-week ones, and
  // not those logged before an inserted deload (the block resumes at the same week afterwards).
  function inBlock(s) { const P = state.program; return s.mesoCount === P.mesoCount && s.blockIdx === P.blockIdx && !s.isRest && !s.isDeload && !(P.chronicSince && (s.ts || 0) < P.chronicSince); }
  function sessionsOfWeek() { const P = state.program; return state.sessions.filter(s => inBlock(s) && s.week === P.week); }
  function sessionsOfMeso() { return state.sessions.filter(inBlock); }
  function newestSessionDate() { let d = null; for (const s of state.sessions) if (!d || s.date > d) d = s.date; return d; }
  function lastSession() { for (let i = state.sessions.length - 1; i >= 0; i--) if (!state.sessions[i].skipped) return state.sessions[i]; return null; }
  function plateText(w) {
    const r = E.plateLoad(w, state.settings.barWeight, state.settings.plates);
    if (w <= state.settings.barWeight) return 'Empty bar';
    const counts = {}; r.plates.forEach(p => counts[p] = (counts[p] || 0) + 1);
    const parts = Object.keys(counts).sort((a, b) => b - a).map(p => counts[p] > 1 ? `${p}×${counts[p]}` : `${p}`);
    return (parts.length ? parts.join(' · ') + ' per side' : 'Empty bar') + (r.exact ? '' : ` (${r.short * 2} lb short)`);
  }
  // One-line summary of an exercise's working sets (warm-ups excluded).
  function summ(e) {
    const work = e.sets.filter(x => x.kind !== 'warm' && x.kind !== 'single'), f = work[0] || e.sets[0];
    const opener = e.sets.find(x => x.kind === 'single');
    return `${esc(e.name)} ${work.length}×${f.reps}${f.w ? ' @ ' + f.w : ''}${opener ? ` (opener ${opener.w})` : ''}`;
  }
  function platesShort(w) {
    if (w <= state.settings.barWeight) return 'bar';
    const r = E.plateLoad(w, state.settings.barWeight, state.settings.plates), counts = {};
    r.plates.forEach(p => counts[p] = (counts[p] || 0) + 1);
    return Object.keys(counts).sort((a, b) => b - a).map(p => counts[p] > 1 ? `${p}×${counts[p]}` : `${p}`).join('+') + ' /side';
  }
  function hr(v) { const h = Math.floor(v / 60), m = v % 60; return h ? `${h}h ${m ? m + 'm' : ''}`.trim() : `${m}m`; }

  // ---------- Views ----------
  // The content area between the header and the tab bar is the only thing that scrolls (see
  // styles.css): the tab bar sits outside it, so iOS delivers taps on it even mid-glide.
  function scroller() { return document.getElementById('scroller') || document.scrollingElement || document.documentElement; }
  function scrollToY(y) { const sc = scroller(); sc.scrollTop = Math.max(0, y || 0); }
  let anchor = null; // { sel, fallback, top }: the element a tap came from, held still across a re-render
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
    main.innerHTML = (state.current ? '' : renderUndo()) + (view === 'settings' ? renderRestoreConfirm() : '') + (view === 'today' ? renderToday() : view === 'program' ? renderProgram() : view === 'history' ? renderHistory() : renderSettings());
    // Keep whatever you just tapped exactly where it was on screen, even when text above it grew,
    // shrank or folded away (iOS Safari has no scroll anchoring of its own).
    if (anchor) {
      let el = document.querySelector(anchor.sel), was = anchor.top;
      if (!el) { el = document.querySelector(anchor.fallback); was = anchor.fallbackTop; }
      if (el) { const dy = el.getBoundingClientRect().top - was; if (Math.abs(dy) >= 1) scroller().scrollTop += dy; }
      anchor = null;
    }
    if (view === 'history') requestAnimationFrame(drawCharts);
    if (view === 'today' && state.current && state.current.phase === 'cardio' && ui.cardioRun) requestAnimationFrame(tickCardio);
  }

  // ---------- Setup wizard ----------
  function draft() {
    if (!ui.draft) {
      const s = state.settings;
      ui.draft = { name: s.name || '', squat: state.lifts.squat.oneRM || '', bench: state.lifts.bench.oneRM || '', deadlift: state.lifts.deadlift.oneRM || '', calc: {}, tmPct: s.tmPct, barWeight: s.barWeight, plates: s.plates.slice(), dbIncrement: s.dbIncrement, days: s.days.slice(), cardioMin: s.cardioMin, cardioWatts: s.cardioWatts, deadliftStyle: s.deadliftStyle, squatStyle: s.squatStyle || 'lowbar', easyWeek: true, includePeak: s.includePeak === true };
    }
    return ui.draft;
  }
  function renderSetup() {
    const d = draft(), step = ui.setupStep;
    const steps = `<div class="steps">${[0, 1, 2, 3].map(i => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>`;
    if (step === 0) return `
      <div class="card"><h1>Readyset</h1>
      <p>A four-day powerlifting program that reads how you are recovering and adjusts itself, built on the Renaissance Periodization training principles.</p>
      <p class="muted small">Setup takes about two minutes: your current maxes, your equipment, your training days.</p>
      ${steps}
      <label class="f">Your name (optional)<input id="d-name" data-draft="name" value="${esc(d.name)}" placeholder="Jerm"></label>
      <button class="btn primary block" data-action="setup-next">Start</button>
      <button class="btn quiet block" data-action="setup-restore">Already have a backup? Restore it</button>
      ${ui.setupRestore ? `<div class="stack">
        ${filePick('Restore from a backup file', 'primary')}
        <label class="f">Or paste backup text<textarea id="import-text" rows="3"></textarea></label><button class="btn" data-action="import">Restore from text</button>
        ${!(window.claude && window.claude.use) ? `<label class="f">Or your GitHub token for cloud backup<input id="gist-token" type="password" autocomplete="off" placeholder="github_pat_…"></label><button class="btn" data-action="cloud-restore" ${ui.cloudBusy ? 'disabled' : ''}>Restore from cloud</button>` : ''}
      </div>` : ''}</div>`;
    if (step === 1) return `
      <div class="card"><h2>Current maxes</h2>
      <p class="small muted">Enter a recent 1RM, or tap "from a set" and enter a recent hard set. Use a clean set with a rep or two left, not a grinder; grinders overestimate. The program works off a Training Max of ${Math.round(d.tmPct * 100)}% of these numbers and then calibrates them from your sets after every session, so a rough, conservative start is fine.</p>
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
      <p class="small muted">These are your competition lifts. The other bar position shows up as a variation.</p>
      <div class="btnrow"><button class="btn" data-action="setup-back">Back</button><button class="btn primary" data-action="setup-next">Next</button></div></div>`;
    if (step === 2) return `
      <div class="card"><h2>Equipment</h2>${steps}
      <label class="f">Bar weight (lb)<input id="d-bar" type="number" inputmode="decimal" data-draft="barWeight" value="${esc(d.barWeight)}"></label>
      <div class="stack"><span class="tiny">Plates you own (per side)</span>
        <div class="chips">${[55, 45, 35, 25, 15, 10, 5, 2.5, 1.25].map(p => `<button data-action="setup-plate" data-p="${p}" aria-pressed="${d.plates.includes(p)}">${p}</button>`).join('')}</div>
        <p class="small muted">Barbell loads round to ${d.plates.includes(1.25) ? 2.5 : d.plates.includes(2.5) ? 5 : 10} lb jumps based on your smallest plate.</p></div>
      <label class="f">Dumbbell step (lb)<select id="d-dbi" data-draft="dbIncrement"><option value="2.5" ${d.dbIncrement == 2.5 ? 'selected' : ''}>2.5</option><option value="5" ${d.dbIncrement == 5 ? 'selected' : ''}>5</option></select></label>
      <p class="small muted">The plan assumes: power rack, bench, barbell, adjustable dumbbells, belt squat, lat pulldown / low row, seated leg curl, leg extension. Swap anything from the Program tab later.</p>
      <div class="btnrow"><button class="btn" data-action="setup-back">Back</button><button class="btn primary" data-action="setup-next">Next</button></div></div>`;
    return `
      <div class="card"><h2>Schedule</h2>${steps}
      <div class="stack"><span class="tiny">Training days (pick 4, two rest days back to back works best)</span>
        <div class="chips">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => `<button data-action="setup-day" data-d="${x}" aria-pressed="${d.days.includes(x)}">${x}</button>`).join('')}</div></div>
      <div class="grid2">
        <label class="f">Easy bike after lifting (min)<input id="d-cm" type="number" inputmode="numeric" data-draft="cardioMin" value="${esc(d.cardioMin)}"></label>
        <label class="f">Usual easy watts (optional)<input id="d-cw" type="number" inputmode="numeric" data-draft="cardioWatts" value="${esc(d.cardioWatts)}"></label>
      </div>
      <p class="small muted">The book's guideline is to keep extra cardio under about 1,500 kcal a week and truly easy, and to judge it by whether the lifts keep moving. The app keeps a running weekly estimate so you can see where you stand.</p>
      <label class="row" style="gap:10px;font-weight:600"><input type="checkbox" id="d-easy" data-draft="easyWeek" ${d.easyWeek ? 'checked' : ''} style="width:22px;height:22px"> Start with one easy week first <span class="muted small" style="font-weight:500">(recommended if you are coming off a program that beat you up)</span></label>
      <label class="row" style="gap:10px;font-weight:600"><input type="checkbox" id="d-peak" data-draft="includePeak" ${d.includePeak ? 'checked' : ''} style="width:22px;height:22px"> Include the 3-week Peak &amp; Test block <span class="muted small" style="font-weight:500">(heavy singles and a test week at the end of each macro; off is the default, since the Strength block already opens with singles and the maxes calibrate from every session)</span></label>
      <div class="btnrow"><button class="btn" data-action="setup-back">Back</button><button class="btn primary" data-action="setup-finish">Build my program</button></div></div>`;
  }
  function finishSetup() {
    const d = draft();
    const bad = LIFTS.filter(l => !(Number(d[l]) > 0));
    if (bad.length) { toast(`Enter a ${LIFTNAME[bad[0]]} max first`); ui.setupStep = 1; render(); return; }
    if (d.days.length !== 4) { toast('Pick exactly four training days'); render(); return; }
    const s = state.settings;
    s.name = d.name.trim(); s.tmPct = Number(d.tmPct); s.barWeight = Number(d.barWeight) || 45; s.plates = d.plates.slice().sort((a, b) => b - a);
    s.increment = d.plates.includes(1.25) ? 2.5 : d.plates.includes(2.5) ? 5 : 10; s.dbIncrement = Number(d.dbIncrement); s.days = d.days.slice();
    s.cardioMin = Math.max(0, Number(d.cardioMin) || 0); s.cardioWatts = Number(d.cardioWatts) || 110; s.deadliftStyle = d.deadliftStyle; s.squatStyle = d.squatStyle; s.includePeak = !!d.includePeak;
    for (const l of LIFTS) E.applyTM(state, l, Number(d[l]));
    state.program.startedAt = todayISO();
    if (d.easyWeek) E.startActiveRest(state, 1);
    state.setupDone = true; state.migratedV2 = true; // a fresh program has nothing to migrate
    addLog(`Program started. 1RMs: squat ${state.lifts.squat.oneRM}, bench ${state.lifts.bench.oneRM}, deadlift ${state.lifts.deadlift.oneRM}. Training maxes at ${Math.round(s.tmPct * 100)}%.`);
    ui.draft = null; save(); render();
  }

  // ---------- Today ----------
  function renderToday() {
    if (state.current) {
      if (state.current.phase === 'lift' || state.current.phase === 'edit') return renderSession();
      if (state.current.phase === 'post') return renderPost();
      if (state.current.phase === 'cardio') return renderCardio();
    }
    if (ui.checkin) return renderCheckin();
    const pos = E.positionLabel(state), P = state.program;
    const plan = E.buildSession(state, 'full');
    const last = lastSession();
    let html = '';
    if (!Store.db && sessionsSinceBackup() >= 1 && !(state.settings.gistToken && !state.cloudError)) html += `<div class="callout bad row between"><span>${sessionsSinceBackup()} session${sessionsSinceBackup() > 1 ? 's' : ''} not backed up.${state.settings.gistToken ? ' Cloud backup failed.' : ''}</span><button class="btn sm" data-action="share-backup">Save backup</button></div>`;
    if (state.lastReport) html += `<div class="card"><div class="row between"><h3>${esc(state.lastReport.title)}</h3><button class="btn sm quiet" data-action="dismiss-report">Dismiss</button></div>${state.lastReport.lines.map(l => `<div class="callout ${l.includes('-1 set') || l.includes('easing') ? 'warn' : l.includes('+1 set') || l.includes('->') ? 'good' : ''}">${esc(l)}</div>`).join('')}</div>`;
    if (P.pendingDeload) html += `<div class="card"><h3>Deload suggested</h3><p>Fatigue signals stacked up this week (the review on the Program tab says which). The book's rule is to take the deload now rather than grind into it; the block picks up where it left off afterwards. Your call.</p><div class="btnrow"><button class="btn primary" data-action="deload-now">Deload this week</button><button class="btn" data-action="deload-later">Push on</button></div></div>`;
    if (P.lightRestOfWeek) html += `<div class="callout warn">Rest of this week is set to light sessions (two red check-ins). Loads and sets come down automatically; the week still counts.</div>`;
    else if (P.pushOn) html += `<div class="callout warn">Pushing on past a deload suggestion: this week runs without bonus reps or earned sets, loads one step down. If it still feels heavy, "Deload now" is on the Program tab.</div>`;
    // Coming back after a gap: offer the layoff rule once per gap (the book: ease back in, do not
    // resume where you left off, p.250).
    const newest = newestSessionDate(), gap = newest ? daysBetween(newest, todayISO()) : 0;
    if (gap >= 7 && P.layoffHandled !== newest && !pos.isRest && !pos.isDeload) {
      const what = gap < 14 ? 'repeat this week 5% lighter with earned sets cleared' : gap < 21 ? 'restart this block at week 1 with maxes 5% lower' : 'start again from Build week 1 with maxes 10% lower (they recalibrate from your sets)';
      html += `<div class="card"><h3>${gap} days since your last session</h3><p>Coming back at the old loads after a layoff is how people get hurt. The program's rule for ${gap} days off: ${what}.</p>
        <div class="btnrow"><button class="btn primary" data-action="layoff-ease">Ease back in</button><button class="btn" data-action="layoff-skip">Carry on as planned</button></div></div>`;
    }
    const nameHi = state.settings.name ? `, ${esc(state.settings.name)}` : '';
    html += `<div class="card accent">
      <div class="tiny">${pos.isRest ? 'Easy week' : pos.isDeload ? 'Deload week' : pos.isTest ? 'Test week' : `${esc(pos.block.name)} block · ${esc(pos.label)}`}</div>
      <h1>${esc(plan.dayName)}</h1>
      <div class="row between"><span>About ${plan.estMinutes} min of lifting${plan.cardioMin ? ` + ${plan.cardioMin} min easy bike` : ''}</span></div>
      <div class="small">${plan.exercises.map(summ).join(' · ')}</div>
      <button class="btn block" style="background:var(--accent-fg);color:var(--accent);border:0" data-action="checkin">Check in and start</button>
      <div class="row between small"><button class="btn sm quiet" style="color:inherit" data-action="skip-session">Skip this session</button><span class="muted">Today ${fmtDateLong(todayISO())}</span></div>
    </div>`;
    html += renderBackfill(plan);
    if (last) {
      const d = daysBetween(last.date, todayISO());
      html += `<div class="card"><h3>Last session</h3><div class="row between"><div><b>${esc(last.dayName)}</b> <span class="muted small">${fmtDate(last.date)}${d === 0 ? ' (today)' : d === 1 ? ' (yesterday)' : ` (${d} days ago)`}</span></div>${last.readiness ? `<span class="pill ${last.readiness.color}">${last.readiness.score} ready</span>` : ''}</div>
        <div class="small muted">${last.post ? DIFF[last.post.difficulty] : ''}${last.durationMin ? ` · ${last.durationMin} min` : ''}${last.cardio && last.cardio.min ? ` · bike ${last.cardio.min} min` : ''}${last.mode && last.mode !== 'full' && E.MODES[last.mode] ? ` · ${E.MODES[last.mode].label}` : ''}</div></div>`;
    }
    html += renderWeekBrief();
    return html;
  }
  // Logging a session after the fact: the next planned session, dated back, with no check-in or
  // timer. It then goes through exactly the same completion, calibration and review as a live one.
  function renderBackfill(plan) {
    const b = ui.backfill;
    if (!b) return `<div class="row between small" style="margin:-4px 2px 10px"><span class="muted">Trained but forgot to log it?</span><button class="btn sm quiet" data-action="backfill-open">Log a past session</button></div>`;
    const y = new Date(); y.setDate(y.getDate() - 1);
    const minDate = new Date(); minDate.setDate(minDate.getDate() - 60);
    return `<div class="card"><h3>Log a past session</h3>
      <p class="small muted">This logs <b>${esc(plan.dayName)}</b>, the next session in the plan, on the date you pick. Enter what you lifted; it counts in the week's review and the maxes calibrate from it like any other session.</p>
      <div class="grid2"><label class="f">Date<input id="bf-date" type="date" value="${esc(b.date)}" max="${todayISO()}" min="${todayISO(minDate)}" data-backfill="date"></label>
      <label class="f">How it was run<select id="bf-mode" data-backfill="mode">${['full', 'trim', 'light'].map(m => `<option value="${m}" ${b.mode === m ? 'selected' : ''}>${E.MODES[m].label}</option>`).join('')}</select></label></div>
      <div class="btnrow"><button class="btn primary" data-action="backfill-start">Open the session</button><button class="btn" data-action="backfill-cancel">Cancel</button></div></div>`;
  }
  function startBackfill() {
    const b = ui.backfill; if (!b) return;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : null;
    if (!date || date > todayISO() || daysBetween(date, todayISO()) > 60) { toast('Pick a date within the last 60 days'); return; }
    const mode = E.MODES[b.mode] ? b.mode : 'full';
    ui.backfill = null;
    startSession(mode, { date });
  }
  function renderWeekBrief() {
    const P = state.program, pos = E.positionLabel(state);
    const done = sessionsOfWeek();
    const dots = E.DAYS.map((d, i) => { const s = done.find(x => x.dayIdx === i); return `<span class="pill ${s ? (s.skipped ? '' : 'green') : i === P.dayIdx ? 'accent' : ''}">${d.id}</span>`; }).join(' ');
    const sets = LIFTS.map(l => `<div class="kpi"><span class="tiny">${LIFTNAME[l]} sets</span><span class="v num">${E.weeklySets(state, l)}<small>/ ${E.CAPS[l]}</small></span></div>`).join('');
    const kcal = weekCardio();
    return `<div class="card"><div class="row between"><h3>This week</h3><div class="row" style="gap:4px">${dots}</div></div>
      <div class="grid3">${sets}</div>
      <div class="row between small"><span class="muted">Easy cardio this week</span><span class="num"><b>${kcal.min} min</b> · ~${kcal.kcal} kcal of a 1,500 guideline</span></div>
      <div class="bar"><i style="width:${Math.min(100, kcal.kcal / 15)}%;background:${kcal.kcal > 1500 ? 'var(--warn)' : 'var(--accent)'}"></i></div></div>`;
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
    ui.checkin = { sleep: 0, energy: 0, motivation: 0, groups: { legs: 0, push: 0, hinge: 0 }, askGroups: !!last && !last.soreness, result: null, choice: null };
    render();
  }
  function renderCheckin() {
    const c = ui.checkin;
    const seg = (key, labels) => `<div class="seg">${labels.map((t, i) => `<button data-action="ci" data-k="${key}" data-v="${i + 1}" aria-pressed="${(key.includes(':') ? c.groups[key.split(':')[1]] : c[key]) === i + 1}">${i + 1}<small>${t}</small></button>`).join('')}</div>`;
    if (c.result) {
      const r = c.result, pos = E.positionLabel(state);
      const lightWeek = pos.isDeload || pos.isRest || pos.isTest;
      const plan = E.buildSession(state, c.choice || r.mode);
      const explain = lightWeek ? `${pos.isRest ? 'Easy week' : pos.isDeload ? 'Deload week' : 'Test week'}: this session is already as light as the program gets, so readiness is recorded for your trend but doesn't change it.${r.color === 'red' ? ' If you feel genuinely wrecked, resting today and keeping the session is fine.' : ''}`
        : state.program.lightRestOfWeek ? 'The rest of this week is set to light sessions after two red check-ins, so today runs light whatever the score. Readiness is recorded for your trend.'
        : state.program.pushOn ? 'You chose to push on past a deload suggestion, so this week runs trimmed whatever the score: no bonus reps or earned sets, loads one step down.'
        : r.color === 'green' ? 'Good to go. Loads and sets as planned, and the first set of each main lift can take bonus reps if it moves well.'
        : r.color === 'yellow' ? 'So-so day. The book\'s rule: most days like this still allow an overload, so the session stands, trimmed: loads one step down (2.5%), no bonus reps, no earned extra sets. Same reps, same number of planned sets.'
        : 'Rough day. Grinding a planned overload through this is the fatigue trap. A light session (fewer sets, lighter loads) clears fatigue better than a day off and keeps the week on track.';
      return `<div class="card">
        <div class="row between"><h2>Readiness ${r.score}</h2><span class="pill ${r.color}">${r.color === 'green' ? 'Green' : r.color === 'yellow' ? 'Yellow' : 'Red'}</span></div>
        <p>${explain}</p>
        ${r.color === 'red' && lightWeek ? `<button class="btn block" data-action="ci-rest">Rest today, keep this session for next time</button>` : ''}
        ${r.color === 'red' && !lightWeek ? `<div class="seg wrap">
            <button data-action="ci-choice" data-v="light" aria-pressed="${c.choice === 'light'}">Light session<small>recommended</small></button>
            <button data-action="ci-choice" data-v="full" aria-pressed="${c.choice === 'full'}">As planned<small>if you know it's not fatigue</small></button>
          </div>
          <button class="btn block" data-action="ci-rest">Rest today, keep this session for next time</button>` : ''}
        <div class="callout">${esc(plan.dayName)} · ${plan.exercises.map(summ).join(' · ')} · about ${plan.estMinutes} min</div>
        <div class="btnrow"><button class="btn" data-action="ci-back">Back</button><button class="btn primary" data-action="start-session" data-mode="${c.choice || r.mode}">Start ${E.MODES[c.choice || r.mode].label.toLowerCase()}</button></div>
      </div>`;
    }
    return `<div class="card">
      <h2>Check in</h2><p class="small muted">Be honest, then trust the plan. This takes six taps.</p>
      ${c.askGroups ? `<div class="q"><span class="label">How are you feeling since the last session?</span>
        ${['legs|Legs', 'push|Chest, shoulders, arms', 'hinge|Lower back, hips, hamstrings'].map(x => { const [k, t] = x.split('|'); return `<span class="tiny">${t}</span>${seg('g:' + k, ['Fresh', 'A bit', 'Sore', 'Very sore'])}`; }).join('')}</div>` :
        `<div class="q"><span class="label">How beat up do you feel overall?</span>${seg('g:legs', ['Fresh', 'A bit', 'Sore', 'Very sore'])}</div>`}
      <div class="q"><span class="label">Sleep last night</span>${seg('sleep', ['Awful', 'Poor', 'OK', 'Good', 'Great'])}</div>
      <div class="q"><span class="label">Energy and mood</span>${seg('energy', ['Drained', 'Low', 'OK', 'Good', 'Fresh'])}</div>
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
  function startSession(mode, back) {
    const c = back ? null : ui.checkin, P = state.program;
    const sess = E.buildSession(state, mode);
    const pos = E.position(state);
    const planNotes = Array.isArray(sess.notes) ? sess.notes : [];
    Object.assign(sess, { id: 's_' + Date.now(), ts: Date.now(), date: todayISO(), phase: 'lift', startedAt: Date.now(), readiness: c ? c.result : null, mesoCount: P.mesoCount, blockIdx: P.blockIdx, dayIdx: P.dayIdx, notes: '', planNotes, skippedSlots: [] });
    if (back) { sess.backfill = true; sess.date = back.date; sess.ts = dayTs(back.date); }
    if (c && c.result) { delete sess.readiness.mode; }
    sess.exercises.forEach(e => { e.sets.forEach(x => { x.done = false; x.actualReps = null; x.rpe = null; x.actualW = null; }); const w0 = e.sets.find(x => x.kind === 'work'); if (w0 && e.lift) e.plannedW = w0.w; });
    state.current = sess; ui.checkin = null; ui.lastEi = null; ui.openWarm = {}; ui.editSets = {}; ui.lastDeleted = null; ui.todayScroll = 0;
    if (c && c.result && c.result.color === 'red') {
      const redsThisWeek = sessionsOfWeek().filter(s => s.readiness && s.readiness.color === 'red').length + 1;
      if (redsThisWeek >= 2 && !P.lightRestOfWeek && !pos.isDeload && !pos.isRest && P.dayIdx < 3) { P.lightRestOfWeek = true; sess.setLightRest = true; addLog('Second red check-in this week: remaining sessions switched to light (the book: light sessions, not an unplanned deload).'); }
    }
    unlockAudio(); keepAwake(); save(); render(); scrollToY(0);
  }
  function restToday() { ui.checkin = null; addLog('Rested instead of training; the session stays queued.'); save(); render(); }
  // General undo: snapshot everything a program-level action can change (position, maxes, learned
  // set counts, the report and log) before the action, and offer one Undo until the next session.
  function snapshot(label, extra) {
    state.undo = Object.assign({ label, snap: JSON.stringify({ program: state.program, lifts: state.lifts, learned: state.learned, lastReport: state.lastReport || null, logLen: state.log.length }) }, extra || {});
  }
  function undoLast() {
    const u = state.undo; if (!u) return;
    let snap; try { snap = JSON.parse(u.snap); } catch (e) { state.undo = null; save(); render(); return; }
    // The snapshot goes through the same sanitizer as any stored state before it is restored.
    const clean = E.sanitizeState({ settings: state.settings, lifts: snap.lifts, program: snap.program, learned: snap.learned, lastReport: snap.lastReport, setupDone: true }, { trusted: false });
    state.program = clean.program; state.lifts = clean.lifts; state.learned = clean.learned; state.lastReport = clean.lastReport;
    const logLen = Number.isFinite(snap.logLen) ? Math.max(0, snap.logLen) : state.log.length;
    state.log.splice(0, Math.max(0, state.log.length - logLen));
    if (u.removeSessionId) { const i = state.sessions.findIndex(x => x.id === u.removeSessionId); if (i >= 0) { state.sessions.splice(i, 1); Store.deleteSession(u.removeSessionId); } }
    if (u.restoreSession) { state.sessions.push(u.restoreSession); state.sessions.sort((a, b) => (a.ts || 0) - (b.ts || 0)); Store.pushSession(u.restoreSession); }
    state.undo = null;
    save(); render(); toast(`Undone: ${u.label}`);
  }
  function renderUndo() { return state.undo ? `<div class="callout warn row between"><span>${esc(state.undo.label)}.</span><button class="btn sm" data-action="undo">Undo</button></div>` : ''; }
  function skipSession() {
    const P = state.program, pos = E.positionLabel(state);
    const s = { id: 's_' + Date.now(), ts: Date.now(), date: todayISO(), skipped: true, dayId: pos.day.id, dayName: pos.day.name, mesoCount: P.mesoCount, blockIdx: P.blockIdx, dayIdx: P.dayIdx, week: P.week, isRest: pos.isRest, isDeload: pos.isDeload, exercises: [] };
    snapshot(`Skipped ${pos.day.name}`, { removeSessionId: s.id });
    state.sessions.push(s); Store.pushSession(s);
    addLog(`Skipped ${pos.day.name}.`);
    afterSession();
    save(); render();
  }

  // ---------- Session ----------
  function renderSession() {
    const s = state.current;
    const doneSets = s.exercises.reduce((n, e) => n + (s.skippedSlots.includes(e.slotKey) ? 0 : e.sets.filter(x => x.done && x.kind !== 'warm').length), 0);
    const totalSets = s.exercises.reduce((n, e) => n + (s.skippedSlots.includes(e.slotKey) ? 0 : e.sets.filter(x => x.kind !== 'warm').length), 0);
    const editing = s.phase === 'edit';
    let html = `<div class="row between"><div><h2>${editing ? 'Editing: ' : ''}${esc(s.dayName)}</h2><div class="small muted">${esc(s.blockName)} · ${s.isDeload ? 'deload' : s.isRest ? 'easy week' : s.isTest ? 'test week' : 'week ' + s.week} · ${E.MODES[s.mode].label}${s.backfill ? ` · logged for ${fmtDate(s.date)}` : ''}</div></div><span class="pill ${s.readiness ? s.readiness.color : ''}">${doneSets}/${totalSets} sets</span></div>`;
    if (editing) html += `<div class="card"><label class="f">Date<input id="edit-date" type="date" value="${esc(s.editDate || s.date)}" max="${todayISO()}" data-edit="date"></label>
      <div class="grid2"><label class="f">Bike after (min)<input id="edit-cardio" type="number" inputmode="numeric" value="${s.cardio && s.cardio.min ? s.cardio.min : ''}" placeholder="0" data-edit="cardio"></label>
      <label class="f">Average watts <span class="opt">optional</span><input id="edit-watts" type="number" inputmode="numeric" value="${s.cardio && s.cardio.watts ? s.cardio.watts : ''}" placeholder="${esc(state.settings.cardioWatts)}" data-edit="watts"></label></div>
      <div class="q"><span class="label">Overall, that session was</span><div class="seg wrap">${[1, 2, 3, 4].map(v => `<button data-action="post-diff" data-v="${v}" aria-pressed="${!!s.post && s.post.difficulty === v}">${DIFF[v]}</button>`).join('')}</div></div>
      <p class="small muted">Tick, untick or retype any set below. Saving replaces the stored session; if it belongs to the current block, the maxes are re-read from the whole block's sessions.</p></div>`;
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
    if (shown.length > 1) html += `<div class="row between session-tools"><span class="small muted">Tap an exercise's arrow to fold it away.</span><button class="btn sm quiet" data-action="fold-all" data-v="${anyOpen ? 'closed' : 'open'}">${anyOpen ? 'Collapse all' : 'Expand all'}</button></div>`;
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
          <div class="meta">${e.role === 'primary' ? 'Main lift' : e.role === 'secondary' ? 'Second lift' : 'Accessory'}${e.optional ? ' · optional' : ''}${e.pctTM != null ? ` · ${pctLabel(e)}` : ''}${e.rpeTarget != null && !s.isTest ? ` · aim RPE ${e.rpeTarget}${e.rpeTarget < 6 ? ', easy' : ''}` : ''}${e.repRange ? ` · ${e.repRange[0]}–${e.repRange[1]} reps, add weight when every set hits ${e.repRange[1]}` : ''}</div></div>
          <div class="ex-tools">${e.optional || skipped ? `<button class="btn sm quiet" data-action="toggle-skip" data-ei="${ei}">${skipped ? 'Undo skip' : 'Skip'}</button>` : ''}${skipped ? '' : `<button class="fold-btn" data-action="ex-fold" data-ei="${ei}" data-v="closed" aria-expanded="true" aria-label="Fold ${esc(e.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg></button>`}</div></div>
        ${e.cue ? `<div class="ex-note">${esc(e.cue)}</div>` : ''}${e.note ? `<div class="ex-note">${esc(e.note)}</div>` : ''}
        ${e.adjNote ? `<div class="ex-note adj" style="color:var(--accent)">${esc(e.adjNote)}</div>` : ''}
        ${!skipped && (e.hitFloor && e.sets.some(x => x.kind === 'work' && !x.done)) ? `<div class="ex-note"><button class="btn sm" data-action="cut-sets" data-ei="${ei}">Cut the remaining sets</button></div>` : ''}
        ${!skipped && e.cut ? `<div class="ex-note"><button class="btn sm quiet" data-action="restore-sets" data-ei="${ei}">Restore ${e.cut} cut set${e.cut > 1 ? 's' : ''}</button></div>` : ''}
        ${skipped ? '' : renderSets(e, ei, ei === cur && !editing ? e.sets.findIndex(x => !x.done) : -1)}
        ${skipped ? '' : `<div class="ex-foot">
          ${e.load === 'bar' && nextW ? `<span class="plates">Next work set <b>${nextW}</b> = ${esc(plateText(nextW))}</span>` : e.load === 'bar' && first && first.w ? `<span class="plates">All work sets done</span>` : e.needsWeight ? `<span class="small muted">${esc(e.startHint || 'Enter a working weight')}</span>` : '<span></span>'}
          <span class="foot-tools">${ui.editSets && ui.editSets[ei] && ui.lastDeleted && ui.lastDeleted.sid === s.id && ui.lastDeleted.ei === ei ? `<button class="btn sm" data-action="undo-del" data-ei="${ei}">Undo delete</button>` : ''}<button class="btn sm ${ui.editSets && ui.editSets[ei] ? 'primary' : 'quiet'}" data-action="edit-sets" data-ei="${ei}">${ui.editSets && ui.editSets[ei] ? 'Done' : 'Edit sets'}</button>${swaps.length && !(ui.editSets && ui.editSets[ei]) ? `<select class="btn sm" data-action="swap" data-ei="${ei}" aria-label="Swap exercise"><option value="">Swap…</option>${swaps.map(x => `<option value="${x}">${esc(E.exerciseName(state, x))}</option>`).join('')}</select>` : ''}</span>
        </div>`}
        ${!skipped && e.load === 'bar' && first && first.w && !s.isTest && e.role !== 'accessory' && !e.sets.some(x => x.kind === 'warm') ? `<details class="warm"><summary class="tiny">Warm-up ramp</summary>${E.warmups(first.w, state.settings.barWeight, state.settings.increment, e.role).map(w => `<span class="num">${w.w} × ${w.reps}</span>`).join('')}</details>` : ''}
      </section>`;
    });
    if (editing) return html + `<div class="card"><label class="f">Notes<textarea id="sess-notes" data-action="notes" rows="2" placeholder="Anything worth remembering">${esc(s.notes)}</textarea></label>
      <button class="btn primary block" data-action="edit-save">Save changes</button>
      <button class="btn quiet block" data-action="edit-cancel">Cancel editing</button></div>`;
    if (sessionComplete(s)) html += `<div class="callout good">Every set is logged. Look over your numbers, fix anything that is off, then tap Finish lifting when you are ready.</div>`;
    html += `<div class="card"><label class="f">Notes<textarea id="sess-notes" data-action="notes" rows="2" placeholder="Anything worth remembering">${esc(s.notes)}</textarea></label>
      <button class="btn primary block" data-action="finish-lifting">Finish lifting</button>
      ${ui.confirm === 'finish' ? `<div class="callout warn">${totalSets - doneSets} sets are not ticked. Finish anyway? <div class="btnrow" style="margin-top:8px"><button class="btn sm primary" data-action="finish-confirm">Yes, finish</button><button class="btn sm" data-action="confirm-cancel">Keep going</button></div></div>` : ''}
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
    const editHint = editingSets ? `<div class="ex-note">Tap × to remove a set you skipped. Removed sets do not count anywhere.</div>` : '';
    return `${editHint}<div class="sets">${warmRow}${e.sets.map((x, si) => {
      if (foldWarm && x.kind === 'warm') return '';
      const w = x.actualW != null ? x.actualW : x.w;
      const reps = x.actualReps != null ? x.actualReps : '';
      const kind = x.kind === 'warm' ? 'warm-up' : x.kind === 'single' ? 'opener' : x.kind === 'test' ? (x.open ? 'top single' : 'single') : x.ind ? `top set` : '';
      return `<div class="set${x.done ? ' done' : ''}${x.kind === 'warm' ? ' is-warm' : ''}${si === nextSi ? ' next' : ''}" data-si="${si}">
        <span class="n">${x.kind === 'warm' ? 'W' : x.kind === 'single' ? 'O' : si + 1 - e.sets.filter((y, j) => j < si && (y.kind === 'warm' || y.kind === 'single')).length}</span>
        <div class="field"><input id="w-${ei}-${si}" type="number" inputmode="decimal" step="${e.load === 'db' ? state.settings.dbIncrement : e.load === 'bw' ? 1 : 2.5}" data-set="w" data-ei="${ei}" data-si="${si}" value="${w == null ? '' : w}" placeholder="${e.load === 'bw' ? 'bw' : '—'}"><span class="u">${e.load === 'bar' && w != null ? esc(platesShort(w)) : e.load === 'bw' ? 'added lb' : e.load === 'db' ? 'lb each' : 'lb'}</span></div>
        <div class="field"><input id="r-${ei}-${si}" type="number" inputmode="numeric" data-set="r" data-ei="${ei}" data-si="${si}" value="${reps}" placeholder="${x.reps}${x.plus ? '+' : ''}"><span class="u">${kind ? `<span class="kind">${kind}</span>` : `reps`}</span></div>
        ${x.kind === 'warm' ? '<span></span>' : `<button class="rpe ${x.rpe == null ? 'empty' : ''}" data-action="rpe" data-ei="${ei}" data-si="${si}" aria-label="RPE">${x.rpe == null ? (x.rpeTarget != null ? `~${x.rpeTarget}` : 'RPE') : x.rpe}</button>`}
        ${editingSets ? `<button class="del" data-action="del-set" data-ei="${ei}" data-si="${si}" aria-label="Delete this set"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` : `<button class="ok" data-action="done" data-ei="${ei}" data-si="${si}" aria-label="${x.done ? 'Undo set' : 'Set done'}"><svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg></button>`}
      </div>`;
    }).join('')}</div>`;
  }
  // Clamp what the set fields accept: a slip of the thumb must not become evidence.
  function cleanW(v) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.min(2000, Math.round(n * 4) / 4) : null; }
  function cleanReps(v) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.min(30, Math.round(n)) : null; }
  function setField(ei, si, which, val, fromTyping) {
    const e = state.current && state.current.exercises[ei], x = e && e.sets[si];
    if (!x) return;
    const before = e.sets.length;
    const v = val === '' || val == null ? null : (which === 'w' ? cleanW(val) : cleanReps(val));
    if (which === 'w') {
      if (x.done) { x.actualW = v; }
      else {
        // A weight you type into an undone set is yours: the auto-correction leaves it alone. On
        // leaving the field (not while typing) it carries to the later undone sets of the same kind
        // that you have not typed into yourself; those remember where it came from, so editing the
        // source again updates them too, and clearing it releases them.
        x.actualW = v; x.manualW = v != null; delete x.carriedFrom;
        if (!fromTyping) e.sets.forEach((y, j) => {
          if (j <= si || y.done || y.kind !== x.kind) return;
          if (!y.manualW || y.carriedFrom === si) { y.actualW = v; y.manualW = v != null; if (v != null) y.carriedFrom = si; else delete y.carriedFrom; }
        });
        if (e.needsWeight && v != null) e.needsWeight = false;
        if (!fromTyping) recalcExercise(ei, true);
      }
    } else x.actualReps = v;
    if (x.done) recalcExercise(ei, fromTyping, fromTyping);
    save();
    // The fatigue stop removed sets: the rows on screen no longer match, so redraw now.
    if (e.sets.length !== before) { render(); return; }
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
    });
    const sec = document.querySelector(`.ex[data-ei="${ei}"]`); if (!sec) return;
    const note = sec.querySelector('.ex-note.adj'); if (note) note.textContent = e.adjNote || ''; else if (e.adjNote) { const d = document.createElement('div'); d.className = 'ex-note adj'; d.style.color = 'var(--accent)'; d.textContent = e.adjNote; const head = sec.querySelector('.ex-head'); head && head.insertAdjacentElement('afterend', d); }
    const nextSet = e.sets.find(x => !x.done && x.kind !== 'warm' && (x.actualW != null || x.w != null));
    const nextW = nextSet ? (nextSet.actualW != null ? nextSet.actualW : nextSet.w) : null;
    const foot = sec.querySelector('.plates'); if (foot && e.load === 'bar') foot.innerHTML = nextW ? `Next work set <b>${nextW}</b> = ${esc(plateText(nextW))}` : 'All work sets done';
  }
  // Every set of every exercise you are doing is ticked (skipped exercises do not count).
  function sessionComplete(s) {
    return !!s && s.phase === 'lift' && s.exercises.every(e => s.skippedSlots.includes(e.slotKey) || e.sets.every(x => x.done));
  }
  // After any change to the sets: when nothing is left to lift, there is nothing to rest for.
  function afterSetChange() { if (sessionComplete(state.current)) stopTimer(); }
  function markDone(ei, si) {
    const e = state.current.exercises[ei], x = e.sets[si];
    const wEl = $(`#w-${ei}-${si}`), rEl = $(`#r-${ei}-${si}`);
    if (wEl && wEl.value !== '') x.actualW = cleanW(wEl.value); else if (x.actualW == null && x.w != null) x.actualW = x.w;
    if (rEl && rEl.value !== '') x.actualReps = cleanReps(rEl.value); else if (x.actualReps == null) x.actualReps = x.reps;
    if (x.actualReps == null) x.actualReps = x.reps;
    if (x.actualW == null && e.load !== 'bw') { toast('Enter the weight first'); wEl && wEl.focus(); return false; }
    x.done = true; x.doneAt = Date.now();
    if (state.current.backfill || state.current.phase === 'edit') return true; // nothing to rest for
    if (sessionComplete(state.current)) { stopTimer(); return true; } // the last set: lifting is over
    if (x.kind === 'warm') { const lastWarm = !e.sets.slice(si + 1).some(y => y.kind === 'warm'); startTimer(lastWarm ? Math.min(120, e.rest) : 60, e.name); }
    else startTimer(e.rest, e.name);
    return true;
  }
  function toggleDone(ei, si) {
    const e = state.current && state.current.exercises[ei], x = e && e.sets[si];
    if (!x) { render(); return; }
    if (x.done) { x.done = false; recalcExercise(ei, true); save(); render(); return; }
    if (!markDone(ei, si)) return;
    recalcExercise(ei);
    afterSetChange();
    save(); render();
  }
  // In-session autoregulation. Every done working set with an RPE (or a miss) is evidence of
  // today's strength; the rep-max table turns that into the weight that would land the planned
  // reps at the target RPE, and the remaining sets are set to it. Re-run from scratch on ANY edit
  // (tick, untick, RPE change, weight or rep change), so changing your mind is always honoured.
  // Sets you typed a weight into yourself are left alone. Deload, easy and test weeks are exempt.
  // typing: true while a field is still being typed into; the stop rule waits for the final value.
  function recalcExercise(ei, quiet, typing) {
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
      const reps = x.actualReps != null ? x.actualReps : x.reps;
      let rpe = x.rpe; if (rpe == null && reps < x.reps) rpe = 10;
      const w = x.actualW != null ? x.actualW : x.w;
      if (rpe == null || !w || !reps) return;
      evidence.push({ w, reps, rpe, first: x === work[0], missed: reps < x.reps, target: x.kind === 'single' ? x.rpeTarget : null });
    });
    const C = E.TUNE.correction, peak = !!(E.BLOCKS[s.blockIdx] && E.BLOCKS[s.blockIdx].test);
    const r = E.liftCorrection(evidence, e.plannedW, work[0].reps, e.rpeTarget, { down: C.floor, up: peak ? C.ceilPeak : C.ceil });
    const missedAny = evidence.some(x => x.missed);
    const inc = state.settings.increment, bar = state.settings.barWeight;
    const target = r ? Math.max(bar, E.roundTo(r.w, inc)) : e.plannedW;
    const before = e.target || e.plannedW;
    let changed = 0;
    work.forEach(x => {
      if (x.done || x.manualW) return;
      const cur = x.actualW != null ? x.actualW : x.w;
      if (target !== cur) { x.actualW = target === x.w ? null : target; changed++; }
    });
    e.target = target; e.est = r ? Math.round(r.est) : null; e.hitFloor = !!(r && (r.hitFloor || missedAny));
    e.adjNote = !r ? null
      : Math.abs(target / e.plannedW - 1) < 0.005 ? `${evidence.length} set${evidence.length > 1 ? 's' : ''} logged, on target (today's estimate ~${e.est})`
      : `${evidence.length} set${evidence.length > 1 ? 's' : ''} logged, today's estimate ~${e.est}: remaining sets ${target > e.plannedW ? 'up' : 'down'} to ${target} (${target > e.plannedW ? '+' : ''}${((target / e.plannedW - 1) * 100).toFixed(1)}%)${r.hitFloor ? '. That is the floor for today.' : missedAny ? '. Reps were missed.' : ''}`;
    // The stop rule (a miss, a set still 2+ over target after a correction, or the floor): the
    // remaining sets come off automatically, once; "Restore" puts them back if you know better.
    if (e.autoStopped && e.cut && e.adjNote) e.adjNote += ' Remaining sets were cut by the fatigue stop; Restore puts them back.';
    if (r && r.stop && !e.autoStopped && !typing) {
      const keep = e.sets.filter(x => x.done || x.kind !== 'work'), removed = e.sets.length - keep.length;
      if (removed > 0) {
        e.autoStopped = true; e.cut = (e.cut || 0) + removed; e.sets = keep;
        e.adjNote = `${e.adjNote} Stopped here: ${removed} remaining set${removed > 1 ? 's' : ''} cut (the fatigue stop; grinding on would cost more than it gains). Restore them below if you know better.`;
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
      const work = e.sets.filter(x => x.kind === 'work' || x.kind === 'backoff' || x.kind === 'single');
      if (!work.length || work[0].pct == null) continue;
      const planned = Math.max(S.barWeight, E.roundTo(tm * mult * work[0].pct, S.increment));
      if (planned === e.plannedW) continue;
      e.plannedW = planned;
      e.sets.forEach(x => { if (x.done || x.manualW || x.pct == null) return; x.w = Math.max(S.barWeight, E.roundTo(tm * mult * x.pct, S.increment)); x.actualW = null; n++; });
      if (!e.sets.some(x => x.kind === 'warm' && x.done) && S.warmupSets !== false) {
        const fresh = E.warmups(planned, S.barWeight, S.increment, e.role).map(st => ({ w: st.w, reps: st.reps, kind: 'warm', done: false, actualReps: null, rpe: null, actualW: null }));
        const rest = e.sets.filter(x => x.kind !== 'warm'), delta = fresh.length - (e.sets.length - rest.length);
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
    e.sets.forEach(y => { if (y.carriedFrom != null) { if (y.carriedFrom === si) delete y.carriedFrom; else if (y.carriedFrom > si) y.carriedFrom--; } });
    ui.lastDeleted = { sid: s.id, ei, si, set: x }; ui.lastEi = ei; s.lastEi = ei;
    if (ui.sheet && ui.sheet.ei === ei) { ui.sheet = null; renderSheet(); }
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
    ui.lastDeleted = null; ui.lastEi = ei; s.lastEi = ei;
    if (u.set.kind !== 'warm') recalcExercise(ei, true);
    save(); render(); toast('Set restored');
  }
  function cutSets(ei) {
    const s = state.current, e = s.exercises[ei];
    const keep = e.sets.filter(x => x.done || x.kind !== 'work');
    const removed = e.sets.length - keep.length;
    if (!removed) return;
    e.cut = (e.cut || 0) + removed; e.sets = keep;
    e.adjNote = `${removed} remaining set${removed > 1 ? 's' : ''} cut. Living to lift another day is the point.`;
    afterSetChange();
    save(); render();
  }
  function restoreSets(ei) {
    const s = state.current, e = s.exercises[ei];
    const n = e.cut || 0; if (!n) return;
    const last = e.sets.filter(x => x.kind === 'work').slice(-1)[0];
    for (let i = 0; i < n; i++) e.sets.push({ w: last ? last.w : e.plannedW, reps: last ? last.reps : 5, pct: last ? last.pct : null, kind: 'work', rpeTarget: e.rpeTarget, done: false, actualReps: null, rpe: null, actualW: null });
    e.cut = 0; recalcExercise(ei, true); save(); render();
  }
  function openRpe(ei, si) { ui.sheet = { ei, si }; renderSheet(); }
  function renderSheet() {
    const ov = $('#overlay');
    if (!ui.sheet) { ov.innerHTML = ''; return; }
    const { ei, si } = ui.sheet, e = state.current.exercises[ei], x = e.sets[si];
    const opts = [4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
    const tips = { 4: '6+ left', 5: '5 left', 6: '4 left', 7: '3 left', 8: '2 left', 9: '1 left', 10: 'max' };
    ov.innerHTML = `<div class="sheet-bg" data-action="sheet-close"><div class="sheet" data-stop="1">
      <div class="row between"><h2>How hard was that set?</h2><button class="btn sm quiet" data-action="sheet-close">Close</button></div>
      <p class="small muted">${esc(e.name)} · ${x.kind === 'single' ? 'opener' : `set ${si + 1 - e.sets.filter((y, j) => j < si && (y.kind === 'warm' || y.kind === 'single')).length}`}${x.rpeTarget != null ? ` · planned about RPE ${x.rpeTarget}` : ''}. RPE 8 means two clean reps were left.</p>
      <div class="rpegrid">${opts.map(v => `<button class="${v === x.rpeTarget ? 'target' : ''}" data-action="rpe-pick" data-v="${v}">${v}<small>${tips[v] || ''}</small></button>`).join('')}<button data-action="rpe-pick" data-v="">—<small>clear</small></button></div>
    </div></div>`;
  }
  function swapExercise(ei, exId) {
    const s = state.current, e = s.exercises[ei];
    if (!exId || !E.swapOptions(state, e.slotKey).includes(exId)) return;
    if (e.sets.some(x => x.done && x.kind !== 'warm')) { toast('Untick the logged sets first, or keep this exercise today'); render(); return; }
    state.program.swaps[e.slotKey] = exId;
    toast(`${E.exerciseName(state, exId)} is now pinned for this slot (change it on the Program tab)`);
    // Rebuild this exercise only, from a fresh plan under the same mode.
    const fresh = E.buildSession(state, s.mode).exercises.find(x => x.slotKey === e.slotKey);
    fresh.sets.forEach(x => { x.done = false; x.actualReps = null; x.rpe = null; x.actualW = null; });
    s.exercises[ei] = fresh;
    addLog(`${E.exerciseName(state, exId)} now fills the ${e.slotKey.replace(/_/g, ' ')} slot.`);
    save(); render();
  }
  function finishLifting(force) {
    const s = state.current;
    const open = s.exercises.reduce((n, e) => n + (s.skippedSlots.includes(e.slotKey) ? 0 : e.sets.filter(x => !x.done && x.kind !== 'warm').length), 0);
    if (open > 0 && !force) { ui.confirm = 'finish'; render(); return; }
    ui.confirm = null; stopTimer();
    s.phase = 'post'; s.finishedAt = Date.now(); s.durationMin = s.backfill ? 0 : Math.max(1, Math.round((s.finishedAt - s.startedAt) / 60000));
    s.post = { difficulty: 0 };
    save(); render(); scrollToY(0);
  }
  function abandon() {
    const s = state.current; stopTimer();
    if (s && s.setLightRest) { state.program.lightRestOfWeek = false; if (state.log[0] && /Second red check-in/.test(state.log[0].msg)) state.log.shift(); }
    state.current = null; ui.confirm = null; ui.sheet = null; renderSheet();
    try { if (wakeLock) wakeLock.release(); } catch (e) { /* ignore */ }
    save(); render();
  }

  // ---------- Post-session ----------
  function renderPost() {
    const s = state.current;
    const est = bestE1rm(s);
    return `<div class="card">
      <h2>How did that go?</h2>
      <div class="small muted">${s.backfill ? `Logged for ${fmtDate(s.date)}` : `${s.durationMin} min of lifting`}${est.length ? ' · ' + est.map(x => `${LIFTNAME[x.lift]} est. 1RM ${Math.round(x.e1rm)}`).join(' · ') : ''}</div>
      <div class="q"><span class="label">Overall, that session was</span>
        <div class="seg wrap">${[1, 2, 3, 4].map(v => `<button data-action="post-diff" data-v="${v}" aria-pressed="${s.post.difficulty === v}">${DIFF[v]}<small>${['', 'left plenty in the tank', 'hard work, felt right', 'barely got through it', 'should have gone light'][v]}</small></button>`).join('')}</div></div>
      <p class="small muted">This answer, your RPEs and how recovered you are next time decide whether next week adds a set, holds, or backs off.</p>
      <button class="btn primary block" data-action="post-next">${state.settings.cardioMin ? 'Next: easy bike' : 'Save session'}</button>
    </div>`;
  }
  function bestE1rm(s) {
    const out = [];
    for (const l of LIFTS) {
      let best = 0;
      for (const e of s.exercises) if (e.lift === l && E.EX[e.ex].mult === 1) for (const x of e.sets) if (x.done && x.rpe != null && x.rpe >= 7 && x.kind !== 'warm') { const w = x.actualW != null ? x.actualW : x.w, r = x.actualReps != null ? x.actualReps : x.reps; if (w && r) best = Math.max(best, E.e1rm(w, r, x.rpe)); }
      if (best) out.push({ lift: l, e1rm: best });
    }
    return out;
  }

  // ---------- Cardio ----------
  function renderCardio() {
    const s = state.current, target = s.cardioMin || state.settings.cardioMin;
    const run = s.cardioRun; // lives on the session, so a suspended app comes back with the clock still right
    const elapsed = run ? Math.floor(((run.paused ? run.pausedAt : Date.now()) - run.start - run.pausedTotal) / 1000) : (s.cardio && s.cardio.sec) || 0;
    const mm = Math.floor(elapsed / 60), ss = elapsed % 60;
    return `<div class="card">
      <h2>Easy bike</h2>
      <p class="small muted">Target ${target} min on the BikeErg at a conversational pace (you could talk in full sentences, nose breathing is comfortable). This is for health and recovery, not training stress. If your legs feel heavy, go easier, not shorter.</p>
      <div class="kpi" style="align-items:center"><span class="v num" id="cardio-clock" style="font-size:3.4rem">${mm}:${String(ss).padStart(2, '0')}</span><span class="tiny">${run && !run.paused ? 'running' : run && run.paused ? 'paused' : 'ready'}</span></div>
      <div class="btnrow">${!run ? `<button class="btn primary" data-action="cardio-start">Start timer</button>` : run.paused ? `<button class="btn primary" data-action="cardio-resume">Resume</button>` : `<button class="btn" data-action="cardio-pause">Pause</button>`}</div>
      <hr class="sep">
      <div class="grid2">
        <label class="f">Minutes done<input id="cardio-min" type="number" inputmode="numeric" value="${run ? Math.round(elapsed / 60) : (s.cardio && s.cardio.min) || ''}" placeholder="${target}"></label>
        <label class="f">Average watts (optional)<input id="cardio-w" type="number" inputmode="numeric" value="${(s.cardio && s.cardio.watts) || ''}" placeholder="${state.settings.cardioWatts}"></label>
      </div>
      <div class="btnrow"><button class="btn primary" data-action="cardio-save">Save session</button><button class="btn" data-action="cardio-skip">No bike today</button></div>
    </div>`;
  }
  let cardioTick = null; // one chain only
  function tickCardio() {
    clearTimeout(cardioTick); cardioTick = null;
    const s = state.current;
    if (!s || s.phase !== 'cardio' || !s.cardioRun || view !== 'today') return;
    const run = s.cardioRun, el = $('#cardio-clock');
    if (el && !run.paused) { const e = Math.max(0, Math.floor((Date.now() - run.start - run.pausedTotal) / 1000)); el.textContent = `${Math.floor(e / 60)}:${String(e % 60).padStart(2, '0')}`; const m = $('#cardio-min'); if (m && document.activeElement !== m) m.value = Math.round(e / 60); }
    cardioTick = setTimeout(tickCardio, 1000);
  }
  function saveCardio(skip) {
    const s = state.current;
    if (skip) s.cardio = { min: 0 };
    else {
      const min = Math.min(600, Math.max(0, Math.round(Number($('#cardio-min').value) || 0)));
      const wIn = Number($('#cardio-w').value); const watts = wIn > 0 ? Math.min(2000, wIn) : null;
      s.cardio = { min, watts, kcal: E.cardioKcal(min, watts || state.settings.cardioWatts) };
    }
    s.cardioRun = null; clearTimeout(cardioTick);
    completeSession();
  }

  // ---------- Completing a session, reviews ----------
  function completeSession() {
    const s = state.current; s.phase = 'done'; delete s.phase;
    // Accessory double progression.
    for (const e of s.exercises) {
      if (e.lift || s.skippedSlots.includes(e.slotKey)) continue;
      const p = E.accessoryProgress(state, { load: e.load, repRange: e.repRange, sets: e.sets.map(x => ({ done: x.done, w: x.actualW != null ? x.actualW : x.w, reps: x.reps, actualReps: x.actualReps })) });
      if (p) { state.acc[e.ex] = { weight: p.weight, updated: s.date }; }
      else { const d = e.sets.find(x => x.done && x.actualW != null); if (d && !state.acc[e.ex]) state.acc[e.ex] = { weight: d.actualW, updated: s.date }; }
    }
    // Calibrate the maxes from what was actually lifted today.
    const cal = E.calibrate(state, s); s.calibrated = true;
    cal.forEach(addLog);
    delete s.cardioRun; delete s.setLightRest;
    s.exercises.forEach(e => { delete e.fold; }); delete s.lastEi;
    state.current = null; state.undo = null; stopTimer();
    state.sessions.push(s); Store.pushSession(s);
    if (s.backfill) { state.sessions.sort((a, b) => (a.ts || 0) - (b.ts || 0)); addLog(`${s.dayName} logged after the fact for ${fmtDate(s.date)}.`); }
    afterSession();
    if (cal.length) { const rep = state.lastReport || { title: 'After today', lines: [] }; rep.lines = cal.concat(rep.lines); rep.title = state.lastReport ? rep.title : 'Maxes calibrated from today'; state.lastReport = rep; }
    try { if (wakeLock) wakeLock.release(); } catch (e) { /* ignore */ }
    save(); render(); scrollToY(0);
  }
  function afterSession() {
    const P = state.program, pos = E.position(state);
    const wasLastDay = P.dayIdx === E.DAYS.length - 1;
    const lines = [];
    let title = null;
    if (wasLastDay) {
      P.lightRestOfWeek = false; P.pushOn = false;
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
        for (const l of LIFTS) if (mr.oneRM[l]) E.applyTM(state, l, mr.oneRM[l]);
        mr.log.forEach(l => { addLog(l); lines.push(l); });
        title = `${pos.block.name} block complete`;
        P.pendingDeload = false;
      }
    }
    const res = E.advanceDay(state);
    if (res.restDone) { const nb = E.BLOCKS[P.blockIdx]; lines.push(`${pos.inserted ? 'Deload' : 'Easy'} week done. ${nb.name} picks up next session.`); addLog(`${pos.inserted ? 'Deload' : 'Easy'} week complete.`); title = title || 'Light week complete'; }
    if (res.dialUp) { lines.push(P.volumeDial > 0 ? `Volume dial up to +${P.volumeDial}: a clean block while adding sets everywhere earns one more set per lift from here.` : `Volume dial back up to ${P.volumeDial}: a clean block earns a set back on every lift.`); addLog(`Volume dial up to ${P.volumeDial > 0 ? '+' : ''}${P.volumeDial}.`); }
    if (res.stall) { for (const l of res.stall.lines) { lines.push(l); addLog(l); } }
    if (res.mesoDone) { const nb = E.BLOCKS[P.blockIdx]; lines.push(P.special ? `Macro complete: ${P.special.weeksLeft}-week easy ${P.special.weeksLeft > 1 ? 'break' : 'week'} first, then ${nb.name} starts again.` : `Next up: ${nb.name} block (${nb.focus.toLowerCase()}), variation set ${P.variantSet || 'A'}.`); }
    if (lines.length) state.lastReport = { title: title || 'Update', lines };
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
        const now = !pos.isRest && mi === (P.macroPos || 0) && w === P.week;
        cells += `<div class="w ${isD ? 'deload' : b.id} ${now ? 'now' : ''}" title="${b.name} ${m.variant} week ${w}">${isD ? (b.test ? 'T' : 'D') : b.id[0].toUpperCase() + w}</div>`;
      }
    });
    cells += `<div class="w deload ${pos.isRest ? 'now' : ''}" title="Easy week">E</div>`;
    const macroWeeks = macro.reduce((n, m) => n + E.totalWeeks(E.BLOCKS.find(x => x.id === m.block)), 0) + 1;
    const week = [0, 1, 2, 3].map(d => { const saved = P.dayIdx; P.dayIdx = d; const s = E.buildSession(state, 'full'); P.dayIdx = saved; return s; });
    const sets = LIFTS.map(l => { const n = E.weeklySets(state, l), cap = E.capFor(state, l); return `<div class="stack"><div class="row between small"><span>${LIFTNAME[l]} pattern</span><span class="num"><b>${n}</b> / ${cap} sets</span></div><div class="bar"><i style="width:${Math.min(100, n / cap * 100)}%"></i></div></div>`; }).join('');
    const adj = LIFTS.map(l => `<tr><td>${LIFTNAME[l]}</td><td class="num">${state.lifts[l].oneRM}</td><td class="num">${state.lifts[l].tm}</td><td class="num">${P.setAdj[l] > 0 ? '+' : ''}${P.setAdj[l]}</td><td class="num">${P.loadAdj[l] ? (P.loadAdj[l] > 0 ? '+' : '') + Math.round(P.loadAdj[l] * 1000) / 10 + '%' : '—'}</td><td>${P.flags[l] ? '⚑'.repeat(P.flags[l]) : ''}</td></tr>`).join('');
    const slotKeys = Object.keys(E.SWAPS).filter(k => E.SWAPS[k].length > 1);
    const blk = pos.isRest ? null : pos.block;
    const blockText = {
      build: 'Sets of 7-8 at 70-77% of your 1RM (deadlift: sets of 5-6). Each week adds about 3% and, when you are recovering and hitting the numbers, a set on the competition lift. Two runs per macro with different variations (A: paused squat, close-grip, RDL; B: the other bar position, Larsen press, deficit deadlift).',
      strength: 'Sets of 3-5 from 76% up to about 86% of 1RM over three weeks, then a deload. Week 3 opens each main lift with one single at about RPE 8 before the triples. Two runs per macro (A: paused squat, long-pause bench, paused deadlift; B: the other bar position, Spoto press, block pull).',
      peak: 'Two weeks of heavy triples and doubles at 85-90% at the volume written, then a test week: work up to a single at RPE 9 on each lift. New maxes come from that.',
    };
    const dial = P.volumeDial || 0;
    return `
      <div class="card"><h3>${macroWeeks}-week macro</h3><div class="timeline" style="grid-template-columns:repeat(${Math.min(12, macroWeeks)},1fr)">${cells}</div>
        <div class="row small muted" style="gap:14px"><span><span class="dot" style="background:var(--good)"></span> Build ×2</span><span><span class="dot" style="background:var(--accent)"></span> Strength ×2</span>${state.settings.includePeak !== false ? '<span><span class="dot" style="background:var(--bad)"></span> Peak + test</span>' : ''}<span>D deload · E easy week</span></div>
        ${blk ? `<p><b>${esc(blk.name)} ${esc(P.variantSet || 'A')}:</b> ${blockText[blk.id]}</p>` : `<p><b>${pos.inserted ? 'Deload week' : 'Easy week'}:</b> ${pos.inserted ? 'half the sets at reduced loads; the block resumes afterwards.' : 'half the sets at half the loads on variations, to clear what deloads do not.'}</p>`}
        <div class="row between small"><span>Volume dial <b class="num">${dial > 0 ? '+' : ''}${dial}</b> <span class="muted">(lasting set offset on every lift; down one step per block on chronic fatigue, back up after a clean block, above zero only after a clean block that was adding sets everywhere)</span></span></div>
        <label class="f">Set the dial by hand<select id="dial" data-action="dial"><option value="-2" ${dial === -2 ? 'selected' : ''}>−2 (two sets fewer)</option><option value="-1" ${dial === -1 ? 'selected' : ''}>−1</option><option value="0" ${dial === 0 ? 'selected' : ''}>0 (as written)</option><option value="1" ${dial === 1 ? 'selected' : ''}>+1</option><option value="2" ${dial === 2 ? 'selected' : ''}>+2 (two sets more)</option></select></label>
      </div>
      <div class="card"><h3>This week's plan</h3>
        ${week.map(s => `<details ${s.dayIdx === P.dayIdx ? 'open' : ''}><summary class="row between" style="padding:6px 0"><b>${esc(s.dayName)}</b><span class="small muted">${s.estMinutes} min</span></summary>
          <div class="tablewrap"><table>${s.exercises.map(e => { const work = e.sets.filter(x => x.kind !== 'warm' && x.kind !== 'single'), f = work[0], op = e.sets.find(x => x.kind === 'single'); return `<tr><td>${esc(e.name)}${e.optional ? ' <span class="muted small">(opt.)</span>' : ''}</td><td class="num">${op ? `1×1 + ` : ''}${work.length}×${f.reps}${f.plus ? '+' : ''}</td><td class="num">${op ? `${op.w} / ` : ''}${f.w != null ? f.w : (e.load === 'bw' ? 'bw' : '?')}</td><td class="muted small">${e.pctTM != null ? pctLabel(e) : ''}</td></tr>`; }).join('')}</table></div></details>`).join('')}
      </div>
      <div class="card"><h3>Weekly working sets</h3>${sets}<p class="small muted">Counts the competition lift plus its close barbell variations. The caps are the ceiling the adaptive rules can climb to; the book's advice for someone coming off too much volume is to start low and only add when you are clearly recovering.</p></div>
      <div class="card"><h3>Maxes and adjustments</h3>
        <div class="tablewrap"><table><tr><th>Lift</th><th class="num">1RM</th><th class="num">TM</th><th class="num">Sets</th><th class="num">Load</th><th>Flags</th></tr>${adj}</table></div>
        <p class="small muted">Sets and load are the adaptive offsets in effect this week. A flag means a week where you missed reps, got crushed or stayed sore; two flags on two lifts suggests a deload.</p>
        <div class="btnrow">${pos.isRest || pos.isDeload || pos.isTest ? '' : '<button class="btn" data-action="deload-now-confirm">Deload now</button>'}<button class="btn" data-action="rest-now-confirm">Easy week</button></div>
        ${ui.confirm === 'deload' ? `<div class="callout warn">Take a deload week now? The block picks up where it left off afterwards.<div class="btnrow" style="margin-top:8px"><button class="btn sm primary" data-action="deload-now">Yes</button><button class="btn sm" data-action="confirm-cancel">No</button></div></div>` : ''}
        ${ui.confirm === 'rest' ? `<div class="callout warn">Insert one easy week (half sets, half loads, variations) before continuing? Use it once or twice a year or when life gets heavy.<div class="btnrow" style="margin-top:8px"><button class="btn sm primary" data-action="rest-now">Yes</button><button class="btn sm" data-action="confirm-cancel">No</button></div></div>` : ''}
        <label class="f">After this block, run<select id="next-block" data-action="next-block"><option value="">the normal sequence</option>${E.BLOCKS.map((b, i) => `<option value="${i}" ${P.nextBlockOverride === i ? 'selected' : ''}>${b.name}</option>`).join('')}</select></label>
      </div>
      <div class="card"><h3>Exercise choices</h3>
        <p class="small muted">Variations rotate each block automatically. Pin a choice here if your equipment or joints prefer it; clear it to go back to the rotation.</p>
        ${slotKeys.map(k => { const def = (blk && blk.variation && blk.variation[k]) || E.SWAPS[k][0]; const defName = E.exerciseName(state, (def === 'high_bar_squat' || def === 'low_bar_squat') ? (state.settings.squatStyle === 'highbar' ? 'low_bar_squat' : 'high_bar_squat') : def); return `<label class="f">${k.replace(/_/g, ' ')}<select id="swap-${k}" data-action="pin-swap" data-k="${k}"><option value="">Block default (${esc(defName)})</option>${E.swapOptions(state, k).map(x => `<option value="${x}" ${P.swaps[k] === x ? 'selected' : ''}>${esc(E.exerciseName(state, x))}</option>`).join('')}</select></label>`; }).join('')}
      </div>
      <div class="card"><h3>Why things changed</h3>${state.log.length ? `<div class="loglist">${state.log.slice(0, 25).map(l => `<div class="item"><span class="d">${fmtDate(l.date)}</span><span>${esc(l.msg)}</span></div>`).join('')}</div>` : '<p class="muted small">Nothing yet. After each full week the review lands here.</p>'}</div>`;
  }

  // ---------- History ----------
  function renderHistory() {
    const done = state.sessions.filter(s => !s.skipped).slice().reverse();
    const trend = LIFTS.map(l => { const w = weeklyEst(l); const last = w[w.length - 1], prev = w[w.length - 2]; return `<div class="stack"><div class="row between"><b>${LIFTNAME[l]}</b><span class="small muted num">1RM ${state.lifts[l].oneRM} · TM ${state.lifts[l].tm}${last ? ` · this week ~${Math.round(last.y)}${prev ? ` (${last.y >= prev.y ? '+' : ''}${Math.round(last.y - prev.y)} vs last)` : ''}` : ''}</span></div><canvas id="c-${l}" height="130"></canvas></div>`; }).join('');
    return `
      <div class="card"><h3>Estimated 1RM, week by week</h3>${trend}<div class="row small muted" style="gap:14px"><span><span class="dot" style="background:var(--accent)"></span> weekly average</span><span><span class="dot" style="background:var(--muted)"></span> single sessions</span><span>dashed: current 1RM</span></div><p class="small muted">Every logged set with an RPE on a competition lift (or a close barbell variation) implies a max; the line is the weekly average of those. It moves with how you are doing and feeling, not with what you entered at setup.</p></div>
      <div class="card"><h3>Readiness</h3><canvas id="c-ready" height="140"></canvas></div>
      <div class="card"><h3>Sessions</h3>${done.length ? done.slice(0, 60).map((s, i) => `<details class="session-item" style="display:block"><summary class="hist-row"><span class="hist-main"><b>${esc(s.dayName)}</b><span class="muted small">${fmtDate(s.date)} · ${esc(s.blockName || '')} wk ${s.week}${s.mode && s.mode !== 'full' ? ' · ' + E.MODES[s.mode].label : ''}</span></span><span class="hist-ready">${s.readiness ? `<span class="pill ${s.readiness.color}" title="Readiness">${s.readiness.score}</span>` : '<span class="muted small" aria-label="No check-in">–</span>'}</span><span class="hist-diff">${s.post && s.post.difficulty ? `<span class="pill">${DIFF[s.post.difficulty]}</span>` : ''}</span></summary>
          <div class="tablewrap" style="margin-top:8px"><table>${s.exercises.map(e => `<tr><td>${esc(e.name)}</td><td class="small num">${e.sets.filter(x => x.done && x.kind !== 'warm').map(x =>`${x.actualW != null ? x.actualW : (x.w != null ? x.w : 'bw')}×${x.actualReps != null ? x.actualReps : x.reps}${x.rpe != null ? '@' + x.rpe : ''}`).join(', ') || '<span class="muted">skipped</span>'}</td></tr>`).join('')}</table></div>
          <div class="small muted" style="margin-top:6px">${s.durationMin ? s.durationMin + ' min' : ''}${s.cardio && s.cardio.min ? ` · bike ${s.cardio.min} min` : ''}${s.backfill ? ' · logged after the fact' : ''}${s.edited ? ' · edited' : ''}${s.notes ? ' · ' + esc(s.notes) : ''}</div>
          <div class="btnrow" style="margin-top:6px"><button class="btn sm" data-action="edit-session" data-id="${s.id}">Edit</button><button class="btn sm quiet" data-action="delete-session" data-id="${s.id}" style="color:var(--bad)">Delete</button></div></details>`).join('') : '<p class="empty">No sessions yet. Your first check-in is on the Today tab.</p>'}
        <p class="small muted">Forgot a session? "Log a past session" is on the Today tab.</p></div>`;
  }
  // ---------- Editing a logged session ----------
  function startEdit(id) {
    if (state.current) { toast('Finish or discard the open session first'); return; }
    const sess = state.sessions.find(x => x.id === id); if (!sess || sess.skipped) return;
    let copy; try { copy = JSON.parse(JSON.stringify(sess)); } catch (e) { return; }
    copy.phase = 'edit'; copy.editOf = sess.id; copy.editDate = sess.date;
    copy.skippedSlots = Array.isArray(copy.skippedSlots) ? copy.skippedSlots : [];
    copy.post = copy.post || { difficulty: 0 }; copy.notes = copy.notes || '';
    state.current = copy; ui.confirm = null; view = 'today'; ui.lastEi = null; ui.openWarm = {}; ui.editSets = {}; ui.lastDeleted = null;
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
    Store.saveLocal(state);
  }
  function cancelEdit() { state.current = null; view = 'history'; save(); render(); }
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
    if (newDate !== s.date) { s.date = newDate; s.ts = dayTs(newDate); }
    s.cardio = cm > 0 ? { min: cm, watts: cw, kcal: E.cardioKcal(cm, cw || state.settings.cardioWatts) } : { min: 0 };
    s.exercises.forEach(e => { delete e.fold; }); delete s.lastEi;
    delete s.phase; delete s.editOf; delete s.editDate; delete s.startedAt; delete s.finishedAt; delete s.cardioRun; delete s.setLightRest;
    s.edited = true; s.calibrated = true;
    snapshot(`Edited ${s.dayName} (${fmtDate(s.date)})`, { removeSessionId: s.id, restoreSession: original });
    state.sessions[idx] = s; state.sessions.sort((a, b) => (a.ts || 0) - (b.ts || 0)); Store.pushSession(s);
    state.current = null; view = 'history';
    const lines = [`${s.dayName} (${fmtDate(s.date)}) edited.`];
    const sig = (x) => JSON.stringify({ d: x.date, sk: x.skippedSlots || [], p: x.post ? x.post.difficulty : 0, e: (x.exercises || []).map(e => [e.ex, (e.sets || []).map(y => [y.kind, y.done ? 1 : 0, y.actualW, y.actualReps, y.rpe])]) });
    if (sig(original) === sig(s)) lines.push('No sets changed, so the maxes stay as they are.');
    else if (!inBlock(s) || (s.ts || 0) <= (P.calibBaseTs || 0)) lines.push('It comes before the maxes were last reset (a new block, a deload, a layoff or a max set by hand), so the maxes stay as they are.');
    else lines.push(...recalibrateBlock());
    lines.forEach(addLog); state.lastReport = { title: 'Session edited', lines };
    save(); render(); toast('Session updated');
  }
  // After an edit inside the current block: put the maxes back to where the block started and
  // re-read every session of the block in date order, so the edit lands exactly as if it had been
  // logged that way. Set counts and flags from past weekly reviews are left as they were.
  function recalibrateBlock() {
    const P = state.program, out = [];
    if (state.settings.autoCalibrate === false) return ['Auto-calibration is off, so the maxes are unchanged.'];
    const before = {}; LIFTS.forEach(l => { before[l] = state.lifts[l].oneRM; });
    for (const l of LIFTS) { const L = state.lifts[l]; if (!(L.blockStartRM > 0)) return ['No block start on record for the maxes, so they are unchanged.']; }
    for (const l of LIFTS) { const L = state.lifts[l]; E.applyTM(state, l, L.blockStartRM); L.est = L.estAtBlockStart != null ? L.estAtBlockStart : null; L.upKey = null; }
    P.calibDrops = {};
    const sessions = state.sessions.filter(s => inBlock(s) && !s.skipped && (s.ts || 0) > (P.calibBaseTs || 0)).sort((a, b) => (a.ts || 0) - (b.ts || 0));
    for (const sess of sessions) { E.calibrate(state, sess); sess.calibrated = true; }
    const moved = LIFTS.filter(l => state.lifts[l].oneRM !== before[l]);
    out.push(moved.length ? `Maxes re-read from this block's ${sessions.length} session${sessions.length === 1 ? '' : 's'}: ${moved.map(l => `${LIFTNAME[l]} ${before[l]} -> ${state.lifts[l].oneRM}`).join(', ')}.` : `Maxes re-read from this block's ${sessions.length} session${sessions.length === 1 ? '' : 's'}: unchanged.`);
    if (state.current == null && P.week >= 1) out.push('Set counts and flags from past weekly reviews stay as they were; this week\'s review will read the corrected session.');
    return out;
  }
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  // Per-session max estimates (confidence-weighted) and their weekly averages.
  function sessionEsts(lift) {
    const out = [];
    for (const s of state.sessions) { if (s.skipped || s.isDeload || s.isRest) continue; const r = E.sessionEstimate(s, lift); if (r) out.push({ x: s.ts, y: r.est, conf: r.conf }); }
    return out;
  }
  function weekStart(ts) { const d = new Date(ts); const day = (d.getDay() + 6) % 7; d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - day); return d.getTime(); }
  function weeklyEst(lift) {
    const by = {};
    for (const p of sessionEsts(lift)) { const k = weekStart(p.x); by[k] = by[k] || { n: 0, d: 0 }; by[k].n += p.y * p.conf; by[k].d += p.conf; }
    return Object.keys(by).map(Number).sort((a, b) => a - b).map(k => ({ x: k + 3.5 * 864e5, y: by[k].n / by[k].d }));
  }
  function drawCharts() {
    const ready = [];
    for (const s of state.sessions) if (!s.skipped && s.readiness) ready.push({ x: s.ts, y: s.readiness.score, c: s.readiness.color });
    for (const l of LIFTS) {
      const sess = sessionEsts(l), weekly = weeklyEst(l);
      lineChart($('#c-' + l), [{ pts: sess, color: cssVar('--muted'), dots: true, noline: true, faint: true }, { pts: weekly, color: cssVar('--accent'), dots: true }], { hline: state.lifts[l].oneRM, hlineColor: cssVar('--fg') });
    }
    lineChart($('#c-ready'), [{ pts: ready, color: cssVar('--accent'), dots: true }], { min: 0, max: 100, bands: [[0, 40, cssVar('--bad-soft')], [40, 60, cssVar('--warn-soft')], [60, 100, cssVar('--good-soft')]] });
  }
  function lineChart(cv, series, opt) {
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 320, H = Number(cv.getAttribute('height'));
    cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
    const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    const all = series.flatMap(s => s.pts);
    const padL = 40, padR = 10, padT = 10, padB = 22;
    ctx.font = '11px ' + cssVar('--body'); ctx.fillStyle = cssVar('--muted'); ctx.strokeStyle = cssVar('--line');
    if (!all.length) { ctx.fillText(opt.hline ? `No logged sets yet. Current 1RM ${opt.hline}.` : 'No data yet', padL, H / 2); return; }
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
      s.pts.forEach((p, i) => { if (s.dots || i === s.pts.length - 1) { ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), s.faint ? 2.5 : 3.5, 0, Math.PI * 2); ctx.fill(); } });
      if (!s.faint) { const last = s.pts[s.pts.length - 1]; ctx.fillText(Math.round(last.y), Math.min(W - padR - 28, X(last.x) + 6), Y(last.y) - 6); }
      ctx.globalAlpha = 1;
    }
  }

  // ---------- Settings ----------
  function renderSettings() {
    const s = state.settings;
    return `
      <div class="card"><h3>Maxes</h3>
        <div class="grid3">${LIFTS.map(l => `<label class="f">${LIFTNAME[l]} 1RM<input id="set-1rm-${l}" type="number" inputmode="decimal" data-setting="1rm:${l}" value="${state.lifts[l].oneRM}"></label>`).join('')}</div>
        <div class="grid2">
        <label class="f">Your squat<select id="set-sq" data-setting="squatStyle"><option value="lowbar" ${s.squatStyle !== 'highbar' ? 'selected' : ''}>Low-bar</option><option value="highbar" ${s.squatStyle === 'highbar' ? 'selected' : ''}>High-bar</option></select></label>
        <label class="f">Your deadlift<select id="set-dl" data-setting="deadliftStyle"><option value="conventional" ${s.deadliftStyle !== 'sumo' ? 'selected' : ''}>Conventional</option><option value="sumo" ${s.deadliftStyle === 'sumo' ? 'selected' : ''}>Sumo</option></select></label>
        </div>
        <label class="f">Training Max %<select id="set-tm" data-setting="tmPct"><option value="0.85" ${s.tmPct == 0.85 ? 'selected' : ''}>85%</option><option value="0.875" ${s.tmPct == 0.875 ? 'selected' : ''}>87.5%</option><option value="0.9" ${s.tmPct == 0.9 ? 'selected' : ''}>90%</option><option value="0.925" ${s.tmPct == 0.925 ? 'selected' : ''}>92.5%</option></select></label>
        <p class="small muted" id="tm-line">${esc(tmLine())}</p>
        <label class="row" style="gap:10px;font-weight:600"><input type="checkbox" id="set-cal" data-setting="autoCalibrate" ${s.autoCalibrate !== false ? 'checked' : ''} style="width:22px;height:22px"> Calibrate maxes from my sets after each session <span class="muted small" style="font-weight:500">(down at once, up slowly)</span></label>
      </div>
      <div class="card"><h3>Equipment</h3>
        <div class="grid2"><label class="f">Bar weight<input id="set-bar" type="number" inputmode="decimal" data-setting="barWeight" value="${s.barWeight}"></label><label class="f">Dumbbell step<select id="set-dbi" data-setting="dbIncrement"><option value="2.5" ${s.dbIncrement == 2.5 ? 'selected' : ''}>2.5</option><option value="5" ${s.dbIncrement == 5 ? 'selected' : ''}>5</option></select></label></div>
        <div class="stack"><span class="tiny">Plates per side</span><div class="chips">${[55, 45, 35, 25, 15, 10, 5, 2.5, 1.25].map(p => `<button data-action="set-plate" data-p="${p}" aria-pressed="${s.plates.includes(p)}">${p}</button>`).join('')}</div></div>
        <div class="stack"><span class="tiny">Accessory working weights</span><div class="tablewrap"><table>${Object.keys(state.acc).length ? Object.keys(state.acc).map(k => `<tr><td>${esc(E.EX[k] ? E.EX[k].name : k)}</td><td class="num"><input id="acc-${k}" type="number" inputmode="decimal" data-setting="acc:${k}" value="${state.acc[k].weight}" style="width:80px;border:1px solid var(--line);border-radius:6px;padding:4px 6px;background:var(--surface)"></td></tr>`).join('') : '<tr><td class="muted small">They appear here once you enter them in a session.</td></tr>'}</table></div></div>
      </div>
      <div class="card"><h3>Schedule and cardio</h3>
        <div class="stack"><span class="tiny">Training days</span><div class="chips">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => `<button data-action="set-day" data-d="${x}" aria-pressed="${s.days.includes(x)}">${x}</button>`).join('')}</div></div>
        <div class="grid2"><label class="f">Bike after lifting (min)<input id="set-cm" type="number" inputmode="numeric" data-setting="cardioMin" value="${s.cardioMin}"></label><label class="f">Usual easy watts<input id="set-cw" type="number" inputmode="numeric" data-setting="cardioWatts" value="${s.cardioWatts}"></label></div>
        <div class="grid3"><label class="f">Rest, main (s)<input id="set-r1" type="number" inputmode="numeric" data-setting="restPrimary" value="${s.restPrimary}"></label><label class="f">Rest, second (s)<input id="set-r2" type="number" inputmode="numeric" data-setting="restSecondary" value="${s.restSecondary}"></label><label class="f">Rest, accessory (s)<input id="set-r3" type="number" inputmode="numeric" data-setting="restAccessory" value="${s.restAccessory}"></label></div>
        <label class="row" style="gap:10px;font-weight:600"><input type="checkbox" id="set-peak" data-setting="includePeak" ${s.includePeak === true ? 'checked' : ''} style="width:22px;height:22px"> Include the Peak &amp; Test block</label>
        <label class="row" style="gap:10px;font-weight:600"><input type="checkbox" id="set-warm" data-setting="warmupSets" ${s.warmupSets !== false ? 'checked' : ''} style="width:22px;height:22px"> Show warm-up sets in each session</label>
        <label class="row" style="gap:10px;font-weight:600"><input type="checkbox" id="set-notify" data-setting="notify" ${s.notify ? 'checked' : ''} style="width:22px;height:22px"> Notify me when a rest ends <span class="muted small" style="font-weight:500">(iPhone: only from the home-screen app, and only while it is still running)</span></label>
        <label class="f">Extra easy cardio today (min, off-day bike or walk)<div class="row"><input id="extra-cardio" type="number" inputmode="numeric" placeholder="30" style="flex:1"><button class="btn sm" data-action="extra-cardio">Log</button></div></label>
      </div>
      <div class="card"><h3>Data and backups</h3>
        ${Store.db ? '<p class="small muted">Synced to your Claude account, so it follows you across devices.</p>' : `
        <div class="callout bad">On an iPhone this app's data lives inside the home-screen app itself. Deleting the icon deletes the data, and Safari's own copy is separate. Keep a backup on, and never delete or re-add the icon without one.</div>
        ${renderCloud()}`}
        <div class="btnrow">${Store.db ? '' : '<button class="btn" data-action="share-backup">Save backup file</button>'}<button class="btn" data-action="export">Copy backup</button></div>
        <p class="small muted">${state.lastBackupAt ? `Last backup ${new Date(state.lastBackupAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} (${state.lastBackupKind})` : 'No backup yet'}${sessionsSinceBackup() ? ` · ${sessionsSinceBackup()} session${sessionsSinceBackup() > 1 ? 's' : ''} since` : ''}.</p>
        <button class="btn block" data-action="import-toggle">Restore from a backup file or text</button>
        ${ui.showImport ? `${filePick('Choose a backup file', 'primary block')}<label class="f">Or paste the backup text<textarea id="import-text" rows="4"></textarea></label><button class="btn" data-action="import">Restore from text</button>` : ''}
        <button class="btn danger block" data-action="reset-confirm">Start over</button>
        ${ui.confirm === 'reset' ? `<div class="callout bad">This erases the program and every logged session, and it cannot be undone. Tap Copy backup first if there is anything worth keeping. <div class="btnrow" style="margin-top:8px"><button class="btn sm danger" data-action="reset">Erase everything</button><button class="btn sm" data-action="confirm-cancel">Cancel</button></div></div>` : ''}
      </div>
      <p class="small muted" style="text-align:center">Readyset · principles from Israetel, Hoffmann &amp; Smith, Scientific Principles of Strength Training (2020). Not medical advice.</p>`;
  }
  function renderCloud() {
    const s = state.settings;
    if (s.gistToken) return `<div class="stack"><div class="row between"><b>Cloud backup: on</b><span class="pill ${state.cloudError ? 'red' : 'green'}">${state.cloudError ? 'error' : 'GitHub Gist'}</span></div>
      <p class="small muted">${state.cloudError ? esc(state.cloudError) + '. It will retry after the next change.' : state.lastCloudBackup ? `Written ${new Date(state.lastCloudBackup).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}, about 15 s after every change, to a private gist in your GitHub account.` : 'Writing the first copy…'}</p>
      <div class="btnrow"><button class="btn sm" data-action="cloud-backup-now">Back up now</button><button class="btn sm quiet" data-action="cloud-off">Turn off</button></div></div>`;
    return `<details><summary class="btn block" style="display:flex">Turn on automatic cloud backup</summary>
      <div class="stack" style="margin-top:10px">
      <p class="small">Backs up to a private gist in your own GitHub account about 15 seconds after every change, and restores from it in one tap on a new phone. Create a token once:</p>
      <ol class="small muted" style="margin:0;padding-left:18px">
        <li>On github.com: profile photo → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token.</li>
        <li>Name it "Readyset", set expiration to the longest option, and under <b>Account permissions</b> set <b>Gists</b> to <b>Read and write</b>. Nothing else.</li>
        <li>Generate, copy the token (it starts with github_pat_), paste it here.</li>
      </ol>
      <label class="f">GitHub token<input id="gist-token" type="password" autocomplete="off" placeholder="github_pat_…"></label>
      <div class="btnrow"><button class="btn primary" data-action="cloud-connect" ${ui.cloudBusy ? 'disabled' : ''}>Turn on</button><button class="btn" data-action="cloud-restore" ${ui.cloudBusy ? 'disabled' : ''}>Restore from cloud</button></div>
      <p class="small muted">The token stays in this app only and is never written into the backup itself. It can only read and write gists.</p>
      </div></details>`;
  }
  function tmLine() {
    return `Training maxes: squat ${state.lifts.squat.tm}, bench ${state.lifts.bench.tm}, deadlift ${state.lifts.deadlift.tm}. Every barbell load in the plan is a percentage of these.${LIFTS.some(l => state.lifts[l].est) ? ` Recent estimates from your sets: ${LIFTS.filter(l => state.lifts[l].est).map(l => `${LIFTNAME[l].toLowerCase()} ~${Math.round(state.lifts[l].est)}`).join(', ')}.` : ''}`;
  }
  // Numeric settings: an empty field keeps the old value; everything is clamped to a sane range.
  const SETTING_RANGES = { barWeight: [5, 100], cardioMin: [0, 240], cardioWatts: [30, 600], restPrimary: [30, 600], restSecondary: [30, 600], restAccessory: [15, 600] };
  // From now on the maxes as they stand are the base a block replay starts from (see recalibrateBlock).
  function markCalibBase() {
    state.program.calibBaseTs = Date.now();
    for (const l of LIFTS) { const L = state.lifts[l]; L.blockStartRM = L.oneRM; L.estAtBlockStart = L.est == null ? null : L.est; }
  }
  function applySetting(key, val) {
    const s = state.settings;
    state.undo = null;
    const n = val === '' || val == null ? NaN : Number(val);
    if (key.startsWith('1rm:')) { const l = key.split(':')[1]; if (n > 0 && n <= 2000 && LIFTS.includes(l)) { const v = Math.round(n * 2) / 2; E.applyTM(state, l, v); state.lifts[l].est = null; markCalibBase(); addLog(`${LIFTNAME[l]} 1RM set to ${v} by hand.`); rebaseSession(); } }
    else if (key === 'tmPct') { if ([0.85, 0.875, 0.9, 0.925].includes(n)) { s.tmPct = n; LIFTS.forEach(l => E.applyTM(state, l, state.lifts[l].oneRM)); rebaseSession(); } }
    else if (key === 'autoCalibrate') s.autoCalibrate = !!val;
    else if (key.startsWith('acc:')) { const k = key.split(':')[1]; if (Object.prototype.hasOwnProperty.call(E.EX, k) && n >= 0 && n <= 2000) state.acc[k] = { weight: n, updated: todayISO() }; }
    else if (key === 'includePeak') s.includePeak = !!val;
    else if (key === 'warmupSets') s.warmupSets = !!val;
    else if (key === 'notify') { if (val) enableNotify(); else s.notify = false; }
    else if (key === 'squatStyle') { if (['lowbar', 'highbar'].includes(val)) s.squatStyle = val; }
    else if (key === 'deadliftStyle') { if (['conventional', 'sumo'].includes(val)) s.deadliftStyle = val; }
    else if (key === 'dbIncrement') { if ([2.5, 5].includes(n)) s.dbIncrement = n; }
    else if (SETTING_RANGES[key]) { if (Number.isFinite(n)) s[key] = Math.min(SETTING_RANGES[key][1], Math.max(SETTING_RANGES[key][0], Math.round(n))); }
    save();
  }

  // ---------- Events ----------
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-action],[data-view]');
    if (!t) return;
    if (t.dataset.view) {
      // Leaving a session for another tab and coming back returns you to the same spot.
      if (view === 'today' && state.current) ui.todayScroll = scroller().scrollTop;
      view = t.dataset.view; ui.confirm = null; render();
      scrollToY(view === 'today' && state.current ? (ui.todayScroll || 0) : 0); return;
    }
    const a = t.dataset.action, d = t.dataset;
    if (t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
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
      case 'ci-cancel': ui.checkin = null; render(); break;
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
        x.rpe = d.v === '' ? null : Number(d.v);
        if (!x.done && x.rpe != null) markDone(sh.ei, sh.si);
        recalcExercise(sh.ei); afterSetChange(); save(); render(); break;
      }
      case 'cut-sets': cutSets(Number(d.ei)); break;
      case 'restore-sets': restoreSets(Number(d.ei)); break;
      case 'sheet-close': if (ev.target === t || ev.target.closest('[data-stop]') == null || t.tagName === 'BUTTON') { ui.sheet = null; renderSheet(); } break;
      case 'toggle-skip': { const s = state.current, e = s.exercises[Number(d.ei)]; const i = s.skippedSlots.indexOf(e.slotKey); if (i >= 0) s.skippedSlots.splice(i, 1); else s.skippedSlots.push(e.slotKey); save(); render(); break; }
      case 'finish-lifting': finishLifting(false); break;
      case 'finish-confirm': finishLifting(true); break;
      case 'abandon': ui.confirm = 'abandon'; render(); break;
      case 'abandon-confirm': abandon(); break;
      case 'confirm-cancel': ui.confirm = null; render(); break;
      case 'post-diff': state.current.post = state.current.post || { difficulty: 0 }; state.current.post.difficulty = Number(d.v); save(); if (state.current.phase === 'edit') { document.querySelectorAll('[data-action="post-diff"]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.v) === state.current.post.difficulty))); } else render(); break;
      case 'edit-session': startEdit(d.id); break;
      case 'edit-save': saveEdit(); break;
      case 'edit-cancel': cancelEdit(); break;
      case 'backfill-open': { const y = new Date(); y.setDate(y.getDate() - 1); ui.backfill = { date: todayISO(y), mode: 'full' }; render(); break; }
      case 'backfill-cancel': ui.backfill = null; render(); break;
      case 'backfill-start': startBackfill(); break;
      case 'layoff-ease': { const newest = newestSessionDate(); if (!newest) break; snapshot('Eased back in after a layoff'); const lines = E.layoffAdjust(state, daysBetween(newest, todayISO())); state.program.layoffHandled = newest; lines.forEach(addLog); if (lines.length) state.lastReport = { title: 'Back after a layoff', lines }; save(); render(); break; }
      case 'layoff-skip': state.program.layoffHandled = newestSessionDate(); addLog('Carried on as planned after a layoff.'); save(); render(); break;
      case 'post-next': if (!state.current.post.difficulty) { toast('Pick one'); return; } if (state.settings.cardioMin) { state.current.phase = 'cardio'; save(); render(); } else { state.current.cardio = { min: 0 }; completeSession(); } break;
      case 'cardio-start': state.current.cardioRun = { start: Date.now(), pausedTotal: 0, paused: false }; keepAwake(); save(); render(); break;
      case 'cardio-pause': { const r = state.current.cardioRun; if (r) { r.paused = true; r.pausedAt = Date.now(); save(); render(); } break; }
      case 'cardio-resume': { const r = state.current.cardioRun; if (r && r.paused) { r.pausedTotal += Date.now() - (r.pausedAt || Date.now()); r.paused = false; r.pausedAt = null; save(); render(); } break; }
      case 'cardio-save': saveCardio(false); break;
      case 'cardio-skip': saveCardio(true); break;
      case 'timer-add': if (ui.timer) { ui.timer.end += 30000; ui.timer.fired = false; if (state.timer) state.timer.end = ui.timer.end; tickTimer(); Store.saveLocal(state); } break;
      case 'timer-stop': stopTimer(); Store.saveLocal(state); break;
      case 'dismiss-report': state.lastReport = null; save(); render(); break;
      case 'undo': undoLast(); break;
      case 'deload-now-confirm': ui.confirm = 'deload'; render(); break;
      case 'rest-now-confirm': ui.confirm = 'rest'; render(); break;
      case 'deload-now': { snapshot('Deload started early'); const ok = E.startDeloadNow(state); ui.confirm = null; if (ok) addLog('Deload started early.'); else { state.undo = null; toast('Already in a light week'); } save(); render(); break; }
      case 'deload-later': snapshot('Deload suggestion dismissed'); state.program.pendingDeload = false; state.program.pushOn = true; addLog('Deload suggestion declined; pushing on with the week trimmed (no bonus reps or earned sets, loads one step down).'); save(); render(); break;
      case 'rest-now': snapshot('Easy week inserted'); E.startActiveRest(state, 1); ui.confirm = null; addLog('Easy week inserted.'); save(); render(); break;
      case 'set-plate': { const s = state.settings, p = Number(d.p); s.plates = (s.plates.includes(p) ? s.plates.filter(x => x !== p) : s.plates.concat(p)).sort((a, b) => b - a); s.increment = s.plates.includes(1.25) ? 2.5 : s.plates.includes(2.5) ? 5 : 10; LIFTS.forEach(l => E.applyTM(state, l, state.lifts[l].oneRM)); save(); render(); break; }
      case 'set-day': { const s = state.settings; s.days = s.days.includes(d.d) ? s.days.filter(x => x !== d.d) : s.days.concat(d.d); save(); render(); break; }
      case 'extra-cardio': { const m = Number($('#extra-cardio').value) || 0; if (m > 0) { state.extraCardio = state.extraCardio || []; state.extraCardio.push({ date: todayISO(), min: m, kcal: E.cardioKcal(m, state.settings.cardioWatts) }); save(); toast(`Logged ${m} min`); render(); } break; }
      case 'export': copyBackup(); break;
      case 'share-backup': shareBackup(); break;
      case 'import-toggle': ui.showImport = !ui.showImport; render(); break;
      case 'import': restoreFromText(($('#import-text') || {}).value || ''); break;
      case 'restore-confirm': if (ui.pendingRestore) applyRestore(ui.pendingRestore); break;
      case 'restore-cancel': ui.pendingRestore = null; render(); break;
      case 'cloud-connect': connectCloud($('#gist-token').value, false); break;
      case 'cloud-restore': connectCloud($('#gist-token').value, true); break;
      case 'cloud-backup-now': Cloud.backup().then(ok => toast(ok ? 'Backed up' : (state.cloudError || 'A backup is already running'))); break;
      case 'cloud-off': state.settings.gistToken = null; state.settings.gistId = null; state.cloudError = null; save(); render(); break;
      case 'setup-restore': ui.setupRestore = !ui.setupRestore; render(); break;
      case 'reset-confirm': ui.confirm = 'reset'; render(); break;
      case 'reset': { stopTimer(); for (const s of state.sessions) Store.deleteSession(s.id); state = E.defaultState(); ui.confirm = null; ui.setupStep = 0; ui.draft = null; ui.checkin = null; ui.sheet = null; renderSheet(); save(); render(); break; }
      case 'delete-session': { const i = state.sessions.findIndex(s => s.id === d.id); if (i >= 0) { const s = state.sessions[i]; snapshot(`Deleted ${s.dayName} (${fmtDate(s.date)})`, { restoreSession: s }); state.sessions.splice(i, 1); Store.deleteSession(d.id); save(); render(); } break; }
    }
  });
  // Restore a backup (pasted text or a chosen file). Untrusted: it goes through the sanitizer and can
  // never carry a cloud token, a gist id or an undo snapshot; only this device's own token survives.
  function restoreFromText(txt) {
    let fresh;
    try {
      if (txt.length > 20e6) throw new Error('too large');
      const obj = JSON.parse(String(txt).replace(/^\uFEFF/, ''));
      if (!obj || typeof obj !== 'object' || !obj.settings || !obj.program) throw new Error('bad');
      fresh = cleanState(obj, false);
      if (!fresh.setupDone) throw new Error('no maxes');
    } catch (e) { toast('That does not look like a Readyset backup'); return false; }
    if (state.current) { toast('Finish or discard the session in progress first'); return false; }
    if (state.setupDone && state.sessions.some(x => !x.skipped)) { ui.pendingRestore = fresh; render(); scrollToY(0); return false; }
    return applyRestore(fresh);
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
  function applyRestore(fresh) {
    ui.pendingRestore = null;
    try {
      const keepToken = state.settings.gistToken, keepGist = state.settings.gistId;
      const oldIds = state.sessions.map(x => x.id);
      stopTimer(); state = fresh; state.current = null;
      if (keepToken) { state.settings.gistToken = keepToken; state.settings.gistId = keepGist; }
      migrate(); Store.pushAll(state);
      for (const id of oldIds) if (!state.sessions.some(x => x.id === id)) Store.deleteSession(id);
      save(); ui.showImport = false; ui.setupRestore = false; ui.checkin = null; ui.confirm = null;
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
    if (t.dataset.set) { clearTimeout(typeTimer); pendingType = null; setField(Number(t.dataset.ei), Number(t.dataset.si), t.dataset.set, t.value); return; }
    if (t.dataset.setting) {
      applySetting(t.dataset.setting, t.type === 'checkbox' ? t.checked : t.value);
      // Re-render for taps (selects, checkboxes); for typed fields only refresh the dependent text,
      // so the next tap after leaving a field is not swallowed by a rebuild.
      if (t.tagName === 'SELECT' || t.type === 'checkbox') render();
      else { const el = $('#tm-line'); if (el) el.textContent = tmLine(); }
      return;
    }
    if (t.dataset.action === 'import-file') { restoreFromFile(t); return; }
    if (t.dataset.edit) { applyEditField(t); return; }
    if (t.dataset.backfill && ui.backfill) { ui.backfill[t.dataset.backfill] = t.value; return; }
    if (t.dataset.action === 'swap') { swapExercise(Number(t.dataset.ei), t.value); return; }
    if (t.dataset.action === 'notes') { state.current.notes = t.value; save(); return; }
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
    f.el.click();
  }, { passive: false });
  let typeTimer = null, pendingType = null, notesTimer = null;
  function applyPendingType() {
    clearTimeout(typeTimer); typeTimer = null;
    const p = pendingType; pendingType = null;
    if (p && state.current && state.current.exercises[p.ei]) setField(p.ei, p.si, p.which, p.val, true);
  }
  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.dataset.draft && t.type !== 'checkbox') draft()[t.dataset.draft] = t.value;
    if (t.dataset.calc) { const [l, k] = t.dataset.calc.split(':'); const dr = draft(); dr.calc[l] = dr.calc[l] || {}; dr.calc[l][k] = t.value; }
    // Save set inputs as you type, so a closed app mid-entry loses nothing.
    if (t.dataset.set && state.current) { clearTimeout(typeTimer); pendingType = { ei: Number(t.dataset.ei), si: Number(t.dataset.si), which: t.dataset.set, val: t.value }; typeTimer = setTimeout(applyPendingType, 350); }
    if (t.dataset.edit) applyEditField(t);
    // Notes save as you type too (they used to wait for the box to lose focus).
    if (t.dataset.action === 'notes' && state.current) { state.current.notes = t.value.slice(0, 1000); clearTimeout(notesTimer); notesTimer = setTimeout(() => Store.saveLocal(state), 400); }
  });
  // Closing or switching away from the app: write whatever is half-typed right now. iOS can kill a
  // backgrounded web app without warning, and these events are the last chance to save.
  // Only once the stored data has loaded cleanly: before that (or on the recovery screen) the
  // in-memory state is a blank default, and saving it would overwrite what is on the device.
  let booted = false;
  function saveNow() {
    if (!state || !booted) return;
    try {
      applyPendingType();
      clearTimeout(notesTimer); notesTimer = null;
      const n = $('#sess-notes'); if (n && state.current) state.current.notes = n.value.slice(0, 1000);
      Store.saveLocal(state); Store.flush();
    } catch (e) { /* never block closing */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
  window.addEventListener('pagehide', saveNow);
  // The page itself never scrolls, but iOS can nudge it up to make room for the keyboard and leave
  // it there; put it back once no field has focus.
  document.addEventListener('focusout', () => setTimeout(() => {
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
    if (window.scrollY || document.documentElement.scrollTop) window.scrollTo(0, 0);
  }, 120));

  // ---------- Boot ----------
  async function boot() {
    const h = (location.hash || '').replace('#', '');
    if (['today', 'program', 'history', 'settings'].includes(h)) view = h;
    state = E.defaultState();
    $('#main').innerHTML = '<p class="empty">Loading…</p>';
    let loaded = null;
    try { loaded = await Store.init(); } catch (e) { loaded = null; }
    try {
      if (loaded) state = cleanState(loaded, true);
      migrate();
      render();
      booted = true;
    } catch (e) {
      // Never leave a dead page: whatever is stored can still be copied out or replaced.
      recoveryCard(e);
      return;
    }
    if (state.current && state.current.phase === 'lift') { resumeTimer(); keepAwake(); }
    if (state.current && state.current.phase === 'cardio' && state.current.cardioRun) requestAnimationFrame(tickCardio);
    if (Cloud.available() && (state.cloudError || sessionsSinceBackup())) Cloud.schedule();
  }
  function recoveryCard(err) {
    const raw = (() => { try { return localStorage.getItem(Store.key) || ''; } catch (e) { return ''; } })();
    $('#tabbar').hidden = true;
    $('#main').innerHTML = `<div class="card"><h2>Something in the saved data could not be read</h2>
      <p class="small muted">${esc(String(err && err.message || err))}</p>
      <p>Your stored data is below. Copy it somewhere safe, then start over or restore from a backup.</p>
      <label class="f">Stored data<textarea id="recovery-text" rows="5" readonly>${esc(raw)}</textarea></label>
      <div class="btnrow"><button class="btn" id="recovery-copy">Copy stored data</button><button class="btn danger" id="recovery-reset">Start over</button></div></div>`;
    $('#recovery-copy').addEventListener('click', () => { const ta = $('#recovery-text'); ta.select(); try { document.execCommand('copy'); } catch (e) { /* ignore */ } if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(raw).catch(() => {}); toast('Copied'); });
    $('#recovery-reset').addEventListener('click', () => { booted = false; try { localStorage.removeItem(Store.key); } catch (e) { /* ignore */ } location.reload(); });
  }
  // One-time upgrade steps for data saved by earlier versions.
  function migrate() {
    if (!state.migratedV2 && state.setupDone) {
      // Run every already-logged session through the calibration it never had, oldest first.
      const lines = [];
      for (const sess of state.sessions) {
        if (sess.skipped || sess.calibrated) continue;
        const l = E.calibrate(state, sess); sess.calibrated = true;
        l.forEach(x => { addLog(x); lines.push(`${fmtDate(sess.date)}: ${x}`); });
      }
      if (state.sessions.some(x => !x.skipped)) lines.push(`Maxes now: squat ${state.lifts.squat.oneRM}, bench ${state.lifts.bench.oneRM}, deadlift ${state.lifts.deadlift.oneRM}. From here on they calibrate after every session.`);
      if (lines.length) state.lastReport = { title: 'Your logged sessions, re-read by the new calibration', lines };
      state.migratedV2 = true; save();
    }
  }
  boot();
})();
