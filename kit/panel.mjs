// The layer panel: base map choice + colours, and every overlay with its
// switch, legend, live count, and its own style controls. Doubles as the
// map's legend, so it is always on screen (a bottom sheet on phones).

import { TOKENS, AERIAL_TOKENS, PRESETS } from './themes.mjs';
import { tokensFor } from './basemap.mjs';
import { DASH, PLACE } from './layers.mjs';

function h(tag, attrs = {}, ...kids) {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs || {})) {
		if (v == null || v === false) continue;
		if (k === 'class') el.className = v;
		else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
		else if (k === 'text') el.textContent = v;
		else if (k in el && typeof v !== 'string') el[k] = v;
		else el.setAttribute(k, v === true ? '' : v);
	}
	for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
	return el;
}

const pct = (v) => `${Math.round(v * 100)}%`;

function slider(label, { min, max, step, value, fmt = (v) => v, onInput }) {
	const out = h('output', { text: fmt(value) });
	const input = h('input', { type: 'range', min, max, step, value: String(value),
		oninput: (e) => { const v = parseFloat(e.target.value); out.textContent = fmt(v); onInput(v); } });
	return h('label', { class: 'ap-slider' }, h('span', { text: label }), input, out);
}

function colorInput(value, onInput, title) {
	return h('input', { type: 'color', class: 'ap-color', value: toHex6(value), title, oninput: (e) => onInput(e.target.value) });
}

function toHex6(c) {
	if (typeof c !== 'string') return '#888888';
	if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
	if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c.slice(1).replace(/./g, (x) => x + x).toLowerCase();
	return '#888888';
}

// A tiny drawing of what the layer looks like on the map.
function swatch(o, entry) {
	const s = o.style;
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 20 14');
	svg.setAttribute('class', 'ap-sw');
	const el = (tag, attrs) => {
		const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
		for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
		svg.appendChild(n);
	};
	if (o.geom === 'point') el('circle', { cx: 10, cy: 7, r: Math.min(6, 2.5 + s.radius * 0.5), fill: entry.color, class: 'ap-sw-ink' });
	else if (o.geom === 'line') {
		const d = DASH[s.dash] || DASH.solid;
		el('line', { x1: 2, y1: 7, x2: 18, y2: 7, stroke: entry.color, 'stroke-width': Math.min(5, 1 + s.width * 0.6),
			'stroke-linecap': 'round', 'stroke-dasharray': s.dash === 'solid' ? '' : d.map((x) => x * 2).join(' ') });
	} else el('rect', { x: 3, y: 2, width: 14, height: 10, rx: 2, fill: entry.color, 'fill-opacity': o.kind === 'choropleth' ? 1 : Math.max(0.35, s.opacity),
		stroke: entry.color, 'stroke-width': s.outline || o.kind === 'choropleth' ? 1.2 : 0 });
	return svg;
}

// Row key: one swatch, a few category swatches, or a compact ramp.
function key(o) {
	const legend = o.legend();
	if (o.kind !== 'choropleth') return legend.slice(0, 4).map((e) => swatch(o, e));
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', `0 0 ${legend.length * 6} 12`);
	svg.setAttribute('class', 'ap-ramp');
	legend.forEach((e, i) => {
		const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
		for (const [k, v] of Object.entries({ x: i * 6, y: 1, width: 6, height: 10, fill: e.color })) r.setAttribute(k, v);
		svg.appendChild(r);
	});
	return [svg];
}

// The legend proper, shown under the row whenever a multi-colour layer is on.
function inlineLegend(o) {
	const legend = o.legend();
	if (legend.length < 2) return null;
	// fills down the first column, then the second, so a ramp reads in order
	return h('div', { class: 'ap-legend', style: `grid-template-rows: repeat(${Math.ceil(legend.length / 2)}, auto)` }, legend.map((e) =>
		h('span', { class: 'ap-legend-row' }, swatch(o, e), h('span', { text: e.label }))));
}

const PLACE_LABEL = { streets: 'under streets', labels: 'under labels', top: 'on top' };

