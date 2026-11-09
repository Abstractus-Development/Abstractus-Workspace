var TRANSLATOR_TYPES = Zotero.Translator.TRANSLATOR_TYPES;

Zotero.Translators = new function() {
	this.PREFS_TRANSLATOR_CODE_PREFIX = 'translatorCode_';
	var _cache, _translators;
	var _initializedPromise;
	var _fullFrameDetectionWhitelist = ['resolver.ebscohost.com'];
	
	this._translatorsHash = null;
	this._sortedTranslatorHash = null;
	var _updateFromRemotePromise = null;

	this.init = async function() {
		if (_initializedPromise) return _initializedPromise;
		_cache = {"import":[], "export":[], "web":[], "search":[]};
		_translators = {};
		_initializedPromise = new Promise(async (resolve, reject) => {
			try {
				let signed = await Zotero.TranslatorTrust.load();
				let adopted = await Zotero.TranslatorTrust.loadBundled();
				if (adopted) signed = Zotero.TranslatorTrust.getActive();
				let translators = signed ? signed.metadata : Zotero.Prefs.get("translatorMetadata");
				if (typeof translators !== "object" || !translators.length) {
					Zotero.debug(`Translators: First time launch, getting all translators.`);
					await this.updateFromRemote(true);
				}
				else {
					this._load(translators);
					if (adopted) await this._applyManifestChange(adopted.previous);
				}
				this.keepTranslatorsUpdated();
				resolve();
			}
			catch (e) {
				_initializedPromise = null;
				reject(e);
			}
		})
		
	}
	
	this._load = function(jsonTranslators) {
		_cache = {"import":[], "export":[], "web":[], "search":[]};
		_translators = {};

		for (let jsonTranslator of jsonTranslators) {
			let translator = new Zotero.Translator(jsonTranslator);
			this._loadTranslator(translator, false);
		}
		
		for (const type in _cache) {
			_cache[type].sort((a, b) => a.priority - b.priority);
		}
		Zotero.debug(`Translators: Saved ${Object.keys(jsonTranslators).length} translators.`);
	}
	
	this._loadTranslator = function (translator, sort=true) {
		try {
			_translators[translator.translatorID] = translator;

			for (const type in TRANSLATOR_TYPES) {
				if (translator.translatorType & TRANSLATOR_TYPES[type]) {
					_cache[type].push(translator);
					if (sort) {
						_cache[type].sort((a, b) => a.priority - b.priority);
					}
				}
			}
		} catch(e) {
			Zotero.logError(e);
			try {
				Zotero.logError("Could not load translator "+JSON.stringify(jsonTranslator));
			} catch(e) {}
		}
	}
	
	this._removeTranslator = function (translatorID) {
		const translator = _translators[translatorID];
		this.deleteTranslatorCode(translatorID)
		delete _translators[translatorID];
		for (const type in TRANSLATOR_TYPES) {
			if (translator.translatorType & TRANSLATOR_TYPES[type]) {
				const idx = _cache[type].findIndex(t => t.translatorID === translator.translatorID);
				_cache[type].splice(idx, 1);
			}
		}
	}
	
	this.keepTranslatorsUpdated = async function() {
		const nextCascadeToRepo = Zotero.Prefs.get("connector.repo.lastCheck.localTime")
			+ZOTERO_CONFIG.REPOSITORY_CHECK_INTERVAL*1000;
		const now = Date.now();
		const repoCheckIntervalHasExpired = nextCascadeToRepo <= now;
		let repoCheckFailed = false;
		if (repoCheckIntervalHasExpired) {
			try {
				await this.updateFromRemote();
			}
			catch (e) {
				repoCheckFailed = true;
			}
		}
		
		let nextCheckIn = Math.max(0, nextCascadeToRepo - now);
		if (repoCheckIntervalHasExpired && repoCheckFailed) {
			nextCheckIn = ZOTERO_CONFIG.REPOSITORY_RETRY_INTERVAL * 1000;
		}
		Zotero.debug(`Repo: Next check in ${nextCheckIn/1000}s`);
		await Zotero.Promise.delay(nextCheckIn);
		return this.keepTranslatorsUpdated();
	}

	this.updateFromRemote = async function(reset=false) {
		if (_updateFromRemotePromise) {
			if (!reset) {
				Zotero.debug('Translators: Update already in progress -- waiting for it to complete');
				return _updateFromRemotePromise;
			}
			Zotero.debug('Translators: Waiting for in-progress update before resetting');
			try { await _updateFromRemotePromise; } catch (e) {}
		}
		let promise = this._doUpdateFromRemote(reset);
		_updateFromRemotePromise = promise;
		promise.finally(() => {
			if (_updateFromRemotePromise === promise) {
				_updateFromRemotePromise = null;
			}
		});
		return promise;
	}

	this._doUpdateFromRemote = async function(reset) {
		Zotero.debug('Retrieving translators from Zotero Client');
		let translatorMetadata;
		try {
			return await this.updateFromDesktop();
		}
		catch (e) {
			Zotero.debug('Signed translators from the desktop unavailable or rejected: ' + e.message);
			if (Zotero.TranslatorTrust.getActive()) {
				return;
			}
			Zotero.debug('No signed translator set yet, attempting Repo');
			try {
				translatorMetadata = await Zotero.Repo.getTranslatorMetadataFromServer(reset);
				return this.loadNewMetadata(translatorMetadata, reset, true)
			}
			catch (e) {
				Zotero.logError('Failed to retrieve translators from Zotero Client and Zotero Repo ' + e);
				throw e;
			}	
		}
	}

	this.updateFromDesktop = async function() {
		const wrapper = await Zotero.Repo.getTranslatorManifestFromZotero();
		const previous = await Zotero.TranslatorTrust.accept(wrapper);
		const active = Zotero.TranslatorTrust.getActive();
		if (previous && previous.sha256 === active.sha256) return;
		this._load(active.metadata);
		await this._applyManifestChange(previous);
	}

	this._applyManifestChange = async function(previous) {
		const active = Zotero.TranslatorTrust.getActive();
		for (const [id, entry] of (previous ? previous.byId : [])) {
			const next = active.byId.get(id);
			if (!next || next.sha256 !== entry.sha256) {
				Zotero.Prefs.clear(Zotero.Translators.PREFS_TRANSLATOR_CODE_PREFIX + id);
			}
		}
		await this._storeTranslatorMetadata();
		this._translatorsHash = null;
		this._sortedTranslatorHash = null;
	}

	this.loadNewMetadata = async function(newMetadata, reset=false, fromRepo=false) {
		if (!newMetadata.length) return;
		Zotero.debug('Loading new translator metadata');
		let updatedTranslators = [];
		let newTranslators = [];
		let deletedTranslators = new Set();
		
		if (reset) {
			await Zotero.Prefs.removeAllCachedTranslators();
			this._load(newMetadata);
			await this._storeTranslatorMetadata();
			
			this._translatorsHash = null;
			this._sortedTranslatorHash = null;
			return;
		}

		if (!fromRepo) {
			deletedTranslators = new Set(Object.keys(_translators));
			for (const translatorMetadata of newMetadata) {
				if (translatorMetadata.deleted) continue;
				if (_translators[translatorMetadata.translatorID]) {
					updatedTranslators.push(translatorMetadata);
				} else {
					newTranslators.push(translatorMetadata);
				}
				deletedTranslators.delete(translatorMetadata.translatorID);
			}
		}
		else {
			for (const translatorMetadata of newMetadata) {
				if (translatorMetadata.deleted) {
					deletedTranslators.add(translatorMetadata.translatorID);
				}
				else if(_translators.hasOwnProperty(translatorMetadata.translatorID)) {
					updatedTranslators.push(translatorMetadata);
				}
				else {
					newTranslators.push(translatorMetadata);
				}
			}
		}
		
		if (!newTranslators.length && !updatedTranslators.length && !deletedTranslators.size) return;

		for (const translatorMetadata of newTranslators) {
			Zotero.debug(`Translators: Adding ${translatorMetadata.label}`);
			this._loadTranslator(new Zotero.Translator(translatorMetadata));
		}

		updatedTranslators = updatedTranslators.filter((translatorMetadata) => {
			let translator = _translators[translatorMetadata.translatorID]
			if (translator.lastUpdated === translatorMetadata.lastUpdated) {
				return false;
			}
			Zotero.debug(`Translators: Updating ${translatorMetadata.label}`);
			translator.init(translatorMetadata)
			this.deleteTranslatorCode(translator.translatorID)
			return true;
		});

		for (const translatorID of deletedTranslators.keys()) {
			Zotero.Prefs.clear(Zotero.Translators.PREFS_TRANSLATOR_CODE_PREFIX + translatorID);
			this._removeTranslator(translatorID)
		}

		await this._storeTranslatorMetadata();
		Zotero.debug(`Translators: Saved (${Object.keys(_translators).length} translators. New ${newTranslators.length}, deleted ${deletedTranslators.size}, updated ${updatedTranslators.length})`);

		this._translatorsHash = null;
		this._sortedTranslatorHash = null;
	}
	
	this.updateTranslator = async function(translatorMetadata) {
		let translator = _translators[translatorMetadata.translatorID]
		translator.init(translatorMetadata)
		await this._storeTranslatorMetadata();
	}
	
	this._storeTranslatorMetadata = async function() {
		let serializedTranslators = this.serialize(Object.values(_translators), Zotero.Translator.TRANSLATOR_CACHING_PROPERTIES);
		return Zotero.Prefs.set('translatorMetadata', serializedTranslators);
	}
	
	this.getTranslatorsHash = async function (sorted) {
		let prop = sorted ? "_sortedTranslatorHash" : "_translatorsHash";
		if (this[prop]) return this[prop];
		await this.init();
		let translators = Object.keys(_translators).map(id => _translators[id]);
		if (sorted) {
			translators.sort((a, b) => a.translatorID.localeCompare(b.translatorID));
		}

		let hashString = "";
		for (let translator of translators) {
			hashString += `${translator.translatorID}:${translator.lastUpdated},`;
		}
		this[prop] = Zotero.Utilities.Connector.md5(hashString);
		return this[prop];
	}
	
	this.deleteTranslatorCode = async function (id) {
		let translator = _translators[id];
		if (translator) delete translator.code;
		return Zotero.Prefs.clear(Zotero.Translators.PREFS_TRANSLATOR_CODE_PREFIX + id);
	}
	
	this.getWithoutCode = async function(id) {
		await Zotero.Translators.init();
		return _translators[id] ? _translators[id] : false;
	}

	this.getCodeForTranslator = async function (translator) {
		if (Zotero.TranslatorTrust.getActive()) {
			let cached = translator.code;
			if (!cached) {
				try { cached = Zotero.Prefs.get(Zotero.Translators.PREFS_TRANSLATOR_CODE_PREFIX + translator.translatorID); }
				catch (e) {}
			}
			if (cached && await Zotero.TranslatorTrust.codeMatches(translator.translatorID, cached)) {
				translator.code = cached;
				return cached;
			}
			delete translator.code;
			if (cached) {
				Zotero.debug(`Translators: cached code for ${translator.translatorID} failed verification; discarded`);
				await Zotero.Prefs.clear(Zotero.Translators.PREFS_TRANSLATOR_CODE_PREFIX + translator.translatorID);
			}
			let fresh = await Zotero.Repo.getTranslatorCode(translator.translatorID);
			if (!await Zotero.TranslatorTrust.codeMatches(translator.translatorID, fresh)) {
				throw new Error(`Translator ${translator.translatorID} failed verification`);
			}
			Zotero.Prefs.set(Zotero.Translators.PREFS_TRANSLATOR_CODE_PREFIX + translator.translatorID, fresh);
			translator.code = fresh;
			return fresh;
		}
		if (translator.code) return translator.code;
		
		let code;
		try {
			code = Zotero.Prefs.get(Zotero.Translators.PREFS_TRANSLATOR_CODE_PREFIX + translator.translatorID);
		}
		catch (e) {
			code = await Zotero.Repo.getTranslatorCode(translator.translatorID);
			Zotero.Prefs.set(Zotero.Translators.PREFS_TRANSLATOR_CODE_PREFIX + translator.translatorID, code);
		}

		translator.code = code;
		return code;
	}

	this.get = async function (id) {
		await Zotero.Translators.init();
		var translator = _translators[id];
		if (!translator) {
			return false;
		}
		
		if(translator.runMode === Zotero.Translator.RUN_MODE_IN_BROWSER
				&& !translator.hasOwnProperty("code")) {
			await Zotero.Translators.getCodeForTranslator(translator);
		}
		return translator;
	};
	
	this.getAllForType = async function (type, debugMode) {
		await Zotero.Translators.init();
		var translators = _cache[type].slice(0);
		var codeGetter = new Zotero.Translators.CodeGetter(translators, debugMode);
		await codeGetter.getAll();
		return translators;
	};
	
	this.getWebTranslatorsForLocation = async function (URI, rootURI, callback) {
		await Zotero.initDeferred.promise;
		await Zotero.Translators.init();
		if (callback) {
			rootURI = URI;
		} else {
			for (let str of _fullFrameDetectionWhitelist) {
				if (URI.includes(str)) {
					rootURI = URI;
					break;
				}
			}
		}
		var isFrame = URI !== rootURI;
		var allTranslators = _cache["web"];
		var potentialTranslators = [];
		var proxies = [];
		
		var rootSearchURIs = Zotero.Proxies.getPotentialProxies(rootURI);
		var frameSearchURIs = isFrame ? Zotero.Proxies.getPotentialProxies(URI) : rootSearchURIs;

		Zotero.debug("Translators: Looking for translators for "+Object.keys(frameSearchURIs).join(', '));

		for(var i=0; i<allTranslators.length; i++) {
			var translator = allTranslators[i];
			if (isFrame && !translator.webRegexp.all) {
				continue;
			}
			rootURIsLoop:
			for(var rootSearchURI in rootSearchURIs) {
				var isGeneric = !allTranslators[i].webRegexp.root;
				if(isGeneric && allTranslators[i].runMode !== Zotero.Translator.RUN_MODE_IN_BROWSER) {
					continue;
				}

				var rootURIMatches = isGeneric || rootSearchURI.length < 8192 && translator.webRegexp.root.test(rootSearchURI);
				if (translator.webRegexp.all && rootURIMatches) {
					for (var frameSearchURI in frameSearchURIs) {
						var frameURIMatches = frameSearchURI.length < 8192 && translator.webRegexp.all.test(frameSearchURI);
							
						if (frameURIMatches) {
							potentialTranslators.push(translator);
							proxies.push(frameSearchURIs[frameSearchURI]);
							break rootURIsLoop;
						}
					}
				} else if(!isFrame && (isGeneric || rootURIMatches)) {
					potentialTranslators.push(translator);
					proxies.push(rootSearchURIs[rootSearchURI]);
					break;
				}
			}
		}
		
		var codeGetter = new Zotero.Translators.CodeGetter(potentialTranslators);
		await codeGetter.getAll();
		return [potentialTranslators, proxies];
	};

	this.serialize = function(translator, properties) {
		if (Array.isArray(translator)) {
			var newTranslators = new Array(translator.length);
			for(var i in translator) {
				newTranslators[i] = Zotero.Translators.serialize(translator[i], properties);
			}
			return newTranslators;
		}
		
		var newTranslator = {};
		for(var i in properties) {
			var property = properties[i];
			newTranslator[property] = translator[property];
		}
		return newTranslator;
	}
}

Zotero.Translators.CodeGetter = function(translators) {
	this._translators = translators;
	this._concurrency = 2;
};

Zotero.Translators.CodeGetter.prototype.getCodeFor = async function(i) {
	let translator = this._translators[i];
	try {
		translator.code = await Zotero.Translators.getCodeForTranslator(translator);
	} catch (e) {
		Zotero.debug(`Failed to retrieve code for ${translator.translatorID}`)
	}
	return translator.code;
};

Zotero.Translators.CodeGetter.prototype.getAll = async function () {
	let codes = [];
	for (let i = 0; i < this._translators.length; i++) {
		if (i < this._concurrency) {
			codes.push(this.getCodeFor(i));
		} else {
			codes.push(codes[i-this._concurrency].then(() => this.getCodeFor(i)));
		}
	}
	return Promise.all(codes);
};
