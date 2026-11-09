(function () {
	const KEY = 'abstractus.appearance';
	const MODES = ['contrast', 'dark', 'light', 'system'];
	const params = new URLSearchParams(location.search);
	const host = ['dark', 'light'].includes(params.get('host')) ? params.get('host') : null;
	const urlMode = MODES.includes(params.get('mode')) ? params.get('mode') : null;
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
