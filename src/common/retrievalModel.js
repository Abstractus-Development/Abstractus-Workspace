// Abstractus: pure rules for paced PDF retrieval. No browser APIs, so they can be tested alone.
// The page classifier only RECOGNISES bot checks, CAPTCHAs and login walls so the queue can
// hand the page to the user. Nothing here solves, skips or works around one.
(function (root) {
	const TWO_PART_SUFFIXES = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'edu.au', 'org.au',
		'co.jp', 'ac.jp', 'com.cn', 'edu.cn', 'co.nz', 'ac.nz', 'com.br', 'co.za', 'co.in', 'ac.in']);

	// "www.sciencedirect.com" -> "sciencedirect.com"; "journals.sagepub.com" -> "sagepub.com"
	function registrableDomain(host) {
		host = String(host || '').toLowerCase().replace(/\.$/, '');
		if (!host || /^[\d.]+$/.test(host) || host.includes(':')) return '';
		const labels = host.split('.');
		if (labels.length < 2) return '';
		const last2 = labels.slice(-2).join('.');
		if (TWO_PART_SUFFIXES.has(last2) && labels.length >= 3) return labels.slice(-3).join('.');
		return last2;
	}

	const CHALLENGE_TITLES = [
		/^just a moment/i, /attention required/i, /access denied/i, /are you a robot/i,
		/robot check/i, /human verification/i, /verify you are (a )?human/i, /pardon our interruption/i,
		/checking your browser/i, /^security check/i, /request unsuccessful/i, /^captcha/i,
		/unusual traffic/i, /too many requests/i
	];
	const CHALLENGE_TEXT = [
		/unusual traffic/i, /verify (that )?you are (a )?human/i, /are you a robot/i,
		/checking (if the site connection is secure|your browser)/i, /press (and|&) hold/i,
		/complete the (security )?check/i, /enable javascript and cookies to continue/i,
		/automated (access|queries|requests)/i, /confirm you are not a robot/i, /i'?m not a robot/i,
		/our systems have detected/i
	];
	const CHALLENGE_FRAMES = /(recaptcha|hcaptcha|challenges\.cloudflare\.com|captcha-delivery|px-captcha|arkoselabs|funcaptcha)/i;
	const LOGIN_TITLES = [/^sign in/i, /^log ?in\b/i, /institutional (login|access)/i, /select your institution/i,
		/find your institution/i, /shibboleth/i, /openathens/i, /^access through your institution/i];
	const LOGIN_URLS = /(\/login\b|\/signin\b|\/sign-in\b|\/auth\/|shibboleth|\/idp\/|openathens\.net|\/wayf\b|ezproxy[^/]*\/login|\/cas\/login)/i;

	// info: {url, title, text, frames: [src...], hasPassword, status}
	// Returns {kind: 'challenge'|'login'|'none', reason}
	function classifyPage(info) {
		info = info || {};
		const title = String(info.title || '');
		// Article titles and bodies can mention these words, so only short titles and short
		// pages (a real check page is tiny) are read as checks.
		const shortTitle = title.length <= 70;
		const shortPage = Number(info.textLength || String(info.text || '').length) < 2500;
		const text = shortPage ? String(info.text || '').slice(0, 2500) : '';
		const status = Number(info.status || 0);
		if (status === 429) return {kind: 'challenge', reason: 'too_many_requests'};
		if (status === 403 || status === 503) {
			// A plain 403 or 503 with a bot-check look
			if ((shortTitle && CHALLENGE_TITLES.some(re => re.test(title))) || CHALLENGE_TEXT.some(re => re.test(text))) {
				return {kind: 'challenge', reason: 'status_' + status};
			}
		}
		if ((info.frames || []).some(src => CHALLENGE_FRAMES.test(String(src)))) {
			return {kind: 'challenge', reason: 'captcha_frame'};
		}
		if (shortTitle && CHALLENGE_TITLES.some(re => re.test(title))) return {kind: 'challenge', reason: 'title'};
		if (CHALLENGE_TEXT.some(re => re.test(text))) return {kind: 'challenge', reason: 'text'};
		if (info.hasPassword) return {kind: 'login', reason: 'password_field'};
		if (LOGIN_TITLES.some(re => re.test(title)) && LOGIN_URLS.test(String(info.url || ''))) {
			return {kind: 'login', reason: 'login_page'};
		}
		return {kind: 'none', reason: ''};
	}

	// The attachment fetch error text from itemSaver_background: a 403/429 on the PDF means a block.
	function attachmentStatus(error) {
		const m = /HTTP status (\d{3})/.exec(String(error && error.message || ''));
		return m ? Number(m[1]) : 0;
	}

	// Defaults mirror the desktop, which enforces them; this only guards the extension's own timers.
	function clampPollMs(ms) {
		return Math.min(15000, Math.max(2000, Number(ms) || 3000));
	}

	const api = {registrableDomain, classifyPage, attachmentStatus, clampPollMs};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	if (root.Zotero) root.Zotero.RetrievalModel = api;
	else root.AbstractusRetrievalModel = api;
})(typeof self !== 'undefined' ? self : this);
