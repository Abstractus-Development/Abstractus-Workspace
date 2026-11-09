function createMutationObserver(tabId, frameId) {
	return class UnsandboxedMutationObserver {
		constructor(fn) {
			Zotero.OffscreenTranslate.addMessageListener('MutationObserver.trigger', () => {
				fn([{target: {ownerDocument: 0}}], this)
			});
		}
		observe(node, options) {
			if (!(node instanceof Node)) {
				throw new Error("TypeError: Failed to execute 'observe' on 'MutationObserver': parameter 1 is not of type 'Node'.")
			}
			const selector = Zotero.Utilities.Connector.getNodeSelector(node);
			Zotero.OffscreenTranslate.sendMessage('MutationObserver.observe', [selector, options], tabId, frameId)
		}
		disconnect() {}
	}
}

Zotero.OffscreenTranslate = {
	translateInstances: {},
	selectCallbacks: {},
	init: function() {
		for (let method in Zotero.Translate.Web.prototype) {
			this.addMessageListener(`Translate.${method}`, (translate, [...args]) => {
				return translate[method](...args);
			});
		}
		
		this.addMessageListener('Translate.new', () => 0);
		this.addMessageListener('Translate.getProxy', (translate) => translate._proxy?.toJSON());
		this.addMessageListener(`Translate.setHandler`, (translate, [name, id], tabId, frameId) => {
			translate.setHandler(name, (...args) => {
				args[0] = null;
				if (name == 'select') {
					this.translateInstances[tabId][frameId].selectCallbacks[id] = args[2];
					args[2] = null;
				}
				this.sendMessage(`Translate.onHandler.${name}`, [id, args], tabId, frameId);
			});
		});
		this.addMessageListener('Translate.selectCallback', (translate, [id, args], tabId, frameId) => {
			this.translateInstances[tabId][frameId].selectCallbacks[id](...args);
		});
		this.addMessageListener(`Translate.getTranslators`, async (translate, [...args]) => {
			return (await translate.getTranslators(...args))
				.map(t => serializeTranslator(t, TRANSLATOR_PASSING_PROPERTIES));
		});
		this.addMessageListener(`Translate.setTranslator`, async (translate, [translators]) => {
			return await translate.setTranslator(translators.map(t => new Zotero.Translator(t)));
		});
		this.addMessageListener(`Translate.setDocument`, (translate, [html, url, cookie], tabId, frameId) => {
			if (Zotero.isChromium) {
				html = html.replace(/<(video|audio)(?:\s[^>]*)?(?:\/>|>.*?<\/\1>)/gis, '');
			}

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
			doc.querySelector('head').appendChild(baseElem);
			doc = Zotero.HTTP.wrapDocument(doc, url, {
				defaultView: { MutationObserver: createMutationObserver(tabId, frameId) },
				cookie
			});
			translate.setDocument(doc);
			return true;
		});
		
		this.addMessageListener('tabClosed', (tabId) => this.onTabClosed(tabId));
		this.addMessageListener('translateCleanup', (tabIds) => this.onTranslateCleanup(tabIds));

		if (Zotero.isDebug) {
			Zotero.OffscreenSandbox.addMessageListener('translatorTester_runNonWeb',
				async (translatorID, testType, input) => {
					let translator = await Zotero.Translators.get(translatorID);
					await Zotero.Translators.getCodeForTranslator(translator);

					let { runNonWebTranslation }
						= await import('/tools/testTranslators/translatorTester.mjs');
					return runNonWebTranslation({ type: testType, input }, translator);
				}
			);
		}
	},

	sendMessage: function(message, payload, tabId, frameId) {
		return Zotero.Messaging.sendMessage(message, payload, tabId, frameId)
	},

	addMessageListener: function(message, handler) {
		return Zotero.OffscreenSandbox.addMessageListener(message, (...args) => {
			if (message.startsWith('Translate')) {
				let frameId = args.at(-1);
				let tabId = args.at(-2);
				let translate = this._getTranslateInstance(tabId, frameId, message === "Translate.new");
				return handler(translate, args.slice(0, -2), tabId, frameId);
			}
			return handler(args);
		});
	},
	
	_getTranslateInstance(tabId, frameId, create) {
		if (!this.translateInstances[tabId]) {
			this.translateInstances[tabId] = {};
		}
		if (!this.translateInstances[tabId][frameId] && !create) {
			throw new Error(`OfscreenTranslate: Attempting to access a translate without initializing it first for tab: ${tabId}`);
		}
		if (create) {
			this.translateInstances[tabId][frameId] = new Zotero.Translate.Web();
			this.translateInstances[tabId][frameId].selectCallbacks = {};
		}
		return this.translateInstances[tabId][frameId];
	},
	
	onTabClosed(tabId) {
		if (this.translateInstances[tabId]) {
			delete this.translateInstances[tabId];
		}
	},

	onTranslateCleanup(tabIds) {
		let deadTranslates = new Set(Object.keys(this.translateInstances))
		for (let tabId of tabIds) {
			deadTranslates.delete(tabId);
		}
		if (!deadTranslates.size) return [];
		for (let tabId of deadTranslates) {
			delete this.translateInstances[tabId];
		}
		Zotero.debug(`OffscreenTranslate: Cleaning up translates not removed by onTabClosed ${JSON.stringify(Array.from(deadTranslates.keys()))}`, 1);
		return Object.keys(deadTranslates);
	}
};

Zotero.Translate.ItemSaver.prototype.saveItems = async function (jsonItems) {
	this.items = (this.items || []).concat(jsonItems);
	return jsonItems
}