const STATUS = {
	off: () => '',
	loading: () => 'loading…',
	ready: (s) => (s.count ? `${s.count.toLocaleString()} in view` : 'none in view'),
	limit: (s) => `${s.count.toLocaleString()} · capped, zoom in`,
	error: () => 'error'
};

export class Panel {
	constructor(atlas, host) {
		this.atlas = atlas;
		this.el = h('aside', { class: 'atlas-panel', 'aria-label': 'Map layers' });
		const target = host ? (typeof host === 'string' ? document.querySelector(host) : host) : atlas.el;
		if (!host) this.el.classList.add('floating');
		target.appendChild(this.el);
		this.open = new Set();
		this.collapsed = matchMedia('(max-width: 720px)').matches;
		for (const o of atlas.overlays) o.onStatus((s) => this.paintStatus(o, s));
		this.render();
	}

	render() {
		this.el.classList.toggle('collapsed', this.collapsed);
		this.el.replaceChildren(this.head(), this.baseSection(), this.overlaySection(), this.foot());
		for (const o of this.atlas.overlays) this.paintStatus(o, o.status);
		this.refreshDiag();
	}

	// ——— header ————————————————————————————————————————————————
	head() {
		const a = this.atlas;
		const n = a.overlays.filter((o) => o.on).length;
		const modeLabel = { auto: 'Auto', light: 'Light', dark: 'Dark' }[a.modePref()];
		return h('header', { class: 'ap-head' },
			h('button', { class: 'ap-title', 'aria-expanded': String(!this.collapsed),
				onclick: () => { this.collapsed = !this.collapsed; this.render(); } },
				h('span', { text: 'Layers' }), h('span', { class: 'ap-oncount', text: n ? `${n} on` : 'none on' })),
			h('span', { class: 'ap-save', 'data-state': a.store.state, text: SAVE_TEXT[a.store.state] || '' }),
			h('button', { class: 'ap-mode', title: 'Light / dark (Auto follows your system)',
				onclick: () => { a.setMode({ auto: 'light', light: 'dark', dark: 'auto' }[a.modePref()]); this.render(); } },
				h('span', { class: 'ap-mode-ico', 'aria-hidden': 'true' }), modeLabel)
		);
	}

	saveStatus(state) {
		const el = this.el.querySelector('.ap-save');
		if (!el) return;
		el.dataset.state = state;
		el.textContent = SAVE_TEXT[state] || '';
		el.title = state === 'local'
			? 'This server cannot write files, so changes are kept in this browser. Export writes data/map-style.json.'
			: state === 'file' || state === 'ready' ? 'Changes save to data/map-style.json' : '';
	}

	// ——— base map ——————————————————————————————————————————————
	baseSection() {
		const a = this.atlas, b = a.base;
		const aerials = a.opts.region.aerials || [];
		const presets = ['muted', 'street', ...(aerials.length ? ['aerial'] : [])];
		const sec = h('section', { class: 'ap-sec ap-base' },
			h('h3', { text: 'Base map' }),
			h('div', { class: 'ap-seg', role: 'radiogroup' }, presets.map((p) =>
				h('button', { role: 'radio', 'aria-checked': String(b.preset === p), class: b.preset === p ? 'on' : '',
					onclick: () => a.setBase({ preset: p }) }, PRESETS[p].label)))
		);
		if (b.preset === 'aerial') {
			const r = { ...PRESETS.aerial.raster, ...(b.raster || {}) };
			const setR = (k) => (v) => a.setBase({ raster: { ...(a.base.raster || {}), [k]: v } });
			sec.append(
				h('label', { class: 'ap-field' }, h('span', { text: 'Flight' }),
					h('select', { onchange: (e) => a.setBase({ year: e.target.value }) },
						aerials.map((x) => h('option', { value: x.id, selected: x.id === b.year }, x.label)))),
				h('label', { class: 'ap-check' }, h('input', { type: 'checkbox', checked: b.hybrid !== false,
					onchange: (e) => a.setBase({ hybrid: e.target.checked }) }), 'Streets & labels on top'),
				slider('Imagery colour', { min: -1, max: 0.6, step: 0.05, value: r.saturation, fmt: (v) => pct(1 + v), onInput: setR('saturation') }),
				slider('Imagery brightness', { min: 0.3, max: 1, step: 0.05, value: r.brightness, fmt: pct, onInput: setR('brightness') }),
				slider('Streets over imagery', { min: 0, max: 1, step: 0.05, value: r.roadOpacity, fmt: pct, onInput: setR('roadOpacity') })
			);
		}
		sec.append(slider('Base map strength', { min: 0.15, max: 1, step: 0.05, value: b.strength ?? 1, fmt: pct,
			onInput: (v) => a.setBase({ strength: v }) }));
		sec.append(this.colourEditor());
		return sec;
	}

