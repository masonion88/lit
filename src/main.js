import '@fontsource-variable/nunito';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import * as turf from '@turf/turf';
import { CONFIG, LINKS, SOURCES, SOURCE_TEXT, COLORS, LIGHTING_KEYS } from './config.js';
import { DAYS, DAY_NAMES, isOpen, eveningOf, isLateBusTime, sunInfo, fmtTime, toInputValue, dayWord } from './time.js';
import { loadGraph, nearestNode, insideArea, applyChecks } from './graph.js';
import { dijkstra, walkSeconds, litCost, routeCoords, sameRoute, exposure, lightingStrip, directions } from './routing.js';
import { icon, placeIcon, lumi } from './icons.js';
import { initSheet } from './sheet.js';
import * as store from './store.js';

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtDist = (m) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`);
const isPhone = () => window.matchMedia('(max-width: 767px)').matches;
const kindLabel = (k) => (k ? k.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase()) : 'Place');
const shortName = (name) => name.replace(/, Cornell University$/, '').replace(/, Ithaca, NY$/, '');
const ROUTE_NAMES = { fastest: 'Fastest', lit: 'Lit' };
const ROUTE_COLORS = { fastest: COLORS.fastest, lit: COLORS.litRoute };
// Badges for night checks, Duolingo style.
const LEVELS = [
  { at: 1, name: 'First spark' },
  { at: 5, name: 'Glow worm' },
  { at: 10, name: 'Lantern' },
  { at: 25, name: 'Lighthouse' },
  { at: 50, name: 'North Star' },
];

// ---------- Page skeleton ----------

document.querySelector('#app').innerHTML = `
  <div id="map" role="application" aria-label="Map of walking paths colored by lighting"></div>

  <div id="splash">
    ${lumi(120)}
    <p>Lighting up the map…</p>
  </div>

  <div id="search-card" class="glass">
    <button type="button" class="field" data-which="start">
      <i class="dot start"></i>
      <span class="field-text"><span class="field-label">From</span><span class="field-value" id="from-value">…</span></span>
    </button>
    <div class="field-sep"></div>
    <button type="button" class="field" data-which="end">
      <i class="dot end"></i>
      <span class="field-text"><span class="field-label">To</span><span class="field-value" id="to-value">…</span></span>
    </button>
    <button type="button" id="swap" class="icon-btn" aria-label="Swap start and destination">${icon('swap')}</button>
  </div>

  <div id="fabs">
    <button id="help-btn" class="fab sos" aria-label="Get help">${icon('phone')}<span>Help</span></button>
    <button id="locate-btn" class="fab" aria-label="Show my location">${icon('locate')}</button>
    <button id="layers-btn" class="fab" aria-pressed="true" aria-label="Show lighting on all paths">${icon('layers')}</button>
  </div>

  <div id="choose-banner" class="glass" hidden>
    ${icon('tap')}<span id="choose-text"></span>
    <button id="choose-cancel" class="link-btn">Cancel</button>
  </div>

  <section id="sheet" class="glass" aria-label="Routes">
    <div id="grab" aria-hidden="true"><span class="handle"></span></div>
    <div class="sheet-body">
      <div id="time-row">
        <button id="time-btn" class="chip" aria-expanded="false" aria-controls="time-panel">
          <span id="time-icon"></span><span id="time-text"></span>${icon('chevron', 'chev')}
        </button>
        <button id="now" class="chip ghost">Now</button>
        <button id="share-btn" class="chip ghost" aria-label="Share this route">${icon('share')}<span>Share</span></button>
      </div>
      <div id="time-panel" hidden>
        <div class="clock-head"><span class="label">Drag through the night</span><output id="clock-out" for="clock"></output></div>
        <input id="clock" type="range" min="0" max="${CONFIG.clock.maxMin}" step="${CONFIG.clock.stepMin}" aria-label="Time tonight" />
        <div class="ticks"><span style="left:0%">6 pm</span><span style="left:30%">9 pm</span><span style="left:60%">12 am</span><span style="left:100%">4 am</span></div>
        <label class="date-row"><span class="label">Or pick any time</span><input id="when" type="datetime-local" /></label>
        <p id="sun" class="fine"></p>
      </div>

      <div id="quick-row"></div>
      <div id="options" role="radiogroup" aria-label="Route options"></div>
      <div id="detail"></div>
      <div id="nudges"></div>
      <section id="checks-card" class="card"></section>

      <details id="honesty" class="card fold">
        <summary>${icon('info')}<span>Data honesty</span>${icon('chevron', 'chev')}</summary>
        <p class="fine">Path segments by where their lighting value comes from:</p>
        <dl id="source-counts" class="stats"></dl>
        <p class="fine">Other map data:</p>
        <dl id="other-counts" class="stats"></dl>
      </details>

      <details id="legend" class="card fold">
        <summary>${icon('layers')}<span>Map key &amp; sources</span>${icon('chevron', 'chev')}</summary>
        <ul class="keys">
          <li><i class="sw" style="background:${COLORS.lit}"></i>Lit</li>
          <li><i class="sw" style="background:${COLORS['likely lit']}"></i>Likely lit (street lamp mapped nearby)</li>
          <li><i class="sw dashed" style="color:${COLORS['estimated lit']}"></i>Estimated lit (a guess from the path type)</li>
          <li><i class="sw" style="background:${COLORS.dark}"></i>Dark or estimated dark</li>
          <li><i class="sw" style="background:${COLORS.unknown}"></i>Unknown</li>
          <li><i class="sw route" style="background:${COLORS.litRoute}"></i>Chosen route, filled in with its lighting</li>
          <li><i class="sw route" style="background:${COLORS.alt}"></i>Other route (tap it to switch)</li>
          <li><i class="sw stretch"></i>Longest dark or unknown stretch</li>
          <li><i class="bdot" style="background:${COLORS.blueLight}"></i>Blue Light phone (only mapped ones)</li>
          <li><i class="bdot" style="background:${COLORS.open}"></i>Place open at the chosen time</li>
          <li><i class="bdot" style="background:${COLORS.closed}"></i>Place closed</li>
          <li><i class="bdot check"></i>Your own night check</li>
        </ul>
        <p class="label">Every lighting value has a source:</p>
        <dl class="sources">
          ${SOURCES.map((s) => `<dt>${s}</dt><dd>${SOURCE_TEXT[s]}</dd>`).join('')}
        </dl>
        <p class="fine">The Lit route only weighs lighting between sunset and sunrise.</p>
      </details>

      <p class="fine footer">No crime data, by design. Lit shows tradeoffs in the physical environment. It can't promise a route is risk-free.</p>
    </div>
  </section>

  <div id="search" class="overlay" hidden role="dialog" aria-modal="true" aria-label="Search places">
    <div class="search-panel glass">
      <div class="search-head">
        <button id="search-back" class="icon-btn" aria-label="Close search">${icon('back')}</button>
        <input id="search-input" type="search" autocomplete="off" enterkeyhint="search" />
      </div>
      <ul id="search-results"></ul>
    </div>
  </div>

  <div id="help" class="overlay modal" hidden role="dialog" aria-modal="true" aria-labelledby="help-title">
    <div class="modal-card glass">
      <button class="icon-btn modal-close" data-close aria-label="Close">${icon('close')}</button>
      <h2 id="help-title">Need help?</h2>
      <a class="big-btn danger" href="tel:911">${icon('phone')}<span>Call 911</span></a>
      <a class="big-btn" href="tel:+16072551111">${icon('phone')}<span>Cornell Police<small>607-255-1111 · non-emergency</small></span></a>
      <ul class="help-list">
        <li>${icon('phone')}<span>Blue Light phones connect directly to Cornell Police. <a href="${LINKS.blueLights}" target="_blank" rel="noopener">About Blue Lights</a></span></li>
        <li>${icon('people')}<span>In Cornell's <b>Rave Guardian</b> app, a friend can act as your guardian, and the app has a safety timer you can set for your walk.</span></li>
        <li>${icon('bus')}<span>Cornell's student safety page lists late-night TCAT service from 6:30 pm to 2:30 am. <a href="${LINKS.studentSafety}" target="_blank" rel="noopener">Student safety &amp; support</a></span></li>
      </ul>
    </div>
  </div>

  <div id="welcome" class="overlay modal" hidden role="dialog" aria-modal="true" aria-labelledby="welcome-title">
    <div class="modal-card glass welcome">
      ${lumi(112)}
      <h2 id="welcome-title">Hi, I'm Lumi!</h2>
      <p>I help you compare walks after dark by how they're <b>lit</b>, not by crime.</p>
      <ul class="welcome-list">
        <li>${icon('sparkle')}<span><b>Two routes, side by side.</b> The fastest one, and one that sticks to the light.</span></li>
        <li>${icon('tap')}<span><b>Tap anything on the map</b> to see where its data comes from.</span></li>
        <li>${icon('check')}<span><b>Out at night?</b> Tell me if a path is lit. Your checks color the map right away.</span></li>
      </ul>
      <button class="btn-primary" data-close>Let's go</button>
    </div>
  </div>

  <div id="toast" role="status" aria-live="polite"></div>
