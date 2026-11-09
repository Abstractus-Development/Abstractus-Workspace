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
					justification: 'Running Zotero Translators in isolated frames',
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
			Zotero.TranslateHostFrameManager.destroyFramesForTab(tabId);
		});
		
		setInterval(() => this.cleanup(), 15*60e3);
		Zotero.debug('OffscreenManager: translate host frame manager initialized');
	},

	async ensureDocument() {
		if (!await this.getOffscreenPage()) await this.init();
	},

	async cleanup() {
		const offscreenPage = await this.getOffscreenPage();
		if (!offscreenPage) return false;
		let tabs = await browser.tabs.query({status: "complete", windowType: "normal"});
		let cleanedUpTabIds = await Zotero.TranslateHostFrameManager.cleanup(tabs.map(tab => tab.id));
		if (cleanedUpTabIds.length > 0) {
			Zotero.logError(new Error(`OffscreenManager: manually cleaned up frames that were kept `
				+ `alive after tabs.onRemoved ${JSON.stringify(cleanedUpTabIds)}`));
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
			functionOverrides: FRAME_MANAGER_MESSAGE_FUNCTIONS,
			handlerFunctionOverrides: FRAME_MANAGER_FUNCTIONS,
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
		Zotero.OffscreenManager._messaging.addMessageListener(
			'TranslateHostFrameManager.initialized',
			() => {
				Zotero.debug('OffscreenManager: offscreen translate host frame manager initialized');
				Zotero.OffscreenManager.messagingDeferred.resolve();
			}
		);
		Zotero.debug('OffscreenManager: messaging initialized')
	}
}