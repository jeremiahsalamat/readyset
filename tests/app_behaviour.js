// Behavioural tests for src/app.js (A14-C1-22). The real engine.js, sanitize.js, appcore.js and
// app.js run in a node vm context per window, on a small fake DOM built from the HTML app.js draws,
// with a localStorage shared by the windows of one origin (and the storage events a browser sends
// between them), a sessionStorage per tab, and one manual clock for Date, timers and
// performance.now. Each test drives the app as a person does: it clicks the buttons the app drew,
// types into its fields, and reads back what the app stored. Nothing in app.js is changed or
// exported for this; no dependencies.
// Covered: finishing a session and the reviews after it (completeSession, afterSession), a session
// logged after the fact in a test week (A14-C1-01) and in a two-red week (A14-R1-01), editing and
// deleting a logged session and its Undo, two windows (a window that is behind never writes, the
// same time with other bytes is newer, no takeover, account pushes while behind (A14-C5-03), an
// update download pending (A14-R4-04), a save made while a window waits for the account, a window
// that changed nothing writes nothing (A14-H-01), and a repair made on load is still saved), "Fix it"
// and the carried "Use" on the typo check (A14-C1-12, A14-C2-09), focus into and out of the sheets
// (A14-C2-10), when a backup counts (A14-C1-26), restoring the copy set aside after an error
// (A14-C1-20), the update and save bars keeping the sets under the finger (A15-C1-01), the two-tap skip
// (A15-C1-03), the set rows' button labels (A15-C1-05) and no two session buttons alike (A15-R1-06), and
// the taps ignored just after a tick opens the RPE sheet (A15-R1-01) or a set is deleted (A15-C2-01), with
// trusted clicks (trustedTap): only those reach the double-tap guard and the quiet windows; "Remove sets" held under the finger
// (A15-C2-03), named check-in answer groups (A15-C2-05), the tick putting its fill-ins back when the typo check stops it
// (A15-C2-06), a value the typo check would question neither saved nor used while it is only typed, tested the iPhone's
// way: type() sends input only, with no blur and no change event, then a trustedTap (A15-R2-01), and asked about before
// any other tap acts, never dropped without a word, while the rest bar's click and an open sheet are left alone
// (A15-R3-01, A15-C4-01); the tab bar and the rest bar by touch (fastTap: the app's own fast tap) and the row's own RPE
// button ask first too (A15-R4-01), each under both models of a blur made by script (page.blurChange: model N sends no
// change, model W sends it when the field was edited; BLUR_MODEL=W runs every page under W); a sane typed value is
// committed before another session button acts, so it carries as on a desktop (decision 15); the storage-full bar's
// text (A14, A15); the plates under a weight field (A15-R3-04), "Earlier" and "Later" held under the finger, the
// details keeping their height and the row its layout while you step (A15-R2-02, A15-R3-02, A15-C4-02), and the rest bar naming the next exercise after a
// fatigue stop (A15-R2-04) and this one again when cut sets come back (A15-R3-03).
// Run: node tests/app_behaviour.js [project root]   (from the project folder; no build needed)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const readSrc = (f) => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8').replace(/\r\n/g, '\n');
const CODE = ['engine.js', 'sanitize.js', 'appcore.js', 'app.js'].map(f => new vm.Script(readSrc(f), { filename: path.join(ROOT, 'src', f) }));
const BODY = readSrc('body.html');
const KEY = 'readyset.v1';

let checks = 0, fails = 0, current = '';
function expect(cond, msg, ctx) { checks++; if (!cond) { fails++; console.log('FAIL', current + ': ' + msg, ctx !== undefined ? JSON.stringify(ctx).slice(0, 400) : ''); } }
const clone = (x) => JSON.parse(JSON.stringify(x));
const canon = (x) => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().reduce((o, key) => { o[key] = v[key]; return o; }, {}) : v));

// ---------- A small DOM: enough of it for what app.js draws and reads ----------
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => (s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(/^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m)));
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const kebab = (k) => String(k).replace(/[A-Z]/g, c => '-' + c.toLowerCase());
class Listeners {
  constructor() { this.ls = {}; }
  add(type, fn, opt) { if (typeof fn !== 'function') return; const capture = opt === true || !!(opt && opt.capture); (this.ls[type] = this.ls[type] || []).push({ fn, capture, once: !!(opt && opt.once) }); }
  remove(type, fn, opt) { const capture = opt === true || !!(opt && opt.capture), l = this.ls[type]; if (!l) return; const i = l.findIndex(x => x.fn === fn && x.capture === capture); if (i >= 0) l.splice(i, 1); }
}
class Node {
  constructor(doc) { this.ownerDocument = doc; this.parentNode = null; this.childNodes = []; this._l = new Listeners(); }
  addEventListener(t, f, o) { this._l.add(t, f, o); }
  removeEventListener(t, f, o) { this._l.remove(t, f, o); }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get nextSibling() { const p = this.parentNode; if (!p) return null; return p.childNodes[p.childNodes.indexOf(this) + 1] || null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === this.ownerDocument; }
}
class Text extends Node {
  constructor(doc, t) { super(doc); this.nodeType = 3; this.data = String(t); }
  get textContent() { return this.data; } set textContent(v) { this.data = String(v); }
}
function makeStyle() {
  const props = {};
  const api = { setProperty(k, v) { props[k] = String(v); }, removeProperty(k) { delete props[k]; }, getPropertyValue(k) { return props[k] || ''; } };
  return new Proxy(api, { get(t, k) { return k in t ? t[k] : (props[k] != null ? props[k] : ''); }, set(t, k, v) { props[k] = String(v); return true; } });
}
const CTX2D = new Proxy({}, { get(t, k) { if (k === 'measureText') return () => ({ width: 10 }); return k in t ? t[k] : () => {}; }, set(t, k, v) { t[k] = v; return true; } });
class Element extends Node {
  constructor(doc, tag) { super(doc); this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.attrs = new Map(); this.style = makeStyle(); this.scrollTop = 0; this.scrollLeft = 0; this.clientWidth = 320; this.clientHeight = 600; this.offsetWidth = 0; this.offsetHeight = 0; }
  getAttribute(n) { n = String(n).toLowerCase(); return this.attrs.has(n) ? this.attrs.get(n) : null; }
  setAttribute(n, v) { this.attrs.set(String(n).toLowerCase(), String(v)); }
  removeAttribute(n) { this.attrs.delete(String(n).toLowerCase()); }
  hasAttribute(n) { return this.attrs.has(String(n).toLowerCase()); }
  get id() { return this.getAttribute('id') || ''; } set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') || ''; } set className(v) { this.setAttribute('class', v); }
  _cls() { return (this.getAttribute('class') || '').split(/\s+/).filter(Boolean); }
  get classList() {
    const el = this;
    return {
      contains: (c) => el._cls().includes(c),
      add: (...cs) => { const l = el._cls(); for (const c of cs) if (!l.includes(c)) l.push(c); el.setAttribute('class', l.join(' ')); },
      remove: (...cs) => { el.setAttribute('class', el._cls().filter(c => !cs.includes(c)).join(' ')); },
      toggle: (c, force) => { const has = el._cls().includes(c), on = force === undefined ? !has : !!force; if (on && !has) el.classList.add(c); if (!on && has) el.classList.remove(c); return on; },
    };
  }
  get dataset() {
    const el = this;
    return this._ds || (this._ds = new Proxy({}, {
      get: (t, k) => (typeof k === 'string' && el.hasAttribute('data-' + kebab(k)) ? el.getAttribute('data-' + kebab(k)) : undefined),
      set: (t, k, v) => { el.setAttribute('data-' + kebab(k), v); return true; },
      deleteProperty: (t, k) => { el.removeAttribute('data-' + kebab(k)); return true; },
      has: (t, k) => el.hasAttribute('data-' + kebab(k)),
    }));
  }
  get hidden() { return this.hasAttribute('hidden'); } set hidden(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get open() { return this.hasAttribute('open'); } set open(v) { if (v) this.setAttribute('open', ''); else this.removeAttribute('open'); }
  get content() { return this.getAttribute('content') || ''; }
  get disabled() { return this.hasAttribute('disabled'); }
  get type() { return this.getAttribute('type') || (this.tagName === 'INPUT' ? 'text' : ''); }
  get checked() { return this._checked != null ? this._checked : this.hasAttribute('checked'); } set checked(v) { this._checked = !!v; }
  get value() {
    if (this._value != null) return this._value;
    if (this.tagName === 'TEXTAREA') return this.textContent;
    if (this.tagName === 'SELECT') { const os = this.querySelectorAll('option'), o = os.find(x => x.hasAttribute('selected')) || os[0]; return o ? o.value : ''; }
    if (this.tagName === 'OPTION') return this.hasAttribute('value') ? this.getAttribute('value') : this.textContent;
    return this.getAttribute('value') || '';
  }
  set value(v) { this._value = String(v); }
  get validity() { return { badInput: !!this._badInput }; }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get firstElementChild() { return this.children[0] || null; }
  get nextElementSibling() { const p = this.parentNode; if (!p) return null; const s = p.childNodes; for (let i = s.indexOf(this) + 1; i < s.length; i++) if (s[i].nodeType === 1) return s[i]; return null; }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); this.ownerDocument.page.noteAdded(n); return n; }
  insertBefore(n, ref) { if (!ref) return this.appendChild(n); if (n.parentNode) n.parentNode.removeChild(n); const i = this.childNodes.indexOf(ref); n.parentNode = this; this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, n); this.ownerDocument.page.noteAdded(n); return n; }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; return n; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceWith(n) { const p = this.parentNode; if (!p) return; p.insertBefore(n, this); p.removeChild(this); }
  insertAdjacentElement(where, el) { if (where === 'afterend' && this.parentNode) this.parentNode.insertBefore(el, this.nextSibling); else if (where === 'beforeend') this.appendChild(el); else if (where === 'afterbegin') this.insertBefore(el, this.firstChild); else if (where === 'beforebegin' && this.parentNode) this.parentNode.insertBefore(el, this); return el; }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; if (String(v) !== '') this.appendChild(new Text(this.ownerDocument, v)); }
  get innerText() { return this.textContent; }
  get innerHTML() { return this.childNodes.map(serialize).join(''); }
  set innerHTML(html) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; parseInto(this.ownerDocument, this, String(html)); }
  querySelectorAll(sel) { const groups = parseSel(sel), out = []; const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType !== 1) continue; if (matchGroups(c, groups, this)) out.push(c); walk(c); } }; walk(this); return out; }
  querySelector(sel) { const groups = parseSel(sel); let hit = null; const walk = (n) => { for (const c of n.childNodes) { if (hit || c.nodeType !== 1) continue; if (matchGroups(c, groups, this)) { hit = c; return; } walk(c); } }; walk(this); return hit; }
  matches(sel) { return matchGroups(this, parseSel(sel), null); }
  closest(sel) { const g = parseSel(sel); for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (matchGroups(n, g, null)) return n; return null; }
  getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 }; }
  getContext() { return CTX2D; }
  select() {} setSelectionRange() {}
  focus(opts) { const d = this.ownerDocument; if (!this.isConnected) return; d.page.focusLog.push({ el: this, opts: opts || null }); const prev = d.activeElement; if (prev === this) return; if (prev && prev !== d.body) prev.leaving(); d._active = null; if (prev && prev !== d.body) d.page.fire(prev, 'focusout', { relatedTarget: this }); d._active = this; this._atFocus = this.value; d.page.fire(this, 'focusin', {}); }
  blur() { const d = this.ownerDocument; if (d._active !== this) return; this.leaving(); if (d._active !== this) return; d._active = null; d.page.fire(this, 'focusout', {}); }
  // D28: model N (the default) sends no change when the focus leaves; model W sends it first when the value was edited.
  leaving() { const d = this.ownerDocument; if (d.page.blurChange && this.tagName === 'INPUT' && this._atFocus !== undefined && this.value !== this._atFocus) { this._atFocus = this.value; d.page.fire(this, 'change', {}); } }
  click() { this.ownerDocument.page.fire(this, 'click', {}); }
}
function serialize(n) {
  if (n.nodeType === 3) return escText(n.data);
  const tag = n.tagName.toLowerCase(), at = [...n.attrs].map(([k, v]) => ` ${k}="${escText(v).replace(/"/g, '&quot;')}"`).join('');
  return VOID.has(tag) ? `<${tag}${at}>` : `<${tag}${at}>${n.childNodes.map(serialize).join('')}</${tag}>`;
}
const RE_TAG = /[A-Za-z][\w-]*/y, RE_ATTR = /[^\s=>\/]+/y, RE_UNQ = /[^\s>]+/y;
function parseInto(doc, parent, html) {
  const stack = [parent], n = html.length, top = () => stack[stack.length - 1], ws = (c) => c === ' ' || c === '\n' || c === '\t' || c === '\r';
  let i = 0;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt !== i) { const end = lt < 0 ? n : lt; top().appendChild(new Text(doc, decode(html.slice(i, end)))); i = end; continue; }
    if (html.startsWith('<!--', i)) { const e = html.indexOf('-->', i + 4); i = e < 0 ? n : e + 3; continue; }
    if (html[i + 1] === '!') { i = html.indexOf('>', i) + 1 || n; continue; }
    if (html[i + 1] === '/') { const e = html.indexOf('>', i), name = html.slice(i + 2, e).trim().toUpperCase(); for (let k = stack.length - 1; k > 0; k--) if (stack[k].tagName === name) { stack.length = k; break; } i = e < 0 ? n : e + 1; continue; }
    RE_TAG.lastIndex = i + 1; const m = RE_TAG.exec(html);
    if (!m) { top().appendChild(new Text(doc, '<')); i++; continue; }
    const el = new Element(doc, m[0]); let j = i + 1 + m[0].length, selfClose = false;
    while (j < n) {
      while (j < n && ws(html[j])) j++;
      if (html[j] === '>') { j++; break; }
      if (html[j] === '/' && html[j + 1] === '>') { selfClose = true; j += 2; break; }
      RE_ATTR.lastIndex = j; const am = RE_ATTR.exec(html); if (!am) { j++; continue; }
      j += am[0].length; while (j < n && ws(html[j])) j++;
      let val = '';
      if (html[j] === '=') {
        j++; while (j < n && ws(html[j])) j++;
        const q = html[j];
        if (q === '"' || q === "'") { const e = html.indexOf(q, j + 1); val = html.slice(j + 1, e); j = e + 1; } else { RE_UNQ.lastIndex = j; const u = RE_UNQ.exec(html); val = u ? u[0] : ''; j += val.length; }
      }
      el.attrs.set(am[0].toLowerCase(), decode(val));
    }
    top().appendChild(el);
    const t = el.tagName;
    if (t === 'TEXTAREA' || t === 'SCRIPT' || t === 'STYLE') { const close = html.toLowerCase().indexOf('</' + t.toLowerCase(), j), raw = html.slice(j, close < 0 ? n : close); if (raw) el.appendChild(new Text(doc, t === 'TEXTAREA' ? decode(raw) : raw)); i = close < 0 ? n : html.indexOf('>', close) + 1; continue; }
    if (!selfClose && !VOID.has(t.toLowerCase())) stack.push(el);
    i = j;
  }
}
// Selectors: tag, #id, .class, [attr], [attr="v"], :not(...), :scope, descendant and child combinators, lists.
const SEL = new Map();
function parseSel(sel) {
  if (SEL.has(sel)) return SEL.get(sel);
  const s = String(sel).trim(), groups = []; let cur = [], comp = null, comb = null, i = 0;
  const C = () => (comp = comp || { tag: null, id: null, cls: [], attrs: [], not: [], scope: false });
  const flush = () => { if (comp) { cur.push({ comb, c: comp }); comp = null; comb = null; } };
  while (i < s.length) {
    const ch = s[i];
    if (ch === ',') { flush(); groups.push(cur); cur = []; i++; continue; }
    if (/\s|>/.test(ch)) { let j = i, child = false; while (j < s.length && /\s|>/.test(s[j])) { if (s[j] === '>') child = true; j++; } if (comp && s[j] !== ',' && j < s.length) { flush(); comb = child ? '>' : ' '; } i = j; continue; }
    let m;
    if (ch === '#') { m = /^#([\w-]+)/.exec(s.slice(i)); C().id = m[1]; i += m[0].length; continue; }
    if (ch === '.') { m = /^\.([\w-]+)/.exec(s.slice(i)); C().cls.push(m[1]); i += m[0].length; continue; }
    if (ch === '[') { m = /^\[\s*([\w-]+)\s*(?:(\*?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/.exec(s.slice(i)); if (!m) throw new Error('selector not supported: ' + sel); C().attrs.push({ n: m[1].toLowerCase(), op: m[2] || null, v: m[3] != null ? m[3] : m[4] != null ? m[4] : m[5] }); i += m[0].length; continue; }
    if (s.startsWith(':scope', i)) { C().scope = true; i += 6; continue; }
    if (s.startsWith(':not(', i)) { let d = 1, j = i + 5; while (j < s.length && d) { if (s[j] === '(') d++; else if (s[j] === ')') d--; j++; } C().not.push(parseSel(s.slice(i + 5, j - 1))); i = j; continue; }
    if (ch === '*') { C(); i++; continue; }
    m = /^[\w-]+/.exec(s.slice(i)); if (!m) throw new Error('selector not supported: ' + sel);
    C().tag = m[0].toUpperCase(); i += m[0].length;
  }
  flush(); groups.push(cur);
  SEL.set(sel, groups);
  return groups;
}
function matchComp(el, c, scope) {
  if (c.scope && el !== scope) return false;
  if (c.tag && el.tagName !== c.tag) return false;
  if (c.id && el.getAttribute('id') !== c.id) return false;
  if (c.cls.length) { const l = el._cls(); for (const k of c.cls) if (!l.includes(k)) return false; }
  for (const a of c.attrs) { const v = el.getAttribute(a.n); if (v == null || (a.op === '=' && v !== a.v) || (a.op === '*=' && !v.includes(a.v))) return false; }
  for (const g of c.not) if (matchGroups(el, g, scope)) return false;
  return true;
}
function matchParts(el, parts, k, scope) {
  if (!matchComp(el, parts[k].c, scope)) return false;
  if (k === 0) return true;
  if (parts[k].comb === '>') { const p = el.parentNode; return !!p && p.nodeType === 1 && matchParts(p, parts, k - 1, scope); }
  for (let p = el.parentNode; p && p.nodeType === 1; p = p.parentNode) if (matchParts(p, parts, k - 1, scope)) return true;
  return false;
}
function matchGroups(el, groups, scope) { return groups.some(parts => parts.length && matchParts(el, parts, parts.length - 1, scope)); }
class Document extends Node {
  constructor(page) {
    super(null); this.ownerDocument = this; this.page = page; this.nodeType = 9; this._active = null;
    const html = new Element(this, 'html'); html.parentNode = this; this.childNodes = [html]; this.documentElement = html;
    this.head = new Element(this, 'head'); this.body = new Element(this, 'body');
    html.childNodes = [this.head, this.body]; this.head.parentNode = html; this.body.parentNode = html;
  }
  get activeElement() { const a = this._active; return a && a.isConnected ? a : this.body; }
  get visibilityState() { return this.page.visible ? 'visible' : 'hidden'; }
  get hidden() { return !this.page.visible; }
  get scrollingElement() { return this.documentElement; }
  querySelector(s) { return this.documentElement.matches(s) ? this.documentElement : this.documentElement.querySelector(s); }
  querySelectorAll(s) { return (this.documentElement.matches(s) ? [this.documentElement] : []).concat(this.documentElement.querySelectorAll(s)); }
  getElementById(id) { const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType !== 1) continue; if (c.getAttribute('id') === id) return c; const r = walk(c); if (r) return r; } return null; }; return walk(this); }
  createElement(t) { return new Element(this, t); }
  createTextNode(t) { return new Text(this, t); }
  execCommand() { return false; }
  elementFromPoint() { return null; }
}

// ---------- The world: one clock, one origin's localStorage, tabs and the pages loaded in them ----------
const T0 = new Date(2026, 10, 16, 9, 0, 0).getTime(); // a Monday morning, the phone's local time
const BOOT = new vm.Script('(function (g) { g.window = g; g.self = g; g.top = g; g.parent = g; const RD = g.Date, now = g.__now; class D extends RD { constructor(...a) { if (a.length) super(...a); else super(now()); } static now() { return now(); } } g.Date = D; })(this);');
const drain = () => new Promise(r => setImmediate(r)); // every microtask queued so far, and the ones they queue, run first
let WORLDS = [];
class World {
  constructor() { this.now = T0; this.perf = 5000; this.step = 50; this.seq = 0; this.tasks = []; this.tabs = []; this.pages = []; this.local = new Map(); WORLDS.push(this); }
  timer(page, fn, ms, args, repeat) { const id = ++this.seq, d = Math.max(0, Number(ms) || 0); this.tasks.push({ id, at: this.now + d, seq: id, fn: () => fn(...(args || [])), page, every: repeat ? Math.max(1, d) : 0 }); return id; }
  clear(id) { const i = this.tasks.findIndex(t => t.id === id); if (i >= 0) this.tasks.splice(i, 1); }
  storageFor(page) {
    const w = this;
    return {
      getItem: (k) => (w.local.has(String(k)) ? w.local.get(String(k)) : null),
      setItem: (k, v) => w.write(page, String(k), String(v)),
      removeItem: (k) => w.write(page, String(k), null),
      key: (i) => [...w.local.keys()][i] || null,
      get length() { return w.local.size; },
    };
  }
  write(page, k, v) {
    if (!page.alive) return;
    const old = this.local.has(k) ? this.local.get(k) : null;
    if (v == null) this.local.delete(k); else this.local.set(k, v);
    page.writes.push({ k, at: this.now });
    if (old === v) return; // a browser sends no event for a value that did not change
    for (const t of this.tabs) { const p = t.page; if (p && p !== page && p.alive) this.timer(p, () => { p.storageEvents++; p.fire(p.win, 'storage', { key: k, oldValue: old, newValue: v, bubbles: false }); }, 0); }
  }
  async run(until) {
    for (let guard = 0; guard < 200000; guard++) {
      await drain();
      let reloaded = false;
      for (const t of this.tabs) if (t.page && t.page.alive && t.page.reloadAsked) { t.reload(); reloaded = true; }
      if (reloaded) continue;
      let best = null;
      for (const t of this.tasks) if (t.at <= until && (!best || t.at < best.at || (t.at === best.at && t.seq < best.seq))) best = t;
      if (!best) break;
      this.tasks.splice(this.tasks.indexOf(best), 1);
      if (best.at > this.now) { this.perf += best.at - this.now; this.now = best.at; }
      if (best.page && !best.page.alive) continue;
      if (best.every) { best.at += best.every; best.seq = ++this.seq; this.tasks.push(best); }
      best.page.guard(best.fn);
    }
    if (until > this.now) { this.perf += until - this.now; this.now = until; }
  }
  settle() { return this.run(this.now); }
  advance(ms) { return this.run(this.now + ms); }
  raw() { return this.local.get(KEY) || null; }
  stored() { const r = this.raw(); return r ? READER.Engine.sanitizeState(JSON.parse(r), { trusted: true }) : null; }
  tab(name, opts) { const t = new Tab(this, name, opts || {}); this.tabs.push(t); return t; }
}
class Tab {
  constructor(world, name, opts) { this.world = world; this.name = name; this.opts = opts; this.session = memStore(); this.loads = 0; this.visible = opts.visible !== false; this.page = null; }
  async open() { this.page = new Page(this); await this.world.settle(); return this.page; }
  reload() { const old = this.page; old.unload(); this.page = new Page(this); }
}
function memStore() { const m = new Map(); return { getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null), setItem: (k, v) => { m.set(String(k), String(v)); }, removeItem: (k) => { m.delete(String(k)); }, clear: () => m.clear(), get length() { return m.size; } }; }
class Page {
  constructor(tab) {
    const w = this.world = tab.world, page = this, o = tab.opts;
    this.tab = tab; w.pages.push(this); this.load = ++tab.loads; this.name = tab.name + (this.load > 1 ? ' (load ' + this.load + ')' : '');
    this.alive = true; this.visible = tab.visible; this.reloadAsked = false;
    this.blurChange = process.env.BLUR_MODEL === 'W';
    this.toasts = []; this.errors = []; this.focusLog = []; this.writes = []; this.storageEvents = 0; this.downloads = []; this.blobUrls = 0;
    this.doc = new Document(this);
    if (o.build) { const m = new Element(this.doc, 'meta'); m.setAttribute('name', 'readyset-build'); m.setAttribute('content', o.build); this.doc.head.appendChild(m); }
    this.doc.body.innerHTML = BODY;
    this.winL = new Listeners();
    const win = {
      __now: () => w.now,
      console: { log() {}, warn() {}, info() {}, debug() {}, error: (...a) => page.errors.push(new Error('console.error: ' + a.join(' '))) },
      setTimeout: (fn, ms, ...a) => w.timer(page, fn, ms, a, false), clearTimeout: (id) => w.clear(id),
      setInterval: (fn, ms, ...a) => w.timer(page, fn, ms, a, true), clearInterval: (id) => w.clear(id),
      requestAnimationFrame: (fn) => w.timer(page, () => fn(w.perf), 16, [], false), cancelAnimationFrame: (id) => w.clear(id),
      queueMicrotask: (fn) => queueMicrotask(() => { if (page.alive) page.guard(fn); }),
      document: this.doc, localStorage: w.storageFor(this), sessionStorage: tab.session,
      location: { hash: '', protocol: o.protocol || 'file:', pathname: '/readyset/index.html', origin: 'http://localhost', href: 'http://localhost/readyset/index.html', reload: () => { page.reloadAsked = true; } },
      navigator: Object.assign({ userAgent: 'app_behaviour' }, o.navigator ? o.navigator(page) : {}),
      performance: { now: () => w.perf, getEntriesByType: () => [] },
      screen: { width: 393, height: 852 }, innerWidth: 393, innerHeight: 852, scrollX: 0, scrollY: 0, scrollTo() {}, devicePixelRatio: 1,
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      getComputedStyle: () => ({ getPropertyValue: () => '', paddingTop: '0px', paddingBottom: '0px' }),
      addEventListener: (t, f, op) => page.winL.add(t, f, op), removeEventListener: (t, f, op) => page.winL.remove(t, f, op),
      URL: { createObjectURL: () => { page.blobUrls++; return 'blob:readyset/' + page.blobUrls; }, revokeObjectURL() {} },
      Blob, File,
      fetch: o.fetch ? (u, init) => o.fetch(String(u), init, page) : () => Promise.reject(new TypeError('offline')),
      AbortSignal: {},
    };
    if (o.claude) win.claude = o.claude(page);
    if (o.picker) win.showSaveFilePicker = (opt) => o.picker(opt, page);
    this.win = win;
    vm.createContext(win);
    BOOT.runInContext(win);
    for (const s of CODE) s.runInContext(win);
  }
  guard(fn) { try { fn(); } catch (e) { this.errors.push(e); } }
  noteAdded(n) { if (n.nodeType === 1 && n.classList.contains('toast')) this.toasts.push(n.textContent); if (n.nodeType === 1 && n.tagName === 'A' && (n.download || n.hasAttribute('download'))) this.downloads.push(n.download || n.getAttribute('download')); }
  fire(target, type, props) {
    const ev = Object.assign({ type, target, isTrusted: false, bubbles: true, defaultPrevented: false, timeStamp: this.world.perf, clientX: 0, clientY: 0 }, props);
    if (type === 'change' && target && target.tagName === 'INPUT') target._atFocus = target.value;
    let stop = false; ev.preventDefault = () => { ev.defaultPrevented = true; }; ev.stopPropagation = () => { stop = true; }; ev.stopImmediatePropagation = ev.stopPropagation;
    const chain = [];
    if (target === this.win) chain.push(this.winL);
    else { for (let n = target; n; n = n.parentNode) chain.push(n._l); if (target.isConnected) chain.push(this.winL); }
    const call = (L, capture, cur) => { const l = L.ls[type]; if (!l) return; for (const x of l.slice()) { if (stop) return; if (x.capture !== capture) continue; if (x.once) L.remove(type, x.fn, x.capture); ev.currentTarget = cur; this.guard(() => x.fn.call(cur, ev)); } };
    for (let k = chain.length - 1; k > 0 && !stop; k--) call(chain[k], true, k === chain.length - 1 && target !== this.win ? this.win : null);
    call(chain[0], true, target); if (!stop) call(chain[0], false, target);
    if (ev.bubbles) for (let k = 1; k < chain.length && !stop; k++) call(chain[k], false, null);
    // The browser's own default actions the app relies on: a tap on a summary opens its row.
    if (type === 'click' && !ev.defaultPrevented && target.closest) { const sm = target.closest('summary'), d = sm && sm.parentElement; if (d && d.tagName === 'DETAILS') { d.open = !d.open; this.world.timer(this, () => this.fire(d, 'toggle', { bubbles: false }), 0); } }
    return ev;
  }
  unload() { this.fire(this.win, 'pagehide', { bubbles: false }); if (this.visible) { this.visible = false; this.fire(this.doc, 'visibilitychange', {}); } this.alive = false; this.world.tasks = this.world.tasks.filter(t => t.page !== this); }
  $(sel) { return this.doc.querySelector(sel); }
  $$(sel) { return this.doc.querySelectorAll(sel); }
  el(x) { const e = typeof x === 'string' ? this.$(x) : x; if (!e) throw new Error(`${this.name}: nothing matches ${x}`); return e; }
  sheet() { return this.$('#overlay .sheet'); }
  get active() { return this.doc.activeElement; }
  async click(x) { await this.world.advance(this.world.step); this.el(x).click(); await this.world.settle(); }
  async tap(x) { await this.world.advance(this.world.step); const e = this.el(x); this.fire(e, 'pointerdown', { isTrusted: true }); e.click(); await this.world.settle(); } // a real tap: pointerdown first (trusted), then the click
  // A tap the browser vouches for (isTrusted), at a place on the screen, `after` ms from now: the only kind the
  // app's guards see (the double-tap guard and the quiet window after the screen changes under the finger).
  async trustedTap(x, at, after) { await this.world.advance(after != null ? after : this.world.step); const e = this.el(x); this.fire(e, 'pointerdown', { isTrusted: true, clientX: at[0], clientY: at[1] }); this.fire(e, 'click', { isTrusted: true, clientX: at[0], clientY: at[1], timeStamp: this.world.perf }); await this.world.settle(); }
  async type(x, v) { await this.world.advance(this.world.step); const e = this.el(x); e.focus(); e.value = v; this.fire(e, 'input', {}); await this.world.settle(); }
  async change(x, v, keepFocus) { await this.world.advance(this.world.step); const e = this.el(x); e.focus(); e.value = v; this.fire(e, 'input', {}); this.fire(e, 'change', {}); if (!keepFocus) e.blur(); await this.world.settle(); }
  async blur() { const a = this.doc._active; if (a) a.blur(); await this.world.settle(); }
  async show(on) { this.visible = on; this.tab.visible = on; this.fire(this.doc, 'visibilitychange', {}); await this.world.settle(); }
  focusAs(x) { this.el(x).focus(); this.focusLog.pop(); }
  async fastTap(x, at, after) { await this.world.advance(after != null ? after : this.world.step); const b = this.el(x), efp = this.doc.elementFromPoint; this.doc.elementFromPoint = () => b; this.fire(b, 'touchstart', { touches: [{ clientX: at[0], clientY: at[1] }] }); const ev = this.fire(b, 'touchend', { changedTouches: [{ clientX: at[0], clientY: at[1] }], touches: [] }); this.doc.elementFromPoint = efp; await this.world.settle(); return ev.defaultPrevented; }
  toasted(re) { return this.toasts.some(t => (re instanceof RegExp ? re.test(t) : t === re)); }
}
const READER = (() => { const c = { console }; vm.createContext(c); new vm.Script('this.window = this;').runInContext(c); for (const s of CODE.slice(0, 3)) s.runInContext(c); return c; })();
const E = READER.Engine;

