Zotero.Connector = new function() {
	const CONNECTOR_API_VERSION = 3;
	const PASSIVE_METHODS = new Set(['ping', 'getTranslatorCode', 'getTranslators', 'getTranslatorManifest', 'getClientHostnames']);
	
	this.isOnline = (Zotero.isSafari || Zotero.isFirefox) ? false : null;
	this.clientVersion = '';
	this.prefs = {
		reportActiveURL: false
	};
	
	this.checkIsOnline = async function({active=false, permissionPromptShown=false}={}, tab=null) {
		let hadLocalhostPermission = true;
		if (Zotero.isSafari && active) {
			hadLocalhostPermission = await browser.permissions.contains({
				origins: ["http://127.0.0.1/*"]
			});
		}
		try {
			await this.ping({}, {active, permissionPromptShown}, tab);
			return true;
		} catch (e) {
			if (typeof e.status === 'number' && e.status > 0) {
				Zotero.debug("Checking if Zotero is online returned a non-zero HTTP status.");
				Zotero.logError(e);
				return true;
			}
			if (Zotero.isSafari) {
				const hasLocalhostPermission = await browser.permissions.contains({
					origins: ["http://127.0.0.1/*"]
				});
				if (!hasLocalhostPermission) {
					return null;
				}
				if (active && !hadLocalhostPermission) {
					return this.checkIsOnline({active, permissionPromptShown: true}, tab);
				}
			}
			return false;
		}
	};
	
	this.getConnectionState = () => Zotero.AbstractusTransport.getConnectionState();

	this.onStateChange = function(version) {
		Zotero.Connector_Browser?.onStateChange(version);
	}

	this.reportActiveURL = function(url) {
		if (!this.isOnline || !this.prefs.reportActiveURL) return;
		
		let payload = { activeURL: url };
		this.ping(payload);
	}
	
	this.getPref = function(pref) {
		return Zotero.Connector.prefs[pref];
	}
	
	this._processPreferences = function(prefs) {
		const PREF_KEYS = [
			'downloadAssociatedFiles',
			'reportActiveURL',
			'automaticSnapshots',
			'supportsTagsAutocomplete',
			'canUserAddNote'
		];
		for (const key of PREF_KEYS) {
			const val = !!prefs[key];
			Zotero.Connector.prefs[key] = val;
		}
	}
	
	this._processTranslatorHash = function(prefs) {
		if (prefs.translatorsHash) {
			(async () => {
				let sorted = !!prefs.sortedTranslatorHash;
				let remoteHash = sorted ? prefs.sortedTranslatorHash : prefs.translatorsHash;
				let translatorsHash = await Zotero.Translators.getTranslatorsHash(sorted);
				if (remoteHash != translatorsHash) {
					Zotero.debug("Zotero Ping: Translator hash mismatch detected. Updating translators from Zotero")
					return Zotero.Translators.updateFromRemote();
				}
			})()
		}
	}
	
	this.ping = async function(payload={}, options={}, tab=null) {
		let response = await Zotero.Connector.callMethod({method: "ping", ...options}, payload, tab);
		if (response && 'prefs' in response) {
			this._processPreferences(response.prefs);
			this._processTranslatorHash(response.prefs);
		}
		return response || {};
	}
	
	this.getClientVersion = async function(options={}, tab=null) {
		let isOnline = await this.checkIsOnline({...options, active: options.active ?? !!tab}, tab);
		return isOnline && this.clientVersion;
	}
	
	this.callMethod = async function(options, data = null, tab = null) {
		if (typeof options == 'string') {
			options = {method: options};
		}
		var method = options.method;
		let localhostPermissionMissing = false;
		if (Zotero.isSafari) {
			const hasLocalhostPermission = await browser.permissions.contains({
				origins: ["http://127.0.0.1/*"]
			});
			if (!hasLocalhostPermission) {
				localhostPermissionMissing = true;
				const isActive = options.active || !PASSIVE_METHODS.has(method);
				if (!isActive) {
					throw new Zotero.Connector.CommunicationError(
						`Connector: Skipping passive ${method} request without localhost permission`
					);
				}
				if (!options.permissionPromptShown && !Zotero.HostPermissions.localhostRequestBlocked) {
					await Zotero.HostPermissions.prompt(
						{domains: ['127.0.0.1'], recommendAllHosts: true, nativePromptToFollow: true},
						tab
					);
				}
			}
		}
		var headers = Object.assign({
				"Content-Type":"application/json",
				"X-Zotero-Version":Zotero.version,
				"X-Zotero-Connector-API-Version":CONNECTOR_API_VERSION
			}, options.headers || {});
		var timeout = "timeout" in options ? options.timeout : 15000;
		var queryString = options.queryString ? ("?" + options.queryString) : "";
		
		var uri = Zotero.Prefs.get('connector.url') + "connector/" + method + queryString;
		if (headers["Content-Type"] == 'application/json') {
			data = JSON.stringify(data);
		}
		else if (headers["Content-Type"] == 'multipart/form-data') {
			let formData = new FormData();
			for (const entry in data) {
				if (entry.startsWith('binary-')) {
					const int8array = new Uint8Array(Object.values(data[entry]));
					formData.append(entry, new Blob([int8array]));
				}
				else {
					formData.append(entry, data[entry]);
				}
			}
			data = formData;
		}
		options = { body: data, headers, successCodes: false, timeout };
		let httpMethod = data === null ? "GET" : "POST";
		try {
			const xhr = await Zotero.AbstractusTransport.request(httpMethod, uri, options);
			Zotero.Connector.clientVersion = xhr.getResponseHeader('X-Zotero-Version');
			if (Zotero.Connector.isOnline !== true) {
				Zotero.Connector.isOnline = true;
				Zotero.Connector.onStateChange(Zotero.Connector.clientVersion)
			}
			var val = xhr.response
			if (xhr.responseText) {
				let contentType = xhr.getResponseHeader("Content-Type") || ""
				if (contentType.includes("application/json")) {
					val = JSON.parse(xhr.responseText);
				} else {
					val = xhr.responseText;
				}
			}
			if (xhr.status === 0 || (xhr.status >= 400
					&& !xhr.getResponseHeader('X-Zotero-Version'))) {
				if (Zotero.Connector.isOnline !== false) {
					Zotero.Connector.isOnline = false;
					Zotero.Connector.onStateChange(Zotero.Connector.clientVersion)
				}
				throw new Zotero.Connector.CommunicationError('Connector: Zotero is offline');
			}
			else if (xhr.status >= 400) {
				if (xhr.status === 412) {
					if (Zotero.Connector_Browser && Zotero.Connector_Browser.onIncompatibleStandaloneVersion) {
						var standaloneVersion = xhr.getResponseHeader("X-Zotero-Version");
						Zotero.Connector_Browser.onIncompatibleStandaloneVersion(Zotero.version, standaloneVersion);
						throw new Zotero.Connector.CommunicationError(`Connector: Version mismatch: Connector version ${Zotero.version}, Standalone version ${standaloneVersion ? standaloneVersion : "<unknown>"}`, xhr.status, val);
					}
				}
				
				Zotero.debug("Connector: Method "+method+" failed with status "+xhr.status);
				throw new Zotero.Connector.CommunicationError(`Method ${method} failed`, xhr.status, val);
			} else {
				Zotero.debug("Connector: Method "+method+" succeeded");
				return val;
			}
		} catch (e) {
			if (localhostPermissionMissing && e.status == 0
					&& !await browser.permissions.contains({origins: ["http://127.0.0.1/*"]})) {
				Zotero.HostPermissions.localhostRequestBlocked = true;
			}
			if (e.name === 'AbstractusConnectionError') {
				if (this.isOnline !== false) {
					this.isOnline = false;
					this.onStateChange(this.clientVersion);
				}
			}
			else if (!(e instanceof Zotero.Connector.CommunicationError) && !(e instanceof Zotero.HTTP.StatusError)){
				Zotero.logError(e);
			}
			throw e;
		}
	},
	
	this.saveSingleFile = async function(options, data) {
		return this.callMethod(options, data);
	}
}

Zotero.Connector.CommunicationError = function (message, status=0, value='') {
    this.name = 'Connector Communication Error';
    this.message = message;
    this.status = status;
    this.value = value;
}
Zotero.Connector.CommunicationError.prototype = new Error;
