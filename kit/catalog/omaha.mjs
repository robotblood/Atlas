// Omaha region + the shared layer catalog. A project picks layers by id:
//   layers: [...omaha.pick('signals', 'reports', 'ndot'), myLayer]
//
// Every ArcGIS endpoint here answered f=geojson with CORS for a localhost
// page when checked (asOf). Server of record is Douglas County GIS
// (dcgis.org), which also hosts the City of Omaha Public Works layers; NDOT
// layers come from gis.ne.gov. Moved over from Street Notice's
// data/overlays.js (2026-08-16), restyled on the Atlas palette.
//
// Colours are fixed palette slots, so a layer keeps its colour whatever else
// is on. Blue (slot 1) is kept off the point layers because tract shading uses
// the blue ramp; it goes to a thick dashed line instead. Points and lines also
// differ by size / dash, so identity never rests on colour alone.

const DC = 'https://dcgis.org/server/rest/services';
const DC_SRC = 'Douglas County GIS (City of Omaha Public Works)';
const geo = (f) => new URL(`../geo/${f}`, import.meta.url).href;

export const region = {
	id: 'omaha',
	name: 'Omaha metro',
	center: [-95.99, 41.255],
	zoom: 11.2,
	aerials: [
		{ id: '2025', label: '2025 county flight', maxzoom: 22, url: `${DC}/2025_Douglas_County_NE_Imagery/MapServer/tile/{z}/{y}/{x}`, attribution: 'Douglas County GIS 2025 imagery' },
		{ id: '2024', label: '2024 county flight', maxzoom: 22, url: `${DC}/2024_Douglas_County_NE_Imagery/MapServer/tile/{z}/{y}/{x}`, attribution: 'Douglas County GIS 2024 imagery' },
		{ id: '2022', label: '2022 county flight', maxzoom: 22, url: `${DC}/2022_Douglas_County_NE_Imagery/MapServer/tile/{z}/{y}/{x}`, attribution: 'Douglas County GIS 2022 imagery' },
		{ id: '2020', label: '2020 county flight', maxzoom: 22, url: `${DC}/2020_Douglas_County_NE_Imagery/MapServer/tile/{z}/{y}/{x}`, attribution: 'Douglas County GIS 2020 imagery' },
		{ id: '1958', label: '1958 Omaha', maxzoom: 20, url: `${DC}/Omaha_NE_1958_Imagery/MapServer/tile/{z}/{y}/{x}`, attribution: 'Douglas County GIS, 1958 Omaha imagery' }
	]
};

// Prepared boundaries shipped with the kit (built by tools/build_tracts.py).
export const GEO = {
	tracts2024: geo('omaha-tracts-2024.geojson')
};

const date = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : null);