	colourEditor() {
		const a = this.atlas, b = a.base;
		const { fill, over } = tokensFor(b, a.mode);
		const aerial = b.preset === 'aerial';
		const rows = [];
		const add = (t, group, value) => {
			const slot = a.tokenSlot(group);
			const overridden = (b.tokens?.[slot] || {})[t.key] != null;
			rows.push(h('div', { class: 'ap-token' },
				colorInput(value, (v) => a.setToken(t.key, v, group), t.label),
				h('span', { text: t.label }),
				overridden ? h('button', { class: 'ap-x', title: 'Back to default', text: '↺',
					onclick: () => setTokenAt(a, slot, t.key, null) }) : null));
		};
		if (aerial) for (const t of TOKENS.filter((t) => AERIAL_TOKENS.includes(t.key))) add(t, 'over', over[t.key]);
		for (const t of TOKENS) if (!aerial || !AERIAL_TOKENS.includes(t.key)) add(t, 'fill', fill[t.key]);
		const name = aerial ? 'Aerial + Muted' : PRESETS[b.preset].label;
		const det = h('details', { class: 'ap-colours', open: this.coloursOpen },
			h('summary', {}, `Colours · ${name}, ${a.mode}`),
			h('div', { class: 'ap-tokens' }, rows));
		det.addEventListener('toggle', () => (this.coloursOpen = det.open));
		return det;
	}

	refreshBase() {
		const old = this.el.querySelector('.ap-base');
		if (!old) return;
		// keep focus on a slider being dragged: only rebuild when structure changes
		const active = document.activeElement;
		if (active && old.contains(active) && active.type === 'range') return;
		if (active && old.contains(active) && active.type === 'color') return;
		old.replaceWith(this.baseSection());
	}

	// ——— overlays ——————————————————————————————————————————————
	overlaySection() {
		const groups = new Map();
		for (const o of this.atlas.overlays) {
			const g = o.spec.group || 'Layers';
			if (!groups.has(g)) groups.set(g, []);
			groups.get(g).push(o);
		}
		return h('section', { class: 'ap-sec ap-overlays' },
			[...groups].map(([g, list]) => h('div', { class: 'ap-group' },
				h('h3', { text: g }), list.map((o) => this.item(o)))));
	}

	item(o) {
		const a = this.atlas;
		const isOpen = this.open.has(o.id);
		const row = h('div', { class: 'ap-ov' },
			h('label', { class: 'ap-switch', title: o.on ? 'Turn off' : 'Turn on' },
				h('input', { type: 'checkbox', checked: o.on, 'aria-label': o.spec.name, onchange: (e) => o.setOn(e.target.checked) }),
				h('span', { 'aria-hidden': 'true' })),
			h('span', { class: 'ap-key' }, key(o)),
			h('button', { class: 'ap-name', 'aria-expanded': String(isOpen), onclick: () => this.toggleOpen(o) },
				h('span', { text: o.spec.name }), h('span', { class: 'ap-chev', 'aria-hidden': 'true' })),
			h('span', { class: 'ap-st' })
		);
		const item = h('div', { class: 'ap-item', 'data-id': o.id, 'data-on': String(o.on) }, row,
			isOpen ? this.detail(o) : o.on ? inlineLegend(o) : null);
		item.addEventListener('mouseenter', () => o.on && a.spotlight(o.id));
		item.addEventListener('mouseleave', () => a.spotlight(null));
		return item;
	}

	toggleOpen(o) {
		this.open.has(o.id) ? this.open.delete(o.id) : this.open.add(o.id);
		this.replaceItem(o);
	}

