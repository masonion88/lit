// Loads the files written by scripts/build-graph.mjs and builds what routing needs.
import * as turf from '@turf/turf';
import { CONFIG } from './config.js';

export async function loadGraph() {
  const getJson = (url, fallback) => fetch(url).then((r) => (r.ok ? r.json() : fallback)).catch(() => fallback);
  const [graph, buildings, places] = await Promise.all([
    fetch('/graph.json').then((r) => r.json()),
    getJson('/buildings.json', []),
    getJson('/places.json', []),
  ]);
  const { nodes, edges } = graph;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // Neighbor list: node id -> [{ to, edge index }]. Paths are walkable both ways.
  const adj = new Map();
  edges.forEach((e, i) => {
    for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) {
      if (!adj.has(a)) adj.set(a, []);
      adj.get(a).push({ to: b, edge: i });
    }
  });

  // Which buildings sit next to each edge. The build script already worked this out.
  const edgeBuildings = edges.map((e) => (e.near_buildings ?? []).map((i) => buildings[i]).filter(Boolean));

  // Remember the build script's lighting, so checks made in the app can be undone.
  for (const e of edges) e.original = { lighting: e.lighting, lighting_source: e.lighting_source };

  const snapNodes = largestComponent(nodes, adj, nodeById);
  return {
    ...graph,
    nodes,
    edges,
    nodeById,
    adj,
    edgeBuildings,
    buildings,
    // graph.json's own "places" is the default route (start, end); the search list replaces it.
    defaultRoute: graph.places,
    places,
    snapNodes,
    blueLights: graph.bluelights ?? [],
  };
}

// Only snap to nodes in the biggest connected piece, so every point is reachable.
function largestComponent(nodes, adj, nodeById) {
  const seen = new Set();
  let best = [];
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    const group = [];
    const stack = [n.id];
    seen.add(n.id);
    while (stack.length) {
      const id = stack.pop();
      group.push(id);
      for (const { to } of adj.get(id) ?? []) if (!seen.has(to)) { seen.add(to); stack.push(to); }
    }
    if (group.length > best.length) best = group;
  }
  return best.map((id) => nodeById.get(id));
}

export function nearestNode(g, { lat, lng }) {
  const k = Math.cos((lat * Math.PI) / 180);
  let best = null;
  let bestD = Infinity;
  for (const n of g.snapNodes) {
    const d = (n.lat - lat) ** 2 + ((n.lng - lng) * k) ** 2;
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

// Is a point inside the area the graph covers?
export function insideArea(g, { lat, lng }) {
  const b = g.bbox;
  return lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
}

// Applies the night checks saved on this device on top of the build script's lighting,
// the same way the build script uses data/verified_lighting.csv.
export function applyChecks(g, checks) {
  for (const e of g.edges) {
    e.lighting = e.original.lighting;
    e.lighting_source = e.original.lighting_source;
    e.mine = false;
  }
  for (const c of checks) {
    const pt = turf.point([c.lng, c.lat]);
    for (const e of g.edges) {
      const [x, y] = e.coords[0];
      if (Math.abs(x - c.lng) > 0.01 || Math.abs(y - c.lat) > 0.01) continue; // quick skip, ~1 km
      if (turf.pointToLineDistance(pt, turf.lineString(e.coords), { units: 'meters' }) <= CONFIG.checkRadiusM) {
        e.lighting = c.status;
        e.lighting_source = 'verified';
        e.mine = true;
      }
    }
  }
}