// ---------- Fixtures and the steps of a session ----------
// A program as stored on the phone: 365 / 255 / 425, Peak on, then whatever the test needs.
function seed(world, program, settings, extra, mod) {
  const st = E.sanitizeState(Object.assign({ lifts: { squat: { oneRM: 365 }, bench: { oneRM: 255 }, deadlift: { oneRM: 425 } }, setupDone: true, migratedV2: true, settings: Object.assign({ includePeak: true }, settings || {}), program: Object.assign({ startedAt: '2026-09-01' }, program || {}) }, extra || {}), { trusted: true });
  if (mod) mod(st);
  st.updatedAt = world.now - 60000;
  world.local.set(KEY, JSON.stringify(st));
  return st;
}
async function checkin(p, color) {
  await p.click('[data-action="checkin"]');
  const sore = color === 'red' ? 4 : 1, v = color === 'red' ? 1 : 5;
  for (const g of ['legs', 'push', 'hinge']) { const b = p.$(`[data-action="ci"][data-k="g:${g}"][data-v="${sore}"]`); if (b) await p.click(b); }
  for (const k of ['sleep', 'energy', 'motivation']) await p.click(`[data-action="ci"][data-k="${k}"][data-v="${v}"]`);
  await p.click('[data-action="ci-submit"]');
}
async function start(p, color, mode) { await checkin(p, color || 'green'); if (mode) { const c = p.$(`[data-action="ci-choice"][data-v="${mode}"]`); if (c) await p.click(c); } await p.click('[data-action="start-session"]'); }
const cur = (w) => w.stored().current;
const workIdx = (ex) => ex.sets.map((x, i) => (x.kind === 'work' ? i : -1)).filter(i => i >= 0);
const doneBtn = (ei, si) => `#main button[data-action="done"][data-ei="${ei}"][data-si="${si}"]`;
async function logSet(p, ei, si, o) {
  o = o || {};
  if (o.w != null) await p.change(`#w-${ei}-${si}`, String(o.w));
  if (o.r != null) await p.change(`#r-${ei}-${si}`, String(o.r));
  await p.click(doneBtn(ei, si));
  const sh = p.sheet();
  if (sh && sh.querySelector('.rpegrid')) await p.click(sh.querySelector(`[data-action="rpe-pick"][data-v="${o.rpe != null ? o.rpe : 'skip'}"]`));
}
async function finish(p, diff) {
  await p.click('[data-action="finish-lifting"]');
  if (p.$('[data-action="finish-confirm"]')) await p.click('[data-action="finish-confirm"]');
  await p.click(`[data-action="post-diff"][data-v="${diff || 2}"]`);
  await p.click('[data-action="post-next"]');
  if (p.$('[data-action="cardio-skip"]')) await p.click('[data-action="cardio-skip"]');
}
async function skipDay(p) { await p.click('[data-action="skip-session"]'); await p.click('[data-action="skip-session"]'); }
async function openBackfill(p, mode) { await p.click('[data-action="backfill-open"]'); if (mode && p.$('#bf-mode')) await p.change('#bf-mode', mode); await p.click('[data-action="backfill-start"]'); }
const iso = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const TESTS = [];
function test(name, fn) { TESTS.push({ name, fn }); }

