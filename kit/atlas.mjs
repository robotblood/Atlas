// Atlas — one map for every project.
//
//   import { createMap } from './vendor/atlas/atlas.mjs';
//   import * as omaha from './vendor/atlas/catalog/omaha.mjs';
//   const atlas = await createMap('map', {
//     region: omaha.region,
//     layers: [...omaha.pick('signals', 'reports'), myIssuesLayer],
//   });
//
// The page owns its data; Atlas owns the base map, the overlay engine, the
// layer panel, tooltips, share links and saving styles. Styles live in
// data/map-style.json next to the page (autosaved when served by
// vendor/atlas/serve.py, kept in this browser otherwise — Export writes it).

import * as maplibregl from './maplibre/maplibre-gl.mjs';
import { buildStyle, applyBase } from './basemap.mjs';
import { Overlay } from './layers.mjs';
import { Panel } from './panel.mjs';

export { maplibregl };
export const VERSION = '0.1.0';

export async function createMap(container, opts) {
	const atlas = new Atlas(container, opts);
	await atlas.ready;
	return atlas;
}

class Atlas {
	constructor(container, opts) {
		this.opts = { basemap: 'muted', styleUrl: 'data/map-style.json', panel: true, hash: true, ...opts };
		this.el = typeof container === 'string' ? document.getElementById(container) : container;
		this.el.classList.add('atlas');
		this.handlers = new Set();
		this.ready = this.init();
	}

	// ——— setup ——————————————————————————————————————————————
	async init() {
		const { region } = this.opts;
		this.store = await Store.open(this.opts.styleUrl, (s) => this.panel?.saveStatus(s));
		const saved = this.store.data;
		this.base = {
			preset: this.opts.basemap, year: region.aerials?.[0]?.id, hybrid: true, strength: 1,
			tokens: {}, raster: {}, ...(saved.basemap || {})
		};
		const h = this.opts.hash ? parseHash() : {};
		if (h.base && (h.base !== 'aerial' || region.aerials?.length)) this.base.preset = h.base;
		this.mode = currentMode();

		this.map = new maplibregl.Map({
			container: this.el,
			style: buildStyle(region),
			center: h.center || region.center,
			zoom: h.zoom ?? region.zoom,
			maxZoom: 22,
			attributionControl: { compact: true },
			dragRotate: false,
			pitchWithRotate: false
		});
		this.map.touchZoomRotate.disableRotation();
		this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
		this.map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');
		await new Promise((r) => this.map.once('load', r));

		this.applyBase();

		this.overlays = (this.opts.layers || []).map((spec) => new Overlay(this, spec, saved.layers?.[spec.id]));
		if (h.on) for (const o of this.overlays) o.on = h.on.has(o.id);
		this.byLayer = new Map();
		for (const o of this.overlays) {
			o.mount();
			for (const id of o.ids) this.byLayer.set(id, o);
		}

		this.wireEvents();
		this.watchMode();
		if (this.opts.panel) this.panel = new Panel(this, this.opts.panel === true ? null : this.opts.panel);
		this.writeHash();
		this.scheduleCount();
	}

	get tokens() { return this.baseTokens || {}; }
	overlay(id) { return this.overlays.find((o) => o.id === id); }
	on(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }

	// ——— base map ———————————————————————————————————————————
	applyBase() {
		this.baseTokens = applyBase(this.map, this.base, this.mode);
	}

	setBase(patch) {
		Object.assign(this.base, patch);
		this.applyBase();
		for (const o of this.overlays || []) o.apply(); // halos follow the land colour
		this.persist();
		this.writeHash();
		this.panel?.refreshBase();
	}

	setToken(key, value, group = 'fill') {
		const slot = this.tokenSlot(group);
		const tokens = { ...(this.base.tokens || {}) };
		const cur = { ...(tokens[slot] || {}) };
		if (value == null) delete cur[key];
		else cur[key] = value;
		tokens[slot] = cur;
		this.setBase({ tokens });
	}

	// where colour overrides for the current preset + mode are stored
	tokenSlot(group = 'fill') {
		if (this.base.preset === 'aerial') return group === 'over' ? 'aerial' : `muted.${this.mode}`;
		return `${this.base.preset}.${this.mode}`;
	}

	// ——— overlays ———————————————————————————————————————————
	// Hovering a layer in the panel fades every other overlay, so you can see
	// exactly which marks are its.
	spotlight(id) {
		for (const o of this.overlays) {
			o.dim = id && o.id !== id ? 0.12 : 1;
			o.apply();
		}
	}

	// Solo: show only this layer; press again to bring the others back.
	solo(id) {
		if (this.soloState?.id === id) {
			const prev = this.soloState.on;
			this.soloState = null;
			for (const o of this.overlays) o.setOn(prev.has(o.id), { pulse: false });
		} else {
			const prev = this.soloState?.on || new Set(this.overlays.filter((o) => o.on).map((o) => o.id));
			this.soloState = { id, on: prev };
			for (const o of this.overlays) o.setOn(o.id === id);
		}
		this.panel?.refreshOverlays();
	}

