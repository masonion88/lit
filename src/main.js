import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import * as turf from '@turf/turf';
import { getTimes } from 'suncalc';

// Every tunable number lives here.
const CONFIG = {
  mapStyle: 'https://tiles.openfreemap.org/styles/dark',
  walkSpeedMps: 1.35,
  ithaca: { lat: 42.444, lng: -76.5019 },
  // Multipliers on walking time, used by the Lit route only between sunset and sunrise.
  night: {
    lighting: { dark: 1.8, 'estimated dark': 1.6, unknown: 1.3 },
    isolated: 1.5,
    farFromBlueLight: 1.2,
    nearOpenBuilding: 0.9,
  },
  blueLightFarM: 150,
  buildingNearM: 30,
  // Clock slider: minutes after 6 pm (0 = 6 pm, 600 = 4 am).
  clock: { startHour: 18, maxMin: 600, stepMin: 15 },
  // Late-night TCAT window from Cornell's student safety page, as minutes after midnight.
  lateBus: { from: 18 * 60 + 30, until: 2 * 60 + 30 },
};

const LINKS = {
  blueLights: 'https://cupolice.cornell.edu/safety-security/blue-light-services',
  studentSafety: 'https://scl.cornell.edu/families/cornell-family-resource-hub/student-safety-and-support',
};
const SOURCES = ['verified', 'osm', 'mapillary', 'estimated', 'unknown'];

const COLORS = {
  lit: '#ffd60a',
  'likely lit': '#fff3a3',
  limited: '#fff3a3',
  'estimated lit': '#ffd60a',
  dark: '#a78bfa',
  'estimated dark': '#a78bfa',
  unknown: '#8b8f98',
  fastest: '#38bdf8',
  litRoute: '#f472b6',
  open: '#4ade80',
  closed: '#4b5563',
};
const LIT = new Set(['lit', 'likely lit', 'limited', 'estimated lit']);
const DARK_OR_UNKNOWN = new Set(['dark', 'estimated dark', 'unknown']);

// ---------- Page skeleton ----------

document.querySelector('#app').innerHTML = `
  <div id="help" role="note">
    Emergency: <a href="tel:911">911</a> · Cornell Police non-emergency:
    <a href="tel:+16072551111">607-255-1111</a> · Blue Light phones connect directly to Cornell Police.
  </div>
  <main id="main">
  <div id="map"></div>
  <aside id="panel">
    <header>
      <h1>Lit</h1>
      <p class="sub">Walking routes compared by lighting, not by crime.</p>
    </header>

    <div class="row">
      <span class="label">Tap map to set</span>
      <div class="seg">
        <button id="pick-start" class="active"><i class="dot start"></i>Start</button>
        <button id="pick-end"><i class="dot end"></i>End</button>
      </div>
    </div>

    <div class="row">
      <label class="label" for="when">Leaving at</label>
      <div class="when">
        <input id="when" type="datetime-local" />
        <button id="now">Now</button>
      </div>
    </div>
    <div class="clock">
      <div class="row">
        <label class="label" for="clock">Tonight</label>
        <output id="clock-out" for="clock"></output>
      </div>
      <input id="clock" type="range" min="0" max="${CONFIG.clock.maxMin}" step="${CONFIG.clock.stepMin}" />
      <div class="ticks"><span style="left:0%">6 pm</span><span style="left:30%">9 pm</span><span style="left:60%">12 am</span><span style="left:100%">4 am</span></div>
    </div>
    <p id="sun" class="sun"></p>

    <div id="cards"></div>
    <div id="extra-cards"></div>

    <section id="honesty" class="card">
      <h2>Data honesty</h2>
      <p class="fine">Path segments by where their lighting value comes from:</p>
      <dl id="source-counts" class="stats"></dl>
      <p class="no-crime">No crime data, by design.</p>
    </section>

    <details id="legend">
      <summary>Legend &amp; data sources</summary>
      <ul class="keys">
        <li><i class="sw" style="background:${COLORS.lit}"></i>Lit</li>
        <li><i class="sw" style="background:${COLORS['likely lit']}"></i>Likely lit (street lamp mapped nearby, or lit part of the night)</li>
        <li><i class="sw dashed" style="color:${COLORS['estimated lit']}"></i>Estimated lit (guess from path type)</li>
        <li><i class="sw" style="background:${COLORS.dark}"></i>Dark or estimated dark</li>
        <li><i class="sw" style="background:${COLORS.unknown}"></i>Unknown</li>
        <li><i class="sw route" style="background:${COLORS.fastest}"></i>Fastest route</li>
        <li><i class="sw route" style="background:${COLORS.litRoute}"></i>Lit route</li>
        <li><i class="sw route stretch"></i>Lit route's longest dark or unknown stretch</li>
        <li><i class="bdot" style="background:${COLORS.open}"></i>Building open at the chosen time</li>
        <li><i class="bdot" style="background:${COLORS.closed}"></i>Building closed</li>
      </ul>
      <p class="label">Every lighting value has a source:</p>
      <dl class="sources">
        <dt>verified</dt><dd>Checked in person after dark by our team.</dd>
        <dt>osm</dt><dd>OpenStreetMap: a path's <code>lit</code> tag, or a mapped street lamp within 25 m.</dd>
        <dt>mapillary</dt><dd>Seen in Mapillary street-level night photos.</dd>
        <dt>estimated</dt><dd>Our guess from the path type and nearby woods. Treat with care.</dd>
        <dt>unknown</dt><dd>No information at all.</dd>
      </dl>
      <p class="fine">Multipliers apply only between sunset and sunrise. This app shows tradeoffs in the physical environment. It does not use crime data and cannot tell you a route is risk-free.</p>
    </details>
  </aside>
  </main>
`;

