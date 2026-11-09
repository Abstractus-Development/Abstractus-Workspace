(function() {

'use strict';

Zotero.WebRequestIntercept = {
	listeners: {
		beforeSendHeaders: [],
		headersReceived: [],
		errorOccurred: []
	},
	
	reqIDToReqMeta: {},

	init: function() {
		const types = ["main_frame", "sub_frame"];
		let useBlocking = !Zotero.isManifestV3 && !Zotero.isSafari;
		let extraInfoSpec = ["requestHeaders"].concat(useBlocking ? ["blocking"] : []);
		browser.webRequest.onBeforeSendHeaders.addListener(Zotero.WebRequestIntercept.handleRequest('beforeSendHeaders'), {urls: ['<all_urls>'], types}, extraInfoSpec);
		browser.webRequest.onErrorOccurred.addListener(Zotero.WebRequestIntercept.removeRequestMeta, {urls: ['<all_urls>'], types});
		browser.webRequest.onCompleted.addListener(Zotero.WebRequestIntercept.removeRequestMeta, {urls: ['<all_urls>'], types});
		extraInfoSpec = ["responseHeaders"].concat(useBlocking ? ["blocking"] : []);
		browser.webRequest.onHeadersReceived.addListener(Zotero.WebRequestIntercept.handleRequest('headersReceived'), {urls: ['<all_urls>'], types}, extraInfoSpec);
		if (Zotero.isSafari) {
			browser.webRequest.onBeforeRedirect.addListener(Zotero.WebRequestIntercept.storeRedirect, {urls: ['<all_urls>'], types});
		}

		Zotero.WebRequestIntercept.addListener('beforeSendHeaders', Zotero.WebRequestIntercept.storeRequestHeaders)
		Zotero.WebRequestIntercept.addListener('headersReceived', Zotero.WebRequestIntercept.offerSavingPDFInFrame)
	},

	storeRequestHeaders: function(details, meta) {
		meta.requestHeadersObject = details.requestHeadersObject;
    },

	storeRedirect: function(details) {
		let meta = Zotero.WebRequestIntercept.reqIDToReqMeta[details.requestId];
		if (!meta) {
			meta = {};
			Zotero.WebRequestIntercept.reqIDToReqMeta[details.requestId] = meta;
		}
		meta.redirectUrl = details.redirectUrl;
	},

	offerSavingPDFInFrame: function(details) {
		if (!Number.isInteger(details.tabId) || details.tabId < 0 || !Number.isInteger(details.frameId) || details.frameId <= 0 || details.type !== 'sub_frame') return;
		if (!details.responseHeadersObject['content-type']) return;
		const contentType = details.responseHeadersObject['content-type'].split(';')[0];
		
		if (contentType == 'application/pdf') {
			setTimeout(() => Zotero.Connector_Browser.onPDFFrame(details.url, details.frameId, details.tabId));
		}
	},
	
	removeRequestMeta: function(details) {
		delete Zotero.WebRequestIntercept.reqIDToReqMeta[details.requestId];
	},
	
	processHeaders: function(headerArray) {
		if (!Array.isArray(headerArray)) return headerArray;
		
		let headers = {};
		for (let header of headerArray) {
			headers[header.name.toLowerCase()] = header.value;
		}
		return headers;
	},
	
	handleRequest: function(requestType) {
		return function(details) {
			if (!Zotero.WebRequestIntercept.listeners[requestType].length) return;

			let meta = Zotero.WebRequestIntercept.reqIDToReqMeta[details.requestId];
			if (!meta) {
				meta = {};
				Zotero.WebRequestIntercept.reqIDToReqMeta[details.requestId] = meta;
			}

			if (meta.redirectUrl) {
				details.url = meta.redirectUrl;
			}

			if (meta.requestHeadersObject) {
				details.requestHeadersObject = meta.requestHeadersObject;
			} else if (details.requestHeaders) {
				details.requestHeadersObject = Zotero.WebRequestIntercept.processHeaders(details.requestHeaders);
			}

			if (details.responseHeaders) {
				details.responseHeadersObject = Zotero.WebRequestIntercept.processHeaders(details.responseHeaders);
			}

			var returnValue = null;
			for (let listener of Zotero.WebRequestIntercept.listeners[requestType]) {
				let retVal = listener(details, meta);
				if (typeof retVal == 'object') {
					returnValue = Object.assign(returnValue || {}, retVal);
				}
			}
			if (returnValue !== null && !Zotero.isManifestV3) {
				return returnValue;
			}
		}
	},
	
	addListener: function(requestType, listener) {
		if (Zotero.WebRequestIntercept.listeners[requestType] === undefined) {
			throw new Error(`Web request listener for '${requestType}' not allowed`);
		}
		if (typeof listener != 'function') {
			throw new Error(`Web request listener of type ${typeof listener} is not allowed`);
		}
		Zotero.WebRequestIntercept.listeners[requestType].push(listener)
	},
	
	removeListener: function(requestType, listener) {
		if (Zotero.WebRequestIntercept.listeners[requestType] === undefined) {
			throw new Error(`Web request listener for '${requestType}' not allowed`);
		}
		if (typeof listener != 'function') {
			throw new Error(`Web request listener of type ${typeof listener} is not allowed`);
		}
		let idx = Zotero.WebRequestIntercept.listeners[requestType].indexOf(listener);
		if (idx != -1) {
			Zotero.WebRequestIntercept.listeners[requestType].splice(idx, 1);
		}
	},
	
	replaceHeaders: async function(url, headers) {
		return this.replaceHeadersDNR(url, headers);
	},

	_ruleID: 1 + Math.floor(Math.random() * 1e6),
	nextRuleID: function() {
		this._ruleID += 1;
		return this._ruleID;
	},
	
	replaceHeadersDNR: async function(url, headers) {
		const requestHeaders = headers.map((headerObj) => {
			if (headerObj.name.toLowerCase() === 'cookie') {
				return { header: headerObj.name.toLowerCase(), value: headerObj.value, operation: 'append' };
			}
			return { header: headerObj.name, value: headerObj.value, operation: 'set' }
		});
		const ruleID = this.nextRuleID();
		const rules = [{
			id: ruleID,
			action: {
				type: 'modifyHeaders',
				requestHeaders,
			},
			condition: {
				resourceTypes: ['xmlhttprequest'],
				initiatorDomains: [new URL(browser.runtime.getURL('')).hostname],
				requestDomains: [new URL(url).hostname],
			}
		}];
		Zotero.Connector_Browser.setKeepServiceWorkerAlive(true);
		this._activeRules.add(ruleID);
		try {
			await browser.declarativeNetRequest.updateSessionRules({
				removeRuleIds: rules.map(r => r.id),
				addRules: rules,
			});
			setTimeout(async () => {
				try {
					await Zotero.WebRequestIntercept.removeRuleDNR(ruleID);
				} catch (e) {
					Zotero.logError(e);
				}
			}, 60000);
			Zotero.debug(`HTTP: Added a DNR rule to change headers for ${url} to ${JSON.stringify(headers)}`);
		}
		catch (e) {
			Zotero.logError(e);
			await Zotero.WebRequestIntercept.removeRuleDNR(ruleID);
		}
		return ruleID;
	},

	_activeRules: new Set(),

	removeRuleDNR: async function(ruleId) {
		if (Zotero.WebRequestIntercept._activeRules.delete(ruleId)) {
			Zotero.Connector_Browser.setKeepServiceWorkerAlive(false);
		}
		return browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
	}
}

})();
