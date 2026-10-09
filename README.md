# Lit

Lit compares walking routes at night by the **physical environment** they pass through:
lighting, isolation, distance to Blue Light phones, and places that are open at that hour.
The demo area runs from Collegetown to Robert Purcell Community Center (North Campus) at Cornell.

It shows two routes side by side:

- **Fastest**: the shortest walk.
- **Lit**: a walk that, after sunset, prefers lit paths, avoids paths next to woods, and passes open places.

Each route card lists the tradeoffs: extra minutes, how much of the walk is lit, the longest
dark-or-unknown stretch, and which open places you pass.

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
2. Tap **Inspect**, tap the path you're standing on, then **It's lit** or **It's dark**.
   This copies a line like `42.447812,-76.484301,lit,checked 2026-10-09 22:15`.
3. Paste it as a new line in `data/verified_lighting.csv`.
4. Run `npm run data`. Paths within 20 m of that point become `verified`.

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
| Sunrise and sunset | Calculated with `suncalc` |
| Map tiles | OpenFreeMap |

## Limits

- Most paths are `estimated` (a guess from the path type), so the app labels them that way and
  draws them dashed.
- OpenStreetMap hours can be out of date. The Inspect card shows the original hours text.
- Only mapped Blue Lights are shown. There are more on campus.
- Lit can't tell you a route is risk-free. In an emergency call 911. Cornell Police
  non-emergency: 607-255-1111.

## How it's built

- `scripts/build-graph.mjs`: downloads OSM data, splits it into a walking graph, and gives
  each path a lighting value and a source.
- `src/main.js`: the web app (Vite, vanilla JavaScript, MapLibre, Turf). Routing is Dijkstra's
  algorithm. The Lit route multiplies walking time by penalties (dark, near woods) and bonuses
  (open place nearby) set in `CONFIG` at the top of the file.
- No backend and no database: everything runs in the browser.
