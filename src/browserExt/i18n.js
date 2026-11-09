Zotero.i18n = {
	init: () => Zotero.Promise.resolve(),
	getString: function(name, substitutions) {
		if (substitutions != undefined && !Array.isArray(substitutions)) {
			substitutions = [substitutions];
		}
		var str;
		if (Zotero.isChrome) {
			try {
				str = chrome.i18n.getMessage(name, substitutions);
			} catch (e) {
				str = `{${name}}`;
			}
		} else {
			str = browser.i18n.getMessage(name, substitutions);
		}
		if (!str) {
			Zotero.logError(new Error(`Localized string '${name}' not defined`));
			str = '{' + name + '}';
		}
		return str;
	}
};
