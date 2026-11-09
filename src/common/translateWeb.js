let TranslateWeb = {
	async _initTranslate({ document, onSelect, onItemSaving, onDebug, onError } = {}) {
		let translate = new Zotero.Translate.Web();
		await Promise.all([
			document && translate.setDocument(document),
			onSelect && translate.setHandler('select', onSelect),
			onItemSaving && translate.setHandler('itemSaving', onItemSaving),
			onDebug && translate.setHandler('debug', onDebug),
			onError && translate.setHandler('error', onError)
		]);

		return translate;
	},

	async detect(options) {
		let translate = await this._initTranslate(options);
		
		if (options.translators) {
			await translate.setTranslator(options.translators);
		}
		return translate.getTranslators(true, !!options.translators);
	},

	async translate(options) {
		let translate = await this._initTranslate(options);
		let translators = options.translators?.slice();
		if (!translators) {
			translators = await translate.getTranslators(true);
		}
		
		while (true) {
			let translator = translators.shift();
			await translate.setTranslator(translator);
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

Zotero.TranslateWeb = TranslateWeb;
