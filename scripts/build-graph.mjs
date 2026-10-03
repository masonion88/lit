// Builds public/graph.json: a walking graph covering Collegetown, central campus, and
// Robert Purcell (North Campus), with a lighting value (and its source) on every edge.
// Run with: node scripts/build-graph.mjs

import fs from 'node:fs';
import path from 'node:path';
import * as turf from '@turf/turf';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const USER_AGENT = 'Lit/0.1 (hackathon project: campus walking-route lighting map)';

// Demo route: Collegetown -> North Campus.
const START = 'Collegetown, Ithaca, NY';
const END = 'Robert Purcell Community Center, Cornell University';
// Not a route endpoint: only stretches the bounding box over central campus.
const CENTRAL_CAMPUS = 'Olin Library, Cornell University';

// Rough outline of Collegetown. A geocode outside it is treated as wrong.
const COLLEGETOWN_BOUNDS = { south: 42.4355, north: 42.4455, west: -76.492, east: -76.479 };
const MARGIN_M = 300;
const WALKABLE = [
  'footway', 'path', 'pedestrian', 'steps', 'service', 'residential', 'living_street',
  'unclassified', 'tertiary', 'secondary', 'primary', 'track', 'cycleway',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

// ---------- 1. Geocode (Nominatim, cached, max 1 request/second) ----------

// Looks up one place. Answers (including "nothing found", saved as null) are cached.
let lastNominatim = 0;
async function nominatim(q) {
  const file = path.join(RAW, 'places.json');
  const cache = readJson(file) ?? {};
  if (q in cache) return cache[q];
  // Nominatim doesn't match "Cornell University" as a place, so fall back to the city name.
  let hit = null;
  for (const attempt of [...new Set([q, q.replace('Cornell University', 'Ithaca')])]) {
    await sleep(Math.max(0, lastNominatim + 1100 - Date.now()));
    lastNominatim = Date.now();
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(attempt)}`;
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`Nominatim ${res.status} for "${attempt}"`);
    // Skip roads and bus stops that share the place's name.
    hit = (await res.json()).find((h) => h.class !== 'highway');
    if (hit) break;
  }
  cache[q] = hit ? { lat: Number(hit.lat), lng: Number(hit.lon), display_name: hit.display_name } : null;
  writeJson(file, cache);
  return cache[q];
}

const inside = (p, b) => p && p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east;

// Fallback for Collegetown: the node where College Avenue meets Dryden Road (Overpass, cached).
async function collegeAndDryden() {
  const file = path.join(RAW, 'college-dryden.json');
  const cached = readJson(file);
  if (cached) return cached;
  const b = COLLEGETOWN_BOUNDS;
  const query = `[out:json][timeout:60];
way["highway"]["name"="College Avenue"](${b.south},${b.west},${b.north},${b.east})->.a;
way["highway"]["name"="Dryden Road"](${b.south},${b.west},${b.north},${b.east})->.b;
node(w.a)(w.b);
out;`;
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status} looking up College Ave & Dryden Rd`);
  const node = (await res.json()).elements[0];
  if (!node) throw new Error('Overpass found no College Ave & Dryden Rd intersection');
  const point = { lat: node.lat, lng: node.lon, display_name: 'College Avenue & Dryden Road, Ithaca, NY' };
  writeJson(file, point);
  return point;
}

async function geocode() {
  let start = await nominatim(START);
  if (inside(start, COLLEGETOWN_BOUNDS)) {
    start = { ...start, name: START, how: 'Nominatim' };
  } else {
    console.log(`Nominatim's "${START}" ${start ? `(${start.display_name})` : ''} is not inside Collegetown; using College Ave & Dryden Rd.`);
    start = { ...(await collegeAndDryden()), name: 'Collegetown (College Ave & Dryden Rd)', how: 'Overpass intersection' };
  }
  const end = { ...(await nominatim(END)), name: END, how: 'Nominatim' };
  const campus = { ...(await nominatim(CENTRAL_CAMPUS)), name: CENTRAL_CAMPUS, how: 'Nominatim' };
  if (!end.lat || !campus.lat) throw new Error('Nominatim could not find Robert Purcell or Olin Library');
  console.log('Places:');
  for (const p of [start, end, campus]) {
    console.log(`  ${p.name}: ${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}  [${p.how}] ${p.display_name}`);
  }
  return { start, end, campus };
}

// ---------- 2. Bounding box with margin ----------

function bboxAround(points, marginM) {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const dLat = marginM / 111320;
  const dLng = marginM / (111320 * Math.cos((midLat * Math.PI) / 180));
  return {
    south: Math.min(...lats) - dLat,
    west: Math.min(...lngs) - dLng,
    north: Math.max(...lats) + dLat,
    east: Math.max(...lngs) + dLng,
  };
}

// ---------- 3. Overpass (one query, cached) ----------

