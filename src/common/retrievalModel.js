(function (root) {
	const TWO_PART_SUFFIXES = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'edu.au', 'org.au',
		'co.jp', 'ac.jp', 'com.cn', 'edu.cn', 'co.nz', 'ac.nz', 'com.br', 'co.za', 'co.in', 'ac.in']);

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
	const HARD_WARNINGS = [/too many requests/i, /unusual traffic/i, /access denied/i, /automated/i];
	const CHALLENGE_FRAMES = /(recaptcha|hcaptcha|challenges\.cloudflare\.com|captcha-delivery|px-captcha|arkoselabs|funcaptcha)/i;
	const LOGIN_TITLES = [/^sign in/i, /^log ?in\b/i, /institutional (login|access)/i, /select your institution/i,
		/find your institution/i, /shibboleth/i, /openathens/i, /^access through your institution/i];
	const LOGIN_URLS = /(\/login\b|\/signin\b|\/sign-in\b|\/auth\/|shibboleth|\/idp\/|openathens\.net|\/wayf\b|ezproxy[^/]*\/login|\/cas\/login|id\.elsevier\.com)/i;
	const PURCHASE_TEXT = [/purchase (this )?(article|pdf|chapter|content)/i, /\bget access\b/i, /\bbuy (this )?(article|pdf|chapter)/i,
		/rent or buy/i, /\bsubscribe to (read|view|access)/i, /access (this|the) (article|content) (through|via|with)/i,
		/you do not have access/i, /sign in to (read|view|download|access)/i];

	function classifyPage(info) {
		info = info || {};
		const title = String(info.title || '');
		const shortTitle = title.length <= 70;
		const shortPage = Number(info.textLength || String(info.text || '').length) < 2500;
		const text = shortPage ? String(info.text || '').slice(0, 2500) : '';
		const status = Number(info.status || 0);
		if (status === 429) return {kind: 'challenge', reason: 'check_429', hard: true};
		if (!info.articleFound) {
			const hard = () => (shortTitle && HARD_WARNINGS.some(re => re.test(title)))
				|| (shortPage && HARD_WARNINGS.some(re => re.test(text)));
			if (shortPage && (info.frames || []).some(src => CHALLENGE_FRAMES.test(String(src)))) {
				return {kind: 'challenge', reason: 'check_frame', hard: false};
			}
			if (shortTitle && CHALLENGE_TITLES.some(re => re.test(title))) return {kind: 'challenge', reason: 'check_title', hard: hard()};
			if (CHALLENGE_TEXT.some(re => re.test(text))) return {kind: 'challenge', reason: 'check_text', hard: hard()};
		}
		if (status === 401 || status === 402 || status === 403) return {kind: 'no_access', reason: 'status_' + status};
		if (info.hasPassword) return {kind: 'no_access', reason: 'password_field'};
		if (LOGIN_TITLES.some(re => re.test(title)) && LOGIN_URLS.test(String(info.url || ''))) {
			return {kind: 'no_access', reason: 'login_page'};
		}
		const head = String(info.text || '').slice(0, 2500);
		if (PURCHASE_TEXT.some(re => re.test(head))) return {kind: 'no_access', reason: 'purchase'};
		return {kind: 'none', reason: ''};
	}

	function attachmentStatus(error) {
		const m = /HTTP status (\d{3})/.exec(String(error && error.message || ''));
		return m ? Number(m[1]) : 0;
	}

	function endReason(e) {
		e = e || {};
		const classified = String(e.classified || '');
		const pdfStatus = Number(e.pdfStatus || 0);
		switch (e.outcome) {
			case 'saved': return e.fallbackSaved ? 'fallback_saved' : '';
			case 'blocked': return 'blocked';
			case 'challenge': {
				if (e.blocked || classified === 'check_429' || pdfStatus === 429) return 'blocked';
				const sub = String(e.checkReason || classified);
				return /^check_(title|text|frame|429)$/.test(sub) ? sub : 'check_not_cleared';
			}
			case 'limit_done': return 'limit';
			case 'violation': return e.violationReason === 'blocked_site' ? 'blocked_site' : 'off_allowlist';
			case 'error': return 'load_failed';
			case 'no_access':
				if (e.sawPurchase || classified === 'purchase') return 'purchase';
				if (classified === 'login_page' || classified === 'password_field') return classified;
				if ([401, 403, 503].includes(pdfStatus)) return 'pdf_refused_' + pdfStatus;
				return /^status_(401|402|403)$/.test(classified) ? classified : 'purchase';
			default:
				if (e.pageGone) return 'load_failed';
				if ([401, 403, 503].includes(pdfStatus)) return 'pdf_refused_' + pdfStatus;
				return e.translatorSaved ? 'saved_without_pdf' : 'no_translator';
		}
	}


	const INTERSTITIAL_HOSTS = new Set(['linkinghub.elsevier.com']);
	const INTERSTITIAL_TEXT = /\b(redirecting|please wait|you (are|will be) (being )?redirected|taking you to)\b/i;
	function isInterstitial(info) {
		info = info || {};
		try {
			if (INTERSTITIAL_HOSTS.has(new URL(String(info.url || '')).hostname.toLowerCase())) return true;
		}
		catch { }
		const text = String(info.text || '');
		const length = Number(info.textLength || text.length);
		return length > 0 && length < 200 && INTERSTITIAL_TEXT.test(text);
	}

	function createStatusTracker() {
		const seen = new Map();
		const bare = url => String(url || '').split('#')[0];
		return {
			record(tabId, status, url) { seen.set(tabId, {status: Number(status) || 0, url: bare(url)}); },
			get(tabId, currentUrl) {
				const entry = seen.get(tabId);
				if (!entry) return 0;
				if (entry.url && currentUrl && entry.url !== bare(currentUrl)) return 0;
				return entry.status;
			},
			navigated(tabId, newUrl) {
				const entry = seen.get(tabId);
				if (entry && entry.url && bare(newUrl) !== entry.url) seen.delete(tabId);
			},
			reset(tabId) { seen.delete(tabId); }
		};
	}

	const PDF_HREF = /pdf|showPdf|pdfdirect|printable|\.pdf(\?|$)/i;
	const PDF_TEXT = /^\s*(download |view |get |open |full[- ]text )?pdf\b/i;
	const PDF_HOSTS = new Set(['sciencedirectassets.com', 'els-cdn.com', 'sciencedirect.com']);

	function safeHttp(raw, base) {
		try {
			const u = new URL(String(raw || '').trim(), base);
			return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
		}
		catch { return null; }
	}

	const NOT_ID_SEGMENTS = new Set(['full', 'fulltext', 'full-text', 'abstract', 'abs', 'pdf', 'epdf', 'pdfdirect',
		'pdfft', 'html', 'article', 'articles', 'references', 'figures', 'tables', 'citedby', 'meta', 'info',
		'supplementary-material', 'supplementary', 'read', 'view', 'show']);
	const norm = s => String(s || '').toLowerCase();
	const normPii = s => String(s || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
	function decoded(s) {
		try { return decodeURIComponent(s); } catch { return String(s); }
	}
	function cleanDoi(d) {
		d = norm(decoded(d)).replace(/[\s"'<>)\].,;]+$/, '').replace(/\.(pdf|html?|xml|epub)$/, '');
		let prev;
		do {
			prev = d;
			d = d.replace(/\/(full|fulltext|abstract|abs|pdf|epdf|pdfdirect|html|references|figures|tables|citedby|meta|info|supplementary-material|file)$/, '');
		} while (d !== prev);
		return d;
	}
	function extractIds(str) {
		const out = {pii: new Set(), doi: new Set(), pmc: new Set()};
		const s = decoded(String(str || ''));
		for (const m of s.matchAll(/(?:^|[^\d])(10\.\d{4,9}\/[^\s?&#"'<>]+)/g)) {
			const d = cleanDoi(m[1]);
			if (d.length > 8) {
				out.doi.add(d);
				const noVersion = d.replace(/v\d+$/, '');
				if (noVersion !== d) out.doi.add(noVersion);
			}
		}
		for (const m of s.matchAll(/\/pii\/([A-Za-z0-9()-]+)/gi)) out.pii.add(normPii(m[1]));
		for (const m of s.matchAll(/[?&]pii=([^&#]+)/gi)) out.pii.add(normPii(m[1]));
		for (const m of s.matchAll(/(?:^|[/=])(S\d{4}-?\d{3}[\dX][A-Za-z0-9()-]*)/gi)) out.pii.add(normPii(m[1]));
		for (const m of s.matchAll(/PMC\d{4,}/gi)) out.pmc.add(m[0].toUpperCase());
		return out;
	}
	function pathTails(pathname) {
		const segs = decoded(pathname).split('/').filter(Boolean)
			.map(s => s.replace(/\.(pdf|html?|xml)$/i, '').replace(/\.full$/i, ''))
			.filter(s => s && !NOT_ID_SEGMENTS.has(s.toLowerCase()));
		if (!segs.length) return [];
		const tails = [];
		const last = segs[segs.length - 1];
		if (segs.length >= 2 && /\d/.test(last)) tails.push(segs.slice(-4).join('/').toLowerCase());
		if (/\d/.test(last) && last.length >= 5 && !/^10\.\d+$/.test(last)) tails.push(last.toLowerCase());
		return tails;
	}
	function idSegments(pathname) {
		const segs = decoded(pathname || '').split('/').filter(Boolean)
			.map(x => x.replace(/\.(pdf|html?|xml)$/i, '').replace(/\.full$/i, '').toLowerCase()).filter(Boolean);
		while (segs.length && NOT_ID_SEGMENTS.has(segs[segs.length - 1])) segs.pop();
		return segs;
	}
	function ownIdentity(pageUrl, idStrings) {
		const own = {pii: new Set(), doi: new Set(), pmc: new Set(), tails: [], pagePath: ''};
		const url = safeHttp(pageUrl);
		own.pagePath = url ? url.pathname : '';
		const sources = (idStrings || []).map(String);
		if (url) sources.push(url.pathname + url.search);
		for (const src of sources) {
			const ids = extractIds(src);
			for (const k of ['pii', 'doi', 'pmc']) ids[k].forEach(v => own[k].add(v));
		}
		if (url) own.tails = pathTails(url.pathname).filter(t => !/^10\./.test(t));
		return own;
	}
	function hasBoundary(hay, needle) {
		for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) {
			const before = i === 0 ? '' : hay[i - 1];
			const rest = hay.slice(i + needle.length);
			const afterOk = !rest || !/^[a-z0-9-]/.test(rest) || /^v\d+(?![a-z0-9])/.test(rest);
			if (afterOk && !/[a-z0-9]/.test(before)) return true;
		}
		return false;
	}
	function judgeLink(u, own) {
		const hay = norm(decoded(u.pathname + u.search));
		const ids = extractIds(u.pathname + u.search);
		let sawOther = false;
		for (const kind of ['pii', 'doi', 'pmc']) {
			if (!own[kind].size || !ids[kind].size) continue;
			const mine = [...own[kind]].some(o => kind === 'doi' ? hasBoundary(hay, o) : ids[kind].has(o));
			if (mine) return 'own';
			sawOther = true;
		}
		if (sawOther) return 'other';
		if (own.doi.size && [...own.doi].some(o => hasBoundary(hay, o))) return 'own';
		if (own.tails.some(t => hasBoundary(hay, t))) return 'own';
		const mine = idSegments(own.pagePath), theirs = idSegments(u.pathname);
		if (mine.length >= 2 && theirs.length >= 2 && mine[0] === theirs[0]) {
			const a = mine[mine.length - 1], b = theirs[theirs.length - 1];
			if (/\d/.test(a) && /\d/.test(b) && a !== b) return 'other';
		}
		return 'none';
	}
	const anyOwn = own => own.pii.size || own.doi.size || own.pmc.size || own.tails.length;

	function choosePdfLink(input) {
		input = input || {};
		const pageDomain = registrableDomain((safeHttp(input.pageUrl) || {}).hostname);
		const ok = u => {
			if (!u) return false;
			const d = registrableDomain(u.hostname);
			return !!d && (d === pageDomain || PDF_HOSTS.has(d));
		};
		const own = ownIdentity(input.pageUrl, input.ids);
		const known = !!anyOwn(own);
		for (const raw of input.meta || []) {
			const u = safeHttp(raw, input.pageUrl);
			if (ok(u) && !(known && judgeLink(u, own) === 'other')) return {url: u.href, source: 'meta'};
		}
		const page = safeHttp(input.pageUrl);
		const cands = [];
		for (const link of input.links || []) {
			const u = safeHttp(link && link.href, input.pageUrl);
			if (!ok(u)) continue;
			if (page && u.origin + u.pathname + u.search === page.origin + page.pathname + page.search) continue;
			const text = String(link.text || '').slice(0, 80);
			const aria = String(link.aria || '').slice(0, 80);
			cands.push({u, byText: PDF_TEXT.test(text) || PDF_TEXT.test(aria),
				byHref: PDF_HREF.test(u.pathname + u.search), main: link.region !== 'other',
				verdict: known ? judgeLink(u, own) : 'none'});
		}
		const live = cands.filter(c => c.verdict !== 'other');
		const byId = live.filter(c => c.verdict === 'own' && c.byHref);
		if (byId.length) {
			byId.sort((a, b) => (b.main - a.main) || (b.byText - a.byText));
			return {url: byId[0].u.href, source: 'link'};
		}
		const byText = live.filter(c => c.byText && c.main);
		if (byText.length) {
			byText.sort((a, b) => b.byHref - a.byHref);
			return {url: byText[0].u.href, source: 'link'};
		}
		return null;
	}

	function fallbackAllowed(outcome, e) {
		e = e || {};
		if (e.blocked || e.fallbackTried) return false;
		if (/^(login_page|password_field)$/.test(String(e.classified || ''))) return false;
		const reason = endReason(Object.assign({}, e, {outcome}));
		return ['purchase', 'saved_without_pdf', 'no_translator'].includes(reason);
	}

	function originPath(url) {
		const u = safeHttp(url);
		return u ? u.origin + u.pathname : '';
	}
	const DIAG_MAX = 2000;
	function buildDiag(e, classifiedReason) {
		e = e || {};
		const diag = {
			final_url: originPath(e.finalUrl).slice(0, 300),
			title: String(e.title || '').slice(0, 120),
			translator: e.translator ? String(e.translator).slice(0, 120) : null,
			is_pdf: !!e.isPDF,
			saw_purchase: !!e.sawPurchase,
			status: Number(e.statusUsed || 0),
			classified_reason: String(classifiedReason || e.classified || '').slice(0, 40),
			pdf_link: originPath(e.pdfLink).slice(0, 300),
			fallback_tried: !!e.fallbackTried,
			fallback_result: String(e.fallbackResult || '').slice(0, 60)
		};
		if (e.interstitial) diag.interstitial = true;
		if (e.offDomain) diag.off_domain = String(e.offDomain).slice(0, 120);
		while (JSON.stringify(diag).length > DIAG_MAX) {
			const key = ['final_url', 'pdf_link', 'title', 'translator'].sort((a, b) => String(diag[b] || '').length - String(diag[a] || '').length)[0];
			if (!diag[key]) break;
			diag[key] = String(diag[key]).slice(0, Math.floor(String(diag[key]).length / 2));
		}
		return diag;
	}

	function clampPollMs(ms) {
		return Math.min(15000, Math.max(2000, Number(ms) || 3000));
	}

	const api = {registrableDomain, classifyPage, attachmentStatus, clampPollMs, endReason,
		isInterstitial, createStatusTracker, choosePdfLink, fallbackAllowed, buildDiag};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	if (root.Zotero) root.Zotero.RetrievalModel = api;
	else root.AbstractusRetrievalModel = api;
})(typeof self !== 'undefined' ? self : this);
