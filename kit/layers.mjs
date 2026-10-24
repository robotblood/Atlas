// Overlays: everything drawn on top of the base map.
//
// One Overlay per layer spec. Kinds:
//   arcgis      live ArcGIS REST layer, queried per viewport (minZoom-gated)
//   geojson     static GeoJSON (url or object), loaded the first time it turns on
//   points      a project's own records: items + lngLat(item) + props(item)
//   choropleth  boundaries (GeoJSON) joined to rows by key, shaded by class
//
// Geometry is 'point' | 'line' | 'fill'. Style is plain data (so the panel can
// edit it and data/map-style.json can store it):
//   color      hex, 'slot:N' (palette slot, follows the mode) or 'base:<token>'
//   colorBy    { prop, values: { value: color }, labels: { value: text }, other }
//   opacity, radius (points), width (lines, fill outlines), dash, outline
//   breaks, palette (choropleth; palette defaults to the sequential ramp)
//
// Visibility changes are animated so a toggle reads at a glance: opacity
// fades, and a layer that comes on pulses (marks swell, then settle).

import { resolveColor, ink, mix, mapColors, sequential, NO_DATA } from './themes.mjs';
import { LABELS_FROM, STREETS_FROM } from './basemap.mjs';

export const DASH = { solid: [1, 0], dash: [3, 2], dot: [0.6, 1.8], long: [6, 3] };
// Draw order against the base map: under the streets, under the labels, or on top.
export const PLACE = { streets: STREETS_FROM, labels: LABELS_FROM, top: undefined };
const FADE = 380;
const PULSE = 700;
const EMPTY = { type: 'FeatureCollection', features: [] };

export const GEOM_DEFAULTS = {
	point: { color: 'slot:1', opacity: 0.9, radius: 4.5, outline: true, place: 'top' },
	line: { color: 'slot:1', opacity: 0.85, width: 2.5, dash: 'solid', outline: true, place: 'labels' },
	fill: { color: 'slot:1', opacity: 0.35, width: 1, outline: true, place: 'streets' }
};
const CHORO_DEFAULTS = { opacity: 0.62, width: 0.7, outline: true, palette: null };

const hoverCase = (on, off) => ['case', ['boolean', ['feature-state', 'hover'], false], on, off];
const t = (ms) => ({ duration: ms, delay: 0 });
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

export class Overlay {
	constructor(atlas, spec, saved) {
		this.atlas = atlas;
		this.spec = spec;
		this.id = spec.id;
		this.kind = spec.kind || 'geojson';
		this.geom = spec.geometry || (this.kind === 'choropleth' ? 'fill' : this.kind === 'points' ? 'point' : 'line');
		this.defaults = {
			...GEOM_DEFAULTS[this.geom],
			...(this.kind === 'choropleth' ? { ...CHORO_DEFAULTS, breaks: spec.breaks || [] } : {}),
			...clone(spec.style || {})
		};
		this.style = { ...clone(this.defaults), ...clone(saved?.style || {}) };
		if (this.defaults.colorBy && saved?.style?.colorBy)
			this.style.colorBy = { ...clone(this.defaults.colorBy), ...saved.style.colorBy,
				values: { ...this.defaults.colorBy.values, ...(saved.style.colorBy.values || {}) } };
		this.on = saved?.on ?? !!spec.on;
		this.src = `ov-${this.id}`;
		this.mult = 1; // pulse
		this.dim = 1; // spotlight
		this.loaded = false;
		this.limit = false;
		this.rows = new Map(); // choropleth: key → row, for tooltips
		this.status = { state: 'off' };
		this.listeners = new Set();
		this.ids = this.geom === 'point' ? [this.src]
			: this.geom === 'line' ? [`${this.src}-halo`, this.src]
			: [`${this.src}-fill`, `${this.src}-line`];
		this.hit = this.geom === 'fill' ? `${this.src}-fill` : this.src;
	}

	get map() { return this.atlas.map; }
	get mode() { return this.atlas.mode; }

	onStatus(fn) { this.listeners.add(fn); fn(this.status); return () => this.listeners.delete(fn); }
	setStatus(s) { this.status = s; for (const fn of this.listeners) fn(s); }

