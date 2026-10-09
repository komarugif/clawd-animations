// Extracts the mascot's animations from the page ayotomcs.me/claude-mascot
// into scene files:
//
//	node extract/extract.mjs https://ayotomcs.me/claude-mascot animations
//	node extract/extract.mjs saved-chunk.js animations
//
// Given the page, it downloads the page's scripts into extract/cache and
// takes the one that holds the mascot's modules (their names change with
// every deployment of the site; the modules' numbers have not so far).
//
// The bundle's modules are run with stand-ins for React and GSAP: the JSX
// builds a tree of nodes, the effects run once, and the timelines record
// what they would animate. Each scene file then holds the shapes and a list
// of events whose start values are resolved, so a player only interpolates.
import fs from "node:fs";
import path from "node:path";

const [source, outDir] = process.argv.slice(2);
if (!source || !outDir) {
  console.error("usage: node extract/extract.mjs <page URL | chunk.js> <out-dir>");
  process.exit(2);
}
// The modules, by their numbers, in the order the scenes are listed.
const MODULES = [
  ["630665", { name: "walk", stage: 4 }],
  ["282808", { name: "gym" }],
  ["4030", { name: "flag" }],
  ["926067", { name: "juggle" }],
];
const chunkPath = /^https?:/.test(source) ? await download(source) : source;

