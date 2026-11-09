Zotero.i18n.translateFragment = function (elem) {
	let elems = elem.querySelectorAll('[data-l10n-id]')
	for (let elem of elems) {
		let substitutions = elem.dataset.l10nClientName === undefined
			? undefined : ZOTERO_CONFIG.CLIENT_NAME;
		let str = Zotero.getString(elem.dataset.l10nId, substitutions);
		if (elem.nodeName === 'INPUT' && ["button", "submit"].includes(elem.type)) {
			elem.value = str;
		}
		else if (elem.nodeName === 'INPUT' && elem.type === "text") {
			elem.placeholder = str;
		}
		else {
			elem.innerText = str;
		}
	}
}