# Atlas

One map for every map project. Base project #111.

`./serve.sh` → http://localhost:8102 (add `--lan` for a phone on the wifi). The page there is the
test run: the shared base map, the whole Omaha layer catalog, and one tract join (households per acre).

## The split

| Part | Lives in | Built |
|---|---|---|
| Base map: muted / street / aerial, light + dark, every colour editable | `kit/basemap.mjs`, `kit/themes.mjs` | once |
| Shared layers: live county/city GIS + prepared boundaries | `kit/catalog/omaha.mjs`, `kit/geo/` | once, grows |
| Project overlays: a project's own data, joined or pinned onto the above | the project | per project |

## Using it in a project

```bash
tools/sync.sh "../Street Notice"          # copies kit/ → "../Street Notice/vendor/atlas/"
tools/sync.sh "../Street Notice" --check  # is it behind?
```

```html
<link rel="stylesheet" href="vendor/atlas/atlas.css">
<div id="map" style="height: 100vh"></div>
<script type="module">
import { createMap } from './vendor/atlas/atlas.mjs';
import * as omaha from './vendor/atlas/catalog/omaha.mjs';

const atlas = await createMap('map', {
	region: omaha.region,
	layers: [
		...omaha.pick('signals', 'reports', 'ndot'),
		{ id: 'issues', name: 'Issues', kind: 'points', items: ISSUES,
		  lngLat: (it) => [it.location.lng, it.location.lat],
		  props: (it) => ({ sev: it.level }),
		  style: { colorBy: { prop: 'sev', values: { S1: '#…', S2: '#…' } } },
		  label: (p, it) => [it.title, it.observed], on: true }
	]
});
</script>
```

Serve the project with `python3 vendor/atlas/serve.py --port <its port>` so panel edits save to its
`data/map-style.json`. Any other server still works; edits then stay in the browser until **Export style**.

Each project keeps its own copy of the kit, pinned by `kit/VERSION`, so changing the kit never
breaks a page that hasn't been synced, and a published project needs nothing else.

## Layer spec

`kind`: `arcgis` (live, per viewport, `minZoom`-gated) · `geojson` (url or object) · `points`
(`items` + `lngLat` + `props`) · `choropleth` (`data` boundaries + `join: { key, rows, rowKey, value }`
+ `breaks`). `geometry`: `point` / `line` / `fill`. `label(props, row|item)` returns a title or
`[title, …lines]`. `source`, `sourceUrl`, `asOf`, `notes` show in the panel.

Style is plain data so the panel can edit it and the JSON file can hold it: `color` (hex, `slot:N`
palette slot, or `base:<token>`), `colorBy`, `opacity`, `radius` / `width`, `dash`
(solid/dash/dot/long), `outline`, `place` (`streets` / `labels` / `top`), `breaks`, `palette`.

## What the panel does

- Switch a layer on: it fades in, and its marks swell and settle once the data lands.
- Hover a layer's row: every other overlay fades to 12%, so you can see which marks are its.
- **Solo** shows only that layer; press again to bring the rest back.
- Each row shows what's in view (`214 in view`), `zoom in ›` for layers that only load close in,
  and flags a server cap.
- Expand a row: colour (or each category / class), opacity, size, line style, halo, draw order,
  breaks for shading, reset. Source and the date the endpoint was checked are at the bottom.
- Base map: style, **Base map strength** (washes the map toward the land colour so overlays read
  louder), the full colour token set per style and mode, aerial flight year + imagery sliders.
- Share links: the address bar holds view, layers and base (`#14/41.25/-95.93&on=signals&base=aerial`).

## Decisions (2026-10-22)

- MapLibre GL 6.13.0, ESM only (pages load Atlas with `<script type="module">`).
- Base tiles from OpenFreeMap: free, no key, allowed for public sites. Not tile.openstreetmap.org.
- Aerial is Douglas County's own flights: 2025/2024/2022/2020 to zoom 22, 1958 to zoom 20.
  All send CORS headers (MapLibre needs that; Leaflet didn't).
- Overlay colours are the validated categorical palette in fixed slots; tract shading uses the
  sequential blue ramp (flipped in dark mode), so the catalog keeps blue off point layers.
- Panel colours are the Admin design-system tokens.

## Checked

Headless Chromium (software rendering): base map in all three styles, both modes; live layers
load and count; pulse, row highlight, solo, tooltips, colour edit → `data/map-style.json`.
Real Chrome on the Mac Pro gets **hardware WebGL2** (ANGLE, Mesa, AMD JUNIPER, OpenGL 4.6).
Frame timing on the real GPU not measured yet: the panel footer shows ms/frame after a pan.

Open: with the phone bottom sheet expanded, headless screenshots show the map above it blank;
likely a software-renderer artefact, unconfirmed on a real phone.

## Next (base phases)

1. Move Street Notice onto the kit (its `data/overlays.js` is now `kit/catalog/omaha.mjs`).
2. UtilityTrack's burden map on a real base map (choropleth over `omaha.GEO.tracts2024`).
3. Layer browser page + more boundaries (council and legislative districts, OPPD/MUD areas).
4. First public build.
