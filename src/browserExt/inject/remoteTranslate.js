Zotero.RemoteTranslate = new function() {
	const handlers = new Map();

	const remoteHeadElements = new Set([
		'base',
		'link',
		'meta',
		'title',
		'style',
		'script',
		'template',
	]);

	function isInvalidHeadChild(node) {
		return (node.nodeType == Node.ELEMENT_NODE && !remoteHeadElements.has(node.localName))
			|| (node.nodeType == Node.TEXT_NODE && node.nodeValue.trim() != '');
	}

	this.detect = function({ document, translators } = {}) {
		if (!Zotero.isDebug) translators = null;
		return detect({ document, translators });
	};

	this.translate = async function({
		document,
		translators,
		onSelect,
		onItemSaving,
		onDebug,
		onError,
		onTranslatorFallback
	} = {}) {
		let operationID = Zotero.Utilities.randomString();
		let firstTranslator = Array.isArray(translators) ? translators[0] : translators;
		let updateLiveElements = firstTranslator?.itemType == 'multiple';
		handlers.set(operationID, {
			onSelect,
			onItemSaving,
			onDebug,
			onError,
			onTranslatorFallback
		});
		try {
			let result = await Zotero.TranslateHostFrameManager.translate({
				operationID,
				document: serializeDocument(document, true, updateLiveElements),
				translators: serializeAvailableTranslators(translators),
				handlers: {
					select: !!onSelect,
					itemSaving: !!onItemSaving,
					debug: !!onDebug,
					error: !!onError,
					translatorFallback: !!onTranslatorFallback
				}
			});
			return {
				items: result.items,
				proxy: result.proxy && new Zotero.Proxy(result.proxy)
			};
		}
		finally {
			handlers.delete(operationID);
		}
	};

	async function detect({ document, translators } = {}) {
		let operationID = Zotero.Utilities.randomString();
		let result = await Zotero.TranslateHostFrameManager.detect({
			operationID,
			document: serializeDocument(document, false),
			translators: serializeAvailableTranslators(translators)
		});
		return {
			translators: result.translators.map(translator => new Zotero.Translator(translator)),
			observers: result.observers
		};
	}

	function serializeDocument(document, includeCookie, updateLiveElements = false) {
		if (updateLiveElements) {
			for (let checkbox of document.querySelectorAll('input[type=checkbox]')) {
				if (checkbox.checked) checkbox.setAttribute('checked', '');
				else checkbox.removeAttribute('checked');
			}
		}
		let cookie = '';
		if (includeCookie) {
			try {
				cookie = document.cookie;
			}
			catch (e) {}
		}
		const snapshot = document.implementation.createHTMLDocument('')
			.importNode(document.documentElement, true);
		const removePresentation = root => {
			root.removeAttribute?.('style');
			for (const style of root.querySelectorAll('style')) style.remove();
			for (const element of root.querySelectorAll('[style]')) element.removeAttribute('style');
			for (const template of root.querySelectorAll('template')) removePresentation(template.content);
		};
		removePresentation(snapshot);
		const head = snapshot.querySelector('head');
		if (head) {
			for (const node of [...head.childNodes]) {
				if (isInvalidHeadChild(node)) node.remove();
			}
		}
		return {
			html: snapshot.outerHTML,
			url: document.location.href,
			cookie
		};
	}

function serializeAvailableTranslators(translators) {
		if (!translators) return null;
		if (!Array.isArray(translators)) translators = [translators];
		return translators.map(translator => ({
			translatorID: translator.translatorID,
			proxy: translator.proxy?.toJSON ? translator.proxy.toJSON() : translator.proxy
		}));
	}

	Zotero.Messaging.addMessageListener('RemoteTranslate.select', async ([operationID, items]) => {
		let handler = handlers.get(operationID)?.onSelect;
		if (!handler) return items;
		return new Promise((resolve, reject) => {
			try {
				let result = handler(null, items, resolve);
				if (result && typeof result.then === 'function') {
					result.catch(reject);
				}
			}
			catch (e) {
				reject(e);
			}
		});
	});

	Zotero.Messaging.addMessageListener('RemoteTranslate.itemSaving', ([operationID, item]) => {
		return handlers.get(operationID)?.onItemSaving?.(null, item);
	});

	Zotero.Messaging.addMessageListener('RemoteTranslate.onDebug', ([operationID, message]) => {
		return handlers.get(operationID)?.onDebug?.(null, message);
	});

	Zotero.Messaging.addMessageListener('RemoteTranslate.onError', ([operationID, error]) => {
		let handler = handlers.get(operationID)?.onError;
		if (!handler) return;
		let translatedError = new Error(error.message);
		Object.assign(translatedError, error);
		return handler(null, translatedError);
	});

	Zotero.Messaging.addMessageListener(
		'RemoteTranslate.translatorFallback',
		([operationID, oldTranslator, newTranslator]) => {
			let handler = handlers.get(operationID)?.onTranslatorFallback;
			if (!handler) return;
			return handler(oldTranslator, newTranslator);
		}
	);
};
