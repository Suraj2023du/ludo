/**
 * tools/dom-stub.js — a very small DOM + Canvas shim for Node.
 *
 * DEV TOOL ONLY. It is never shipped, never precached and never imported by the
 * game. Its job is to let tools/boot-check.js and tests/ui.test.js load
 * index.html, boot src/main.js and click real buttons in Node, which is how we
 * prove the app boots and wires up without a browser.
 *
 * It implements exactly the surface the game uses — no more.
 */

import { readFileSync } from 'node:fs';

const VOID_TAGS = new Set(['meta', 'link', 'br', 'hr', 'img', 'input', 'source', 'area', 'base']);

/* ─────────────────────────────── tiny HTML parser ────────────────────────── */

function parseHtml(html, doc) {
  const root = doc.createElement('#document-fragment');
  const stack = [root];
  let i = 0;

  const push = (node) => {
    stack[stack.length - 1].appendChild(node);
  };

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      addText(html.slice(i));
      break;
    }
    if (lt > i) addText(html.slice(i, lt));

    if (html.startsWith('<!--', lt)) {
      i = html.indexOf('-->', lt);
      i = i === -1 ? html.length : i + 3;
      continue;
    }
    if (html.startsWith('<!', lt)) {
      i = html.indexOf('>', lt) + 1;
      continue;
    }
    const gt = findTagEnd(html, lt);
    const raw = html.slice(lt + 1, gt).trim();
    i = gt + 1;

    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim().toLowerCase();
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s].tagName === name) {
          stack.length = s;
          break;
        }
      }
      continue;
    }

    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const spaceAt = body.search(/\s/);
    const tag = (spaceAt === -1 ? body : body.slice(0, spaceAt)).toLowerCase();
    const attrText = spaceAt === -1 ? '' : body.slice(spaceAt + 1);

    const el = doc.createElement(tag);
    for (const [name, value] of parseAttrs(attrText)) el.setAttribute(name, value);
    push(el);

    if (!selfClosing && !VOID_TAGS.has(tag)) {
      stack.push(el);
      if (tag === 'script' || tag === 'style' || tag === 'noscript') {
        const close = html.toLowerCase().indexOf('</' + tag, i);
        const end = close === -1 ? html.length : close;
        el.appendChild(doc.createTextNode(html.slice(i, end)));
        i = end;
        stack.pop();
      }
    }
  }

  function addText(text) {
    if (!text.trim()) return;
    push(doc.createTextNode(text));
  }

  return root;
}