// ---------- Data loading ----------

// Both files are written by scripts/build-graph.mjs.
const [graph, buildings] = await Promise.all([
  fetch('/graph.json').then((r) => r.json()),
  fetch('/buildings.json').then((r) => (r.ok ? r.json() : [])).catch(() => []),
]);
const { nodes, edges } = graph;

// Data honesty panel: how many path segments get their lighting from each source.
const sourceCounts = Object.fromEntries(SOURCES.map((s) => [s, 0]));
for (const e of edges) sourceCounts[e.lighting_source] = (sourceCounts[e.lighting_source] ?? 0) + 1;
document.querySelector('#source-counts').innerHTML = Object.entries(sourceCounts)
  .map(([s, n]) => `<dt>${s}</dt><dd>${n.toLocaleString()} <small>(${Math.round((n / edges.length) * 100)}%)</small></dd>`)
  .join('');
const nodeById = new Map(nodes.map((n) => [n.id, n]));

// Neighbor list: node id -> [{ to, edge index }]. Paths are walkable both ways.
const adj = new Map();
edges.forEach((e, i) => {
  for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ to: b, edge: i });
  }
});

// Only snap to nodes in the biggest connected piece, so every tap is reachable.
function largestComponent() {
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
const snapNodes = largestComponent();

// Which buildings sit within CONFIG.buildingNearM of each edge (computed once).
const edgeBuildings = edges.map((e) => {
  if (!buildings.length) return [];
  const line = turf.lineString(e.coords);
  return buildings.filter(
    (b) => turf.pointToLineDistance(turf.point([b.lng, b.lat]), line, { units: 'meters' }) <= CONFIG.buildingNearM,
  );
});

// ---------- Time helpers ----------

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const toMin = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

// Each day holds a list of [open, close] periods. Open if inside one of today's periods,
// or inside one of yesterday's that ran past midnight.
function isOpen(b, date) {
  const now = date.getHours() * 60 + date.getMinutes();
  const today = (b.hours[DAYS[date.getDay()]] ?? []).map((p) => p.map(toMin));
  const yesterday = (b.hours[DAYS[(date.getDay() + 6) % 7]] ?? []).map((p) => p.map(toMin));
  return (
    today.some(([o, c]) => (c > o ? now >= o && now < c : now >= o)) ||
    yesterday.some(([o, c]) => c <= o && now < c)
  );
}

// The night a time belongs to starts at 6 pm; times before 5 am belong to the previous evening.
function eveningOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), CONFIG.clock.startHour);
  if (date.getHours() < 5) d.setDate(d.getDate() - 1);
  return d;
}

function isLateBusTime(date) {
  const m = date.getHours() * 60 + date.getMinutes();
  return m >= CONFIG.lateBus.from || m < CONFIG.lateBus.until;
}

function sunInfo(date) {
  const noon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const t = getTimes(noon, CONFIG.ithaca.lat, CONFIG.ithaca.lng);
  return { sunrise: t.sunrise, sunset: t.sunset, night: date < t.sunrise || date >= t.sunset };
}

