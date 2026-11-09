let TranslateWeb = {
	async _initTranslate({ translate, doc, cookieSandbox, location, onSelect, onItemSaving, onDebug } = {}) {
		if (!translate) {
			translate = new Zotero.Translate.Web();
			if (!doc) throw new Error(`TranslateWeb: No document provided for translation`);
		}
		await Promise.all([
			doc && translate.setDocument(doc),
			cookieSandbox && translate.setCookieSandbox(cookieSandbox),
			location && translate.setLocation(location, location),
			onSelect && translate.setHandler('select', onSelect),
			onItemSaving && translate.setHandler('itemSaving', onItemSaving),
			onDebug && translate.setHandler('debug', onDebug)
		]);

		return translate;
	},

	async detect(options) {
		let translate = await this._initTranslate(options);
		
		if (options.translators) {
			translate.setTranslator(options.translators);
		}
		return translate.getTranslators(true, !!options.translators);
	},

	async translate(options) {
		let translate = await this._initTranslate(options);
		let translators = options.translators;
		if (!translators) {
			translators = await translate.getTranslators(true);
		}
		
		while (true) {
			let translator = translators.shift();
			translate.setTranslator(translator);
			try {
				let items = await translate.translate();
				return {
					items,
					proxy: translate._proxy
				};
			} catch (e) {
				if (translator.itemType != 'multiple' && translators.length) {
					if (options.onTranslatorFallback) {
						options.onTranslatorFallback(translator, translators[0]);
					}
				}
				else {
					throw e;
				}
			}
		}
	}
}

Zotero.Translate.ItemSaver.prototype.saveItems = async function (jsonItems) {
	this.items = (this.items || []).concat(jsonItems);
	return jsonItems
}

Zotero.TranslateWeb = TranslateWeb;