/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2009 Center for History and New Media
                     George Mason University, Fairfax, Virginia, USA
                     http://zotero.org
    
    This file is part of Zotero.
    
    Zotero is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    
    Zotero is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.
    
    You should have received a copy of the GNU Affero General Public License
    along with Zotero.  If not, see <http://www.gnu.org/licenses/>.
    
    ***** END LICENSE BLOCK *****
*/

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
		// Respond to indicate that script is injected
		return 'pong';
	});
}

// check whether this is a hidden browser window being used for scraping
var isHiddenIFrame = false;
try {
	isHiddenIFrame = !isTopWindow && window.frameElement && window.frameElement.style.display === "none";
} catch(e) {}

// Iframes where we inject translation can be non-text/html,
// and we shouldn't even bother translating them
// (and it also causes errors to be thrown when trying to create a ZoteroFrame)
// Update: Except for 'application/pdf', like on https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=9919149
const isAllowedIframeContentType = ['text/html', 'application/pdf'].includes(document.contentType);

// Do not run on non-web pages (file://), safari extension pages (i.e. safari prefs)
// or non-top Safari pages
const isWeb = window.location.protocol === "http:" || window.location.protocol === "https:";
// Run on test pages
const isTestPage = window.location.href.startsWith(browser.runtime.getURL('test'));

// Not scraping on hidden iframes and only select frames
const shouldInject = (isWeb || isTestPage) && !isHiddenIFrame && (isTopWindow || isAllowedIframeContentType)

var instanceID = isTopWindow ? 0 : (new Date()).getTime();

/**
 * @namespace
 */
Zotero.Inject = {
	async init() {
		if (!shouldInject) return;
		
		await Zotero.initInject();
		// Zotero namespace APIs now initialized

		// Safari initially grants access only to sites approved by the user. The first click on the
		// extension button reloads the page with content scripts enabled, without firing onClicked,
		// so show the one-time site-access explanation from the injected script.
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
		// add listener for translate message from background page
		Zotero.Messaging.addMessageListener("translate", function(data) {
			if (data.shift() !== instanceID) return;
			return Zotero.PageSaving.onTranslate(...data);
		});
		// add a listener to save as webpage when translators unavailable
		Zotero.Messaging.addMessageListener("saveAsWebpage", function(data) {
			return Zotero.PageSaving.onSaveAsWebpage(data);
		});
		Zotero.Messaging.addMessageListener('updateSession', (data) => {
			return Zotero.PageSaving.onUpdateSession(data);
		})
		// add listener to rerun detection on page modifications
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

		// Cannot copy to clipboard in the background page
		Zotero.Messaging.addMessageListener("clipboardWrite", function (text) {
			navigator.clipboard.writeText(text);
		});
	},

	/**
	 * Check if React and components are loaded and if not - load into page.
	 * 
	 * This is a performance optimization - we want to avoid loading React into every page.
	 * 
	 * @param components {Object[]} an array of component names to load
	 * @return {Promise} resolves when components are injected
	 */
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
		// Remove MV3 importConfirm hash from the history after displaying the prompt so that going back
		// does not trigger repeat prompts
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

	/**
	 * Display an old-school firefox notification by injecting HTML directly into DOM.
	 * 
	 * @param {String} text
	 * @param {String[]} buttons - labels for buttons
	 * @param {Number} timeout - notification gets removed after this timeout
	 * @param {String} tabStatus - available on chrome.Tab.status in background scripts
	 * @returns {Number} button pressed
	 */
	notify: new function() {
		var lastChainedPromise = Zotero.Promise.resolve();
		return function(text, buttons, timeout, tabStatus) {
			// This is a little awkward, because the tab status is passed from the background script to
			// the content script, but chrome.tabs is unavailable in content scripts.
			//
			// If we're navigating somewhere don't display the notification, because it looks dumb.
			// The navigation will re-trigger this method from the background script.
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
			
			// Sequentialize notification display
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

	/**
	 * Prompts the user to open Abstractus Desktop
	 * @returns {Promise<String>} 'retry' or 'cancel'
	 */
	async clientUnavailablePrompt() {
		const connection = await Zotero.Connector.getConnectionState();
		if (connection.connected) return 'retry';
		const needsSettings = connection.state !== 'offline';
		// Select fixed copy here: never interpolate server/page text into the HTML prompt.
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

	/**
	 * Checks that Abstractus Desktop is reachable before saving, prompting the user to open it
	 * if it isn't
	 *
	 * @param {Boolean} permissionPromptShown - Skip the localhost permission explanation before
	 *     the status check, e.g., on a retry after it has already been displayed
	 * return {Promise<Boolean>} whether the action should proceed
	 */
	async checkClientAvailable(permissionPromptShown=false) {
		let isOnline = await Zotero.Connector.checkIsOnline({active: true, permissionPromptShown});
		if (isOnline) {
			return true;
		}
		var result = await this.clientUnavailablePrompt();
		if (result == 'retry') {
			// If we perform the retry immediately and the app is still unavailable the prompt returns
			// instantly making the user interaction confusing so we wait a bit first
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

// Wait until pages in prerender state become visible before injecting
if (document.visibilityState == 'prerender') {
	var handler = function() {
		Zotero.Inject.init();
		document.removeEventListener("visibilitychange", handler);
	};
	document.addEventListener("visibilitychange", handler);
} else {
	Zotero.Inject.init();
}