// ---------- 1. Finishing a session, the week review and the block end ----------
test('completeSession and afterSession', async () => {
  const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const p = await w.tab('A').open();
  await start(p, 'green');
  let c = cur(w);
  expect(c && c.phase === 'lift' && c.dayIdx === 0 && c.mode === 'full', 'a green check-in opens the planned session', c && { phase: c.phase, mode: c.mode });
  const sq = c.exercises[0], wi = workIdx(sq);
  for (const si of wi) await logSet(p, 0, si, { rpe: sq.sets[si].rpeTarget });
  expect(!!p.$('#timer'), 'a ticked set starts the rest bar');
  c = cur(w);
  expect(wi.every(si => c.exercises[0].sets[si].done && c.exercises[0].sets[si].rpe === sq.sets[si].rpeTarget), 'each tick and rating is stored at once', c.exercises[0].sets.map(x => [x.done, x.rpe]));
  await finish(p, 2);
  const st = w.stored(), s = st.sessions[st.sessions.length - 1];
  expect(!st.current && st.sessions.length === 1, 'Save session stores the session and closes it', { current: !!st.current, n: st.sessions.length });
  expect(s && s.dayIdx === 0 && !s.phase && s.savedAt > 0 && s.post.difficulty === 2 && s.cardio && s.cardio.min === 0, 'the stored session: its day, no phase, saved time, difficulty, no bike', s && { dayIdx: s.dayIdx, phase: s.phase, post: s.post, cardio: s.cardio });
  expect(wi.every(si => s.exercises[0].sets[si].done && s.exercises[0].sets[si].actualReps === sq.sets[si].reps && s.exercises[0].sets[si].rpe === sq.sets[si].rpeTarget), 'its sets, as logged', s.exercises[0].sets.map(x => [x.done, x.actualReps, x.rpe]));
  expect(s.calibrated === true && s.calib && Array.isArray(s.calib.squat), 'the session was read by the calibration', s.calib);
  expect(st.program.dayIdx === 1 && st.program.week === 1, 'the plan moves to the next day', st.program);
  expect(!p.$('#timer') && !st.timer, 'the rest bar is gone after the session');
  await skipDay(p); await skipDay(p);
  expect(w.stored().program.dayIdx === 3, 'two skipped days move it on too', w.stored().program.dayIdx);
  await start(p, 'green'); await finish(p, 2);
  const st2 = w.stored();
  expect(st2.program.week === 2 && st2.program.dayIdx === 0, 'the last day of the week moves to week 2', st2.program);
  expect(st2.lastReport && st2.lastReport.title === 'Week 1 review', 'and runs the week review', st2.lastReport && st2.lastReport.title);
  expect(st2.sessions.length === 4 && st2.sessions.filter(x => x.skipped).length === 2, 'two sessions and two skips are on record', st2.sessions.map(x => !!x.skipped));
  // The block end: the last day of the Build deload.
  const w2 = new World(); seed(w2, { blockIdx: 0, week: 5, dayIdx: 3, macroPos: 0, variantSet: 'A' });
  const q = await w2.tab('A').open();
  await start(q, 'green'); await finish(q, 1);
  const st3 = w2.stored();
  expect(st3.lastReport && st3.lastReport.title === 'Build block complete', 'the last day of a block runs the block-end review', st3.lastReport && st3.lastReport.title);
  expect(st3.lastReport.lines.some(l => /^Next up: Build block/.test(l)) && st3.program.blockIdx === 0 && st3.program.macroPos === 1 && st3.program.variantSet === 'B' && st3.program.week === 1, 'and moves to the next block of the macro', { lines: st3.lastReport.lines, P: st3.program });
  // A past session dated before a skip that is already on record goes in time order.
  const w3 = new World(); seed(w3, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const r = await w3.tab('A').open();
  await skipDay(r);
  await r.click('[data-action="backfill-open"]'); await r.change('#bf-date', iso(w3.now - 2 * 864e5)); await r.click('[data-action="backfill-start"]'); await finish(r, 2);
  const st4 = w3.stored(), ts = JSON.parse(w3.raw()).sessions.map(x => x.ts); // as written (a reload sorts them, the open page does not)
  expect(st4.sessions.length === 2 && st4.sessions[0].backfill && st4.sessions[1].skipped && ts[0] < ts[1], 'the log stays in time order', st4.sessions.map(x => [x.date, !!x.skipped]));
  expect(st4.undo && /^Logged Bench day for /.test(st4.undo.label) && st4.program.dayIdx === 2, 'a past session moves the plan on and can be undone', st4.undo && st4.undo.label);
  await r.click('[data-action="undo"]');
  const st5 = w3.stored();
  expect(st5.sessions.length === 1 && st5.sessions[0].skipped && st5.program.dayIdx === 1, 'Undo takes the past session back off', st5.sessions.map(x => !!x.skipped));
});

// ---------- 2. A14-C1-01: a test logged after the fact keeps its result ----------
test('backfill in a test week (C1-01)', async () => {
  const w = new World(); seed(w, { blockIdx: 2, week: 3, dayIdx: 0, macroPos: 4 });
  const A = w.tab('A');
  // A past session whose mode came back as "light": the old screen offered it, and a reload restores it.
  A.session.setItem('rs-ui', JSON.stringify({ checkin: null, backfill: { date: iso(w.now - 864e5), mode: 'light' } }));
  const p = await A.open();
  expect(!!p.$('[data-action="backfill-start"]'), 'the past-session card is back after the reload');
  expect(!p.$('#bf-mode'), 'a test week offers no mode for a past session', !!p.$('#bf-mode'));
  if (p.$('#bf-mode')) await p.change('#bf-mode', 'light');
  await p.click('[data-action="backfill-start"]');
  const c = cur(w), sq = c.exercises[0], top = sq.sets.findIndex(x => x.open);
  expect(c.backfill && c.isTest && c.mode === 'full', 'the past test session is logged as planned, not light', { backfill: c.backfill, isTest: c.isTest, mode: c.mode });
  expect(top >= 0, 'the test day has its top single');
  await logSet(p, 0, top, { w: 385, rpe: 9 });
  await finish(p, 2);
  const s = w.stored().sessions[0];
  expect(s.backfill && s.isTest && s.mode === 'full' && s.exercises[0].sets[top].done && s.exercises[0].sets[top].actualW === 385, 'stored: a full test session with the 385 single', { mode: s.mode, set: s.exercises[0].sets[top] });
  await skipDay(p); await skipDay(p); await skipDay(p);
  const st = w.stored();
  expect(st.lastReport && /Peak & Test block complete/.test(st.lastReport.title), 'the test week ends with the block review', st.lastReport && st.lastReport.title);
  expect(st.lifts.squat.oneRM >= 385, 'the test single sets the squat max', st.lifts.squat.oneRM);
  expect(st.lastReport.lines.some(l => /^Squat 1RM 365 -> /.test(l)) && !st.lastReport.lines.some(l => /Squat: no data this block/.test(l)), 'the review says so', st.lastReport.lines);
});

// ---------- 3. A14-R1-01: a past light day in a two-red week is that one bad week ----------
test('backfill in a two-red week (R1-01)', async () => {
  const w = new World(); seed(w, { blockIdx: 0, week: 2, dayIdx: 0, macroPos: 0 });
  const p = await w.tab('A').open();
  await start(p, 'red', 'light'); await finish(p, 3);
  w.now += 864e5;
  await start(p, 'red', 'light');
  expect(w.stored().program.lightRestOfWeek === true, 'the second red check-in makes the rest of the week light');
  await finish(p, 3);
  w.now += 2 * 864e5;
  await p.click('[data-action="backfill-open"]');
  expect(p.$('#bf-mode') && p.$('#bf-mode').value === 'light', 'a past session in that week defaults to light', p.$('#bf-mode') && p.$('#bf-mode').value);
  await p.change('#bf-date', iso(w.now - 864e5)); await p.click('[data-action="backfill-start"]'); await finish(p, 3);
  await openBackfill(p, 'light'); await finish(p, 3);
  const st = w.stored(), [a, b, c, d] = st.sessions;
  expect(st.sessions.length === 4 && c.backfill && d.backfill && c.mode === 'light' && d.mode === 'light', 'two days logged after the fact, light', st.sessions.map(x => [x.mode, !!x.backfill]));
  expect(c.forcedLight === true && d.forcedLight === true, 'both are marked as forced light by the two-red rule', [c.forcedLight, d.forcedLight]);
  expect(!a.forcedLight && !b.forcedLight, 'the two red days themselves were chosen light, not forced');
  expect(st.lastReport && st.lastReport.title === 'Week 2 review' && st.lastReport.lines.some(l => /two red check-ins this week/.test(l)), 'the week review names the two red check-ins', st.lastReport);
  expect(!st.lastReport.lines.some(l => /light sessions this block/.test(l)) && (st.program.volumeDial || 0) === 0, 'and does not read them as chronic fatigue (the dial stays)', { lines: st.lastReport.lines, dial: st.program.volumeDial });
  // The same week lived: a check-in after the two reds runs light and is marked the same way.
  const w2 = new World(); seed(w2, { blockIdx: 0, week: 2, dayIdx: 0, macroPos: 0 });
  const q = await w2.tab('A').open();
  await start(q, 'red', 'light'); await finish(q, 3); await start(q, 'red', 'light'); await finish(q, 3);
  await start(q, 'green'); await finish(q, 2);
  const live = w2.stored().sessions[2];
  expect(live.mode === 'light' && live.forcedLight === true && !live.backfill, 'a live day after two reds is forced light too', { mode: live.mode, forced: live.forcedLight });
  // The second red day discarded instead: the light rest of the week goes with it.
  const w3 = new World(); seed(w3, { blockIdx: 0, week: 2, dayIdx: 0, macroPos: 0 });
  const r = await w3.tab('A').open();
  await start(r, 'red', 'light'); await finish(r, 3); await start(r, 'red', 'light');
  expect(w3.stored().program.lightRestOfWeek === true, 'the second red day is open: the week runs light');
  await r.click('[data-action="abandon"]'); await r.click('[data-action="abandon-confirm"]');
  const st3 = w3.stored();
  expect(!st3.current && st3.program.lightRestOfWeek === false && !st3.log.some(l => /Second red check-in/.test(l.msg)), 'discarding it takes the light week and its log line back', { light: st3.program.lightRestOfWeek, log: st3.log.map(l => l.msg) });
});

// ---------- 4. Edit, delete and Undo ----------
test('edit, delete and Undo restore exactly', async () => {
  const w = new World(); seed(w, { blockIdx: 0, week: 2, dayIdx: 0, macroPos: 0, mesoCount: 1 }, null, null, (st) => { for (const l of ['squat', 'bench', 'deadlift']) st.lifts[l].ratedAtBlockStart = 0; }); // the block began with a block change, as every block after the first does
  const p = await w.tab('A').open();
  await start(p, 'green');
  const sq = cur(w).exercises[0], wi = workIdx(sq);
  for (const si of wi) await logSet(p, 0, si, { rpe: 8.5 });
  await finish(p, 2);
  w.now += 864e5;
  await start(p, 'green');
  const bp = cur(w).exercises[0];
  for (const si of workIdx(bp)) await logSet(p, 0, si, { rpe: 8 });
  await finish(p, 2);
  await p.click('[data-action="dismiss-report"]');
  const before = w.stored(), id = before.sessions[0].id;
  const pick = (s) => canon({ program: s.program, lifts: s.lifts, learned: s.learned, acc: s.acc, lastReport: s.lastReport, log: s.log, sessions: s.sessions, settings: s.settings, current: s.current });
  // Edit: one set of the squat day was really two reps short.
  await p.click('#tabbar [data-view="history"]');
  await openRow(p, id);
  await p.click(`[data-action="edit-session"][data-id="${id}"]`);
  expect(cur(w) && cur(w).phase === 'edit' && cur(w).editOf === id, 'Edit opens the logged session', cur(w) && cur(w).phase);
  const si = wi[wi.length - 1];
  await p.change(`#r-0-${si}`, String(sq.sets[si].reps - 2));
  await p.click('[data-action="edit-save"]');
  const ed = w.stored(), es = ed.sessions.find(x => x.id === id);
  expect(!ed.current && es.edited && es.exercises[0].sets[si].actualReps === sq.sets[si].reps - 2, 'the edit is stored', es && es.exercises[0].sets[si]);
  expect(ed.lastReport && ed.lastReport.title === 'Session edited' && ed.undo, 'it is explained and can be undone', ed.lastReport && ed.lastReport.title);
  expect(ed.lastReport.lines.some(l => /^Maxes re-read from this block's 2 sessions/.test(l)) && ed.lifts.squat.est !== before.lifts.squat.est, 'the edit re-read the block', ed.lastReport.lines);
  await p.click('[data-action="undo"]');
  const back = w.stored();
  expect(pick(back) === pick(before), 'Undo puts everything back as it was before the edit', diffKeys(before, back));
  expect(!back.undo && p.toasted(/^Undone: Edited/), 'and says so');
  // Delete.
  await openRow(p, id);
  await p.click(`[data-action="delete-session"][data-id="${id}"]`);
  await p.click(`[data-action="delete-session"][data-id="${id}"][data-sure="1"]`);
  const del = w.stored();
  expect(del.sessions.length === 1 && !del.sessions.some(x => x.id === id), 'Delete removes the session', del.sessions.map(x => x.id));
  expect(del.lastReport && del.lastReport.title === 'Session deleted', 'and re-reads the block');
  await p.click('[data-action="undo"]');
  const back2 = w.stored();
  expect(pick(back2) === pick(before), 'Undo puts the deleted session and the maxes back exactly', diffKeys(before, back2));
});
async function openRow(p, id) { const d = p.el(`.session-item[data-id="${id}"]`); if (!d.open) await p.click(d.querySelector(':scope > summary')); }
function diffKeys(a, b) { const out = []; for (const k of ['program', 'lifts', 'learned', 'acc', 'lastReport', 'log', 'sessions', 'settings', 'current']) if (canon(a[k]) !== canon(b[k])) out.push(k); return out; }

// ---------- 5. Two windows ----------
async function twoWindows(opts) {
  const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 }, null, opts && opts.extra);
  const A = w.tab('A', opts && opts.tab), B = w.tab('B', opts && opts.tab);
  const a = await A.open();
  await start(a, 'green');
  const b = await B.open();
  return { w, A, B, a, b, sq: cur(w).exercises[0] };
}
const writesOf = (p) => p.writes.filter(x => x.k === KEY).length;
test('two windows: a window that is behind never writes, and reloads when used', async () => {
  const { w, A, B, a, b, sq } = await twoWindows();
  const wi = workIdx(sq);
  await logSet(b, 0, wi[0]);
  const bytes = w.raw();
  expect(cur(w).exercises[0].sets[wi[0]].done, 'window B ticked a set');
  expect(a.toasted('Changed in another ReadySet window. This one reloads when you use it.'), 'window A is told it is behind', a.toasts);
  const aw = writesOf(a);
  await a.click(doneBtn(0, wi[1])); // a scripted click: the handler runs, the save must not
  if (a.sheet()) await a.click('#overlay [data-action="rpe-pick"][data-v="skip"]');
  if (a.$('[data-action="timer-stop"]')) await a.click('[data-action="timer-stop"]');
  await a.click(`button[data-action="ex-fold"][data-ei="0"]`);
  await a.type('#sess-notes', 'abc'); await w.advance(1000);
  a.fire(a.win, 'pagehide', { bubbles: false }); await w.settle();
  expect(writesOf(a) === aw && w.raw() === bytes, 'nothing the behind window does is written: tick, rest bar, fold, notes, closing', { writes: writesOf(a) - aw, same: w.raw() === bytes });
  expect(!a.$$('button').some(x => /Finish here|take over/i.test(x.textContent)) && !a.$('[data-action*="takeover"]'), 'no takeover is offered');
  a.fire(a.$('#main'), 'pointerdown', { isTrusted: false }); a.fire(a.doc.body, 'keydown', { isTrusted: false, key: 'Enter' }); await w.settle();
  expect(A.loads === 1, 'a scripted pointer or key event does not reload it', A.loads);
  await a.tap('#main [data-action="ex-fold"][data-ei="0"]');
  expect(A.loads === 2 && A.page !== a && A.page.alive, 'the first real tap reloads it', A.loads);
  const a2 = A.page;
  expect(a2.toasted('Reloaded with the changes from your other ReadySet window.'), 'and says why', a2.toasts);
  expect(a2.$(doneBtn(0, wi[0])) && a2.$(doneBtn(0, wi[0])).getAttribute('aria-label').startsWith('Undo set:') && a2.$(doneBtn(0, wi[1])).getAttribute('aria-label').startsWith('Set done:'), 'the reloaded window shows B\'s set, and its own tick was not kept');
  expect(w.raw() === bytes && b.storageEvents === 0 && B.loads === 1, 'the reload wrote nothing, and B was never disturbed', { same: w.raw() === bytes, bEvents: b.storageEvents });
  expect(writesOf(a) === aw, 'the old page wrote nothing on its way out');
});
test('two windows: the same time with other bytes is newer; older copies and own bytes are not', async () => {
  const { w, a, b, sq } = await twoWindows();
  const t0 = JSON.parse(w.raw()).updatedAt;
  await b.type('#sess-notes', 'knee fine'); await w.advance(500);
  const raw = JSON.parse(w.raw());
  expect(raw.updatedAt === t0 && raw.current.notes === 'knee fine', 'typed notes are saved without moving the time', { t0, t: raw.updatedAt, notes: raw.current.notes });
  expect(a.toasted(/^Changed in another ReadySet window/), 'a window holding the same time but other bytes is behind', a.toasts);
  await a.click(doneBtn(0, workIdx(sq)[0])); if (a.sheet()) await a.click('#overlay [data-action="rpe-pick"][data-v="skip"]');
  expect(JSON.parse(w.raw()).current.notes === 'knee fine', 'so its next tick cannot put the empty notes back');
  // A lone window and the events it may still get.
  const w2 = new World(); seed(w2, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const p = await w2.tab('A').open(); await start(p, 'green');
  const wi = workIdx(cur(w2).exercises[0]);
  const ev = (newValue, key) => { p.fire(p.win, 'storage', { key: key || KEY, newValue, bubbles: false }); };
  const older = JSON.parse(w2.raw()); older.updatedAt -= 1000; older.current.notes = 'old';
  ev(w2.raw()); ev('{"updatedAt": 99999999999999}', 'readyset.folds'); ev(JSON.stringify(older)); ev(null); // in that order: after another window's bytes, its own are no longer known
  await w2.settle();
  const n = writesOf(p);
  await logSet(p, 0, wi[0]);
  expect(writesOf(p) > n && cur(w2).exercises[0].sets[wi[0]].done && !p.toasted(/^Changed in another/), 'an older copy, its own bytes, a removal or another key leave the window in step: its tick is written', { writes: writesOf(p) - n });
});
test('two windows: a window with no session reloads at once; a hidden one when it comes back', async () => {
  const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const A = w.tab('A'), B = w.tab('B');
  const a = await A.open(), b = await B.open();
  await checkin(b, 'green'); // the check-in's answers are saved
  expect(A.loads === 2 && writesOf(a) === 0, 'a window with no session open reloads at once and writes nothing', { loads: A.loads, writes: writesOf(a) });
  await b.click('[data-action="start-session"]');
  expect(A.loads === 3, 'and again when the session starts', A.loads);
  // B (which started the session) goes to the back; A, reloaded onto it, logs a set.
  await b.show(false);
  expect(writesOf(b) === 2, 'going to the back with nothing new writes nothing', writesOf(b));
  const a3 = A.page; await logSet(a3, 0, workIdx(cur(w).exercises[0])[0]);
  expect(B.loads === 1 && !b.toasts.length && cur(w).exercises[0].sets.some(x => x.done), 'a hidden window with the session open waits, quietly', { loads: B.loads, toasts: b.toasts });
  const n = writesOf(b);
  await b.show(true);
  expect(B.loads === 2 && B.page.toasted('Reloaded with the changes from your other ReadySet window.') && writesOf(b) === n, 'coming back to the front reloads it, writing nothing', { loads: B.loads });
  expect(B.page.$$('#main button[data-action="done"]').some(x => x.getAttribute('aria-label').startsWith('Undo set:')), 'and it shows the set logged in the other window');
});
test('two windows: no account push from a window that is behind (C5-03)', async () => {
  const docs = new Map(), log = [];
  const acct = (page) => ({ use: async (what) => (what !== 'db' ? null : {
    doc: (p) => ({ get: async () => ({ exists: docs.has(p), data: () => clone(docs.get(p)) }), set: async (v) => { log.push({ op: 'set', path: p, page: page.tab.name, at: page.world.now }); docs.set(p, clone(v)); }, delete: async () => { log.push({ op: 'del', path: p, page: page.tab.name }); docs.delete(p); } }),
    collection: (name) => ({ limit: () => ({ get: async () => ({ docs: [...docs.entries()].filter(([k]) => k.startsWith(name + '/')).map(([, v]) => ({ data: () => clone(v) })) }) }) }),
  }) });
  const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const A = w.tab('A', { claude: acct }), B = w.tab('B', { claude: acct });
  const a = await A.open();
  await skipDay(a); await start(a, 'green'); await w.advance(2000);
  const b = await B.open(); await w.advance(2000);
  expect(docs.has('app/state') && [...docs.keys()].some(k => k.startsWith('sessions/')), 'the account copy holds the state and the skipped day', [...docs.keys()]);
  const wi = workIdx(cur(w).exercises[0]);
  log.length = 0;
  await logSet(a, 0, wi[0]); // A's push is queued for 1.2 s
  await b.tap('#tabbar [data-view="today"]'); // B is behind A's tick: its first tap reloads it
  const b2 = B.page;
  expect(B.loads === 2 && b2.alive, 'window B, behind, reloads at its first tap', B.loads);
  await logSet(b2, 0, wi[1]);
  expect(a.toasted(/^Changed in another ReadySet window/), 'window A falls behind before its push goes out', w.now);
  await w.advance(2000);
  expect(log.some(x => x.page === 'B' && x.path === 'app/state'), 'window B, in step, pushes its tick', log);
  expect(!log.some(x => x.page === 'A'), 'the push window A had queued does not go out', log.filter(x => x.page === 'A'));
  log.length = 0;
  await finish(a, 2); await w.advance(2000); // scripted clicks: the handlers run
  await a.click('#tabbar [data-view="settings"]'); await a.click('[data-action="reset-confirm"]'); await a.click('[data-action="reset"]'); await w.advance(2000);
  expect(!log.some(x => x.page === 'A'), 'nothing from a behind window reaches the account: no finished session, no state, no deletes', log);
  expect(JSON.parse(w.raw()).current && !JSON.parse(w.raw()).sessions.some(x => !x.skipped), 'and the stored copy still has B\'s open session');
});
test('two windows: a save in the other window during an update download (R4-04)', async () => {
  for (const outcome of ['fails', 'lands']) {
    const pend = [];
    const fetch = (u) => (/version\.txt/.test(u) ? Promise.resolve({ ok: true, text: () => Promise.resolve('bbbbbb222222\n') }) : new Promise((res, rej) => pend.push({ res, rej })));
    const { w, A, B, a, b, sq } = await twoWindows({ tab: { build: 'aaaaaa111111', protocol: 'http:', fetch } });
    await w.advance(3100);
    expect(!!a.$('#update-bar') && !!b.$('#update-bar'), `[${outcome}] both windows show the update bar`);
    await a.click('#update-bar [data-action="apply-update"]');
    expect(pend.length === 1, `[${outcome}] window A starts the download`, pend.length);
    const wi = workIdx(sq);
    await logSet(b, 0, wi[0]);
    expect(a.toasted(/^Changed in another ReadySet window/), `[${outcome}] window A still sees B's save while its download is pending`, a.toasts);
    if (outcome === 'fails') {
      pend[0].rej(new TypeError('offline')); await w.settle();
      expect(a.toasted('Update not downloaded yet. Try again in a moment.'), '[fails] the failed download says so');
      await a.click(doneBtn(0, wi[1])); if (a.sheet()) await a.click('#overlay [data-action="rpe-pick"][data-v="skip"]');
      await w.advance(1000);
    } else {
      pend[0].res({ text: () => Promise.resolve('<!doctype html><meta name="readyset-build" content="bbbbbb222222"></html>') }); await w.advance(200);
      expect(A.loads === 2, '[lands] the downloaded update reloads window A', A.loads);
      await w.advance(4000);
      expect(A.loads === 2 && B.loads === 1, '[lands] once, and B never reloads', { A: A.loads, B: B.loads });
    }
    const c = cur(w);
    expect(c.exercises[0].sets[wi[0]].done && !c.exercises[0].sets[wi[1]].done, `[${outcome}] B's tick is still stored; A's older copy never went back`, c.exercises[0].sets.map(x => x.done));
  }
});
// A14-H-01: a window that only loaded the data (a second window, or any reload) used to write it again on its
// first hide, in the sanitizer's key order: the same data at the same time, but other bytes, so the other
// window was put behind and its next tap went to a reload. It now writes only what really changed.
test('two windows: a window that changed nothing writes nothing when it hides or closes (H-01)', async () => {
  const { w, A, B, a, b, sq } = await twoWindows();
  const wi = workIdx(sq), bytes = w.raw();
  const rpe = async (p) => { if (p.sheet()) await p.click('#overlay [data-action="rpe-pick"][data-v="skip"]'); };
  await b.show(false); // back to window A: B's way-out save
  expect(writesOf(b) === 0 && w.raw() === bytes, 'window B, which only loaded the data, writes nothing when it goes to the back', { writes: writesOf(b), same: w.raw() === bytes });
  expect(a.storageEvents === 0 && !a.toasted(/^Changed in another ReadySet window/), 'and window A is not put behind', { events: a.storageEvents, toasts: a.toasts });
  await a.tap(doneBtn(0, wi[0])); await rpe(a);
  expect(A.loads === 1 && A.page === a && cur(w).exercises[0].sets[wi[0]].done, 'so window A ticks its set at its next tap (no reload uses it up)', { loads: A.loads, done: cur(w).exercises[0].sets[wi[0]].done });
  // A reload, a close or a hide with nothing new: B (behind A's tick) is closed and opened again, then A is reloaded.
  const bytes2 = w.raw(), aw = writesOf(a);
  B.reload(); await w.settle();
  const b2 = B.page; await b2.show(false); await b2.show(true);
  A.reload(); await w.settle();
  const a2 = A.page; await a2.show(false); await a2.show(true);
  expect(w.raw() === bytes2 && writesOf(b) + writesOf(b2) + writesOf(a) - aw + writesOf(a2) === 0 && b2.storageEvents === 0, 'a reload, a close or a hide with nothing new writes nothing', { same: w.raw() === bytes2, writes: [writesOf(b), writesOf(b2), writesOf(a) - aw, writesOf(a2)], b2Events: b2.storageEvents });
  await a2.tap(doneBtn(0, wi[1])); await rpe(a2);
  expect(A.loads === 2 && A.page === a2 && cur(w).exercises[0].sets[wi[1]].done, 'the reloaded window A ticks at its first tap too', { loads: A.loads });
  expect(b2.toasted(/^Changed in another ReadySet window/) && B.loads === 2, 'and that tick, a real change, still puts window B behind', { toasts: b2.toasts, loads: B.loads });
});
test('two windows: a real change in a window that loaded the data is written and puts the other behind (H-01)', async () => {
  for (const how of ['notes', 'tick']) {
    const { w, a, b, sq } = await twoWindows();
    const t0 = JSON.parse(w.raw()).updatedAt, bytes = w.raw(), wi = workIdx(sq);
    if (how === 'notes') { await b.type('#sess-notes', 'knee fine'); await w.advance(500); } else await logSet(b, 0, wi[0]);
    const raw = JSON.parse(w.raw());
    expect(w.raw() !== bytes && writesOf(b) > 0 && (how === 'notes' ? raw.current.notes === 'knee fine' && raw.updatedAt === t0 : raw.current.exercises[0].sets[wi[0]].done && raw.updatedAt > t0), `[${how}] window B's change is written${how === 'notes' ? ' (at the same time)' : ''}`, { writes: writesOf(b), t0, t: raw.updatedAt });
    expect(a.toasted(/^Changed in another ReadySet window/), `[${how}] and window A is behind`, a.toasts);
    const n = writesOf(a), after = w.raw(); await a.show(false);
    expect(writesOf(a) === n && w.raw() === after, `[${how}] the behind window A still writes nothing on its way out`, { writes: writesOf(a) - n });
  }
});
test('a boot that repairs the stored data still saves the repair (H-01)', async () => {
  const w0 = new World(); seed(w0, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const p0 = await w0.tab('A').open(); await start(p0, 'green');
  const good = w0.raw(), o = JSON.parse(good);
  expect(o.current.mode === 'full' && good.includes('"mode":"full"'), 'the stored open session (as the window that started it wrote it)');
  // Repairs the sanitizer makes on load: a value it replaces (same length of text), an unknown field it drops,
  // and a missing start time it fills in (with the time of that load: not saving it would move it every load).
  // Inside a list too: a set's reps out of range, and a list stored as an object.
  const noStart = JSON.parse(good); delete noStart.current.startedAt;
  const badReps = JSON.parse(good); badReps.current.exercises[0].sets[0].reps = 99;
  expect(good.includes('"planNotes":[]'), 'the open session stores its plan notes as a list');
  const cases = { 'same length': good.replace('"mode":"full"', '"mode":"fulx"'), 'unknown field': good.replace('"mode":"full"', '"mode":"full","junk":1'), 'missing start': JSON.stringify(noStart), 'set in a list': JSON.stringify(badReps), 'list as object': good.replace('"planNotes":[]', '"planNotes":{}') };
  for (const [name, bad] of Object.entries(cases)) {
    expect(bad !== good && JSON.parse(bad).current.mode !== undefined, `[${name}] the damaged copy`);
    const w = new World(); w.local.set(KEY, bad);
    const A = w.tab('A'), p = await A.open();
    expect(p.$(doneBtn(0, workIdx(cur(w).exercises[0])[0])) && w.raw() === bad, `[${name}] the session opens; nothing is written at boot`);
    await p.show(false);
    const r = JSON.parse(w.raw());
    expect(writesOf(p) === 1 && w.raw() !== bad && r.current.mode === 'full' && !('junk' in r.current) && r.current.startedAt > 0 && r.current.exercises[0].sets[0].reps <= 50 && Array.isArray(r.current.planNotes) && r.updatedAt === o.updatedAt, `[${name}] the repair is saved on the first hide`, { writes: writesOf(p), mode: r.current.mode, junk: r.current.junk, startedAt: r.current.startedAt, reps: r.current.exercises[0].sets[0].reps, planNotes: r.current.planNotes });
    const fixed = w.raw(); A.reload(); await w.settle(); await A.page.show(false);
    expect(w.raw() === fixed && writesOf(A.page) === 0, `[${name}] and a reload after it writes nothing more`, { writes: writesOf(A.page) });
  }
  // What is not a repair: an empty field (0, false, null or '') that one copy has and the other leaves out.
  // The sanitizer fills in or drops it on every load, so nothing reads it differently, and it is not written.
  const w = new World(); w.local.set(KEY, good.replace('"mode":"full"', '"mode":"full","junk":0'));
  const q = await w.tab('A').open(); await q.show(false);
  expect(writesOf(q) === 0, 'an unknown empty field alone is not written back', writesOf(q));
  // A copy written in full (every empty field spelt out: '', false, null), as an older build or a seed stores it.
  const w2 = new World(); seed(w2, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const full = w2.raw();
  expect(full.includes('"name":""') && full.includes(':false') && full.includes(':null'), 'the copy spells out empty fields');
  const q2 = await w2.tab('A').open(); await q2.show(false);
  expect(writesOf(q2) === 0 && w2.raw() === full, 'a copy that differs only in its empty fields is not rewritten', writesOf(q2));
});
// The account wait: on the claude.ai copy a page waits for the account store (up to 5 s, then its reads) before it
// shows the data, and a storage event in that time comes before the page can act on it. Another window's save
// then must still put this one behind once it has loaded, or its first change would write the older copy over it.
function lateAccount(docs, log, wait) { // wait(page): ms before use('db') answers, or null for never (the 5 s timeout)
  return (page) => ({ use: (what) => new Promise((res) => {
    const db = {
      doc: (p) => ({ get: async () => ({ exists: docs.has(p), data: () => clone(docs.get(p)) }), set: async (v) => { log.push({ op: 'set', path: p, page: page.name, v: clone(v) }); docs.set(p, clone(v)); }, delete: async () => { log.push({ op: 'del', path: p, page: page.name }); docs.delete(p); } }),
      collection: (name) => ({ limit: () => ({ get: async () => ({ docs: [...docs.entries()].filter(([k]) => k.startsWith(name + '/')).map(([, v]) => ({ data: () => clone(v) })) }) }) }),
    };
    const ms = what === 'db' ? wait(page) : 0;
    if (ms != null) page.world.timer(page, () => res(what === 'db' ? db : null), ms);
  }) });
}
test('two windows: a save in the other window while this one waits for the account (account wait)', async () => {
  for (const how of ['account answers late', 'account never answers', 'no account']) {
    const docs = new Map(), log = [];
    const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
    const slowB = (page) => (page.name === 'B' ? (how === 'account answers late' ? 3000 : null) : 0); // B's first page waits; any page after it does not
    const acct = how === 'no account' ? null : lateAccount(docs, log, slowB);
    const A = w.tab('A', acct ? { claude: acct } : {}), B = w.tab('B', acct ? { claude: acct } : {});
    const a = await A.open(); await start(a, 'green'); await w.advance(2000);
    const wi = workIdx(cur(w).exercises[0]);
    const b = await B.open(); // B reads the stored copy, then (with the account) waits
    expect(how === 'no account' ? !!b.$(doneBtn(0, wi[0])) : !b.$(doneBtn(0, wi[0])), `[${how}] ${how === 'no account' ? 'window B shows the session at once' : 'window B is still waiting for the account'}`);
    await w.advance(2200);
    await logSet(a, 0, wi[0]); // A ticks while B waits (its push reaches the account 1.2 s later, after B's reads)
    const ticked = w.raw();
    expect(cur(w).exercises[0].sets[wi[0]].done, `[${how}] window A's tick is stored`);
    await w.advance(how === 'account never answers' ? 3000 : 1000); // B's wait ends: the account answers, or the 5 s run out
    expect(!!b.$(doneBtn(0, wi[1])) && writesOf(b) === 0 && w.raw() === ticked, `[${how}] window B has loaded, writing nothing`, { writes: writesOf(b) });
    expect(b.toasted('Changed in another ReadySet window. This one reloads when you use it.') && B.loads === 1, `[${how}] and it is told it is behind (the session open here is not reloaded under you)`, { toasts: b.toasts, loads: B.loads });
    const bw = writesOf(b), bLog = log.length;
    await b.tap(doneBtn(0, wi[1])); if (B.page === b && b.sheet()) await b.click('#overlay [data-action="rpe-pick"][data-v="skip"]'); // a real change in B: a tap on another set
    await w.advance(2000);
    const c = cur(w);
    expect(c.exercises[0].sets[wi[0]].done, `[${how}] window A's tick is still stored (window B did not write its older copy over it)`, c.exercises[0].sets.map(x => x.done));
    expect(writesOf(b) === bw && !c.exercises[0].sets[wi[1]].done && w.raw() === ticked, `[${how}] window B, behind, wrote nothing at its tap`, { writes: writesOf(b) - bw, set: c.exercises[0].sets[wi[1]].done });
    expect(!log.slice(bLog).some(x => x.page === 'B'), `[${how}] and pushed nothing to the account`, log.slice(bLog).map(x => x.page + ' ' + x.path));
    expect(B.loads === 2 && B.page.toasted('Reloaded with the changes from your other ReadySet window.') && B.page.$$('#main button[data-action="done"]').filter(x => x.getAttribute('aria-label').startsWith('Undo set:')).length === 1, `[${how}] window B reloaded at that tap onto A's tick`, { loads: B.loads });
    expect(!a.toasted(/^Changed in another ReadySet window/), `[${how}] window A is not put behind`, a.toasts);
    await a.tap(doneBtn(0, wi[2])); if (a.sheet()) await a.click('#overlay [data-action="rpe-pick"][data-v="skip"]');
    expect(A.loads === 1 && cur(w).exercises[0].sets[wi[2]].done, `[${how}] so window A ticks at its next tap (no reload)`, { loads: A.loads });
    const b2 = B.page; await b2.tap(doneBtn(0, wi[1]));
    expect(B.loads === 3 && !cur(w).exercises[0].sets[wi[1]].done, `[${how}] window B, behind A's second tick, reloads at its next tap`, { loads: B.loads });
    const b3 = B.page; await b3.tap(doneBtn(0, wi[1])); if (b3.sheet()) await b3.click('#overlay [data-action="rpe-pick"][data-v="skip"]');
    expect([0, 1, 2].every(i => cur(w).exercises[0].sets[wi[i]].done), `[${how}] and then ticks, on top of both of A's ticks`, cur(w).exercises[0].sets.map(x => x.done));
  }
});
// What still writes after the wait: nothing new in the other window (H-01 unchanged), and a copy the account had newer.
test('the account wait: nothing saved meanwhile, or an older copy saved, leaves the window in step (account wait)', async () => {
  const docs = new Map(), log = [];
  const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const acct = lateAccount(docs, log, (page) => (page.name === 'B' ? 3000 : 0));
  const A = w.tab('A', { claude: acct }), B = w.tab('B', { claude: acct });
  const a = await A.open(); await start(a, 'green'); await w.advance(2000);
  const bytes = w.raw(), wi = workIdx(cur(w).exercises[0]);
  const b = await B.open(); await w.advance(3100);
  await b.show(false); await b.show(true);
  expect(writesOf(b) === 0 && w.raw() === bytes && !b.toasted(/^Changed in another ReadySet window/) && !a.toasted(/^Changed in another ReadySet window/), 'nothing saved during the wait: window B is in step and writes nothing (H-01)', { writes: writesOf(b), toasts: b.toasts.concat(a.toasts) });
  await logSet(b, 0, wi[0]); await w.advance(2000);
  expect(cur(w).exercises[0].sets[wi[0]].done && B.loads === 1 && log.some(x => x.page === 'B' && x.path === 'app/state'), 'and its tick is written and pushed', { loads: B.loads });
  expect(a.toasted(/^Changed in another ReadySet window/), 'which puts window A behind', a.toasts);
  // An older copy written during the wait (an older build's tab still open): the window that loads is newer and stays in step.
  const w2 = new World(); seed(w2, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const docs2 = new Map(), log2 = [];
  const C = w2.tab('C', { claude: lateAccount(docs2, log2, () => 3000) });
  const c = await C.open(); const older = JSON.parse(w2.raw()); older.updatedAt -= 1000;
  await w2.advance(1000); w2.local.set(KEY, JSON.stringify(older)); // another window wrote it (its event came during the wait)
  await w2.advance(2100);
  expect(!!c.$('[data-action="checkin"]') && !c.toasted(/^Changed in another ReadySet window/) && C.loads === 1, 'an older copy saved during the wait: window C loads in step', { loads: C.loads, toasts: c.toasts });
  expect(log2.some(x => x.page === 'C' && x.path === 'app/state'), 'and its first account push (the account copy was empty) still goes out', log2.map(x => x.page + ' ' + x.path));
  await start(c, 'green'); await w2.advance(2000);
  expect(cur(w2) && cur(w2).exercises.length > 0 && C.loads === 1, 'and its session start is written over the older copy', { loads: C.loads });
  // No session open, and a newer copy saved during the wait: the window reloads onto it at once, writing nothing.
  const w3 = new World(); seed(w3, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const docs3 = new Map(), log3 = [];
  const D = w3.tab('D', { claude: lateAccount(docs3, log3, (page) => (page.name === 'D' ? 3000 : 0)) });
  const d = await D.open(); const newer = JSON.parse(w3.raw()); newer.updatedAt += 1000; newer.lifts.squat.oneRM = 370;
  await w3.advance(1000); w3.local.set(KEY, JSON.stringify(newer)); const nb = w3.raw();
  await w3.advance(2100);
  expect(D.loads === 2 && writesOf(d) === 0 && w3.raw() === nb && !log3.some(x => x.page === 'D'), 'no session open and a newer copy saved during the wait: window D reloads onto it, writing and pushing nothing', { loads: D.loads, writes: writesOf(d), pushes: log3.filter(x => x.page === 'D').length });
  expect(w3.stored().lifts.squat.oneRM === 370 && log3.some(x => x.page === 'D (load 2)' && x.path === 'app/state'), 'the reloaded window has the newer copy (and pushes it to the empty account)', log3.map(x => x.page + ' ' + x.path));
  // A copy from before the calibration upgrade (migrate() saves it at boot): the check comes first, so that save does not go over the newer copy.
  const w4 = new World(); seed(w4, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 }, null, { migratedV2: false });
  expect(JSON.parse(w4.raw()).migratedV2 === false, 'the copy predates the upgrade');
  const E4 = w4.tab('E', { claude: lateAccount(new Map(), [], (page) => (page.name === 'E' ? 3000 : 0)) });
  const e4 = await E4.open(); const up4 = JSON.parse(w4.raw()); up4.updatedAt += 1000; up4.migratedV2 = true; up4.lifts.squat.oneRM = 370;
  await w4.advance(1000); w4.local.set(KEY, JSON.stringify(up4)); const nb4 = w4.raw();
  await w4.advance(2100);
  expect(writesOf(e4) === 0 && E4.loads === 2 && w4.stored().lifts.squat.oneRM === 370, 'an upgrade at boot does not save the older copy over one saved during the wait', { writes: writesOf(e4), loads: E4.loads, squat: w4.stored().lifts.squat.oneRM });
  expect(writesOf(E4.page) === 0 && w4.raw() === nb4, 'and the reloaded window, on the upgraded copy, writes nothing', writesOf(E4.page));
  // The stored copy erased during the wait (a window on the recovery screen): as for the storage event, this window's next save puts its copy back.
  const w5 = new World(); seed(w5, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const F5 = w5.tab('F', { claude: lateAccount(new Map(), [], (page) => (page.name === 'F' ? 3000 : 0)) });
  const f5 = await F5.open(); await w5.advance(1000); w5.local.delete(KEY); await w5.advance(2100);
  expect(!!f5.$('[data-action="checkin"]') && F5.loads === 1 && !w5.raw(), 'erased during the wait: the window loads its copy, in step');
  await f5.show(false);
  expect(writesOf(f5) === 1 && w5.stored() && w5.stored().setupDone, 'and puts it back when it goes to the back', writesOf(f5));
});

// ---------- 6. The typo check: "Fix it" (A14-C1-12), "Use" a carried weight (A14-C2-09) ----------
test('Fix it keeps the typed digits and checks again (C1-12)', async () => {
  const w = new World(); seed(w, { blockIdx: 2, week: 3, dayIdx: 0, macroPos: 4 });
  const p = await w.tab('A').open();
  await start(p, 'green');
  const top = cur(w).exercises[0].sets.findIndex(x => x.open), f = `#w-0-${top}`;
  await p.change(f, '3650');
  let sh = p.sheet();
  expect(sh && /Check this weight/.test(sh.textContent) && /against your 1RM of 365/.test(sh.textContent) && sh.querySelector('[data-action="check-fix"]') && !sh.querySelector('[data-action="check-use"]'), 'a top single far over the max is asked about, with Fix it', sh && sh.textContent);
  expect(cur(w).exercises[0].sets[top].actualW == null, 'nothing is stored before the answer');
  await p.click('#overlay [data-action="check-fix"]');
  expect(!p.sheet() && p.$(f).value === '3650' && p.active === p.$(f) && p.$(f).dataset.recheck === '1', 'Fix it: the field keeps 3650 and has the focus', { value: p.$(f).value, focused: p.active === p.$(f) });
  expect(cur(w).exercises[0].sets[top].actualW == null, 'still nothing stored');
  await p.blur();
  sh = p.sheet();
  expect(sh && sh.querySelector('[data-action="check-fix"]'), 'leaving the field unchanged brings the check back');
  await p.click('#overlay [data-action="check-fix"]');
  await p.click(doneBtn(0, top));
  expect(p.sheet() && p.sheet().querySelector('[data-action="check-fix"]') && !cur(w).exercises[0].sets[top].done, 'ticking the unchanged value brings it back too, and does not tick', !!p.sheet());
  await p.click('#overlay [data-action="check-fix"]');
  await p.change(f, '365');
  expect(!p.sheet() && cur(w).exercises[0].sets[top].actualW === 365 && !p.$(f).dataset.recheck, 'the corrected number is stored with no check', cur(w).exercises[0].sets[top].actualW);
  await logSet(p, 0, top, { rpe: 9 });
  expect(cur(w).exercises[0].sets[top].done && cur(w).exercises[0].sets[top].actualW === 365, 'and the single ticks at 365');
});
test('Use offers the weight carried from the set before (C2-09)', async () => {
  const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 1, macroPos: 0 });
  const p = await w.tab('A').open();
  await start(p, 'green');
  const bp = cur(w).exercises[0], [s1, s2, s3] = workIdx(bp), plan = bp.sets[s1].w;
  await p.change(`#w-0-${s1}`, String(plan + 5));
  let c = cur(w).exercises[0];
  expect(c.sets[s2].actualW === plan + 5 && c.sets[s3].actualW === plan + 5 && c.sets[s2].carriedFrom === s1, 'a weight typed on set 1 carries to the sets after it', c.sets.map(x => [x.actualW, x.carriedFrom]));
  await p.change(`#w-0-${s2}`, '36');
  const use = p.$('#overlay [data-action="check-use"]');
  expect(use && use.textContent === `Use ${plan + 5} lb` && /planned/.test(p.sheet().textContent) === false && /lighter than the empty bar/.test(p.sheet().textContent), 'a slip offers the carried weight, not the plan\'s', use && use.textContent);
  await p.click(use);
  c = cur(w).exercises[0];
  expect(p.$(`#w-0-${s2}`).value === String(plan + 5) && c.sets[s2].actualW === plan + 5 && c.sets[s2].carriedFrom === s1, 'Use puts it back as it was, still carried', c.sets[s2]);
  await p.change(`#w-0-${s1}`, String(plan + 10));
  c = cur(w).exercises[0];
  expect(c.sets[s2].actualW === plan + 10 && c.sets[s3].actualW === plan + 10, 'so a later change to set 1 still reaches it', c.sets.map(x => x.actualW));
});

// ---------- 7. Focus into the sheets and back (A14-C2-10) ----------
test('sheets take the focus and give it back (C2-10)', async () => {
  const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 1, macroPos: 0 });
  const p = await w.tab('A').open();
  await start(p, 'green');
  const bp = cur(w).exercises[0], [s1, s2] = workIdx(bp);
  const rpe = p.el(`#main button[data-action="rpe"][data-ei="0"][data-si="${s1}"]`);
  p.focusAs(rpe); const mark = p.focusLog.length;
  await p.click(rpe);
  const a = p.active;
  expect(p.sheet() && p.$('#overlay').contains(a) && a.dataset.action === 'rpe-pick' && a.dataset.v === String(bp.sets[s1].rpeTarget), 'the RPE sheet opens with the focus on the planned rating', a && { action: a.dataset.action, v: a.dataset.v });
  expect(!!p.$('#overlay [role="dialog"][aria-modal="true"]'), 'the sheet is a modal dialog');
  await p.click('#overlay .sheet button[data-action="sheet-close"]');
  expect(!p.sheet() && p.active === rpe, 'Close gives the focus back to the button that opened it', p.active && p.active.tagName);
  p.focusAs(doneBtn(0, s1));
  await p.click(doneBtn(0, s1));
  expect(p.sheet() && p.$('#overlay').contains(p.active), 'ticking opens "How hard was it?" with the focus inside');
  await p.click(`#overlay [data-action="rpe-pick"][data-v="${bp.sets[s1].rpeTarget}"]`);
  expect(!p.sheet() && p.active.matches(doneBtn(0, s1)) && p.active.getAttribute('aria-label').startsWith('Undo set:'), 'after the rating the focus is on that row\'s tick (the screen was redrawn)', p.active && p.active.getAttribute('aria-label'));
  await p.change(`#w-0-${s2}`, '36', true);
  expect(p.sheet() && p.active.matches('#overlay [data-action="check-use"]'), 'the typo check opens with the focus on its answer');
  await p.click('#overlay [data-action="check-use"]');
  expect(!p.sheet() && p.active.matches(doneBtn(0, s2)) && p.active.tagName === 'BUTTON', 'and returns it to the row\'s tick button, not the field (no keyboard)', p.active && p.active.tagName);
  const sheetFocus = p.focusLog.slice(mark).filter(x => x.el.tagName === 'BUTTON');
  expect(sheetFocus.length >= 5 && sheetFocus.every(x => x.opts && x.opts.preventScroll === true), 'every focus move of the sheets asks not to scroll', sheetFocus.map(x => x.opts));
});

// ---------- 8. When a backup counts (A14-C1-26) ----------
test('a backup counts only when the file is handed over (C1-26)', async () => {
  const run = async (tab, steps) => { const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 }); const t = w.tab('A', tab); const p = await t.open(); await p.click('#tabbar [data-view="settings"]'); await steps(w, p); };
  const counted = (w) => (w.stored().lastBackupAt || 0) > 0;
  // Save dialog (Chrome, Edge): counts once the file is closed.
  let closeIt = null, calls = 0;
  const picker = (mode) => () => { calls++; if (mode === 'cancel') return Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })); if (mode === 'framed') return Promise.reject(Object.assign(new Error('x'), { name: 'SecurityError' })); return Promise.resolve({ createWritable: async () => ({ write: async () => { if (mode === 'broken') throw new Error('disk'); }, close: () => new Promise(r => { closeIt = r; }) }) }); };
  await run({ picker: picker('ok') }, async (w, p) => {
    await p.click('[data-action="share-backup"]');
    expect(calls === 1 && !counted(w) && !p.toasts.length, 'save dialog: nothing counts while the file is being written', { calls, counted: counted(w) });
    await p.click('[data-action="share-backup"]');
    expect(calls === 1, 'a second tap does not open a second dialog');
    closeIt(); await w.settle();
    expect(counted(w) && w.stored().lastBackupKind === 'file' && p.toasted('Backup file saved'), 'it counts when the file is closed', p.toasts);
  });
  calls = 0;
  await run({ picker: picker('cancel') }, async (w, p) => {
    await p.click('[data-action="share-backup"]');
    expect(!counted(w) && !p.toasts.length && !p.downloads.length, 'a cancelled dialog counts nothing and says nothing', p.toasts);
    await p.click('[data-action="share-backup"]');
    expect(calls === 2, 'and the button works again');
  });
  await run({ picker: picker('broken') }, async (w, p) => {
    await p.click('[data-action="share-backup"]');
    expect(!counted(w) && p.toasted('The backup file could not be written. Try again, or copy the backup.'), 'a write error says so and counts nothing', p.toasts);
  });
  for (const tab of [{ picker: picker('framed') }, {}]) {
    await run(tab, async (w, p) => {
      await p.click('[data-action="share-backup"]');
      expect(p.downloads.length === 1 && /^readyset-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(p.downloads[0]) && counted(w) && p.toasted('Backup download started. Check it reached your Downloads.'), `${tab.picker ? 'a dialog not allowed here' : 'no dialog'}: a plain download, counted from its start and said that way`, { d: p.downloads, toasts: p.toasts });
    });
  }
  // The share sheet (iPhone): counts when it reports success.
  let settle = null;
  const share = (page) => ({ canShare: () => true, share: () => new Promise((res, rej) => { settle = { res, rej }; }) });
  await run({ navigator: share }, async (w, p) => {
    await p.click('[data-action="share-backup"]');
    expect(!counted(w), 'share sheet: nothing counts while it is open');
    settle.res(); await w.settle();
    expect(counted(w) && p.toasted('Backup shared'), 'it counts when the share works');
  });
  for (const [name, said] of [['AbortError', null], ['NotAllowedError', 'The share sheet did not open. Try again.']]) {
    await run({ navigator: share }, async (w, p) => {
      await p.click('[data-action="share-backup"]'); settle.rej(Object.assign(new Error('x'), { name })); await w.settle();
      expect(!counted(w) && (said ? p.toasted(said) : !p.toasts.length) && !p.downloads.length, `a share that ends in ${name} counts nothing${said ? ' and says so' : ''}`, p.toasts);
    });
  }
});

