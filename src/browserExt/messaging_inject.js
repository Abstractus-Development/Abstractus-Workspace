Zotero.Messaging = new function() {
	var _messageListeners = {};
	
	this.addMessageListener = function(messageName, callback) {
		_messageListeners[messageName] = callback;
	}
	
	this.receiveMessage = async function(request) {
		if (typeof request !== "object" || !request.length || !_messageListeners[request[0]]) return;
		Zotero.debug(request[0] + " message received in injected page " + window.location.href);
		try {
			return await _messageListeners[request[0]](request[1])
		} catch (err) {
			return ['error', JSON.stringify(Object.assign({
				name: err.name,
				message: err.message,
				stack: err.stack
			}, err))];
		}
	}
	
	this.init = function() {
		for(var ns in MESSAGES) {
			if(!Zotero[ns]) Zotero[ns] = {};
			for(var meth in MESSAGES[ns]) {
				Zotero[ns][meth] = new function() {
					var messageName = ns+MESSAGE_SEPARATOR+meth;
					var messageConfig = MESSAGES[ns][meth];
					return async function() {
						var callback, callbackArg = null;
						if(messageConfig) {
							callbackArg = (messageConfig.callbackArg
								? messageConfig.callbackArg : arguments.length-1);
							callback = arguments[callbackArg];
							if(typeof callback !== "function") {
								callbackArg = null;
							}
						}
						
						var newArgs = new Array(arguments.length);
						for(var i=0; i<arguments.length; i++) {
							newArgs[i] = i === callbackArg ? undefined : arguments[i];
						}
						if (messageConfig.inject && messageConfig.inject.preSend) {
							newArgs = await messageConfig.inject.preSend(newArgs);
						}

						let send;
						try {
							send = browser.runtime.sendMessage([messageName, newArgs]);
						}
						catch (e) {
							if (/context invalidated/i.test(e.message)) return new Promise(() => {});
							throw e;
						}
						return send.then(async function(response) {
							if (response && response[0] == 'error') {
								response[1] = JSON.parse(response[1]);
								let e = new Error(response[1].message);
								for (let key in response[1]) e[key] = response[1][key];
								throw e;
							}
							try {
								if (messageConfig.inject && messageConfig.inject.postReceive) {
									response = await messageConfig.inject.postReceive(response);
								}
								if (callbackArg !== null) callback(response);
								return response;
							} catch(e) {
								Zotero.logError(e);
								throw e;
							}
						}, function(e) {
							if (e && /context invalidated/i.test(e.message)) return new Promise(() => {});
							if (messageConfig && messageConfig.response !== false) {
								Zotero.logError(e);
								throw e;
							}
						});
					};
				};
			}
		}

		chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
			if (typeof request !== "object" || !request.length || !_messageListeners[request[0]]) return;
			(async function messageListener() {
				sendResponse(await Zotero.Messaging.receiveMessage(request));
			})();
			return true;
		});

	}

	this.sendAsChunks = async function(payload) {
		if (!Zotero.isChromium) throw new Error("Messaging.sendAsChunks is only required on Chromium");
		const MAX_CHUNK_SIZE = 8 * (1024 * 1024);
		const id = Zotero.Utilities.randomString()
		const numChunks = Math.ceil(payload.length / MAX_CHUNK_SIZE);
		for (let i = 0; i < numChunks; i++) {
			await Zotero.Messaging.receiveChunk(id, payload.slice(i * MAX_CHUNK_SIZE, (i + 1) * MAX_CHUNK_SIZE));
		}
		return id;
	}
}