`;

// ---------- State ----------

const state = {
  start: null, // { node, name, kind, lat, lng }
  end: null,
  choosing: null, // 'start' | 'end' while "Choose on map" is on
  searchFor: 'start', // which field the search fills: 'start' | 'end' | 'home'
  selected: 'lit',
  showPaths: true,
  routes: null,
  myLocation: null,
};
let g = null;
let mapReady = false;
let useBlueLights = false;
let buildingsByName = new Map();
// Saved on this device only.
const favorites = store.load('favorites', []);
let home = store.load('home', null);
const checks = store.load('checks', []);

// ---------- Map ----------

// Vite bundles MapLibre's background worker separately, so tell MapLibre where it is.
maplibregl.setWorkerUrl(maplibreWorkerUrl);

const map = new maplibregl.Map({
  container: 'map',
  style: CONFIG.mapStyle,
  center: [-76.4815, 42.4475],
  zoom: 14.6,
  attributionControl: false,
});
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
// MapLibre's own locate control draws the blue "you are here" dot. Its button is hidden;
// our round locate button triggers it instead.
const geolocate = new maplibregl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  trackUserLocation: true,
});
map.addControl(geolocate, 'top-right');
geolocate.on('geolocate', (pos) => { state.myLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude }; });
geolocate.on('error', () => toast("Couldn't get your location. Check that location is allowed for this site."));

const sheet = initSheet($('#sheet'), $('#grab'), (h) => document.documentElement.style.setProperty('--sheet-visible', `${h}px`));

function makeMarker(which) {
  const el = document.createElement('div');
  el.className = `pin pin-${which}`;
  el.innerHTML = which === 'end'
    ? `<svg viewBox="0 0 32 42" width="32" height="42"><path d="M16 41S3 26 3 15.5a13 13 0 0126 0C29 26 16 41 16 41z" fill="${COLORS.end}" stroke="#fff" stroke-width="2.5"/><circle cx="16" cy="15.5" r="5" fill="#fff"/></svg>`
    : '<span></span>';
  el.title = 'Drag to move';
  const m = new maplibregl.Marker({ element: el, draggable: true, anchor: which === 'end' ? 'bottom' : 'center' });
  m.on('dragend', () => {
    const ll = m.getLngLat();
    setPoint(which, { lat: ll.lat, lng: ll.lng }, 'Dropped pin', 'pin');
    update();
  });
  return m;
}
const markers = { start: makeMarker('start'), end: makeMarker('end') };

const emptyLine = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } };
const emptyCollection = { type: 'FeatureCollection', features: [] };
const line = (coords) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
const colorByLighting = ['match', ['get', 'lighting'], ...LIGHTING_KEYS.flatMap((k) => [k, COLORS[k]]), COLORS.unknown];

function pathsGeojson() {
  return {
    type: 'FeatureCollection',
    features: g.edges.map((e, i) => ({
      type: 'Feature',
      properties: { lighting: e.lighting, i },
      geometry: { type: 'LineString', coordinates: e.coords },
    })),
  };
}

function buildingsGeojson(date) {
  return {
    type: 'FeatureCollection',
    features: g.buildings.map((b) => ({
      type: 'Feature',
      properties: { name: b.name, open: isOpen(b, date) },
      geometry: { type: 'Point', coordinates: [b.lng, b.lat] },
    })),
  };
}

const pointsGeojson = (list, props) => ({
  type: 'FeatureCollection',
  features: list.map((p) => ({ type: 'Feature', properties: props(p), geometry: { type: 'Point', coordinates: [p.lng, p.lat] } })),
});
const checksGeojson = () => pointsGeojson(checks, (c) => ({ status: c.status }));

function addLayers() {
  map.addSource('paths', { type: 'geojson', data: pathsGeojson() });
  map.addSource('stretch', { type: 'geojson', data: emptyLine });
  map.addSource('route-alt', { type: 'geojson', data: emptyLine });
  map.addSource('route-sel', { type: 'geojson', data: emptyLine });
  map.addSource('route-sel-segs', { type: 'geojson', data: emptyCollection });
  map.addSource('buildings', { type: 'geojson', data: buildingsGeojson(currentDate()) });
  map.addSource('bluelights', { type: 'geojson', data: pointsGeojson(g.blueLights, (b) => ({ name: b.name, source: b.source })) });
  map.addSource('checks', { type: 'geojson', data: checksGeojson() });

  const pathWidth = ['interpolate', ['linear'], ['zoom'], 13, 0.8, 16, 2.5, 19, 5];
  map.addLayer({
    id: 'paths-solid',
    type: 'line',
    source: 'paths',
    filter: ['!=', ['get', 'lighting'], 'estimated lit'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': colorByLighting, 'line-width': pathWidth, 'line-opacity': 0.45 },
  });
  map.addLayer({
    id: 'paths-dashed',
    type: 'line',
    source: 'paths',
    filter: ['==', ['get', 'lighting'], 'estimated lit'],
    paint: { 'line-color': colorByLighting, 'line-width': pathWidth, 'line-dasharray': [2, 1.5], 'line-opacity': 0.35 },
  });
  map.addLayer({
    id: 'stretch',
    type: 'line',
    source: 'stretch',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 22, 'line-opacity': 0.22, 'line-blur': 6 },
  });
  map.addLayer({
    id: 'route-alt',
    type: 'line',
    source: 'route-alt',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': COLORS.alt, 'line-width': 7, 'line-opacity': 0.75 },
  });
  // The chosen route: a thick line in the route's color, filled in with each path's lighting.
  map.addLayer({
    id: 'route-sel-casing',
    type: 'line',
    source: 'route-sel',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': COLORS.litRoute, 'line-width': 12 },
  });
  map.addLayer({
    id: 'route-sel-inner',
    type: 'line',
    source: 'route-sel-segs',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': colorByLighting, 'line-width': 5 },
  });
  map.addLayer({
    id: 'buildings',
    type: 'circle',
    source: 'buildings',
    paint: {
      'circle-color': ['case', ['get', 'open'], COLORS.open, COLORS.closed],
      'circle-radius': ['case', ['get', 'open'], 6.5, 3.5],
      'circle-opacity': ['case', ['get', 'open'], 1, 0.7],
      'circle-stroke-color': '#0e1017',
      'circle-stroke-width': 2,
    },
  });
  map.addLayer({
    id: 'bluelights',
    type: 'circle',
    source: 'bluelights',
    paint: { 'circle-color': COLORS.blueLight, 'circle-radius': 7, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
  });
  map.addLayer({
    id: 'checks',
    type: 'circle',
    source: 'checks',
    paint: {
      'circle-color': ['case', ['==', ['get', 'status'], 'lit'], COLORS.lit, COLORS.dark],
      'circle-radius': 5,
      'circle-stroke-color': '#fff',
      'circle-stroke-width': 2,
    },
  });
}

// Our layers go on as soon as the map style is ready (and the data is loaded), without
// waiting for every map tile to arrive.
function whenMapReady() {
  if (mapReady || !g || !map.isStyleLoaded()) return;
  mapReady = true;
  addLayers();
  draw();
}
map.on('style.load', whenMapReady);
map.on('styledata', whenMapReady);
// Handy for poking at the map from the browser console while developing (not in the built site).
if (import.meta.env.DEV) window.litMap = map;
map.on('load', () => {
  whenMapReady();
  // Start the map credits folded into their small (i) button.
  document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
});

// ---------- Time controls ----------

const whenInput = $('#when');
const clock = $('#clock');
const currentDate = () => (whenInput.value ? new Date(whenInput.value) : new Date());

whenInput.addEventListener('change', () => update());
$('#now').addEventListener('click', () => {
  whenInput.value = toInputValue(new Date());
  update();
});
// Dragging the clock re-routes live ('input' fires on every step, not just on release).
clock.addEventListener('input', () => {
  whenInput.value = toInputValue(new Date(eveningOf(currentDate()).getTime() + Number(clock.value) * 60000));
  update();
});
$('#time-btn').addEventListener('click', () => {
  const panel = $('#time-panel');
  panel.hidden = !panel.hidden;
  $('#time-btn').setAttribute('aria-expanded', String(!panel.hidden));
});

// Keeps the slider, the time button and the sun line in step with the chosen time.
function syncTime(date) {
  const min = (date - eveningOf(date)) / 60000;
  clock.value = Math.min(CONFIG.clock.maxMin, Math.max(0, Math.round(min / CONFIG.clock.stepMin) * CONFIG.clock.stepMin));
  $('#clock-out').textContent = min >= 0 && min <= CONFIG.clock.maxMin ? fmtTime(date) : `${fmtTime(date)} (daytime)`;
  const sun = sunInfo(date);
  $('#time-icon').innerHTML = icon(sun.night ? 'moon' : 'sun');
  $('#time-text').textContent = `${dayWord(date)} · ${fmtTime(date)}`;
  $('#sun').innerHTML = `Sunrise ${fmtTime(sun.sunrise)} · Sunset ${fmtTime(sun.sunset)}. ${
    sun.night ? 'After dark, the Lit route weighs lighting.' : "In daylight, lighting doesn't change the route."
  }`;
}

// ---------- Points ----------

function setPoint(which, { lat, lng }, name, kind = 'place') {
  const node = nearestNode(g, { lat, lng });
  state[which] = { node, name, kind, lat, lng };
  markers[which].setLngLat([node.lng, node.lat]).addTo(map);
  $(which === 'start' ? '#from-value' : '#to-value').textContent = name;
}

$('#swap').addEventListener('click', () => {
  const { start, end } = state;
  if (!start || !end) return;
  setPoint('start', end, end.name, end.kind);
  setPoint('end', start, start.name, start.kind);
  const btn = $('#swap');
  btn.classList.remove('spin');
  void btn.offsetWidth; // restart the little spin animation
  btn.classList.add('spin');
  update();
});

function startChoosing(which) {
  state.choosing = which;
  $('#choose-text').textContent = `Tap the map to set your ${which === 'start' ? 'start' : 'destination'}`;
  $('#choose-banner').hidden = false;
  map.getCanvas().style.cursor = 'crosshair';
  if (isPhone()) sheet.set('peek');
}
function endChoosing() {
  state.choosing = null;
  $('#choose-banner').hidden = true;
  map.getCanvas().style.cursor = '';
}
$('#choose-cancel').addEventListener('click', endChoosing);

// ---------- Recompute everything ----------

function update({ fit = false } = {}) {
  if (!g || !state.start || !state.end) return;
  const date = currentDate();
  syncTime(date);
  const sun = sunInfo(date);
  const openNear = g.edgeBuildings.map((list) => list.some((b) => isOpen(b, date)));
  const ctx = { night: sun.night, openNear, useBlueLights };

  const fastest = dijkstra(g, state.start.node.id, state.end.node.id, (i) => walkSeconds(g, i));
  const lit = dijkstra(g, state.start.node.id, state.end.node.id, (i) => litCost(g, i, ctx));
  state.routes = !fastest || !lit ? null : {
    fastest,
    lit,
    fx: exposure(g, fastest, date),
    lx: exposure(g, lit, date),
    same: sameRoute(fastest, lit),
    date,
    night: sun.night,
  };
  renderQuickRow();
  renderOptions();
  renderDetail();
  renderNudges();
  draw();
  writeHash();
  if (fit) fitRoutes();
}

function selectRoute(key) {
  if (!state.routes || state.selected === key) return;
  state.selected = key;
  renderOptions();
  renderDetail();
  draw();
  writeHash();
}

// ---------- Drawing routes on the map ----------

function draw() {
  if (!mapReady || !g) return;
  const r = state.routes;
  map.getSource('buildings').setData(buildingsGeojson(currentDate()));
  if (!r) {
    for (const id of ['route-alt', 'route-sel', 'stretch']) map.getSource(id).setData(emptyLine);
    map.getSource('route-sel-segs').setData(emptyCollection);
    hideFriend();
    return;
  }
  const key = r.same ? 'lit' : state.selected;
  const steps = r[key];
  const other = key === 'lit' ? 'fastest' : 'lit';
  map.getSource('route-alt').setData(line(r.same ? [] : routeCoords(g, r[other])));
  map.getSource('route-sel').setData(line(routeCoords(g, steps)));
  map.getSource('route-sel-segs').setData({
    type: 'FeatureCollection',
    features: steps.map(({ edge }) => ({
      type: 'Feature',
      properties: { lighting: g.edges[edge].lighting, i: edge },
      geometry: { type: 'LineString', coordinates: g.edges[edge].coords },
    })),
  });
  map.setPaintProperty('route-sel-casing', 'line-color', ROUTE_COLORS[key]);
  showFriendCard(r.night ? r[key === 'lit' ? 'lx' : 'fx'] : null);
}

function fitRoutes() {
  const r = state.routes;
  if (!r) return;
  const all = [...routeCoords(g, r.fastest), ...routeCoords(g, r.lit)];
  if (all.length >= 2) fitCoords(all);
}

function fitCoords(coords, maxZoom = 17) {
  const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
  const padding = isPhone()
    ? { top: 150, bottom: sheet.visibleHeight() + 30, left: 40, right: 70 }
    : { top: 60, bottom: 60, left: 460, right: 90 };
  map.fitBounds(bounds, { padding, maxZoom, duration: 600 });
}

// "Walk with a friend" card, pinned to the middle of the chosen route's longest dark stretch.
const friendPopup = new maplibregl.Popup({ closeOnClick: false, maxWidth: '260px', className: 'lit-popup friend', offset: 12 });
let friendDismissed = false;
let friendRemovingInCode = false;
friendPopup.on('close', () => { if (!friendRemovingInCode) friendDismissed = true; });
function hideFriend() {
  friendRemovingInCode = true;
  friendPopup.remove();
  friendRemovingInCode = false;
}

function showFriendCard(x) {
  const coords = x && x.longestStretch >= CONFIG.friendMinStretchM ? routeCoords(g, x.longestSteps) : [];
  map.getSource('stretch').setData(line(coords));
  if (coords.length < 2 || friendDismissed) {
    hideFriend();
    return;
  }
  const l = turf.lineString(coords);
  const middle = turf.along(l, turf.length(l, { units: 'meters' }) / 2, { units: 'meters' }).geometry.coordinates;
  friendPopup.setLngLat(middle).setHTML(`
    <div class="popup-head">${icon('people')}<h3>Walk with a friend?</h3></div>
    <p>This ${Math.round(x.longestStretch)} m stretch is dark or has no lighting data.</p>
    <p>In Cornell's <b>Rave Guardian</b> app, a friend can act as your guardian, and it has a safety timer for your walk.</p>
    <a href="${LINKS.blueLights}" target="_blank" rel="noopener">Cornell Police: Blue Light services</a>`);
  if (!friendPopup.isOpen()) friendPopup.addTo(map);
}

// ---------- Sheet content ----------

function stripHtml(steps) {
  return `<span class="strip" aria-hidden="true">${lightingStrip(g, steps)
    .map((b) => `<i class="${b.lighting === 'estimated lit' ? 'est' : ''}" style="width:${b.pct}%;--c:${COLORS[b.lighting] ?? COLORS.unknown}"></i>`)
    .join('')}</span>`;
}

function renderOptions() {
  const r = state.routes;
  const el = $('#options');
  if (!r) {
    el.innerHTML = `<div class="empty card">${lumi(64)}<p><b>Hmm, no walking connection.</b><br>Try moving a pin onto a path.</p></div>`;
    return;
  }
  if (r.fastest.length === 0) {
    el.innerHTML = `<div class="empty card">${lumi(64, 'cheer')}<p><b>You're already there!</b><br>Pick a different destination.</p></div>`;
    return;
  }
  // Arrival uses the rounded minutes shown on the card, so the two always agree.
  const arrive = (x) => fmtTime(new Date(r.date.getTime() + Math.round(x.minutes) * 60000));
  if (r.same) {
    const msg = r.night
      ? 'The fastest walk is also the best lit one tonight.'
      : 'In daylight both routes match. Slide to tonight to compare.';
    el.innerHTML = `
      <div class="option single selected" style="--accent:${COLORS.litRoute}">
        <span class="option-top"><span class="option-name"><i class="swatch"></i>Fastest &amp; Lit</span>
          ${r.night ? '<span class="badge">Best of both</span>' : ''}</span>
        <span class="option-time">${Math.round(r.lx.minutes)}<small> min</small></span>
        <span class="option-sub">Arrive ${arrive(r.lx)} · ${fmtDist(r.lx.length)} · ${Math.round(r.lx.litPct)}% lit</span>
        ${stripHtml(r.lit)}
        <span class="option-meta">${msg}</span>
        ${r.night ? '' : `<button class="chip small" id="see-tonight">${icon('moon')}See 10 pm tonight</button>`}
      </div>`;
    $('#see-tonight')?.addEventListener('click', () => {
      const tonight = eveningOf(new Date());
      tonight.setHours(22, 0, 0, 0);
      whenInput.value = toInputValue(tonight);
      update();
    });
    return;
  }
  const card = (key) => {
    const x = key === 'lit' ? r.lx : r.fx;
    const sel = state.selected === key;
    const extra = r.lx.minutes - r.fx.minutes;
    const meta = key === 'lit'
      ? `${Math.round(x.litPct)}% lit · ${extra < 0.5 ? 'same time' : `+${Math.round(extra)} min`}`
      : `${Math.round(x.litPct)}% lit · ${fmtDist(x.length)}`;
    const badge = key === 'lit' && r.lx.litPct > r.fx.litPct + 1
      ? '<span class="badge">Most lit</span>'
      : key === 'fastest' ? '<span class="badge quiet">Quickest</span>' : '';
    return `
      <button class="option ${sel ? 'selected' : ''}" role="radio" aria-checked="${sel}" data-route="${key}" style="--accent:${ROUTE_COLORS[key]}">
        <span class="option-top"><span class="option-name"><i class="swatch"></i>${ROUTE_NAMES[key]}</span>${badge}</span>
        <span class="option-time">${Math.round(x.minutes)}<small> min</small></span>
        <span class="option-sub">Arrive ${arrive(x)}</span>
        ${stripHtml(r[key])}
        <span class="option-meta">${meta}</span>
      </button>`;
  };
  el.innerHTML = card('fastest') + card('lit');
  for (const b of el.querySelectorAll('[data-route]')) b.addEventListener('click', () => selectRoute(b.dataset.route));
}