const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const toInputValue = (d) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// ---------- Routing: Dijkstra with a binary heap ----------

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
function dijkstra(startId, endId, costOf) {
  const best = new Map([[startId, 0]]);
  const prev = new Map();
  const heap = new MinHeap();
  heap.push(startId, 0);
  while (heap.size) {
    const { id, cost } = heap.pop();
    if (id === endId) break;
    if (cost > best.get(id)) continue; // stale heap entry
    for (const { to, edge } of adj.get(id) ?? []) {
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
    steps.push({ edge, forward: edges[edge].from === from });
    id = from;
  }
  return steps.reverse();
}

const walkSeconds = (i) => edges[i].length_m / CONFIG.walkSpeedMps;

function litCost(i, ctx) {
  let t = walkSeconds(i);
  if (!ctx.night) return t;
  const e = edges[i];
  const m = CONFIG.night;
  t *= m.lighting[e.lighting] ?? 1;
  if (e.isolated) t *= m.isolated;
  if (e.dist_to_bluelight_m != null && e.dist_to_bluelight_m > CONFIG.blueLightFarM) t *= m.farFromBlueLight;
  if (ctx.openNear[i]) t *= m.nearOpenBuilding;
  return t;
}

// ---------- Exposure stats ----------

function routeCoords(steps) {
  const out = [];
  for (const { edge, forward } of steps) {
    const c = forward ? edges[edge].coords : [...edges[edge].coords].reverse();
    out.push(...(out.length ? c.slice(1) : c));
  }
  return out;
}

function exposure(steps, date) {
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
    const e = edges[edge];
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
    for (const b of edgeBuildings[edge]) if (isOpen(b, date)) open.add(b.name);
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

// ---------- Map ----------

// Vite bundles MapLibre's background worker separately, so tell MapLibre where it is.
maplibregl.setWorkerUrl(maplibreWorkerUrl);

const state = { start: null, end: null, picking: 'start' };

const mid = graph.places.reduce((s, p) => [s[0] + p.lng / graph.places.length, s[1] + p.lat / graph.places.length], [0, 0]);
const map = new maplibregl.Map({
  container: 'map',
  style: CONFIG.mapStyle,
  center: mid,
  zoom: 15,
  attributionControl: false,
});
// On phones the bottom sheet covers the bottom corners, so keep map credits at the top.
map.addControl(new maplibregl.AttributionControl({ compact: true }), window.innerWidth < 768 ? 'top-left' : 'bottom-right');
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

const pathsGeojson = {
  type: 'FeatureCollection',
  features: edges.map((e) => ({
    type: 'Feature',
    properties: { lighting: e.lighting },
    geometry: { type: 'LineString', coordinates: e.coords },
  })),
};
const emptyLine = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } };
const colorByLighting = ['match', ['get', 'lighting'], ...Object.entries(COLORS).slice(0, 7).flat(), COLORS.unknown];
const pathWidth = ['interpolate', ['linear'], ['zoom'], 13, 1, 16, 3, 19, 6];

function buildingsGeojson(date) {
  return {
    type: 'FeatureCollection',
    features: buildings.map((b) => ({
      type: 'Feature',
      properties: { name: b.name, open: isOpen(b, date) },
      geometry: { type: 'Point', coordinates: [b.lng, b.lat] },
    })),
  };
}

// "Walk with a friend" card, pinned to the middle of the Lit route's longest dark stretch.
const friendPopup = new maplibregl.Popup({ closeOnClick: false, maxWidth: '270px', className: 'friend', offset: 12 });
let friendDismissed = false;
let friendRemovingInCode = false;
friendPopup.on('close', () => { if (!friendRemovingInCode) friendDismissed = true; });
function hideFriend() {
  friendRemovingInCode = true;
  friendPopup.remove();
  friendRemovingInCode = false;
}

const markers = {
  start: new maplibregl.Marker({ color: '#22c55e' }),
  end: new maplibregl.Marker({ color: '#ef4444' }),
};

