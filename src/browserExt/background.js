if (!Zotero.isManifestV3) {
	browser.action = browser.browserAction;
}

Zotero.Connector_Browser = new function() {
	const abstractusToolbarIcon = {16: 'images/zotero-new-z-16px.png', 32: 'images/zotero-new-z-16px@2x.png'};
	var _tabInfo = {};
	var _tabInjections = {};
	var _incompatibleVersionMessageShown;
	var _injectTranslationScripts = [
		__INJECT_SCRIPTS__
	];
	var _betaBuildExpiration = new Date(2053, 0, 1, 0, 0, 0);
	var _isBetaBuildBeyondExpiration = false;
	this._tabInfo = _tabInfo;
	let buttonContext = ['browser_action'];
	
	this._keepServiceWorkerAlive = 0;
	
	this.shouldKeepServiceWorkerAlive = () => this._keepServiceWorkerAlive;
	this.setKeepServiceWorkerAlive = (val) => {
		this._keepServiceWorkerAlive = Math.max(0, this._keepServiceWorkerAlive + (val ? 1 : -1));
	};
	
	this.init = async function() {
		await Zotero.TranslateHostFrameManager.init();
		if (Zotero.isManifestV3) {
			if (Zotero.isChromium) {
				buttonContext.push('action');
			}
			this._tabInfo = _tabInfo = await Zotero.Utilities.Connector.createMV3PersistentObject('tabInfo', {ignoreKeys: ['selectCallback']});
			setInterval(async () => {
				let tabs = await browser.tabs.query({});
				for (let tab of tabs) {
					if (!(tab.id in _tabInfo)) {
						_clearInfoForTab(tab.id)
					}
				}
			}, 15 * 60e3);
			this.isDev = (await browser.management.getSelf()).installType === 'development';
			_isBetaBuildBeyondExpiration = this.isDev && new Date > _betaBuildExpiration;
		}
	}
	
	this._getNewTabInfo = function() {
		return {
			url: null,
			translators: null,
			selectCallback: null,
			frameChecked: false,
			isPDF: false,
			uninjectable: false,
			instanceID: null
		}
	}

	 this.resetTabInfo = function (tabId) {
		_tabInfo[tabId] = this._getNewTabInfo();
		return _tabInfo[tabId];
	}

	this.getTabInfo = function(tabId) {
		if (_tabInfo[tabId]) return _tabInfo[tabId];
		return this.resetTabInfo(tabId);
	}

	this.getAllCookies = async function(details, tab=null) {
		if (!Zotero.isFirefox && !Zotero.isSafari) {
			return browser.cookies.getAll(details);
		}
		
		if (Zotero.isSafari && details.storeId) {
			return browser.cookies.getAll(details);
		}
		
		details = {...details};
		
		if (tab == null) {
			let tabs = await browser.tabs.query({active: true, currentWindow: true});
			tab = tabs[0];
		}

		if (Zotero.isFirefox) {
			if (tab.cookieStoreId) {
				details.storeId = tab.cookieStoreId;
			}
		}
		else {
			let stores = await browser.cookies.getAllCookieStores();
			let store = stores.find(store => store.tabIds.includes(tab.id))
				|| stores.find(store => store.tabIds.length)
				|| stores[0];
			if (store) {
				details.storeId = store.id;
			}
		}
		
		if (Zotero.isFirefox && !details.hasOwnProperty('firstPartyDomain')) {
			try {
				return await browser.cookies.getAll(details);
			}
			catch (_) {
				let hostname;
				try {
					hostname = new URL(tab.url).hostname;
				}
				catch (error) {
					Zotero.logError(error);
					return [];
				}

				let cookies = await browser.cookies.getAll({
					...details,
					firstPartyDomain: null,
				});
				let firstPartyDomain = cookies
					.map(cookie => cookie.firstPartyDomain)
					.filter(domain => domain
						&& (hostname === domain || hostname.endsWith(`.${domain}`)))
					.sort((a, b) => b.length - a.length)[0];
				if (!firstPartyDomain) return [];
				
				return browser.cookies.getAll({
					...details,
					firstPartyDomain,
				});
			}
		}

		return browser.cookies.getAll(details);
	}

	this.executeScript = function(tabId, details) {
		if (Zotero.isManifestV3) {
			if (details.hasOwnProperty('code')) {
				Zotero.logError(`Attempting to inject script in MV3 with code string: ${details.code}`);
				return;
			}
			delete details.runAt;
			if (details.hasOwnProperty('file')) {
				details.files = [details.file];
				delete details.file;
			}
			if (!details.hasOwnProperty('target')) details.target = {};
			details.target.tabId = tabId;
			if (details.hasOwnProperty('frameId')) {
				details.target.frameIds = [details.frameId];
				delete details.frameId;
			}
			delete details.runAt;
			let executeScript = chrome ? chrome.scripting.executeScript : browser.scripting.executeScript;
			return executeScript(details);
		}
		else {
			return browser.tabs.executeScript(tabId, details);
		}
	};
	
	this.onTranslators = function(translators, instanceID, contentType, tab, frameId) {
		if (_isBlockedSite(tab.url)) return;
		_enableForTab(tab.id);
		let tabInfo = this.getTabInfo(tab.id);

		let existingTranslators = tabInfo.translators;
		if (existingTranslators) {
			if (!translators.length) return;
			
			if (existingTranslators.length) {
				let existingTranslatorsHaveHigherPriority = existingTranslators[0].priority < translators[0].priority;
				if (existingTranslatorsHaveHigherPriority) return;
				
				let priorityEqual = translators[0].priority == existingTranslators[0].priority;
				let newTranslatorsAreFromTopFrame = frameId == 0;
				if (priorityEqual && !newTranslatorsAreFromTopFrame) return;
			}	
		}
		
		var isPDF = contentType == 'application/pdf';
		_tabInfo[tab.id] = Object.assign(_tabInfo[tab.id] || {}, {translators, instanceID, isPDF});
		
		Zotero.Connector_Browser._updateExtensionUI(tab);
	}

	this.onPDFFrame = async function(frameURL, frameId, tabId) {
		if (!Number.isInteger(tabId) || tabId < 0 || !Number.isInteger(frameId) || frameId <= 0) return;
		let tab, frame;
		try {
			tab = await browser.tabs.get(tabId);
			frame = await browser.webNavigation.getFrame({tabId, frameId});
		} catch { return; }
		if (!frame?.url || frame.url.split('#')[0] !== frameURL.split('#')[0]) return;
		let tabInfo = this.getTabInfo(tabId);
		if (tabInfo.translators && tabInfo.translators.length) return;
		_tabInfo[tab.id] = Object.assign(_tabInfo[tab.id] || {}, {translators: [], isPDF: true, frameId, frameURL});
		try {
			await Zotero.Connector_Browser.injectTranslationScripts(tab, frameId, frameURL);
			await Zotero.Connector_Browser._updateExtensionUI(tab);
		} catch (error) { Zotero.logError(error); }
	}
	
	this.onSelect = async function(items, tab) {
		await Zotero.Connector_Browser.openWindow(
			browser.runtime.getURL("itemSelector/itemSelector.html")
				+ "#" + encodeURIComponent(JSON.stringify([tab.id, items])),
			{width: 600, height: 325}, tab
		);
		try {
			Zotero.Connector_Browser.setKeepServiceWorkerAlive(true);
			return await new Promise((resolve) => {
				let tabInfo = this.getTabInfo(tab.id);
				tabInfo.selectCallback = resolve;
			});
		}
		finally {
			Zotero.Connector_Browser.setKeepServiceWorkerAlive(false);
		}
	};
	
	this.onPageLoad = function(url, tab) {
		if(tab) _updateInfoForTab(tab.id, url);
	}
	
	this.onStateChange = function(version) {}
	
	this.onTabActivated = function(tab) {
		Zotero.Connector_Browser._updateExtensionUI(tab);
	};
	
	this.onIncompatibleStandaloneVersion = function(connectorVersion, clientVersion) {
		if (_incompatibleVersionMessageShown) return;
		alert(Zotero.getString('browserAction_incompatibleVersion', [
			ZOTERO_CONFIG.CLIENT_NAME,
			connectorVersion,
			clientVersion ? " (" + clientVersion + ")" : ""
		]));
		_incompatibleVersionMessageShown = true;
	}

	this.onZoteroButtonElementClick = function(tab) {
		return _browserAction(tab);
	}
	
	this.newerVersionRequiredPrompt = function() {
		return Zotero.Messaging.sendMessage('confirm', {
			title: Zotero.getString("general_warning"),
			button2Text: "",
			message: Zotero.getString("progressWindow_error_upgradeClient", ZOTERO_CONFIG.CLIENT_NAME)
		});
	}

	this.onFrameLoaded = async function(tab, frameId, url) {
		if (_isDisabledForURL(tab.url) && frameId == 0 || _isDisabledForURL(url)) {
			return;
		}
		Zotero.debug("Connector_Browser: onFrameLoaded for " + tab.url + "; " + url);
		if (frameId == 0) {
			return;
		} else {
			let tabInfo = this.getTabInfo(tab.id);
			if (!tabInfo.frameChecked) {
				tabInfo.frameChecked = true;
				return Zotero.Connector_Browser.injectTranslationScripts(tab, frameId, url);
			}
		}
		if (url == tab.url) {
			Zotero.debug(`Ignoring frame ${frameId} with a tab matching url ${tab.url}`);
			return;
		}
		return Zotero.Translators.getWebTranslatorsForLocation(url, tab.url).then(function(translators) {
			if (translators[0].length == 0) {
				Zotero.debug("Not injecting. No translators found for [tab.url, url]: " + tab.url + " , " + url);
				return;
			}
			Zotero.debug(translators[0].length+  " translators found. Injecting into [tab.url, url]: " + tab.url + " , " + url);
			return Zotero.Connector_Browser.injectTranslationScripts(tab, frameId, url);
		});
	};
		
	this.isIncognito = function(tab) {
		return tab.incognito;
	}

	this.isTabFocused = function(tab) {
		return tab.active;
	}
	
	this.injectTranslationScripts = async function(tab, frameId=0, url=null) {
		if (_isBlockedSite(tab.url) || (url && !/^(about:|blob:|data:)/i.test(url) && _isBlockedSite(url))) return;
		let key = tab.id+'-'+frameId;
		let deferred = this.injectTranslationScripts[key];
		if (deferred) {
			Zotero.debug(`Translation Inject: Script injection already in progress for ${key}`);
			return deferred.promise;
		}
		deferred = Zotero.Promise.defer();
		this.injectTranslationScripts[key] = deferred;

		try {
			let response = await Zotero.Messaging.sendMessage('ping', null, tab, frameId)
			if (response && frameId == 0) return deferred.resolve();
			url = url ? `${url} - ${tab.url}` : tab.url
			Zotero.debug(`Injecting translation scripts into ${frameId} ${url}`);
			return await Zotero.Connector_Browser.injectScripts(_injectTranslationScripts, tab, frameId);
		} catch (e) {
			Zotero.debug(`Translation Inject: Script injection rejected ${key}`);
			Zotero.debug(e.message);
		} finally {
			delete Zotero.Connector_Browser.injectTranslationScripts[key];
		}
	};
	
	this.INJECTION_TIMEOUT = 10000;

	this.injectScripts = async function(scripts, tab, frameId=0) {
		function* injectScripts() {
			if (! Array.isArray(scripts)) scripts = [scripts];
			scripts = Array.from(scripts);
			Zotero.debug(`Inject: Injecting scripts into ${frameId} - ${tab.url} : ${scripts.join(', ')}`);
			
			for (let script of scripts) {
				yield Zotero.Connector_Browser.executeScript(tab.id, {file: script, frameId, runAt: 'document_end'})
					.catch(() => undefined);
			}
			
			let readyMsg = `ready${Date.now()}`;
			if (Zotero.isManifestV3) {
				yield Zotero.Connector_Browser.executeScript(tab.id, {
					frameId,
					args: [readyMsg],
					func: (readyMsg) => {
						browser.runtime.onMessage.addListener(function awaitReady(request) {
							if (request == readyMsg) {
								browser.runtime.onMessage.removeListener(awaitReady);
								return Promise.resolve(true);
							}
						});
					}
				})
			} else {
				yield browser.tabs.executeScript(tab.id, {
					code: `browser.runtime.onMessage.addListener(function awaitReady(request) {
					if (request == '${readyMsg}') {
						browser.runtime.onMessage.removeListener(awaitReady);
						return Promise.resolve(true);
					}
				})`,
					frameId,
					runAt: 'document_end'
				});	
			}
			
			while (true) {
				try {
					var response = yield browser.tabs.sendMessage(tab.id, readyMsg, {frameId: frameId});
				} catch (e) {}
				if (!response) {
					yield Zotero.Promise.delay(100);
				} else {
					Zotero.debug(`Inject: Complete ${frameId} - ${tab.url}`);
					return true;
				}
			}		
		}
		var timedOut = Zotero.Promise.defer();
		let timeout = setTimeout(function() {
			timedOut.reject(new Error (`Inject: Timed out ${frameId} - ${tab.url} after ${this.INJECTION_TIMEOUT}ms`))
		}.bind(this), this.INJECTION_TIMEOUT);
		
		let injections = _tabInjections[tab.id] || (_tabInjections[tab.id] = {});
		let deferred;
		try {
			deferred = injections[frameId];
			if (deferred) {
				Zotero.debug(`Inject: Script injection already in progress for ${frameId} - ${tab.url}`);
				await deferred.promise;
			}
		} catch (e) {}
		deferred = Zotero.Promise.defer();
		injections[frameId] = deferred;
		
		function tabRemovedListener(tabID) {
			if (tabID != tab.id) return;
			deferred.reject(new Error(`Inject: Tab removed mid-injection into ${frameId} - ${tab.url}`))
		}
		browser.tabs.onRemoved.addListener(tabRemovedListener);

		try {
			var iter = injectScripts();
			var val = iter.next();
			while (true) {
				if (val.done) {
					return val.value;
				}
				if (val.value.then) {
					let nextVal = await Promise.race([
						timedOut.promise,
						deferred.promise,
						val.value
					]);
					val = iter.next(nextVal);
				} else {
					val = iter.next(val.value);
				}
			}
		}
		catch(e) {
			Zotero.debug(e.message);
		} finally {
			browser.tabs.onRemoved.removeListener(tabRemovedListener);
			deferred.resolve();
			delete injections[frameId];
			clearTimeout(timeout);
		}
	};

	this.injectSingleFile = async function(tab, frameId) {
		Zotero.debug("SingleFile: injecting SingleFile into page");
		const singleFileScripts = ["lib/SingleFile/single-file-bootstrap.js", "lib/SingleFile/single-file.js"]
		await this.injectScripts(singleFileScripts, tab, frameId)
		await this.injectScripts('singlefile-config.js', tab, frameId);
	};
	
	this.openWindow = async function(url, options={}, tab=null) {
		if (!tab) {
			tab = await getCurrentTab();
		}
		options = Object.assign({
			width: 800,
			height: 600,
			type: "popup"
		}, options);
		let win = await browser.windows.get(tab.windowId, null);
		options.left = Math.floor(win.left + (win.width / 2) - (options.width / 2));
		options.top = Math.floor(win.top + (win.height / 2) - (options.height / 2));
			
		win = await browser.windows.create({
			url,
			type: options.type,
			width: options.width,
			height: options.height,
			left: options.left,
			top: options.top
		});
		
		if (win.left < options.left) {
			browser.windows.update(win.id, { left: options.left });
		}
		if (Zotero.isFirefox) {
			await Zotero.Promise.delay(1000);
			browser.windows.update(win.id, {width: win.width+1});
		}
		if (typeof options.onClose == 'function') {
			browser.windows.onRemoved.addListener(function onClose(id) {
				if (id == win.id) options.onClose();
				browser.windows.onRemoved.removeListener(onClose);
			});
		}
		return win;
	};
	
	this.bringToFront = async function(drawAttention=false, tab) {
		var windowId;
		if (tab && tab.windowId) {
			windowId = tab.windowId;
		} else {
			let win = await browser.windows.getLastFocused();
			windowId = win.id;
		}
		browser.windows.update(windowId, {drawAttention, focused: true});
	}

	this.openTab = async function(url, tab) {
		if (!tab) {
			tab = await getCurrentTab();
		}
		let tabProps = { index: tab.index + 1 };
		if (!Zotero.isFirefox) {
			tabProps.openerTabId = tab.id;
		}
		browser.tabs.create(Object.assign({url}, tabProps));
	};
	
	this.openPreferences = function(paneID, tab) {
		if (typeof paneID !== 'string') {
			tab = paneID;
			paneID = 'general';
		}
		this.openTab(browser.runtime.getURL(`preferences/preferences.html#${paneID}`), tab);
	};
	
	
	this.waitForTabToLoad = async function(tab) {
		if (typeof tab === 'number') {
			tab = await browser.tabs.get(tab);
		}
		if (tab.status == 'complete') {
			return;
		}
		return new Promise (async (resolve, reject) => {
			async function waitForLoad(tabId, changeInfo) {
				try {
					if (changeInfo.status == 'complete') {
						browser.tabs.onUpdated.removeListener(waitForLoad);
						resolve();
					}
				} catch (_) {}
			}
			browser.tabs.onUpdated.addListener(waitForLoad);
			setTimeout(() => {
				browser.tabs.onUpdated.removeListener(waitForLoad)
				reject(new Error('Timeout waiting for tab to load'));
			}, 5000);
		})
	}

	this.notify = async function(text, buttons, seenTimeout=5000, tab=null) {
		if (!tab) {
			tab = await getCurrentTab();
		} else if (typeof tab === 'number') {
			tab = await browser.tabs.get(tab);
		}
		let timedOut = false;
		seenTimeout && setTimeout(() => timedOut = true, seenTimeout);
		var response = await Zotero.Messaging.sendMessage('notify', [text, buttons, null, tab.status], tab)
		if (response != undefined || timedOut) return response;
		
		await Zotero.Promise.delay(500)
		var tab = await browser.tabs.get(tab.id)
		if (!tab) return;
		return this.notify(text, buttons, seenTimeout, tab);
	};

	this._updateExtensionUI = async function (tab) {
		if (!tab) {
			tab = await getCurrentTab();
		}
		if (Zotero.Prefs.get('firstUse') || _isBetaBuildBeyondExpiration) return _showMessageButton(tab);
		if (!tab.active || tab.id < 0) return;
		let url = tab.url || tab.pendingUrl;
		if (!url) {
			return;
		}
		browser.contextMenus.removeAll();
		if (!browser.contextMenus.onClicked.hasListener(_handleContextMenuClick)) {
			browser.contextMenus.onClicked.addListener(_handleContextMenuClick);
		}

		let isDisabled = _isDisabledForURL(url, true)
		if (isDisabled && _isBlockedSite(url)) {
			_showBlockedButton(tab, url);
			return;
		}
		if (isDisabled) {
			_showZoteroStatus(tab.id, isDisabled);
			return;
		} else {
			_enableForTab(tab.id);
			browser.action.setBadgeText({tabId: tab.id, text: ''});
		}

		let tabInfo = this.getTabInfo(tab.id);
		var isPDF = tabInfo.isPDF;
		var translators = tabInfo.translators;
		
		if (Zotero.isSafari && !translators && !isPDF) {
			return;
		}
		
		var showSaveMenu = (translators && translators.length) || !isPDF;
		let unproxiedURL = Zotero.Proxies.proxyToProper(url, true);
		var showProxyMenu = !isPDF
			&& Zotero.Proxies.transparent
			&& Zotero.Proxies.proxies.length > 0
			&& !unproxiedURL;
		
		var saveMenuID;
		if (showSaveMenu) {
			saveMenuID = "zotero-context-menu-save-menu";
			browser.contextMenus.create({
				id: saveMenuID,
				title: `${Zotero.getString('general_saveTo', ZOTERO_CONFIG.CLIENT_NAME)}`,
				contexts: [...buttonContext, 'page', 'selection']
			});
		}
		
		if (translators && translators.length) {
			_showTranslatorIcon(tab, translators[0]);
			_showTranslatorContextMenuItem(translators, saveMenuID);
			_showNoteContextMenuItems(translators, saveMenuID);
		} else if (isPDF) {
			Zotero.Connector_Browser._showPDFIcon(tab);
		} else {
			_showWebpageIcon(tab);
		}
		
		if (isPDF) {
			_showPDFContextMenuItem(saveMenuID);
		} else {
			_showWebpageContextMenuItem(saveMenuID);
		}
		
		if (showProxyMenu) {
			_showProxyContextMenuItems(url);
		}
		if (unproxiedURL && !(Zotero.isFirefox && isPDF)) {
			_showCopyUnproxiedURLCopyContextMenuItem(url);
		}
		
		if (!Zotero.isChromium) {
			_showPreferencesContextMenuItem();
			_showTabContextMenuItem();
		}
	}
	
	const _contextMenuHandlers = {
		"zotero-context-menu-translator-save-with-selection-note": function (info, tab) {
			Zotero.Connector_Browser.saveWithTranslator(
				tab,
				0,
				{
					note: '<blockquote>' + Zotero.Utilities.htmlSpecialChars(info.selectionText) + '</blockquote>'
				}
			);
		},
		"zotero-context-menu-webpage-withSnapshot-save": function (info, tab) {
			Zotero.Connector_Browser.saveAsWebpage(tab, 0, { snapshot: true });
		},
		"zotero-context-menu-webpage-withoutSnapshot-save": function (info, tab) {
			Zotero.Connector_Browser.saveAsWebpage(tab, 0);
		},
		"zotero-context-menu-pdf-save": function (info, tab) {
			Zotero.Connector_Browser.saveAsWebpage(tab);
		},
		"zotero-context-menu-preferences": function () {
			browser.tabs.create({url: browser.runtime.getURL('preferences/preferences.html')});
		},
		"zotero-context-menu-copy-unproxied-url": async (info, tab) => {
			Zotero.Messaging.sendMessage('clipboardWrite', [Zotero.Proxies.proxyToProper(tab.url)], tab);
		},
		"zotero-context-menu-copy-unproxied-link": async (info, tab) => {
			Zotero.Messaging.sendMessage('clipboardWrite', [Zotero.Proxies.proxyToProper(info.linkUrl)], tab);
		},
		"zotero-context-menu-tabs": async () => {
			const tabs = await browser.tabs.query({highlighted: true, currentWindow: true});
			Zotero.debug(`Saving ${tabs.length} tabs`);
			for (let tab of tabs) {
				await _browserAction(tab);
			}
		}
	};
	
	async function _handleContextMenuClick(info, tab) {
		const id = info.menuItemId;
		if (id.startsWith("zotero-context-menu-copy-unproxied")) {
			await browser.permissions.request({permissions: ['clipboardWrite']});
		}
		const shouldContinue = await Zotero.HostPermissions.checkChromiumActionPermissions(tab);
		if (!shouldContinue) {
			return;
		}
		if (!await _ensureScriptsInjected(tab)) {
			return;
		}

		if (Zotero.isChromium && tab.id === -1) {
			tab = await getCurrentTab();
		}
		const handler = _contextMenuHandlers[id];
		if (handler) {
			return handler(info, tab);
		}
		const parts = id.split('-');
		if (id.startsWith("zotero-context-menu-translator-save-")) {
			const translatorIdx = parts[parts.length-1];
			return Zotero.Connector_Browser.saveWithTranslator(tab, translatorIdx);
		}
		else if(id.startsWith("zotero-context-menu-proxy-reload-")) {
			const proxyIdx = parts[parts.length-1];
			const proxy = Zotero.Proxies.proxies[proxyIdx];
			const proxied = proxy.toProxy(tab.url);
			if (Zotero.Proxies.isPreventingRedirectLoops()) {
				Zotero.Proxies.toggleRedirectLoopPrevention(false)
			}
			browser.tabs.update({ url: proxied });
		}
	}
	
	function _showZoteroStatus(tabID, message) {
		Zotero.Connector.checkIsOnline().then(function(isOnline) {
			var icon, title;
			if (isOnline) {
				icon = "images/zotero-new-z-16px.png";
				title = Zotero.getString('browserAction_status_online', ZOTERO_CONFIG.CLIENT_NAME);
			}
			else if (isOnline === null) {
				icon = "images/zotero-new-z-16px.png";
				title = Zotero.getString('appConnector', ZOTERO_CONFIG.CLIENT_NAME);
			}
			else {
				icon = "images/zotero-z-16px-offline.png";
				title = Zotero.getString('browserAction_status_offline', ZOTERO_CONFIG.CLIENT_NAME);
			}
			if (typeof message === 'string') {
				title = message;
			}
			browser.action.setIcon({
				tabId: tabID,
				path: icon
			});

			browser.action.setTitle({
				tabId: tabID,
				title
			});
		});
		browser.action.disable(tabID);
		browser.contextMenus.removeAll();
	}

	function _enableForTab(tabID) {
		if (tabID < 0) {
			Zotero.debug('Invalid attempt to enable browser button for tab ' + tabID);
			return;
		}
		browser.action.enable(tabID);
	}

	function _blockedTitle(url) {
		const category = Zotero.SiteBlocklist.categoryFor(url);
		return 'Abstractus is off on this site' + (category ? ' (' + category + ')' : '');
	}

	function _showBlockedButton(tab, url) {
		browser.action.setIcon({tabId: tab.id, path: 'images/zotero-z-16px-offline.png'});
		browser.action.setTitle({tabId: tab.id, title: _blockedTitle(url)});
		browser.action.setBadgeText({tabId: tab.id, text: 'off'});
		if (browser.action.setBadgeBackgroundColor) browser.action.setBadgeBackgroundColor({tabId: tab.id, color: '#6b7280'});
		browser.action.enable(tab.id);
		browser.contextMenus.removeAll();
	}

	async function _showBlockedNotice(tab) {
		const category = Zotero.SiteBlocklist.categoryFor(tab.url);
		await browser.windows.create({
			url: browser.runtime.getURL('preferences/blocked.html') + '?c=' + encodeURIComponent(category),
			type: 'popup', width: 380, height: 300, focused: true
		});
	}

	function _showTranslatorIcon(tab, translator) {
		browser.action.setIcon({
			tabId:tab.id,
			path: abstractusToolbarIcon
		});

		browser.action.setTitle({
			tabId:tab.id,
			title: _getTranslatorLabel(translator)
		});
	}

	function _showWebpageIcon(tab) {
		browser.action.setIcon({
			tabId: tab.id,
			path: abstractusToolbarIcon
		});
		let withSnapshot = Zotero.Connector.isOnline ? Zotero.Connector.prefs.automaticSnapshots :
			Zotero.Prefs.get('automaticSnapshots');
		let title = Zotero.getString(withSnapshot
			? 'browserAction_saveWebpageWithSnapshot'
			: 'browserAction_saveWebpageWithoutSnapshot', ZOTERO_CONFIG.CLIENT_NAME);
		browser.action.setTitle({tabId: tab.id, title});
	}

	this._showPDFIcon = function(tab) {
		browser.action.setIcon({
			tabId: tab.id,
			path: abstractusToolbarIcon
		});
		browser.action.setTitle({
			tabId: tab.id,
			title: Zotero.getString('browserAction_savePDF', ZOTERO_CONFIG.CLIENT_NAME)
		});
	}

	function _showTranslatorContextMenuItem(translators, parentID) {
		for (var i = 0; i < translators.length; i++) {
			browser.contextMenus.create({
				id: "zotero-context-menu-translator-save-" + i,
				title: _getTranslatorLabel(translators[i]),
				parentId: parentID,
				contexts: ['page', ...buttonContext]
			});
		}
	}

	function _showNoteContextMenuItems(translators, parentID) {
		if (translators[0].itemType == "multiple") return;
		browser.contextMenus.create({
			id: "zotero-context-menu-translator-save-with-selection-note",
			title: Zotero.getString('contextMenu_saveWithNote', ZOTERO_CONFIG.CLIENT_NAME),
			parentId: parentID,
			contexts: ['selection']
		});
	}

	function _showWebpageContextMenuItem(parentID) {
		var fns = [];
		fns.push(() => browser.contextMenus.create({
			id: "zotero-context-menu-webpage-withSnapshot-save",
			title: Zotero.getString('browserAction_saveWebpageWithSnapshot', ZOTERO_CONFIG.CLIENT_NAME),
			parentId: parentID,
			contexts: ['page', ...buttonContext]
		}));
		fns.push(() => browser.contextMenus.create({
			id: "zotero-context-menu-webpage-withoutSnapshot-save",
			title: Zotero.getString('browserAction_saveWebpageWithoutSnapshot', ZOTERO_CONFIG.CLIENT_NAME),
			parentId: parentID,
			contexts: ['page', ...buttonContext]
		}));
		let withSnapshot = Zotero.Connector.isOnline ? Zotero.Connector.prefs.automaticSnapshots :
			Zotero.Prefs.get('automaticSnapshots');
		if (!withSnapshot) {
			fns = [fns[1]];
		}
		fns.forEach((fn) => fn());
	}

	function _showPDFContextMenuItem(parentID) {
		browser.contextMenus.create({
			id: "zotero-context-menu-pdf-save",
			title: Zotero.getString('browserAction_savePDF', ZOTERO_CONFIG.CLIENT_NAME),
			parentId: parentID,
			contexts: ['all']
		});
	}

	function _showProxyContextMenuItems(url) {
		var parentID = "zotero-context-menu-proxy-reload-menu";
		browser.contextMenus.create({
			id: parentID,
			title: Zotero.getString("reloadViaProxy"),
			contexts: ['page', ...buttonContext]
		});

		var i = 0;
		for (let proxy of Zotero.Proxies.proxies) {
			let name = proxy.toDisplayName();
			browser.contextMenus.create({
				id: `zotero-context-menu-proxy-reload-${i++}`,
				title: Zotero.getString("reloadVia", name),
				parentId: parentID,
				contexts: ['page', ...buttonContext]
			});
		}
	}

	function _showCopyUnproxiedURLCopyContextMenuItem(url) {
		browser.contextMenus.create({
			id: `zotero-context-menu-copy-unproxied-url`,
			title: Zotero.getString('copyUnproxiedPageURL'),
			contexts: ['page', ...buttonContext]
		});
		for (let proxy of Zotero.Proxies.proxies) {
			let proxyHostname = proxy.toDisplayName();
			if (url.includes(proxyHostname)) {
				browser.contextMenus.create({
					id: `zotero-context-menu-copy-unproxied-link`,
					title: Zotero.getString('copyUnproxiedLink'),
					contexts: ['link'],
					targetUrlPatterns: [`*://*.${proxyHostname}/*`]
				});		
				break;
			}
		}
	}

	function _showTabContextMenuItem() {
		browser.contextMenus.create({
			id: "zotero-context-menu-tabs",
			title: `${Zotero.getString('general_saveTo', ZOTERO_CONFIG.CLIENT_NAME)}`,
			contexts: ['tab']
		});
	}
	function _showPreferencesContextMenuItem() {
		browser.contextMenus.create({
			type: "separator",
			id: "zotero-context-menu-pref-separator",
			contexts: ['page', ...buttonContext]
		});
		browser.contextMenus.create({
			id: "zotero-context-menu-preferences",
			title: Zotero.getString('general_preferences'),
			contexts: ['page', ...buttonContext]
		});
	}
	

	function _showMessageButton(tab) {
		var icon = `${Zotero.platform}/zotero-z-32px-australis.png`;
		browser.action.setIcon({
			tabId: tab.id,
			path: `images/${icon}`
		});
		browser.action.setTitle({
			tabId: tab.id,
			title: Zotero.getString('appConnector', ZOTERO_CONFIG.CLIENT_NAME)
		});
		browser.action.enable(tab.id);
	}
	
	function _clearInfoForTab(tabID) {
		delete _tabInfo[tabID];
		delete _tabInjections[tabID];
	}
	
	function _updateInfoForTab(tabId, url) {
		let tabInfo = Zotero.Connector_Browser.getTabInfo(tabId);
		if (tabInfo.url !== null && tabInfo.url !== url) {
			Zotero.debug(`Connector_Browser: URL changed from ${tabInfo.url} to ${url}`);
			let injections = _tabInjections[tabId];
			if (injections) {
				for (let frameId in injections) {
					injections[frameId].reject(new Error(`URL changed for tab ${url}`));
				}
			}
		}
		tabInfo = Zotero.Connector_Browser.resetTabInfo(tabId);
		tabInfo.url = url;
	}

	function _isBlockedSite(url) {
		return !!url && !url.startsWith(browser.runtime.getURL('')) && Zotero.SiteBlocklist.isBlockedUrl(url);
	}

	function _isDisabledForURL(url, excludeTests=false) {
		const isFileURL = url.startsWith('file:');
		const isExtensionPage = url.includes('-extension://');
		const isHttpPage = url.startsWith('http://') || url.startsWith('https://');
		const isZoteroExtensionPage = url.startsWith(browser.runtime.getURL(''));
		const isZoteroTestPage = isZoteroExtensionPage && url.includes('/test/data/');
		if (excludeTests && isZoteroTestPage) return false;
		if (isFileURL) {
			return Zotero.getString('extensionIsDisabled_fileURL', [ZOTERO_CONFIG.CLIENT_NAME])
		}
		if (isExtensionPage) {
			return Zotero.getString('extensionIsDisabled_extensionPage', [ZOTERO_CONFIG.CLIENT_NAME])
		}
		if (!isHttpPage) {
			return Zotero.getString('extensionIsDisabled', [ZOTERO_CONFIG.CLIENT_NAME])
		}
		if (_isBlockedSite(url)) {
			return Zotero.getString('extensionIsDisabled', [ZOTERO_CONFIG.CLIENT_NAME])
		}
		return false;
	}
	
	async function _ensureScriptsInjected(tab) {
		if (!Zotero.isSafari) return true;
		await Zotero.Connector_Browser.injectTranslationScripts(tab);
		let startURL = Zotero.Connector_Browser.getTabInfo(tab.id).url;
		for (let i = 0; i < 30; i++) {
			let tabInfo = Zotero.Connector_Browser.getTabInfo(tab.id);
			if (startURL && tabInfo.url && tabInfo.url !== startURL) {
				return false;
			}
			if (tabInfo.translators) {
				break;
			}
			await Zotero.Promise.delay(100);
		}
		return true;
	}

	async function _browserAction(tab) {
		if (Zotero.Retrieval && await Zotero.Retrieval.onToolbarClick(tab)) return;
        const connection = await Zotero.Connector.getConnectionState();
        if (connection.state === 'pairing_required') {
            await browser.windows.create({url:browser.runtime.getURL('preferences/connect.html'),type:'popup',width:480,height:560,focused:true});
            return;
        }
		if (tab && _isBlockedSite(tab.url)) {
			await _showBlockedNotice(tab);
			return;
		}
		const shouldContinue = await Zotero.HostPermissions.checkChromiumActionPermissions(tab);
		if (!shouldContinue) {
			return;
		}
		if (!await _ensureScriptsInjected(tab)) {
			return;
		}

		let tabInfo = Zotero.Connector_Browser.getTabInfo(tab.id);
		if (_isBetaBuildBeyondExpiration) {
			Zotero.Messaging.sendMessage('expiredBetaBuild')
		}
		else if (Zotero.Prefs.get('firstUse')) {
			Zotero.Messaging.sendMessage("firstUse", null, tab)
			.then(function () {
				Zotero.Prefs.set('firstUse', false);
				Zotero.Connector_Browser._updateExtensionUI(tab);
			});
		}
		else if(tabInfo.translators && tabInfo.translators.length) {
			Zotero.Connector_Browser.saveWithTranslator(tab, 0, {fallbackOnFailure: true});
		}
		else {
			if (tabInfo.isPDF) {
				Zotero.Connector_Browser.saveAsWebpage(
					tab,
					tabInfo.frameId,
					{
						snapshot: true
					}
				);
			} else {
				let withSnapshot = Zotero.Connector.isOnline ? Zotero.Connector.prefs.automaticSnapshots :
					Zotero.Prefs.get('automaticSnapshots');
				Zotero.Connector_Browser.saveAsWebpage(tab, 0, { snapshot: withSnapshot });
			}
		}
	}

	this.saveWithTranslator = function(tab, i, options={}) {
		if (_isBlockedSite(tab.url)) return Promise.reject(new Error('Abstractus does not run on this site'));
		let tabInfo = this.getTabInfo(tab.id);
		var translator = tabInfo.translators[i];
		
		return Zotero.Messaging.sendMessage(
			"translate",
			[
				tabInfo.instanceID,
				translator.translatorID,
				options
			],
			tab,
			null
		);
	}
	
	this.saveAsWebpage = async function(tab, frameId, options={}) {
		if (_isBlockedSite(tab.url)) throw new Error('Abstractus does not run on this site');
		let tabInfo = this.getTabInfo(tab.id);
		if (tabInfo.uninjectable) {
			return Zotero.Utilities.saveWithoutProgressWindow(tab, frameId);
		}
	
		if (tab.id != -1) {
			return Zotero.Messaging.sendMessage("saveAsWebpage", [tab.title, options], tab, frameId);
		}
		else {
			let tab = await getCurrentTab();
			return Zotero.Messaging.sendMessage("saveAsWebpage", tab.title, tab);
		}
	}
	
	function _getTranslatorLabel(translator) {
		var translatorName = translator.label;
		return Zotero.getString('browserAction_saveWithTranslator', [
			ZOTERO_CONFIG.CLIENT_NAME, translatorName
		]);
	}
	
	Zotero.Messaging.addMessageListener("selectDone", function(data) {
		let tabInfo = Zotero.Connector_Browser.getTabInfo(data[0]);
		tabInfo.selectCallback(data[1]);
	});

	async function getCurrentTab() {
		let window = await browser.windows.getCurrent();
		let tabs = await browser.tabs.query({ active: true, windowId: window.id });
		if (tabs.length === 0) {
			throw new Error("No active tab found");
		}
		return tabs[0];
	}
	
	function logListenerErrors(listener) {
		return function() {
			try {
				var returnValue = listener.apply(this, arguments);
				if (returnValue && returnValue.then) {
					returnValue.catch(function(e) {
						if (e && e.message && e.message.startsWith('No tab with id:')) {
							Zotero.debug(e);
							return;
						}
						Zotero.logError(e);
						throw (e);
					});
				}
			} catch (e) {
				Zotero.logError(e);
				throw e;
			}
		}
	}
	
	function waitForInit(fn) {
		return async function() {
			await Zotero.initDeferred.promise;
			return fn.apply(this, arguments);
		}
	}
	
	async function onNavigation(details, historyChange=false) {
		if (details.tabId <= 0
			|| details.url.indexOf(browser.runtime.getURL("itemSelector/itemSelector.html")) === 0) return;

		let tabInfo = Zotero.Connector_Browser.getTabInfo(details.tabId);

		if (historyChange && tabInfo.url == details.url) {
			return;
		}

		let tab;
		
		if (_isDisabledForURL(details.url, true)) {
			tab = await browser.tabs.get(details.tabId);
			return Zotero.Connector_Browser._updateExtensionUI(tab);
		}

		if (!Zotero.isFirefox) {
			if (!tab) tab = await browser.tabs.get(details.tabId);
			await Zotero.Connector_Browser.onFrameLoaded(tab, details.frameId, details.url);
		}
		
		if (details.frameId !== 0) return;
		
		_updateInfoForTab(details.tabId, details.url);
		if (!tab) tab = await browser.tabs.get(details.tabId);
		Zotero.Connector_Browser._updateExtensionUI(tab);
		Zotero.Connector.reportActiveURL(tab.url);
		
		if (historyChange) {
			Zotero.Messaging.sendMessage('historyChanged');
		}
	}
	
	async function onDOMContentLoaded(details) {
		if (Zotero.isFirefox) {
			let tab = await browser.tabs.get(details.tabId);
			await Zotero.Connector_Browser.onFrameLoaded(tab, details.frameId, details.url);
		}
	}

	browser.action.onClicked.addListener(waitForInit(logListenerErrors(_browserAction)));
	
	browser.tabs.onRemoved.addListener(waitForInit(logListenerErrors(_clearInfoForTab)));
	
	browser.tabs.onActivated.addListener(waitForInit(logListenerErrors(async function(details) {
		var tab = await browser.tabs.get(details.tabId);
		if (!tab) return;
		const url = tab.url || tab.pendingUrl;
		if (!url) return;
		if (url.indexOf(browser.runtime.getURL("itemSelector/itemSelector.html")) === 0) return;
		Zotero.debug("Connector_Browser: onActivated for " + url);
		Zotero.Connector_Browser.onTabActivated(tab);
		Zotero.Connector.reportActiveURL(url);
	})));
	
	browser.webNavigation.onCommitted.addListener(waitForInit(logListenerErrors(onNavigation)));
	browser.webNavigation.onDOMContentLoaded.addListener(waitForInit(logListenerErrors(onDOMContentLoaded)))
	if (browser.webNavigation.onHistoryStateUpdated) {
		browser.webNavigation.onHistoryStateUpdated.addListener(waitForInit(logListenerErrors(details => onNavigation(details, true))));
	}
	else {
		this.onHistoryStateUpdated = waitForInit(logListenerErrors(
			(url, tab) => onNavigation({url, tabId: tab.id, frameId: 0}, true)
		));
	}
}

Zotero.initGlobal();