	// ——— colours ——————————————————————————————————————————————
	resolve(c) {
		if (typeof c === 'string' && c.startsWith('base:')) return this.atlas.tokens[c.slice(5)] || '#888888';
		return resolveColor(c, this.mode);
	}

	palette() {
		const n = (this.style.breaks || []).length + 1;
		const p = this.style.palette;
		return Array.isArray(p) && p.length === n ? p : sequential(n, this.mode);
	}

	colorExpr() {
		const s = this.style;
		if (this.kind === 'choropleth') {
			const e = ['match', ['get', '_c']];
			this.palette().forEach((c, i) => e.push(i, c));
			e.push(NO_DATA[this.mode]);
			return e;
		}
		const entries = Object.entries(s.colorBy?.values || {});
		if (entries.length) {
			const e = ['match', ['to-string', ['get', s.colorBy.prop]]];
			for (const [k, c] of entries) e.push(k, this.resolve(c));
			e.push(this.resolve(s.colorBy.other || s.color));
			return e;
		}
		return this.resolve(s.color);
	}

	// Legend entries for the panel: one swatch, or one per category / class.
	legend() {
		const s = this.style;
		if (this.kind === 'choropleth') {
			const b = s.breaks || [], f = this.spec.format || ((v) => v.toLocaleString());
			return this.palette().map((color, i) => ({
				color, index: i,
				label: i === 0 ? `up to ${f(b[0])}` : i === b.length ? `over ${f(b[b.length - 1])}` : `${f(b[i - 1])} – ${f(b[i])}`
			}));
		}
		const entries = Object.entries(s.colorBy?.values || {});
		if (entries.length)
			return entries.map(([k, c]) => ({ key: k, color: this.resolve(c), label: s.colorBy.labels?.[k] || k }));
		return [{ color: this.resolve(s.color), label: this.spec.name }];
	}

	// ——— paint ————————————————————————————————————————————————
	paint() {
		const s = this.style, mode = this.mode, m = this.mult;
		const surface = this.atlas.tokens.land;
		const color = this.colorExpr();
		const op = this.on ? s.opacity * this.dim : 0;
		const fade = t(FADE), grow = t(PULSE / 2), quick = t(160);

		if (this.geom === 'point') {
			const r = s.radius * m;
			return { [this.src]: {
				'circle-color': color, 'circle-color-transition': quick,
				'circle-opacity': op, 'circle-opacity-transition': fade,
				'circle-radius': hoverCase(r * 1.5 + 1, r), 'circle-radius-transition': grow,
				// over imagery a white ring beats a dark one; on a map, tone-on-tone
				'circle-stroke-color': this.atlas.base.preset === 'aerial' ? '#ffffff' : mapColors(color, (c) => ink(c, mode, surface)),
				'circle-stroke-width': s.outline ? hoverCase(2, 1.2) : 0,
				'circle-stroke-opacity': this.on ? Math.min(1, op + 0.1) : 0, 'circle-stroke-opacity-transition': fade
			} };
		}
		if (this.geom === 'line') {
			const w = s.width * m;
			return {
				[`${this.src}-halo`]: {
					'line-color': surface,
					'line-width': s.outline ? hoverCase(w + 6, w + 3) : 0, 'line-width-transition': grow,
					'line-opacity': op * 0.85, 'line-opacity-transition': fade, 'line-blur': 0.5
				},
				[this.src]: {
					'line-color': color, 'line-color-transition': quick,
					'line-width': hoverCase(w + 2, w), 'line-width-transition': grow,
					'line-opacity': op, 'line-opacity-transition': fade,
					'line-dasharray': DASH[s.dash] || DASH.solid
				}
			};
		}
		// fill: choropleth edges are a surface-coloured gap; other fills get
		// a tone-on-tone edge of their own colour
		const edge = this.kind === 'choropleth' ? surface
			: mapColors(color, (c) => (mode === 'dark' ? mix(c, '#ffffff', 0.25) : mix(c, '#000000', 0.35)));
		const w = s.width * m;
		const flash = m > 1 ? 0.25 : 0;
		const fillOp = this.on ? Math.min(1, s.opacity * this.dim + flash) : 0;
		return {
			[`${this.src}-fill`]: {
				'fill-color': color, 'fill-color-transition': quick,
				'fill-opacity': hoverCase(Math.min(1, fillOp + (this.on ? 0.15 : 0)), fillOp), 'fill-opacity-transition': fade
			},
			[`${this.src}-line`]: {
				'line-color': hoverCase(this.atlas.tokens.label, edge),
				'line-width': s.outline || this.kind === 'choropleth' ? hoverCase(w + 1.5, w) : hoverCase(1.5, 0),
				'line-width-transition': grow,
				'line-opacity': this.on ? Math.min(1, 0.95 * this.dim) : 0, 'line-opacity-transition': fade
			}
		};
	}

