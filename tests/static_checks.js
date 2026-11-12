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
// Nothing else runs app.js outside a browser: a syntax error there passes the build and the other
// suites, and the phone shows a blank page. Compile (never run) each source and each built inline script.
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