// ---------- 9. The copy set aside after an error (A14-C1-20) ----------
test('restoring the copy set aside after an error (C1-20)', async () => {
  const w0 = new World(); seed(w0, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const p0 = await w0.tab('A').open(); await skipDay(p0); await start(p0, 'green'); await logSet(p0, 0, workIdx(cur(w0).exercises[0])[0]);
  const aside = w0.raw(), openId = JSON.parse(aside).current.id;
  // A phone whose stored data could not be read: setup offers to bring the copy back.
  const w = new World(); w.local.set(KEY + '.unreadable', aside);
  const p = await w.tab('A').open();
  expect(!!p.$('[data-action="recover-aside"]'), 'setup offers to bring back the data set aside');
  await p.click('[data-action="recover-aside"]');
  const st = w.stored();
  expect(st && st.setupDone && st.current && st.current.id === openId && st.current.exercises[0].sets.some(x => x.done), 'the copy comes back with its open session', st && st.current && st.current.id);
  expect(!st.lastBackupAt && !st.lastBackupKind, 'it is not counted as backed up (it is this phone\'s own copy)', { at: st.lastBackupAt, kind: st.lastBackupKind });
  expect(!w.local.has(KEY + '.unreadable'), 'the copy set aside is removed once it is back');
  // The confirm path (a program with sessions already here) is where fromAside would be lost: no screen offers the button there.
  const w2 = new World(); seed(w2, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 }); w2.local.set(KEY + '.unreadable', aside);
  const q = await w2.tab('A').open(); await start(q, 'green'); await finish(q, 2);
  let offered = false;
  for (const v of ['today', 'program', 'history', 'settings']) { await q.click(`#tabbar [data-view="${v}"]`); if (q.$('[data-action="recover-aside"]')) offered = true; }
  expect(!offered && !!q.$('[data-action="aside-copy"]'), 'with a program and sessions, no screen offers "Bring back" (only Copy and Delete), so the confirm path cannot get it');
});

