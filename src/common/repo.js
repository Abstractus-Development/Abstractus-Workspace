Zotero.Repo = new function() {
	this.infoRe = /^\s*{[\S\s]*?}\s*?[\r\n]/;

	async function checkRepositoryAccess() {
		if (!Zotero.isSafari) return;
		const hasPermission = await browser.permissions.contains({
			origins: ["https://repo.zotero.org/*"]
		});
		if (!hasPermission) {
			throw new Error('Repo: Skipping request without repo.zotero.org permission');
		}
	}
	
	this.getTranslatorCode = async function (translatorID, debugMode) {
		var translator = await Zotero.Translators.getWithoutCode(translatorID);
		var code;
		
		var trust = Zotero.TranslatorTrust.getActive();
		if (trust) {
			if (!trust.byId.has(translatorID)) {
				throw new Error(`Translator ${translatorID} is not in the signed manifest`);
			}
			code = await Zotero.TranslatorTrust.bundledCode(translatorID);
			if (code && !await Zotero.TranslatorTrust.codeMatches(translatorID, code)) code = null;
			if (!code && !ZOTERO_CONFIG.ALWAYS_FETCH_FROM_REPOSITORY) {
				try {
					code = await Zotero.Connector.callMethod("getTranslatorCode", { translatorID: translatorID });
					if (!await Zotero.TranslatorTrust.codeMatches(translatorID, code)) {
						Zotero.debug(`Repo: desktop code for ${translatorID} failed verification; discarded`);
						code = null;
					}
				}
				catch (e) {
					code = null;
				}
			}
			if (!code && !debugMode) {
				try {
					await checkRepositoryAccess();
					let xhr = await Zotero.HTTP.request("GET", this._codeURL(translatorID));
					code = xhr.responseText;
					if (!await Zotero.TranslatorTrust.codeMatches(translatorID, code)) {
						Zotero.debug(`Repo: repository code for ${translatorID} does not match the signed manifest; discarded`);
						code = null;
					}
				}
				catch (e) {
					code = null;
				}
			}
			if (!code) {
				throw new Error(`Failed to fetch verified code for translator ${translator ? translator.label : translatorID}`);
			}
			return code;
		}
		
		if (!debugMode) {
			try {
				await checkRepositoryAccess();
				let xhr = await Zotero.HTTP.request("GET", this._codeURL(translatorID));
				code = xhr.responseText;
			}
			catch (e) {}
		}
		
		if (!code) {
			throw new Error(`Failed to fetch code for translator ${translator.label}`)
		}
		
		var m = Zotero.Repo.infoRe.exec(code);
		if (!m) {
			throw new Error("Invalid or missing translator metadata JSON object for " + translator.label);
		}

		try {
			var metadata = JSON.parse(m[0]);
		} catch(e) {
			throw new Error("Invalid or missing translator metadata JSON object for " + translator.label);
		}

		if(metadata.lastUpdated !== translator.lastUpdated) {
			if (Zotero.Date.sqlToDate(metadata.lastUpdated) > Zotero.Date.sqlToDate(translator.lastUpdated)) {
				Zotero.debug("Repo: Retrieved code for "+metadata.label+" newer than stored metadata; updating");
				await Zotero.Translators.updateTranslator(metadata);
			}
		}
		return code;
	};
	
	this._codeURL = function (translatorID) {
		return `${ZOTERO_CONFIG.REPOSITORY_URL}code/${translatorID}?version=${ZOTERO_CONFIG.REPOSITORY_CLIENT_VERSION}`;
	};
	
	this.getTranslatorManifestFromZotero = async function() {
		if (ZOTERO_CONFIG.ALWAYS_FETCH_FROM_REPOSITORY) {
			throw new Error("Cannot fetch translators from the desktop when ALWAYS_FETCH_FROM_REPOSITORY is enabled");
		}
		return Zotero.Connector.callMethod("getTranslatorManifest", {});
	}
	
	this.getTranslatorMetadataFromServer = async function(reset=false) {
		var url = ZOTERO_CONFIG.REPOSITORY_URL + "metadata?version=" + ZOTERO_CONFIG.REPOSITORY_CLIENT_VERSION + "&last="+
				(reset ? "0" : Zotero.Prefs.get("connector.repo.lastCheck.repoTime"));

		await checkRepositoryAccess();
		xhr = await Zotero.HTTP.request('GET', url);
		var date = xhr.getResponseHeader("Date");
		Zotero.Prefs.set("connector.repo.lastCheck.localTime", Date.now());
		Zotero.Prefs.set("connector.repo.lastCheck.repoTime", Math.floor(Date.parse(date)/1000));
		return JSON.parse(xhr.responseText);
	}
}