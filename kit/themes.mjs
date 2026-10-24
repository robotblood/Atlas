// Colour defaults for Atlas. Everything here can be overridden per project in
// data/map-style.json (the panel writes it); these are only the starting points.
//
// Base-map tokens are grouped by preset × mode. "muted" is the default under
// data, "street" is a full-colour map for orientation, "aerial" is county
// imagery with roads + labels drawn over it. Light and dark are separate
// selections, not an automatic flip.

export const TOKENS = [
	{ key: 'land', label: 'Land' },
	{ key: 'water', label: 'Water' },
	{ key: 'park', label: 'Parks' },
	{ key: 'wood', label: 'Woods & grass' },
	{ key: 'building', label: 'Buildings' },
	{ key: 'motorway', label: 'Highways' },
	{ key: 'major', label: 'Major roads' },
	{ key: 'minor', label: 'Streets' },
	{ key: 'casing', label: 'Road edges' },
	{ key: 'path', label: 'Paths & trails' },
	{ key: 'rail', label: 'Rail' },
	{ key: 'boundary', label: 'Boundaries' },
	{ key: 'label', label: 'Labels' },
	{ key: 'halo', label: 'Label halo' },
	{ key: 'waterLabel', label: 'Water labels' }
];

// Tokens the aerial preset draws over the imagery (fills come from muted).
export const AERIAL_TOKENS = ['motorway', 'major', 'minor', 'path', 'rail', 'boundary', 'label', 'halo'];

export const PRESETS = {
	muted: {
		label: 'Muted',
		light: {
			land: '#f3f2ef', water: '#cfd9e1', park: '#e2e8df', wood: '#e8ebe4', building: '#e5e3de',
			motorway: '#ffffff', major: '#ffffff', minor: '#ffffff', casing: '#d8d5ce', path: '#c4c0b6',
			rail: '#c9c6be', boundary: '#b3afa6', label: '#6e6b64', halo: '#f3f2ef', waterLabel: '#73838f'
		},
		dark: {
			land: '#1c1c1a', water: '#0f171d', park: '#1f251e', wood: '#1e211c', building: '#272725',
			motorway: '#3b3b38', major: '#343430', minor: '#2b2b28', casing: '#151513', path: '#3d3c37',
			rail: '#3a3934', boundary: '#4d4b45', label: '#98958d', halo: '#1c1c1a', waterLabel: '#5f7380'
		}
	},
	street: {
		label: 'Street',
		light: {
			land: '#f6f4ee', water: '#a9cbe2', park: '#cde5c2', wood: '#dbe8cf', building: '#e2dcd2',
			motorway: '#f1b26a', major: '#fbe09a', minor: '#ffffff', casing: '#cbc4b6', path: '#b0946f',
			rail: '#a39e95', boundary: '#a48db4', label: '#3c3a35', halo: '#ffffff', waterLabel: '#3f6f94'
		},
		dark: {
			land: '#1d1f1c', water: '#1a2f40', park: '#1f3020', wood: '#1e291c', building: '#2c2b28',
			motorway: '#8f5d2c', major: '#6e5c2f', minor: '#3b3b37', casing: '#151614', path: '#6d5b46',
			rail: '#57544e', boundary: '#6f5b7c', label: '#dad7ce', halo: '#1d1f1c', waterLabel: '#80a7c5'
		}
	},
	aerial: {
		label: 'Aerial',
		// one set for both modes: imagery looks the same either way
		tokens: {
			motorway: '#ffd27a', major: '#ffffff', minor: '#ffffff', path: '#e8d3b0', rail: '#d8d4cc',
			boundary: '#ffffff', label: '#ffffff', halo: '#1a1a1a'
		},
		raster: { saturation: 0, brightness: 1, contrast: 0, roadOpacity: 0.55 }
	}
};

// Overlay colours: the validated categorical palette (dataviz reference
// instance), stepped separately for each mode. A layer asks for a slot
// ('slot:3'), never a rank, so its colour stays put when others turn off.
// Maps compare every pair, so only the first three slots are safe all-pairs;
// past that the catalog leans on secondary encoding (dash, size, shape).
export const PALETTE = {
	light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
	dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
};

// Sequential blue, 100→700. Light mode reads light = low; dark mode flips the
// anchor so low values recede into the dark surface.
export const RAMP_BLUE = [
	'#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5',
	'#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'
];

export function sequential(n, mode) {
	const steps = n === 1 ? [6] : Array.from({ length: n }, (_, i) => Math.round((i * 12) / (n - 1)));
	const out = steps.map((i) => RAMP_BLUE[i]);
	return mode === 'dark' ? out.reverse() : out;
}

export const NO_DATA = { light: '#d9d7d1', dark: '#3a3936' };

// ——— colour helpers ————————————————————————————————————————
export function resolveColor(c, mode) {
	if (typeof c === 'string' && c.startsWith('slot:')) {
		const i = (parseInt(c.slice(5), 10) - 1) % 8;
		return PALETTE[mode][i];
	}
	return c;
}

function hexToRgb(hex) {
	let h = hex.replace('#', '');
	if (h.length === 3) h = h.replace(/./g, (x) => x + x);
	const n = parseInt(h.slice(0, 6), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

// mix(a, b, t): t=0 → a, t=1 → b
export function mix(a, b, t) {
	const x = hexToRgb(a), y = hexToRgb(b);
	return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

// Tone-on-tone ink for outlines: a darker step of the mark's own colour on
// light surfaces (contrast relief for the sub-3:1 slots), a surface ring on dark.
export function ink(color, mode, surface) {
	if (!/^#[0-9a-f]{3,8}$/i.test(color || '')) return color;
	return mode === 'dark' ? surface : mix(color, '#000000', 0.38);
}

// Walk a MapLibre expression and rewrite every hex colour literal.
export function mapColors(expr, fn) {
	if (typeof expr === 'string') return /^#[0-9a-f]{3,8}$/i.test(expr) ? fn(expr) : expr;
	if (Array.isArray(expr)) return expr.map((e, i) => (i === 0 ? e : mapColors(e, fn)));
	return expr;
}
