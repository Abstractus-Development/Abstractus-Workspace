const MESSAGE_SEPARATOR = ".";
var MESSAGES = {
	Translators: {
		updateFromRemote: true,
		get: {
			background: {
				preSend: async function(translators) {
					return Zotero.Translators.serialize(translators, TRANSLATOR_PASSING_PROPERTIES);
				}
			},
			inject: {
				postReceive: async function(translator) {
					return new Zotero.Translator(translator);
				}
			}
		},
		getAllForType: {
			background: {
				preSend: async function(translators) {
					return Zotero.Translators.serialize(translators, TRANSLATOR_PASSING_PROPERTIES);
				},
			},
			inject: {
				postReceive: async function(translators) {
					return translators.map(function(translator) {return new Zotero.Translator(translator)});
				}
			}
		},
		getWebTranslatorsForLocation: {
			background: {
				preSend: async function(data) {
					return [Zotero.Translators.serialize(data[0], TRANSLATOR_PASSING_PROPERTIES), data[1]];
				}
			},
			inject: {
				postReceive: async function(data) {
					data[0] = data[0].map((translator) => new Zotero.Translator(translator));
					data[1] = data[1].map((proxy) => proxy && new Zotero.Proxy(proxy));
					return [data[0], data[1]];
				}
			}
		},
		getCodeForTranslator: {
			inject: {
				preSend: async function(args) {
					const translator = args[0];
					return [{ translatorID: translator.translatorID }];
				}
			},
			background: {
				postReceive: async function(args) {
					let translatorInfo = args[0]
					return [await Zotero.Translators.getWithoutCode(translatorInfo.translatorID)];
				}
			}
		}
	},
	OffscreenManager: {
		sendMessage: true
	},
	Debug: {
		bgInit: false,
		log: {
			response: false,
			background: {
				minArgs: 4
			}
		}
	},
	Connector: {
		getConnectionState: true,
		checkIsOnline: {
			background: {minArgs: 1}
		},
		callMethod: true,
		saveSingleFile: {
			inject: {
				preSend: async function(args) {
					if (Zotero.isChromium) {
						args[1].snapshotContent = await Zotero.Messaging.sendAsChunks(args[1].snapshotContent);
					}
					return args;
				},
			},
			background: {
				postReceive: async function(args) {
					if (Zotero.isChromium) {
						args[1].snapshotContent = Zotero.Messaging.getChunkedPayload(args[1].snapshotContent);
					}
					return args;
				}
			}
		},
		getClientVersion: {
			background: {minArgs: 1}
		},
		reportActiveURL: false,
		getPref: true
	},
	HostPermissions: {
		onPageLoad: true,
		prompt: true,
		hasPermission: true,
	},
	Connector_Browser: {
		onSelect: true,
		onPageLoad: false,
		onTranslators: {
			inject: {
				preSend: async function([translators, ...args]) {
					return [translators.map(t => t.serialize(TRANSLATOR_PASSING_PROPERTIES)), ...args]
				},
			}
		},
		onZoteroButtonElementClick: true,
		onHistoryStateUpdated: false,
		injectScripts: true,
		injectSingleFile: true,
		isIncognito: true,
		isTabFocused: true,
		newerVersionRequiredPrompt: true,
		openTab: false,
		openPreferences: false,
		bringToFront: true
	},
	ItemSaver: {
		saveAttachmentToZotero: true,
		saveStandaloneAttachmentToZotero: true
	},
	Errors: {
		log: false,
	},
	Messaging: {
		sendMessage: {
			background: {
				postReceive: async function(args, tab, frameId) {
					if (args.length > 2) {
						args[2] = tab;
					} else {
						args.push(tab);
					}
					if (args.length <= 3) {
						args.push(0);
					}
					return args;
				}
			},
		},
		sendToZoteroFrames: {
			background: {
				postReceive: async function(args, tab) {
					return [args[0], args[1], tab];
				}
			}
		},
		receiveChunk: true
	},
	Prefs: {
		set: false,
		getAll: true,
		getDefault: true,
		getAsync: true,
		clear: false
	},
	Proxies: {
		loadPrefs: false,
		validate: true,
		save: false,
		remove: false,
		toggleRedirectLoopPrevention: false
	},
	WebRequestIntercept: {
		replaceUserAgent: true,
	}
};

MESSAGES.COHTTP = {
	request: {
		background: {
			preSend: async function(xhr) {
				let result = {
					response: xhr.response,
					responseType: xhr.responseType,
					status: xhr.status,
					statusText: xhr.statusText,
					responseHeaders: xhr.getAllResponseHeaders(),
					responseURL: xhr.responseURL
				};
				if (result.response instanceof ArrayBuffer) {
					result.response = packArrayBuffer(xhr.response);
				}
				return result;
			},
		},
		inject: {
			postReceive: async function(xhr) {
				xhr.getAllResponseHeaders = () => xhr.responseHeaders;
				xhr.getResponseHeader = function(name) {
					let match = xhr.responseHeaders.match(new RegExp(`^${name}: (.*)$`, 'mi'));
					return match ? match[1] : null;
				};
				let isSafariArrayBuffer = Zotero.isSafari && xhr.responseType === "arraybuffer";
				let isArrayBuffer = Array.isArray(xhr.response) && xhr.responseType === "arraybuffer";
				let isBlob = xhr.response.startsWith && xhr.response.startsWith('blob:');
				if (isSafariArrayBuffer || isArrayBuffer || isBlob) {
					xhr.response = await unpackArrayBuffer(xhr.response);
				} else {
					xhr.responseText = xhr.response;
				}
				return xhr;
			}
		}
	}
};

if (Zotero.isSafari) {
	MESSAGES.i18n = Object.assign(MESSAGES.i18n || {}, { getStrings: true });
}

const MAX_CONTENT_SIZE = 8 * (1024 * 1024);
function packArrayBuffer(arrayBuffer) {
	if (Zotero.isFirefox) return arrayBuffer;
	if (Zotero.isSafari) {
		return Zotero.Utilities.Connector.arrayBufferToBase64(arrayBuffer);
	}
	if (Zotero.isManifestV3) {
		let array = Array.from(new Uint8Array(arrayBuffer));
		if (array.length > MAX_CONTENT_SIZE) {
			array = array.slice(0, MAX_CONTENT_SIZE);
		}
		return array;
	}
	return URL.createObjectURL(new Blob([arrayBuffer]));
}

async function unpackArrayBuffer(packedBuffer) {
	if (Zotero.isFirefox) return packedBuffer;
	if (Zotero.isSafari) {
		return Zotero.Utilities.Connector.base64ToArrayBuffer(packedBuffer);
	}
	if (Zotero.isManifestV3) {
		return new Uint8Array(packedBuffer).buffer
	}
	let blob = await (await fetch(packedBuffer)).blob();
	return new Promise((resolve) => {
		var fileReader = new FileReader();
		fileReader.onload = function(event) {
			resolve(event.target.result);
		};
		fileReader.readAsArrayBuffer(blob);
	});
}
