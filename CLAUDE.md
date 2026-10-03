# Lit: project rules
- Hackathon project, deadline Sunday Oct 4, 8:30am EDT. I'm a beginner: explain each step in plain English before doing it. Keep everything simple.
- Stack: Node.js only. Data script in scripts/ (plain ES modules, run with node). Web app: Vite with vanilla JavaScript (no React, no TypeScript), using maplibre-gl, @turf/turf, and suncalc. No backend, no database.
- Map tiles: OpenFreeMap (free, no API key).
- No crime data, ever. Only the physical environment: lighting, isolation, distance to Blue Light phones, buildings open at that hour.
- Never label a route "safe." Show tradeoffs instead.
- Every lighting value has a source: verified, osm, mapillary, estimated, or unknown.
- Secrets go in .env and are never committed.
- Cache anything downloaded from Overpass, Nominatim, or Mapillary in data/raw/ so we don't download it twice.
- After each working step: run it, tell me how to check it, and make a git commit.