function renderDetail() {
  const r = state.routes;
  const el = $('#detail');
  if (!r || r.fastest.length === 0) {
    el.innerHTML = '';
    return;
  }
  const key = r.same ? 'lit' : state.selected;
  const x = key === 'lit' ? r.lx : r.fx;
  const blue = x.maxBlue == null ? 'No data' : fmtDist(x.maxBlue);
  const dirs = directions(g, r[key], state.end.name);
  const moodText = { lit: 'lit', partly: 'partly lit', dark: 'dark or no data' };
  el.innerHTML = `
    <div class="tiles">
      <div class="tile">${icon('sun')}<b>${Math.round(x.litPct)}%</b><span>of the walk is lit</span>
        <small>${Math.round(x.litConfirmedPct)}% from mapped data</small></div>
      <div class="tile">${icon('moon')}<b>${x.longestStretch ? fmtDist(x.longestStretch) : 'None'}</b><span>longest dark or unknown stretch</span></div>
      <div class="tile">${icon('food')}<b>${x.open.length}</b><span>open place${x.open.length === 1 ? '' : 's'} on the way</span></div>
      <div class="tile">${icon('phone')}<b>${blue}</b><span>max to a mapped Blue Light</span>
        ${useBlueLights ? '' : `<small>only ${g.blueLights.length} mapped</small>`}</div>
    </div>
    ${x.open.length ? `<div class="open-list"><span class="label">Open on the way</span>${x.open.map((n) => `<span class="pill">${esc(n)}</span>`).join('')}</div>` : ''}
    <h3 class="section-title">${icon('walk')} Directions</h3>
    <ol class="directions">
      ${dirs.map((d, i) => `
        <li><button data-step="${i}">
          <span class="turn">${icon(`turn-${d.turn}`)}</span>
          <span class="dir-text">${esc(d.text)}
            ${d.length ? `<small>${fmtDist(d.length)} · <i class="mood ${d.mood}"></i>${moodText[d.mood]}</small>` : ''}</span>
        </button></li>`).join('')}
    </ol>`;
  for (const b of el.querySelectorAll('[data-step]')) {
    b.addEventListener('click', () => {
      const d = dirs[Number(b.dataset.step)];
      if (d.coords.length >= 2) fitCoords(d.coords, 18);
      else map.flyTo({ center: d.coords[0], zoom: 18 });
      if (isPhone()) sheet.set('peek');
    });
  }
}

