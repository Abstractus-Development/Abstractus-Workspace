Zotero.Prefs = Object.assign(Zotero.Prefs, {
	init: async function() {
		try {
			this.syncStorage = await browser.storage.local.get(null);
		}
		catch (e) {
			Zotero.debug("Prefs initialization failed");
			Zotero.logError(e);
		}
	},

	set: async function(pref, value) {
		Zotero.debug("Setting "+pref+" to "+JSON.stringify(value).substr(0, 100));
		let prefs = {};
		prefs[pref] = value;

		this.syncStorage[pref] = value;
		try {
			await browser.storage.local.set(prefs);
		} catch (e) {
			Zotero.debug(`Setting ${pref} failed. Attempting to free up space and trying again.`)
			await this._freeUpPrefsSpace()
			await browser.storage.local.set(prefs);
		}
	},

	clear: async function(pref) {
		if (Array.isArray(pref)) return Zotero.Promise.all(pref.map((p) => this.clear(p)));
		delete this.syncStorage[pref];
		return browser.storage.local.remove(pref);
	},

	_freeUpPrefsSpace: async function() {
		const numToRemove = 5;
		let candidates = Object.keys(this.syncStorage).filter(key => key.startsWith(Zotero.Translators.PREFS_TRANSLATOR_CODE_PREFIX));
		let toBeRemoved = [];
		for (let i = 0; i < numToRemove; i++) {
			toBeRemoved.push(candidates[Math.floor(Math.random() * candidates.length)]);
		}
		return this.clear(toBeRemoved);
	}
});