// ---------- 10. Audit 15 ----------
// A15-C1-01: a bar that appears above the scrolling area on its own (the update bar, the save bar) pushed
// every set down by its height (77 px at 320 wide), so a tap aimed as it appeared hit the row above.
// This fake DOM has no layout: the scroller reports its top as the height of the bars above it.
test('a bar appearing above the sets keeps them under the finger (A15-C1-01)', async () => {
  const fetch = (u) => (/version\.txt/.test(u) ? Promise.resolve({ ok: true, text: () => Promise.resolve('bbbbbb222222\n') }) : Promise.reject(new TypeError('offline')));
  const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const p = await w.tab('A', { build: 'aaaaaa111111', protocol: 'http:', fetch }).open();
  await start(p, 'green');
  const sc = p.$('#scroller'), H = 77;
  sc.getBoundingClientRect = () => { const top = (p.$('#update-bar') ? H : 0) + (p.$('#save-bar') ? H : 0); return { top, bottom: top + 500, left: 0, right: 320, width: 320, height: 500, x: 0, y: top }; };
  sc.scrollTop = 300;
  await w.advance(3100); // the update check 3 s after opening
  expect(!!p.$('#update-bar') && sc.scrollTop === 300 + H, 'the update bar appears mid-session and the sets keep their place on screen', sc.scrollTop);
  const ls = p.win.localStorage, setItem = ls.setItem;
  ls.setItem = () => { throw new Error('QuotaExceededError'); };
  const wi = workIdx(cur(w).exercises[0]);
  await logSet(p, 0, wi[0]);
  expect(!!p.$('#save-bar') && sc.scrollTop === 300 + 2 * H, 'the save bar appears after a failed save and the sets keep their place', sc.scrollTop);
  ls.setItem = setItem;
  await logSet(p, 0, wi[1]);
  expect(!p.$('#save-bar') && sc.scrollTop === 300 + H, 'when a save works again the bar goes and the sets keep their place', sc.scrollTop);
});
// The storage-full bar: with no session open it does not speak of sets (A14); it is short (it took seven lines on a
// 320 px phone; now three), and still says what failed and what to do (A15).
test('the storage-full bar is short and speaks of sets only with a session open (A14, A15)', async () => {
  const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const p = await w.tab('A').open(), ls = p.win.localStorage, setItem = ls.setItem;
  const bar = () => { const b = p.$('#save-bar'); return b ? b.querySelector('span').textContent : null; };
  ls.setItem = () => { throw new Error('QuotaExceededError'); };
  await skipDay(p); // a change with no session open
  const idle = bar();
  expect(!!idle && !/\bsets?\b|finish/i.test(idle) && /Keep ReadySet open/.test(idle) && /tap Save backup\.$/.test(idle) && idle.length <= 95, 'no session open: the bar does not speak of sets, and says to keep ReadySet open and tap Save backup', idle);
  ls.setItem = setItem; await p.click('[data-action="undo"]');
  expect(!bar(), 'a save that works takes the bar away', bar());
  await start(p, 'green'); ls.setItem = () => { throw new Error('QuotaExceededError'); };
  await logSet(p, 0, workIdx(cur(w).exercises[0])[0], { rpe: 8 });
  const live = bar();
  expect(!!live && /\bsets\b/i.test(live) && /finish/i.test(live) && /Keep ReadySet open/.test(live) && /tap Save backup\.$/.test(live) && live.length <= 95, 'a session open: the bar says the sets are not saved, to keep ReadySet open, finish, then tap Save backup', live);
  ls.setItem = setItem;
});
// A15-C1-03: each tap that arms "Skip this session" gets its own 3 s. The timer of an earlier arming used to
// run on, so skipping two sessions in a row could need a third tap.
test('skip: every arming gets its own 3 seconds (A15-C1-03)', async () => {
  const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const p = await w.tab('A').open();
  const skipped = () => w.stored().sessions.filter(s => s.skipped).length;
  await p.click('[data-action="skip-session"]'); // armed (its timer ends 3 s from here)
  await p.click('[data-action="skip-session"]'); // skipped
  expect(skipped() === 1, 'two taps skip the first session', skipped());
  await w.advance(2400);
  await p.click('[data-action="skip-session"]'); // armed again, 2.45 s after the first arming
  await w.advance(600); // past the first arming's 3 s, inside this one's
  await p.click('[data-action="skip-session"]');
  expect(skipped() === 2, 'the second tap within 3 s of arming skips the next session too', skipped());
  await p.click('[data-action="skip-session"]'); await w.advance(3100); await p.click('[data-action="skip-session"]');
  expect(skipped() === 2 && p.toasts.filter(t => t === 'Tap again to skip this session').length === 4, 'a tap more than 3 s after arming only arms again', { n: skipped(), toasts: p.toasts });
});
// A15-C1-05: the buttons on each set row say which exercise and set they act on (screen readers read
// the label alone; there are 15 to 20 "Set done" buttons on a session).
test('set row buttons name their exercise and set (A15-C1-05)', async () => {
  const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const p = await w.tab('A').open(); await start(p, 'green');
  const sq = cur(w).exercises[0], wi = workIdx(sq), name = sq.name;
  const lab = (sel) => (p.$(sel) || { getAttribute: () => '' }).getAttribute('aria-label');
  expect(lab(doneBtn(0, wi[0])) === `Set done: ${name}, set 1`, 'the tick names the exercise and set', lab(doneBtn(0, wi[0])));
  expect(lab(`#main button[data-action="rpe"][data-ei="0"][data-si="${wi[1]}"]`) === `RPE not set: ${name}, set 2`, 'so does the RPE button', lab(`#main button[data-action="rpe"][data-ei="0"][data-si="${wi[1]}"]`));
  expect(lab('#main button[data-action="edit-sets"][data-ei="0"]') === `Remove sets: ${name}`, 'and Remove sets', lab('#main button[data-action="edit-sets"][data-ei="0"]'));
  const labs = p.$$('#main button[data-action="done"]').map(b => b.getAttribute('aria-label'));
  expect(new Set(labs).size === labs.length, 'no two ticks on the screen read the same', labs.length);
  await logSet(p, 0, wi[0], { rpe: 8 });
  expect(lab(doneBtn(0, wi[0])) === `Undo set: ${name}, set 1` && lab(`#main button[data-action="rpe"][data-ei="0"][data-si="${wi[0]}"]`) === `RPE 8: ${name}, set 1`, 'after logging: Undo set and the rating, with the same context', [lab(doneBtn(0, wi[0]))]);
});
// A15-R1-06: no two buttons on the session screen read the same, whatever state the exercises are in: cut sets
// and their Restore, skipped exercises and their Undo, Remove-sets mode with its × and the swipe Delete, Undo delete.
test('no two session buttons read the same, in any state (A15-R1-06)', async () => {
  const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const p = await w.tab('A').open(); await start(p, 'green');
  // In Remove-sets mode the × and the row's swipe Delete are the same action on the same set; the swipe one is out of the tab order.
  const dupes = (skipSwipe) => { const seen = {}, out = []; for (const b of p.$$('#main button')) { if (skipSwipe && b.classList.contains('swipe-del')) continue; const n = (b.getAttribute('aria-label') || b.textContent).replace(/\s+/g, ' ').trim(); if (seen[n]) out.push(n); seen[n] = 1; } return out; };
  const states = [];
  const look = (what, skipSwipe) => { const d = dupes(skipSwipe); states.push(what); expect(!d.length, `${what}: every button has its own name`, d); };
  look('a fresh session');
  // Two lifts each missing a set: each offers "Cut the remaining sets", then each has its "Restore n cut sets".
  const lifts = cur(w).exercises.map((e, i) => (e.lift && e.pctTM != null && workIdx(e).length >= 3 ? i : -1)).filter(i => i >= 0).slice(0, 2);
  for (const ei of lifts) { const ex = cur(w).exercises[ei], si = workIdx(ex)[0]; await logSet(p, ei, si, { r: Math.max(1, ex.sets[si].reps - 2), rpe: 10 }); }
  expect(lifts.length === 2 && lifts.every(ei => p.$(`#main button[data-action="cut-sets"][data-ei="${ei}"],#main button[data-action="restore-sets"][data-ei="${ei}"]`)), 'two lifts offer to cut their remaining sets, or the fatigue stop already cut them', lifts);
  look('two lifts after a missed set');
  for (const ei of lifts) { const b = p.$(`#main button[data-action="cut-sets"][data-ei="${ei}"]`); if (b) await p.click(b); }
  expect(lifts.every(ei => p.$(`#main button[data-action="restore-sets"][data-ei="${ei}"]`)), 'both have a Restore button');
  look('two lifts with cut sets');
  // Every optional exercise skipped: each has its own "Undo skip".
  const opt = cur(w).exercises.map((e, i) => (e.optional ? i : -1)).filter(i => i >= 0);
  for (const ei of opt) await p.click(`#main button[data-action="toggle-skip"][data-ei="${ei}"]`);
  expect(opt.length >= 1 && p.$$('#main button[data-action="toggle-skip"]').filter(b => b.textContent.trim() === 'Undo skip').length === opt.length, 'each skipped exercise has its Undo skip', opt.length);
  // (Each day has one optional exercise today, so two Undo skips cannot meet yet: the name is checked directly.)
  expect(opt.every(ei => (p.$(`#main button[data-action="toggle-skip"][data-ei="${ei}"]`) || { getAttribute: () => '' }).getAttribute('aria-label') === `Undo skip: ${cur(w).exercises[ei].name}`), 'Undo skip names its exercise');
  look('optional exercises skipped');
  // Remove-sets mode on two exercises, then a set deleted (its Undo delete).
  const two = cur(w).exercises.map((e, i) => i).filter(i => !opt.includes(i)).slice(-2);
  for (const ei of two) await p.click(`#main button[data-action="edit-sets"][data-ei="${ei}"]`);
  look('two exercises in Remove-sets mode', true);
  const ex = cur(w).exercises[two[1]], last = ex.sets.length - 1;
  await p.click(`#main button.del[data-action="del-set"][data-ei="${two[1]}"][data-si="${last}"]`);
  expect(!!p.$('#main button[data-action="undo-del"]'), 'a deleted set offers Undo delete');
  look('a set deleted', true);
  expect(p.$$('#main button.swipe-del').every(b => /^Delete this set: .+, (set \d+|warm-up \d+|opener|top single)$/.test(b.getAttribute('aria-label'))), 'the swipe Delete names its exercise and set');
});
// A15-R1-01: ticking a main-lift set opens "How hard was it?" under the finger in the same tap. A second tap
// already on its way (the next row's tick, 71 px lower) landed on an RPE button and rated the set. For 350 ms
// after a tick opens the sheet, trusted taps are ignored; the sheet opened from the RPE button has no such wait.
test('a tick that opens the RPE sheet ignores the next tap for 350 ms (A15-R1-01)', async () => {
  const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const p = await w.tab('A').open(); await start(p, 'green');
  const wi = workIdx(cur(w).exercises[0]), rated = () => cur(w).exercises[0].sets[wi[0]].rpe;
  await w.advance(1000); // past the quiet window after Start
  await p.trustedTap(doneBtn(0, wi[0]), [340, 500]);
  expect(!!(p.sheet() && p.sheet().querySelector('.rpegrid')) && cur(w).exercises[0].sets[wi[0]].done && rated() == null, 'a trusted tick logs the set and opens the RPE sheet');
  await p.trustedTap('#overlay [data-action="rpe-pick"][data-v="8.5"]', [300, 571], 150);
  expect(rated() == null && !!p.sheet(), '150 ms later a tap on an RPE button rates nothing and the sheet stays open', { rpe: rated(), sheet: !!p.sheet() });
  await p.trustedTap('#overlay button[data-action="sheet-close"]', [350, 420], 100);
  expect(!!p.sheet(), 'Skip inside the window does not close it either');
  await p.trustedTap('#overlay [data-action="rpe-pick"][data-v="8"]', [200, 600], 150);
  expect(rated() === 8 && !p.sheet(), 'a pick 400 ms after the tick rates the set and closes the sheet', { rpe: rated() });
  // The sheet opened from the RPE button: the tap is on a button already there, so the pick is not held back.
  await w.advance(1000);
  await p.trustedTap(`#main button[data-action="rpe"][data-ei="0"][data-si="${wi[0]}"]`, [280, 500]);
  await p.trustedTap('#overlay [data-action="rpe-pick"][data-v="7"]', [100, 640], 80);
  expect(rated() === 7 && !p.sheet(), 'from the RPE button, a pick 80 ms later is taken', { rpe: rated() });
});
// A15-C2-03: "Remove sets" adds a note above the sets (and the footer reflows), which moved the button 21-48 px
// down, so tapping again at the same place to say "Done" missed it. The button now holds itself still. This DOM has
// no layout: the button reports top 500 as "Remove sets" and 548 as "Done"; the scroll must take up the 48 px.
test('Remove sets and Done stay under the finger (A15-C2-03)', async () => {
  const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const p = await w.tab('A').open(); await start(p, 'green');
  const rect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () { const t = this.dataset && this.dataset.action === 'edit-sets' ? (this.textContent.trim() === 'Done' ? 548 : 500) : 0; return { top: t, bottom: t + 36, left: 0, right: 0, width: 0, height: 36, x: 0, y: t }; };
  try {
    const sc = p.$('#scroller'); sc.scrollTop = 300;
    await p.click('#main [data-action="edit-sets"][data-ei="0"]');
    expect(!!p.$('#main button.del') && sc.scrollTop === 348, 'Remove sets: the scroll takes up the 48 px, so "Done" is where the finger is', sc.scrollTop);
    await p.click('#main [data-action="edit-sets"][data-ei="0"]');
    expect(!p.$('#main button.del') && sc.scrollTop === 300, 'Done: and back again', sc.scrollTop);
  } finally { Element.prototype.getBoundingClientRect = rect; }
});
// A15-C2-05: the check-in's answer rows ("Fresh … Very sore", "1 Awful … 5 Great") repeat the same button names for
// every question; each row is now a group named by its question, so a screen reader says which question it answers.
test('check-in answer rows are named groups (A15-C2-05)', async () => {
  const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const p = await w.tab('A').open(); await p.click('[data-action="checkin"]');
  const segs = p.$$('#main .seg').filter(s => s.querySelector('[data-action="ci"]'));
  const names = segs.map(s => s.getAttribute('role') === 'group' ? s.getAttribute('aria-label') : null);
  expect(segs.length >= 4 && names.every(n => n) && new Set(names).size === names.length, 'every answer row is a group with its own name', names);
  expect(names.includes('Sleep last night') && names.some(n => /^Soreness: |^How sore/.test(n)), 'the names are the questions', names);
});
// A15-C2-06: a weight 10x off entered through the field (the desktop path: leaving the field sends change), then the
// tick: the typo check opens. The tick had already written its own fill-ins into the set (the slip, kept to 2000, and
// the planned reps), so a save while the check was open stored them. The tick now puts them back. The phone's typing
// path (no change event) is A15-R2-01's test below.
test('the tick puts its fill-ins back when the typo check stops it (A15-C2-06)', async () => {
  const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const p = await w.tab('A').open(); await start(p, 'green');
  const si = workIdx(cur(w).exercises[0])[0];
  await p.change(`#w-0-${si}`, '3050', true); await p.click(doneBtn(0, si));
  expect(!!(p.sheet() && p.sheet().querySelector('[data-action="check-keep"]')), 'the typo check is open');
  p.fire(p.win, 'pagehide', { bubbles: false }); await w.settle();
  const x = w.stored().current.exercises[0].sets[si];
  expect(x.actualW == null && x.actualReps == null && !x.done, 'nothing of the slip is stored when the page hides', { w: x.actualW, r: x.actualReps });
  await p.click('#overlay [data-action="check-keep"]');
  const y = cur(w).exercises[0].sets[si];
  expect(y.done && y.actualW === 2000 && y.okW === 2000, '"Keep" still logs the typed weight (kept to 2000)', { w: y.actualW, done: y.done });
});
// A15-R2-01: set inputs are saved 350 ms after the last key (audit 14), but a value the typo check would question was
// saved too, without the check. On a ticked set it was used at once: 2550 typed for 255 stored 2000 lb and moved the
// later sets up. On the iPhone a tap on a button does not leave the field, so no change event follows and no check was
// ever shown: the session was saved with 2000 lb. Such a value now waits in the field, unsaved and unused, until a tick
// or leaving the field asks. These taps are typed with type() (input only) and tapped with trustedTap, as on the phone.
const setsOf = (ex) => JSON.stringify(ex.sets.map(x => [x.actualW, x.actualReps, !!x.done, x.rpe, !!x.manualW]));
test('a slip typed into an unticked set waits in the field (A15-R2-01)', async () => {
  const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const A = w.tab('A'); let p = await A.open(); await start(p, 'green'); await w.advance(1000);
  const si = workIdx(cur(w).exercises[0])[0], s0 = setsOf(cur(w).exercises[0]);
  await p.type(`#w-0-${si}`, '3050'); await w.advance(500);
  expect(setsOf(cur(w).exercises[0]) === s0 && p.$(`#w-0-${si}`).value === '3050', 'unticked: 500 ms after typing a slip nothing is stored and the field keeps the digits', setsOf(cur(w).exercises[0]));
  await p.trustedTap(doneBtn(0, si), [340, 500], 100);
  expect(!!(p.sheet() && p.sheet().querySelector('[data-action="check-keep"]')) && setsOf(cur(w).exercises[0]) === s0, 'the tick opens the typo check and stores nothing');
  p.fire(p.win, 'pagehide', { bubbles: false }); if (p.visible) await p.show(false); await w.settle();
  expect(setsOf(cur(w).exercises[0]) === s0, 'a hide with the check open stores nothing of the slip', setsOf(cur(w).exercises[0]));
  if (!p.visible) await p.show(true);
  await p.trustedTap('#overlay [data-action="check-keep"]', [200, 600], 500);
  const y = cur(w).exercises[0].sets[si];
  expect(y.done && y.actualW === 2000, '"Keep" logs the typed weight (kept to 2000)', { w: y.actualW, done: y.done });
  // "Use" logs the plan; a reload with the check open stores nothing, and ticking asks again.
  const w2 = new World(); seed(w2, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const B = w2.tab('B'); let q = await B.open(); await start(q, 'green'); await w2.advance(1000);
  const t0 = setsOf(cur(w2).exercises[0]);
  await q.type(`#w-0-${si}`, '3050'); await w2.advance(500);
  await q.trustedTap(doneBtn(0, si), [340, 500], 100);
  B.reload(); await w2.settle(); q = B.page;
  expect(setsOf(cur(w2).exercises[0]) === t0 && q.$(`#w-0-${si}`).value !== '3050' && !q.sheet(), 'a reload with the check open: nothing of the slip is stored, the field shows the old value', { sets: setsOf(cur(w2).exercises[0]), field: q.$(`#w-0-${si}`).value });
  await w2.advance(1000);
  await q.type(`#w-0-${si}`, '3050'); await q.trustedTap(doneBtn(0, si), [340, 500], 100);
  await q.trustedTap('#overlay [data-action="check-use"]', [200, 600], 500);
  const z = cur(w2).exercises[0].sets[si];
  expect(z.done && z.actualW === z.w && !z.manualW, '"Use" logs the planned weight', { w: z.actualW, plan: z.w, done: z.done });
});
test('a slip typed into a ticked set moves nothing (A15-R2-01)', async () => {
  const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const p = await w.tab('A').open(); await start(p, 'green'); await w.advance(1000);
  const wi = workIdx(cur(w).exercises[0]), si = wi[0], ex = () => cur(w).exercises[0];
  await logSet(p, 0, si, { rpe: 8 }); await w.advance(1000);
  const s0 = setsOf(ex()), t0 = ex().target, n0 = ex().adjNote, lifts0 = JSON.stringify(w.stored().lifts);
  await p.type(`#w-0-${si}`, '2550'); await w.advance(500);
  expect(setsOf(ex()) === s0 && ex().target === t0 && ex().adjNote === n0 && JSON.stringify(w.stored().lifts) === lifts0 && !p.sheet(), 'ticked: 500 ms after typing a slip, the set, the later sets, the target, the note and the maxes are unchanged', { sets: setsOf(ex()), target: ex().target, was: t0 });
  const f = p.el(`#w-0-${si}`); p.fire(f, 'change', {}); f.blur(); await w.settle();
  expect(!!(p.sheet() && /Check this weight/.test(p.sheet().textContent)) && setsOf(ex()) === s0, 'leaving the field opens the typo check; still nothing moves');
  await w.advance(600); await p.click('#overlay .sheet-bg');
  expect(!p.sheet() && setsOf(ex()) === s0 && ex().target === t0 && p.$(`#w-0-${si}`).value === '255', 'closing it without an answer leaves the old value, and the field shows it', { sets: setsOf(ex()), field: p.$(`#w-0-${si}`).value });
  // Digits on the way to a sane value ("2", "26") do not re-aim the later sets; the sane value does, as before.
  await p.type(`#w-0-${si}`, '2'); await w.advance(400);
  await p.type(`#w-0-${si}`, '26'); await w.advance(400);
  expect(setsOf(ex()) === s0 && ex().target === t0, 'the first digits of a new weight in a ticked set move nothing', setsOf(ex()));
  await p.type(`#w-0-${si}`, '265'); await w.advance(400);
  expect(ex().sets[si].actualW === 265, 'the sane value is saved 350 ms after the last key, as before', ex().sets[si].actualW);
});
// A15-R3-01: after A15-R2-01 such a value waited only in the field, and on the phone path the next tap on any other
// button redrew the screen and dropped it without a word ("Session updated" even answered "Save changes"). The check
// now opens for it before that tap acts, and takes the tap: you answer, then tap again. A sane value is untouched.
const checkFor = (p) => { const s = p.sheet(); return s && /Check this (weight|rep count)/.test(s.textContent) ? s.textContent.replace(/\s+/g, ' ') : null; };
test('the phone path: a slip in a ticked set asks before the next tick acts (A15-R2-01, A15-R3-01)', async () => {
  const run = async (slip) => {
    const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
    const p = await w.tab('A').open(); await start(p, 'green'); await w.advance(1000);
    const wi = workIdx(cur(w).exercises[0]);
    await logSet(p, 0, wi[0], { rpe: 8 }); await w.advance(2000);
    const s0 = setsOf(cur(w).exercises[0]); let asked = null, held = null;
    if (slip) {
      await p.type(`#w-0-${wi[0]}`, '2550'); // the field keeps the focus: a tap on a button does not leave it on the iPhone
      await p.trustedTap(doneBtn(0, wi[1]), [340, 571], 600);
      asked = checkFor(p); held = setsOf(cur(w).exercises[0]) === s0 && !cur(w).exercises[0].sets[wi[1]].done;
      await w.advance(600); await p.click('#overlay .sheet-bg'); // closed without an answer
      held = held && setsOf(cur(w).exercises[0]) === s0 && p.$(`#w-0-${wi[0]}`).value === '255';
    }
    await p.trustedTap(doneBtn(0, wi[1]), [340, 571], 600);
    const rated = !!(p.sheet() && p.sheet().querySelector('.rpegrid'));
    if (rated) await p.trustedTap('#overlay [data-action="rpe-pick"][data-v="8"]', [200, 600], 500);
    const live = setsOf(cur(w).exercises[0]);
    for (const i of wi.slice(2)) { await w.advance(1000); await logSet(p, 0, i, { rpe: 8 }); }
    await w.advance(1000); await finish(p, 2);
    const done = w.stored().sessions[w.stored().sessions.length - 1];
    return { asked, held, rated, live, saved: done.exercises[0].sets.filter(x => x.kind === 'work').map(x => x.actualW), lifts: JSON.stringify(w.stored().lifts) };
  };
  const a = await run(true), b = await run(false);
  expect(!!a.asked && /set 1: 2000 lb/.test(a.asked), 'the next tick opens the typo check for the slip instead of acting', a.asked);
  expect(a.held, 'nothing is stored and the next set is not ticked; closed without an answer, the old value stays and the field shows it');
  expect(a.rated && a.live === b.live, 'the next tick after that logs and rates as usual, and the later sets keep the weights they would have had', { slip: a.live, none: b.live });
  expect(a.saved[0] === 255 && JSON.stringify(a.saved) === JSON.stringify(b.saved) && a.lifts === b.lifts, 'the saved session holds the logged 255, and the maxes are as without the slip', { slip: a.saved, none: b.saved });
});
test('a slip typed while editing a logged session asks before Save changes (A15-R2-01, A15-R3-01)', async () => {
  const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const p = await w.tab('A').open(); await start(p, 'green'); await w.advance(1000);
  const wi = workIdx(cur(w).exercises[0]);
  for (const i of wi) { await w.advance(1000); await logSet(p, 0, i, { rpe: 8 }); }
  await w.advance(1000); await finish(p, 2);
  const id = w.stored().sessions[w.stored().sessions.length - 1].id, before = w.stored().sessions.find(x => x.id === id).exercises[0].sets.map(x => x.actualW);
  await p.click('#tabbar button[data-view="history"]'); await openRow(p, id);
  await p.click(`[data-action="edit-session"][data-id="${id}"]`);
  const f = `#w-0-${workIdx(cur(w).exercises[0])[0]}`, n0 = p.toasts.length;
  await p.type(f, '135'); await w.advance(600);
  await p.trustedTap('[data-action="edit-save"]', [200, 700], 100);
  let after = w.stored().sessions.find(x => x.id === id).exercises[0].sets.map(x => x.actualW);
  expect(!!checkFor(p) && !!w.stored().current && JSON.stringify(after) === JSON.stringify(before) && !p.toasts.slice(n0).some(t => /Session updated/.test(t)), 'Save changes opens the check first: the edit stays open, nothing is saved, no "Session updated"', { sheet: checkFor(p), editing: !!w.stored().current, toasts: p.toasts.slice(n0) });
  if (p.$('#overlay [data-action="check-keep"]')) { await p.trustedTap('#overlay [data-action="check-keep"]', [200, 600], 500); await p.trustedTap('[data-action="edit-save"]', [200, 700], 500); }
  after = w.stored().sessions.find(x => x.id === id).exercises[0].sets.filter(x => x.kind === 'work').map(x => x.actualW);
  expect(!w.stored().current && after[0] === 135 && p.toasted('Session updated'), 'after "Keep", a second Save changes saves the session with 135', { after, editing: !!w.stored().current });
});
test('a deliberate odd weight waiting in a field is asked about, not dropped (A15-R3-01)', async () => {
  const fresh = async () => { const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 }); const p = await w.tab('A').open(); await start(p, 'green'); await w.advance(1000); return { w, p, wi: workIdx(cur(w).exercises[0]) }; };
  // 135 on a 255 lb day, typed into the ticked, rated set 1; then set 2's tick with the keyboard still up.
  { const { w, p, wi } = await fresh(); const ex = () => cur(w).exercises[0];
    await logSet(p, 0, wi[0], { rpe: 8 }); await w.advance(2000); const s0 = setsOf(ex());
    await p.type(`#w-0-${wi[0]}`, '135'); await w.advance(600);
    await p.trustedTap(doneBtn(0, wi[1]), [340, 571], 600);
    expect(/set 1: 135/.test(checkFor(p) || '') && setsOf(ex()) === s0 && !ex().sets[wi[1]].done, 'the check opens for set 1; nothing is stored; set 2 is not ticked', { sheet: checkFor(p), sets: setsOf(ex()) });
    if (p.$('#overlay [data-action="check-keep"]')) await p.trustedTap('#overlay [data-action="check-keep"]', [200, 600], 500);
    expect(!p.sheet() && ex().sets[wi[0]].actualW === 135 && ex().sets[wi[0]].done && !ex().sets[wi[1]].done, '"Keep" records 135 in the ticked set', setsOf(ex()));
    await p.trustedTap(doneBtn(0, wi[1]), [340, 571], 600);
    expect(ex().sets[wi[1]].done, 'the next tick then works', setsOf(ex())); }
  // A questioned value in a LATER, unticked set, then the current set's tick: the check is for the later set.
  { const { w, p, wi } = await fresh(); const ex = () => cur(w).exercises[0], s0 = setsOf(ex());
    await p.type(`#w-0-${wi[2]}`, '135'); await w.advance(600);
    await p.trustedTap(doneBtn(0, wi[0]), [340, 500], 600);
    expect(/set 3: 135/.test(checkFor(p) || '') && setsOf(ex()) === s0, 'the check is for the later set, and set 1 is not ticked', { sheet: checkFor(p), sets: setsOf(ex()) }); }
  // A tab, by touch as on the phone (the fast tap, D27), under both blur models (D28): the check opens and the view stays.
  for (const model of ['N', 'W']) { const { w, p, wi } = await fresh(); p.blurChange = model === 'W';
    await logSet(p, 0, wi[0], { rpe: 8 }); await w.advance(2000);
    await p.type(`#w-0-${wi[0]}`, '135'); await w.advance(600);
    const taken = await p.fastTap('#tabbar button[data-view="program"]', [150, 840], 600);
    expect(taken && !!checkFor(p) && p.$('#tabbar button[aria-current="page"]').dataset.view === 'today' && cur(w).exercises[0].sets[wi[0]].actualW !== 135, `a tab touch opens the check and the session stays on screen (model ${model}, A15-R4-01)`, { sheet: checkFor(p), view: p.$('#tabbar button[aria-current="page"]').dataset.view }); }
  // That row's own tick on a set already ticked (Undo set) asks too, as a desktop click does by leaving the field.
  { const { w, p, wi } = await fresh(); const ex = () => cur(w).exercises[0];
    await logSet(p, 0, wi[0], { rpe: 8 }); await w.advance(2000); const s0 = setsOf(ex());
    await p.type(`#w-0-${wi[0]}`, '135'); await w.advance(600);
    await p.trustedTap(doneBtn(0, wi[0]), [340, 500], 600);
    expect(/set 1: 135/.test(checkFor(p) || '') && setsOf(ex()) === s0, 'Undo set on the same row asks first; the set stays ticked (A15-C4-01)', { sheet: checkFor(p), sets: setsOf(ex()) }); }
  // That row's own tick on an unticked set reads the field itself: the check comes from the tick, and "Keep" ticks it.
  { const { w, p, wi } = await fresh(); const ex = () => cur(w).exercises[0];
    await p.type(`#w-0-${wi[0]}`, '135'); await w.advance(600);
    await p.trustedTap(doneBtn(0, wi[0]), [340, 500], 600);
    await p.trustedTap('#overlay [data-action="check-keep"]', [200, 600], 500);
    expect(ex().sets[wi[0]].done && ex().sets[wi[0]].actualW === 135, 'the row\'s own tick: "Keep" logs the set at 135', setsOf(ex())); }
});
// A15-R3-04: while a questioned value waits in a weight field, the plates under it described the stored weight.
test('the plates under a weight field never describe another weight (A15-R3-04)', async () => {
  const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const p = await w.tab('A').open(); await start(p, 'green'); await w.advance(1000);
  const si = workIdx(cur(w).exercises[0])[0], f = `#w-0-${si}`, plates = () => p.$(f).nextElementSibling.textContent;
  await logSet(p, 0, si, { rpe: 8 }); await w.advance(2000);
  const r0 = plates();
  await p.type(f, '250'); await w.advance(400); const sane = plates();
  await p.type(f, '255'); await w.advance(400);
  await p.type(f, '135'); await w.advance(400); const odd = plates();
  await p.trustedTap(doneBtn(0, workIdx(cur(w).exercises[0])[1]), [340, 571], 600); // the check asks (A15-R3-01)
  await w.advance(600); await p.click('#overlay .sheet-bg');
  expect(sane !== r0 && sane !== 'lb', 'a sane typed weight shows its own plates, as before', { r0, sane });
  expect(odd === 'lb', 'a questioned value waiting in the field shows plain "lb", not the stored weight\'s plates', { r0, odd });
  expect(!p.sheet() && p.$(f).value === '255' && plates() === r0, 'closing the check puts the stored weight and its plates back', { value: p.$(f).value, plates: plates() });
});
test('a sane typed value, the rest bar and an open sheet are left alone (A15-R3-01)', async () => {
  const fresh = async () => { const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 }); const p = await w.tab('A').open(); await start(p, 'green'); await w.advance(1000); return { w, p, wi: workIdx(cur(w).exercises[0]) }; };
  // A sane 250 typed into set 1, then set 2's tick (before and after the 350 ms save), under both blur models (D28): the
  // field is left first, so 250 carries as on a desktop and set 2 is logged at 250 (decision 15; it was logged at its plan).
  for (const model of ['N', 'W']) for (const ms of [100, 600]) { const { w, p, wi } = await fresh(); p.blurChange = model === 'W'; const ex = () => cur(w).exercises[0];
    await p.type(`#w-0-${wi[0]}`, '250'); await p.trustedTap(doneBtn(0, wi[1]), [340, 571], ms);
    expect(!checkFor(p) && ex().sets[wi[0]].actualW === 250 && !ex().sets[wi[0]].done && ex().sets[wi[1]].done && ex().sets[wi[1]].actualW === 250 && wi.slice(2).every(i => ex().sets[i].actualW === 250 && !ex().sets[i].done), `sane 250, set 2 ticked ${ms} ms later (model ${model}): no check; 250 carries, set 2 is logged at 250 (decision 15)`, setsOf(ex())); }
  // "+30s" and "Done" on the rest bar: no check, the field keeps its digits.
  { const { w, p, wi } = await fresh(); const ex = () => cur(w).exercises[0];
    await logSet(p, 0, wi[0], { rpe: 8 }); await w.advance(2000); const s0 = setsOf(ex()), end0 = w.stored().timer && w.stored().timer.end;
    await p.type(`#w-0-${wi[0]}`, '135'); await w.advance(600);
    await p.trustedTap('#timer [data-action="timer-add"]', [300, 780], 600);
    expect(!p.sheet() && p.$(`#w-0-${wi[0]}`).value === '135' && p.active === p.$(`#w-0-${wi[0]}`) && setsOf(ex()) === s0 && w.stored().timer.end === end0 + 30000, '+30s adds time and leaves the field and its digits alone', { sheet: !!p.sheet(), field: p.$(`#w-0-${wi[0]}`).value });
    await p.trustedTap('#timer [data-action="timer-stop"]', [360, 780], 600);
    expect(!p.sheet() && p.$(`#w-0-${wi[0]}`).value === '135' && !w.stored().timer, 'Done ends the rest and leaves the field alone', { sheet: !!p.sheet(), field: p.$(`#w-0-${wi[0]}`).value }); }
  // With a sheet open, its buttons are the answer: a questioned value focused behind it does not take the tap.
  { const { w, p, wi } = await fresh(); const ex = () => cur(w).exercises[0];
    await p.type(`#w-0-${wi[0]}`, '135'); await p.trustedTap(doneBtn(0, wi[0]), [340, 500], 600); // the check, from the row's own tick
    p.focusAs(`#w-0-${wi[0]}`); // the field focused again behind the open check (its value still 135)
    await p.trustedTap('#overlay [data-action="check-keep"]', [200, 600], 500);
    expect(ex().sets[wi[0]].done && ex().sets[wi[0]].actualW === 135, '"Keep" answers the open check as usual', setsOf(ex())); }
  // After "Fix it" the digits wait in the field: another row's tick asks again.
  { const w = new World(); seed(w, { blockIdx: 2, week: 3, dayIdx: 0, macroPos: 4 });
    const p = await w.tab('A').open(); await start(p, 'green');
    const sets = cur(w).exercises[0].sets, top = sets.findIndex(x => x.open), other = sets.findIndex((x, i) => i !== top && !x.done), f = `#w-0-${top}`;
    await p.change(f, '3650'); await p.click('#overlay [data-action="check-fix"]');
    await p.trustedTap(doneBtn(0, other), [340, 400], 600);
    expect(!!(p.sheet() && p.sheet().querySelector('[data-action="check-fix"]')) && !cur(w).exercises[0].sets[other].done && cur(w).exercises[0].sets[top].actualW == null, 'after "Fix it", another row\'s tick brings the check back and does not tick that row', { sheet: !!p.sheet(), other: cur(w).exercises[0].sets[other].done }); }
});
// A15-R4-01 (decision 26): the tab bar and the rest bar act on the touch itself (the fast tap, D27), and the row's own
// RPE button left the field and relied on the browser sending change on the way out (D28). Where it does not (model N),
// a questioned value was dropped without a word; where it does (model W), a tab touch showed the check over the other
// tab. All three now ask first, as every other button does: the check opens, the tap goes no further, nothing is
// stored until the answer, and "Keep" records it.
test('a tab touch, a "+30s" touch and the row\'s own RPE button ask first, under both blur models (A15-R4-01)', async () => {
  const fresh = async (model) => { const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 }); const p = await w.tab('A').open(); p.blurChange = model === 'W'; await start(p, 'green'); await w.advance(1000); const wi = workIdx(cur(w).exercises[0]); await logSet(p, 0, wi[0], { rpe: 8 }); await w.advance(2000); return { w, p, wi, ex: () => cur(w).exercises[0] }; };
  const view = (p) => p.$('#tabbar button[aria-current="page"]').dataset.view;
  const keep = async (p) => { if (p.$('#overlay [data-action="check-keep"]')) await p.trustedTap('#overlay [data-action="check-keep"]', [200, 600], 500); };
  for (const model of ['N', 'W']) {
    { const { w, p, wi, ex } = await fresh(model); const s0 = setsOf(ex());
      await p.type(`#w-0-${wi[0]}`, '135'); await w.advance(600);
      const taken = await p.fastTap('#tabbar button[data-view="program"]', [150, 840], 600);
      expect(taken && /set 1: 135/.test(checkFor(p) || '') && view(p) === 'today' && setsOf(ex()) === s0, `tab touch, model ${model}: the check opens, the view stays on Today, nothing is stored`, { sheet: checkFor(p), view: view(p), sets: setsOf(ex()) });
      await keep(p);
      expect(!p.sheet() && ex().sets[wi[0]].actualW === 135 && ex().sets[wi[0]].done && view(p) === 'today' && !p.errors.length, `tab touch, model ${model}: "Keep" records 135 in the ticked set, still on Today`, { sets: setsOf(ex()), view: view(p) }); }
    { const { w, p, wi, ex } = await fresh(model); const s0 = setsOf(ex()), end0 = w.stored().timer && w.stored().timer.end;
      await p.type(`#w-0-${wi[0]}`, '135'); await w.advance(600);
      const taken = await p.fastTap('#timer [data-action="timer-add"]', [300, 780], 600);
      expect(taken && end0 > 0 && /set 1: 135/.test(checkFor(p) || '') && setsOf(ex()) === s0 && w.stored().timer.end === end0, `"+30s" touch, model ${model}: the check opens, nothing is stored, no time is added`, { sheet: checkFor(p), sets: setsOf(ex()), end: w.stored().timer && w.stored().timer.end - end0 });
      await keep(p);
      expect(!p.sheet() && ex().sets[wi[0]].actualW === 135 && ex().sets[wi[0]].done && w.stored().timer.end === end0, `"+30s" touch, model ${model}: "Keep" records 135; the rest is as it was`, setsOf(ex())); }
    { const { w, p, wi, ex } = await fresh(model); const s0 = setsOf(ex());
      await p.type(`#w-0-${wi[0]}`, '135'); await w.advance(600);
      await p.trustedTap(`#main button[data-action="rpe"][data-ei="0"][data-si="${wi[0]}"]`, [280, 500], 600);
      expect(/set 1: 135/.test(checkFor(p) || '') && !(p.sheet() && p.sheet().querySelector('.rpegrid')) && setsOf(ex()) === s0, `the row's own RPE button, model ${model}: the check opens (not the RPE sheet), nothing is stored`, { sheet: checkFor(p), sets: setsOf(ex()) });
      await keep(p);
      expect(!p.sheet() && ex().sets[wi[0]].actualW === 135 && ex().sets[wi[0]].done && ex().sets[wi[0]].rpe === 8, `the row's own RPE button, model ${model}: "Keep" records 135 and the set keeps its RPE 8`, setsOf(ex())); }
    // Ordinary touches are unchanged: nothing waiting, a tab touch switches the tab and a "+30s" touch adds 30 s.
    { const { w, p } = await fresh(model); const end0 = w.stored().timer.end;
      const t1 = await p.fastTap('#timer [data-action="timer-add"]', [300, 780], 600);
      expect(t1 && !p.sheet() && w.stored().timer.end === end0 + 30000, `"+30s" touch with nothing waiting, model ${model}: 30 s added`, w.stored().timer.end - end0);
      const t2 = await p.fastTap('#tabbar button[data-view="program"]', [150, 840], 600);
      expect(t2 && view(p) === 'program' && !p.sheet(), `tab touch with nothing waiting, model ${model}: Program opens`, view(p)); }
  }
});
// Decision 15: on the iPhone a tap on a button does not leave a focused set field (D12), so a sane typed weight was
// saved as you typed but never committed, and did not carry to the later sets. A session button now leaves the field
// first, as a desktop click does. Each case is run the iPhone's way (type(): input only, the field keeps the focus)
// under both blur models (D28), and compared with the desktop's way (the value committed by change and the field
// left before the same tap): the stored sets, the note, the toasts and the sheet must match.
test('decision 15: a session button leaves a focused set field first, as on a desktop, under both blur models', async () => {
  const fresh = async (model, ticked) => { const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 }); const p = await w.tab('A').open(); p.blurChange = model === 'W'; await start(p, 'green'); await w.advance(1000); const wi = workIdx(cur(w).exercises[0]); if (ticked) { await logSet(p, 0, wi[0], { rpe: 8 }); await w.advance(2000); } return { w, p, wi, ex: () => cur(w).exercises[0] }; };
  // The snapshot holds every exercise's sets, the weights the screen shows in exercise 0, and whether a set field
  // still has the focus (a desktop click has left it; so must the phone, A15-AR-02).
  const snap = (p, w, n0) => { const ex = cur(w).exercises[0]; return JSON.stringify({ sets: cur(w).exercises.map(setsOf), shown: ex.sets.map((x, i) => p.$(`#w-0-${i}`) ? p.$(`#w-0-${i}`).value : null), note: ex.adjNote || '', toasts: p.toasts.slice(n0), sheet: !p.sheet() ? null : p.sheet().querySelector('.rpegrid') ? 'rpe' : checkFor(p) ? 'check' : 'other', inField: !!(p.active && p.active.dataset && p.active.dataset.set), errors: p.errors.length }); };
  // left: no set field has the focus after the tap; outs: the focusout events the typed field sent. A desktop click's
  // blur sends one before the tap acts; a redraw that only removes the field sends none.
  const run = async (how, ticked, val, tap, ms, o = {}) => { const { w, p, wi, ex } = await fresh(how === 'desktop' ? 'N' : how, ticked); const n0 = p.toasts.length, f = o.field ? o.field(wi) : `#w-0-${wi[0]}`;
    let outs = 0; p.$(f).addEventListener('focusout', () => { outs++; });
    if (how === 'desktop') await p.change(f, val); else await p.type(f, val);
    await p.trustedTap(tap(wi), [340, 571], ms); const left = !(p.active && p.active.dataset && p.active.dataset.set); if (o.wait) await w.advance(o.wait);
    return { s: snap(p, w, n0), ex: ex(), wi, p, left, outs }; };
  const cases = [
    ['item 22: a sane 250 typed into set 1, then set 2\'s tick 100 ms later', false, '250', (wi) => doneBtn(0, wi[1]), 100],
    ['item 22: a sane 250 typed into set 1, then set 2\'s tick 600 ms later', false, '250', (wi) => doneBtn(0, wi[1]), 600],
    ['item 23: ticked set 1 changed to a sane 265, then "Remove sets" on the next exercise', true, '265', () => '#main [data-action="edit-sets"][data-ei="1"]', 600],
    ['ticked set 1 changed to a sane 265, then set 2\'s tick', true, '265', (wi) => doneBtn(0, wi[1]), 600],
    // A15-AR-02: a reps change carries and re-aims too; a tick in another exercise at the same set index is another row.
    ['a sane rep count (3) typed into ticked set 1, then set 2\'s tick 100 ms later', true, '3', (wi) => doneBtn(0, wi[1]), 100, { field: (wi) => `#r-0-${wi[0]}` }],
    ['a sane 250 typed into set 1, then the tick at the same set index in the next exercise', false, '250', (wi) => doneBtn(1, wi[0]), 100],
    // A15-AR-01: "Undo set" reads neither the field nor the typing save, so the field is left first, as on a desktop.
    // Compared a second after the tap, when the typing save would have run.
    ['ticked set 1 changed to a sane 265, then its own tick ("Undo set") 100 ms later', true, '265', (wi) => doneBtn(0, wi[0]), 100, { wait: 1000 }],
    ['ticked set 1 changed to a sane 265, then its own tick ("Undo set") 600 ms later', true, '265', (wi) => doneBtn(0, wi[0]), 600, { wait: 1000 }],
  ];
  for (const [name, ticked, val, tap, ms, o] of cases) {
    const d = await run('desktop', ticked, val, tap, ms, o);
    for (const model of ['N', 'W']) { const r = await run(model, ticked, val, tap, ms, o); expect(r.s === d.s && r.left && r.outs === 1 && d.outs === 1, `${name}, model ${model}: the same as on a desktop, and the field is left first`, { phone: r.s, desktop: d.s, left: r.left, outs: [r.outs, d.outs] }); }
  }
  // The cases above really reach what they name: the other exercise has a tick at that index, and the rep count re-aims.
  { const { p, wi } = await fresh('N', false); expect(!!p.$(doneBtn(1, wi[0])), 'the next exercise has a tick at the same set index as set 1', wi[0]); }
  { const r = await run('N', true, '3', (wi) => doneBtn(0, wi[1]), 100, { field: (wi) => `#r-0-${wi[0]}` });
    expect(r.ex.sets[r.wi[0]].actualReps === 3 && /next sets down/.test(r.ex.adjNote || '') && r.ex.sets[r.wi[1]].done, 'a rep count typed on the phone is committed before the next tick: set 1 holds 3 reps and the next sets are re-aimed', { sets: setsOf(r.ex), note: r.ex.adjNote }); }
  // "Undo set" after a sane 265 (on-phone item 46, A15-AR-01): the screen and the stored set agree, on the phone as on a desktop.
  for (const model of ['N', 'W']) { const r = await run(model, true, '265', (wi) => doneBtn(0, wi[0]), 100, { wait: 1000 }); const x = r.ex.sets[r.wi[0]];
    expect(!x.done && r.p.$(`#w-0-${r.wi[0]}`).value === String(x.actualW != null ? x.actualW : x.w), `"Undo set" 100 ms after a sane 265, model ${model}: set 1 is unticked and its field shows what is stored`, { shown: r.p.$(`#w-0-${r.wi[0]}`).value, actualW: x.actualW, plan: x.w }); }
  // The row's own RPE button with a sane 265 typed into its ticked set: the RPE sheet opens (no check), the set keeps
  // RPE 8 and holds 265, and the whole snapshot (stored sets, the weights shown, note, toasts, sheet) is the desktop's
  // under both models: the button leaves the field first, like every other button (A15-AR-03).
  for (const ms of [100, 600]) { const own = (wi) => `#main button[data-action="rpe"][data-ei="0"][data-si="${wi[0]}"]`, d = await run('desktop', true, '265', own, ms, { wait: 1000 });
    for (const model of ['N', 'W']) { const r = await run(model, true, '265', own, ms, { wait: 1000 }); const x = r.ex.sets[r.wi[0]];
      expect(r.s === d.s && /"sheet":"rpe"/.test(r.s) && x.actualW === 265 && x.done && x.rpe === 8 && r.left, `the row's own RPE button ${ms} ms after a sane 265, model ${model}: the RPE sheet opens, the set keeps RPE 8 and holds 265, as on a desktop`, { phone: r.s, desktop: d.s }); } }
  // A15-AR-03 (on-phone item 47): the row's own RPE button, compared with the desktop under both models.
  // a: ticked set 1 (RPE 8), a sane 265 typed, its RPE button 100 ms later: the screen and the data at the tap.
  // b: 250 committed into set 1 first (the later sets carry it), then the same: a second later the later sets carry 265.
  // c: a stored 135 never confirmed, retyped "135.0" (heldSlip lets it by), then its RPE button: the check asks first.
  { const sheetOf = (p) => !p.sheet() ? null : p.sheet().querySelector('.rpegrid') ? 'rpe' : checkFor(p) ? 'check' : 'other';
    const own = (wi) => `#main button[data-action="rpe"][data-ei="0"][data-si="${wi[0]}"]`;
    const snapR = (p, w) => { const ex = cur(w).exercises[0]; return JSON.stringify({ sets: setsOf(ex), shown: ex.sets.map((x, i) => p.$(`#w-0-${i}`) ? p.$(`#w-0-${i}`).value : null), note: ex.adjNote || '', sheet: sheetOf(p), check: (checkFor(p) || '').slice(0, 70) }); };
    const variant = async (how, kind) => { const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 }); const t = w.tab('A');
      let p = await t.open(); p.blurChange = how === 'W'; await start(p, 'green'); await w.advance(1000);
      const wi = workIdx(cur(w).exercises[0]), f = `#w-0-${wi[0]}`;
      if (kind === 'b') { await p.change(f, '250'); await w.advance(1000); }
      await logSet(p, 0, wi[0], { rpe: 8 }); await w.advance(2000);
      let val = '265';
      if (kind === 'c') { p.unload(); const st = w.stored(), x = st.current.exercises[0].sets[wi[0]]; x.actualW = 135; delete x.okW; w.local.set(KEY, JSON.stringify(st)); p = await t.open(); p.blurChange = how === 'W'; await w.advance(1000); val = '135.0'; }
      if (how === 'desktop') await p.change(f, val); else await p.type(f, val);
      await p.trustedTap(own(wi), [280, 500], kind === 'c' ? 600 : 100); if (kind === 'b') await w.advance(1000);
      return { s: snapR(p, w), ex: cur(w).exercises[0], wi }; };
    const reach = { a: (d) => /"sheet":"rpe"/.test(d.s) && d.wi.slice(1).every(i => d.ex.sets[i].actualW === 250),
      b: (d) => /"sheet":"rpe"/.test(d.s) && d.wi.every(i => d.ex.sets[i].actualW === 265),
      c: (d) => /"sheet":"check"/.test(d.s) && /set 1: 135/.test(d.s) };
    for (const kind of ['a', 'b', 'c']) { const d = await variant('desktop', kind);
      expect(reach[kind](d), `AR-03 ${kind}: the desktop path reaches what the case names`, d.s);
      for (const model of ['N', 'W']) { const r = await variant(model, kind); expect(r.s === d.s, `AR-03 ${kind}, the row's own RPE button, model ${model}: the same as on a desktop`, { phone: r.s, desktop: d.s }); } } }
  // The carry itself, spelled out (on-phone item 22): 250 reaches the later sets, and set 2 is logged at 250.
  { const r = await run('N', false, '250', (wi) => doneBtn(0, wi[1]), 600);
    expect(r.wi.slice(1).every(i => r.ex.sets[i].actualW === 250) && r.ex.sets[r.wi[1]].done && !r.ex.sets[r.wi[0]].done, 'set 1 holds 250, set 2 is logged at 250 and set 3 carries it', setsOf(r.ex)); }
  // That row's own tick reads the field itself and is left as it was: set 1 is logged at 250, the later sets keep their plan.
  for (const model of ['N', 'W']) { const r = await run(model, false, '250', (wi) => doneBtn(0, wi[0]), 600);
    expect(r.ex.sets[r.wi[0]].done && r.ex.sets[r.wi[0]].actualW === 250 && r.wi.slice(1).every(i => r.ex.sets[i].actualW == null && !r.ex.sets[i].done), `the row's own tick, model ${model}: set 1 is logged at 250, the later sets keep their plan (as before)`, setsOf(r.ex)); }
  // A field that is only focused, never typed in, is not committed (a desktop sends no change for it either).
  for (const model of ['N', 'W']) { const { p, wi, ex } = await fresh(model, false); const plan = ex().sets[wi[1]].w;
    p.focusAs(`#w-0-${wi[0]}`); await p.trustedTap(doneBtn(0, wi[1]), [340, 571], 600);
    expect(ex().sets[wi[0]].actualW == null && !ex().sets[wi[0]].done && ex().sets[wi[1]].done && ex().sets[wi[1]].actualW === plan, `a field only focused, then set 2's tick, model ${model}: set 1 is left as it was`, setsOf(ex())); }
  // A typo check that leaving the field opens takes the tap: a stored weight the check questions (never confirmed),
  // retyped as "135.0", then set 2's tick. heldSlip lets it by (the same number as stored); the commit asks.
  for (const model of ['N', 'W']) { const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
    const t = w.tab('A'); let p = await t.open(); await start(p, 'green'); await w.advance(1000);
    const wi = workIdx(cur(w).exercises[0]); await logSet(p, 0, wi[0], { rpe: 8 }); await w.advance(2000);
    p.unload(); const st = w.stored(), x = st.current.exercises[0].sets[wi[0]]; x.actualW = 135; delete x.okW; w.local.set(KEY, JSON.stringify(st));
    p = await t.open(); p.blurChange = model === 'W'; await w.advance(1000);
    await p.type(`#w-0-${wi[0]}`, '135.0'); await w.advance(600);
    await p.trustedTap(doneBtn(0, wi[1]), [340, 571], 600);
    const e = cur(w).exercises[0];
    expect(/set 1: 135/.test(checkFor(p) || '') && !e.sets[wi[1]].done, `a check opened by leaving the field takes the tap, model ${model}: set 2 is not ticked`, { sheet: checkFor(p), sets: setsOf(e) }); }
  // Editing a logged session: a sane value typed, then "Save changes" with the field focused saves that value.
  for (const model of ['N', 'W']) { const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
    const p = await w.tab('A').open(); p.blurChange = model === 'W'; await start(p, 'green'); await w.advance(1000);
    const wi = workIdx(cur(w).exercises[0]);
    for (const i of wi) { await w.advance(1000); await logSet(p, 0, i, { rpe: 8 }); }
    await w.advance(1000); await finish(p, 2);
    const id = w.stored().sessions[w.stored().sessions.length - 1].id;
    await p.click('#tabbar button[data-view="history"]'); await openRow(p, id); await p.click(`[data-action="edit-session"][data-id="${id}"]`);
    await w.advance(1000); await p.type(`#w-0-${workIdx(cur(w).exercises[0])[1]}`, '250');
    await p.trustedTap('[data-action="edit-save"]', [200, 700], 100);
    const saved = w.stored().sessions.find(x => x.id === id).exercises[0].sets.filter(x => x.kind === 'work').map(x => x.actualW);
    expect(!w.stored().current && saved[1] === 250 && p.toasted('Session updated') && !p.errors.length, `editing a logged session, model ${model}: 250 typed into set 2, then "Save changes" 100 ms later saves 250`, { saved, editing: !!w.stored().current }); }
  // "Fix it" digits corrected to a sane value, then another row's tick: committed once, the same under both models.
  const fixed = [];
  for (const model of ['N', 'W']) { const w = new World(); seed(w, { blockIdx: 2, week: 3, dayIdx: 0, macroPos: 4 });
    const p = await w.tab('A').open(); p.blurChange = model === 'W'; await start(p, 'green');
    const sets = cur(w).exercises[0].sets, top = sets.findIndex(x => x.open), other = sets.findIndex((x, i) => i !== top && !x.done), f = `#w-0-${top}`, plan = sets[top].w;
    await p.change(f, '3650'); await p.click('#overlay [data-action="check-fix"]');
    const n0 = p.toasts.length; await p.type(f, String(plan)); await w.advance(600);
    await p.trustedTap(doneBtn(0, other), [340, 400], 600);
    const ex = cur(w).exercises[0];
    expect(!checkFor(p) && ex.sets[top].actualW === plan && ex.sets[other].done && !p.errors.length, `after "Fix it", the planned ${plan} typed, then another row's tick, model ${model}: no check; ${plan} is stored and the tick acts`, { sets: setsOf(ex), sheet: checkFor(p) });
    fixed.push(JSON.stringify({ sets: setsOf(ex), toasts: p.toasts.slice(n0) })); }
  expect(fixed[0] === fixed[1], 'after "Fix it": the same sets and toasts under both models (committed once)', fixed);
});
// A15-R2-02: in History, "‹ Earlier" and "Later ›" under a chart moved 46-138 px on almost every tap, because the
// chart was held still and the session details above the buttons change length. The tapped button now holds itself
// still. This DOM has no layout: a step button reports its top as 400 + 30 x (the session number shown beside it), so
// one step earlier puts it 30 px higher, and the scroll must follow it.
test('Earlier and Later stay under the finger (A15-R2-02)', async () => {
  const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const p = await w.tab('A').open();
  for (let n = 0; n < 5; n++) {
    await start(p, 'green'); await w.advance(1000);
    const exs = cur(w).exercises;
    for (let ei = 0; ei < exs.length; ei++) if (exs[ei].lift) for (const si of workIdx(cur(w).exercises[ei])) { await w.advance(1000); if (cur(w).exercises[ei].sets[si]) await logSet(p, ei, si, { rpe: 8 }); }
    await w.advance(1000); await finish(p, 2); await w.advance(3600e3);
  }
  await p.click('#tabbar button[data-view="history"]');
  const cv = p.el('#c-squat'); p.fire(cv, 'click', { clientX: 330, clientY: 40 }); await w.settle(); // a pick on a dot
  const nav = () => { const s = p.$('#trend-card .pt-nav .num'); return s ? s.textContent.split(' of ').map(Number) : [null, null]; }, shown = () => nav()[0];
  const [k0, n] = nav(), dir = k0 > 2 ? -1 : 1, step = `#trend-card [data-action="chart-step"][data-dir="${dir}"]`, back = `#trend-card [data-action="chart-step"][data-dir="${-dir}"]`;
  expect(n >= 3 && k0 >= 1, 'the chart detail is open on a squat session, with three to step through', { k0, n });
  const pos = p.$('#trend-card .pt-nav .pt-pos');
  expect(!!pos && pos.dataset.w === '0'.repeat(String(n).length) + ' of ' + n, 'the session number keeps the room of its widest value, so the row never re-wraps as it gains a digit (A15-C4-02)', pos && pos.dataset.w);
  const rect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    const t = this.dataset && this.dataset.action === 'chart-step' ? 400 + 30 * (Number((this.parentNode.textContent.match(/(\d+) of/) || [])[1]) || 0) : this.id === 'c-squat' ? 100 : 0;
    const h = this.classList && this.classList.contains('pt-card') ? 300 + 10 * (Number((this.textContent.match(/(\d+) of/) || [])[1]) || 0) : 36; // the details' height changes per session (A15-R3-02)
    return { top: t, bottom: t + h, left: 0, right: 0, width: 0, height: h, x: 0, y: t };
  };
  try {
    const sc = p.$('#scroller'); sc.scrollTop = 600;
    await p.trustedTap(step, [60, 520], 500);
    expect(shown() === k0 + dir && sc.scrollTop === 600 + 30 * dir, 'one step: the scroll follows the tapped button by its 30 px', { shown: shown(), scroll: sc.scrollTop });
    const minH = () => (p.$('#trend-card .pt-card') || { style: {} }).style.minHeight;
    expect(minH() === (300 + 10 * k0) + 'px', 'a step keeps the details at least as tall as they were, so at the top of History nothing moves (A15-R3-02)', { minH: minH(), was: 300 + 10 * k0 });
    await p.trustedTap(step, [60, 520], 200);
    expect(shown() === k0 + 2 * dir && sc.scrollTop === 600 + 60 * dir, 'a second tap 200 ms later steps again, and the button is still under the finger', { shown: shown(), scroll: sc.scrollTop });
    await p.trustedTap(back, [200, 520], 500);
    expect(shown() === k0 + dir && sc.scrollTop === 600 + 30 * dir, 'the other button holds itself the same way', { shown: shown(), scroll: sc.scrollTop });
    p.fire(p.el('#c-squat'), 'click', { clientX: 300, clientY: 40 }); await w.settle(); // a pick while the details are open
    expect(!!p.$('#trend-card .pt-nav') && !minH(), 'a pick starts the details afresh (no kept height)', minH());
    const y0 = sc.scrollTop; await p.trustedTap('#trend-card [data-action="chart-close"]', [340, 300], 500);
    expect(!p.$('#trend-card .pt-nav') && sc.scrollTop === y0, 'Close holds the chart, as before', sc.scrollTop);
    p.fire(p.el('#c-squat'), 'click', { clientX: 330, clientY: 40 }); await w.settle(); // a new pick
    expect(!!p.$('#trend-card .pt-nav') && !minH(), 'Close, then a new pick, starts the details afresh (no kept height)', minH());
  } finally { Element.prototype.getBoundingClientRect = rect; }
});
// A15-R2-04: the rest bar's label was chosen when the set was ticked, before the fatigue stop could cut the rest of
// the exercise, so it went on naming the finished exercise ("· Competition Squat", "Next: Competition Squat"). The
// same after "Cut the remaining sets" or deleting the last open set. It now names what comes next, and Restore or
// Undo delete puts it back. The rest itself is neither restarted nor made longer.
test('the rest bar names the next exercise after a fatigue stop, a cut or a delete (A15-R2-04)', async () => {
  const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const p = await w.tab('A').open(); await start(p, 'green'); await w.advance(1000);
  const ex = (i) => cur(w).exercises[i], wi = workIdx(ex(0)), n0 = ex(0).name, n1 = ex(1).name;
  const bar = () => { const t = p.$('#timer .t-sub'); return t ? t.textContent : ''; };
  await logSet(p, 0, wi[0], { r: ex(0).sets[wi[0]].reps - 1, rpe: 10 });
  const end = w.stored().timer && w.stored().timer.end;
  expect(ex(0).autoStopped && ex(0).sets.every(x => x.done || x.kind !== 'work'), 'a missed rep at RPE 10 fires the fatigue stop and cuts the rest of the exercise');
  expect(w.stored().timer.label === n1 && bar().endsWith(n1) && w.stored().timer.end === end, 'the running rest names the next exercise, with the same end time', { label: w.stored().timer.label, bar: bar() });
  await p.click('#main [data-action="restore-sets"][data-ei="0"]');
  expect(w.stored().timer.label === n0 && bar().endsWith(n0) && w.stored().timer.end === end, 'Restore puts the label back', { label: w.stored().timer.label, bar: bar() });
  // "Cut the remaining sets" by hand.
  await p.click('#main [data-action="cut-sets"][data-ei="0"]');
  expect(w.stored().timer.label === n1 && w.stored().timer.end === end, '"Cut the remaining sets": the next exercise', w.stored().timer.label);
  // Deleting the last open set, then Undo delete.
  const w2 = new World(); seed(w2, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const q = await w2.tab('B').open(); await start(q, 'green'); await w2.advance(1000);
  const e2 = () => cur(w2).exercises[0], wj = workIdx(e2());
  for (const i of wj.slice(0, -1)) { await w2.advance(1000); await logSet(q, 0, i, { rpe: 8 }); }
  expect(w2.stored().timer.label === n0, 'resting after a set with one left: the bar names this exercise', w2.stored().timer.label);
  await q.click('#main [data-action="edit-sets"][data-ei="0"]');
  await q.click(`#main button.del[data-ei="0"][data-si="${wj[wj.length - 1]}"]`);
  expect(w2.stored().timer && w2.stored().timer.label === n1, 'the last open set deleted: the next exercise', w2.stored().timer && w2.stored().timer.label);
  await q.click('#main [data-action="undo-del"][data-ei="0"]');
  expect(w2.stored().timer.label === n0, 'Undo delete puts it back', w2.stored().timer.label);
  await w2.advance(1000); await logSet(q, 0, wj[wj.length - 1], { rpe: 8 });
  expect(w2.stored().timer.label === n1, 'the last work set ticked with the warm-ups left unticked: the next exercise', w2.stored().timer.label);
});
// A15-R3-03: cut sets that come back because a reading was corrected in its field, or because a mid-session max change
// rebased the session, left the rest bar naming the next exercise. They now put this exercise's name back.
test('cut sets that come back put the rest label back: a corrected field, a max change (A15-R3-03)', async () => {
  const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const p = await w.tab('A').open(); await start(p, 'green'); await w.advance(1000);
  const ex = (i) => cur(w).exercises[i], wi = workIdx(ex(0)), n0 = ex(0).name, n1 = ex(1).name, reps = ex(0).sets[wi[0]].reps;
  const bar = () => { const t = p.$('#timer .t-sub'); return t ? t.textContent : ''; };
  await logSet(p, 0, wi[0], { r: reps - 1, rpe: 10 }); // a mistyped rep count: the fatigue stop cuts the rest
  const end = w.stored().timer && w.stored().timer.end;
  expect(ex(0).autoStopped && w.stored().timer.label === n1, 'the stop names the next exercise', w.stored().timer && w.stored().timer.label);
  await p.change(`#r-0-${wi[0]}`, String(reps)); // the reps corrected in the field
  expect(!ex(0).autoStopped && workIdx(ex(0)).length === wi.length && w.stored().timer.label === n0 && bar().endsWith(n0) && w.stored().timer.end === end, 'the sets come back and the bar names this exercise again, with the same end time', { label: w.stored().timer.label, bar: bar(), sets: workIdx(ex(0)).length });
  // A stop on a later set still 2+ over target, then a lower max (365 -> 320) under which it no longer holds.
  const w2 = new World(); seed(w2, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const q = await w2.tab('B').open(); await start(q, 'green'); await w2.advance(1000);
  const e2 = () => cur(w2).exercises[0];
  await logSet(q, 0, wi[0], { rpe: 10 }); await w2.advance(1000); await logSet(q, 0, wi[1], { rpe: 10 });
  expect(e2().autoStopped && w2.stored().timer.label === n1, 'a second set still far over target stops the exercise', w2.stored().timer && w2.stored().timer.label);
  await q.click('#tabbar button[data-view="settings"]'); await q.change('#set-1rm-squat', '320');
  expect(w2.stored().lifts.squat.oneRM === 320 && !e2().autoStopped && workIdx(e2()).length === wi.length && w2.stored().timer.label === n0, 'the max change rebases the session, the sets come back, and the label names this exercise', { label: w2.stored().timer.label, sets: workIdx(e2()).length, max: w2.stored().lifts.squat.oneRM });
});
test('a sane typed weight is still saved as you type and survives a reload (A15-R2-01)', async () => {
  const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const A = w.tab('A'); let p = await A.open(); await start(p, 'green'); await w.advance(1000);
  const si = workIdx(cur(w).exercises[0])[0];
  await p.type(`#w-0-${si}`, '250'); await w.advance(400);
  expect(cur(w).exercises[0].sets[si].actualW === 250, 'saved 350 ms after the last key', cur(w).exercises[0].sets[si].actualW);
  A.reload(); await w.settle(); p = A.page;
  expect(cur(w).exercises[0].sets[si].actualW === 250 && p.$(`#w-0-${si}`).value === '250', 'kept across a reload', p.$(`#w-0-${si}`).value);
});
// A15-C2-01: deleting a set in Remove-sets mode ends the mode, and the next set moves up, so its tick lands where the
// × was. A second tap meant for another × (450-600 ms later, past the double-tap guard) logged that set, started a
// rest and opened the RPE sheet. For 700 ms after a delete, trusted taps are ignored.
test('a delete in Remove-sets mode ignores the next tap for 700 ms (A15-C2-01)', async () => {
  const w = new World(); seed(w, { blockIdx: 0, week: 1, dayIdx: 0, macroPos: 0 });
  const p = await w.tab('A').open(); await start(p, 'green');
  await w.advance(1000);
  const ex = () => cur(w).exercises[1], wi = workIdx(ex()), n = ex().sets.length, si = wi[wi.length - 2];
  await p.trustedTap('#main button[data-action="edit-sets"][data-ei="1"]', [300, 200]);
  await p.trustedTap(`#main button.del[data-ei="1"][data-si="${si}"]`, [360, 520]);
  expect(ex().sets.length === n - 1 && !!p.$(doneBtn(1, si)), 'the set is deleted and the next one\'s tick is in its place', ex().sets.length);
  await p.trustedTap(doneBtn(1, si), [360, 520], 450);
  expect(!ex().sets[si].done && !p.sheet(), '450 ms later a tap on that spot logs nothing', { done: ex().sets[si].done });
  await p.trustedTap(doneBtn(1, si), [360, 520], 400);
  expect(ex().sets[si].done, 'a tap 850 ms after the delete logs the set as usual');
});

// ---------- Run ----------
process.on('unhandledRejection', (e) => { fails++; checks++; console.log('FAIL', current + ': unhandled rejection', e && e.stack); });
(async () => {
  for (const t of TESTS) {
    if (process.env.ONLY && !t.name.includes(process.env.ONLY)) continue;
    current = t.name; WORLDS = [];
    try { await t.fn(); } catch (e) { fails++; checks++; console.log('FAIL', t.name + ': threw', e && e.stack); }
    const errs = []; for (const w of WORLDS) for (const pg of w.pages) { for (const x of pg.errors) errs.push(`${pg.name}: ${x && x.stack ? x.stack.split('\n').slice(0, 3).join(' | ') : x}`); }
    expect(!errs.length, 'no uncaught error in the app', errs);
  }
  console.log(`${checks} checks, ${fails} failures`);
  process.exitCode = fails ? 1 : 0;
})();