function renderNudges() {
  const r = state.routes;
  $('#nudges').innerHTML = r && r.night && isLateBusTime(r.date)
    ? `<section class="card nudge">${icon('bus')}<div><b>Late-night bus</b>
        <p>Cornell's student safety page lists TCAT service from 6:30 pm to 2:30 am. Riding may be an option too.</p>
        <a href="${LINKS.studentSafety}" target="_blank" rel="noopener">Student safety &amp; support</a></div></section>`
    : '';
}

// Home and favorites as one-tap chips above the routes.
function renderQuickRow() {
  const chips = [
    home
      ? `<button class="chip home" data-quick="home">${icon('home')}Take me home</button>`
      : `<button class="chip ghost" data-quick="sethome">${icon('home')}Set Home</button>`,
    ...favorites.map((f, i) => `<button class="chip ghost" data-quick="fav" data-i="${i}">${icon('star', 'filled')}${esc(f.name)}</button>`),
  ];
  const el = $('#quick-row');
  el.innerHTML = chips.join('');
  for (const b of el.querySelectorAll('[data-quick]')) {
    b.addEventListener('click', () => {
      const what = b.dataset.quick;
      if (what === 'home') takeMeHome();
      else if (what === 'sethome') openSearch('home');
      else {
        const f = favorites[Number(b.dataset.i)];
        setPoint('end', f, f.name, 'place');
        update({ fit: true });
      }
    });
  }
}

