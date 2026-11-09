Zotero.Frame = class ZoteroFrame {
	constructor(attributes = {}, style = {}, messagingOptions) {
		if (!attributes.src) throw new Error('Attempted to construct a Zotero frame with no src attribute');
		this.nonce = Zotero.Utilities.randomString(64);
		this._initializedPromise = this._init(attributes, style, messagingOptions);
		this.initializedPromise = this._initializedPromise;
	}

	get frame() {
		return this._frame;
	}

	get contentWindow() {
		return this._frame?.contentWindow;
	}

	get src() {
		return this._frame?.src;
	}

	async init() {
		return this._initializedPromise;
	}

	async _init(attributes = {}, style = {}, messagingOptions) {
		attributes = Object.assign({
			id: Zotero.Utilities.randomString(),
			frameborder: '0'
		}, attributes);
		attributes.src = this._addNonceToURL(attributes.src);

		this.parentDiv = document.createElement('div');
		const root = this.parentDiv.attachShadow({ mode: 'closed' });

		this._frame = document.createElement('iframe');
		root.appendChild(this._frame);
		this._setFrameAttributes(attributes, style);
		Zotero.Messaging?.registerFrame?.(this);
		await new Promise((resolve, reject) => {
			this._frame.onload = resolve;
			this._frame.onerror = reject;
			(document.body || document.documentElement)?.appendChild(this.parentDiv);
		});

		if (messagingOptions) {
			await this._initMessaging(messagingOptions);
		}
	}

	_addNonceToURL(src) {
		let url = new URL(src, window.location.href);
		url.hash = encodeURIComponent(this.nonce);
		return url.href;
	}

	_setFrameAttributes(attributes, style) {
		for (let key in attributes) {
			if (this._frame.getAttribute(key) !== attributes[key]) {
				this._frame.setAttribute(key, attributes[key]);
			}
		}
		for (let key in style) {
			if (this._frame.style[key] !== style[key]) {
				this._frame.style[key] = style[key];
			}
		}
	}

	remove() {
		Zotero.Messaging?.unregisterFrame?.(this);
		this.parentDiv?.parentNode?.removeChild(this.parentDiv);
		if (this._port) {
			this._port.onmessage = null;
			this._port.close();
		}
	}

	async _initMessaging(messagingOptions) {
		if (!messagingOptions.sendMessage) {
			const mc = new MessageChannel();
			this._port = mc.port1;
			this._frame.contentWindow.postMessage('zoteroChannel', '*', [mc.port2]);
			let response = await new Promise(cb => { mc.port1.onmessage = cb; });
			mc.port1.onmessage = null;
			if (response.data !== this.nonce) {
				throw new Error('Zotero.Frame: Invalid messaging nonce');
			}
			messagingOptions.sendMessage = (...args) => {
				mc.port1.postMessage(args);
			};
			messagingOptions.addMessageListener = (fn) => {
				mc.port1.onmessage = (e) => fn(e.data);
			};
		}
		this._messaging = new Zotero.MessagingGeneric(messagingOptions);
		this.addMessageListener = this._messaging.addMessageListener.bind(this._messaging);
		this.sendMessage = this._messaging.sendMessage.bind(this._messaging);
	}
};