// download fetches the page's scripts and returns the one with the modules.
async function download(page) {
  const cache = path.join(path.dirname(new URL(import.meta.url).pathname), "cache");
  fs.mkdirSync(cache, { recursive: true });
  const html = await (await fetch(page)).text();
  const scripts = [...new Set(html.match(/\/_next\/static\/[^"']+\.js/g) || [])];
  for (const s of scripts) {
    const file = path.join(cache, path.basename(s));
    if (!fs.existsSync(file)) fs.writeFileSync(file, await (await fetch(new URL(s, page))).text());
    const text = fs.readFileSync(file, "utf8");
    if (MODULES.every(([id]) => new RegExp("[,\\[]" + id + ",\\w+=>\\{").test(text))) return file;
  }
  throw new Error("no script of the page holds the mascot's modules " + MODULES.map(([id]) => id).join(", "));
}

// --- the bundle's module system --------------------------------------------
const factories = {};
globalThis.TURBOPACK = {
  push(entry) {
    for (let i = 1; i < entry.length; i += 2) factories[entry[i]] = entry[i + 1];
  },
};
globalThis.document = undefined;
new Function(fs.readFileSync(chunkPath, "utf8"))();

// --- React: JSX builds a tree, refs are objects or callbacks ---------------
const Fragment = Symbol("Fragment");
const effects = [];
function el(type, props) {
  return { type, props: props || {} };
}
const react = {
  useRef: (v) => ({ current: v }),
  useEffect: (fn) => effects.push(fn),
  Fragment,
};
const jsxRuntime = { jsx: el, jsxs: el, Fragment };

// --- the tree of nodes ------------------------------------------------------
let nodes = [];
// parseTransform reads an SVG transform list into its matrix
// [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f.
function parseTransform(s) {
  let m = [1, 0, 0, 1, 0, 0];
  const mul = (p, q) => [
    p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1],
    p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3],
    p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5],
  ];
  for (const [, op, args] of (s || "").matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const v = args.trim().split(/[\s,]+/).map(Number);
    let t;
    switch (op) {
      case "matrix": t = v; break;
      case "translate": t = [1, 0, 0, 1, v[0], v[1] || 0]; break;
      case "scale": t = [v[0], 0, 0, v[1] ?? v[0], 0, 0]; break;
      case "rotate": {
        const a = (v[0] * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
        const [cx, cy] = [v[1] || 0, v[2] || 0];
        t = mul(mul([1, 0, 0, 1, cx, cy], [cos, sin, -sin, cos, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
        break;
      }
      default: throw new Error("unknown transform " + op);
    }
    m = mul(m, t);
  }
  return m.map((x) => Math.round(x * 1e6) / 1e6 + 0);
}
const identity = (m) => m.every((x, i) => x === [1, 0, 0, 1, 0, 0][i]);
const clipPaths = {};
// mount turns an element into nodes and gives refs their node.
function mount(e, parent, out) {
  if (e === null || e === undefined || e === false) return;
  if (Array.isArray(e)) { e.forEach((c) => mount(c, parent, out)); return; }
  if (typeof e.type === "function") { mount(e.type(e.props), parent, out); return; }
  if (e.type === Fragment) { mount(e.props.children, parent, out); return; }
  const p = e.props;
  if (e.type === "defs") { mount(p.children, parent, []); return; }
  if (e.type === "clipPath") {
    const rect = [p.children].flat().find((c) => c && c.type === "rect");
    if (rect) clipPaths[p.id] = { x: +(rect.props.x || 0), y: +(rect.props.y || 0), w: +rect.props.width, h: +rect.props.height };
    return;
  }
  const node = { id: nodes.length, parent, kind: e.type === "rect" ? "rect" : "group" };
  if (p.id) node.name = p.id;
  const hidden = p.display === "none" || (p.style && p.style.display === "none");
  if (hidden) node.hidden = true;
  const matrix = parseTransform(p.transform);
  if (!identity(matrix)) node.matrix = matrix;
  if (e.type === "rect") {
    Object.assign(node, { x: +(p.x || 0), y: +(p.y || 0), w: +p.width, h: +p.height, fill: p.fill });
    if (p.opacity !== undefined) node.opacity = +p.opacity;
  } else if (e.type === "svg") {
    node.kind = "svg";
    node.viewBox = p.viewBox.split(/\s+/).map(Number);
  } else {
    const clip = /url\(#(.+)\)/.exec(p.clipPath || "");
    if (clip && clipPaths[clip[1]]) node.clip = clipPaths[clip[1]];
  }
  nodes.push(node);
  const dom = { node: node.id };
  if (p.ref) {
    if (typeof p.ref === "function") p.ref(dom);
    else p.ref.current = dom;
  }
  out.push(dom);
  mount(p.children, node.id, out);
}

// --- GSAP: timelines record events at absolute times -----------------------
// A recorded event: target node, start, duration, ease, the properties it
// sets or tweens.
function makeTimeline(opts = {}) {
  const tl = {
    opts, events: [], labels: {}, end: 0, lastStart: 0, children: [],
    duration() { return this.end; },
  };
  function position(pos, dflt) {
    if (pos === undefined || pos === null) return dflt;
    if (typeof pos === "number") return pos;
    if (pos === "<") return tl.lastStart;
    if (pos === ">") return tl.end;
    let m = /^([a-zA-Z]\w*)?(?:([+-])=([\d.]+))?$/.exec(pos);
    if (m) {
      let base = m[1] !== undefined ? tl.labels[m[1]] : tl.end;
      if (base === undefined) throw new Error("unknown label " + pos);
      if (m[2]) base += (m[2] === "+" ? 1 : -1) * +m[3];
      return base;
    }
    m = /^<([+-])=([\d.]+)$/.exec(pos);
    if (m) return tl.lastStart + (m[1] === "+" ? 1 : -1) * +m[2];
    throw new Error("unknown position " + pos);
  }
  function targetsOf(t) {
    return (Array.isArray(t) ? t : [t]).filter((x) => x && x.node !== undefined);
  }
  function record(kind, targets, vars, pos) {
    const list = targetsOf(targets);
    const delay = vars.delay || 0;
    const start = position(pos, tl.end) + delay;
    const duration = kind === "set" ? 0 : vars.duration ?? 0.5;
    list.forEach((t, i) => {
      const props = {};
      for (const [k, v] of Object.entries(vars)) {
        if (["duration", "delay", "ease"].includes(k)) continue;
        props[k] = typeof v === "function" ? v(i, t, list) : v;
      }
      tl.events.push({ node: t.node, start, duration, ease: kind === "set" ? "none" : vars.ease || "power1.out", props });
    });
    tl.lastStart = start;
    tl.end = Math.max(tl.end, start + duration);
    return tl;
  }
  tl.to = (t, v, p) => record("to", t, v, p);
  tl.set = (t, v, p) => { record("set", t, v, p); return tl; };
  tl.addLabel = (name, p) => { tl.labels[name] = position(p, tl.end); return tl; };
  tl.call = (fn, args, p) => {
    const start = position(p, tl.end);
    // What the callback sets happens at its time.
    const saved = gsap.set;
    gsap.set = (t, v) => record("set", t, v, start);
    fn(...(args || []));
    gsap.set = saved;
    tl.lastStart = start;
    tl.end = Math.max(tl.end, start);
    return tl;
  };
  tl.add = (child, p) => {
    const start = position(p, tl.end);
    tl.children.push({ child, start });
    tl.end = Math.max(tl.end, start + (child.opts.repeat === -1 ? 0 : child.end));
    tl.lastStart = start;
    return tl;
  };
  tl.kill = () => {};
  timelines.push(tl);
  return tl;
}
let timelines = [];
const presets = []; // gsap.set outside timelines: the start state
const gsap = {
  timeline: (o) => makeTimeline(o),
  set: (t, v) => {
    for (const x of (Array.isArray(t) ? t : [t])) if (x && x.node !== undefined) presets.push({ node: x.node, props: v });
  },
};

// --- run each module --------------------------------------------------------
fs.mkdirSync(outDir, { recursive: true });
const index = [];
for (const [id, info] of MODULES) {
  let exports = {};
  factories[id]({
    i: (dep) => ({ "843476": jsxRuntime, "271645": react, "989970": { default: gsap } })[dep],
    s: (list) => { for (let i = 0; i < list.length; i += 2) { if (typeof list[i + 1] === "function") exports[list[i]] = list[i + 1](); else { exports[list[i]] = list[i + 2]; i++; } } },
  });
  nodes = []; timelines = []; presets.length = 0; effects.length = 0;
  const doms = [];
  mount(el(exports.default, {}), -1, doms);
  // The walk measures its box and its parent's: a stage `stage` times as
  // wide as the mascot.
  const svgDom = doms.find((d) => nodes[d.node].kind === "svg");
  const svgNode = nodes[svgDom.node];
  const width = svgNode.viewBox[2];
  svgDom.getBoundingClientRect = () => ({ width });
  svgDom.parentElement = { getBoundingClientRect: () => ({ width: width * (info.stage || 1) }) };
  // Refs point at the stand-ins mount made; the svg's ref needs the measuring one.
  for (const fn of effects) fn();
  const scene = flatten(info, svgNode);
  fs.writeFileSync(path.join(outDir, info.name + ".json"), JSON.stringify(scene) + "\n");
  index.push({ name: info.name, file: info.name + ".json" });
  console.log(info.name, scene.nodes.length, "nodes;", scene.tracks.map((t) => `${t.events.length} events over ${t.duration}s` + (t.delay ? ` after ${t.delay}s` : "") + (t.loopFrom !== undefined ? `, looping from ${t.loopFrom}s` : "")).join("; "));
}
fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify({ version: 2, animations: index }, null, 1) + "\n");

// flatten makes the scene: the nodes, then a track for each timeline that
// runs on its own (the juggle runs three side by side), its events with
// resolved start values. A repeating timeline added into another one (the
// flag's) loops from where it was added.
function flatten(info, svgNode) {
  const added = new Set(timelines.flatMap((t) => t.children.map((c) => c.child)));
  const tops = timelines.filter((t) => !added.has(t));
  const shift = (id) => (id > svgNode.id ? id - 1 : id);
  const tracks = tops.map((tl, n) => {
    const events = [];
    let loopFrom, end = tl.end;
    (function collect(tl, offset) {
      tl.events.forEach((e) => events.push({ ...e, start: e.start + offset }));
      tl.children.forEach(({ child, start }) => {
        if (child.opts.repeat === -1) loopFrom = offset + start;
        end = Math.max(end, offset + start + child.end);
        collect(child, offset + start);
      });
    })(tl, 0);
    // The settings made before the timelines start the first track.
    const first = n === 0 ? presets.map((p) => ({ node: p.node, start: 0, duration: 0, ease: "none", props: p.props })) : [];
    const track = { delay: tl.opts.delay || 0, duration: r(end), repeat: tl.opts.repeat === -1 || loopFrom !== undefined };
    if (loopFrom !== undefined) track.loopFrom = r(loopFrom);
    track.events = resolve(first.concat(events));
    track.events.forEach((e) => (e.node = shift(e.node)));
    return track;
  });
  const scene = {
    version: 2,
    name: info.name,
    viewBox: svgNode.viewBox,
    stage: info.stage || 1,
    nodes: nodes.filter((n) => n.kind !== "svg").map((n) => ({ ...n, id: shift(n.id), parent: n.parent === svgNode.id ? -1 : shift(n.parent) })),
    tracks,
  };
  scene.duration = r(Math.max(...tracks.map((t) => t.delay + t.duration)));
  return scene;
}

// resolve gives every tween the value its property had where it starts, in
// the order the events start, as GSAP takes the current value.
function resolve(events) {
  events.sort((a, b) => a.start - b.start); // stable: the order they were made
  const out = [];
  const current = {}; // node:prop -> value at the end of the last event
  const base = (node, prop) => ({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })[prop];
  for (const e of events) {
    for (let [prop, to] of Object.entries(e.props)) {
      if (prop === "attr") {
        for (const [ap, av] of Object.entries(to)) {
          const p = ap === "transform" ? "transform" : "attr." + ap;
          const v = ap === "transform" ? parseTransform(av) : +av;
          out.push({ node: e.node, prop: p, start: r(e.start), duration: r(e.duration), ease: e.ease, to: v });
        }
        continue;
      }
      if (prop === "svgOrigin") {
        out.push({ node: e.node, prop: "origin", start: r(e.start), duration: 0, ease: "none", to: to.split(/\s+/).map(Number) });
        continue;
      }
      if (prop === "display") {
        out.push({ node: e.node, prop: "display", start: r(e.start), duration: 0, ease: "none", to: to !== "none" });
        continue;
      }
      const key = e.node + ":" + prop;
      let from = key in current ? current[key] : base(e.node, prop);
      if (typeof to === "string" && /^[+-]=/.test(to)) to = from + (to[0] === "+" ? 1 : -1) * +to.slice(2);
      current[key] = +to;
      out.push({ node: e.node, prop, start: r(e.start), duration: r(e.duration), ease: e.ease, from: r(from), to: r(+to) });
    }
  }
  return out;
}
function r(v) { return Math.round(v * 10000) / 10000; }
