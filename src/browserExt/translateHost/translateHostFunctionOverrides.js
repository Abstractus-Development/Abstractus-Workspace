
function serializeTranslator(translator, properties) {
	let serializedTranslator = {};
	for (let key of properties) {
		if (key === 'proxy' && translator[key]?.toJSON) {
			serializedTranslator[key] = translator[key].toJSON();
		}
		else {
			serializedTranslator[key] = translator[key];
		}
	}
	return serializedTranslator;
}

const requestOverride = {
	handler: {
		postReceive: async function(args) {
			args[1] = Zotero.AbstractusNetwork.validate(args[1]);
			args[2] = Zotero.AbstractusNetwork.translatorRequestOptions(args[1], args[2]);
			return args;
		},
		preSend: async function(xhr) {
			let response = xhr.response;
			if (response?.documentElement) {
				response = response.contentType === 'text/html'
					? response.documentElement.outerHTML
					: new XMLSerializer().serializeToString(response);
			}
			return {
				response,
				responseText: response,
				responseURL: xhr.responseURL,
				responseType: xhr.responseType,
				status: xhr.status,
				statusText: xhr.statusText,
				responseHeaders: xhr.getAllResponseHeaders()
			};
		},
	},
	local: {
		postReceive: async function(xhr) {
			xhr.getAllResponseHeaders = () => xhr.responseHeaders;
			xhr.getResponseHeader = function(name) {
				let match = xhr.responseHeaders.match(new RegExp(`^${name}: (.*)$`, 'mi'));
				return match ? match[1] : null;
			};
			xhr.responseText = xhr.response;
			if (xhr.responseType == 'document') {
				let contentType = xhr.getResponseHeader("Content-Type");
				if (!Zotero.HTTP.VALID_DOM_PARSER_CONTENT_TYPES.has(contentType)) {
					contentType = 'text/html';
				}
				let doc = new DOMParser().parseFromString(xhr.responseText, Zotero.HTTP.determineDOMParserContentType(contentType));
				
				xhr = new Proxy(xhr, {
					get: function (target, name) {
						return name == 'response' ? doc : target[name];
					}
				});
			}
			return xhr;
		}
	}
}

const relayRequestOverride = {
	handler: requestOverride.handler,
	local: {
		postReceive: async function(xhr) {
			xhr.getAllResponseHeaders = () => xhr.responseHeaders;
			return xhr;
		}
	}
};

const translatorFunctions = {
	'Translators.get': {
		handler: {
			preSend: async function(translator) {
				return translator && serializeTranslator(translator, TRANSLATOR_PASSING_PROPERTIES);
			}
		},
		local: {
			postReceive: async function(translator) {
				return translator && new Zotero.Translator(translator);
			}
		}
	},
	'Translators.getAllForType': {
		handler: {
			preSend: async function(translators) {
				return translators.map(t => serializeTranslator(t, TRANSLATOR_PASSING_PROPERTIES));
			},
		},
		local: {
			postReceive: async function(translators) {
				return translators.map(function(translator) {return new Zotero.Translator(translator)});
			}
		}
	},
	'Translators.getWebTranslatorsForLocation': {
		handler: {
			preSend: async function(data) {
				return [data[0].map(t => serializeTranslator(t, TRANSLATOR_PASSING_PROPERTIES)), data[1]];
			}
		},
		local: {
			postReceive: async function(data) {
				data[0] = data[0].map((translator) => new Zotero.Translator(translator));
				data[1] = data[1].map((proxy) => proxy && new Zotero.Proxy(proxy));
				return [data[0], data[1]];
			}
		}
	},
	'Translators.getCodeForTranslator': {
		local: {
			preSend: async function(args) {
				const translator = args[0];
				return [{ translatorID: translator.translatorID }];
			}
		},
	},
};

const ensureOffscreenBeforeSending = {
	local: {
		preSend: async function(args) {
			await Zotero.OffscreenManager.ensureDocument();
			return args;
		}
	}
};

const FRAME_MANAGER_MESSAGE_FUNCTIONS = {
	'TranslateHostFrameManager.detect': ensureOffscreenBeforeSending,
	'TranslateHostFrameManager.translate': ensureOffscreenBeforeSending,
	'TranslateHostFrameManager.runNonWeb': ensureOffscreenBeforeSending,
	'TranslateHostFrameManager.destroyFramesForTab': true,
	'TranslateHostFrameManager.cleanup': true,
};

const FRAME_MANAGER_FUNCTIONS = {
	...translatorFunctions,
	'getVersion': true,
	'getExtensionURL': true,
	'Debug.log': true,
	'debug': true,
	'Errors.log': true,
	'Messaging.sendMessage': { handler: { postReceive: args => Zotero.AbstractusNetwork.callback(args) } },
	'Connector_Browser.isIncognito': true,
	'Prefs.getAll': true,
	'COHTTP.request': relayRequestOverride,
	'HTTP.request': relayRequestOverride,
};

const HOST_FUNCTIONS = {
	detect: {
		...translatorFunctions,
		'Debug.log': true,
		'debug': true,
		'Errors.log': true,
	},
	translate: {
		...translatorFunctions,
		'Debug.log': true,
		'debug': true,
		'Errors.log': true,
		'COHTTP.request': requestOverride,
		'HTTP.request': requestOverride,
	}
};

function translateHostFunctions(role, pageURL) {
	if (role !== 'translate') return HOST_FUNCTIONS[role];
	const scopedRequest = {
		...requestOverride,
		handler: {
			...requestOverride.handler,
			postReceive: async function(args) {
				args = await requestOverride.handler.postReceive(args);
				args[2] = Zotero.AbstractusNetwork.scopeCredentials(args[1], args[2], pageURL);
				return args;
			}
		}
	};
	return { ...HOST_FUNCTIONS[role], 'COHTTP.request': scopedRequest, 'HTTP.request': scopedRequest };
}
