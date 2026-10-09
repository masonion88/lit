// Every tunable number, color, and link lives here.

export const CONFIG = {
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
  // With only a handful of phones mapped, "far from a Blue Light" would just pull the Lit
  // route toward whichever few happen to be mapped. Below this count it's shown, not used.
  blueLightMinForRouting: 10,
  // The "walk with a friend" card only shows for a dark stretch at least this long.
  friendMinStretchM: 100,
  // A check you make in the app counts for paths this close (same as the build script).
  checkRadiusM: 20,
  // Clock slider: minutes after 6 pm (0 = 6 pm, 600 = 4 am).
  clock: { startHour: 18, maxMin: 600, stepMin: 15 },
  // Late-night TCAT window from Cornell's student safety page, as minutes after midnight.
  lateBus: { from: 18 * 60 + 30, until: 2 * 60 + 30 },
  // Shown in search before you type anything (only if they exist in places.json).
  popular: [
    'Olin Library',
    'Willard Straight Hall',
    'Robert Purcell Community Center',
    'Uris Library',
    'Collegetown Bagels',
    'Mann Library',
  ],
};

export const LINKS = {
  blueLights: 'https://cupolice.cornell.edu/safety-security/blue-light-services',
  studentSafety: 'https://scl.cornell.edu/families/cornell-family-resource-hub/student-safety-and-support',
};

export const SOURCES = ['verified', 'osm', 'mapillary', 'estimated', 'unknown'];
export const SOURCE_TEXT = {
  verified: 'Checked in person after dark.',
  osm: "OpenStreetMap: a path's <code>lit</code> tag, or a mapped street lamp within 25 m.",
  mapillary: 'Seen in Mapillary street-level night photos.',
  estimated: 'Our guess from the path type and nearby woods. Treat with care.',
  unknown: 'No information at all.',
};

export const COLORS = {
  lit: '#ffd60a',
  'likely lit': '#fff3a3',
  limited: '#fff3a3',
  'estimated lit': '#e9c46a',
  dark: '#a78bfa',
  'estimated dark': '#a78bfa',
  unknown: '#7b8090',
  fastest: '#4cc2ff',
  litRoute: '#ff7ab6',
  alt: '#8a90a0',
  blueLight: '#3b82f6',
  open: '#4ade80',
  closed: '#4b5563',
  start: '#34d399',
  end: '#ff5d5d',
};
export const LIGHTING_KEYS = ['lit', 'likely lit', 'limited', 'estimated lit', 'dark', 'estimated dark', 'unknown'];
export const LIT = new Set(['lit', 'likely lit', 'limited', 'estimated lit']);
export const DARK_OR_UNKNOWN = new Set(['dark', 'estimated dark', 'unknown']);

// Plain words for OSM path types, used in directions ("Turn left onto the footpath").
export const PATH_WORDS = {
  footway: 'footpath',
  path: 'path',
  steps: 'steps',
  pedestrian: 'walkway',
  service: 'service road',
  track: 'track',
  cycleway: 'bike path',
  residential: 'street',
  living_street: 'street',
  unclassified: 'road',
  tertiary: 'road',
  secondary: 'road',
  primary: 'main road',
};
