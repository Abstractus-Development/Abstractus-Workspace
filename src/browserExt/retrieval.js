/*
	Abstractus: paced PDF retrieval, browser side. AGPL-3.0-or-later, like the rest of this fork.

	The user presses Start in Abstractus Desktop; this module notices (on browser start, tab
	activity and a slow alarm that only runs while the desktop answers) and works the queue ONE
	paper at a time in a normal browser window that opens behind the others (unfocused, so it runs at full speed),
	using the user's own access. A bot check first gets 30 seconds to finish by itself; if it is
	still there the window comes forward for up to 90 seconds for the user. A plain warning from the
	publisher (too many requests, access denied) stops that publisher for the run. Sign-in and
	paywall pages are just "no access":

	  - no headless browsing, no spoofed headers, no proxy rotation, no random delays
	  - the desktop owns pacing (delay between papers, daily cap per publisher); we only obey it
	  - a CAPTCHA or bot check is never solved or bypassed: we focus the window, wait for the user
	    to finish it, and move on if they do not
	  - bot bypass is switched off for the tabs this module opens
	  - the PDF is saved only by the connector's normal translator/attachment path

	Nothing polls the desktop while no queue is active. Hook points are listed in
	UPSTREAM-SYNC.md.
*/
Zotero.Retrieval = new function () {
	const M = Zotero.RetrievalModel;
	const S = Zotero.SiteBlocklist; // hard blocklist and the allowlist for automatic retrieval
	const PROXY_KEY = 'abstractusRetrievalProxy';
	const POLL_MS = 3000;
	const LOAD_TIMEOUT_MS = 45000;
	const DETECT_TIMEOUT_MS = 20000;
	const CONTROL_PAGE = 'retrieval/retrieval.html';
	const CHALLENGE_WAIT_MS = 90000;
	const AUTO_CHECK_WAIT_MS = 30000;
	const AUTO_THROTTLE_MS = 10000;
	const ALARM_NAME = 'abstractus-retrieval';
	const ALARM_PERIOD_MIN = 0.5; // 30 s

	let active = false;
	let installed = false;
	let watch = null; // {tabId, pdfSession, status}
	let abort = false;
	let lastAutoCheck = 0;
	let opening = null;
	const statusSeen = M.createStatusTracker(); // main-frame HTTP status, tied to the document it came from
	const INTERSTITIAL_WAIT_MS = 10000;
	const FALLBACK_WAIT_MS = 30000;
	let view = {queue: 'idle', phase: 'idle', done: 0, total: 0, message: '', title: ''};
	let controlWindowId = null;

	const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

	async function desktop(method, route, body, query) {
		const options = {method: 'retrieval/' + route, timeout: 10000};
		if (query) options.queryString = query;
		return Zotero.Connector.callMethod(options, method === 'GET' ? null : (body || {}));
	}

	function setView(patch) {
		view = Object.assign({}, view, patch);
	}

	// ---- observers: the connector's own attachment path, watched, never replaced ----

	function install() {
		if (installed) return;
		installed = true;
		const saver = Zotero.ItemSaver;
		for (const name of ['saveAttachmentToZotero', 'saveStandaloneAttachmentToZotero']) {
			const original = saver[name];
			saver[name] = async function (attachment, sessionID, tab) {
				const mine = watch && tab && tab.id === watch.tabId;
				try {
					const result = await original.apply(this, arguments);
					// The desktop only stores real PDFs, so a successful save is a PDF.
					if (mine && watch) watch.pdfSession = sessionID;
					return result;
				}
				catch (e) {
					if (mine && watch) watch.status = M.attachmentStatus(e) || watch.status;
					throw e;
				}
			};
		}
		// Retrieval tabs never use the upstream "bot bypass". If a publisher blocks the download,
		// the page goes to the user instead.
		const fetchAttachment = saver._fetchAttachment;
		saver._fetchAttachment = function (attachment, tab, attemptBotProtectionBypass = true) {
			if (watch && tab && tab.id === watch.tabId) attemptBotProtectionBypass = false;
			return fetchAttachment.call(this, attachment, tab, attemptBotProtectionBypass);
		};
		Zotero.WebRequestIntercept.addListener('headersReceived', function (details) {
			if (details.type === 'main_frame' && Number.isInteger(details.tabId) && details.tabId >= 0) {
				statusSeen.record(details.tabId, details.statusCode, details.url);
			}
		});
		// A tab that moves to a new URL starts a new document; the old status is not its status.
		browser.tabs.onUpdated.addListener((tabId, change) => {
			if (change && change.url) { statusSeen.navigated(tabId, change.url); observe(tabId, change.url, 'load'); }
		});
		// Allowlist: every redirect hop and every navigation of the paper's tab is checked as it starts.
		// Nothing is cancelled here (MV3 cannot); the tab is sent to a blank page the moment it leaves the set.
		if (browser.webRequest && browser.webRequest.onBeforeRedirect) {
			browser.webRequest.onBeforeRedirect.addListener(details => {
				if (details.type === 'main_frame') observe(details.tabId, details.redirectUrl, 'redirect');
			}, {urls: ['<all_urls>'], types: ['main_frame']});
		}
		if (browser.webNavigation && browser.webNavigation.onBeforeNavigate) {
			browser.webNavigation.onBeforeNavigate.addListener(details => {
				if (details.frameId === 0) observe(details.tabId, details.url, 'navigate');
			});
		}
		// Content scripts on the paper's tab hear nothing once the paper has left the allowed set.
		S.setTabVeto((tabId, url) => {
			const w = watch;
			if (!w || w.tabId !== tabId || !w.guard) return '';
			if (w.violation) return w.violation.reason;
			return w.guard.peek(url) ? '' : 'off_allowlist';
		});
	}

	// ---- the allowlist for automatic retrieval ----

	function violate(w, r) {
		if (w.violation) return;
		w.violation = {reason: r.reason, domain: r.domain || ''};
		abort = true;
		Promise.resolve(browser.tabs.update(w.tabId, {url: 'about:blank'})).catch(() => {});
	}

	function observe(tabId, url, kind) {
		const w = watch;
		if (!w || w.tabId !== tabId || !w.guard || w.violation || !url) return;
		if (/^(about:|chrome-error:)/i.test(url)) return;
		const r = w.guard.check(url, kind);
		if (!r.ok) violate(w, r);
	}

	async function loadProxy() {
		try {
			if (!browser.storage || !browser.storage.local) return '';
			const stored = await browser.storage.local.get(PROXY_KEY);
			const v = S.validateProxyHost(stored && stored[PROXY_KEY]);
			return v.ok ? v.host : '';
		}
		catch { return ''; }
	}

	// Setting for the control window. '' clears it. Returns {ok, host, error}.
	async function setProxy(value) {
		const raw = String(value || '').trim();
		if (!raw) {
			try { await browser.storage.local.remove(PROXY_KEY); } catch { /* nothing stored */ }
			return {ok: true, host: '', error: ''};
		}
		const v = S.validateProxyHost(raw);
		if (v.ok) await browser.storage.local.set({[PROXY_KEY]: v.host});
		return v;
	}

	// ---- page inspection (read-only) ----

	async function inspect(tabId) {
		let tab;
		try { tab = await browser.tabs.get(tabId); } catch { return null; }
		let page = {};
		try {
			const [result] = await browser.scripting.executeScript({
				target: {tabId},
				func: () => {
					const text = (document.body && document.body.innerText) || '';
					const visible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
					return {
						title: document.title || '',
						text: text.slice(0, 2500),
						textLength: text.length,
						frames: Array.from(document.querySelectorAll('iframe')).map(f => f.src || '').slice(0, 30),
						hasPassword: Array.from(document.querySelectorAll('input[type=password]')).some(visible) && text.length < 4000
					};
				}
			});
			page = (result && result.result) || {};
		}
		catch { /* an error page or a PDF viewer cannot be read; the URL and status still help */ }
		observe(tabId, tab.url, 'load');
		return Object.assign(page, {url: tab.url || '', status: statusSeen.get(tabId, tab.url), tabStatus: tab.status});
	}

	// ---- one paper ----

	async function waitForLoad(tabId, timeoutMs) {
		const until = Date.now() + (timeoutMs || LOAD_TIMEOUT_MS);
		while (Date.now() < until && !abort) {
			let tab;
			try { tab = await browser.tabs.get(tabId); } catch { return null; }
			if (tab.status === 'complete' && tab.url && !tab.url.startsWith('about:')) return tab;
			await sleep(500);
		}
		try { return await browser.tabs.get(tabId); } catch { return null; }
	}

	// The first page can be a hand-off ("Redirecting" on linkinghub.elsevier.com). Give it up to 10 s to
	// move on to the article and load again before the domain is read. Returns {tab, interstitial}.
	async function settle(tabId, loaded) {
		const page = await inspect(tabId);
		if (!page || !M.isInterstitial(page)) return {tab: loaded, interstitial: false};
		const from = loaded.url;
		const until = Date.now() + INTERSTITIAL_WAIT_MS;
		let tab = loaded;
		while (Date.now() < until && !abort) {
			await sleep(500);
			try { tab = await browser.tabs.get(tabId); } catch { return {tab: loaded, interstitial: true}; }
			if (tab.url && tab.url !== from && !tab.url.startsWith('about:')) {
				const after = await waitForLoad(tabId, LOAD_TIMEOUT_MS);
				return {tab: after || tab, interstitial: true};
			}
		}
		return {tab, interstitial: true};
	}

	function domainOf(url) {
		try {
			const proper = (Zotero.Proxies && Zotero.Proxies.proxyToProper(url)) || url;
			return M.registrableDomain(new URL(proper).hostname);
		}
		catch { return ''; }
	}

	// Is an article on this tab? A translator found an item, or the tab is a PDF.
	function articleOn(tabId) {
		let info;
		try { info = Zotero.Connector_Browser.getTabInfo(tabId); } catch { return false; }
		return !!(info && ((info.translators && info.translators.length) || info.isPDF));
	}

	// A check is up. Browsers finish some checks by themselves in a few seconds, so wait quietly first:
	// the window stays where it is and nothing is clicked. 'cleared' | 'blocked' | 'waiting' | 'aborted'
	async function waitForAutomaticCheck(tabId) {
		setView({phase: 'working', message: 'Waiting for the publisher to finish its own check'});
		const until = Date.now() + AUTO_CHECK_WAIT_MS;
		let result = 'waiting';
		while (Date.now() < until && !abort) {
			await sleep(1000);
			const page = await inspect(tabId);
			if (!page) { result = 'aborted'; break; }
			page.status = 0; // the old status belongs to the page that is gone
			page.articleFound = articleOn(tabId);
			const c = M.classifyPage(page);
			if (c.kind !== 'challenge') { result = 'cleared'; break; }
			if (c.hard) { result = 'blocked'; break; }
		}
		statusSeen.reset(tabId);
		setView({phase: 'working', message: ''});
		return abort && result === 'waiting' ? 'aborted' : result;
	}

	// A check is still up after the quiet wait. Bring the window to the front and give the user up to
	// 90 seconds. Returns true if the page cleared. Nothing is clicked or solved for them.
	async function waitForUser(tabId, windowId) {
		setView({phase: 'needs_you', message: 'Needs you: finish the check in the open window'});
		try { await browser.windows.update(windowId, {state: 'normal', focused: true, drawAttention: true}); } catch { /* window may be gone */ }
		const until = Date.now() + CHALLENGE_WAIT_MS;
		let cleared = false;
		while (Date.now() < until && !abort) {
			await sleep(1000);
			const page = await inspect(tabId);
			if (!page) break;
			page.status = 0; // the old status belongs to the page that is gone
			page.articleFound = articleOn(tabId);
			if (M.classifyPage(page).kind !== 'challenge') { cleared = true; break; }
		}
		statusSeen.reset(tabId);
		setView({phase: 'working', message: ''});
		// The control window goes back in front; the paper window stays as it is.
		if (cleared && controlWindowId !== null) { try { await browser.windows.update(controlWindowId, {focused: true}); } catch { /* fine */ } }
		return cleared;
	}

	// One pass over the tab: 'saved' | 'no_pdf' | 'no_access' | 'check' | 'blocked' | 'aborted'
	// 'check' means a real bot check is showing; 'blocked' means the publisher sent a plain warning.
	// afterCheck: a check was already waited out on this paper.
	async function captureOnce(tabId, pdfWaitMs, afterCheck) {
		const detectUntil = Date.now() + DETECT_TIMEOUT_MS;
		let tabInfo;
		let sawPurchase = false;
		// What we saw, for the reason code sent with the report.
		const ev = watch.ev = {finalUrl: '', title: '', translator: null, isPDF: false, statusUsed: 0, sawPurchase: false, classified: '', checkReason: '', blocked: false, translatorSaved: false, pdfStatus: 0, pageGone: false};
		while (!abort) {
			const page = await inspect(tabId);
			if (!page) { ev.pageGone = true; return 'no_pdf'; }
			// Translator first: an article page is not a check page, whatever widgets it embeds.
			tabInfo = Zotero.Connector_Browser.getTabInfo(tabId);
			const hasArticle = !!(tabInfo && ((tabInfo.translators && tabInfo.translators.length) || tabInfo.isPDF));
			page.articleFound = hasArticle;
			ev.finalUrl = page.url || ev.finalUrl;
			ev.title = page.title || '';
			ev.isPDF = !!(tabInfo && tabInfo.isPDF);
			ev.translator = (tabInfo && tabInfo.translators && tabInfo.translators[0] && (tabInfo.translators[0].label || tabInfo.translators[0].translatorID)) || null;
			ev.statusUsed = page.status || 0;
			const c = M.classifyPage(page);
			if (c.kind === 'challenge') {
				ev.classified = ev.checkReason = c.reason;
				if (c.hard) { ev.blocked = true; return 'blocked'; }
				return 'check';
			}
			if (c.kind === 'no_access') {
				ev.classified = c.reason;
				// A purchase prompt can sit beside a PDF the user can reach; only give up on it if no PDF turns up.
				if (c.reason !== 'purchase') return 'no_access';
				sawPurchase = ev.sawPurchase = true;
			}
			if (hasArticle) break;
			if (Date.now() > detectUntil) return sawPurchase ? 'no_access' : 'no_pdf';
			await sleep(500);
		}
		if (abort) return 'aborted';
		const tab = await browser.tabs.get(tabId);
		watch.pdfSession = null;
		watch.status = 0;
		ev.translatorSaved = !!(tabInfo.translators && tabInfo.translators.length);
		try {
			const saving = (tabInfo.translators && tabInfo.translators.length)
				? Zotero.Connector_Browser.saveWithTranslator(tab, 0, {fallbackOnFailure: true})
				: Zotero.Connector_Browser.saveAsWebpage(tab, tabInfo.frameId, {snapshot: true});
			Promise.resolve(saving).catch(e => Zotero.debug('Retrieval: save ended with ' + (e && e.message)));
		}
		catch (e) {
			Zotero.debug('Retrieval: could not start the save: ' + (e && e.message));
			return 'no_pdf';
		}
		const until = Date.now() + pdfWaitMs;
		while (Date.now() < until && !abort) {
			if (watch.pdfSession) return 'saved';
			if (watch.status === 429) { ev.pdfStatus = 429; ev.blocked = true; return 'blocked'; }
			if ([401, 402, 403, 503].includes(watch.status)) {
				ev.pdfStatus = watch.status;
				// Refused again right after a check: the publisher has said no.
				if (watch.status === 403 && afterCheck) { ev.blocked = true; return 'blocked'; }
				// A refused download is a bot check (to the user), a paywall (no access) or nothing useful.
				const page = await inspect(tabId);
				if (!page) { ev.pageGone = true; return 'no_pdf'; }
				page.status = watch.status;
				const verdict = M.classifyPage(page);
				if (verdict.kind === 'challenge') {
					ev.classified = ev.checkReason = verdict.reason;
					if (verdict.hard) { ev.blocked = true; return 'blocked'; }
				}
				if (verdict.kind === 'no_access' && !/^status_/.test(verdict.reason)) ev.classified = verdict.reason;
				const kind = verdict.kind;
				return kind === 'challenge' ? 'check' : (kind === 'no_access' ? 'no_access' : 'no_pdf');
			}
			await sleep(500);
		}
		return abort ? 'aborted' : (watch.pdfSession ? 'saved' : (sawPurchase ? 'no_access' : 'no_pdf'));
	}

	// Look at the tab, save through the normal path, and say what happened:
	// 'saved' | 'no_pdf' | 'no_access' | 'challenge' | 'blocked' | 'aborted'
	async function captureLoop(tabId, windowId, pdfWaitMs) {
		let afterCheck = false;
		for (let pass = 0; pass < 3; pass++) {
			const result = await captureOnce(tabId, pdfWaitMs, afterCheck);
			if (result !== 'check') return result;
			afterCheck = true;
			const quiet = await waitForAutomaticCheck(tabId);
			if (quiet === 'aborted') return 'aborted';
			if (quiet === 'blocked') { watch.ev.blocked = true; return 'blocked'; }
			if (quiet === 'cleared') continue;
			if (!await waitForUser(tabId, windowId)) return abort ? 'aborted' : 'challenge';
		}
		return 'challenge';
	}

	// What the page offers as its PDF: the citation_pdf_url meta and the links. Read-only.
	async function readPdfLinks(tabId) {
		try {
			const [result] = await browser.scripting.executeScript({
				target: {tabId},
				func: function readPdfLinks() {
					const content = sel => Array.from(document.querySelectorAll(sel)).map(m => m.content || '').filter(Boolean);
					const SIDE = /(^|[\s_-])(related|recommended?|references?|citing|cited-by|sidebar|footer|similar|also-viewed|more-like)([\s_-]|$)/i;
					const region = a => {
						for (let el = a.parentElement, i = 0; el && i < 15; el = el.parentElement, i++) {
							const tag = el.tagName;
							if (tag === 'MAIN' || el.getAttribute('role') === 'main') return 'main';
							if (tag === 'BODY' || tag === 'HTML') break;
							if (tag === 'FOOTER' || tag === 'ASIDE') return 'other';
							const label = [el.id, typeof el.className === 'string' ? el.className : '', el.getAttribute('aria-label'), el.getAttribute('role')].join(' ');
							if (SIDE.test(label)) return 'other';
						}
						return 'main';
					};
					return {
						meta: content('meta[name="citation_pdf_url"]').slice(0, 5),
						ids: content('meta[name="citation_doi"], meta[name="citation_pii"], meta[name="citation_pmcid"], meta[name="dc.identifier"], meta[name="DC.Identifier"], meta[name="DC.identifier"], meta[name="prism.doi"], meta[name="citation_public_url"]').slice(0, 12),
						links: Array.from(document.querySelectorAll('a[href]')).slice(0, 800).map(a => ({
							href: a.href || '',
							text: (a.innerText || '').trim().slice(0, 80),
							aria: (a.getAttribute('aria-label') || a.title || '').trim().slice(0, 80),
							region: region(a)
						}))
					};
				}
			});
			return (result && result.result) || {};
		}
		catch { return {}; }
	}

	// The human "click View PDF" step, once per paper: same tab, then the normal save path.
	// Returns the new result ('saved' or a hard stop) or null to keep the original one.
	async function pdfFallback(tabId, windowId, pdfWaitMs) {
		const first = watch.ev;
		first.fallbackTried = true;
		const tab = await browser.tabs.get(tabId).catch(() => null);
		const found = tab && M.choosePdfLink(Object.assign({pageUrl: tab.url}, await readPdfLinks(tabId)));
		if (!found) { first.fallbackResult = 'no_link'; return null; }
		// Same registrable domain as the landing page or a known PDF host, never a blocked site,
		// and the paper's own guard must still allow it.
		if (!S.pdfLinkAllowed(tab.url, found.url) || (watch.guard && !watch.guard.peek(found.url))) {
			first.fallbackResult = 'link_off_domain';
			return null;
		}
		first.pdfLink = found.url;
		const before = tab.url;
		watch.pdfSession = null;
		statusSeen.reset(tabId);
		try { await browser.tabs.update(tabId, {url: found.url}); }
		catch { first.fallbackResult = 'no_navigation'; return null; }
		const until = Date.now() + FALLBACK_WAIT_MS;
		let moved = false;
		while (Date.now() < until && !abort && !watch.pdfSession) {
			let now;
			try { now = await browser.tabs.get(tabId); }
			catch { first.fallbackResult = 'page_gone'; return null; }
			if (now.url && now.url !== before) { moved = true; break; }
			await sleep(500);
		}
		if (abort) return 'aborted';
		if (!moved && !watch.pdfSession) { first.fallbackResult = 'no_navigation'; return null; }
		if (moved) await waitForLoad(tabId, Math.max(2000, until - Date.now()));
		let second = 'saved';
		if (!watch.pdfSession) second = await captureLoop(tabId, windowId, pdfWaitMs);
		const secondEv = watch.ev;
		watch.ev = first;
		if (second === 'saved') {
			first.fallbackSaved = true;
			first.fallbackResult = 'saved';
			return 'saved';
		}
		first.fallbackResult = (second === 'no_access' || second === 'no_pdf') ? 'no_pdf_after_link' : second;
		if (second === 'blocked' || (secondEv && secondEv.blocked)) { first.blocked = true; return 'blocked'; }
		return ['challenge', 'aborted'].includes(second) ? second : null;
	}

	// captureLoop, then the PDF-link step when a person could have fixed it by clicking View PDF.
	async function capture(tabId, windowId, pdfWaitMs) {
		const result = await captureLoop(tabId, windowId, pdfWaitMs);
		if (!['no_access', 'no_pdf'].includes(result) || abort) return result;
		if (!M.fallbackAllowed(result, watch.ev)) return result;
		const again = await pdfFallback(tabId, windowId, pdfWaitMs);
		return again || result;
	}

	// Papers open unfocused so they never take over the screen; plain fallback if the browser refuses the state.
	async function createPaperWindow(url) {
		try { return await browser.windows.create({url, type: 'normal', state: 'normal', focused: false}); }
		catch { return browser.windows.create({url, type: 'normal'}); }
	}

	// A paper we will not open at all (bad start URL or a blocked site): report it, no window.
	async function refuse(item, reason, domain) {
		const diag = M.buildDiag({finalUrl: '', offDomain: domain || ''}, reason);
		try { await desktop('POST', 'report', {item_id: item.id, status: 'error', domain: '', reason, diag}); }
		catch (e) { Zotero.debug('Retrieval: could not report: ' + (e && e.message)); }
	}

	// Heartbeat while a paper is in progress: tells the desktop we are alive and hears Stop.
	async function heartbeat(itemId, stillMine) {
		while (stillMine() && !abort) {
			try {
				const r = await desktop('GET', 'next', null, 'busy=' + encodeURIComponent(itemId));
				if (['stopped', 'idle', 'finished'].includes(r.queue)) abort = true;
				setView({queue: r.queue, done: r.done, total: r.total, message: r.message || ''});
			}
			catch { /* a missed beat is fine; the main loop notices a gone desktop */ }
			await sleep(POLL_MS);
		}
	}

	// One paper, start to finish: open, land, capture, close the window, report.
	async function work(item, pdfWaitMs) {
		let windowId = null;
		abort = false;
		const proxyHost = await loadProxy();
		if (S.startUrlProblem(item.url, proxyHost)) return refuse(item, 'bad_start_url', '');
		const guard = S.createPaperGuard({itemUrl: item.url, proxyHost});
		if (!guard.start.ok) return refuse(item, guard.start.reason, guard.start.domain);
		const mine = {tabId: -1, pdfSession: null, status: 0, guard, violation: null};
		watch = mine;
		setView({phase: 'working', title: item.title || item.doi || ''});
		// The heartbeat stops by itself once watch is no longer this paper.
		const beat = heartbeat(item.id, () => watch === mine);
		let outcome = 'no_pdf';
		let domain = '';
		let interstitial = false;
		try {
			const win = await createPaperWindow(item.url);
			windowId = win.id;
			const tab = win.tabs && win.tabs[0];
			mine.tabId = tab.id;
			let loaded = await waitForLoad(tab.id);
			if (loaded) {
				const settled = await settle(tab.id, loaded);
				loaded = settled.tab;
				interstitial = settled.interstitial;
			}
			if (loaded && !mine.violation) {
				observe(tab.id, loaded.url, 'load');
				guard.seal();
			}
			if (mine.violation) outcome = 'violation';
			else if (loaded) {
				domain = domainOf(loaded.url);
				if (domain) {
					const reply = await desktop('POST', 'report', {item_id: item.id, status: 'landed', domain});
					if (reply.allow) outcome = await capture(tab.id, windowId, pdfWaitMs);
					else outcome = reply.queue === 'stopped' ? 'aborted' : 'limit_done';
				}
				else outcome = 'error';
			}
			else outcome = 'error';
		}
		catch (e) {
			Zotero.debug('Retrieval: paper failed: ' + (e && e.message));
			outcome = 'error';
		}
		const sessionID = mine.pdfSession;
		// A violation wins over a Stop that arrived at the same time.
		if (mine.violation) { outcome = 'violation'; abort = false; }
		watch = null; // stops the heartbeat
		await beat;
		if (windowId !== null) {
			try { await browser.windows.remove(windowId); } catch { /* already closed */ }
		}
		if (outcome === 'aborted' || outcome === 'limit_done') return;
		const status = {saved: 'saved', error: 'error', violation: 'error', no_access: 'no_access', challenge: 'challenge', blocked: 'challenge'}[outcome] || 'no_pdf';
		const reason = M.endReason(Object.assign({}, mine.ev, {outcome, violationReason: mine.violation && mine.violation.reason})) || undefined;
		const evidence = Object.assign({interstitial}, mine.ev);
		if (mine.violation) evidence.offDomain = mine.violation.domain;
		const diag = M.buildDiag(evidence, evidence.classified || reason);
		try { await desktop('POST', 'report', {item_id: item.id, status, domain, sessionID: sessionID || undefined, reason, diag}); }
		catch (e) { Zotero.debug('Retrieval: could not report: ' + (e && e.message)); }
	}

	// "status" only reads. Asking "next" here would claim a paper before the loop is ready.
	async function probe() {
		try { return await desktop('GET', 'status'); }
		catch { return null; }
	}

	async function activate(status) {
		if (active) return true;
		if (!status) status = await probe();
		if (!status || !['running', 'paused'].includes(status.status)) return false;
		install();
		active = true;
		const total = status.total || 0;
		setView({
			queue: status.status, done: status.done, total, phase: 'working',
			message: total ? `Getting ${total} ${total === 1 ? 'paper' : 'papers'} for Abstractus Desktop` : 'Getting papers for Abstractus Desktop'
		});
		loop();
		return true;
	}

	// Ask the desktop for the next paper until the queue ends or the desktop stops answering.
	async function loop() {
		let failures = 0;
		Zotero.Connector_Browser.setKeepServiceWorkerAlive(true);
		try {
			while (active) {
				let next;
				try { next = await desktop('GET', 'next'); failures = 0; }
				catch {
					if (++failures >= 5) {
						setView({queue: 'idle', phase: 'idle', message: 'Abstractus Desktop is not answering.'});
						break;
					}
					await sleep(POLL_MS);
					continue;
				}
				setView({queue: next.queue, done: next.done, total: next.total, message: next.message || ''});
				if (!['running', 'paused'].includes(next.queue)) { setView({phase: 'idle'}); break; }
				if ((next.action === 'open' || next.action === 'resume') && next.item) {
					await work(next.item, (next.pdf_wait_seconds || 60) * 1000);
					// Ask again at once: the desktop answers "wait" until the delay is over.
				}
				else {
					setView({phase: next.action === 'wait' ? 'waiting' : (next.queue === 'paused' ? 'paused' : 'idle')});
					await sleep(next.action === 'wait' ? Math.min(M.clampPollMs(next.wait_ms), 6000) : POLL_MS);
				}
			}
		}
		finally {
			active = false;
			Zotero.Connector_Browser.setKeepServiceWorkerAlive(false);
		}
	}

	// One queue window at a time; a second call while opening shares the first.
	async function openControl() {
		if (opening) return opening;
		opening = (async () => {
			const url = browser.runtime.getURL(CONTROL_PAGE);
			if (controlWindowId !== null) {
				try { await browser.windows.update(controlWindowId, {focused: true, drawAttention: true}); return; }
				catch { controlWindowId = null; }
			}
			let existing = [];
			try { existing = await browser.tabs.query({url}); } catch { /* no tabs permission for the query */ }
			if (existing.length) {
				controlWindowId = existing[0].windowId;
				try { await browser.windows.update(controlWindowId, {focused: true, drawAttention: true}); } catch { /* gone */ }
				return;
			}
			const win = await browser.windows.create({url, type: 'popup', width: 380, height: 260, focused: true});
			controlWindowId = win.id;
		})();
		try { await opening; }
		finally { opening = null; }
	}
	// The window is gone: forget it so the next open creates a fresh one.
	browser.windows.onRemoved.addListener(id => { if (id === controlWindowId) controlWindowId = null; });

	// The desktop started a queue: pick it up (and keep the alarm so a sleeping worker wakes up).
	async function autoCheck(force) {
		if (active) return;
		const now = Date.now();
		if (!force && now - lastAutoCheck < AUTO_THROTTLE_MS) return;
		lastAutoCheck = now;
		const status = await probe();
		if (status) {
			if (browser.alarms) {
				try { await browser.alarms.create(ALARM_NAME, {periodInMinutes: ALARM_PERIOD_MIN}); } catch { /* optional */ }
			}
			if (status.status === 'running' && await activate(status)) await openControl();
		}
		else if (browser.alarms) {
			try { await browser.alarms.clear(ALARM_NAME); } catch { /* optional */ }
		}
	}
	// Any browser activity may be the moment the desktop starts a queue; the throttle keeps this cheap.
	const autoCheckSafe = force => autoCheck(force).catch(e => Zotero.debug('Retrieval: auto check failed: ' + (e && e.message)));
	if (browser.runtime.onStartup) browser.runtime.onStartup.addListener(() => autoCheckSafe(true));
	browser.tabs.onActivated.addListener(() => autoCheckSafe(false));
	browser.tabs.onUpdated.addListener((tabId, change) => { if (change && change.status === 'complete') autoCheckSafe(false); });
	if (browser.alarms) browser.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM_NAME) autoCheckSafe(true); });

	// The toolbar button: start (or show) the queue window.
	this.onToolbarClick = async function () {
		if (!await activate()) return false;
		await openControl();
		return true;
	};
	this.getView = () => Object.assign({active}, view);
	this.control = async function (command) {
		if (!['pause', 'continue', 'stop'].includes(command)) throw new Error('Unknown command');
		await desktop('POST', 'control', {command});
		if (command === 'stop') abort = true;
		return this.getView();
	};

	// Messages from the queue window only (our own page, our own extension).
	browser.runtime.onMessage.addListener((msg, sender) => {
		if (!msg || msg.type !== 'abstractus-retrieval') return undefined;
		if (sender.id !== browser.runtime.id || (sender.url || '').split(/[?#]/)[0] !== browser.runtime.getURL(CONTROL_PAGE)) {
			return Promise.reject(new Error('Not allowed'));
		}
		if (msg.action === 'view') return Promise.resolve(Zotero.Retrieval.getView());
		if (msg.action === 'get-proxy') return loadProxy().then(host => ({host}));
		if (msg.action === 'set-proxy') return setProxy(msg.value);
		return Zotero.Retrieval.control(msg.action);
	});

	// Test seam only.
	this._test = {install, setWatch: w => { watch = w; }, statusSeen, observe};
};