map.on('load', () => {
  map.addSource('stretch', { type: 'geojson', data: emptyLine });
  map.addSource('route-fastest', { type: 'geojson', data: emptyLine });
  map.addSource('route-lit', { type: 'geojson', data: emptyLine });
  map.addSource('paths', { type: 'geojson', data: pathsGeojson });
  map.addSource('buildings', { type: 'geojson', data: buildingsGeojson(new Date()) });

  // The Lit route's longest dark-or-unknown stretch: a white glow under everything.
  map.addLayer({
    id: 'stretch',
    type: 'line',
    source: 'stretch',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 20, 'line-opacity': 0.35, 'line-blur': 4 },
  });

  // Routes go underneath as wide glows, offset so both show where they overlap.
  const routeLayer = (id, color, offset) => ({
    id,
    type: 'line',
    source: id,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': 9, 'line-opacity': 0.7, 'line-offset': offset },
  });
  map.addLayer(routeLayer('route-fastest', COLORS.fastest, -4));
  map.addLayer(routeLayer('route-lit', COLORS.litRoute, 4));

  map.addLayer({
    id: 'paths-solid',
    type: 'line',
    source: 'paths',
    filter: ['!=', ['get', 'lighting'], 'estimated lit'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': colorByLighting, 'line-width': pathWidth },
  });
  map.addLayer({
    id: 'paths-dashed',
    type: 'line',
    source: 'paths',
    filter: ['==', ['get', 'lighting'], 'estimated lit'],
    paint: { 'line-color': colorByLighting, 'line-width': pathWidth, 'line-dasharray': [2, 1.5] },
  });

  map.addLayer({
    id: 'buildings',
    type: 'circle',
    source: 'buildings',
    paint: {
      'circle-color': ['case', ['get', 'open'], COLORS.open, COLORS.closed],
      'circle-radius': ['case', ['get', 'open'], 7, 5],
      'circle-stroke-color': '#111318',
      'circle-stroke-width': 2,
    },
  });

  // Default route comes from the build script: Collegetown -> Robert Purcell.
  setPoint('start', graph.places[0]);
  setPoint('end', graph.places[1]);
  update({ fit: true });
});

map.on('click', (ev) => {
  setPoint(state.picking, { lat: ev.lngLat.lat, lng: ev.lngLat.lng });
  setPicking(state.picking === 'start' ? 'end' : 'start');
  friendDismissed = false;
  update();
});

function nearestNode({ lat, lng }) {
  const k = Math.cos((lat * Math.PI) / 180);
  let best = null;
  let bestD = Infinity;
  for (const n of snapNodes) {
    const d = (n.lat - lat) ** 2 + ((n.lng - lng) * k) ** 2;
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

function setPoint(which, pt) {
  const n = nearestNode(pt);
  state[which] = n;
  markers[which].setLngLat([n.lng, n.lat]).addTo(map);
}

// ---------- Controls ----------

const $ = (s) => document.querySelector(s);
const whenInput = $('#when');
whenInput.value = toInputValue(new Date());
whenInput.addEventListener('change', () => update());
$('#now').addEventListener('click', () => { whenInput.value = toInputValue(new Date()); update(); });

const currentDate = () => (whenInput.value ? new Date(whenInput.value) : new Date());

// Dragging the clock re-routes live ('input' fires on every step, not just on release).
const clock = $('#clock');
clock.addEventListener('input', () => {
  const evening = eveningOf(currentDate());
  whenInput.value = toInputValue(new Date(evening.getTime() + Number(clock.value) * 60000));
  update();
});


// Keep the slider in step with the date picker. Times outside 6 pm-4 am sit at the slider's ends.
function syncClock(date) {
  const min = (date - eveningOf(date)) / 60000;
  clock.value = Math.min(CONFIG.clock.maxMin, Math.max(0, Math.round(min / CONFIG.clock.stepMin) * CONFIG.clock.stepMin));
  const inRange = min >= 0 && min <= CONFIG.clock.maxMin;
  $('#clock-out').textContent = inRange ? fmtTime(date) : `${fmtTime(date)} (outside 6 pm–4 am, drag to pick a time tonight)`;
}

function setPicking(which) {
  state.picking = which;
  $('#pick-start').classList.toggle('active', which === 'start');
  $('#pick-end').classList.toggle('active', which === 'end');
}
$('#pick-start').addEventListener('click', () => setPicking('start'));
$('#pick-end').addEventListener('click', () => setPicking('end'));

// ---------- Recompute everything ----------

function update({ fit = false } = {}) {
  if (!state.start || !state.end) return;
  const date = currentDate();
  syncClock(date);
  const sun = sunInfo(date);
  map.getSource('buildings').setData(buildingsGeojson(date));
  const openNear = edgeBuildings.map((list) => list.some((b) => isOpen(b, date)));
  const ctx = { night: sun.night, openNear };

  $('#sun').innerHTML = `Sunrise ${fmtTime(sun.sunrise)} · Sunset ${fmtTime(sun.sunset)} · ${
    sun.night
      ? '<b>After dark:</b> the Lit route weighs lighting.'
      : '<b>Daylight:</b> lighting doesn\'t change the route, so both routes match.'
  }`;

  const fastest = dijkstra(state.start.id, state.end.id, walkSeconds);
  const litRoute = dijkstra(state.start.id, state.end.id, (i) => litCost(i, ctx));
  $('#extra-cards').innerHTML = isLateBusTime(date) ? lateBusCard() : '';
  if (!fastest || !litRoute) {
    $('#cards').innerHTML = '<p class="card">No walking connection between these points.</p>';
    hideFriend();
    return;
  }

  const line = (steps) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: routeCoords(steps) } });
  map.getSource('route-fastest').setData(line(fastest));
  map.getSource('route-lit').setData(line(litRoute));

  const fx = exposure(fastest, date);
  const lx = exposure(litRoute, date);
  $('#cards').innerHTML = card('Fastest', COLORS.fastest, fx, fx) + card('Lit', COLORS.litRoute, lx, fx);
  showFriendCard(sun.night ? lx : null);

  if (fit) {
    const all = [...routeCoords(fastest), ...routeCoords(litRoute)];
    const bounds = all.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(all[0], all[0]));
    const mobile = window.innerWidth < 768;
    map.fitBounds(bounds, {
      padding: mobile ? { top: 70, bottom: window.innerHeight * 0.48 + 30, left: 30, right: 30 } : { top: 60, bottom: 60, left: 420, right: 60 },
      duration: 0,
    });
  }
}

