var isTopWindow = false;
if(window.top) {
	try {
		isTopWindow = window.top == window;
	} catch(e) {};
}
if (isTopWindow) {
	Zotero.Messaging.addMessageListener("confirm", function (props) {
		return Zotero.Inject.confirm(props);
	});

	Zotero.Messaging.addMessageListener("notify", (args) => Zotero.Inject.notify.apply(this, args));
	
	Zotero.Messaging.addMessageListener("ping", function () {
		return 'pong';
	});
}

var isHiddenIFrame = false;
try {
	isHiddenIFrame = !isTopWindow && window.frameElement && window.frameElement.style.display === "none";
} catch(e) {}

const isAllowedIframeContentType = ['text/html', 'application/pdf'].includes(document.contentType);

const isWeb = window.location.protocol === "http:" || window.location.protocol === "https:";
const isTestPage = window.location.href.startsWith(browser.runtime.getURL('test'));

const shouldInject = (isWeb || isTestPage) && !isHiddenIFrame && (isTopWindow || isAllowedIframeContentType)

var instanceID = isTopWindow ? 0 : (new Date()).getTime();

Zotero.Inject = {
	async init() {
		if (!shouldInject) return;
		
		await Zotero.initInject();

		if (Zotero.isSafari && isTopWindow) {
			await Zotero.HostPermissions.onPageLoad();
		}
		
		document.addEventListener("ZoteroItemUpdated", function() {
			Zotero.debug("Inject: ZoteroItemUpdated event received");
			Zotero.Messaging.sendMessage("pageModified", null);
		}, false);
		
		this._addMessageListeners();

		if(document.readyState !== "complete") {
			window.addEventListener("pageshow", function(e) {
				if(e.target !== document) return;
				return Zotero.PageSaving.onPageLoad(e.persisted);
			}, false);
		} else {
			return Zotero.PageSaving.onPageLoad();
		}	
	},

	_addMessageListeners() {
		Zotero.Messaging.addMessageListener("translate", function(data) {
			if (data.shift() !== instanceID) return;
			return Zotero.PageSaving.onTranslate(...data);
		});
		Zotero.Messaging.addMessageListener("saveAsWebpage", function(data) {
			return Zotero.PageSaving.onSaveAsWebpage(data);
		});
		Zotero.Messaging.addMessageListener('updateSession', (data) => {
			return Zotero.PageSaving.onUpdateSession(data);
		})
		Zotero.Messaging.addMessageListener("pageModified", Zotero.Utilities.debounce(function() {
			Zotero.PageSaving.onPageLoad(true);
		}, 1000));
		Zotero.Messaging.addMessageListener('historyChanged', Zotero.Utilities.debounce(function() {
			Zotero.PageSaving.onPageLoad(true);
		}, 1000));

		Zotero.Messaging.addMessageListener("firstUse", function () {
			return Zotero.Inject.firstUsePrompt();
		});

		Zotero.Messaging.addMessageListener("expiredBetaBuild", function () {
			return Zotero.Inject.expiredBetaBuildPrompt();
		});

		Zotero.Messaging.addMessageListener("clipboardWrite", function (text) {
			navigator.clipboard.writeText(text);
		});
	},

	async loadReactComponents(components=[]) {
		var toLoad = [];
		if (typeof ReactDOM === "undefined" || typeof React === "undefined"
				|| !React.useState) {
			toLoad = [
				'lib/react.js',
				'lib/react-dom.js',
				'lib/prop-types.js'
			];
		}
		for (let component of components) {
			if (!Zotero.UI || !Zotero.UI[component]) {
				toLoad.push(`ui/${component}.js`)
			}
		}
		if (toLoad.length) {
			return Zotero.Connector_Browser.injectScripts(toLoad);
		}
	},

	async confirm(props) {
		await Zotero.initializedPromise;
		let resultPromise = Zotero.ModalPrompt.confirm(props);
		resultPromise.then(() => {
			let url = new URL(document.location.href)
			if (url.hash.includes('importConfirm')) {
				url.hash = "";
				history.replaceState(null, "", url.href)
			}
		});
		return resultPromise;
	},

	notify: new function() {
		var lastChainedPromise = Zotero.Promise.resolve();
		return function(text, buttons, timeout, tabStatus) {
			if (tabStatus != 'complete') return;

			let showNotificationPrompt = async function() {
				await Zotero.Promise.delay(500);
				await Zotero.Connector_Browser.injectScripts('ui/Notification.js');
				
				this.notification = new Zotero.UI.Notification(text, buttons);
				if (timeout) setTimeout(() => {
					this.notification.dismiss()
					this.notification = null;
				}, timeout);
				return this.notification.show();
			}.bind(Zotero.Inject);
			
			lastChainedPromise = lastChainedPromise.then(showNotificationPrompt);
			return lastChainedPromise;
		}
	},
	
	async expiredBetaBuildPrompt() {
		return this.confirm({
			title: Zotero.getString('expiredBetaBuild_title'),
			button1Text: Zotero.getString('general_ok'),
			button2Text: "",
			message: Zotero.getString('expiredBetaBuild_message', ZOTERO_CONFIG.CLIENT_NAME)
		});
	},

	async firstUsePrompt() {
		var clientName = ZOTERO_CONFIG.CLIENT_NAME;
		return this.confirm({
			title: Zotero.getString('firstRun_title', clientName),
			button1Text: Zotero.getString('firstRun_acceptButton'),
			button2Text: "",
			message: Zotero.getString('firstRun_text1', clientName)
				+ '<br><br>'
				+ Zotero.getString('firstRun_text2', [clientName, ZOTERO_CONFIG.CLIENT_DOWNLOAD_URL])
		});
	},

	async clientUnavailablePrompt() {
		const connection = await Zotero.Connector.getConnectionState();
		if (connection.connected) return 'retry';
		const needsSettings = connection.state !== 'offline';
		const copy = {
			desktop_update_required: ['Update Abstractus Desktop', 'The app on the desktop port does not support secure browser connections. Open an updated Abstractus Desktop before connecting. Reloading the extension alone will not fix this.'],
			pairing_required: ['Connect this browser', 'Open Abstractus Library → Browser connections. Create a connection code and enter it in Connector Settings.'],
			unverified: ['Reconnect this browser', 'Desktop could not be verified. Check that Abstractus Desktop is running, then reconnect in Connector Settings.'],
			offline: ['Open Abstractus Desktop', 'Open the desktop app, then try saving again.']
		};
		const [title, message] = copy[connection.state] || copy.unverified;
		const result = await this.confirm({
			button1Text: needsSettings ? 'Connector settings' : Zotero.getString('general_tryAgain'),
			button2Text: Zotero.getString('general_cancel'), title, message
		});
		if (result.button !== 1) return 'cancel';
		if (needsSettings) { Zotero.Connector_Browser.openPreferences(); return 'cancel'; }
		return 'retry';
	},

	async checkClientAvailable(permissionPromptShown=false) {
		let isOnline = await Zotero.Connector.checkIsOnline({active: true, permissionPromptShown});
		if (isOnline) {
			return true;
		}
		var result = await this.clientUnavailablePrompt();
		if (result == 'retry') {
			await Zotero.Promise.delay(500);
			return this.checkClientAvailable(true);
		}
		return false;
	},
	
	addKeyboardShortcut(eventDescriptor, fn, elem) {
		elem = elem || document;
		let listener = (event) => {
			for (let prop in eventDescriptor) {
				if (event[prop] != eventDescriptor[prop]) return;
			}
			event.stopPropagation();
			event.preventDefault();
			fn();
		};
		elem.addEventListener('keydown', listener);
		return () => {
			elem.removeEventListener('keydown', listener);
		};
	}
};

if (document.visibilityState == 'prerender') {
	var handler = function() {
		Zotero.Inject.init();
		document.removeEventListener("visibilitychange", handler);
	};
	document.addEventListener("visibilitychange", handler);
} else {
	Zotero.Inject.init();
}