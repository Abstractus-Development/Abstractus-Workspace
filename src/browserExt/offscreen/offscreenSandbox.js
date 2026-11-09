Zotero.OffscreenSandbox = {
	initialized: false,

	async init(serviceWorkerPort) {
		if (this.initialized) {
			await this.initMessaging(serviceWorkerPort);
			this.sendMessage('offscreen-sandbox-initialized');
			Zotero.debug('OffscreenSandbox: reinitialized');
			return;
		}
		this.initialized = true;

		Zotero.Debug.init();
		Zotero.debug('OffscreenSandbox: initializing');
		await this.initMessaging(serviceWorkerPort);
		Zotero.OffscreenTranslate.init();
		await Zotero.initOffscreen();
		this.sendMessage('offscreen-sandbox-initialized');
		Zotero.debug('OffscreenSandbox: initialized');
	},
	
	async initMessaging(serviceWorkerPort) {
		Zotero.debug('OffscreenSandbox: initializing messaging');
		let messagingOptions = {
			functionOverrides: OFFSCREEN_BACKGROUND_OVERRIDES,
			overrideTarget: Zotero
		}
		await new Promise((resolve) => {
			serviceWorkerPort.onmessage = resolve;
			serviceWorkerPort.postMessage('offscreen-sandbox-awaiting-service-worker-connection');
		})
		messagingOptions.sendMessage = (...args) => {
			serviceWorkerPort.postMessage(args)
		};
		messagingOptions.addMessageListener = (fn) => {
			serviceWorkerPort.onmessage = (e) => fn(e.data);
		};
		if (this._messaging) {
			this._messaging.reinit(messagingOptions);
		}
		else {
			this._messaging = new Zotero.MessagingGeneric(messagingOptions);
		}
		Zotero.debug('OffscreenSandbox: messaging with background service worker established');
	},
	
	async sendMessage(message, payload) {
		return this._messaging.sendMessage(message, payload);
	},
	
	async addMessageListener(message, listener) {
		this._messaging.addMessageListener(message, listener);
	}
}

document.addEventListener('DOMContentLoaded', () => {
	console.log("OffscreenSandbox: letting offscreen know we're ready");
	window.parent.postMessage('offscreen-sandbox-ready', "*")
});
window.addEventListener('message', (e) => {
	if (e.data === "offscreen-port") {
		Zotero.OffscreenSandbox.init(e.ports[0])
	}
})