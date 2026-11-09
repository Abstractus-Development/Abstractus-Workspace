const FETCH_REQUEST_EVENT = "single-file-request-fetch";
const FETCH_RESPONSE_EVENT = "single-file-response-fetch";

Zotero.SingleFile = {
	_hooksInjected: false,
	_throttledRequest: Zotero.Utilities.Connector.throttleAsync(Zotero.COHTTP.request, 10),

	singleFileFetch: async function(url, options = {}) {
		try {
			options.referrerPolicy = 'strict-origin-when-cross-origin';
			return await this.hostFetch(url, options);
		} catch (e) { }
		options.responseType = 'arraybuffer';
		options.referrer = document.location.href;
		delete options.referrerPolicy;
		let xhr = await this._throttledRequest("GET", url, options);
		return {
			status: xhr.status,
			arrayBuffer: async () => xhr.response,
			headers: { get: header => xhr.getResponseHeader(header) },
		}
	},
	
	hostFetch: async function (url, options) {
		return new Promise((resolve, reject) => {
			document.dispatchEvent(new CustomEvent(FETCH_REQUEST_EVENT, { detail: JSON.stringify({ url, options }) }));
			document.addEventListener(FETCH_RESPONSE_EVENT, onResponseFetch, false);

			function onResponseFetch(event) {
				if (event.detail) {
					if (event.detail.url == url) {
						document.removeEventListener(FETCH_RESPONSE_EVENT, onResponseFetch, false);
						if (event.detail.response) {
							resolve({
								status: event.detail.status,
								headers: new Map(event.detail.headers),
								arrayBuffer: async () => event.detail.response
							});
						} else {
							reject(event.detail.error);
						}
					}
				} else {
					reject();
				}
			}
		});
	},
	
	retrievePageData: async function() {
		if (!this._hooksInjected) {
			await this._injectSingleFileHooks();
			this._hooksInjected = true;
		}
		try {
			if (typeof singlefile === 'undefined') {
				await Zotero.Connector_Browser.injectSingleFile();
			}

			Zotero.debug("SingleFile: Retrieving page data");
			if (Zotero.Inject.notification) Zotero.Inject.notification.dismiss()
			const config = await this._getConfig();
			let pageData = await singlefile.getPageData(config, {
				fetch: (...args) => Zotero.SingleFile.singleFileFetch(...args)
			});
			Zotero.debug("SingleFile: Done retrieving page data");

			return pageData.content;
		} catch (e) {
			Zotero.debug("SingleFile: Error retrieving page data", 2);
			Zotero.debug(e.stack, 2);
			throw e;
		}
	},

	_getConfig: async function() {
		let singleFileConfig;
		try {
			singleFileConfig = await Zotero.Prefs.getAsync('singleFileConfig');
		}
		catch (e) {
			Zotero.debug(`SingleFile: Could not read singleFileConfig pref: ${e}`, 2);
		}
		if (!singleFileConfig || typeof singleFileConfig !== 'object' || Array.isArray(singleFileConfig)) {
			if (singleFileConfig !== undefined) {
				Zotero.debug('SingleFile: Ignoring invalid singleFileConfig pref; expected an object', 2);
			}
			singleFileConfig = {};
		}
		return Object.assign({}, Zotero.SingleFile.CONFIG, singleFileConfig);
	},

	_injectSingleFileHooks: function() {
		const scriptElement = document.createElement("script");
		scriptElement.src = Zotero.getExtensionURL("lib/SingleFile/single-file-hooks-frames.js");
		scriptElement.async = false;
		let promise = new Promise((resolve, reject) => {
			scriptElement.onload = () => resolve();
			scriptElement.onerror = () => reject();
		});
		let insertElement = document.head || document.documentElement || document;
		insertElement.appendChild(scriptElement);
		scriptElement.remove();
		return promise;
	},

	
	_base64StringToUint8Array(base64) {
		const text = atob(base64);
		const length = text.length;
		const bytes = new Uint8Array(length);
		for (let i = 0; i < length; i++) {
			bytes[i] = text.charCodeAt(i);
		}
		return bytes;
	}
};