async function overpass(bbox) {
  const b = [bbox.south, bbox.west, bbox.north, bbox.east].map((n) => n.toFixed(6)).join(',');
  const query = `[out:json][timeout:120];
(
  way["highway"~"^(${WALKABLE.join('|')})$"](${b});
  node["highway"="street_lamp"](${b});
  way["natural"="wood"](${b});
  way["landuse"="forest"](${b});
  relation["natural"="wood"](${b});
  relation["landuse"="forest"](${b});
);
out body geom;`;

  const file = path.join(RAW, 'overpass.json');
  const cached = readJson(file);
  if (cached && cached.query === query) {
    console.log('Overpass: using cached data/raw/overpass.json');
    return cached.response;
  }
  console.log('Overpass: downloading (this can take a minute)...');
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const response = await res.json();
  writeJson(file, { query, fetched_at: new Date().toISOString(), response });
  return response;
}

// ---------- Woods polygons (ways + multipolygon relations) ----------

const isWoods = (t = {}) => t.natural === 'wood' || t.landuse === 'forest';
const toCoords = (geom) => geom.map((g) => [g.lon, g.lat]);
const sameCoord = (a, b) => a[0] === b[0] && a[1] === b[1];

// Join outer member ways of a relation into closed rings by matching endpoints.
function stitchRings(lines) {
  const rings = [];
  const pool = lines.map((l) => l.slice());
  while (pool.length) {
    let ring = pool.shift();
    let grew = true;
    while (!sameCoord(ring[0], ring[ring.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const l = pool[i];
        const end = ring[ring.length - 1];
        if (sameCoord(end, l[0])) ring = ring.concat(l.slice(1));
        else if (sameCoord(end, l[l.length - 1])) ring = ring.concat(l.slice(0, -1).reverse());
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4 && sameCoord(ring[0], ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}

function woodsPolygons(elements) {
  const polys = [];
  for (const el of elements) {
    if (!isWoods(el.tags)) continue;
    if (el.type === 'way' && el.geometry) {
      const ring = toCoords(el.geometry);
      if (ring.length >= 4 && sameCoord(ring[0], ring[ring.length - 1])) polys.push(turf.polygon([ring]));
    } else if (el.type === 'relation' && el.members) {
      const outers = el.members
        .filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry)
        .map((m) => toCoords(m.geometry));
      for (const ring of stitchRings(outers)) polys.push(turf.polygon([ring]));
    }
  }
  // Keep each polygon's bbox and outline so distance checks can skip far-away woods quickly.
  return polys.map((p) => ({ poly: p, bbox: turf.bbox(p), outline: turf.polygonToLine(p) }));
}

const M_PER_DEG_LAT = 111320;
function nearBbox(pt, bbox, meters) {
  const [lng, lat] = pt;
  const dLat = meters / M_PER_DEG_LAT;
  const dLng = meters / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  return lng >= bbox[0] - dLng && lng <= bbox[2] + dLng && lat >= bbox[1] - dLat && lat <= bbox[3] + dLat;
}

function nearWoods(pt, woods, meters) {
  const p = turf.point(pt);
  for (const w of woods) {
    if (!nearBbox(pt, w.bbox, meters)) continue;
    if (turf.booleanPointInPolygon(p, w.poly)) return true;
    const outlines = w.outline.type === 'FeatureCollection' ? w.outline.features : [w.outline];
    for (const o of outlines) {
      if (turf.pointToLineDistance(p, o, { units: 'meters' }) <= meters) return true;
    }
  }
  return false;
}

// ---------- 4. Graph: split ways at shared nodes ----------

function buildGraph(elements) {
  const ways = elements.filter(
    (el) => el.type === 'way' && WALKABLE.includes(el.tags?.highway) && el.tags?.area !== 'yes' && el.geometry,
  );

  // A node becomes a graph node if it ends a way or is used more than once.
  const uses = new Map();
  for (const w of ways) for (const id of w.nodes) uses.set(id, (uses.get(id) ?? 0) + 1);

  const nodes = new Map();
  const edges = [];
  for (const w of ways) {
    let start = 0;
    for (let i = 1; i < w.nodes.length; i++) {
      const last = i === w.nodes.length - 1;
      if (!last && uses.get(w.nodes[i]) < 2) continue;
      const coords = w.geometry.slice(start, i + 1).map((g) => [round6(g.lon), round6(g.lat)]);
      const from = w.nodes[start];
      const to = w.nodes[i];
      for (const [id, g] of [[from, w.geometry[start]], [to, w.geometry[i]]]) {
        if (!nodes.has(id)) nodes.set(id, { id, lat: round6(g.lat), lng: round6(g.lon) });
      }
      const t = w.tags;
      edges.push({
        from,
        to,
        coords,
        length_m: round1(turf.length(turf.lineString(coords), { units: 'meters' })),
        highway: t.highway,
        footway: t.footway ?? null,
        lit: t.lit ?? null,
        name: t.name ?? null,
        surface: t.surface ?? null,
      });
      start = i;
    }
  }
  return { nodes: [...nodes.values()], edges };
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;
const round1 = (n) => Math.round(n * 10) / 10;

// ---------- CSV helpers ----------

function readCsv(file) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const split = (line) => {
    const out = [];
    let cur = '';
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const header = split(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [header[i], v])));
}

// ---------- 5 & 6. Lighting, isolation, Blue Light distance ----------

const OSM_LIT = {
  yes: 'lit', '24/7': 'lit', automatic: 'lit', 'sunset-sunrise': 'lit', interval: 'lit',
  limited: 'limited', no: 'dark', disused: 'dark',
};

function edgeNear(edge, pt, meters) {
  const xs = edge.coords.map((c) => c[0]);
  const ys = edge.coords.map((c) => c[1]);
  if (!nearBbox(pt, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], meters)) return false;
  return turf.pointToLineDistance(turf.point(pt), turf.lineString(edge.coords), { units: 'meters' }) <= meters;
}

function annotate(edges, elements, woods) {
  const verified = readCsv(path.join(ROOT, 'data', 'verified_lighting.csv'))
    .map((r) => ({ pt: [Number(r.lng), Number(r.lat)], status: r.status }))
    .filter((r) => Number.isFinite(r.pt[0]) && Number.isFinite(r.pt[1]) && r.status);
  const lamps = elements
    .filter((el) => el.type === 'node' && el.tags?.highway === 'street_lamp')
    .map((el) => [el.lon, el.lat]);
  const bluelights = readCsv(path.join(ROOT, 'data', 'bluelights.csv'))
    .map((r) => [Number(r.lng), Number(r.lat)])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));

  for (const e of edges) {
    const line = turf.lineString(e.coords);
    const mid = turf.along(line, e.length_m / 2, { units: 'meters' }).geometry.coordinates;
    e.isolated = nearWoods(mid, woods, 15);

    const v = verified.find((r) => edgeNear(e, r.pt, 20));
    if (v) {
      e.lighting = v.status;
      e.lighting_source = 'verified';
    } else if (e.lit && OSM_LIT[e.lit]) {
      e.lighting = OSM_LIT[e.lit];
      e.lighting_source = 'osm';
    } else if (lamps.some((l) => edgeNear(e, l, 25))) {
      e.lighting = 'likely lit';
      e.lighting_source = 'osm';
    } else if (['path', 'steps', 'track'].includes(e.highway) && e.isolated) {
      e.lighting = 'estimated dark';
      e.lighting_source = 'estimated';
    } else if (['footway', 'service', 'residential'].includes(e.highway)) {
      e.lighting = 'estimated lit';
      e.lighting_source = 'estimated';
    } else {
      e.lighting = 'unknown';
      e.lighting_source = 'unknown';
    }

    e.dist_to_bluelight_m = bluelights.length
      ? Math.round(Math.min(...bluelights.map((b) => turf.pointToLineDistance(turf.point(b), line, { units: 'meters' }))))
      : null;
  }
  return { lamps: lamps.length, verified: verified.length, bluelights: bluelights.length };
}

