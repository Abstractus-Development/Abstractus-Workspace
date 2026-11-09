
Zotero.Messaging.addMessageListener('translatorTester_dummyTranslate', async (data) => {
	let [translatorID] = data;

	let translator = await Zotero.Translators.get(translatorID);
	
	let detectedTranslators = await detect(translator);
	if (!detectedTranslators.length) {
		return { items: null, reason: 'Detection failed' };
	}

	let detectedItemType = detectedTranslators[0].itemType;

	let translate = await Zotero.PageSaving._initTranslate(detectedItemType);
	translate.setHandler('debug', makeHandler('debug'));
	translate.setHandler('error', makeHandler('error'));
	translate.setHandler('select', makeHandler('select'));

	let { items } = await Zotero.TranslateWeb.translate({ translate, translators: [translator] });
	return { detectedItemType, items };
});

function makeHandler(handler) {
	return async (_, arg, maybeCallback) => {
		let returnValue = await browser.runtime.sendMessage({
			method: 'translatorTester_callHandler',
			handler,
			args: [{}, arg],
		});
		if (maybeCallback && typeof maybeCallback === 'function') {
			maybeCallback(returnValue);
		}
		return returnValue;
	};
}

async function detect(translator) {

	return new Promise(async (resolve, reject) => {
		let resolved = false;
		let resolveIfDetected = async () => {
			if (resolved) return false;
			let options = {
				translate: await Zotero.PageSaving._initTranslate(),
				translators: [translator],
			};
			let detectedTranslators = await Zotero.TranslateWeb.detect(options);
			if (detectedTranslators.length) {
				resolved = true;
				resolve(detectedTranslators);
				return true;
			}
			return false;
		}

		if (await resolveIfDetected()) {
			return;
		}
		document.addEventListener('readystatechange', () => resolveIfDetected());
		Zotero.Messaging.addMessageListener('pageModified', Zotero.Utilities.debounce(() => resolveIfDetected(), 1000));
		Zotero.Messaging.addMessageListener('historyChanged', Zotero.Utilities.debounce(() => resolveIfDetected(), 1000));

		let polls = 0;
		let pollInterval = setInterval(async () => {
			polls++;
			if (resolved) {
				clearInterval(pollInterval);
				return;
			}
			if (await resolveIfDetected()) {
				clearInterval(pollInterval);
				return;
			}
			if (polls >= 8) {
				clearInterval(pollInterval);
				if (!resolved) {
					resolved = true;
					resolve([]);
				}
			}
		}, 1000);
	});
}