function findTagEnd(html, from) {
  let quote = null;
  for (let i = from + 1; i < html.length; i++) {
    const c = html[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i;
  }
  return html.length;
}

function parseAttrs(text) {
  const out = [];
  const re = /([a-zA-Z_:@.-][\w:.@-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1].toLowerCase();
    const value = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';
    out.push([name, value]);
  }
  return out;
}

/* ─────────────────────────────── canvas context ──────────────────────────── */

function createContext2D() {
  const gradient = { addColorStop() { } };
  const ctx = {
    canvas: null,
    calls: 0,
    save() { },
    restore() { },
    beginPath() { },
    closePath() { },
    moveTo() { },
    lineTo() { },
    quadraticCurveTo() { },
    bezierCurveTo() { },
    arc() { },
    arcTo() { },
    ellipse() { },
    rect() { },
    roundRect() { },
    fill() { },
    stroke() { },
    fillRect() { },
    strokeRect() { },
    clearRect() { },
    clip() { },
    translate() { },
    rotate() { },
    scale() { },
    setTransform() { },
    resetTransform() { },
    drawImage() { },
    fillText() { },
    strokeText() { },
    measureText: (t) => ({ width: String(t).length * 6 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => null,
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData() { },
    setLineDash() { },
  };
  // count every draw call so tests can assert the frame actually painted
  for (const key of Object.keys(ctx)) {
    if (typeof ctx[key] === 'function') {
      const fn = ctx[key];
      ctx[key] = function wrapped(...args) {
        ctx.calls++;
        return fn.apply(ctx, args);
      };
    }
  }
  return ctx;
}

/* ──────────────────────────────── nodes ──────────────────────────────────── */

class ClassList {
  constructor(el) {
    this.el = el;
  }
  get set() {
    const v = this.el.getAttribute('class') || '';
    return new Set(v.split(/\s+/).filter(Boolean));
  }
  write(set) {
    this.el.setAttribute('class', [...set].join(' '));
  }
  add(...names) {
    const s = this.set;
    for (const n of names) s.add(n);
    this.write(s);
  }
  remove(...names) {
    const s = this.set;
    for (const n of names) s.delete(n);
    this.write(s);
  }
  contains(name) {
    return this.set.has(name);
  }
  toggle(name, force) {
    const s = this.set;
    const on = force === undefined ? !s.has(name) : !!force;
    if (on) s.add(name);
    else s.delete(name);
    this.write(s);
    return on;
  }
}

class Style {
  constructor() {
    this._props = new Map();
  }
  setProperty(name, value) {
    this._props.set(name, String(value));
  }
  getPropertyValue(name) {
    return this._props.get(name) || '';
  }
  removeProperty(name) {
    this._props.delete(name);
  }
}

let nextId = 1;

class Node {
  constructor(doc) {
    this.ownerDocument = doc;
    this.childNodes = [];
    this.parentElement = null;
    this._listeners = new Map();
    this._uid = nextId++;
  }

  get children() {
    return this.childNodes.filter((n) => n.nodeType === 1);
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  appendChild(node) {
    if (node.parentElement) node.parentElement.removeChild(node);
    node.parentElement = this;
    this.childNodes.push(node);
    return node;
  }

  append(...nodes) {
    for (const n of nodes) this.appendChild(typeof n === 'string' ? this.ownerDocument.createTextNode(n) : n);
  }

  removeChild(node) {
    const i = this.childNodes.indexOf(node);
    if (i >= 0) this.childNodes.splice(i, 1);
    node.parentElement = null;
    return node;
  }

  remove() {
    if (this.parentElement) this.parentElement.removeChild(this);
  }

  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
  }

  removeEventListener(type, fn) {
    const set = this._listeners.get(type);
    if (set) set.delete(fn);
  }

  dispatchEvent(event) {
    event.target = event.target || this;
    const set = this._listeners.get(event.type);
    if (set) for (const fn of [...set]) fn(event);
    return true;
  }

  /** Convenience used by the tests: fire a click. */
  click() {
    this.dispatchEvent({ type: 'click', target: this, preventDefault() { }, stopPropagation() { } });
  }
}

class TextNode extends Node {
  constructor(doc, text) {
    super(doc);
    this.nodeType = 3;
    this.text = text;
  }
  get textContent() {
    return this.text;
  }
  set textContent(v) {
    this.text = String(v);
  }
}

class Element extends Node {
  constructor(doc, tagName) {
    super(doc);
    this.nodeType = 1;
    this.tagName = tagName;
    this.attributes = new Map();
    this.classList = new ClassList(this);
    this.style = new Style();
    this.offsetWidth = 0;
    this.offsetHeight = 0;
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.checked = false;
    this._ctx = null;
    this.width = 0;
    this.height = 0;
    this.clientWidth = 390;
    this.clientHeight = 640;

    const self = this;
    this.dataset = new Proxy(
      {},
      {
        get(_t, key) {
          return self.getAttribute('data-' + camelToDash(String(key))) ?? undefined;
        },
        set(_t, key, value) {
          self.setAttribute('data-' + camelToDash(String(key)), String(value));
          return true;
        },
        has(_t, key) {
          return self.attributes.has('data-' + camelToDash(String(key)));
        },
        deleteProperty(_t, key) {
          self.attributes.delete('data-' + camelToDash(String(key)));
          return true;
        },
      }
    );
  }

  get id() {
    return this.getAttribute('id') || '';
  }
  set id(v) {
    this.setAttribute('id', v);
  }

  get className() {
    return this.getAttribute('class') || '';
  }
  set className(v) {
    this.setAttribute('class', v);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  hasAttribute(name) {
    return this.attributes.has(name);
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }

  get textContent() {
    return this.childNodes.map((n) => n.textContent).join('');
  }
  set textContent(v) {
    this.childNodes = [];
    if (v !== '' && v !== null && v !== undefined) {
      this.appendChild(this.ownerDocument.createTextNode(String(v)));
    }
  }

  get innerHTML() {
    return this.textContent;
  }

  /** Parses the markup, like a browser, so inline SVG icons work in tests. */
  set innerHTML(html) {
    this.childNodes = [];
    const frag = parseHtml(String(html), this.ownerDocument);
    for (const child of [...frag.childNodes]) this.appendChild(child);
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }
  blur() { }

  getBoundingClientRect() {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: this.clientWidth,
      bottom: this.clientHeight,
      width: this.clientWidth,
      height: this.clientHeight,
    };
  }

  getContext(kind) {
    if (kind !== '2d') return null;
    if (!this._ctx) {
      this._ctx = createContext2D();
      this._ctx.canvas = this;
    }
    return this._ctx;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const groups = String(selector)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(parseSimpleSelector);
    const out = [];
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType !== 1) continue;
        if (groups.some((g) => matches(child, g))) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
}

function camelToDash(s) {
  return s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}

/** Supports: tag, #id, .class, [attr], [attr="value"] and combinations. */
function parseSimpleSelector(sel) {
  const spec = { tag: null, id: null, classes: [], attrs: [] };
  const re = /([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/g;
  let m;
  while ((m = re.exec(sel))) {
    if (m[1]) spec.tag = m[1].toLowerCase();
    else if (m[2]) spec.id = m[2];
    else if (m[3]) spec.classes.push(m[3]);
    else if (m[4]) spec.attrs.push([m[4], m[5]]);
  }
  return spec;
}

function matches(el, spec) {
  if (spec.tag && el.tagName !== spec.tag) return false;
  if (spec.id && el.getAttribute('id') !== spec.id) return false;
  for (const c of spec.classes) if (!el.classList.contains(c)) return false;
  for (const [name, value] of spec.attrs) {
    if (!el.attributes.has(name)) return false;
    if (value !== undefined && value !== null && el.getAttribute(name) !== value) return false;
  }
  return true;
}

/* ──────────────────────────────── document ───────────────────────────────── */

class Document extends Node {
  constructor() {
    super(null);
    this.ownerDocument = this;
    this.nodeType = 9;
    this.readyState = 'complete';
    this.hidden = false;
    this.activeElement = null;
    this.documentElement = this.createElement('html');
    this.body = this.createElement('body');
    this.head = this.createElement('head');
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
  }
  createElement(tag) {
    return new Element(this, String(tag).toLowerCase());
  }
  createTextNode(text) {
    return new TextNode(this, String(text));
  }
  getElementById(id) {
    return this.querySelector('#' + id);
  }
  querySelector(sel) {
    return Element.prototype.querySelector.call(this, sel);
  }
  querySelectorAll(sel) {
    return Element.prototype.querySelectorAll.call(this, sel);
  }
}

/* ──────────────────────────────── installer ──────────────────────────────── */

/**
 * Install the shim on globalThis and load index.html into it.
 * @param {object} opts { htmlPath, width, height, dpr, storage }
 * @returns {{document:Document, window:object, console:{errors:string[],warnings:string[]}, tick:Function, restore:Function}}
 */
export function installDom(opts = {}) {
  const doc = new Document();
  const html = readFileSync(opts.htmlPath, 'utf8');
  const frag = parseHtml(html, doc);

  // Distribute parsed top-level nodes into head/body like a browser would.
  const flatten = (node, into) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 1 && (child.tagName === 'html' || child.tagName === 'body' || child.tagName === 'head')) {
        flatten(child, child.tagName === 'head' ? doc.head : into);
      } else {
        into.appendChild(child);
      }
    }
  };
  flatten(frag, doc.body);

  const width = opts.width || 390;
  const height = opts.height || 780;
  for (const canvas of doc.querySelectorAll('canvas')) {
    canvas.clientWidth = width - 16;
    canvas.clientHeight = Math.round(height * 0.62);
  }

  /* localStorage */
  const map = new Map(Object.entries(opts.storage || {}));
  const localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
    _map: map,
  };

  /* animation frames — unref'd so they never keep the process alive */
  let frameId = 1;
  const frames = new Map();
  const requestAnimationFrame = (cb) => {
    const id = frameId++;
    const timer = setTimeout(() => {
      frames.delete(id);
      cb(performanceNow());
    }, 16);
    if (typeof timer.unref === 'function') timer.unref();
    frames.set(id, timer);
    return id;
  };
  const cancelAnimationFrame = (id) => {
    const t = frames.get(id);
    if (t) clearTimeout(t);
    frames.delete(id);
  };
  const performanceNow = () => Number(process.hrtime.bigint() / 1000000n);

  const listeners = new Map();
  const win = {
    document: doc,
    innerWidth: width,
    innerHeight: height,
    devicePixelRatio: opts.dpr || 2,
    localStorage,
    requestAnimationFrame,
    cancelAnimationFrame,
    setTimeout,
    clearTimeout,
    location: { protocol: 'http:', href: 'http://localhost/', origin: 'http://localhost' },
    navigator: { userAgent: 'node-dom-stub', vibrate: () => true },
    matchMedia: () => ({ matches: false, addEventListener() { }, removeEventListener() { } }),
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      const set = listeners.get(type);
      if (set) set.delete(fn);
    },
    dispatchEvent(event) {
      const set = listeners.get(event.type);
      if (set) for (const fn of [...set]) fn(event);
      return true;
    },
    _listeners: listeners,
  };
  // No AudioContext on purpose: the synth must degrade to silence, not crash.

  const captured = { errors: [], warnings: [] };
  const realError = console.error;
  const realWarn = console.warn;
  console.error = (...args) => {
    captured.errors.push(args.map(String).join(' '));
  };
  console.warn = (...args) => {
    captured.warnings.push(args.map(String).join(' '));
  };

  // Some of these (navigator, location) are getter-only on globalThis in Node,
  // so redefine rather than assign, and remember the original descriptor.
  const previous = new Map();
  const assign = (key, value) => {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  };
  assign('window', win);
  assign('document', doc);
  assign('localStorage', localStorage);
  assign('navigator', win.navigator);
  assign('location', win.location);
  assign('requestAnimationFrame', requestAnimationFrame);
  assign('cancelAnimationFrame', cancelAnimationFrame);
  assign('matchMedia', win.matchMedia);
  assign('devicePixelRatio', win.devicePixelRatio);

  return {
    document: doc,
    window: win,
    console: captured,
    localStorage,
    /** Wait a few real frames so animations/promises settle. */
    tick: (ms = 40) => new Promise((r) => setTimeout(r, ms)),
    frames,
    restore() {
      console.error = realError;
      console.warn = realWarn;
      for (const [k, desc] of previous) {
        if (desc === undefined) delete globalThis[k];
        else Object.defineProperty(globalThis, k, desc);
      }
      for (const t of frames.values()) clearTimeout(t);
      frames.clear();
    },
  };
}

/** Fire a pointerdown at canvas coordinates. */
export function tapCanvas(canvas, x, y) {
  canvas.dispatchEvent({
    type: 'pointerdown',
    clientX: x,
    clientY: y,
    target: canvas,
    preventDefault() { },
    stopPropagation() { },
  });
}
