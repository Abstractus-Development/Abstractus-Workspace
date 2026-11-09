Zotero.BrowserAttachmentMonitor = {
	_downloads: new Map(),
	_nextRuleId: 50000,
	
	init: function() {
		this._webRequestListeners = new Map();
	},

	waitForAttachment: async function(tabId, url, timeoutMs=60000) {
		const ruleId = this._nextRuleId++;

		let resolveSucceeded;
		let rejectFailed;	
		const successPromise = new Promise((resolve, reject) => {
			resolveSucceeded = resolve;
			rejectFailed = reject;
		});
		this._addAttachmentDetectionListener(ruleId, tabId, resolveSucceeded);

		let hasRedirected = false
		const messageListener = (message, sender) => {
			if (sender.tab.id === tabId && message.type === 'attachment-monitor-loaded') {
				if (!message.success) {
					if (!hasRedirected) {
						browser.tabs.sendMessage(tabId, { type: 'redirect-attachment-monitor', url } );
						hasRedirected = true;
					}
					else {
						rejectFailed(new Error('Redirected back to browserAttachmentMonitor.html with no `success` hash param'));
					}
				}
				else {
					Zotero.debug(`BrowserAttachmentMonitor: Attachment successfully loaded for tab: ${tabId}`);
					resolveSucceeded(message.success);
					this._cleanup(ruleId, messageListener, tabRemovedListener);
				}
			}
		};

		const tabRemovedListener = (removedTabId) => {
			if (removedTabId === tabId) {
				this._cleanup(ruleId, messageListener, tabRemovedListener);
				rejectFailed(new Error(`Tab removed: ${tabId}`));
			}
		};
		browser.runtime.onMessage.addListener(messageListener);
		browser.tabs.onRemoved.addListener(tabRemovedListener);

		try {
			if (Zotero.isFirefox) {
				await this._addWebRequestRule(tabId, ruleId);
			} else {
				await this._addDNRRule(tabId, ruleId);
			}
			
			return await Promise.race([
				successPromise,
				Zotero.Promise.delay(timeoutMs).then(() => { 
					Zotero.debug(`Attachment monitor timed out after ${timeoutMs} ms for tab: ${tabId}`);
					throw new Error('Attachment monitor timed out'); 
				})
			]);
		}
		finally {
			this._cleanup(ruleId, messageListener, tabRemovedListener);
		}
	},

	_cleanup: async function(ruleId, messageListener, tabRemovedListener) {
		if (messageListener) {
			browser.runtime.onMessage.removeListener(messageListener);
		}
		if (tabRemovedListener) {
			browser.tabs.onRemoved.removeListener(tabRemovedListener);
		}

		if (ruleId) {
			const listeners = this._webRequestListeners.get(ruleId);
			if (listeners) {
				for (let listener of listeners) {
					browser.webRequest.onHeadersReceived.removeListener(listener);
				}
				this._webRequestListeners.delete(ruleId);
			}
			if (!Zotero.isFirefox) {
				await browser.declarativeNetRequest.updateSessionRules({
					removeRuleIds: [ruleId]
				});
			}
		}
	},

	_isAttachmentResponse: function(details) {
		let contentType = details.responseHeaders?.find(h => h.name.toLowerCase() === 'content-type')?.value;
		let contentDisposition = details.responseHeaders?.find(h => h.name.toLowerCase() === 'content-disposition')?.value;
		let hasAttachmentDisposition = contentDisposition && contentDisposition.toLowerCase().includes('attachment');
		let hasCorrectContentType = contentType && ['application/pdf', 'application/epub+zip'].some(type => contentType.toLowerCase().includes(type));
		return hasAttachmentDisposition || hasCorrectContentType;
	},

	_addAttachmentDetectionListener: function(ruleId, tabId, resolveSucceeded) {
		let attachmentFound = false;
		const listener = (details) => {
			if (!attachmentFound && this._isAttachmentResponse(details)) {
				attachmentFound = true;
				Zotero.debug(`BrowserAttachmentMonitor: Attachment response detected for tab: ${tabId}`);
				resolveSucceeded(details.url);
			}
		};
		browser.webRequest.onHeadersReceived.addListener(
			listener,
			{
				urls: ["<all_urls>"],
				tabId,
				types: ["main_frame", "sub_frame"]
			},
			["responseHeaders"]
		);
		this._addWebRequestListener(ruleId, listener);
	},

	_addWebRequestListener: function(ruleId, listener) {
		let listeners = this._webRequestListeners.get(ruleId);
		if (!listeners) {
			listeners = [];
			this._webRequestListeners.set(ruleId, listeners);
		}
		listeners.push(listener);
	},

	_addWebRequestRule: async function(tabId, ruleId) {
		const redirectUrl = Zotero.getExtensionURL("browserAttachmentMonitor/browserAttachmentMonitor.html#success");
	
		const listener = (details) => {
			if (this._isAttachmentResponse(details)) {
				return { redirectUrl };
			}
	
			return {}; 
		};
	
		browser.webRequest.onHeadersReceived.addListener(
			listener,
			{ urls: ["<all_urls>"], 
				tabId: tabId,
				types: ["main_frame", "sub_frame"] 
			},
			["blocking", "responseHeaders"]
		);
		
		this._addWebRequestListener(ruleId, listener);
		Zotero.debug(`BrowserAttachmentMonitor: Added listener for tab ${tabId} with ruleId ${ruleId}`);
	},
	
	_addDNRRule: async function(tabId, ruleId) {
		if (typeof Promise.try === "undefined") return;
		Zotero.debug(`BrowserAttachmentMonitor: Adding DNR rule for tab ${tabId} with ruleId ${ruleId}`);
		await browser.declarativeNetRequest.updateSessionRules({
			removeRuleIds: [ruleId],
			addRules: [{
				id: ruleId,
				action: {
					type: 'redirect',
					redirect: {
						extensionPath: '/browserAttachmentMonitor/browserAttachmentMonitor.html#success'
					}
				},
				condition: {
					resourceTypes: ['main_frame', 'sub_frame'],
					regexFilter: '.*',
					tabIds: [tabId],
					responseHeaders: [
						{
							header: 'content-disposition',
							values: ['*attachment*']
						},
						{
							header: 'content-type',
							values: ['application/pdf*', 'application/epub+zip*']
						}
					]
				}
			}]
		});
	}
};

Zotero.BrowserAttachmentMonitor.init();