// Appearance of Abstractus Connector pages. Loaded in <head> before the stylesheet so the
// right palette is there on first paint.
//
// Modes:
//   contrast  the opposite of whatever the page under the popup uses (the page's scheme is
//             passed in as ?host=dark|light by the content script); for the extension's own
//             pages, the opposite of the browser theme. Default: a dark popup on a light
//             article, a light popup on a dark one, so the popup always stands out.
//   dark / light  always
//   system    follow the browser/OS theme
//
// The mode is read synchronously: ?mode= on frames (passed by the content script from the
// pref), localStorage on the extension's own pages (written by Connector Settings).
(function () {
	const KEY = 'abstractus.appearance';
	const MODES = ['contrast', 'dark', 'light', 'system'];
	const params = new URLSearchParams(location.search);
	const host = ['dark', 'light'].includes(params.get('host')) ? params.get('host') : null;
	const urlMode = MODES.includes(params.get('mode')) ? params.get('mode') : null;
	// Frames only: the used color-scheme of the element embedding this frame. Chrome paints an
	// iframe's canvas opaque when its root's used scheme differs from the embedder's, so the
	// frame adopts the page's scheme verbatim; the palette (data-theme) is decided separately.
	const scheme = ['dark', 'light'].includes(params.get('scheme')) ? params.get('scheme') : null;
	if (scheme) document.documentElement.style.colorScheme = scheme;

	function systemIsDark() {
		try { return window.matchMedia('(prefers-color-scheme: dark)').matches; }
		catch (e) { return false; }
	}
	function stored() {
		try { const v = localStorage.getItem(KEY); return MODES.includes(v) ? v : 'contrast'; }
		catch (e) { return 'contrast'; }
	}
	function resolve(mode, hostScheme, systemDark) {
		if (mode === 'dark' || mode === 'light') return mode;
		if (mode === 'system') return systemDark ? 'dark' : 'light';
		const base = hostScheme || (systemDark ? 'dark' : 'light');
		return base === 'dark' ? 'light' : 'dark';
	}
	function apply(mode) {
		const theme = resolve(mode || urlMode || stored(), host, systemIsDark());
		document.documentElement.setAttribute('data-theme', theme);
		return theme;
	}

	window.AbstractusTheme = {
		KEY, MODES, host, scheme, resolve, apply,
		get mode() { return urlMode || stored(); },
		get theme() { return document.documentElement.getAttribute('data-theme'); },
		set(mode) {
			if (!MODES.includes(mode)) throw new Error('Unknown appearance: ' + mode);
			try { localStorage.setItem(KEY, mode); } catch (e) {}
			return apply(mode);
		}
	};

	apply();
	try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => apply()); } catch (e) {}
	window.addEventListener('storage', e => { if (e.key === KEY) apply(); });
})();
