# Lit

Lit compares walking routes at night by the **physical environment** they pass through:
lighting, isolation, distance to Blue Light phones, and places that are open at that hour.
The demo area runs from Collegetown to Robert Purcell Community Center (North Campus) at Cornell.

It shows two routes side by side:

- **Fastest**: the shortest walk.
- **Lit**: a walk that, after sunset, prefers lit paths, avoids paths next to woods, and passes open places.

Each route card lists the tradeoffs: extra minutes, how much of the walk is lit, the longest
dark-or-unknown stretch, and which open places you pass.

## What you can do

- **Search** 360 campus and Collegetown places ("Where to?"), use your location, or long-press the map to drop a pin. Pins can be dragged.
- **Compare two routes.** Each card has a lighting strip (the route laid flat, colored by lighting). The chosen route is drawn on the map filled in with its own lighting; tap the grey one to switch.
- **Follow directions** step by step, each with how lit it is. Tap a step to zoom to it.
- **Scrub through the night** with the clock slider and watch the Lit route and open places change.
- **Tap anything on the map** (a path, a place, a Blue Light) to see where its data comes from.
- **Save Home and favorites** for one-tap "Take me home".
- **Share your route** with a friend. The route lives in the link itself; nothing is stored on a server.
- **Check paths at night.** Tell Lumi (the firefly) whether a path is lit. Your checks recolor the map right away and earn badges and night streaks.
- **Get help** from the red Help button: call 911, Cornell Police, Blue Light and Rave Guardian info.

## Principles

- **No crime data, ever.** Only lighting, isolation, Blue Light distance, and open places.
- **Never says "safe."** Lit shows tradeoffs and leaves the choice to you.
- **Every lighting value has a source:** `verified`, `osm`, `mapillary`, `estimated`, or `unknown`.
  Tap **Inspect**, then any path, to see where its value comes from.

## Run it

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
```

```bash
npm run dev
```

Then open the address it prints (usually http://localhost:5173).

## Rebuild the data

`public/graph.json` and `public/buildings.json` are already checked in. To rebuild them:

```bash
npm run data
```

Downloads from Nominatim and Overpass are cached in `data/raw/`, so running it again is fast
and doesn't hit those servers.

## Add what you checked in person

Our own checks are the most trusted source. To add them:

1. Walk the route after dark with the app open.
2. Tap the path you're standing on, then **It's lit** or **It's dark**. The map updates on your
   device right away.
3. In the **Night checks** card, tap **Download CSV**. Each row looks like
   `42.447812,-76.484301,lit,checked 2026-10-09 22:15`.
4. Add the rows to `data/verified_lighting.csv` and run `npm run data`. Paths within 20 m of each
   point become `verified` for everyone.

Two other files work the same way:

- `data/bluelights.csv` (`name,lat,lng`): Blue Light phones. Only 2 are mapped in
  OpenStreetMap so far, so Lit shows Blue Light distance on the cards but doesn't let it change
  the route until at least 10 are known.
- `data/buildings.csv`: places and their hours (`mon_open,mon_close,...`, as `HH:MM`). A row here
  replaces OpenStreetMap's hours for a place with the same name.

## Where the data comes from

| What | Source |
| --- | --- |
| Paths, `lit` tags, street lamps, woods | OpenStreetMap via Overpass |
| Blue Light phones | OpenStreetMap `emergency=phone`, plus `data/bluelights.csv` |
| Opening hours | OpenStreetMap `opening_hours`, plus `data/buildings.csv` |
| Searchable places | OpenStreetMap named buildings, amenities and bus stops |
| Sunrise and sunset | Calculated with `suncalc` |
| Map tiles | OpenFreeMap |

## Limits

- Most paths are `estimated` (a guess from the path type), so the app labels them that way and
  draws them dashed.
- OpenStreetMap hours can be out of date. The Inspect card shows the original hours text.
- Only mapped Blue Lights are shown. There are more on campus.
- A night check marks every path segment within 20 m. OSM segments can be long, so one check
  can verify a few hundred meters.
- Home, favorites and night checks are saved only in your browser.
- Lit can't tell you a route is risk-free. In an emergency call 911. Cornell Police
  non-emergency: 607-255-1111.

## How it's built

- `scripts/build-graph.mjs`: downloads OSM data, splits it into a walking graph, and gives
  each path a lighting value and a source.
- `src/`: the web app (Vite, vanilla JavaScript, MapLibre, Turf), one job per file:
  - `config.js`: every tunable number, color and link. The Lit route multiplies walking time by
    penalties (dark, near woods) and bonuses (open place nearby) set here.
  - `routing.js`: Dijkstra's algorithm, route stats, directions, the lighting strip.
  - `graph.js`: loads the data files and applies your night checks.
  - `time.js`: opening hours, sunrise and sunset.
  - `main.js`: the page, the map, and everything you tap.
  - `sheet.js` (the drag-up panel), `icons.js` (icons and Lumi), `store.js` (saved settings).
- No backend and no database: everything runs in the browser.