	apply() {
		if (!this.mounted) return;
		for (const [layer, props] of Object.entries(this.paint()))
			for (const [k, v] of Object.entries(props)) this.map.setPaintProperty(layer, k, v);
	}

	// ——— lifecycle ————————————————————————————————————————————
	mount() {
		const map = this.map;
		map.addSource(this.src, { type: 'geojson', data: EMPTY, generateId: true });
		const vis = { visibility: this.on ? 'visible' : 'none' };
		const paint = this.paint();
		const before = PLACE[this.style.place];
		const add = (id, type, layout = {}) =>
			map.addLayer({ id, type, source: this.src, layout: { ...vis, ...layout }, paint: paint[id] }, before);
		if (this.geom === 'point') add(this.src, 'circle');
		else if (this.geom === 'line') {
			add(`${this.src}-halo`, 'line', { 'line-cap': 'round', 'line-join': 'round' });
			add(this.src, 'line', { 'line-cap': 'round', 'line-join': 'round' });
		} else {
			add(`${this.src}-fill`, 'fill');
			add(`${this.src}-line`, 'line', { 'line-join': 'round' });
		}
		this.mounted = true;
		if (this.on) this.load();
	}

	setVisible(v) {
		for (const id of this.ids) this.map.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none');
	}

	setOn(on, { pulse = true } = {}) {
		if (on === this.on) return;
		this.on = on;
		clearTimeout(this.hideTimer);
		if (on) {
			this.setVisible(true);
			requestAnimationFrame(() => this.apply());
			this.wantPulse = pulse;
			this.load();
		} else {
			this.apply();
			this.hideTimer = setTimeout(() => !this.on && this.setVisible(false), FADE + 40);
			if (this.abort) this.abort.abort();
			this.setStatus({ state: 'off' });
		}
		this.atlas.changed(this, 'on');
	}

	pulse() {
		this.mult = this.geom === 'fill' ? 2.4 : 2.1;
		this.apply();
		clearTimeout(this.pulseTimer);
		this.pulseTimer = setTimeout(() => { this.mult = 1; this.apply(); }, PULSE);
	}

	setStyle(patch) {
		Object.assign(this.style, patch);
		if ('place' in patch) for (const id of this.ids) this.map.moveLayer(id, PLACE[patch.place]);
		if ('breaks' in patch && this.kind === 'choropleth') {
			if (!('palette' in patch)) this.style.palette = null;
			this.classify();
		}
		this.apply();
		this.atlas.changed(this, 'style');
	}

	resetStyle() {
		const place = this.style.place;
		this.style = clone(this.defaults);
		if (place !== this.style.place) for (const id of this.ids) this.map.moveLayer(id, PLACE[this.style.place]);
		if (this.kind === 'choropleth') this.classify();
		this.apply();
		this.atlas.changed(this, 'style');
	}

	// ——— data ————————————————————————————————————————————————
	async load() {
		if (this.kind === 'arcgis') return this.refresh();
		if (this.loaded) { this.settle(); return; }
		this.setStatus({ state: 'loading' });
		try {
			let fc;
			if (this.kind === 'points') fc = this.pointsFC(this.spec.items || []);
			else fc = typeof this.spec.data === 'string' ? await (await fetch(this.spec.data)).json() : this.spec.data;
			if (this.kind === 'choropleth') {
				let rows = this.spec.join.rows;
				if (typeof rows === 'string') rows = await (await fetch(rows)).json();
				if (!Array.isArray(rows)) rows = rows.rows;
				this.joinRows = rows;
			}
			this.fc = fc;
			if (this.kind === 'choropleth') this.classify();
			else this.map.getSource(this.src).setData(fc);
			this.loaded = true;
			this.settle();
		} catch (err) {
			this.setStatus({ state: 'error', message: String(err.message || err) });
		}
	}