// ---------- 8. Coverage report ----------

function report(edges) {
  const total = edges.reduce((s, e) => s + e.length_m, 0);
  const table = (key) => {
    const sums = {};
    for (const e of edges) sums[e[key]] = (sums[e[key]] ?? 0) + e.length_m;
    return Object.entries(sums)
      .sort((a, b) => b[1] - a[1])
      .map(([k, m]) => `  ${k.padEnd(16)} ${((m / total) * 100).toFixed(1).padStart(5)}%  (${(m / 1000).toFixed(2)} km)`)
      .join('\n');
  };
  console.log(`\nCoverage report: ${edges.length} edges, ${(total / 1000).toFixed(2)} km total`);
  console.log('By lighting_source:\n' + table('lighting_source'));
  console.log('By lighting:\n' + table('lighting'));
  const iso = edges.filter((e) => e.isolated).reduce((s, e) => s + e.length_m, 0);
  console.log(`Isolated (near woods): ${((iso / total) * 100).toFixed(1)}%`);
}

// ---------- Main ----------

fs.mkdirSync(RAW, { recursive: true });
const { start, end, campus } = await geocode();
const bbox = bboxAround([start, end, campus], MARGIN_M);
console.log(`Bounding box: S ${bbox.south.toFixed(5)} W ${bbox.west.toFixed(5)} N ${bbox.north.toFixed(5)} E ${bbox.east.toFixed(5)}`);
const data = await overpass(bbox);
const woods = woodsPolygons(data.elements);
const { nodes, edges } = buildGraph(data.elements);
const counts = annotate(edges, data.elements, woods);
console.log(`Found ${woods.length} woods polygons, ${counts.lamps} street lamps, ${counts.verified} verified points, ${counts.bluelights} Blue Lights`);

const out = {
  generated_at: new Date().toISOString(),
  // The app's default route: places[0] -> places[1].
  places: [start, end].map(({ name, lat, lng }) => ({ name, lat, lng })),
  bbox,
  nodes,
  edges: edges.map(({ from, to, coords, length_m, highway, footway, lit, name, surface, lighting, lighting_source, isolated, dist_to_bluelight_m }) => ({
    from, to, coords, length_m, highway, footway, lit, name, surface, lighting, lighting_source, isolated, dist_to_bluelight_m,
  })),
};
fs.writeFileSync(path.join(ROOT, 'public', 'graph.json'), JSON.stringify(out));
console.log(`Wrote public/graph.json (${nodes.length} nodes, ${edges.length} edges)`);
report(edges);
