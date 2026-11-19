// Static checks on the sources and the built files: the layout rules behind the rest bar and RPE
// sheet fix, the app's display name, and the identifiers that phones already running the app
// depend on (storage keys, cache names, the build meta tag, the manifest's install fields).
// Run: node tests/static_checks.js   (after python build.py, so the built files are current)
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let fails = 0, checks = 0;
function expect(cond, msg) { checks++; if (!cond) { fails++; console.log('FAIL', msg); } }
const css = read('src/styles.css'), body = read('src/body.html'), app = read('src/app.js'), build = read('build.py');
const rule = (sel) => { const m = new RegExp('(^|\\n)' + sel.replace(/[.#()]/g, '\\$&') + ' \\{([^}]*)\\}').exec(css); return m ? m[2] : ''; };

// ---------- One coordinate system: nothing is placed against the screen ----------
// iOS can lay out or hit-test the fixed layer against a different box than the app's own (the rest
// bar ended up under the tab bar and RPE taps landed one row low). Everything drawn on top lives in #app.
expect(!/position:\s*fixed/.test(css), 'styles.css has no position: fixed');
expect(!/position:\s*fixed/.test(app), 'app.js sets no position: fixed');
expect(/position:\s*relative/.test(rule('#app')), '#app is the positioning frame (position: relative)');
expect(/height:\s*100%/.test(rule('#app')) && /overflow:\s*hidden/.test(rule('#app')), '#app keeps its size and clipping');
expect(/position:\s*absolute/.test(rule('.timer')) && /bottom:\s*10px/.test(rule('.timer')), 'the rest bar sits 10px above the dock');
expect(!/tabbar-h|--sab|100vw|100vh|dvh/.test(rule('.timer')), 'the rest bar does not repeat the tab bar arithmetic or use screen units');
expect(/height:\s*0/.test(rule('.dock')) && /position:\s*relative/.test(rule('.dock')) && /flex:\s*none/.test(rule('.dock')), 'the dock is a zero-height positioned strip');
expect(/position:\s*absolute/.test(rule('.sheet-bg')) && /inset:\s*0/.test(rule('.sheet-bg')), 'the RPE sheet backdrop covers #app, not the screen');
expect(!/vh|dvh/.test(rule('.sheet')), 'the sheet height is a share of the app, not the screen');
expect(/position:\s*absolute/.test(rule('.toast')) && !/100vw/.test(rule('.toast')), 'the toast is placed in #app');
const iScroller = body.indexOf('id="scroller"'), iDock = body.indexOf('id="dock"'), iTabs = body.indexOf('id="tabbar"'), iOverlay = body.indexOf('id="overlay"');
expect(iScroller > 0 && iDock > iScroller && iTabs > iDock && iOverlay > iTabs && body.trim().endsWith('</div>'), 'body.html: scroller, dock, tab bar, overlay, in that order inside #app');
expect(/\(\$\('#dock'\) \|\| \$\('#app'\) \|\| document\.body\)\.appendChild\(el\)/.test(app), 'the rest bar is added to the dock');
expect(/\(\$\('#app'\) \|\| document\.body\)\.appendChild\(t\)/.test(app), 'the toast is added to #app');
expect(/el\.id = 'timer'/.test(app) && /data-action="timer-add"/.test(app) && /data-action="timer-stop"/.test(app) && app.includes("'#tabbar button, #timer button'"), 'the rest bar keeps its id and buttons (fast tap, flash)');
expect(/window\.addEventListener\('scroll', resyncPage/.test(app) && /visualViewport\.addEventListener\('resize'/.test(app), 'a page left panned is put back');
expect(/function resyncPage\(\) \{\s*try \{\s*if \(fieldFocused\(\)\) return;/.test(app), 'the resync never fights a focused field');
expect((app.match(/setProperty\('--sab'/g) || []).length === 1 && app.includes("setProperty('--sab', '8px')"), 'the only size the script sets is the 8px home-bar gap (it only removes padding)');

// ---------- Every script parses ----------
// Only app_behaviour.js runs app.js outside a browser, and only from src/: a syntax error in a built
// script passes the build and the other suites, and the phone shows a blank page. Compile (never run) each source and each built inline script.
const vm = require('vm');
const parses = (code, name) => { try { new vm.Script(code, { filename: name }); return true; } catch (e) { console.log('  ' + name + ': ' + e.message); return false; } };
for (const f of ['src/engine.js', 'src/sanitize.js', 'src/appcore.js', 'src/app.js']) expect(parses(read(f), f), f + ' parses');

// ---------- Audit 13 cycle 2: small UI fixes that must not quietly come undone ----------
expect(/case 'setup-next':[\s\S]{0,600}<= 2000/.test(app), 'setup checks the max range on the maxes step, not two steps later');
expect(app.includes('e.adjNote && !editing') && app.includes("e.adjNote && s.phase !== 'edit'"), "an edit of a logged session does not show the live session's 'next sets' note");
expect(/syncFoldAll\(\); syncUpdateBar\(\);/.test(app), 'the update bar says what is true now (session or not), not when it was drawn');
expect(/\.set \.ok::after \{[^}]*inset: -4px/.test(css), 'the tick keeps a 44px+ target on narrow phones');

// ---------- Audit 13 cycle 3 ----------
expect(app.includes("case 'warm-close':") && app.includes("data-action=\"${foldWarm ? 'warm-open' : 'warm-close'}\""), 'warm-ups shown again can be folded again');
expect(/Use \$\{useW\}/.test(app) && /function reaims\(s, e\)/.test(app) && /if \(!reaims\(s, e\)\) return;/.test(app), "the typo check's Use button names the weight the set will actually get (today's corrected plan)");
expect(/case 'set-day':[^\n]*Keep at least one training day/.test(app), 'Settings cannot clear every training day (an empty list reloads as the defaults)');
// The label's guard is check-use's own "back to the plan" test plus the re-aim guard, so the two cannot drift apart.
expect(app.includes("const useW = o.field === 'w' && o.use != null && !x.done && x.kind === 'work' && o.use === x.w && reaims(state.current, e) && e.target > 0 ? e.target : o.use;") && app.includes("const back = a === 'check-use' && o.field === 'w' && !x.done && val === x.w;") && app.includes("const val = a === 'check-use' ? o.use : o.v;"), "the Use label and check-use agree on when the set goes back to today's corrected plan");

// ---------- Audit 13 follow-up: one miss rule (decision 5) ----------
// A short set is a miss only at RPE 9+ or unrated (engine.js missedSet); the app and the simulator use that rule, not their own.
expect(app.includes('missed: E.missedSet(x)') && !/missed: zero \|\| reps < x\.reps/.test(app), 'the in-session correction takes its miss rule from the engine');
expect(read('dev/sim/sim3.js').includes('missed: E.missedSet ? E.missedSet(x) : reps < x.reps'), 'the simulator mirrors the app (the engine rule, or the old one for an older engine)');
{ const eng = read('src/engine.js'); expect(!eng.includes('x.actualReps != null && x.actualReps < x.reps') && !eng.includes(': x.reps) < x.reps).length') && eng.includes('const missed = work.filter(missedSet).length;') && eng.includes('&& x.done && missedSet(x))'), 'the engine computes misses in one place (calibration and the weekly review use missedSet)'); }

// ---------- Audit 14: a past session in a deload, easy or test week is logged as planned ----------
// The live check-in forces "as planned" in those weeks (submitCheckin); Log a past session must agree, or a test logged as light loses its result.
expect(app.includes("const mode = !backfillFixed() && E.MODES[b.mode] ? b.mode : 'full';") && /function backfillFixed\(\) \{ const pos = E\.positionLabel\(state\); return pos\.isRest \? [^}]*pos\.isDeload \? [^}]*pos\.isTest \? /.test(app) && app.includes("${fixed ? `<p class=\"small muted\">Logged as planned"), 'Log a past session offers no mode in a deload, easy or test week and starts it as planned');
// A day the two-red rule made light is one bad week (weeklyReview's lightsBlock skips forcedLight), live or logged after the fact.
expect(app.includes("if (P.lightRestOfWeek && mode === 'light') sess.forcedLight = true;") && !/forcedLight = true[^\n]*/.test(app.replace("if (P.lightRestOfWeek && mode === 'light') sess.forcedLight = true;", '')), 'a light session in a two-red week is marked forced, back-filled or live');
// A drawing error after a good restore must not say the backup was bad (audit 13 C1-19): render() runs outside the restore's try.
{ const ar = app.slice(app.indexOf('function applyRestore('), app.indexOf('function restoreFromFile(')); expect(/\} catch \(e\) \{ toast\('That does not look like a ReadySet backup'\); return false; \}\s*\/\/[^\n]*\n\s*try \{ render\(\); \} catch \(e\) \{ toast\('Restored\./.test(ar) && !/toast\(`Restored: [^\n]*`\); \} render\(\);/.test(ar), 'applyRestore draws outside its try, so a late error cannot call a good backup bad'); }
// The recovery card says Copied only when a copy worked, and says how to reach a restore.
expect(!app.includes("writeText(raw).catch(() => {}); toast('Copied');") && app.includes("writeText(raw).then(() => said(true), () => said(ok))") && app.includes('then tap Start over; the setup screen can then restore a backup.'), 'the recovery card tells the truth about copying and how to restore');
// History says "skipped" only for a slot that was skipped; an exercise with nothing ticked is "not done".
expect(app.includes("(s.skippedSlots || []).includes(e.slotKey) ? 'skipped' : 'not done'") && !app.includes(".join(', ') || '<span class=\"muted\">skipped</span>'"), 'History tells a skipped slot from an exercise not done');
// The layoff card names the block a restart goes back to (in an easy or deload week "this block" was unclear).
expect(app.includes("`restart the ${E.BLOCKS[P.blockIdx].name} block at week 1, maxes 2.5% lower, first week 2.5% lighter`") && !app.includes("'restart this block at week 1"), 'the layoff card names the block it restarts');
// Log a past session starts in the mode Today previews (renderToday's planMode): light in a two-red week, trimmed while pushing on.
expect(app.includes("ui.backfill = { date: dt, mode: P.lightRestOfWeek ? 'light' : P.pushOn ? 'trim' : 'full' };") && app.includes("const planMode = lightWk ? 'full' : P.lightRestOfWeek ? 'light' : P.pushOn ? 'trim' : 'full';"), 'Log a past session defaults to the mode Today previews');

// ---------- The display name ----------
const NAME_FILES = ['src/app.js', 'src/appcore.js', 'src/engine.js', 'src/sanitize.js', 'src/body.html', 'build.py', 'README.md', 'PROGRAM_GUIDE.md'];
for (const f of NAME_FILES) expect(!read(f).includes('Readyset'), `${f}: the name is written ReadySet`);
expect(body.includes('Ready<span>Set</span>'), 'header brand: Ready + accented Set');
expect(build.includes("'<title>ReadySet</title>"), 'page title');
expect((build.match(/apple-mobile-web-app-title" content="ReadySet"/g) || []).length === 2, 'Add to Home Screen name, both copies');
expect(build.includes('"name":"ReadySet","short_name":"ReadySet"'), 'manifest names');

// ---------- Identifiers the installed app and its data depend on (never renamed) ----------
for (const id of ["key: 'readyset.v1'", "Store.key + '.unreadable'", "Store.key + '.opens'", "FOLD_KEY = 'readyset.folds'", "'rs-view'", "'rs-scroll'", "'rs-sheet'", "'rs-ui'", "'rs-reloaded-for'", 'meta[name="readyset-build"]', "<meta name=\"readyset-build\"", "tag: 'readyset-rest-'", '`readyset-backup-${']) expect(app.includes(id), 'app.js keeps ' + id);
for (const id of ["const CACHE = 'readyset-' + BUILD", "FONT_CACHE = 'readyset-fonts'", "REST_CACHE = 'readyset-rest', REST_KEY = './__rest__'", "tag: 'readyset-rest-' + r.at", '<meta name="readyset-build" content="__BUILD__">', "html.includes('<meta name=\"readyset-build\"') && html.trimEnd().endsWith('</html>')", "'readyset.html'"]) expect(build.includes(id), 'build.py keeps ' + id);

// ---------- Audit 14, cycle 3 ----------
// Tap targets of 44px (layout rule 11): the set weight and reps fields, and the Settings table inputs.
const minH = (r) => { const m = /min-height:\s*(\d+)px/.exec(r); return m ? Number(m[1]) : 0; };
expect(minH(rule('.set .field input')) >= 44, 'set weight and reps fields are at least 44px high');
const tdIn = /\ntd input\[type=number\] \{([^}]*)\}/.exec(css);
expect(minH(tdIn ? tdIn[1] : '') >= 44, 'Settings table inputs (accessory weights) are at least 44px high');
expect(/min-width:\s*44px/.test(rule('.chips button')) && minH(rule('.chips button')) >= 44, 'plate and day chips are at least 44x44 (the "5" chip was 37px wide)');
// A15-C1-02: a select draws no ::after, so the small button's 44px touch area never reached the session's
// "Swap…" select (36px tall). It is 44px itself.
expect(minH(rule('select.btn.sm')) >= 44, 'the small select buttons (Swap…) are at least 44px high');
// A15-R1-05 (rule 12): a checkbox label's text and its muted note are one flex item, or the note drops to its
// own line under the box. Every checkbox row wraps its text in span.chk-l, and that span may shrink.
const chkRows = app.match(/<label class="row"[^>]*><input type="checkbox"[^>]*>[^<]*(<[a-z]+[^>]*>)?/g) || [];
expect(chkRows.length >= 7 && chkRows.every(r => / <span class="chk-l">$/.test(r)), 'every checkbox label keeps its text and note in one span (' + chkRows.length + ' rows)');
expect(/\.row > \.chk-l \{[^}]*flex: 1 1 0;[^}]*min-width: 0;/.test(css), 'the checkbox label text may shrink beside its box');
// A15-C2-02: a one-line checkbox row (the whole row toggles the box) was 28 px tall; the Remove-sets x was 40 px
// at under 360 px with no larger touch area. Both are 44 px targets.
expect(minH(rule('label.row')) >= 44, 'every checkbox row is at least 44px high');
expect(/@media \(max-width: 359px\) \{[\s\S]*?\.set \.del::after \{ content: ""; position: absolute; inset: -4px; \}/.test(css), 'the 40px Remove-sets x is tapped at 44px under 360px');
// A15-C3-01: the small buttons' touch area is the ::after box, measured from inside the 1 px border: -4px gave 42 px
// (seen by elementFromPoint in headless Edge). -5px gives 36 + 2 x 4 = 44. A15-R2-05: "Close details" (36 px wide) gets
// the same on all four sides.
expect(/\.btn\.sm::after \{ content: ""; position: absolute; left: 0; right: 0; top: -5px; bottom: -5px; \}/.test(css), 'small buttons are tapped at 44 px tall (::after 5 px out from inside the border)');
expect(/\.pt-head \.btn\.icon::after \{ inset: -5px; \}/.test(css) && /\.pt-head \.btn\.icon \{ min-width: 36px;/.test(css), 'the 36 px "Close details" is tapped at 44 x 44');
// A15-R3-02: a step with Earlier / Later keeps the details' height (app.js redrawTrend), and the buttons sit at its foot,
// so at the top of History neither they nor the chart move.
expect(/\.pt-nav \{ align-items: center; flex-wrap: wrap; margin-top: auto; \}/.test(css) && /\.pt-card \{[^}]*display: flex; flex-direction: column;/.test(css), 'Earlier / Later sit at the foot of the chart details');
// A15-C4-02: the session number between Earlier and Later is as wide as its widest value from the first step, so the
// row does not re-wrap (moving Later from under the finger) when "9 of 84" becomes "10 of 84".
expect(/\.pt-pos \{ display: inline-block; text-align: center; \}/.test(css) && /\.pt-pos::after \{ content: attr\(data-w\); display: block; height: 0; overflow: hidden; visibility: hidden; \}/.test(css), 'the Earlier / Later row keeps its layout as the session number gains a digit');
// A15-R2-07: "Build my program" stays on one line beside "Back" (it wrapped at 320, 360 and 375 px).
expect(/\[data-action="setup-finish"\] \{ white-space: nowrap; \}/.test(css) && app.includes('data-action="setup-finish">Build my program</button>'), '"Build my program" does not wrap');
// A15-R2-06: the three rest labels take two lines at every phone width ("Accessory rest (sec)" alone wrapped at 402).
expect(['Main', 'Second', 'Accessory'].every(n => app.includes(`<label class="f"><span>${n} <br>rest (sec)</span><input id="set-r`)), 'the three rest labels break at the same place');
// A15-R1-02: under 400 px the exercise-choice selects take the full row (the names were cut, "(auto)" with them).
expect(/@media \(max-width: 399px\) \{ \.swap-row \{ grid-template-columns: minmax\(0, 1fr\);/.test(css), 'under 400 px each exercise choice sits under its slot name');
// The save bar speaks of sets and finishing the session only when a session is open (A14). It is short enough to take
// three lines on a 320 px phone (it took seven), and each of its messages still says why and what to do (A15).
{ const msgs = [...app.matchAll(/'((?:Sets n|N)ot saved: [^']*)'/g)].map(m => m[1]);
  const sess = (/this\.lastError = s && s\.current \? '([^']*)'/.exec(app) || [])[1] || '', idle = (/\n\s*: '([^']*)'; \/\/ no session open/.exec(app) || [])[1] || '', write = (/catch \(e\) \{ this\.lastError = '([^']*)'/.exec(app) || [])[1] || '';
  expect(msgs.length === 3 && [sess, idle, write].every(m => msgs.includes(m)), 'the three storage messages are found (a session open, none open, the data not written)');
  expect(/\bsets\b/i.test(sess) && /finish/i.test(sess) && ![idle, write].some(m => /\bsets?\b|finish/i.test(m)), 'the storage-full message speaks of sets and finishing only when a session is open');
  expect([sess, idle, write].every(m => /Keep ReadySet open/.test(m) && /tap Save backup\.$/.test(m) && m.length <= 95), 'each storage message says to keep ReadySet open and tap Save backup, in at most 95 characters');
  expect(/storage full or blocked/.test(sess) && /storage full or blocked/.test(idle) && /could not be written/.test(write), 'each storage message still says why the save failed'); }
// Editing a test session before its week ends feeds the block-end result, so it must not say "leaves them alone".
expect(app.includes("lines.push(inBlock(s) ? 'A test sets the maxes once, when the test week ends: the edited singles count then.' : 'A test sets the maxes once, at its end, so this edit leaves them alone.')"), 'an edit of a test session says whether it still counts');
// Two windows: a window that sees newer data from the other one (while it has a session open) is behind. It
// never saves again (close, hide, a timer, a tap, a fold, a typed note: nothing), and it reloads onto the newer
// copy when it comes back to the front or is touched, so nothing is ever built on the older copy.
expect(/saveLocal\(s, full\) \{[^\n]*\n\s*if \(this\.stale\) return;/.test(app) && /save\(s\) \{\n\s*if \(this\.stale\) return;[^\n]*\n\s*s\.updatedAt = Date\.now\(\);/.test(app)
  && app.includes("else { Store.stale = true; if (document.visibilityState === 'visible') toast(") && (app.match(/Store\.stale\s*=[^=]/g) || []).length === 1 && !/this\.stale\s*=[^=]/.test(app),
  'a window that is behind never saves, and nothing but a reload ends that');
expect(app.includes("if (e.newValue === Store.last) return;") && app.includes("if (up < (state.updatedAt || 0)) return;") && !app.includes("if (up <= (state.updatedAt || 0)) return;"),
  'typed notes from another window (same updatedAt, other bytes) also put this window behind');
expect(app.includes("if (!Store.stale || !booted) return;\n    reloading = true; booted = false;") && /function refreshStale\(\) \{[\s\S]{0,400}?location\.reload\(\);\n  \}/.test(app)
  && app.includes("document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshStale(); });")
  && app.includes("for (const t of ['pointerdown', 'keydown']) document.addEventListener(t, (ev) => { if (ev.isTrusted) refreshStale(); }, { capture: true, passive: true });"),
  'a window that is behind reloads onto the newer copy when it is looked at or touched');
expect(app.includes("try { sessionStorage.setItem('rs-view', view); sessionStorage.setItem('rs-caught-up', '1'); } catch (x) { /* ignore */ }\n    location.reload();")
  && app.includes("if (sessionStorage.getItem('rs-caught-up')) { sessionStorage.removeItem('rs-caught-up'); toast('Reloaded with the changes from your other ReadySet window.'); }")
  && app.includes("if (!state.current) { reloading = true; booted = false; try { sessionStorage.setItem('rs-view', view); } catch (x) { /* ignore */ } location.reload(); }"),
  'the reload keeps the tab and says once why it happened; a window with no session open reloads at once');
// A14-C5-03: a window that is behind sends nothing to the account copy either (claude.ai copy only).
expect(/pushState\(s\) \{\n\s*if \(!this\.db \|\| this\.stale\) return;/.test(app) && /pushSession\(sess\) \{\n\s*if \(!this\.db \|\| this\.stale\) return;/.test(app)
  && app.includes('pushAll(s) { if (this.stale) return; this.pushState(s);') && app.includes('deleteSession(id) { if (!this.db || this.stale) return;'),
  'a window that is behind pushes no state, session or delete to the account');
// A14-R4-04: a pending update download does not blind the storage handler (only booted, which every reload it starts turns off).
expect(/window\.addEventListener\('storage', \(e\) => \{\n\s*if \(e\.key !== Store\.key \|\| !booted\) return;/.test(app) && !/addEventListener\('storage'[^\n]*\n[^\n]*reloading\) return;/.test(app),
  "another window's save is seen while an update download is pending");
// A14-C2-10: sheets take the focus when they open and give it back when they close, without scrolling the page.
expect(/function renderSheet\(\) \{\n\s*const before = sheetOpen;\n\s*drawSheet\(\);\n\s*sheetOpen = !!document\.querySelector\('#overlay \.sheet'\);\n\s*if \(sheetOpen && !before\) sheetOpened\(\); else if \(!sheetOpen && before\) sheetClosed\(\);/.test(app)
  && app.includes("function focusQuiet(el) { if (el && el.isConnected) try { el.focus({ preventScroll: true }); }") && /function sheetClosed\(\) \{[\s\S]{0,200}queueMicrotask\(/.test(app)
  && (app.match(/function renderSheet\(/g) || []).length === 1 && (app.match(/function drawSheet\(/g) || []).length === 1 && !/[^.\w]drawSheet\(\);/.test(app.replace('    drawSheet();\n    sheetOpen', '')),
  'sheets move the focus in and back, and every caller goes through renderSheet');
// A14-C1-12: "Fix it" keeps the typed digits; the value is checked again on tick (markDone reads the field) and on leaving the field.
expect(app.includes("if (a === 'check-fix') { render(); fixField(") && /function fixField\(inp, v\) \{\n\s*if \(!inp\) return;\n\s*inp\.value = String\(v\); inp\.dataset\.recheck = '1';/.test(app)
  && /addEventListener\('focusout', \(ev\) => \{\n\s*const t = ev\.target;\n\s*if \(!t \|\| !t\.dataset \|\| !t\.dataset\.recheck\) return;\n\s*delete t\.dataset\.recheck;[\s\S]{0,200}setField\(Number\(t\.dataset\.ei\), Number\(t\.dataset\.si\), t\.dataset\.set, t\.value\);/.test(app)
  && app.includes("if (t.dataset.set) { commitSet(t); return; }") && /function commitSet\(t\) \{ \/\/ what a change event on a set field does\n\s*delete t\.dataset\.recheck; clearTimeout\(typeTimer\);/.test(app) && app.includes("if (wEl && wEl.value !== '') { const v = cleanW(wEl.value);") && /const odd = oddEntry\(e, x, x\.actualW, x\.actualReps\);\n\s*if \(odd\) \{[\s\S]{0,300}?if \(f && f\.value !== ''\) odd\.typed = f\.value;[\s\S]{0,200}?openCheck\(ei, si, odd, 'tick'\); return false;/.test(app)
  && app.includes("if (odd) { odd.typed = String(val); openCheck(ei, si, odd, 'none'); return; }") && app.includes("o.typed != null ? o.typed : o.v);"),
  '"Fix it" keeps the digits, and they are checked again on tick and on blur');
// A14-C2-09: "Use" on a carried weight puts that weight back as it was.
expect(app.includes("if (a === 'check-use' && o.carried) {") && app.includes("x.actualW = val; delete x.autoW; const inp = $(`#w-${sh.ei}-${sh.si}`); if (inp) inp.value = val;"), '"Use" a carried weight restores it without moving the plan');
// A14-C1-26: the desktop fallback counts a backup only when the save dialog says the file is written, or (a plain download) once it starts, and says only that.
expect(/await w\.close\(\); sharing = false; noteBackup\('file'\); toast\('Backup file saved'\);/.test(app) && /if \(e && e\.name === 'AbortError'\) \{ sharing = false; return; \}/.test(app)
  && app.includes("a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);\n      noteBackup('file'); toast('Backup download started.") && (app.match(/toast\('Backup file saved'\)/g) || []).length === 1,
  'a backup file counts once written (save dialog) or once its download starts, and the toast says which');
// A14-C2-12: the build's own checks survive python -O (no assert guards a check).
expect(!/^\s*assert\b/m.test(build) && (build.match(/^\s*check\(/gm) || []).length === 4 && build.includes("raise SystemExit('build check failed: ' + why)"), 'build.py checks are explicit, not assert');
// A mid-session rebase says what changed: a bar or plate change re-rounds, it does not bring a new max.
expect((app.match(/rebaseSession\('Remaining sets re-rounded to your bar and plates'\)/g) || []).length === 2, 'a bar or plate change says the remaining sets were re-rounded');
expect(/rebaseSession\(`Remaining sets rebased to the Training Max at \$\{/.test(app) && /markCalibBase\(\); addLog\(`\$\{LIFTNAME\[l\]\} 1RM set to \$\{v\} by hand\.`\); rebaseSession\(\);/.test(app) && app.includes("toast(why || 'Remaining sets rebased to the new max')"), 'a Training Max % change names the Training Max; a max change keeps "the new max"');

// ---------- The built files (skipped with a note if they are missing) ----------
const has = (p) => fs.existsSync(path.join(ROOT, p));
if (has('docs/index.html') && has('docs/manifest.webmanifest') && has('readyset.html')) {
  const idx = read('docs/index.html'), art = read('readyset.html'), sw = read('docs/sw.js'), ver = read('docs/version.txt');
  let man = null; try { man = JSON.parse(read('docs/manifest.webmanifest')); } catch (e) { man = null; }
  expect(!!man, 'manifest parses');
  expect(man && man.name === 'ReadySet' && man.short_name === 'ReadySet', 'manifest name and short_name are ReadySet');
  expect(man && man.start_url === './index.html' && man.scope === './' && man.display === 'standalone' && !('id' in man), 'manifest start_url, scope, display unchanged and no id');
  for (const [n, t] of [['docs/index.html', idx], ['readyset.html', art], ['docs/sw.js', sw]]) { expect(!t.includes('Readyset'), n + ': no old spelling of the name'); expect(!t.includes('\r'), n + ': LF only'); }
  expect(idx.includes('<title>ReadySet</title>') && idx.includes('apple-mobile-web-app-title" content="ReadySet"'), 'built page title and home-screen name');
  const m = /<meta name="readyset-build" content="([a-f0-9]{12})">/.exec(idx);
  expect(!!m && ver.trim() === m[1] && /^[a-f0-9]+\n$/.test(ver) && sw.startsWith(`const BUILD = '${m && m[1]}';`), 'build id: meta tag, version.txt (bare hex) and worker agree');
  expect(idx.trimEnd().endsWith('</html>'), 'page ends in </html> (the worker checks it)');
  expect(!/position:\s*fixed/.test(idx), 'built page has no position: fixed');
  const inline = [...idx.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  expect(inline.length >= 5 && inline.every((c, i) => parses(c, 'docs/index.html script ' + (i + 1))), 'every inline script of the built page parses');
  expect(parses(sw, 'docs/sw.js'), 'the built service worker parses');
} else console.log('note: built files missing; run python build.py first for the output checks');

console.log(`${checks} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
