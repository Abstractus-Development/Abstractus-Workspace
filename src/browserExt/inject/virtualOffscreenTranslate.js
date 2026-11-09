const OFFSCREEN_HEAD_ELEMENTS = new Set([
	'base',
	'link',
	'meta',
	'title',
	'style',
	'script',
	'template',
]);

function isInvalidHeadChild(node) {
	return (node.nodeType == Node.ELEMENT_NODE && !OFFSCREEN_HEAD_ELEMENTS.has(node.localName))
		|| (node.nodeType == Node.TEXT_NODE && node.nodeValue.trim() != '');
}

Zotero.VirtualOffscreenTranslate = class {
	translateDoc = null;

	static async create() {
		let translate = new Zotero.VirtualOffscreenTranslate();
		await translate.sendMessage('Translate.new');
		return new Proxy(translate, {
			get: (target, property, ...args) => {
				if (!target[property] && (property in Zotero.Translate.Web.prototype)) {
					return (...args) => {
						return target.sendMessage(`Translate.${property}`, args);
					}
				}
				return Reflect.get(target, property, ...args);
			}
		});
	}
	
	constructor() {
		let mutationObserver;
		this.addMessageListener('MutationObserver.observe', ([selector, config]) => {
			if (mutationObserver) mutationObserver.disconnect();
			mutationObserver = new MutationObserver(() => {
				mutationObserver.disconnect();
				return this.sendMessage('MutationObserver.trigger');
			});
			const node = this.translateDoc.querySelector(selector);
			mutationObserver.observe(node, config);
		});
	}
	
	getProxy() {
		return this.sendMessage('Translate.getProxy');
	}
	
	async setHandler(name, callback) {
		let id = Zotero.Utilities.randomString(10);
		await this.sendMessage('Translate.setHandler', [name, id]);
		this.addMessageListener(`Translate.onHandler.${name}`, ([remoteId, args]) => {
			if (name == 'select') {
				args[2] = (...args) => {
					this.sendMessage('Translate.selectCallback', [id, args]);
				}
			}
			if (remoteId == id) {
				callback(...args);
			}
		});
	}
	
	setDocument(doc, updateLiveElements=false) {
		this.translateDoc = doc;
		if (updateLiveElements) {
			for (const checkbox of doc.querySelectorAll('input[type=checkbox]')) {
				if (checkbox.checked) {
					checkbox.setAttribute('checked', '');
				}
				else {
					checkbox.removeAttribute('checked');
				}
			}
		}
		let cookie = '';
		try {
			cookie = doc.cookie;
		}
		catch (e) {
		}

		const snapshot = doc.implementation.createHTMLDocument('')
			.importNode(doc.documentElement, true);
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
		const html = snapshot.outerHTML;
		return this.sendMessage('Translate.setDocument', [html, doc.location.href, cookie]);
	}
	
	async setTranslator(translators) {
		if (!Array.isArray(translators)) {
			translators = [translators];
		}
		translators = translators.map(t => t.serialize(Zotero.Translator.TRANSLATOR_PASSING_PROPERTIES));
		return this.sendMessage('Translate.setTranslator', [translators])
	}
	
	async getTranslators(...args) {
		let translators = await this.sendMessage('Translate.getTranslators', args);
		return translators.map(translator => new Zotero.Translator(translator));
	}
	
	sendMessage(message, payload=[]) {
		return Zotero.OffscreenManager.sendMessage(message, payload)
	}
	
	addMessageListener(...args) {
		return Zotero.Messaging.addMessageListener(...args)
	}
}