	zoomTo(o) {
		const b = o.bounds();
		if (b) this.map.fitBounds(b, { padding: 60, maxZoom: 17 });
		else if (o.status.state === 'zoom') this.map.easeTo({ zoom: o.status.minZoom + 0.2 });
	}

	changed(o, what) {
		if (what === 'on') { this.writeHash(); if (!this.soloState) this.persist(); }
		else this.persist();
		this.panel?.refreshOverlay(o);
		this.scheduleCount();
		for (const fn of this.handlers) fn({ type: what, overlay: o });
	}

	scheduleCount() {
		clearTimeout(this.countTimer);
		this.countTimer = setTimeout(() => {
			if (this.map.loaded()) this.overlays.forEach((o) => o.count());
			else this.map.once('idle', () => this.overlays.forEach((o) => o.count()));
		}, 120);
	}

	// ——— saving —————————————————————————————————————————————
	snapshot() {
		const layers = {};
		for (const o of this.overlays) {
			const diff = {};
			for (const [k, v] of Object.entries(o.style))
				if (JSON.stringify(v) !== JSON.stringify(o.defaults[k])) diff[k] = v;
			layers[o.id] = { on: o.on, ...(Object.keys(diff).length ? { style: diff } : {}) };
		}
		const { preset, year, hybrid, strength, tokens, raster } = this.base;
		return { version: 1, basemap: { preset, year, hybrid, strength, tokens, raster }, layers };
	}

	persist() { if (this.overlays) this.store.save(this.snapshot()); }