async function takeMeHome() {
  if (!home) return openSearch('home');
  const here = state.myLocation ?? (await locateOnce({ quiet: true }));
  const fromHere = here && insideArea(g, here);
  if (fromHere) setPoint('start', here, 'Your location', 'location');
  setPoint('end', home, 'Home', 'home');
  update({ fit: true });
  toast(`${lumi(36)}<span>Heading home${fromHere ? ' from where you are' : ` from ${esc(state.start.name)}`}.</span>`);
}

// ---------- Search ----------

const searchEl = $('#search');
const searchInput = $('#search-input');
let results = [];

for (const f of document.querySelectorAll('#search-card .field')) f.addEventListener('click', () => openSearch(f.dataset.which));
$('#search-back').addEventListener('click', closeSearch);
searchInput.addEventListener('input', renderResults);
searchInput.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') searchEl.querySelector('.result')?.click();
});

function openSearch(which) {
  if (!g) return;
  state.searchFor = which;
  searchInput.value = '';
  searchInput.placeholder = which === 'home' ? 'Find your home (dorm, building…)' : which === 'start' ? 'Start from…' : 'Where to?';
  searchEl.hidden = false;
  renderResults();
  setTimeout(() => searchInput.focus(), 30);
}
function closeSearch() {
  searchEl.hidden = true;
}