export const layers = [
	{
		id: 'signals', name: 'Traffic signals', group: 'Traffic', kind: 'arcgis', geometry: 'point',
		url: `${DC}/Hosted/Master_Signal_Intersections/FeatureServer/0`, minZoom: 13,
		fields: ['facilityid', 'type', 'status'],
		label: (p) => ['Signal', [p.type, p.status].filter(Boolean).join(' · ')],
		style: { color: 'slot:8', radius: 5 },
		source: DC_SRC, asOf: '2026-08-16',
		notes: 'Master signalized-intersection record (975): type, status, district, maintenance agreement.'
	},
	{
		id: 'lpi', name: 'Walk signals (LPI)', group: 'Traffic', kind: 'arcgis', geometry: 'point',
		url: `${DC}/Hosted/Traffic_Signal_Leading_Ped_Int/FeatureServer/0`, minZoom: 13,
		fields: ['signal_name', 'number_of_lpi', 'year_installed'],
		label: (p) => [p.signal_name || 'Leading pedestrian interval',
			[p.number_of_lpi && `${p.number_of_lpi} LPI`, p.year_installed && `installed ${p.year_installed}`].filter(Boolean).join(' · ')],
		style: { color: 'slot:3', radius: 4 },
		source: DC_SRC, asOf: '2026-08-16',
		notes: 'Intersections with a leading pedestrian interval (431). Ped signal heads themselves are tables with no geometry.'
	},
	{
		id: 'signs', name: 'Sign posts', group: 'Traffic', kind: 'arcgis', geometry: 'point',
		url: `${DC}/Traffic/Traffic_Sign_Post_and_Signs_Public_View/MapServer/0`, minZoom: 17,
		fields: ['POST_TYPE', 'STATUS', 'OWNED_BY', 'LOCATION', 'DATE_INSP'],
		label: (p) => [p.POST_TYPE || 'Sign post', [p.STATUS, p.OWNED_BY && `owner ${p.OWNED_BY}`].filter(Boolean).join(' · '),
			p.DATE_INSP && `inspected ${date(p.DATE_INSP)}`],
		style: { color: 'slot:5', radius: 3 },
		source: DC_SRC, asOf: '2026-08-16',
		notes: 'City sign-post inventory, 79,723 posts with status, owner and last inspection. Only loads close in.'
	},
	{
		id: 'lights', name: 'Street lights', group: 'Streets', kind: 'arcgis', geometry: 'point',
		url: `${DC}/Hosted/City_of_Omaha_Street_Lights/FeatureServer/0`, minZoom: 15,
		fields: ['name'],
		label: (p) => [p.name || 'Street light', 'OPPD-owned, leased to the city'],
		style: { color: 'slot:4', radius: 3.5 },
		source: DC_SRC, asOf: '2026-08-16',
		notes: '6,852 points. OPPD owns and maintains them under lease, so outages are an OPPD report by pole tag.'
	},
	{
		id: 'bike', name: 'Bike lanes', group: 'Streets', kind: 'arcgis', geometry: 'line',
		url: `${DC}/Hosted/Bike_Lanes_viewer/FeatureServer/0`, minZoom: 11,
		fields: ['location', 'treatment', 'status'],
		label: (p) => [p.location || 'Bike lane', [p.treatment, p.status].filter(Boolean).join(' · ')],
		style: { color: 'slot:6', width: 3 },
		source: DC_SRC, asOf: '2026-08-16',
		notes: 'City on-street bike facilities (58 segments) with treatment.'
	},
	{
		id: 'nosidewalk', name: 'No sidewalk', group: 'Streets', kind: 'arcgis', geometry: 'line',
		url: `${DC}/Hosted/No_Sidewalks_Public_View/FeatureServer/0`, minZoom: 13,
		fields: ['objectid'],
		label: () => ['No sidewalk', 'city gap layer'],
		style: { color: 'slot:7', width: 2.5, dash: 'dash' },
		source: DC_SRC, asOf: '2026-08-16',
		notes: 'Street segments the city records as lacking sidewalks (5,351). There is no published sidewalk layer itself.'
	},
	{
		id: 'ndot', name: 'State highways (NDOT)', group: 'Streets', kind: 'arcgis', geometry: 'line',
		url: 'https://gis.ne.gov/Enterprise/rest/services/Highways_DOT_NE/FeatureServer/5', minZoom: 9,
		fields: ['RouteID', 'HwyLabel', 'HwyType'],
		label: (p) => [p.HwyLabel || p.RouteID || 'State route', 'NDOT jurisdiction, not the city'],
		style: { color: 'slot:1', width: 4, dash: 'long' },
		source: 'Nebraska DOT', sourceUrl: 'https://gis.ne.gov/', asOf: '2026-08-16',
		notes: 'A defect on one of these is NDOT’s to fix, not the city’s.'
	},
	{
		id: 'reports', name: 'City reports, 12 months', group: 'Service requests', kind: 'arcgis', geometry: 'point',
		url: `${DC}/Cityworks/Mayors_Hotline_HubPage/MapServer/1`, minZoom: 14,
		fields: ['REQUESTID', 'DESCRIPTION', 'STATUS', 'DATETIMEINIT', 'DATETIMECLOSED'],
		label: (p) => [p.DESCRIPTION || 'Service request', [p.STATUS, p.REQUESTID && `#${p.REQUESTID}`].filter(Boolean).join(' · '),
			[date(p.DATETIMEINIT) && `opened ${date(p.DATETIMEINIT)}`, date(p.DATETIMECLOSED) && `closed ${date(p.DATETIMECLOSED)}`].filter(Boolean).join(' · ')],
		style: { color: 'slot:2', radius: 4.5 },
		source: 'Douglas County GIS (Cityworks / Mayor’s Hotline)', asOf: '2026-08-16',
		notes: 'Every Mayor’s Hotline request from the last 12 months (57,845), with opened and closed dates.'
	},
	{
		id: 'tracts', name: 'Census tracts', group: 'Boundaries', kind: 'geojson', geometry: 'fill',
		data: GEO.tracts2024,
		label: (p) => [p.name, `${p.county} County`, `${Math.round(p.land_acres).toLocaleString()} acres of land`],
		style: { color: 'base:label', opacity: 0, width: 0.8, outline: true },
		source: 'U.S. Census Bureau, 2024 cartographic boundaries', sourceUrl: 'https://www2.census.gov/geo/tiger/GENZ2024/shp/',
		asOf: '2026-10-22',
		notes: 'Douglas + Sarpy (210 tracts). Projects join their own numbers to these on GEOID.'
	}
];

export function pick(...ids) {
	return ids.map((id) => {
		const l = layers.find((x) => x.id === id);
		if (!l) throw new Error(`atlas: no '${id}' in the Omaha catalog`);
		return l;
	});
}