	settle() {
		if (this.wantPulse) { this.wantPulse = false; setTimeout(() => this.pulse(), 60); }
		this.atlas.scheduleCount();
	}

	pointsFC(items) {
		const { lngLat, props = () => ({}) } = this.spec;
		return { type: 'FeatureCollection', features: items.map((it, i) => ({
			type: 'Feature', geometry: { type: 'Point', coordinates: lngLat(it) },
			properties: { _i: i, ...props(it) } })) };
	}

	setItems(items) {
		this.spec.items = items;
		this.fc = this.pointsFC(items);
		this.loaded = true;
		this.map.getSource(this.src).setData(this.fc);
		this.atlas.scheduleCount();
	}

	item(props) { return this.kind === 'points' ? this.spec.items?.[props._i] : undefined; }

	classify() {
		if (!this.fc) return;
		const { key, rowKey = key, value } = this.spec.join;
		const byKey = new Map((this.joinRows || []).map((r) => [String(r[rowKey]), r]));
		this.rows = byKey;
		const b = this.style.breaks || [];
		for (const f of this.fc.features) {
			const r = byKey.get(String(f.properties[key]));
			const v = r ? value(r) : null;
			f.properties._v = v;
			f.properties._c = v == null || Number.isNaN(v) ? -1 : b.filter((x) => v > x).length;
		}
		this.map.getSource(this.src).setData(this.fc);
	}

	row(props) { return this.kind === 'choropleth' ? this.rows.get(String(props[this.spec.join.key])) : undefined; }

	// ArcGIS: fetch what is in view. Gated by minZoom so a county-wide layer
	// never pulls 80k points; capped by the server's record limit (flagged).
	async refresh() {
		if (!this.on || this.kind !== 'arcgis') return;
		const map = this.map, minZoom = this.spec.minZoom ?? 14;
		if (map.getZoom() < minZoom) {
			map.getSource(this.src).setData(EMPTY);
			this.setStatus({ state: 'zoom', minZoom });
			return;
		}
		if (this.abort) this.abort.abort();
		const ctl = (this.abort = new AbortController());
		if (this.status.state !== 'ready' && this.status.state !== 'limit') this.setStatus({ state: 'loading' });
		const b = map.getBounds();
		const q = new URLSearchParams({
			where: this.spec.where || '1=1',
			outFields: this.spec.fields ? this.spec.fields.join(',') : '*',
			geometry: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => v.toFixed(6)).join(','),
			geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326',
			spatialRel: 'esriSpatialRelIntersects', resultRecordCount: String(this.spec.maxRecords || 2000), f: 'geojson'
		});
		try {
			const res = await fetch(`${this.spec.url}/query?${q}`, { signal: ctl.signal });
			const gj = await res.json();
			if (ctl.signal.aborted) return;
			if (gj.error) throw new Error(gj.error.message || 'query failed');
			this.limit = !!(gj.properties?.exceededTransferLimit || gj.exceededTransferLimit);
			map.getSource(this.src).setData(gj);
			this.loaded = true;
			this.settle();
		} catch (err) {
			if (err.name === 'AbortError') return;
			this.setStatus({ state: 'error', message: String(err.message || err) });
		}
	}

	// Called by Atlas once the map is idle: how many distinct features show.
	count() {
		if (!this.on || this.status.state === 'zoom' || this.status.state === 'error' || !this.loaded) return;
		const feats = this.map.queryRenderedFeatures({ layers: [this.hit] });
		const n = new Set(feats.map((f) => f.id)).size;
		this.setStatus({ state: this.limit ? 'limit' : 'ready', count: n });
	}

	bounds() {
		if (!this.fc?.features?.length) return null;
		let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
		const walk = (c) => {
			if (typeof c[0] === 'number') { w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); }
			else c.forEach(walk);
		};
		for (const f of this.fc.features) if (f.geometry) walk(f.geometry.coordinates);
		return w === Infinity ? null : [[w, s], [e, n]];
	}

	tooltip(props) {
		const out = this.spec.label ? this.spec.label(props, this.row(props) ?? this.item(props)) : this.spec.name;
		return Array.isArray(out) ? out.filter((x) => x != null && x !== '') : [out];
	}
}
