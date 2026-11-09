Zotero.TranslateHostFrameManager = {
	translateHosts: new Map(),

	async init() {
		if (Zotero.isManifestV3) {
			await Zotero.OffscreenManager.init();
		}
		else {
			browser.tabs.onRemoved.addListener(tabId => this.destroyFramesForTab(tabId));
			setInterval(async () => {
				let tabs = await browser.tabs.query({ status: 'complete', windowType: 'normal' });
				let cleanedUpTabIds = this.cleanup(tabs.map(tab => tab.id));
				if (cleanedUpTabIds.length) {
					Zotero.logError(new Error(`TranslateHostFrameManager: manually cleaned up frames that `
						+ `were kept alive after onRemoved ${JSON.stringify(cleanedUpTabIds)}`));
				}
			}, 15 * 60e3);
		}
	},

	async detect(options, tab, frameId) {
		let translateHost = await this._createFrame({ role: 'detect', options, tab, frameId });
		try {
			return await translateHost.zoteroFrame.sendMessage('TranslateHost.detect');
		}
		finally {
			this.destroyFrame(translateHost.operationID);
		}
	},

	async translate(options, tab, frameId) {
		let translateHost = await this._createFrame({ role: 'translate', options, tab, frameId });
		try {
			return await translateHost.zoteroFrame.sendMessage('TranslateHost.translate');
		}
		finally {
			this.destroyFrame(translateHost.operationID);
		}
	},

	async runNonWeb(options) {
		if (!Zotero.isDebug) {
			throw new Error('Non-web translator tests are only available in debug builds');
		}
		let tab = { id: -1, incognito: false };
		let operationID = Zotero.Utilities.randomString();
		let translateHost = await this._createFrame({
			role: 'translate',
			options: { operationID },
			tab,
			frameId: 0
		});
		try {
			return await translateHost.zoteroFrame.sendMessage('TranslateHost.runNonWeb', [
				options.translatorID,
				options.testType,
				options.input
			]);
		}
		finally {
			this.destroyFrame(operationID);
		}
	},

	async _createFrame({ role, options, tab, frameId }) {
		let { operationID } = options;
		let initOptions = await this._buildInitOptions(role, options, tab);
		let zoteroFrame = new Zotero.Frame({
			src: browser.runtime.getURL(`translateHost/translateHost.html?role=${role}`),
			sandbox: 'allow-scripts',
			hidden: true
		}, {}, {
			handlerFunctionOverrides: translateHostFunctions(role, options.document?.url),
			overrideTarget: Zotero
		});
		let translateHost = { operationID, role, tab, frameId, zoteroFrame };
		this.translateHosts.set(operationID, translateHost);
		try {
			await zoteroFrame.init();
			this._addHostEventListeners(translateHost);
			await zoteroFrame.sendMessage('TranslateHost.init', [initOptions]);
			zoteroFrame.frame.onload = () => this.destroyFrame(operationID);
			return translateHost;
		}
		catch (e) {
			this.destroyFrame(operationID);
			throw e;
		}
	},

	_addHostEventListeners(translateHost) {
		if (translateHost.role !== 'translate') return;
		for (let event of ['select', 'itemSaving', 'onDebug', 'onError', 'translatorFallback']) {
			translateHost.zoteroFrame.addMessageListener(`TranslateHost.${event}`, (...payload) => {
				let args = Zotero.AbstractusNetwork.callback([
					`RemoteTranslate.${event}`,
					[translateHost.operationID, ...payload],
					translateHost.tab.id,
					translateHost.frameId
				]);
				return Zotero.Messaging.sendMessage(...args);
			});
		}
	},

	async _buildInitOptions(role, options, tab) {
		let [version, isIncognito, prefs, dateFormats] = await Promise.all([
			Zotero.getVersion(),
			Zotero.Connector_Browser.isIncognito(tab),
			this._getTranslatorPrefs(),
			this._getDateFormats()
		]);
		return {
			role,
			document: Zotero.AbstractusNetwork.scopeDocumentCookie(options.document, options.translators),
			translators: options.translators,
			handlers: options.handlers || {},
			version,
			isIncognito,
			prefs,
			dateFormats
		};
	},

	async _getTranslatorPrefs() {
		let allPrefs = await Zotero.Prefs.getAll();
		let prefs = {};
		let allowed = new Set([
			'downloadAssociatedFiles',
			'automaticSnapshots',
			'reportTranslationFailure',
			'capitalizeTitles'
		]);
		for (let [name, value] of Object.entries(allPrefs)) {
			if (allowed.has(name) || name.startsWith('translators.') || name.startsWith('debug.')) {
				prefs[name] = value;
			}
		}
		return prefs;
	},

	async _getDateFormats() {
		if (!this._dateFormatsPromise) {
			this._dateFormatsPromise = (async () => {
				let url = await Zotero.getExtensionURL('utilities/resource/dateFormats.json');
				let xhr = await Zotero.HTTP.request('GET', url, { responseType: 'json' });
				return xhr.response;
			})();
		}
		return this._dateFormatsPromise;
	},

	destroyFrame(operationID) {
		let translateHost = this.translateHosts.get(operationID);
		if (!translateHost) return;
		this.translateHosts.delete(operationID);
		translateHost.zoteroFrame.remove();
	},

	destroyFramesForTab(tabId) {
		for (let [operationID, translateHost] of this.translateHosts) {
			if (translateHost.tab.id === tabId) this.destroyFrame(operationID);
		}
	},

	cleanup(liveTabIds) {
		let live = new Set(liveTabIds);
		let removed = [];
		for (let [operationID, translateHost] of this.translateHosts) {
			if (translateHost.tab.id >= 0 && !live.has(translateHost.tab.id)) {
				removed.push(translateHost.tab.id);
				this.destroyFrame(operationID);
			}
		}
		return removed;
	}
};
