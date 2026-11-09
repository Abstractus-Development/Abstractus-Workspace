Zotero.OffscreenManager = {
	offscreenPageInitialized: false,
	messagingDeferred: Zotero.Promise.defer(),
	offscreenUrl: 'offscreen/offscreen.html',
	
	async init() {
		if (this._initializing) return this._initializing;
		this._initializing = this._init().finally(() => { this._initializing = null; });
		return this._initializing;
	},

	async _init() {
		const offscreenPage = await this.getOffscreenPage();
		if (offscreenPage) {
			offscreenPage.postMessage('service-worker-restarted');
		}
		else if (await this.hasDocument()) {
		}
		else {
			this.messagingDeferred = Zotero.Promise.defer();
			try {
				await browser.offscreen.createDocument({
					url: this.offscreenUrl,
					reasons: ['DOM_PARSER'],
					justification: 'Scraping the document with Zotero Translators',
				});
			}
			catch (e) {
				if (!/single offscreen document/i.test(e?.message || '')) throw e;
			}
		}
		await this.messagingDeferred.promise;
		
		if (this.offscreenPageInitialized) return;
		this.offscreenPageInitialized = true;

		browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
			this.sendMessage('tabClosed', [tabId]);
		});
		
		setInterval(() => this.cleanup(), 15*60e3);
		Zotero.debug('OffscreenManager: offscreen page initialized');
	},

	async sendMessage(message, payload, tab, frameId) {
		const offscreenPage = await this.getOffscreenPage();
		if (!offscreenPage) {
			await this.init();
		}
		if (tab) {
			payload.push(tab.id, frameId);
		}
		return await this._messaging.sendMessage(message, payload);
	},

	async addMessageListener(...args) {
		const offscreenPage = await this.getOffscreenPage();
		if (!offscreenPage) {
			await this.init();
		}
		return this._messaging.addMessageListener(...args);
	},

	async cleanup() {
		const offscreenPage = await this.getOffscreenPage();
		if (!offscreenPage) return false;
		let tabs = await browser.tabs.query({status: "complete", windowType: "normal"});
		let cleanedUpTabIds = await this.sendMessage('translateCleanup', tabs.map(tab => tab.id));
		if (cleanedUpTabIds.length > 0) {
			Zotero.logError(new Error(`OffscreenManager: manually cleaned up translates that were kept `
				+ `alive after onTabRemoved ${JSON.stringify(cleanedUpTabIds)}`));
		}
	},
	
	async getOffscreenPage() {
		const matchedClients = await self.clients.matchAll();
		return matchedClients.find(client => client.url.includes(this.offscreenUrl));

	},

	async hasDocument() {
		try {
			return typeof browser.offscreen.hasDocument == 'function' && await browser.offscreen.hasDocument();
		}
		catch (e) {
			return false;
		}
	}
}

self.onmessage = async (e) => {
	if (e.data === 'offscreen-port') {
		Zotero.debug('OffscreenManager: received the offscreen page port')
		let messagingOptions = {
			handlerFunctionOverrides: OFFSCREEN_BACKGROUND_OVERRIDES,
			overrideTarget: Zotero,
		}
		messagingOptions.sendMessage = (...args) => {
			e.ports[0].postMessage(args)
		};
		messagingOptions.addMessageListener = (fn) => {
			e.ports[0].onmessage = (e) => fn(e.data);
		};
		if (Zotero.OffscreenManager._messaging) {
			Zotero.OffscreenManager._messaging.reinit(messagingOptions);
		}
		else {
			Zotero.OffscreenManager._messaging = new Zotero.MessagingGeneric(messagingOptions);
		}
		Zotero.debug('OffscreenManager: messaging initialized')
		e.ports[0].postMessage(null);
		await new Promise(resolve => Zotero.OffscreenManager._messaging.addMessageListener('offscreen-sandbox-initialized', resolve));
		Zotero.debug('OffscreenManager: offscreen sandbox initialized message received')
		Zotero.OffscreenManager.messagingDeferred.resolve();
	}
}