// Starts-with beats word-start beats anywhere-in-the-name; shorter names first.
function matchPlaces(q) {
  const qq = q.trim().toLowerCase();
  if (!qq) return [];
  const scored = [];
  for (const p of g.places) {
    const n = p.name.toLowerCase();
    const score = n.startsWith(qq) ? 0 : n.split(/[\s\-–(/]+/).some((w) => w.startsWith(qq)) ? 1 : n.includes(qq) ? 2 : -1;
    if (score >= 0) scored.push([score, p]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].name.length - b[1].name.length).slice(0, 30).map((s) => s[1]);
}

function renderResults() {
  const q = searchInput.value;
  const date = currentDate();
  const rows = [];
  results = [];
  const add = (item, html) => {
    results.push(item);
    rows.push(`<li>${html(results.length - 1)}</li>`);
  };
  const subFor = (p) => {
    const b = buildingsByName.get(p.name);
    const openText = b ? (isOpen(b, date) ? ' · <span class="good">Open</span>' : ' · Closed') : '';
    return `${esc(kindLabel(p.kind))}${openText}`;
  };
  const placeRow = (p) => (i) => {
    const fav = favorites.some((f) => f.name === p.name);
    return `<button class="result" data-i="${i}"><span class="result-icon">${icon(placeIcon(p.kind))}</span>
        <span class="result-text"><b>${esc(p.name)}</b><small>${subFor(p)}</small></span></button>
      <button class="star ${fav ? 'on' : ''}" data-star="${i}" aria-label="${fav ? 'Remove from' : 'Save to'} favorites">${icon('star', fav ? 'filled' : '')}</button>`;
  };

  if (!q.trim()) {
    if (state.searchFor !== 'home') {
      add({ type: 'here' }, (i) => `<button class="result" data-i="${i}"><span class="result-icon accent">${icon('locate')}</span>
        <span class="result-text"><b>Your location</b><small>Uses your device's location</small></span></button>`);
    }
    add({ type: 'choose' }, (i) => `<button class="result" data-i="${i}"><span class="result-icon">${icon('pin')}</span>
      <span class="result-text"><b>Choose on map</b><small>Tap anywhere on the map</small></span></button>`);
    if (state.searchFor !== 'home' && home) {
      add({ type: 'place', place: { ...home, name: 'Home', kind: 'home' } }, (i) => `<button class="result" data-i="${i}">
        <span class="result-icon home">${icon('home')}</span><span class="result-text"><b>Home</b><small>${esc(home.label ?? '')}</small></span></button>
        <button class="star" data-clearhome aria-label="Forget Home">${icon('close')}</button>`);
    }
    if (favorites.length) rows.push('<li class="group">Saved</li>');
    for (const f of favorites) add({ type: 'place', place: f }, placeRow(f));
    const popular = CONFIG.popular
      .map((n) => g.places.find((p) => p.name === n))
      .filter((p) => p && !favorites.some((f) => f.name === p.name));
    if (popular.length) rows.push('<li class="group">Popular</li>');
    for (const p of popular) add({ type: 'place', place: p }, placeRow(p));
  } else {
    const found = matchPlaces(q);
    for (const p of found) add({ type: 'place', place: p }, placeRow(p));
    if (!found.length) rows.push(`<li class="no-results">${lumi(56)}<p>No places match “${esc(q)}”.<br>Try a building name, or choose on the map.</p></li>`);
  }
  $('#search-results').innerHTML = rows.join('');
}

$('#search-results').addEventListener('click', async (ev) => {
  if (ev.target.closest('[data-clearhome]')) {
    home = null;
    store.save('home', null);
    renderResults();
    renderQuickRow();
    toast('Home forgotten.');
    return;
  }
  const star = ev.target.closest('[data-star]');
  if (star) {
    toggleFavorite(results[Number(star.dataset.star)].place);
    renderResults();
    return;
  }
  const btn = ev.target.closest('.result');
  if (!btn) return;
  const item = results[Number(btn.dataset.i)];
  const which = state.searchFor;
  if (item.type === 'choose') {
    closeSearch();
    if (which === 'home') toast('Search for your building to set Home.');
    else startChoosing(which);
    return;
  }
  if (item.type === 'here') {
    const here = await locateOnce();
    if (!here) return;
    if (!insideArea(g, here)) {
      toast("You're outside the area Lit covers (Collegetown to North Campus).");
      return;
    }
    closeSearch();
    setPoint(which, here, 'Your location', 'location');
    update({ fit: true });
    return;
  }
  const p = item.place;
  closeSearch();
  if (which === 'home') {
    setHome(p);
    return;
  }
  setPoint(which, p, p.name, p.kind === 'home' ? 'home' : 'place');
  update({ fit: true });
});

function toggleFavorite(p) {
  const i = favorites.findIndex((f) => f.name === p.name);
  if (i >= 0) {
    favorites.splice(i, 1);
    toast(`Removed ${esc(p.name)} from favorites.`);
  } else {
    favorites.push({ name: p.name, lat: p.lat, lng: p.lng, kind: p.kind });
    toast(`${icon('star', 'filled')}<span>Saved ${esc(p.name)}.</span>`);
  }
  store.save('favorites', favorites);
  renderQuickRow();
}

function setHome(p) {
  home = { lat: p.lat, lng: p.lng, label: p.name };
  store.save('home', home);
  renderQuickRow();
  toast(`${lumi(36, 'cheer')}<span>Home set to ${esc(p.name)}. Tap “Take me home” any time.</span>`);
}

// ---------- Location ----------

function locateOnce({ quiet = false } = {}) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      if (!quiet) toast("This browser can't share your location.");
      return resolve(null);
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.myLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        resolve(state.myLocation);
      },
      () => {
        if (!quiet) toast("Couldn't get your location. Check that location is allowed for this site.");
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}

$('#locate-btn').addEventListener('click', () => geolocate.trigger());
$('#layers-btn').addEventListener('click', () => {
  state.showPaths = !state.showPaths;
  $('#layers-btn').setAttribute('aria-pressed', String(state.showPaths));
  if (mapReady) {
    for (const id of ['paths-solid', 'paths-dashed']) map.setLayoutProperty(id, 'visibility', state.showPaths ? 'visible' : 'none');
  }
  toast(state.showPaths ? 'Showing lighting on every path.' : 'Showing just your routes.');
});

// ---------- Tapping the map ----------

let suppressClick = false;
map.on('click', (ev) => {
  if (suppressClick) { suppressClick = false; return; }
  if (!g) return;
  if (state.choosing) {
    setPoint(state.choosing, { lat: ev.lngLat.lat, lng: ev.lngLat.lng }, 'Dropped pin', 'pin');
    endChoosing();
    update();
    return;
  }
  const { x, y } = ev.point;
  const box = [[x - 10, y - 10], [x + 10, y + 10]];
  // Tapping the grey route switches to it, like in Google Maps.
  if (state.routes && !state.routes.same && map.queryRenderedFeatures(box, { layers: ['route-alt'] }).length) {
    selectRoute(state.selected === 'lit' ? 'fastest' : 'lit');
    return;
  }
  inspect(box, ev.lngLat);
});

// Right-click, or press and hold on a phone, to drop a pin.
map.on('contextmenu', (ev) => showPinMenu(ev.lngLat));
let holdTimer = null;
map.on('touchstart', (ev) => {
  clearTimeout(holdTimer);
  if (ev.points.length !== 1) return;
  holdTimer = setTimeout(() => {
    suppressClick = true;
    showPinMenu(ev.lngLat);
  }, 550);
});
for (const name of ['touchend', 'touchmove', 'touchcancel', 'movestart']) map.on(name, () => clearTimeout(holdTimer));

const inspectPopup = new maplibregl.Popup({ maxWidth: '300px', className: 'lit-popup inspect', offset: 10 });

function showPinMenu(lngLat) {
  if (!g) return;
  inspectPopup.setLngLat(lngLat).setHTML(`
    <div class="popup-head">${icon('pin')}<h3>Dropped pin</h3></div>
    <div class="popup-actions">
      <button class="chip" data-pin="start"><i class="dot start"></i>Start here</button>
      <button class="chip" data-pin="end"><i class="dot end"></i>Go here</button>
    </div>`).addTo(map);
  for (const b of inspectPopup.getElement().querySelectorAll('[data-pin]')) {
    b.addEventListener('click', () => {
      setPoint(b.dataset.pin, { lat: lngLat.lat, lng: lngLat.lng }, 'Dropped pin', 'pin');
      inspectPopup.remove();
      update();
    });
  }
}

// Looks a few pixels around the tap, so thin paths are easy to hit on a phone.
function inspect(box, lngLat) {
  const hit = (layers) => map.queryRenderedFeatures(box, { layers })[0];
  const blue = hit(['bluelights']);
  const place = hit(['buildings']);
  const path = hit(['route-sel-inner', 'paths-solid', 'paths-dashed']);
  if (blue) showBlueLight(blue);
  else if (place) showPlace(place);
  else if (path) showPath(path.properties.i, lngLat);
  else inspectPopup.remove();
}