	replaceItem(o) {
		const old = this.el.querySelector(`.ap-item[data-id="${CSS.escape(o.id)}"]`);
		if (old) old.replaceWith(this.item(o));
		this.paintStatus(o, o.status);
	}

	// Light refresh after a toggle or a style edit: the switch, the legend
	// swatches and the on-count. Detail controls are left alone so a colour
	// picker or slider in use keeps its focus.
	refreshOverlay(o) {
		const item = this.el.querySelector(`.ap-item[data-id="${CSS.escape(o.id)}"]`);
		if (!item) return;
		item.dataset.on = String(o.on);
		item.querySelector('.ap-switch input').checked = o.on;
		item.querySelector('.ap-key').replaceChildren(...key(o));
		if (!this.open.has(o.id)) {
			item.querySelector('.ap-legend')?.remove();
			const lg = o.on ? inlineLegend(o) : null;
			if (lg) item.append(lg);
		}
		const n = this.atlas.overlays.filter((x) => x.on).length;
		const c = this.el.querySelector('.ap-oncount');
		if (c) c.textContent = n ? `${n} on` : 'none on';
	}

	refreshOverlays() { for (const o of this.atlas.overlays) this.refreshOverlay(o); }

	paintStatus(o, s) {
		const el = this.el.querySelector(`.ap-item[data-id="${CSS.escape(o.id)}"] .ap-st`);
		if (!el) return;
		el.dataset.state = s.state;
		if (s.state === 'zoom') {
			el.replaceChildren(h('button', { class: 'ap-zoomin', title: `Loads at zoom ${s.minZoom} and closer`,
				onclick: () => this.atlas.zoomTo(o), text: 'zoom in ›' }));
		} else {
			el.textContent = (STATUS[s.state] || (() => ''))(s);
			el.title = s.state === 'error' ? s.message || '' : s.state === 'limit'
				? 'The server returned its record limit for this view — zoom in to see everything' : '';
		}
	}

