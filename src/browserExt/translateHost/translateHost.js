Zotero.TranslateHost = {
	initialized: false,
	messagingInitialized: false,
	role: new URLSearchParams(window.location.search).get('role'),
	observers: [],

	initMessaging(port) {
		if (this.messagingInitialized) return;
		this.messagingInitialized = true;
		this._messaging = new Zotero.MessagingGeneric({
			functionOverrides: HOST_FUNCTIONS[this.role],
			overrideTarget: Zotero,
			sendMessage: (...args) => port.postMessage(args),
			addMessageListener: fn => {
				port.onmessage = (event) => fn(event.data);
			}
		});

		this._messaging.addMessageListener('TranslateHost.init', initOptions => this.init(initOptions));
		this._messaging.addMessageListener('TranslateHost.detect', () => this.detect());
		this._messaging.addMessageListener('TranslateHost.translate', () => this.translate());

		if (Zotero.isDebug) {
			this._messaging.addMessageListener('TranslateHost.runNonWeb',
				async (translatorID, testType, input) => {
					let translator = await Zotero.Translators.get(translatorID);
					let { runNonWebTranslation }
						= await import('/tools/testTranslators/translatorTester.mjs');
					return runNonWebTranslation({ type: testType, input }, translator);
				}
			);
		}
	},

	async init(initOptions) {
		if (this.initialized) return;
		this.initialized = true;
		this.initOptions = initOptions;
		this.role = initOptions.role;

		Zotero.version = initOptions.version;
		Zotero.Prefs.syncStorage = Object.assign({}, initOptions.prefs);
		Zotero.Connector_Browser = Zotero.Connector_Browser || {};
		Zotero.Connector_Browser.isIncognito = async () => initOptions.isIncognito;
		Zotero.Schema.init();
		Zotero.Date.init(initOptions.dateFormats);
		Zotero.Debug.init();

		if (this.role === 'detect') {
			this._disableHTTP();
		}
		return true;
	},

	_disableHTTP() {
		let unavailable = function() {
			throw new Error('HTTP requests are unavailable during translator detection');
		};
		for (let method of ['request', 'doGet', 'doPost', 'processDocuments']) {
			if (Zotero.HTTP?.[method]) Zotero.HTTP[method] = unavailable;
		}
		if (Zotero.COHTTP?.request) Zotero.COHTTP.request = unavailable;
		for (let method of [
			'processDocuments', 'request', 'requestText', 'requestJSON',
			'requestDocument', 'doGet', 'doPost'
		]) {
			if (Zotero.Utilities.Translate.prototype[method]) {
				Zotero.Utilities.Translate.prototype[method] = unavailable;
			}
		}
	},

	async detect() {
		this.observers = [];
		let document = this._createDocument(this.initOptions.document, true);
		let translators = this.initOptions.translators
			? await this.unserializeTranslators(this.initOptions.translators)
			: null;
		translators = await Zotero.TranslateWeb.detect({ document, translators });
		return {
			translators: translators.map(translator => {
				return serializeTranslator(translator, TRANSLATOR_PASSING_PROPERTIES);
			}),
			observers: this.observers
		};
	},

	async translate() {
		let document = this._createDocument(this.initOptions.document, false);
		let translators = this.initOptions.translators
			? await this.unserializeTranslators(this.initOptions.translators)
			: null;
		let handlers = this.initOptions.handlers;
		let translateOptions = { document, translators };
		let translateHandlers = {
			'TranslateHost.itemSaving': ['onItemSaving', 'itemSaving'],
			'TranslateHost.onDebug': ['onDebug', 'debug']
		};
		for (let [message, [option, handler]] of Object.entries(translateHandlers)) {
			translateOptions[option] = handlers[handler]
				? (obj, ...payload) => this._messaging.sendMessage(message, payload)
				: null;
		}
		translateOptions.onError = handlers.error ? (obj, error) => {
			return this._messaging.sendMessage('TranslateHost.onError', [
				Zotero.MessagingGeneric.serializeError(error)
			]);
		} : null;
		translateOptions.onTranslatorFallback = handlers.translatorFallback
			? (oldTranslator, newTranslator) => {
				return this._messaging.sendMessage('TranslateHost.translatorFallback', [
					{ translatorID: oldTranslator.translatorID, label: oldTranslator.label },
					{ translatorID: newTranslator.translatorID, label: newTranslator.label }
				]);
			}
			: null;
		translateOptions.onSelect = handlers.select ? (obj, items, callback) => {
			this._messaging.sendMessage('TranslateHost.select', [items]).then(callback);
		} : null;
		let result = await Zotero.TranslateWeb.translate(translateOptions);
		return {
			items: result.items,
			proxy: result.proxy?.toJSON ? result.proxy.toJSON() : result.proxy
		};
	},

	async unserializeTranslators(translators) {
		let resolved = [];
		for (let serialized of translators || []) {
			let translator = await Zotero.Translators.get(serialized.translatorID);
			if (!translator) {
				throw new Error(`TranslateHost: Translator ${serialized.translatorID} not found`);
			}
			if (serialized.proxy) {
				translator.proxy = new Zotero.Proxy(serialized.proxy);
			}
			resolved.push(translator);
		}
		return resolved;
	},

	_createMutationObserver() {
		let host = this;
		return class TranslateHostMutationObserver {
			observe(node, options) {
				if (!(node instanceof Node)) {
					throw new Error("TypeError: Failed to execute 'observe' on 'MutationObserver': parameter 1 is not of type 'Node'.");
				}
				let selector;
				if (node.nodeType === Node.DOCUMENT_NODE) {
					selector = null;
				}
				else if (node.nodeType === Node.ELEMENT_NODE) {
					selector = Zotero.Utilities.Connector.getNodeSelector(node);
				}
				else {
					throw new TypeError('Remote MutationObserver targets must be a Document or Element');
				}
				host.observers.push({
					selector,
					options: options || { childList: true, subtree: true }
				});
			}
			disconnect() {}
		};
	},

	_createDocument({ html, url, cookie = '' }, detect) {
		html = html.replace(/<(video|audio)(?:\s[^>]*)?(?:\/>|>.*?<\/\1>)/gis, '');

		html = html.replace(/<noscript(?:\s[^>]*)?(?:\/>|>.*?<\/noscript>)/gis, '');

		let doc = new DOMParser().parseFromString(html, 'text/html');
		let baseElem = doc.querySelector('base[href]');
		let baseUrl = url;
		if (baseElem) {
			baseUrl = new URL(baseElem.getAttribute('href'), baseUrl).href;
		}
		else {
			baseElem = doc.createElement('base');
		}
		baseElem.setAttribute('href', baseUrl);
		doc.head.appendChild(baseElem);
		return Zotero.HTTP.wrapDocument(doc, url, {
			defaultView: { MutationObserver: this._createMutationObserver() },
			cookie: detect ? '' : cookie
		});
	}
};

Zotero.Translate.ItemSaver.prototype.saveItems = async function(jsonItems) {
	this.items = (this.items || []).concat(jsonItems);
	return jsonItems;
};

window.addEventListener('message', (event) => {
	if (event.source !== window.parent
			|| event.data !== 'zoteroChannel'
			|| event.ports.length !== 1
			|| Zotero.TranslateHost.messagingInitialized) {
		return;
	}
	let port = event.ports[0];
	let nonce = window.location.hash ? decodeURIComponent(window.location.hash.slice(1)) : null;
	port.postMessage(nonce);
	Zotero.TranslateHost.initMessaging(port);
});
