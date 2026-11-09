
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
            args[1]=Zotero.AbstractusNetwork.validate(args[1]);
            args[2]=Zotero.AbstractusNetwork.translatorRequestOptions(args[1], args[2]);
            return args;
        },
		preSend: async function(xhr) {
			return {
				response: xhr.response,
				responseText: xhr.response,
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

const OFFSCREEN_BACKGROUND_OVERRIDES = {
	'Translators.get': {
		handler: {
			preSend: async function(translator) {
				return serializeTranslator(translator, TRANSLATOR_PASSING_PROPERTIES);
			}
		},
		local: {
			postReceive: async function(translator) {
				return new Zotero.Translator(translator);
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
	'Messaging.sendMessage': {handler: {postReceive: args => Zotero.AbstractusNetwork.callback(args)}},
	'getVersion': true,
	'getExtensionURL': true,
	'Debug.log': true,
	'debug': true,
	'Errors.log': true,

	'Connector_Browser.isIncognito': true,
	'Prefs.getAll': true,
	'Prefs.getAsync': true,
	'COHTTP.request': requestOverride,
	'HTTP.request': requestOverride,
};
