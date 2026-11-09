var global = typeof window == "undefined" ? self : window;

var Zotero = global.Zotero = new function() {
	this.version = "5.0";
	this.locale = typeof navigator != "undefined" ? navigator.languages[0] : 'en';
	this.isConnector = true;
	this.isFx = false;
	this.isDebug = false;
	
	this.allowRepoTranslatorTester = this.isManifestV3
		= this.isFirefox = this.isSafari = null;
	this.isBrowserExt = true;
	"SET_IN_BUILD:allowRepoTranslatorTester";
	"SET_IN_BUILD:isManifestV3";

	this.initialized = false;
	this.initDeferred = {};
	this.initDeferred.promise = new Promise(function(resolve, reject) {
		this.initDeferred.resolve = resolve;
		this.initDeferred.reject = reject;
	}.bind(this));
	
	"SET_IN_BUILD:isFirefox";
	"SET_IN_BUILD:isSafari";

	this.isChrome = this.isEdge = false;
	if (!this.isFirefox && !this.isSafari) {
		this.isChromium = true;
		if (global.navigator.userAgent.includes("Edg/")) {
			this.isEdge = true;
		} else {
			this.isChrome = true;
		}
	}
	this.isOffscreen = typeof document != 'undefined' && document.location.href.endsWith('offscreenSandbox.html');

	this.isMac = (global.navigator.platform.substr(0, 3) == "Mac");
	this.isWin = (global.navigator.platform.substr(0, 3) == "Win");
	this.isLinux = (global.navigator.platform.substr(0, 5) == "Linux");

	if (this.isFirefox) {
		this.browser = "g";
		this.clientName = 'Firefox';
	} else if (this.isSafari) {
		this.browser = "s";
		this.clientName = 'Safari';
	} else if (this.isEdge) {
		this.browser = "c";
		this.clientName = 'Edge';
	} else if (this.isChrome) {
		this.browser = "c";
		this.clientName = 'Chrome';
	} else {
		this.browser = "i";
		this.clientName = global.navigator.appName;
	}
	this.appName = `${ZOTERO_CONFIG.CLIENT_NAME} Connector for ${this.clientName}`;
	
	if (!this.isOffscreen) {
		this.version = browser.runtime.getManifest().version;
	}
	
	this.Promise = Promise;
	
	this.migrate = async function() {
		let lastVersion = Zotero.Prefs.get('lastVersion') || Zotero.version;
		if (Zotero.Utilities.semverCompare(lastVersion, Zotero.version) > 0) {
			Zotero.debug(`Zotero.migrate: implausible stored lastVersion ${lastVersion} `
				+ `> ${Zotero.version}; resetting for migration evaluation`);
			lastVersion = "5.0.100";
		}
		if (Zotero.Utilities.semverCompare(lastVersion, "5.0.87") < 0 && !this.isFirefox) {
			Zotero.Prefs.set('firstUse', false);
		}
		if (Zotero.Utilities.semverCompare(lastVersion, "5.0.168") < 0 && Zotero.isFirefox) {
			const rules = await browser.declarativeNetRequest.getDynamicRules({});
			let ruleIDs = [];
			for (const rule of rules) {
				if (rule.action.type === 'modifyHeaders') {
					ruleIDs.push(rule.id);
				}
			}
			if (ruleIDs.length) {
				await browser.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ruleIDs });
			}
		}
		if (Zotero.isChromium) {
			let done = false;
			try { done = !!Zotero.Prefs.get('migration.resetTranslators'); } catch (e) {}
			if (!done) {
				Zotero.debug("Migration: resetting translator caches");
				try {
					Zotero.Prefs.clear('translatorMetadata');
					Zotero.Prefs.clear('connector.repo.lastCheck.localTime');
					Zotero.Prefs.clear('connector.repo.lastCheck.repoTime');
					await Zotero.Prefs.removeAllCachedTranslators();
					await Zotero.Translators.updateFromRemote(true);
				}
				catch (e) {
					Zotero.logError(e);
					return;
				}
				Zotero.Prefs.set('migration.resetTranslators', true);
			}
		}
		Zotero.Prefs.set('lastVersion', Zotero.version);
	};

	this.getVersion = function() {
		return Zotero.version;
	}
	
	this.initGlobal = async function() {
		await Zotero.Errors.init();
		if (Zotero.isManifestV3) {
			Zotero.Errors.logServiceWorkerStarts(Zotero.Date.dateToSQL(new Date()));
		}
		Zotero.isBackground = true;
		
		browser.runtime.getPlatformInfo().then(function (info) {
			switch (info.os) {
				case 'mac':
				case 'win':
					this.platform = info.os;
					break;

				default:
					this.platform = 'unix';
			}
		}.bind(this));
		
		if (this.isFirefox) {
			browser.runtime.getBrowserInfo().then(info => {
				this.browserVersion = info.version;
				this.browserMajorVersion = parseInt(info.version.match(/^[0-9]+/)[0]);
			});
		}

		Zotero.Messaging.init();
		Zotero.Connector_Types.init();
		await Zotero.Prefs.init();
		if (Zotero.isSafari) {
			Zotero.Prefs.set('firstUse', false);
		}
		
		Zotero.Debug.init();
		Zotero.Prefs.set('debug.store', false);
		Zotero.WebRequestIntercept.init();
		await Zotero.Connector_Browser.init();
		await Zotero.i18n.init();
		Zotero.Translators.init();
		await Zotero.Proxies.init();
		await this._initDateFormatsJSON();
		Zotero.initDeferred.resolve();
		Zotero.initialized = true;

		await Zotero.migrate();
	};
	
	this.initInject = async function() {
		Zotero.isInject = true;
		Zotero.Messaging.init();
		if (Zotero.isSafari) {
			await Zotero.i18n.init();
		}
		Zotero.Connector_Types.init();
		Zotero.Schema.init();
		await this._initDateFormatsJSON();
		Zotero.Prefs.loadNamespace(['translators.', 'downloadAssociatedFiles', 'automaticSnapshots', 'automaticTags',
			'reportTranslationFailure', 'capitalizeTitles', 'appearance']);
		await Zotero.Prefs.loadNamespace('debug');
		
		Zotero.Debug.init();
		Zotero.initDeferred.resolve();
		Zotero.initialized = true;
	};

	this.initOffscreen = async function() {
		this.version = await Zotero.getVersion();
		Zotero.Schema.init();
		await this._initDateFormatsJSON();
		await Zotero.Prefs.loadNamespace(['translators.', 'downloadAssociatedFiles', 'automaticSnapshots', 'automaticTags',
			'reportTranslationFailure', 'capitalizeTitles', 'appearance']);
	};

	this._initDateFormatsJSON = async function() {
		let url = Zotero.getExtensionURL('utilities/resource/dateFormats.json');
		if (Zotero.isOffscreen) {
			url = await url;
		}
		let xhr = await Zotero.HTTP.request('GET', url, {responseType: 'json'});
		Zotero.Date.init(xhr.response);
	};

	this.getSystemInfo = (...args) => Zotero.Errors.getSystemInfo(...args);
	
	this.debug = function(message, level) {
		Zotero.Debug.log(message, level);
	};
	
	this.logError = function(err) {
		Zotero.debug(err, 1);
		if(!global.console) return;
		
		var fileName = (err.fileName ? err.fileName : null);
		var lineNumber = (err.lineNumber ? err.lineNumber : null);
		
		if(!fileName && err.sourceURL) fileName = err.sourceURL;
		if(!lineNumber && err.line) lineNumber = err.line;
		
		if (!fileName && !lineNumber) {
			let stack = err.stack || new Error().stack;
			const stackRe = /^\s+at (?:[^(\n]* \()?([^\n]*):([0-9]+):([0-9]+)\)?$/m;
			var m = stackRe.exec(stack);
			if(m) {
				fileName = m[1];
				lineNumber = m[2];
			}
		}
		
		let message = err;
		if (typeof message != 'string') {
			message = err.message;
			if (typeof message != 'string' && typeof err == 'object') {
				message = err.toJSON();
			}
		}
		
		if(fileName && lineNumber) {
			console.error(message+" at "+fileName+":"+lineNumber);
		} else {
			console.error(err);
		}
		
		if (err.stack) {
			if (!Zotero.isChrome) {
				Zotero.Errors.log(err.message + '\n' + err.stack);
			} else {
				Zotero.Errors.log(err.stack);
			}
		} else {
			Zotero.Errors.log(err.message ? err.message : err.toString(), fileName, lineNumber);
		}
	};
	
	this.getString = function() {
		return Zotero.i18n.getString(...arguments);
	};
	
	this.getExtensionURL = function(path) {
		return browser.runtime.getURL(path);
	}
}

