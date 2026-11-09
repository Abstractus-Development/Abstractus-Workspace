Zotero.Messaging = new function() {
	var _messageListeners = {};
	var _chunkedPayloads = {};
	
	this.addMessageListener = function(messageName, callback) {
		_messageListeners[messageName] = callback;
	}
	
	this.receiveMessage = async function(messageName, args, tab, frameId) {
		await Zotero.initDeferred.promise;
		if (!Array.isArray(args)) {
			args = [args];
		}
		
		if(_messageListeners[messageName]) {
			return _messageListeners[messageName](args, tab, frameId);
		}
		
		var messageParts = messageName.split(MESSAGE_SEPARATOR);
		try {
			var fn = Zotero[messageParts[0]][messageParts[1]];
			if (!fn) {
				throw new Error();
			}
		} catch(e) {
			throw new Error("Zotero." + messageParts[0] + "." + messageParts[1] + " is not defined");
		}
		var messageConfig = MESSAGES[messageParts[0]][messageParts[1]];
		
		if (messageConfig && messageConfig.background) {
			while (messageConfig.background.minArgs > args.length) {
				args.push(undefined);
			}
		}

		if (messageConfig && messageConfig.background && messageConfig.background.postReceive) {
			args = await messageConfig.background.postReceive(args, tab, frameId);
		} else {
			args.push(tab);
			args.push(frameId);
		}
		
		var promise = fn.apply(Zotero[messageParts[0]], args);
		if (typeof promise != "object" || typeof promise.then !== "function") promise = Zotero.Promise.resolve(promise);
		var shouldRespond = messageConfig && messageConfig.response !== false;
		if (shouldRespond) {
			return promise.then(async function(response) {
				if (messageConfig.background && messageConfig.background.preSend) {
					response = await messageConfig.background.preSend(response);
				}
				return response;
			});
		}
	};
	
	this.sendMessage = async function(messageName, args, tab=null, frameId=0) {
		var response;
		if (!tab) {
			tab = (await browser.tabs.query({active: true, lastFocusedWindow: true}))[0]
		}
		if (typeof tab === 'number') {
			tab = await browser.tabs.get(tab);
		}
		let options = {};
		if (typeof frameId == 'number') options = {frameId};

		try {
			response = await browser.tabs.sendMessage(tab.id, [messageName, args], options);
		} catch (e) {}
		if (response && response[0] == 'error') {
			response[1] = JSON.parse(response[1]);
			let e = new Error(response[1].message);
			for (let key in response[1]) e[key] = response[1][key];
			throw e;
		}
		return response;
	}
	
	this.sendToZoteroFrames = async function(messageName, args, tab=null) {
		if (!tab) {
			tab = (await browser.tabs.query({active: true, lastFocusedWindow: true}))[0]
		}
		if (typeof tab === 'number') {
			tab = await browser.tabs.get(tab);
		}

		if (!Zotero.isSafari) {
			let response;
			try {
				response = await browser.tabs.sendMessage(tab.id, [messageName, args]);
			}
			catch (e) {}
			if (response && response[0] == 'error') {
				response[1] = JSON.parse(response[1]);
				let e = new Error(response[1].message);
				for (let key in response[1]) e[key] = response[1][key];
				throw e;
			}
			return response;
		}

		let response;
		try {
			response = await browser.tabs.sendMessage(
				tab.id,
				['zoteroFrame.sendMessage', [messageName, args]],
				{frameId: 0}
			);
		}
		catch (e) {}
		if (response && response[0] == 'error') {
			response[1] = JSON.parse(response[1]);
			let e = new Error(response[1].message);
			for (let key in response[1]) e[key] = response[1][key];
			throw e;
		}
		return response;
	}
	
	this.init = function() {
		browser.runtime.onMessage.addListener(function(request, sender) {
			if (!Array.isArray(request)) {
				return;
			}

			const deniedWhy = Zotero.SiteBlocklist && Zotero.SiteBlocklist.contentCallDenied(request[0], request[1], sender);
			if (deniedWhy) {
				return Promise.resolve(['error', JSON.stringify({name: 'Error', message: 'Not allowed from a web page (' + deniedWhy + ')'})]);
			}
			const blockedWhy = Zotero.SiteBlocklist && Zotero.SiteBlocklist.senderBlocked(sender);
			if (blockedWhy) {
				return Promise.resolve(['error', JSON.stringify({name: 'Error', message: 'Abstractus does not run on this site (' + blockedWhy + ')'})]);
			}

			return Zotero.Messaging.receiveMessage(request[0], request[1], sender.tab, sender.frameId)
			.catch(function(err) {
				err = JSON.stringify(Object.assign({
					name: err.name,
					message: err.message,
					stack: err.stack
				}, err));
				return ['error', err];
			});
		});
		Zotero.Messaging.initialized = true;
	}

	this.receiveChunk = function(id, payload) {
		_chunkedPayloads[id] = _chunkedPayloads[id] || "";
		_chunkedPayloads[id] += payload;
		setTimeout(() => {
			delete _chunkedPayloads[id];
		}, 30000);
	}

	this.getChunkedPayload = function(id) {
		const payload = _chunkedPayloads[id];
		delete _chunkedPayloads[id];
		return payload;
	}
}
