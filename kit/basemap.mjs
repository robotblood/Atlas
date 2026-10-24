// The base map: one MapLibre style built from colour tokens, so every project
// gets the same map and recolours it without touching a style file.
//
// Vector tiles: OpenFreeMap (OpenMapTiles schema, free, no key). Aerial: any
// {z}/{y}/{x} raster the region lists (Douglas County's own ortho flights).
// Every layer carries metadata naming the token behind each paint property,
// so a colour edit is a setPaintProperty call, never a style reload.

import { PRESETS, AERIAL_TOKENS } from './themes.mjs';

const OFM = 'https://tiles.openfreemap.org';
export const ATTRIBUTION =
	'<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> · ' +
	'© <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> · ' +
	'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

// Where overlays slot in. Fills go under the streets (the grid stays
// readable through shading), lines go under the labels, points on top.
// Each overlay can change this in the panel ("Draw").
export const LABELS_FROM = 'base-label-water';
export const STREETS_FROM = 'base-path';

const NAME = ['coalesce', ['get', 'name_en'], ['get', 'name']];
const isLine = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
const isPoly = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];
const cls = (...c) => ['match', ['get', 'class'], c, true, false];
const zw = (pairs) => ['interpolate', ['exponential', 1.4], ['zoom'], ...pairs.flat()];

// group decides visibility under the aerial preset (see applyBase)
// alpha: the layer's own opacity before "base map strength" scales it
function L(id, type, group, def, tokens, alpha = 1) {
	const out = { id, type, ...def, metadata: { 'atlas:group': group, 'atlas:tokens': tokens, 'atlas:alpha': alpha } };
	for (const k of Object.keys(out)) if (out[k] == null) delete out[k];
	return out;
}

export function buildStyle(region) {
	const src = { source: 'omt' };
	const layers = [
		L('base-land', 'background', 'fill', {}, { 'background-color': 'land' }),
		L('base-wood', 'fill', 'fill', { ...src, 'source-layer': 'landcover',
			filter: ['all', isPoly, cls('wood', 'grass', 'wetland')] }, { 'fill-color': 'wood' }, 0.8),
		L('base-park', 'fill', 'fill', { ...src, 'source-layer': 'park', filter: isPoly }, { 'fill-color': 'park' }),
		L('base-water', 'fill', 'fill', { ...src, 'source-layer': 'water',
			filter: ['all', isPoly, ['!=', ['get', 'brunnel'], 'tunnel']] }, { 'fill-color': 'water' }),
		L('base-waterway', 'line', 'fill', { ...src, 'source-layer': 'waterway', filter: isLine,
			paint: { 'line-width': zw([[8, 0.5], [18, 3]]) } }, { 'line-color': 'water' }),
		L('base-building', 'fill', 'fill', { ...src, 'source-layer': 'building', minzoom: 13.5 },
			{ 'fill-color': 'building', 'fill-outline-color': 'casing' })
	];

	// aerial rasters sit over the vector fills: outside the flight area the
	// muted map still shows, inside it the imagery wins
	const sources = {
		omt: { type: 'vector', url: `${OFM}/planet`, attribution: ATTRIBUTION }
	};
	for (const a of region.aerials || []) {
		sources[`aerial-${a.id}`] = {
			type: 'raster', tiles: [a.url], tileSize: 256, maxzoom: a.maxzoom || 19, attribution: a.attribution,
			...(a.bounds ? { bounds: a.bounds } : {})
		};
		layers.push(L(`base-aerial-${a.id}`, 'raster', 'aerial', {
			source: `aerial-${a.id}`, layout: { visibility: 'none' },
			paint: { 'raster-fade-duration': 150 } }, {}));
	}

	const road = (id, group, classes, minzoom, widths, token, extra = {}) =>
		L(id, 'line', group, { ...src, 'source-layer': 'transportation', minzoom,
			filter: ['all', isLine, cls(...classes)],
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: { 'line-width': zw(widths), ...extra } }, { 'line-color': token });

	layers.push(
		road('base-path', 'road', ['path', 'track'], 13, [[13, 0.5], [20, 2]], 'path', { 'line-dasharray': [2, 1.5] }),
		road('base-rail', 'road', ['rail', 'transit'], 10, [[10, 0.6], [20, 2]], 'rail', { 'line-dasharray': [3, 3] }),
		road('base-minor-casing', 'casing', ['minor', 'service'], 13, [[13, 1], [20, 20]], 'casing'),
		road('base-major-casing', 'casing', ['primary', 'secondary', 'tertiary', 'trunk'], 9, [[9, 1.2], [20, 28]], 'casing'),
		road('base-motorway-casing', 'casing', ['motorway'], 6, [[6, 1.2], [20, 32]], 'casing'),
		road('base-minor', 'road', ['minor', 'service'], 12, [[12, 0.4], [20, 17]], 'minor'),
		road('base-major', 'road', ['primary', 'secondary', 'tertiary', 'trunk'], 8, [[8, 0.6], [20, 24]], 'major'),
		road('base-motorway', 'road', ['motorway'], 6, [[6, 0.8], [20, 28]], 'motorway'),
		L('base-boundary', 'line', 'road', { ...src, 'source-layer': 'boundary',
			filter: ['all', ['>=', ['get', 'admin_level'], 4], ['<=', ['get', 'admin_level'], 8], ['!=', ['get', 'maritime'], 1]],
			paint: { 'line-dasharray': [3, 2], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 14, 1.6] } },
			{ 'line-color': 'boundary' })
	);

	const text = (font, size, extra = {}) => ({
		'text-field': NAME, 'text-font': [font], 'text-size': size, ...extra
	});
	const halo = { 'text-halo-width': 1.4, 'text-halo-blur': 0.4 };
	const label = (id, layer, filter, minzoom, layout, tokens = { 'text-color': 'label', 'text-halo-color': 'halo' }) =>
		L(id, 'symbol', 'label', { ...src, 'source-layer': layer, filter, minzoom, layout, paint: { ...halo } }, tokens);

	layers.push(
		label(LABELS_FROM, 'water_name', null, 10, text('Noto Sans Italic', 12, { 'text-letter-spacing': 0.1 }),
			{ 'text-color': 'waterLabel', 'text-halo-color': 'halo' }),
		label('base-label-road-minor', 'transportation_name', cls('minor', 'service'), 15,
			text('Noto Sans Regular', ['interpolate', ['linear'], ['zoom'], 15, 10.5, 19, 13],
				{ 'symbol-placement': 'line', 'text-rotation-alignment': 'map' })),
		label('base-label-road-major', 'transportation_name', cls('primary', 'secondary', 'tertiary', 'trunk', 'motorway'), 12,
			text('Noto Sans Regular', ['interpolate', ['linear'], ['zoom'], 12, 10.5, 18, 14],
				{ 'symbol-placement': 'line', 'text-rotation-alignment': 'map' })),
		label('base-label-place-small', 'place', cls('suburb', 'neighbourhood', 'quarter', 'hamlet'), 11.5,
			text('Noto Sans Regular', ['interpolate', ['linear'], ['zoom'], 12, 10.5, 16, 13],
				{ 'text-transform': 'uppercase', 'text-letter-spacing': 0.08, 'text-max-width': 7 })),
		label('base-label-place-town', 'place', cls('town', 'village'), 8,
			text('Noto Sans Regular', ['interpolate', ['linear'], ['zoom'], 8, 11, 13, 15], { 'text-max-width': 8 })),
		label('base-label-place-city', 'place', cls('city'), 4,
			text('Noto Sans Bold', ['interpolate', ['linear'], ['zoom'], 4, 11, 12, 18], { 'text-max-width': 8 }))
	);

	return { version: 8, glyphs: `${OFM}/fonts/{fontstack}/{range}.pbf`, sources, layers };
}