Zotero.Prefs = new function() {
	const DEFAULTS = {
		"debug.stackTrace": false,
		"debug.store": false,
		"debug.store.limit": 750000,
		"debug.level": 5,
		"debug.time": false,
		"lastVersion": "",
		"downloadAssociatedFiles": true,
		"automaticSnapshots": false,
		"automaticTags": true,
		"connector.repo.lastCheck.localTime": 0,
		"connector.repo.lastCheck.repoTime": 0,
		"connector.url": ZOTERO_CONFIG.CONNECTOR_URL,
		"capitalizeTitles": false,
		"firstUse": true,
		"appearance": "contrast",
		"reportTranslationFailure": false,
		"suppressAllHostsRecommendation": false,
		"singleFileConfig": {},
		"translatorMetadata": [],
		
		"proxies.transparent": false,
		"proxies.autoRecognize": false,
		"proxies.showRedirectNotification": false,
		"proxies.disableByDomain": false,
		"proxies.disableByDomainString": '.edu',
		"proxies.proxies": [],
		"proxies.loopPreventionTimestamp": 0
	};

	this.syncStorage = {};

	this.init = function() {throw new Error("Prefs initialization not overridden");};
	
	this.get = function(pref) {
		try {
			if (!(pref in this.syncStorage)) throw new Error(`Prefs.get: ${pref} not preloaded`);
			return this.syncStorage[pref];
		} catch (e) {
			if (DEFAULTS.hasOwnProperty(pref)) {
				if (Zotero.isInject) {
					Zotero.logError(new Error(`Prefs.get(${pref}) in injected script is getting a default value. `
						`This may be a bug. Either preload prefs or use getAsync()`));
				}
				return DEFAULTS[pref];
			}
			if (Zotero.isBackground) {
				throw new Error("Zotero.Prefs: Invalid preference "+pref);
			} else {
				throw e;
			}
		}
	};
	
	this.getAll = function() {
		let prefs = Object.assign({}, DEFAULTS, this.syncStorage);
		delete prefs['translatorMetadata'];
		for (const key of Object.keys(prefs)) {
			if (key.startsWith(Zotero.Translators.PREFS_TRANSLATOR_CODE_PREFIX)) delete prefs[key];
		}
		return Zotero.Promise.resolve(prefs);
	};
	
	this.getDefault = function() {
		return Object.assign({}, DEFAULTS);
	}
	
	this.getAsync = function(pref) {
		return new Zotero.Promise(function(resolve, reject) {
			try {
				if (typeof pref === "object") {
					var prefData = {};
					for(var i=0; i<pref.length; i++) {
						prefData[pref[i]] = Zotero.Prefs.get(pref[i]);
					}
					resolve(prefData);
				} else {
					resolve(Zotero.Prefs.get(pref));
				}	
			} catch (e) {
				reject(e);
			}
		});
	};

	this.loadNamespace = function(namespaces) {
		if (Zotero.isBackground) throw new Error('trying to load namespace in background. all prefs are available via the sync API');
		if (! Array.isArray(namespaces)) namespaces = [namespaces];
		return this.getAll().then(function(prefs) {
			let keys = Object.keys(prefs);
			for (let namespace of namespaces) {
				keys.filter((key) => key.indexOf(namespace) === 0)
					.forEach((key) => this.syncStorage[key] = prefs[key]);
			}
		}.bind(this));
	};

	this.set = function(pref, value) {
		Zotero.debug("Setting "+pref+" to "+JSON.stringify(value).substr(0, 100));
		this.syncStorage[pref] = value;
	};

	this.clear = function(pref) {
		if (Array.isArray(pref)) return pref.forEach((p) => this.clear(p));
		delete this.syncStorage[pref];
	}

	this.removeAllCachedTranslators = function() {
		Zotero.debug('Removing all cached translators');
		let cachedTranslators = Object.keys(this.syncStorage).filter(key => key.startsWith(Zotero.Translators.PREFS_TRANSLATOR_CODE_PREFIX));
		return this.clear(cachedTranslators);
	}
}