// Shows the friend card at the middle of the stretch after dark; hides it otherwise.
function showFriendCard(x) {
  const coords = x && x.longestStretch > 0 ? routeCoords(x.longestSteps) : [];
  map.getSource('stretch').setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
  if (coords.length < 2 || friendDismissed) {
    hideFriend();
    return;
  }
  const line = turf.lineString(coords);
  const middle = turf.along(line, turf.length(line, { units: 'meters' }) / 2, { units: 'meters' }).geometry.coordinates;
  friendPopup
    .setLngLat(middle)
    .setHTML(`
      <h3>Walk with a friend</h3>
      <p>This ${Math.round(x.longestStretch)} m stretch of the Lit route is dark or has no lighting data.</p>
      <p>In Cornell's <b>Rave Guardian</b> app, a friend can act as your guardian, and the app has a safety timer you can set for your walk.</p>
      <a href="${LINKS.blueLights}" target="_blank" rel="noopener">Cornell Police: Blue Light services</a>`);
  if (!friendPopup.isOpen()) friendPopup.addTo(map);
}

function lateBusCard() {
  return `
    <section class="card info">
      <h2>Late-night bus</h2>
      <p>Cornell's student safety page lists TCAT bus service from 6:30 pm to 2:30 am. Riding may be an option instead of walking.</p>
      <a href="${LINKS.studentSafety}" target="_blank" rel="noopener">Cornell student safety and support</a>
    </section>`;
}

function card(name, color, x, base) {
  const extra = x.minutes - base.minutes;
  const extraText = name === 'Fastest' ? '—' : `${extra >= 0.05 ? '+' : ''}${extra.toFixed(1)} min`;
  const blue = x.maxBlue == null ? 'no data' : `${x.maxBlue} m`;
  const open = x.open.length ? x.open.join(', ') : 'none';
  return `
    <section class="card" style="--accent:${color}">
      <h2><i class="sw route" style="background:${color}"></i>${name}</h2>
      <div class="big">${x.minutes.toFixed(1)} <small>min · ${Math.round(x.length)} m</small></div>
      <dl class="stats">
        <dt>Extra vs. Fastest</dt><dd>${extraText}</dd>
        <dt>Length lit</dt><dd>${Math.round(x.litPct)}% <small>(${Math.round(x.litConfirmedPct)}% from mapped data, rest estimated)</small></dd>
        <dt>Longest dark or unknown stretch</dt><dd>${Math.round(x.longestStretch)} m</dd>
        <dt>Max distance to a Blue Light</dt><dd>${blue}</dd>
        <dt>Open buildings passed</dt><dd>${open}</dd>
      </dl>
    </section>`;
}