function showBlueLight(f) {
  const { name, source } = f.properties;
  inspectPopup.setLngLat(f.geometry.coordinates).setHTML(`
    <div class="popup-head"><span class="popup-dot" style="background:${COLORS.blueLight}"></span><h3>${esc(name)}</h3></div>
    <p>Location from ${source === 'osm' ? 'OpenStreetMap' : 'our list (data/bluelights.csv)'}. Blue Light phones connect directly to Cornell Police.</p>
    <p class="fine">Only mapped phones are shown. There are more on campus.</p>
    <a href="${LINKS.blueLights}" target="_blank" rel="noopener">About Blue Lights</a>`).addTo(map);
}

function showPlace(f) {
  const b = buildingsByName.get(f.properties.name);
  if (!b) return;
  const date = currentDate();
  const day = DAYS[date.getDay()];
  const today = b.hours[day];
  const todayText = today ? today.map(([o, c]) => `${o}–${c}`).join(', ') : 'closed';
  const open = isOpen(b, date);
  const fav = favorites.some((x) => x.name === b.name);
  inspectPopup.setLngLat([b.lng, b.lat]).setHTML(`
    <div class="popup-head"><span class="popup-dot" style="background:${open ? COLORS.open : COLORS.closed}"></span><h3>${esc(b.name)}</h3></div>
    <p><b class="${open ? 'good' : ''}">${open ? 'Open' : 'Closed'}</b> at ${fmtTime(date)}${b.kind ? ` · ${esc(kindLabel(b.kind))}` : ''}</p>
    <p>${DAY_NAMES[day]}: ${todayText}</p>
    <p class="fine">${b.source === 'osm'
      ? `Hours from OpenStreetMap (<code>${esc(b.hours_text)}</code>). They may be out of date.`
      : 'Hours from our list (data/buildings.csv).'}</p>
    <div class="popup-actions">
      <button class="chip" data-act="go">${icon('walk')}Go here</button>
      <button class="chip ghost" data-act="fav">${icon('star', fav ? 'filled' : '')}${fav ? 'Saved' : 'Save'}</button>
      <button class="chip ghost" data-act="home">${icon('home')}Home</button>
    </div>`).addTo(map);
  const p = { name: b.name, lat: b.lat, lng: b.lng, kind: b.kind };
  const el = inspectPopup.getElement();
  el.querySelector('[data-act="go"]').addEventListener('click', () => {
    setPoint('end', p, p.name);
    inspectPopup.remove();
    update({ fit: true });
  });
  el.querySelector('[data-act="fav"]').addEventListener('click', () => {
    toggleFavorite(p);
    showPlace(f);
  });
  el.querySelector('[data-act="home"]').addEventListener('click', () => {
    setHome(p);
    inspectPopup.remove();
  });
}

function showPath(i, lngLat) {
  const e = g.edges[i];
  // Snap the tap onto the path, so a check lands on this segment.
  const spot = turf.nearestPointOnLine(turf.lineString(e.coords), [lngLat.lng, lngLat.lat]).geometry.coordinates;
  const title = e.name ?? kindLabel(e.highway);
  const blue = e.dist_to_bluelight_m == null ? 'no data' : fmtDist(e.dist_to_bluelight_m);
  inspectPopup.setLngLat(spot).setHTML(`
    <div class="popup-head"><span class="popup-dot" style="background:${COLORS[e.lighting] ?? COLORS.unknown}"></span><h3>${esc(title)}</h3></div>
    <dl class="stats">
      <dt>Lighting</dt><dd>${e.lighting}</dd>
      <dt>Source</dt><dd>${e.mine ? 'verified (your check)' : e.lighting_source}</dd>
      <dt>OSM <code>lit</code> tag</dt><dd>${e.lit ? esc(e.lit) : 'none'}</dd>
      <dt>Next to woods</dt><dd>${e.isolated ? 'yes' : 'no'}</dd>
      <dt>Nearest mapped Blue Light</dt><dd>${blue}</dd>
    </dl>
    <p class="fine">${SOURCE_TEXT[e.lighting_source] ?? ''}</p>
    <div class="verify">
      <p><b>Standing here after dark?</b></p>
      <div class="popup-actions">
        <button class="btn-primary small" data-status="lit">${icon('sun')}It's lit</button>
        <button class="btn-secondary small" data-status="dark">${icon('moon')}It's dark</button>
      </div>
    </div>`).addTo(map);
  for (const btn of inspectPopup.getElement().querySelectorAll('[data-status]')) {
    btn.addEventListener('click', () => {
      addCheck(spot, btn.dataset.status);
      inspectPopup.remove();
    });
  }
}

// ---------- Night checks ----------

const levelFor = (n) => [...LEVELS].reverse().find((l) => n >= l.at) ?? null;

// How many nights in a row (ending tonight or last night) have at least one check.
function nightStreak() {
  const nights = new Set(checks.map((c) => eveningOf(new Date(c.at)).toDateString()));
  const d = eveningOf(new Date());
  if (!nights.has(d.toDateString())) d.setDate(d.getDate() - 1);
  let n = 0;
  while (nights.has(d.toDateString())) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

function addCheck([lng, lat], status) {
  const before = levelFor(checks.length);
  checks.push({ lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), status, at: new Date().toISOString() });
  store.save('checks', checks);
  afterChecksChanged();
  const after = levelFor(checks.length);
  if (after && after !== before) {
    toast(`${lumi(44, 'cheer')}<span><b>New badge: ${after.name}!</b> ${checks.length} spot${checks.length === 1 ? '' : 's'} checked.</span>`, 4200);
  } else {
    toast(`${lumi(36, 'cheer')}<span>Thanks! Marked as <b>${status}</b>. The map updated.</span>`);
  }
}

function afterChecksChanged() {
  applyChecks(g, checks);
  if (mapReady) {
    map.getSource('paths').setData(pathsGeojson());
    map.getSource('checks').setData(checksGeojson());
  }
  renderChecks();
  renderHonesty();
  update();
}

