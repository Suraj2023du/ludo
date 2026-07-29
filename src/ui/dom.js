/**
 * ui/dom.js — a tiny declarative view helper. ~2 KB, zero dependencies.
 *
 * This is the deliberate answer to "should we use React or HTMX here?".
 *  • HTMX is server-driven; this app is a static, fully offline PWA with no
 *    server, so its core idea (swapping server-rendered HTML) cannot work.
 *  • React costs ~45 KB gzipped plus a build step, and helps with DOM diffing —
 *    but 95% of this game is painted on a canvas, where React does nothing.
 * So instead of a framework we take the three things people actually want from
 * one — components, declarative markup and keyed lists — in a file small enough
 * to read in one sitting.
 *
 * DOM ONLY. No game logic, no state ownership.
 *
 *   h('div.task-row', { dataset: { task: id }, onclick: fn }, 'label', child)
 *   mount(parent, ...children)          replace a container's contents
 *   list(parent, items, keyOf, render)  keyed reconcile: nodes are reused
 */

const TAG_RE = /^([a-z][\w-]*)?(#[\w-]+)?((?:\.[\w-]+)*)$/i;

/** Turn 'button.chip.is-on#go' into { tag, id, classes }. */
function parseTag(spec) {
  const m = TAG_RE.exec(String(spec || 'div'));
  if (!m) return { tag: 'div', id: null, classes: [] };
  return {
    tag: (m[1] || 'div').toLowerCase(),
    id: m[2] ? m[2].slice(1) : null,
    classes: m[3] ? m[3].split('.').filter(Boolean) : [],
  };
}

/** class: 'a b' | ['a', false, 'b'] | { a: true, b: cond } */
function applyClass(el, value, extra) {
  const out = [...extra];
  const walk = (v) => {
    if (!v) return;
    if (typeof v === 'string') out.push(...v.split(/\s+/).filter(Boolean));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object') {
      for (const key of Object.keys(v)) if (v[key]) out.push(key);
    }
  };
  walk(value);
  if (out.length) el.setAttribute('class', out.join(' '));
}

function camelToDash(s) {
  return s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}

/** Append anything sensible: nodes, strings, numbers, arrays; skip null/false. */
export function append(parent, child) {
  if (child === null || child === undefined || child === false || child === true) return;
  if (Array.isArray(child)) {
    for (const c of child) append(parent, c);
    return;
  }
  if (typeof child === 'object' && child.nodeType) {
    parent.appendChild(child);
    return;
  }
  parent.appendChild(document.createTextNode(String(child)));
}

/**
 * Create an element.
 * @param {string} spec 'tag', 'tag.class', 'tag#id.class'
 * @param {object} [props] see below
 * @param {...any} children nodes, strings, numbers, arrays, null (skipped)
 *
 * props:
 *   class      string | array | object
 *   text       textContent (escaped by definition)
 *   html       innerHTML — only for trusted, code-authored markup (icons)
 *   dataset    { key: value } -> data-key
 *   style      { color: 'red', '--c': '#fff' }
 *   aria       { pressed: true } -> aria-pressed
 *   attrs      { any: 'attribute' }
 *   on         { click: fn }  (or onclick / oninput / onkeydown ...)
 *   anything else that exists on the element is set as a property
 *   (value, disabled, hidden, checked, type, maxLength, placeholder, ...)
 */
export function h(spec, props, ...children) {
  const { tag, id, classes } = parseTag(spec);
  const el = document.createElement(tag);
  if (id) el.setAttribute('id', id);

  const p = props && typeof props === 'object' && !props.nodeType && !Array.isArray(props) ? props : null;
  if (!p && props !== undefined && props !== null) children.unshift(props);

  if (p) {
    if (p.class !== undefined) applyClass(el, p.class, classes);
    else if (classes.length) el.setAttribute('class', classes.join(' '));

    for (const key of Object.keys(p)) {
      const value = p[key];
      if (value === undefined || value === null) continue;
      if (key === 'class') continue;
      else if (key === 'text') el.textContent = String(value);
      else if (key === 'html') el.innerHTML = value;
      else if (key === 'dataset') {
        for (const k of Object.keys(value)) el.setAttribute('data-' + camelToDash(k), String(value[k]));
      } else if (key === 'style') {
        for (const k of Object.keys(value)) el.style.setProperty(k.startsWith('--') ? k : camelToDash(k), String(value[k]));
      } else if (key === 'aria') {
        for (const k of Object.keys(value)) el.setAttribute('aria-' + camelToDash(k), String(value[k]));
      } else if (key === 'attrs') {
        for (const k of Object.keys(value)) el.setAttribute(k, String(value[k]));
      } else if (key === 'on') {
        for (const k of Object.keys(value)) el.addEventListener(k, value[k]);
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2), value);
      } else {
        el[key] = value;
      }
    }
  } else if (classes.length) {
    el.setAttribute('class', classes.join(' '));
  }

  for (const child of children) append(el, child);
  return el;
}

/** Replace a container's contents in one go. */
export function mount(parent, ...children) {
  parent.textContent = '';
  for (const child of children) append(parent, child);
  return parent;
}

/**
 * Keyed list reconciliation: existing nodes for the same key are reused and
 * moved into place instead of being rebuilt, so scroll position, focus and any
 * running CSS animation survive a re-render.
 *
 * @param {Element} parent
 * @param {Array} items
 * @param {(item, i) => string} keyOf     stable key per item
 * @param {(item, i, node) => Element} render  gets the reused node, if any
 * @returns {Element[]} the nodes now in the list, in order
 */
export function list(parent, items, keyOf, render) {
  const existing = new Map();
  for (const node of [...parent.children]) {
    const key = node.getAttribute('data-key');
    if (key !== null) existing.set(key, node);
  }

  const seen = new Set();
  const out = [];
  items.forEach((item, i) => {
    const key = String(keyOf(item, i));
    const reuse = existing.get(key) || null;
    const node = render(item, i, reuse) || reuse;
    if (!node) return;
    node.setAttribute('data-key', key);
    seen.add(key);
    // appendChild moves an existing node, which is exactly the reorder we want
    parent.appendChild(node);
    out.push(node);
  });

  for (const [key, node] of existing) {
    if (!seen.has(key)) node.remove();
  }
  return out;
}

/**
 * Component sugar: a function that returns an element, with its props typed by
 * usage rather than by a compiler. Exists so screens read declaratively:
 *
 *   const Chip = component(({ label, on, onPick }) =>
 *     h('button.chip', { aria: { pressed: on }, onclick: onPick }, label));
 */
export function component(fn) {
  return (props, ...children) => fn(props || {}, ...children);
}

/** Show/hide without touching layout classes. */
export function toggle(el, visible) {
  el.hidden = !visible;
  return el;
}