	exportStyle() {
		const blob = new Blob([JSON.stringify({ ...this.snapshot(), savedAt: Date.now() }, null, '\t') + '\n'],
			{ type: 'application/json' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = this.opts.styleUrl.split('/').pop();
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
	}

	resetAll() {
		this.base = { preset: this.opts.basemap, year: this.opts.region.aerials?.[0]?.id, hybrid: true, strength: 1, tokens: {}, raster: {} };
		this.applyBase();
		for (const o of this.overlays) o.resetStyle();
		this.persist();
		this.panel?.render();
	}

	// ——— share links: #zoom/lat/lng&on=a,b&base=muted ————————————————
	writeHash() {
		if (!this.opts.hash || !this.map) return;
		const c = this.map.getCenter();
		const on = this.overlays?.filter((o) => o.on).map((o) => o.id).join(',') || '';
		const h = `#${this.map.getZoom().toFixed(2)}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}&on=${on}&base=${this.base.preset}`;
		history.replaceState(null, '', h);
	}

	// ——— events —————————————————————————————————————————————
	wireEvents() {
		const map = this.map;
		let moveTimer;
		map.on('moveend', () => {
			this.writeHash();
			clearTimeout(moveTimer);
			moveTimer = setTimeout(() => this.overlays.forEach((o) => o.refresh()), 150);
			this.scheduleCount();
		});
		map.on('idle', () => this.overlays.forEach((o) => o.count()));

		// tooltips: hover with a mouse, tap on touch
		this.tip = document.createElement('div');
		this.tip.className = 'atlas-tip';
		this.tip.hidden = true;
		this.el.appendChild(this.tip);
		let hovered = null;
		const clear = () => {
			if (hovered) map.setFeatureState(hovered, { hover: false });
			hovered = null;
			this.tip.hidden = true;
			map.getCanvas().style.cursor = '';
		};
		const show = (e) => {
			const layers = this.overlays.filter((o) => o.on).map((o) => o.hit);
			const f = layers.length ? map.queryRenderedFeatures(e.point, { layers })[0] : null;
			if (!f) return clear();
			const o = this.byLayer.get(f.layer.id);
			const key = { source: f.source, id: f.id };
			if (!hovered || hovered.id !== key.id || hovered.source !== key.source) {
				if (hovered) map.setFeatureState(hovered, { hover: false });
				map.setFeatureState(key, { hover: true });
				hovered = key;
			}
			const lines = o.tooltip(f.properties);
			this.tip.replaceChildren(
				...lines.map((text, i) => {
					const d = document.createElement('div');
					d.className = i === 0 ? 'atlas-tip-title' : 'atlas-tip-line';
					d.textContent = String(text);
					return d;
				}),
				Object.assign(document.createElement('div'), { className: 'atlas-tip-layer', textContent: o.spec.name })
			);
			this.tip.hidden = false;
			const { width, height } = this.el.getBoundingClientRect();
			const x = Math.min(e.point.x + 14, width - this.tip.offsetWidth - 8);
			const y = e.point.y + 14 + this.tip.offsetHeight > height ? e.point.y - this.tip.offsetHeight - 10 : e.point.y + 14;
			this.tip.style.transform = `translate(${Math.max(8, x)}px, ${y}px)`;
			map.getCanvas().style.cursor = 'pointer';
		};
		const coarse = matchMedia('(pointer: coarse)').matches;
		if (!coarse) {
			map.on('mousemove', show);
			map.on('mouseout', clear);
		}
		map.on('click', show);
		map.on('movestart', () => coarse && clear());

		// frame timing while the map moves — the GPU check reads it
		let last = 0, frames = [];
		map.on('render', () => {
			const now = performance.now();
			if (map.isMoving() && last) frames.push(now - last);
			last = now;
			if (frames.length > 120) frames.shift();
		});
		map.on('moveend', () => {
			if (frames.length > 10) {
				const sorted = [...frames].sort((a, b) => a - b);
				this.frameMs = sorted[Math.floor(sorted.length / 2)];
				this.panel?.refreshDiag();
			}
			frames = [];
			last = 0;
		});
	}

	// Light/dark follows the page: data-theme on <html> if set, else the OS.
	watchMode() {
		const sync = () => {
			const m = currentMode();
			if (m === this.mode) return;
			this.mode = m;
			this.applyBase();
			for (const o of this.overlays) o.apply();
			this.panel?.render();
		};
		new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
		matchMedia('(prefers-color-scheme: dark)').addEventListener('change', sync);
	}

	setMode(pref) {
		if (pref === 'auto') delete document.documentElement.dataset.theme;
		else document.documentElement.dataset.theme = pref;
		try { pref === 'auto' ? localStorage.removeItem('atlas:theme') : localStorage.setItem('atlas:theme', pref); } catch {}
	}

	modePref() { return document.documentElement.dataset.theme || 'auto'; }

	diagnostics() {
		if (this.diag) return { ...this.diag, frameMs: this.frameMs };
		const c = document.createElement('canvas');
		const gl = c.getContext('webgl2') || c.getContext('webgl');
		let renderer = 'no WebGL';
		if (gl) {
			const ext = gl.getExtension('WEBGL_debug_renderer_info');
			renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
		}
		this.diag = {
			webgl2: !!c.getContext('webgl2'),
			renderer,
			software: /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer)
		};
		return { ...this.diag, frameMs: this.frameMs };
	}
}

// restore a saved theme choice before the first paint
try {
	const t = localStorage.getItem('atlas:theme');
	if (t && !document.documentElement.dataset.theme) document.documentElement.dataset.theme = t;
} catch {}

function currentMode() {
	const t = document.documentElement.dataset.theme;
	if (t === 'dark' || t === 'light') return t;
	return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function parseHash() {
	const [view, ...params] = location.hash.slice(1).split('&');
	const out = {};
	const [z, lat, lng] = view.split('/').map(Number);
	if ([z, lat, lng].every(Number.isFinite)) { out.zoom = z; out.center = [lng, lat]; }
	for (const p of params) {
		const [k, v = ''] = p.split('=');
		if (k === 'on') out.on = new Set(v.split(',').filter(Boolean));
		if (k === 'base' && ['muted', 'street', 'aerial'].includes(v)) out.base = v;
	}
	return out;
}

// Saved styles: data/map-style.json beside the page. serve.py accepts writes;
// any other server (http.server, GitHub Pages) falls back to this browser.
class Store {
	static async open(url, onStatus) {
		const s = new Store();
		s.url = new URL(url, location.href).pathname;
		s.onStatus = onStatus || (() => {});
		s.key = `atlas:style:${s.url}`;
		let file = {}, local = null;
		try { const r = await fetch(url, { cache: 'no-store' }); if (r.ok) file = await r.json(); } catch {}
		try { const r = await fetch('/api/atlas/ping', { cache: 'no-store' }); s.canSave = r.ok && (await r.json()).ok === true; } catch { s.canSave = false; }
		try { local = JSON.parse(localStorage.getItem(s.key)); } catch {}
		s.data = !s.canSave && local && (local.savedAt || 0) > (file.savedAt || 0) ? local : file;
		s.state = s.canSave ? 'ready' : local ? 'local' : 'clean';
		return s;
	}

	save(data) {
		clearTimeout(this.timer);
		this.onStatus('pending');
		this.timer = setTimeout(async () => {
			const body = { ...data, savedAt: Date.now() };
			if (this.canSave) {
				try {
					const r = await fetch('/api/atlas/style', { method: 'POST', headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ path: this.url, data: body }) });
					if (!r.ok) throw new Error(await r.text());
					this.state = 'file';
					return this.onStatus('file');
				} catch (err) {
					console.warn('[atlas] save to file failed, keeping it in this browser', err);
				}
			}
			try { localStorage.setItem(this.key, JSON.stringify(body)); this.state = 'local'; this.onStatus('local'); }
			catch { this.onStatus('error'); }
		}, 450);
	}
}
