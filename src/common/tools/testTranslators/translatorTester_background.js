
Zotero.TranslatorTesterBackground = {
	async runNonWebInOffscreen({
		translatorID,
		testType,
		input,
	}) {
		return Zotero.OffscreenManager.sendMessage(
			'translatorTester_runNonWeb',
			[translatorID, testType, input]
		);
	},

	async runDummyTranslationInTab({
		tabId,
		translatorID,
	}) {
		
		let tab = await browser.tabs.get(tabId);
		return Zotero.Messaging.sendMessage(
			'translatorTester_dummyTranslate',
			[
				translatorID,
			],
			tab
		);
	},
};
