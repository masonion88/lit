// Route finding (Dijkstra), route stats, turn-by-turn directions, and the lighting strip.
import * as turf from '@turf/turf';
import { CONFIG, LIT, DARK_OR_UNKNOWN, PATH_WORDS } from './config.js';
import { isOpen } from './time.js';

class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(id, cost) {
    const a = this.items;
    a.push({ id, cost });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].cost <= a[i].cost) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].cost < a[m].cost) m = l;
        if (r < a.length && a[r].cost < a[m].cost) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

// Returns the list of steps [{ edge index, forward }] from start to end, or null.
export function dijkstra(g, startId, endId, costOf) {
  const best = new Map([[startId, 0]]);
  const prev = new Map();
  const heap = new MinHeap();
  heap.push(startId, 0);
  while (heap.size) {
    const { id, cost } = heap.pop();
    if (id === endId) break;
    if (cost > best.get(id)) continue; // stale heap entry
    for (const { to, edge } of g.adj.get(id) ?? []) {
      const next = cost + costOf(edge);
      if (next < (best.get(to) ?? Infinity)) {
        best.set(to, next);
        prev.set(to, { from: id, edge });
        heap.push(to, next);
      }
    }
  }
  if (!best.has(endId)) return null;
  const steps = [];
  for (let id = endId; id !== startId; ) {
    const { from, edge } = prev.get(id);
    steps.push({ edge, forward: g.edges[edge].from === from });
    id = from;
  }
  return steps.reverse();
}

export const walkSeconds = (g, i) => g.edges[i].length_m / CONFIG.walkSpeedMps;

// ctx: { night, openNear (per edge), useBlueLights }
export function litCost(g, i, ctx) {
  let t = walkSeconds(g, i);
  if (!ctx.night) return t;
  const e = g.edges[i];
  const m = CONFIG.night;
  t *= m.lighting[e.lighting] ?? 1;
  if (e.isolated) t *= m.isolated;
  if (ctx.useBlueLights && e.dist_to_bluelight_m != null && e.dist_to_bluelight_m > CONFIG.blueLightFarM) t *= m.farFromBlueLight;
  if (ctx.openNear[i]) t *= m.nearOpenBuilding;
  return t;
}

const stepCoords = (g, { edge, forward }) => (forward ? g.edges[edge].coords : [...g.edges[edge].coords].reverse());

export function routeCoords(g, steps) {
  const out = [];
  for (const s of steps) {
    const c = stepCoords(g, s);
    out.push(...(out.length ? c.slice(1) : c));
  }
  return out;
}

export const sameRoute = (a, b) => a.length === b.length && a.every((s, i) => s.edge === b[i].edge);

export function exposure(g, steps, date) {
  let length = 0;
  let lit = 0;
  let litConfirmed = 0;
  let stretch = 0;
  let stretchFrom = 0;
  let longestStretch = 0;
  let longestSteps = [];
  let maxBlue = 0;
  let blueMissing = false;
  const open = new Set();
  steps.forEach(({ edge }, i) => {
    const e = g.edges[edge];
    length += e.length_m;
    if (LIT.has(e.lighting)) {
      lit += e.length_m;
      if (e.lighting_source === 'verified' || e.lighting_source === 'osm') litConfirmed += e.length_m;
    }
    if (DARK_OR_UNKNOWN.has(e.lighting)) {
      if (stretch === 0) stretchFrom = i;
      stretch += e.length_m;
      if (stretch > longestStretch) {
        longestStretch = stretch;
        longestSteps = steps.slice(stretchFrom, i + 1);
      }
    } else {
      stretch = 0;
    }
    if (e.dist_to_bluelight_m == null) blueMissing = true;
    else maxBlue = Math.max(maxBlue, e.dist_to_bluelight_m);
    for (const b of g.edgeBuildings[edge]) if (isOpen(b, date)) open.add(b.name);
  });
  return {
    length,
    minutes: length / CONFIG.walkSpeedMps / 60,
    litPct: length ? (lit / length) * 100 : 0,
    litConfirmedPct: length ? (litConfirmed / length) * 100 : 0,
    longestStretch,
    longestSteps,
    maxBlue: blueMissing ? null : maxBlue,
    open: [...open],
  };
}

