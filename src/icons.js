// Simple line icons (24 x 24, drawn with the current text color) and Lumi the firefly.

const PATHS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/>',
  swap: '<path d="M7 20V4M7 4L3 8M7 4l4 4M17 4v16M17 20l-4-4M17 20l4-4"/>',
  locate: '<circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="8"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/>',
  share: '<path d="M12 15V3M12 3L8 7M12 3l4 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/>',
  phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 005 5L15 12l5 2v4a2 2 0 01-2 2A16 16 0 013 5a2 2 0 012-2z"/>',
  moon: '<path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  tap: '<path d="M9 11V5.5a1.5 1.5 0 013 0V11m0-1.5a1.5 1.5 0 013 0V12m0-1a1.5 1.5 0 013 0v4a6 6 0 01-6 6h-1a6 6 0 01-5-2.7L4 15.5a1.5 1.5 0 012.5-1.6L9 16"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  flame: '<path d="M12 2.5c1 4 6 5.5 6 11a6 6 0 01-12 0c0-2.5 1.3-4 2.5-5 0 2 1 3.3 2.3 3.3 0-3.3-1.3-5.8 1.2-9.3z"/>',
  bus: '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M8 17v3M16 17v3"/><circle cx="8.5" cy="14" r=".6"/><circle cx="15.5" cy="14" r=".6"/>',
  building: '<path d="M4 21V5a1 1 0 011-1h9a1 1 0 011 1v16M15 9h4a1 1 0 011 1v11M3 21h18M8 8h3M8 12h3M8 16h3"/>',
  food: '<path d="M7 3v8a2 2 0 002 2v8M11 3v8a2 2 0 01-2 2M7 3v5M11 3v5M17 21V3c-2 1-3 4-3 8h3"/>',
  coffee: '<path d="M4 9h12v5a5 5 0 01-5 5H9a5 5 0 01-5-5V9zM16 10h1.5a2.5 2.5 0 010 5H16M8 3v3M12 3v3"/>',
  book: '<path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2V5zM4 19a2 2 0 012-2h13"/>',
  walk: '<circle cx="13" cy="4" r="2"/><path d="M9.5 21l2-6.5 3 2.5v4M8 12.5l2.5-4 4 1 2 4M11 8.5l-1 5.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  people: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20a6 6 0 0112 0M14.5 20a4.5 4.5 0 016.5-4"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
  // Turn arrows for directions.
  'turn-start': '<circle cx="12" cy="12" r="4"/><path d="M12 3v3M12 18v3"/>',
  'turn-straight': '<path d="M12 21V4M12 4L7 9M12 4l5 5"/>',
  'turn-left': '<path d="M17 21v-7a4 4 0 00-4-4H5M5 10l4-4M5 10l4 4"/>',
  'turn-right': '<path d="M7 21v-7a4 4 0 014-4h8M19 10l-4-4M19 10l-4 4"/>',
  'turn-slight-left': '<path d="M15 21v-7L7 6M7 6h6M7 6v6"/>',
  'turn-slight-right': '<path d="M9 21v-7l8-8M17 6h-6M17 6v6"/>',
  'turn-uturn': '<path d="M8 21V9a4 4 0 018 0v6M16 15l-3-3M16 15l3-3"/>',
  'turn-arrive': '<path d="M6 21V4M6 4h11l-2.5 4L17 12H6"/>',
};

export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? ''}</svg>`;
}

// Which icon to show for a place in search, by its OSM kind.
export function placeIcon(kind) {
  if (kind === 'bus_stop') return 'bus';
  if (kind === 'library') return 'book';
  if (['cafe', 'pastry'].includes(kind)) return 'coffee';
  if (['restaurant', 'fast_food', 'bar', 'pub', 'supermarket', 'convenience'].includes(kind)) return 'food';
  return 'building';
}

// Lumi, the app's firefly. `mood` is 'happy' (default) or 'cheer' (arms up, bigger glow).
let lumiCount = 0;
export function lumi(size = 96, mood = 'happy') {
  const id = `lumi-glow-${lumiCount++}`;
  const cheer = mood === 'cheer';
  return `
  <svg class="lumi ${cheer ? 'cheer' : ''}" width="${size}" height="${size}" viewBox="0 0 120 120" aria-hidden="true">
    <defs>
      <radialGradient id="${id}">
        <stop offset="0" stop-color="#fff2a8" stop-opacity="0.95"/>
        <stop offset="0.45" stop-color="#ffd23f" stop-opacity="0.45"/>
        <stop offset="1" stop-color="#ffc83d" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <circle class="lumi-glow" cx="60" cy="84" r="${cheer ? 36 : 30}" fill="url(#${id})"/>
    <g class="lumi-body">
      <ellipse cx="38" cy="50" rx="17" ry="10" fill="#dfe9ff" opacity="0.7" transform="rotate(-28 38 50)"/>
      <ellipse cx="82" cy="50" rx="17" ry="10" fill="#dfe9ff" opacity="0.7" transform="rotate(28 82 50)"/>
      <ellipse cx="60" cy="84" rx="17" ry="18" fill="#ffd84d"/>
      <ellipse cx="60" cy="88" rx="11" ry="10" fill="#fff3b0"/>
      <path d="M50 36 Q44 22 36 20" stroke="#3d3a6b" stroke-width="3.5" fill="none" stroke-linecap="round"/>
      <path d="M70 36 Q76 22 84 20" stroke="#3d3a6b" stroke-width="3.5" fill="none" stroke-linecap="round"/>
      <circle cx="36" cy="20" r="4.5" fill="#ffd84d"/>
      <circle cx="84" cy="20" r="4.5" fill="#ffd84d"/>
      <circle cx="60" cy="56" r="23" fill="#3d3a6b"/>
      <circle cx="51" cy="53" r="7" fill="#fff"/>
      <circle cx="69" cy="53" r="7" fill="#fff"/>
      <circle cx="52" cy="54" r="3.6" fill="#1d1b3a"/>
      <circle cx="70" cy="54" r="3.6" fill="#1d1b3a"/>
      <circle cx="53.3" cy="52.4" r="1.3" fill="#fff"/>
      <circle cx="71.3" cy="52.4" r="1.3" fill="#fff"/>
      <ellipse cx="44" cy="63" rx="4" ry="2.5" fill="#ff8fb5" opacity="0.7"/>
      <ellipse cx="76" cy="63" rx="4" ry="2.5" fill="#ff8fb5" opacity="0.7"/>
      <path d="${cheer ? 'M52 63 Q60 73 68 63 Z' : 'M53 64 Q60 70 67 64'}" stroke="#fff" stroke-width="2.5" fill="${cheer ? '#ff8fb5' : 'none'}" stroke-linecap="round"/>
    </g>
  </svg>`;
}