// Effective tokens for the current base: preset defaults ⊕ saved overrides.
export function tokensFor(base, mode) {
	const vecPreset = base.preset === 'aerial' ? 'muted' : base.preset;
	const vec = { ...PRESETS[vecPreset][mode], ...(base.tokens?.[`${vecPreset}.${mode}`] || {}) };
	if (base.preset !== 'aerial') return { fill: vec, over: vec };
	const over = { ...vec };
	for (const k of AERIAL_TOKENS) over[k] = (base.tokens?.aerial || {})[k] ?? PRESETS.aerial.tokens[k];
	return { fill: vec, over };
}

const OPACITY = { fill: 'fill-opacity', line: 'line-opacity', symbol: 'text-opacity', raster: 'raster-opacity' };

// Push the base state onto a live map: colours, visibility, imagery settings.
// "Base map strength" scales every base layer's opacity toward the land
// colour, so overlays read louder without touching their own colours.
// Labels fade less than the rest so the map stays legible.
export function applyBase(map, base, mode) {
	const { fill, over } = tokensFor(base, mode);
	const aerial = base.preset === 'aerial';
	const r = { ...PRESETS.aerial.raster, ...(base.raster || {}) };
	const hybrid = base.hybrid !== false;
	const k = base.strength ?? 1;
	for (const layer of map.getStyle().layers) {
		const meta = layer.metadata || {};
		const group = meta['atlas:group'];
		if (!group) continue;
		let visible = true;
		if (group === 'aerial') visible = aerial && layer.id === `base-aerial-${base.year}`;
		else if (group === 'casing') visible = !aerial;
		else if (group === 'road' || group === 'label') visible = !aerial || hybrid;
		map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
		const tok = group === 'road' || group === 'label' ? over : fill;
		for (const [prop, key] of Object.entries(meta['atlas:tokens'] || {})) map.setPaintProperty(layer.id, prop, tok[key]);
		const prop = OPACITY[layer.type];
		if (prop) {
			const own = (meta['atlas:alpha'] ?? 1) * (group === 'road' && aerial ? r.roadOpacity : 1);
			map.setPaintProperty(layer.id, prop, own * (group === 'label' ? 0.45 + 0.55 * k : k));
		}
		if (group === 'aerial' && visible) {
			map.setPaintProperty(layer.id, 'raster-saturation', r.saturation);
			map.setPaintProperty(layer.id, 'raster-brightness-max', r.brightness);
			map.setPaintProperty(layer.id, 'raster-contrast', r.contrast);
		}
	}
	return fill; // callers need land/halo for overlay rings and edges
}