// The lighting strip under each route card: consecutive edges with the same kind of
// lighting merged into one block, as a share of the route's length.
export function lightingStrip(g, steps) {
  const total = steps.reduce((s, { edge }) => s + g.edges[edge].length_m, 0) || 1;
  const blocks = [];
  for (const { edge } of steps) {
    const e = g.edges[edge];
    const last = blocks[blocks.length - 1];
    if (last && last.lighting === e.lighting) last.m += e.length_m;
    else blocks.push({ lighting: e.lighting, m: e.length_m });
  }
  return blocks.map((b) => ({ lighting: b.lighting, pct: (b.m / total) * 100 }));
}

// ---------- Turn-by-turn directions ----------

const labelOf = (e) => e.name ?? `the ${PATH_WORDS[e.highway] ?? 'path'}`;

function turnBetween(prevCoords, nextCoords) {
  const n = prevCoords.length;
  const a = turf.bearing(prevCoords[Math.max(0, n - 2)], prevCoords[n - 1]);
  const b = turf.bearing(nextCoords[0], nextCoords[1]);
  const d = ((b - a + 540) % 360) - 180; // -180..180, positive = clockwise = right
  const ad = Math.abs(d);
  if (ad < 25) return 'straight';
  if (ad > 155) return 'uturn';
  if (ad < 60) return d > 0 ? 'slight-right' : 'slight-left';
  return d > 0 ? 'right' : 'left';
}

const TURN_WORDS = {
  straight: 'Continue onto',
  'slight-left': 'Bear left onto',
  'slight-right': 'Bear right onto',
  left: 'Turn left onto',
  right: 'Turn right onto',
  uturn: 'Turn around onto',
};

// Groups the route by street or path name, folds tiny bits (< 25 m) into their neighbor,
// and works out the turn at the start of each group.
export function directions(g, steps, destinationName) {
  const groups = [];
  const push = (label, e, coords) => {
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.length += e.length_m;
      last.coords.push(...coords.slice(1));
      last.edges.push(e);
    } else {
      groups.push({ label, length: e.length_m, coords: [...coords], edges: [e] });
    }
  };
  for (const s of steps) push(labelOf(g.edges[s.edge]), g.edges[s.edge], stepCoords(g, s));

  const merged = [];
  for (const gr of groups) {
    const prev = merged[merged.length - 1];
    if (prev && (gr.length < 25 || prev.label === gr.label)) {
      prev.length += gr.length;
      prev.coords.push(...gr.coords.slice(1));
      prev.edges.push(...gr.edges);
    } else {
      merged.push(gr);
    }
  }

  // A short unnamed bit between two stretches of the same street (usually its sidewalk)
  // reads better as one "Continue on" step.
  for (let i = 1; i < merged.length - 1; i++) {
    const [prev, mid, next] = [merged[i - 1], merged[i], merged[i + 1]];
    if (prev.label === next.label && mid.label.startsWith('the ') && mid.length < 120) {
      prev.length += mid.length + next.length;
      prev.coords.push(...mid.coords.slice(1), ...next.coords.slice(1));
      prev.edges.push(...mid.edges, ...next.edges);
      merged.splice(i, 2);
      i--;
    }
  }

  const out = merged.map((gr, i) => {
    const turn = i === 0 ? 'start' : turnBetween(merged[i - 1].coords, gr.coords);
    const litM = gr.edges.filter((e) => LIT.has(e.lighting)).reduce((s, e) => s + e.length_m, 0);
    const litPct = gr.length ? (litM / gr.length) * 100 : 0;
    return {
      turn,
      text: i === 0 ? `Head out on ${gr.label}` : `${TURN_WORDS[turn]} ${gr.label}`,
      length: gr.length,
      litPct,
      mood: litPct >= 80 ? 'lit' : litPct >= 40 ? 'partly' : 'dark',
      coords: gr.coords,
    };
  });
  const lastCoords = out.length ? out[out.length - 1].coords : [];
  out.push({ turn: 'arrive', text: `Arrive at ${destinationName}`, length: 0, mood: null, coords: lastCoords.slice(-1) });
  return out;
}