function renderChecks() {
  const el = $('#checks-card');
  const n = checks.length;
  if (!n) {
    el.innerHTML = `
      <div class="checks-head">${lumi(60)}<div><h3>Night checks</h3>
        <p>Out after dark? Tap a path on the map and tell Lumi if it's lit. Your checks color the map right away.</p></div></div>`;
    return;
  }
  const level = levelFor(n);
  const next = LEVELS.find((l) => l.at > n);
  const prevAt = level?.at ?? 0;
  const progress = next ? ((n - prevAt) / (next.at - prevAt)) * 100 : 100;
  const meters = g.edges.filter((e) => e.mine).reduce((s, e) => s + e.length_m, 0);
  const streak = nightStreak();
  el.innerHTML = `
    <div class="checks-head">${lumi(60, 'cheer')}<div><h3>${level ? esc(level.name) : 'Night checks'}</h3>
      <p>${next ? `${next.at - n} more to reach <b>${next.name}</b>` : 'You reached the top badge. Thank you!'}</p></div></div>
    <div class="progress" role="progressbar" aria-label="Progress to next badge" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"><i style="width:${progress}%"></i></div>
    <div class="streaks">
      <div class="streak ${streak ? 'hot' : ''}">${icon('flame')}<b>${streak}</b><span>night streak</span></div>
      <div class="streak">${icon('check')}<b>${n}</b><span>spot${n === 1 ? '' : 's'} checked</span></div>
      <div class="streak">${icon('walk')}<b>${fmtDist(meters)}</b><span>path verified</span></div>
    </div>
    <div class="popup-actions">
      <button class="chip" id="download-checks">${icon('download')}Download CSV</button>
      <button class="chip ghost" id="undo-check">Undo last</button>
    </div>
    <p class="fine">Saved on this device. To share them with your team, add the rows to <code>data/verified_lighting.csv</code> and run <code>npm run data</code>.</p>`;
  $('#download-checks').addEventListener('click', downloadChecks);
  $('#undo-check').addEventListener('click', () => {
    checks.pop();
    store.save('checks', checks);
    afterChecksChanged();
    toast('Removed your last check.');
  });
}

// The same columns as data/verified_lighting.csv: lat,lng,status,note
function downloadChecks() {
  const rows = checks.map((c) => `${c.lat},${c.lng},${c.status},checked ${toInputValue(new Date(c.at)).replace('T', ' ')}`);
  const blob = new Blob([['lat,lng,status,note', ...rows].join('\n') + '\n'], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'my-night-checks.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Data honesty ----------

function renderHonesty() {
  const counts = Object.fromEntries(SOURCES.map((s) => [s, 0]));
  for (const e of g.edges) counts[e.lighting_source] = (counts[e.lighting_source] ?? 0) + 1;
  const mine = g.edges.filter((e) => e.mine).length;
  $('#source-counts').innerHTML = Object.entries(counts)
    .map(([s, n]) => `<dt>${s}</dt><dd>${n.toLocaleString()} <small>(${Math.round((n / g.edges.length) * 100)}%${
      s === 'verified' && mine ? `, ${mine} from your checks` : ''})</small></dd>`)
    .join('');
  const countBy = (list) => list.reduce((m, x) => ({ ...m, [x.source]: (m[x.source] ?? 0) + 1 }), {});
  const blueBy = countBy(g.blueLights);
  const placesBy = countBy(g.buildings);
  $('#other-counts').innerHTML = `
    <dt>Blue Lights</dt><dd>${g.blueLights.length} <small>(${blueBy.osm ?? 0} OpenStreetMap, ${blueBy.csv ?? 0} our list)${
      useBlueLights ? '' : ' · too few to steer routes'}</small></dd>
    <dt>Places with hours</dt><dd>${g.buildings.length} <small>(${placesBy.osm ?? 0} OpenStreetMap, ${placesBy.csv ?? 0} our list)</small></dd>
    <dt>Searchable places</dt><dd>${g.places.length}</dd>`;
}

// ---------- Sharing (the route lives in the link's #hash, which is never sent to a server) ----------

function hashString() {
  const p = new URLSearchParams();
  const pt = (s) => `${s.lat.toFixed(6)},${s.lng.toFixed(6)},${s.name}`;
  if (state.start) p.set('from', pt(state.start));
  if (state.end) p.set('to', pt(state.end));
  p.set('t', whenInput.value);
  p.set('r', state.selected);
  return p.toString();
}
function writeHash() {
  history.replaceState(null, '', `#${hashString()}`);
}
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const pt = (v) => {
    if (!v) return null;
    const [lat, lng, ...name] = v.split(',');
    const out = { lat: Number(lat), lng: Number(lng), name: name.join(',') || 'Dropped pin' };
    return Number.isFinite(out.lat) && Number.isFinite(out.lng) ? out : null;
  };
  return { from: pt(p.get('from')), to: pt(p.get('to')), t: p.get('t'), r: p.get('r') };
}

$('#share-btn').addEventListener('click', async () => {
  const r = state.routes;
  if (!r) return;
  const x = r.same || state.selected === 'lit' ? r.lx : r.fx;
  const url = `${location.origin}${location.pathname}#${hashString()}`;
  const text = `I'm walking from ${state.start.name} to ${state.end.name}: about ${Math.round(x.minutes)} min, ${Math.round(x.litPct)}% lit. Here's my route on Lit:`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'My walk on Lit', text, url });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast(`${icon('share')}<span>Link copied. Send it to a friend so they know your route.</span>`);
  } catch {
    toast("Couldn't copy the link. You can copy it from the address bar.");
  }
});

// ---------- Toasts, dialogs, welcome ----------

let toastTimer = null;
function toast(html, ms = 3200) {
  const el = $('#toast');
  el.innerHTML = html;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

$('#help-btn').addEventListener('click', () => { $('#help').hidden = false; });
function closeModal(m) {
  m.hidden = true;
  if (m.id === 'welcome') store.save('welcomed', true);
}
for (const overlay of document.querySelectorAll('.modal')) {
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay || ev.target.closest('[data-close]')) closeModal(overlay);
  });
}
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  if (!searchEl.hidden) closeSearch();
  for (const m of document.querySelectorAll('.modal:not([hidden])')) closeModal(m);
  if (state.choosing) endChoosing();
});

// ---------- Start up ----------

try {
  g = await loadGraph();
} catch (err) {
  $('#splash').innerHTML = `${lumi(100)}<p>Couldn't load the map data.<br><small>${esc(err.message)}</small></p>`;
  throw err;
}
useBlueLights = g.blueLights.length >= CONFIG.blueLightMinForRouting;
buildingsByName = new Map(g.buildings.map((b) => [b.name, b]));
applyChecks(g, checks);

// A shared link (#from=...&to=...) wins over the default Collegetown -> Robert Purcell route.
const fromHash = readHash();
whenInput.value = fromHash.t && !Number.isNaN(new Date(fromHash.t).getTime()) ? fromHash.t : toInputValue(new Date());
if (fromHash.r === 'fastest' || fromHash.r === 'lit') state.selected = fromHash.r;
const [defStart, defEnd] = g.defaultRoute;
const from = fromHash.from && insideArea(g, fromHash.from) ? fromHash.from : { ...defStart, name: shortName(defStart.name) };
const to = fromHash.to && insideArea(g, fromHash.to) ? fromHash.to : { ...defEnd, name: shortName(defEnd.name) };
setPoint('start', from, from.name, 'place');
setPoint('end', to, to.name, 'place');

renderHonesty();
renderChecks();
update();
whenMapReady();
fitRoutes();

$('#splash').classList.add('hide');
setTimeout(() => $('#splash').remove(), 600);
if (!store.load('welcomed', false)) $('#welcome').hidden = false;
