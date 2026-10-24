#!/usr/bin/env python3
"""Census tracts for the Omaha region → kit/geo/omaha-tracts-2024.geojson, plus the demo density rows.

Boundaries come from the Census cartographic file UtilityTrack already keeps
(cb_2024_31_tract_500k.zip, Nebraska). Kept: Douglas (055) + Sarpy (153), the two
counties UtilityTrack profiles. Shapes are simplified to ~20 m and rounded to 5
decimals (~1 m) so the file stays small enough to ship in every project.

The boundary file carries geometry + identity only (GEOID, name, county, land
acres). Numbers belong to the project that maps them and join on GEOID at runtime;
data/demo-density.json is the one Atlas ships for its own test page.

Needs pyshp + shapely; UtilityTrack's venv has both:
  "../UtilityTrack/.venv/bin/python" tools/build_tracts.py
"""
import json
from pathlib import Path

import shapefile
from shapely.geometry import mapping, shape

ROOT = Path(__file__).resolve().parent.parent
UT = ROOT.parent / "UtilityTrack"
SRC = UT / "data" / "geo" / "cb_2024_31_tract_500k.zip"
ACS = UT / "data" / "acs_tracts.json"
OUT = ROOT / "kit" / "geo" / "omaha-tracts-2024.geojson"
DEMO = ROOT / "data" / "demo-density.json"
COUNTIES = {"055": "Douglas", "153": "Sarpy"}
SQM_PER_ACRE = 4046.8564


def rounded(geom, nd=5):
    def r(c):
        return [round(c[0], nd), round(c[1], nd)]
    g = mapping(geom)
    if g["type"] == "Polygon":
        return {"type": "Polygon", "coordinates": [[r(c) for c in ring] for ring in g["coordinates"]]}
    return {"type": "MultiPolygon",
            "coordinates": [[[r(c) for c in ring] for ring in poly] for poly in g["coordinates"]]}


features = []
with shapefile.Reader(str(SRC)) as sf:
    for sr in sf.shapeRecords():
        p = sr.record.as_dict()
        if p["COUNTYFP"] not in COUNTIES:
            continue
        geom = shape(sr.shape.__geo_interface__).buffer(0).simplify(0.0002, preserve_topology=True)
        features.append({"type": "Feature", "geometry": rounded(geom), "properties": {
            "GEOID": p["GEOID"], "name": f"Tract {p['NAME']}", "county": COUNTIES[p["COUNTYFP"]],
            "land_acres": round(p["ALAND"] / SQM_PER_ACRE, 1)}})
features.sort(key=lambda f: f["properties"]["GEOID"])
OUT.write_text(json.dumps({"type": "FeatureCollection", "name": "omaha-tracts-2024",
                           "attribution": "U.S. Census Bureau, 2024 cartographic boundary file (500k)",
                           "features": features}, separators=(",", ":")))

acs = json.loads(ACS.read_text())
acres = {f["properties"]["GEOID"]: f["properties"]["land_acres"] for f in features}
rows = []
for t in sorted(acs["tracts"], key=lambda t: t["geoid"]):
    geoid = t["geoid"]
    a = acres.get(geoid)
    hh = t.get("households")
    if a and hh is not None:
        rows.append({"geoid": geoid, "households": hh, "population": t.get("population"),
                     "hh_per_acre": round(hh / a, 2)})
DEMO.write_text(json.dumps({"source": "ACS 2024 5-year (via UtilityTrack data/acs_tracts.json) / Census land area",
                            "rows": rows}, indent=1))
print(f"{len(features)} tracts → {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB); {len(rows)} demo rows")
