/*
	Abstractus: paced PDF retrieval, browser side. AGPL-3.0-or-later, like the rest of this fork.

	The user starts a queue in Abstractus Desktop and then clicks the connector button here.
	This module then works the queue ONE paper at a time in a visible browser window, using the
	user's own access, and hands every page to the user if a publisher asks for a check:

	  - no headless browsing, no spoofed headers, no proxy rotation, no random delays
	  - the desktop owns pacing (delay between papers, daily cap per publisher); we only obey it
	  - a CAPTCHA, bot check or login wall is never solved or bypassed: we pause, focus the tab
	    and wait for the user to press Continue
	  - bot bypass is switched off for the tabs this module opens
	  - the PDF is saved only by the connector's normal translator/attachment path

	Nothing polls the desktop while no queue is active. Hook points are listed in
	UPSTREAM-SYNC.md.
*/
Zotero.Retrieval = new function () {
	const M = Zotero.RetrievalModel;
	const POLL_MS = 3000;
	const LOAD_TIMEOUT_MS = 45000;
	const DETECT_TIMEOUT_MS = 20000;
	const CONTROL_PAGE = 'retrieval/retrieval.html';

	let active = false;
	let installed = false;
	let watch = null; // {tabId, pdfSession, status}
	let abort = false;
	let resumeSignal = false;
	let statusSeen = {}; // tabId -> last main-frame HTTP status
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
				statusSeen[details.tabId] = details.statusCode;
			}
		});
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
		return Object.assign(page, {url: tab.url || '', status: statusSeen[tabId] || 0, tabStatus: tab.status});
	}

	// ---- one paper ----

	async function waitForLoad(tabId) {
		const until = Date.now() + LOAD_TIMEOUT_MS;
		while (Date.now() < until && !abort) {
			let tab;
			try { tab = await browser.tabs.get(tabId); } catch { return null; }
			if (tab.status === 'complete' && tab.url && !tab.url.startsWith('about:')) return tab;
			await sleep(500);
		}
		try { return await browser.tabs.get(tabId); } catch { return null; }
	}

	function domainOf(url) {
		try {
			const proper = (Zotero.Proxies && Zotero.Proxies.proxyToProper(url)) || url;
			return M.registrableDomain(new URL(proper).hostname);
		}
		catch { return ''; }
	}

	// Look at the tab, save through the normal path, and say what happened:
	// 'saved' | 'no_pdf' | 'challenge' | 'aborted'
	async function capture(tabId, pdfWaitMs) {
		const detectUntil = Date.now() + DETECT_TIMEOUT_MS;
		let tabInfo;
		while (!abort) {
			const page = await inspect(tabId);
			if (!page) return 'no_pdf';
			if (M.classifyPage(page).kind !== 'none') return 'challenge';
			tabInfo = Zotero.Connector_Browser.getTabInfo(tabId);
			if ((tabInfo.translators && tabInfo.translators.length) || tabInfo.isPDF) break;
			if (Date.now() > detectUntil) return 'no_pdf';
			await sleep(500);
		}
		if (abort) return 'aborted';
		const tab = await browser.tabs.get(tabId);
		watch.pdfSession = null;
		watch.status = 0;
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
			if (watch.status === 429) return 'challenge';
			if (watch.status === 403 || watch.status === 503) {
				// A refused download is a paywall or a bot check. Only a page that looks like a check
				// goes to the user; a paywall is simply "no PDF".
				const page = await inspect(tabId);
				return page && M.classifyPage(page).kind !== 'none' ? 'challenge' : 'no_pdf';
			}
			await sleep(500);
		}
		return abort ? 'aborted' : (watch.pdfSession ? 'saved' : 'no_pdf');
	}

	// Heartbeat while a paper is in progress: tells the desktop we are alive, hears Stop and Continue.
	async function heartbeat(itemId, isCurrent) {
		while (isCurrent() && !abort) {
			try {
				const reply = await desktop('GET', 'next', null, 'busy=' + encodeURIComponent(itemId));
				if (['stopped', 'idle', 'finished'].includes(reply.queue)) abort = true;
				else if (reply.action === 'resume') resumeSignal = true;
				setView({queue: reply.queue, done: reply.done, total: reply.total, message: reply.message || ''});
			}
			catch { /* a missed beat is fine; the desktop re-offers the paper if we stay silent */ }
			await sleep(POLL_MS);
		}
	}

	async function work(item, pdfWaitMs) {
		let windowId = null;
		abort = false;
		resumeSignal = false;
		const mine = {tabId: -1, pdfSession: null, status: 0};
		watch = mine;
		setView({phase: 'working', title: item.title || item.doi || ''});
		const beats = heartbeat(item.id, () => watch === mine);
		let outcome = 'no_pdf';
		let domain = '';
		try {
			const win = await browser.windows.create({url: item.url, type: 'normal', focused: false});
			windowId = win.id;
			const tab = win.tabs && win.tabs[0];
			mine.tabId = tab.id;
			delete statusSeen[tab.id];
			for (let attempt = 0; attempt < 2 && !abort; attempt++) {
				const loaded = await waitForLoad(tab.id);
				if (!loaded) { outcome = 'error'; break; }
				domain = domainOf(loaded.url);
				if (!domain) { outcome = 'error'; break; }
				const landed = await desktop('POST', 'report', {item_id: item.id, status: 'landed', domain});
				if (!landed.allow) { outcome = landed.queue === 'stopped' ? 'aborted' : 'limit_done'; break; }
				outcome = await capture(tab.id, pdfWaitMs);
				if (outcome !== 'challenge') break;
				// Hand the page to the user. Never click, solve or reload anything for them.
				const reply = await desktop('POST', 'report', {item_id: item.id, status: 'challenge', domain});
				if (reply.queue === 'stopped') { outcome = 'aborted'; break; }
				try { await browser.windows.update(windowId, {focused: true, drawAttention: true}); } catch { /* window may be gone */ }
				setView({phase: 'needs_you', message: 'Needs you: finish this page, then press Continue'});
				resumeSignal = false;
				while (!resumeSignal && !abort) await sleep(500);
				outcome = 'retry';
				setView({phase: 'working'});
			}
			if (outcome === 'retry') outcome = 'no_pdf';
		}
		catch (e) {
			Zotero.debug('Retrieval: paper failed: ' + (e && e.message));
			outcome = 'error';
		}
		const sessionID = mine.pdfSession;
		watch = null; // stops the heartbeat
		await beats;
		if (windowId !== null) { try { await browser.windows.remove(windowId); } catch { /* already closed */ } }
		if (outcome === 'aborted' || outcome === 'limit_done') return;
		const status = outcome === 'saved' ? 'saved' : (outcome === 'error' ? 'error' : 'no_pdf');
		try {
			await desktop('POST', 'report', {item_id: item.id, status, domain, sessionID: sessionID || undefined});
		}
		catch (e) { Zotero.debug('Retrieval: could not report: ' + (e && e.message)); }
	}

	// ---- the loop ----

	async function loop() {
		let failures = 0;
		Zotero.Connector_Browser.setKeepServiceWorkerAlive(true);
		try {
			while (active) {
				let reply;
				try {
					reply = await desktop('GET', 'next');
					failures = 0;
				}
				catch {
					if (++failures >= 5) { setView({queue: 'idle', phase: 'idle', message: 'Abstractus Desktop is not answering.'}); break; }
					await sleep(POLL_MS);
					continue;
				}
				setView({queue: reply.queue, done: reply.done, total: reply.total, message: reply.message || ''});
				if (!['running', 'paused'].includes(reply.queue)) { setView({phase: 'idle'}); break; }
				if ((reply.action === 'open' || reply.action === 'resume') && reply.item) {
					await work(reply.item, (reply.pdf_wait_seconds || 60) * 1000);
					continue; // ask again at once: the desktop answers "wait" until the delay is over
				}
				setView({phase: reply.action === 'wait' ? 'waiting' : (reply.queue === 'paused' ? 'paused' : 'idle')});
				await sleep(reply.action === 'wait' ? Math.min(M.clampPollMs(reply.wait_ms), POLL_MS * 2) : POLL_MS);
			}
		}
		finally {
			active = false;
			Zotero.Connector_Browser.setKeepServiceWorkerAlive(false);
		}
	}

	// ---- entry points ----

	async function activate() {
		if (active) return true;
		let reply;
		// "status" only reads. Asking "next" here would claim a paper before the loop is ready.
		try { reply = await desktop('GET', 'status'); }
		catch { return false; }
		if (!['running', 'paused'].includes(reply.status)) return false;
		install();
		active = true;
		setView({queue: reply.status, done: reply.done, total: reply.total});
		loop();
		return true;
	}

	async function openControl() {
		const url = browser.runtime.getURL(CONTROL_PAGE);
		if (controlWindowId !== null) {
			try { await browser.windows.update(controlWindowId, {focused: true}); return; } catch { controlWindowId = null; }
		}
		const win = await browser.windows.create({url, type: 'popup', width: 380, height: 260, focused: true});
		controlWindowId = win.id;
	}
	browser.windows.onRemoved.addListener(id => { if (id === controlWindowId) controlWindowId = null; });

	// Hook: the toolbar button. Returns true when it was used for retrieval.
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
		if (command === 'continue') resumeSignal = true;
		return this.getView();
	};

	// The control page lives in this extension only.
	browser.runtime.onMessage.addListener((request, sender) => {
		if (!request || request.type !== 'abstractus-retrieval') return;
		if (sender.id !== browser.runtime.id
			|| (sender.url || '').split(/[?#]/)[0] !== browser.runtime.getURL(CONTROL_PAGE)) {
			return Promise.reject(new Error('Not allowed'));
		}
		if (request.action === 'view') return Promise.resolve(Zotero.Retrieval.getView());
		return Zotero.Retrieval.control(request.action);
	});

	// Test seam only.
	this._test = {install, setWatch: w => { watch = w; }};
};
