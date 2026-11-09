(function() {

var isTopWindow = false;
if (window.top) {
	try {
		isTopWindow = window.top == window;
	} catch (e) {}
}

if (isTopWindow) {
	var frameID = 'zotero-modal-prompt';
	var iframe;
	var zoteroFrame;
	var initialized = false;
	var frameSrc;
	var previousFocus;
	frameSrc = Zotero.getExtensionURL('modalPrompt/modalPrompt.html');

	function isExtensionPage() {
		try {
			return window.location.href.startsWith(browser.runtime.getURL(''));
		}
		catch (e) {
			return false;
		}
	}

	async function sendModalPromptMessage(messageName, args) {
		if (Zotero.isSafari && isExtensionPage()) {
			return iframe.contentWindow.Zotero.Messaging.receiveMessage([messageName, args]);
		}
		return Zotero.Messaging.sendToZoteroFrames(messageName, args);
	}

	async function init() {
		var deferred = Zotero.Promise.defer();
		Zotero.Messaging.addMessageListener('modalPrompt.init', function () {
			initialized = true;
			deferred.resolve();
			iframe.style.display = "block"
		});
		Zotero.Messaging.addMessageListener('modalPrompt.close', function () {
			previousFocus && previousFocus.ownerDocument.defaultView.focus() && previousFocus.focus();
		});

		zoteroFrame = new Zotero.Frame({
			id: frameID,
			src: Zotero.Utilities.Connector.themedFrameURL(frameSrc, document)
		}, {
			position: 'fixed',
			top: '0px',
			left: 'unset',
			right: '0px',
			width: '100%',
			height: '100%',
			border: "none",
			display: "none",
			zIndex: 2147483647
		});
		iframe = zoteroFrame.frame;
		setTimeout(() => deferred.reject(new Error('Timed out while injecting modal prompt')), 800);
		return deferred.promise;
	}

	function getActiveElement(element = document.activeElement) {
		const shadowRoot = element.shadowRoot
		const contentDocument = element.contentDocument

		if (shadowRoot && shadowRoot.activeElement) {
			return getActiveElement(shadowRoot.activeElement)
		}

		if (contentDocument && contentDocument.activeElement) {
			return getActiveElement(contentDocument.activeElement)
		}

		return element
	}	

	Zotero.ModalPrompt = {
		confirm: async function (props) {
			if (!initialized) {
				await init();
			}
			iframe.style.display = 'block';
			previousFocus = getActiveElement();
			let result = await sendModalPromptMessage('modalPrompt.show', props);
			iframe.style.display = 'none';
			return result
		}
	}
}

})();