	detail(o) {
		const s = o.style;
		const set = (patch) => o.setStyle(patch);
		const box = h('div', { class: 'ap-detail' });

		// colour
		if (o.kind === 'choropleth') {
			const legend = o.legend();
			box.append(h('div', { class: 'ap-cats' }, legend.map((e) =>
				h('label', { class: 'ap-cat' },
					colorInput(e.color, (v) => { const p = [...o.palette()]; p[e.index] = v; set({ palette: p }); }),
					h('span', { text: e.label })))));
			box.append(h('label', { class: 'ap-field' }, h('span', { text: 'Breaks' }),
				h('input', { type: 'text', class: 'ap-breaks', value: (s.breaks || []).join(', '), inputmode: 'decimal',
					onchange: (e) => {
						const b = e.target.value.split(/[,\s]+/).map(Number).filter(Number.isFinite).sort((x, y) => x - y);
						if (b.length) { set({ breaks: b }); this.replaceItem(o); }
					} })));
			if (Array.isArray(s.palette))
				box.append(h('button', { class: 'ap-link', text: 'Back to the default ramp',
					onclick: () => { set({ palette: null }); this.replaceItem(o); } }));
		} else if (Object.keys(s.colorBy?.values || {}).length) {
			const legend = o.legend();
			box.append(h('div', { class: 'ap-cats' }, legend.map((e) =>
				h('label', { class: 'ap-cat' },
					colorInput(e.color, (v) => set({ colorBy: { ...s.colorBy, values: { ...s.colorBy.values, [e.key]: v } } })),
					h('span', { text: e.label })))));
		} else {
			box.append(h('label', { class: 'ap-field' }, h('span', { text: 'Colour' }),
				colorInput(o.resolve(s.color), (v) => set({ color: v }))));
		}

		// opacity, size
		box.append(slider(o.geom === 'fill' ? 'Fill' : 'Opacity', { min: 0, max: 1, step: 0.05, value: s.opacity, fmt: pct,
			onInput: (v) => set({ opacity: v }) }));
		if (o.geom === 'point')
			box.append(slider('Size', { min: 1.5, max: 12, step: 0.5, value: s.radius, fmt: (v) => `${v}px`, onInput: (v) => set({ radius: v }) }));
		else
			box.append(slider(o.geom === 'line' ? 'Width' : 'Edge', { min: o.geom === 'line' ? 0.5 : 0, max: o.geom === 'line' ? 10 : 4,
				step: 0.25, value: s.width, fmt: (v) => `${v}px`, onInput: (v) => set({ width: v }) }));

		if (o.geom === 'line')
			box.append(h('div', { class: 'ap-field stack' }, h('span', { text: 'Line' }),
				h('div', { class: 'ap-seg small' }, Object.keys(DASH).map((d) =>
					h('button', { class: s.dash === d ? 'on' : '', 'aria-pressed': String(s.dash === d),
						onclick: () => { set({ dash: d }); this.replaceItem(o); } }, d)))));
		box.append(h('div', { class: 'ap-field stack' }, h('span', { text: 'Draw' }),
			h('div', { class: 'ap-seg small' }, Object.keys(PLACE).map((p) =>
				h('button', { class: s.place === p ? 'on' : '', 'aria-pressed': String(s.place === p),
					onclick: () => { set({ place: p }); this.replaceItem(o); } }, PLACE_LABEL[p])))));
		if (o.kind !== 'choropleth')
			box.append(h('label', { class: 'ap-check' }, h('input', { type: 'checkbox', checked: !!s.outline,
				onchange: (e) => set({ outline: e.target.checked }) }), o.geom === 'line' ? 'Halo (lifts it off the map)' : 'Outline'));

		// actions
		const soloOn = this.atlas.soloState?.id === o.id;
		box.append(h('div', { class: 'ap-actions' },
			h('button', { class: soloOn ? 'on' : '', onclick: () => { this.atlas.solo(o.id); this.replaceItem(o); },
				title: 'Show only this layer' }, soloOn ? 'Unsolo' : 'Solo'),
			h('button', { onclick: () => this.atlas.zoomTo(o), title: 'Go to where this layer has data' }, 'Zoom to'),
			h('button', { onclick: () => { o.resetStyle(); this.replaceItem(o); } }, 'Reset style')));

		// provenance
		const meta = [];
		if (o.spec.notes) meta.push(h('p', { text: o.spec.notes }));
		if (o.spec.source)
			meta.push(h('p', { class: 'ap-src' }, 'Source: ',
				o.spec.sourceUrl ? h('a', { href: o.spec.sourceUrl, target: '_blank', rel: 'noreferrer', text: o.spec.source }) : o.spec.source,
				o.spec.asOf ? ` · checked ${o.spec.asOf}` : '',
				o.kind === 'arcgis' && o.spec.minZoom ? ` · loads at zoom ${o.spec.minZoom}+` : ''));
		if (meta.length) box.append(h('div', { class: 'ap-meta' }, meta));
		return box;
	}

	// ——— footer ————————————————————————————————————————————————
	foot() {
		return h('footer', { class: 'ap-foot' },
			h('div', { class: 'ap-actions' },
				h('button', { onclick: () => this.atlas.exportStyle(), title: 'Download map-style.json' }, 'Export style'),
				h('button', { onclick: () => this.atlas.resetAll(), title: 'Every colour and layer back to its default' }, 'Reset all')),
			h('div', { class: 'ap-diag' }));
	}

	refreshDiag() {
		const el = this.el.querySelector('.ap-diag');
		if (!el) return;
		const d = this.atlas.diagnostics();
		el.dataset.warn = String(d.software || !d.webgl2);
		el.textContent = `${d.webgl2 ? 'WebGL2' : 'WebGL1'} · ${d.renderer}${d.frameMs ? ` · ${d.frameMs.toFixed(0)} ms/frame moving` : ''}${d.software ? ' · software rendering' : ''}`;
	}
}

const SAVE_TEXT = { clean: '', ready: 'autosaves', pending: 'saving…', file: 'saved', local: 'saved in browser', error: 'not saved' };

function setTokenAt(atlas, slot, key, value) {
	const tokens = { ...(atlas.base.tokens || {}) };
	const cur = { ...(tokens[slot] || {}) };
	if (value == null) delete cur[key];
	else cur[key] = value;
	tokens[slot] = cur;
	atlas.setBase({ tokens });
}
