// Abstractus: pure rules for paced PDF retrieval. No browser APIs, so they can be tested alone.
// The page classifier only RECOGNISES bot checks, CAPTCHAs and login walls so the queue can
// hand real checks to the user and skip paywalls. Nothing here solves, skips or works around one.
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
	// Plain warnings (not a check a person can pass): the publisher told us to stop.
	const HARD_WARNINGS = [/too many requests/i, /unusual traffic/i, /access denied/i, /automated/i];
	const CHALLENGE_FRAMES = /(recaptcha|hcaptcha|challenges\.cloudflare\.com|captcha-delivery|px-captcha|arkoselabs|funcaptcha)/i;
	const LOGIN_TITLES = [/^sign in/i, /^log ?in\b/i, /institutional (login|access)/i, /select your institution/i,
		/find your institution/i, /shibboleth/i, /openathens/i, /^access through your institution/i];
	const LOGIN_URLS = /(\/login\b|\/signin\b|\/sign-in\b|\/auth\/|shibboleth|\/idp\/|openathens\.net|\/wayf\b|ezproxy[^/]*\/login|\/cas\/login|id\.elsevier\.com)/i;
	const PURCHASE_TEXT = [/purchase (this )?(article|pdf|chapter|content)/i, /\bget access\b/i, /\bbuy (this )?(article|pdf|chapter)/i,
		/rent or buy/i, /\bsubscribe to (read|view|access)/i, /access (this|the) (article|content) (through|via|with)/i,
		/you do not have access/i, /sign in to (read|view|download|access)/i];

	// info: {url, title, text, frames: [src...], hasPassword, status}
	// Also: articleFound (a translator or PDF was detected on the tab).
	// Returns {kind: 'challenge'|'no_access'|'none', reason, hard}. hard means a publisher warning.
	// 'challenge' is only a real bot or robot check. Sign-in walls, institutional logins, purchase
	// pages and 401/402/403 answers that are not bot checks are 'no_access' (the user has no right
	// to the paper; nothing for them to do in the browser).
	function classifyPage(info) {
		info = info || {};
		const title = String(info.title || '');
		// Article titles and bodies can mention these words, so only short titles and short
		// pages (a real check page is tiny) are read as checks.
		const shortTitle = title.length <= 70;
		const shortPage = Number(info.textLength || String(info.text || '').length) < 2500;
		const text = shortPage ? String(info.text || '').slice(0, 2500) : '';
		const status = Number(info.status || 0);
		if (status === 429) return {kind: 'challenge', reason: 'check_429', hard: true};
		// A translator (or a PDF viewer) found an article, so this is an article page, not a check page.
		// Many article pages carry an invisible reCAPTCHA or Turnstile widget; that alone is no check.
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

	// The attachment fetch error text from itemSaver_background: a 403/429 on the PDF means a block.
	function attachmentStatus(error) {
		const m = /HTTP status (\d{3})/.exec(String(error && error.message || ''));
		return m ? Number(m[1]) : 0;
	}

	// Why a paper ended the way it did, as a short code for the desktop. Only describes what
	// happened. e: {outcome, classified, checkReason, blocked, sawPurchase, translatorSaved, pdfStatus, pageGone}
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
			default: // no_pdf
				if (e.pageGone) return 'load_failed';
				if ([401, 403, 503].includes(pdfStatus)) return 'pdf_refused_' + pdfStatus;
				return e.translatorSaved ? 'saved_without_pdf' : 'no_translator';
		}
	}


	// ---- interstitials: "Redirecting" pages that hand the tab on to the real article ----

	const INTERSTITIAL_HOSTS = new Set(['linkinghub.elsevier.com']);
	const INTERSTITIAL_TEXT = /\b(redirecting|please wait|you (are|will be) (being )?redirected|taking you to)\b/i;
	// info: {url, text, textLength}. A tiny page that says "Redirecting", or a known hand-off host.
	function isInterstitial(info) {
		info = info || {};
		try {
			if (INTERSTITIAL_HOSTS.has(new URL(String(info.url || '')).hostname.toLowerCase())) return true;
		}
		catch { /* no usable URL: fall through to the text */ }
		const text = String(info.text || '');
		const length = Number(info.textLength || text.length);
		return length > 0 && length < 200 && INTERSTITIAL_TEXT.test(text);
	}

	// ---- the main-frame HTTP status, tied to the document it came from ----

	// record(tabId, status, url) from the response; get(tabId, currentUrl) gives the status only if
	// the tab is still on that document. A cleared check's old 403 can never describe a new page.
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
			// The tab went to a new URL: whatever was recorded belongs to the old document.
			navigated(tabId, newUrl) {
				const entry = seen.get(tabId);
				if (entry && entry.url && bare(newUrl) !== entry.url) seen.delete(tabId);
			},
			reset(tabId) { seen.delete(tabId); }
		};
	}

	// ---- the "click View PDF" step ----

	const PDF_HREF = /pdf|showPdf|pdfdirect|printable|\.pdf(\?|$)/i;
	const PDF_TEXT = /^\s*(download |view |get |open |full[- ]text )?pdf\b/i;
	// Hosts that serve a publisher's PDFs from another domain.
	const PDF_HOSTS = new Set(['sciencedirectassets.com', 'els-cdn.com', 'sciencedirect.com']);

	function safeHttp(raw, base) {
		try {
			const u = new URL(String(raw || '').trim(), base);
			return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
		}
		catch { return null; }
	}

	// ---- the page's own article identifiers, read the same way from the page and from links ----
	// Kinds: pii (Elsevier), doi, pmc, and path "tails" (the last path segments, for publishers whose
	// PDF link repeats the article path). Nothing here is publisher-specific.
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
	// Everything identifier-like in one string (a URL's path+query, or a meta value).
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
	// The last stable path segments of a URL, e.g. ["12/5/1234", "bmj.n1"].
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
	// 'own': carries this article's identifier. 'other': carries a different identifier of a kind the
	// page also has. 'none': nothing to compare.
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
		// Same path shape as the page, but a different article id at the end: another article.
		const mine = idSegments(own.pagePath), theirs = idSegments(u.pathname);
		if (mine.length >= 2 && theirs.length >= 2 && mine[0] === theirs[0]) {
			const a = mine[mine.length - 1], b = theirs[theirs.length - 1];
			if (/\d/.test(a) && /\d/.test(b) && a !== b) return 'other';
		}
		return 'none';
	}
	const anyOwn = own => own.pii.size || own.doi.size || own.pmc.size || own.tails.length;

	// in: {pageUrl, meta: [citation_pdf_url...], ids: [citation_doi, dc.identifier, citation_pii...],
	//      links: [{href, text, aria, region: 'main'|'other'}]}
	// out: {url, source: 'meta'|'link'} or null. Same registrable domain as the page, or a known PDF host.
	// Order: citation_pdf_url, then a PDF link carrying THIS article's identifier, then a "View PDF"
	// style link in the main article region. A link with a different article's identifier is never
	// chosen. When nothing is confidently this article's, the answer is null.
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

	// Run the PDF-link step? Only for the ends a person could fix by clicking View PDF, and never after
	// a login wall or a publisher warning. e: the evidence from the paper (see endReason).
	function fallbackAllowed(outcome, e) {
		e = e || {};
		if (e.blocked || e.fallbackTried) return false;
		if (/^(login_page|password_field)$/.test(String(e.classified || ''))) return false;
		const reason = endReason(Object.assign({}, e, {outcome}));
		return ['purchase', 'saved_without_pdf', 'no_translator'].includes(reason);
	}

	// ---- the diagnostics object sent with the final report ----

	function originPath(url) {
		const u = safeHttp(url);
		return u ? u.origin + u.pathname : '';
	}
	const DIAG_MAX = 2000;
	// e: evidence collected while working a paper. No query strings, cookies or page text.
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
		// Hold the size: shrink the longest strings until it fits.
		while (JSON.stringify(diag).length > DIAG_MAX) {
			const key = ['final_url', 'pdf_link', 'title', 'translator'].sort((a, b) => String(diag[b] || '').length - String(diag[a] || '').length)[0];
			if (!diag[key]) break;
			diag[key] = String(diag[key]).slice(0, Math.floor(String(diag[key]).length / 2));
		}
		return diag;
	}

	// Defaults mirror the desktop, which enforces them; this only guards the extension's own timers.
	function clampPollMs(ms) {
		return Math.min(15000, Math.max(2000, Number(ms) || 3000));
	}

	const api = {registrableDomain, classifyPage, attachmentStatus, clampPollMs, endReason,
		isInterstitial, createStatusTracker, choosePdfLink, fallbackAllowed, buildDiag};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	if (root.Zotero) root.Zotero.RetrievalModel = api;
	else root.AbstractusRetrievalModel = api;
})(typeof self !== 'undefined' ? self : this);
