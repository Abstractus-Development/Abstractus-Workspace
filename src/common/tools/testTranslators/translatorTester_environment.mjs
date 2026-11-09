
import {
	AbstractWebTranslationEnvironment,
	AbstractNonWebTranslationEnvironment,
} from './translatorTester.mjs';

let tabHandlers = new Map();

export class ConnectorNonWebTranslationEnvironment extends AbstractNonWebTranslationEnvironment {
	async runTranslation(test, { tester, signal }) {
		let result = await Promise.race([
			Zotero.TranslatorTesterBackground.runNonWebInOffscreen({
				translatorID: tester.translator.translatorID,
				testType: test.type,
				input: test.input,
			}),
			new Promise((_, reject) => {
				signal.addEventListener('abort', () => reject(signal.reason));
			}),
		]);

		if (!result) {
			return { items: null, reason: 'Failed to initialize translation' };
		}
		return result;
	}
}

export class ConnectorWebTranslationEnvironment extends AbstractWebTranslationEnvironment {

	async fetchPage(url, { tester }) {
		let tab;
		if (Zotero.isSafari) {
			tab = safari.application.activeBrowserWindow.openTab("background");
			tab.url = url;
			tab.id = (new Date()).getTime();
		}
		else {
			tab = await browser.tabs.create({ url, active: false });
		}
		return tab;
	}

	async waitForLoad(tab, { tester }) {
		let waited = 0;
		while (tab.status === 'loading' && waited < 10000) {
			await Zotero.Promise.delay(500);
			waited += 500;
			tab = await browser.tabs.get(tab.id);
		}

		if (tab.status === 'loading') {
			try {
				let [{ result }] = await browser.scripting.executeScript({
					target: { tabId: tab.id },
					func: () => document.readyState,
				});
				if (result === 'interactive' || result === 'complete') {
					return true;
				}
			}
			catch {
			}
		}

		return true;
	}

	async runTranslation(tab, { tester, handlers, signal }) {
		if (tester.translatorProvider !== Zotero.Translators) {
			throw new Error('Custom translatorProvider is not supported in Connector translator tests')
		}
		if (tester.cookieSandbox) {
			throw new Error('CookieSandbox is not supported in Connector translator tests')
		}

		tabHandlers.set(tab.id, handlers);
		let result = await Promise.race([
			Zotero.TranslatorTesterBackground.runDummyTranslationInTab({
				tabId: tab.id,
				translatorID: tester.translator.translatorID,
			}),
			new Promise((_, reject) => {
				signal.addEventListener('abort', () => reject(signal.reason));
			}),
		]);
		if (!result) {
			return { items: null, reason: 'Failed to initialize translation' };
		}
		return result;
	}

	async destroy(tab) {
		tabHandlers.delete(tab.id);
		browser.tabs.remove(tab.id);
	}
}

browser.runtime.onMessage.addListener((message, sender) => {
	if (typeof message !== 'object' || message.method !== 'translatorTester_callHandler') {
		return;
	}
	let { handler, args } = message;
	let handlers = tabHandlers.get(sender.tab.id);
	if (!handlers) {
		throw new Error(`Handlers not set for tab ${sender.tab.id}`);
	}
	return handlers[handler]?.(...args);
});
