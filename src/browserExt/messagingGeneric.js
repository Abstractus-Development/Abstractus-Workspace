let MessagingGeneric = class {
	 
	constructor(options={}) {
		if (!options.sendMessage || !options.addMessageListener) {
			throw new Error('MessagingGeneric: mandatory constructor options missing');
		}
		if (options.sendMessage == 'frame') {
			options.sendMessage = (...args) => window.parent.postMessage(args, '*');
		}
		if (options.addMessageListener == 'frame') {
			options.addMessageListener = (fn) => window.addEventListener('message', (messageEvent) => {
				if (messageEvent.data && Array.isArray(messageEvent.data)) {
					fn(messageEvent.data);
				}
			});
		}
		this._options = options;
		this._sendMessage = options.sendMessage;
		this._addMessageListener = options.addMessageListener;
		this._functionOverrides = options.functionOverrides;
		this._handlerFunctionOverrides = options.handlerFunctionOverrides;
		this._messageListeners = {};
		this._responseListeners = {};
		this._overrideTarget = options.overrideTarget || globalThis;

		for (const fnName in this._functionOverrides) {
			const fnPath = fnName.split('.');
			let fn = this._overrideTarget;
			for (let name of fnPath.slice(0, fnPath.length - 1)) {
				if (!(name in fn)) {
					fn[name] = {};
				}
				fn = fn[name];
			}
			fn[fnPath[fnPath.length - 1]] = async (...args) => {
				try {
					const messageConfig = this._functionOverrides[fnName];
					if (messageConfig.local && messageConfig.local.preSend) {
						args = await messageConfig.local.preSend(args);
					}
					
					let response = await this.sendMessage(fnName, args);
					if (messageConfig.local && messageConfig.local.postReceive) {
						response = await messageConfig.local.postReceive(response);
					}
					return response;
				}
				catch (e) {
					console.log(`Zotero: Failed to invoke a remote function ${fnName}`);
					console.log(e)
					throw e;
				}
			};
		}
		for (let fnName in this._handlerFunctionOverrides) {
			this.addMessageListener(fnName, async (...args) => {
				const fnPath = fnName.split('.');
				const messageConfig = this._handlerFunctionOverrides[fnName];
				let result;
				try {
					let fn = this._overrideTarget;
					for (let name of fnPath) {
						fn = fn[name];
					}
					if (messageConfig.handler && messageConfig.handler.postReceive) {
						args = await messageConfig.handler.postReceive(args);
					}
					result = fn(...args);
					if (typeof result === 'object' && result.then) {
						result = await result;
					}
				}
				catch(e) {
					console.log(`Zotero: Failed to invoke a function call from a handler destination ${fnName}`);
					console.log(e.message);
					throw e;
				}
				if (messageConfig.handler && messageConfig.handler.preSend) {
					result = await messageConfig.handler.preSend(result);
				}
				return result;
			});
		}
		
		this._initMessageListener();
	}
	
	reinit(options) {
		if (!options.sendMessage || !options.addMessageListener) {
			throw new Error('MessagingGeneric: mandatory reinit() options missing');
		}
		this._responseListeners = {};
		this._sendMessage = options.sendMessage;
		this._addMessageListener = options.addMessageListener;
		this._initMessageListener();
	}
	
	_initMessageListener() {
		this._addMessageListener(async (args) => {
			if (!Array.isArray(args) || args.length > 3) return;
			let [message, payload, messageId] = args;
			if (this._messageListeners[message]) {
				payload = payload || [];
				let result;
				try {
					result = this._messageListeners[message](...payload);
					if (typeof result === 'object' && result.then) result = await result;
				} catch (e) {
					result = ['error', JSON.stringify(Object.assign({
						name: e.name,
						message: e.message,
						stack: e.stack
					}, e))];
				}
				if (this._options.supportsResponse) {
					return result;
				}
				else {
					this._sendMessage(`response`, result, messageId);
				}
			}
			else if (this._responseListeners[messageId]) {
				this._responseListeners[messageId](payload);
				delete this._responseListeners[messageId];
			}
		});
	}
	
	async sendMessage(message, payload=[]) {
		if (!Array.isArray(payload)) throw new Error('MessagingGeneric.sendMessage: payload must be an array');
		let response;
		if (this._options.supportsResponse) {
			 response = await this._sendMessage(message, payload)
		}
		else {
			response = await new Promise((resolve) => {
				const id = Zotero.Utilities.randomString();
				this._responseListeners[id] = resolve;
				this._sendMessage(message, payload, id);
			});
		}
		if (Array.isArray(response) && response[0] == 'error') {
			response[1] = JSON.parse(response[1]);
			let e = new Error(response[1].message);
			for (let key in response[1]) e[key] = response[1][key];
			throw e;
		}
		return response;
	}
	
	addMessageListener(message, listener) {
		this._messageListeners[message] = listener;
	}
};

if (typeof Zotero !== 'undefined') Zotero.MessagingGeneric = MessagingGeneric;
if (typeof module !== 'undefined') module.exports = MessagingGeneric;