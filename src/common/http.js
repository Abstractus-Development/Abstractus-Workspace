const MAX_BACKOFF = 64e3;

const HEADERS_SPECIAL_HANDLING = ['User-Agent', 'Cookie', 'Referer', 'Sec-Fetch-Site'];

Zotero.HTTP = new function() {
	this.VALID_DOM_PARSER_CONTENT_TYPES = new Set([
		"text/html",
		"text/xml",
		"application/xml",
		"application/xhtml+xml",
		"image/svg+xml"
	]);
	
	this.StatusError = function(xmlhttp, url, responseText) {
		this.message = `HTTP request to ${url} rejected with status ${xmlhttp.status}`;
		this.status = xmlhttp.status;
		if (xmlhttp.getResponseHeader && xmlhttp.getResponseHeader('Retry-After')) {
			this.retryAfter = xmlhttp.getResponseHeader('Retry-After');
		}
		try {
			this.responseText = responseText.substr(0, 1024);
		} catch (e) {}
	};
	this.StatusError.prototype = Object.create(Error.prototype);

	this.TimeoutError = function(url, ms) {
		this.message = `HTTP request to ${url} has timed out after ${ms}ms`;
	};
	this.TimeoutError.prototype = Object.create(Error.prototype);
	
	this.request = async function(method, url, options = {}) {
		options = Object.assign({
			body: null,
			headers: {},
			debug: false,
			logBodyLength: 1024,
			timeout: 15000,
			responseType: '',
			responseCharset: null,
			successCodes: null,
			maxBackoff: 10,
			backoff: 0,
			forceInject: false,
		}, options);
		let originalOptions = Zotero.Utilities.deepCopy(options);
		
		try {
			if (Zotero.isManifestV3) {
				return await Zotero.HTTP._requestFetch(method, url, options);
			}
			else {
				return await Zotero.HTTP._requestXHR(method, url, options);
			}

		}
		catch (e) {
			if (e.credentialedRedirect) {
				return Zotero.HTTP.request(method, url, Object.assign({}, originalOptions, { omitCredentials: true }));
			}
			if ((e.status === 429 || e.retryAfter) && options.backoff < options.maxBackoff) {
				if (e.status === 429) {
					Zotero.debug(`HTTP 429 returned, attempting a backoff #${options.backoff+1}`)
				}
				else {
					Zotero.debug(`HTTP ${e.status} returned with Retry-After: ${e.retryAfter}, attempting a backoff #${options.backoff+1}`)
				}
				if (e.retryAfter && parseInt(e.retryAfter) == e.retryAfter) {
					if (e.retryAfter * 1000 > MAX_BACKOFF) {
						Zotero.debug(`HTTP 429 Retry-After ${e.retryAfter} is higher than max backoff. Not retrying.`);
						throw e;
					}
					await Zotero.Promise.delay(e.retryAfter * 1000);
				}
				else {
					await Zotero.Promise.delay(Math.min(Math.pow(2, options.backoff)*1000, MAX_BACKOFF) + Math.round(Math.random() * 1000));
				}
				originalOptions.backoff++;
				return Zotero.HTTP.request(method, url, originalOptions);
			}
			throw e;
		}
	};
	
	this._requestXHR = async function(method, url, options) {
		var useContentXHR = false;
		let DNRRuleID;
		
		let shouldRouteViaInject = Zotero.isInject && (options.forceInject
			|| Zotero.HTTP.isSameOrigin(url) && !options.headers['User-Agent']);
		let shouldUseContentXHR = shouldRouteViaInject && Zotero.isFirefox;
		if (shouldUseContentXHR) {
			if (typeof content != 'undefined' && content.XMLHttpRequest) {
				Zotero.debug("Using content XHR");
				useContentXHR = true;
			}
		}
		else if (Zotero.isInject && !shouldRouteViaInject) {
			let isDocRequest = options.responseType == 'document';
			let coOptions = Object.assign({}, options);
			Zotero.HTTP.addDefaultReferrer(url, coOptions);
			if (isDocRequest) {
				coOptions.responseType = 'text';
			}
			if (Zotero.isSafari && options.headers['User-Agent']) {
				coOptions.headers['Cookie'] = document.cookie;
			}
			return Zotero.COHTTP.request(method, new URL(url, document.location.href).href, coOptions).then(function (xmlhttp) {
				if (!isDocRequest) return xmlhttp;
				
				Zotero.debug("Parsing cross-origin response for " + url);
				let parser = new DOMParser();
				let contentType = xmlhttp.getResponseHeader("Content-Type");
				let doc = parser.parseFromString(xmlhttp.responseText, Zotero.HTTP.determineDOMParserContentType(contentType));
				
				return new Proxy(xmlhttp, {
					get: function (target, name) {
						return name == 'response' ? doc : target[name];
					}
				});
			});
		}
		
		let logBody = '';
		if (['GET', 'HEAD'].includes(method)) {
			if (options.body != null) {
				throw new Error(`HTTP ${method} cannot have a request body (${options.body})`)
			}
		} else if(options.body && !(options.body instanceof ArrayBuffer)) {
			if (options.headers["Content-Type"] !== 'multipart/form-data') {
				options.body = typeof options.body == 'string' ? options.body : JSON.stringify(options.body);

				logBody = `: ${options.body.substr(0, options.logBodyLength)}` +
						options.body.length > options.logBodyLength ? '...' : '';
				logBody = logBody.replace(/password":"[^"]+/, 'password":"********');
				logBody = logBody.replace(/password=[^&]+/, 'password=********');
			}
			
			if (!options.headers) options.headers = {};
			if (!options.headers["Content-Type"]) {
				options.headers["Content-Type"] = "application/x-www-form-urlencoded";
			}
			else if (options.headers["Content-Type"] == 'multipart/form-data') {
				delete options.headers["Content-Type"];
			}
		}	
		
		if (Zotero.isBackground) {
			if (options.referrer) {
				options.headers['Referer'] = options.referrer;
			}
			let replaceHeaders = HEADERS_SPECIAL_HANDLING.filter(header => !!options.headers[header])
				.map(header => {
					const val = { name: header, value: options.headers[header] }
					delete options.headers[header];
					return val;
				});
			if (replaceHeaders.length) {
				DNRRuleID = await Zotero.WebRequestIntercept.replaceHeaders(url, replaceHeaders);
			}
		}
		Zotero.debug(`HTTP ${method} ${url}${logBody}`);
		
		var xmlhttp = useContentXHR ? new content.XMLHttpRequest() : new XMLHttpRequest(options.omitCredentials ? { mozAnon: true } : undefined);
		xmlhttp.timeout = options.timeout;
		var promise = Zotero.HTTP._attachHandlers(url, xmlhttp, options);
		
		xmlhttp.open(method, url, true);

		for (let header in options.headers) {
			if (Zotero.isSafari && header.toLowerCase() == 'referer') continue;
			xmlhttp.setRequestHeader(header, options.headers[header]);
		}
		
		xmlhttp.responseType = options.responseType || '';
		
		if (options.responseCharset) {
			xmlhttp.overrideMimeType("text/plain; charset=" + options.responseCharset);
		}
		
		xmlhttp.send(options.body);
		
		try {
			xmlhttp = await promise;
			if (options.publisherOnly) {
				Zotero.AbstractusNetwork.checkFinalURL(url, xmlhttp.responseURL);
				Zotero.AbstractusNetwork.checkCredentialedRedirect(options, xmlhttp.responseURL);
			}
			if (options.debug && (xmlhttp.responseType === '' || xmlhttp.responseType === 'text')) {
				Zotero.debug(`HTTP ${xmlhttp.status} ${xmlhttp.responseURL} response: ${xmlhttp.responseText}`);
			}
			else {
				Zotero.debug(`HTTP ${xmlhttp.status} ${xmlhttp.responseURL} response`);
			}
			
			let invalidDefaultStatus = options.successCodes === null &&
				(xmlhttp.status < 200 || xmlhttp.status >= 300);
			let invalidStatus = Array.isArray(options.successCodes) && !options.successCodes.includes(xmlhttp.status);
			if (invalidDefaultStatus || invalidStatus) {
				let responseText = ['', 'text'].includes(xmlhttp.responseType) ? xmlhttp.responseText : undefined;
				throw new Zotero.HTTP.StatusError(xmlhttp, url, responseText);
			}
			return xmlhttp;
		}
		finally {
			if (DNRRuleID) {
				await Zotero.WebRequestIntercept.removeRuleDNR(DNRRuleID);
			}
		}
	}
	
	this._requestFetch = async function(method, url, options) {
		if (Zotero.isInject) {
			let isDocRequest = options.responseType == 'document';
			let coOptions = Object.assign({}, options);
			Zotero.HTTP.addDefaultReferrer(url, coOptions);
			if (isDocRequest) {
				coOptions.responseType = 'text';
			}
			return Zotero.COHTTP.request(method, new URL(url, document.location.href).href, coOptions).then(function (xmlhttp) {
				if (!isDocRequest) {
					return xmlhttp;
				}
				
				Zotero.debug("Parsing cross-origin response for " + url);
				let parser = new DOMParser();
				let contentType = xmlhttp.getResponseHeader("Content-Type");
				let doc = parser.parseFromString(xmlhttp.responseText, Zotero.HTTP.determineDOMParserContentType(contentType));
				xmlhttp.responseType = options.responseType;
				
				return new Proxy(xmlhttp, {
					get: function (target, name) {
						return name == 'response' ? doc : target[name];
					}
				});
			});
		}
		
		try {
			let DNRRuleID;
			Zotero.Connector_Browser.setKeepServiceWorkerAlive(true);
			
			let logBody = '';
			if (['GET', 'HEAD'].includes(method)) {
				if (options.body != null) {
					throw new Error(`HTTP ${method} cannot have a request body (${options.body})`)
				}
			} else if (options.body && !(options.body instanceof ArrayBuffer)) {
				if (options.headers["Content-Type"] !== 'multipart/form-data') {
					options.body = typeof options.body == 'string' ? options.body : JSON.stringify(options.body);

					logBody = `: ${options.body.substr(0, options.logBodyLength)}` +
							options.body.length > options.logBodyLength ? '...' : '';
					logBody = logBody.replace(/password":"[^"]+/, 'password":"********');
					logBody = logBody.replace(/password=[^&]+/, 'password=********');
				}
				
				if (!options.headers) options.headers = {};
				if (!options.headers["Content-Type"]) {
					options.headers["Content-Type"] = "application/x-www-form-urlencoded";
				}
				else if (options.headers["Content-Type"] == 'multipart/form-data') {
					delete options.headers["Content-Type"];
				}
			}

			
			Zotero.debug(`HTTP ${method} ${url}${logBody}`);
			if (options.responseType == '') {
				options.responseType = 'text';
			}
			
			if (options.timeout) {
				var abortController = new AbortController();
				setTimeout(abortController.abort.bind(abortController), options.timeout);
			}
			if (options.referrer) {
				options.headers['Referer'] = options.referrer;
			}

			if (!options.omitCredentials) await this._augmentCfCookie(url, options);
			let replaceHeaders = HEADERS_SPECIAL_HANDLING.filter(header => !!options.headers[header])
				.map(header => {
					const val = { name: header, value: options.headers[header] }
					delete options.headers[header];
					return val;
				});
			if (replaceHeaders.length) {
				DNRRuleID = await Zotero.WebRequestIntercept.replaceHeaders(url, replaceHeaders);
			}
			try {
				let fetchOptions = {
					method,
					headers: options.headers,
					body: options.body,
					credentials: options.omitCredentials ? 'omit' : (Zotero.isInject ? 'same-origin' : 'include'),
				}
				if (abortController) {
					fetchOptions.signal = abortController.signal;
				}
				var response = await fetch(url, fetchOptions);
			} catch (e) {
				var err;
				if (e.name == 'AbortError') {
					err = new Zotero.HTTP.TimeoutError(url, options.timeout);
				}
				else {
					Zotero.debug(`HTTP 0 ${url} response: ${e.message}`);
					if (options.successCodes === false) {
						return {
							status: 0,
							responseText: e.message,
							response: e.message,
							responseURL: url,
							responseType: options.responseType,
							statusText: e.message,
							getAllResponseHeaders: () => "",
							getResponseHeader: () => ""
						}
					}
					err = new Zotero.HTTP.StatusError({ status: 0 }, url, e.message);
				}
				throw err;
			}
			finally {
				if (DNRRuleID) {
					await Zotero.WebRequestIntercept.removeRuleDNR(DNRRuleID);
				}
			}
			
			if (options.publisherOnly) {
				Zotero.AbstractusNetwork.checkFinalURL(url, response.url);
				Zotero.AbstractusNetwork.checkCredentialedRedirect(options, response.url);
			}

			let responseData;
			if (options.responseType == 'arraybuffer') {
				responseData = await response.arrayBuffer();
			}
			else if (options.responseType == 'json') {
				responseData = await response.text();
				try {
					responseData = JSON.parse(responseData);
				}
				catch (e) {
					Zotero.debug(`HTTP: Failed to parse JSON from ${method} ${url}`);
				}
			}
			else {
				responseData = await response.text();
			}

			if (options.debug && (options.responseType === 'json' || options.responseType === 'text')) {
				Zotero.debug(`HTTP ${response.status} ${response.url} response: ${responseData}`);
			}
			else {
				Zotero.debug(`HTTP ${response.status} ${response.url} response`);
			}
			
			let responseHeaders = {};
			let responseHeadersString = "";
			for (let [key, value] of response.headers.entries()) {
				responseHeaders[key.toLowerCase()] = value;
				responseHeadersString += `${key}: ${value}\r\n`;
			}
			
			response = {
				responseText: typeof responseData == 'string' ? responseData : '',
				response: responseData,
				responseURL: response.url,
				responseType: options.responseType,
				status: response.status,
				statusText: response.statusText,
				getAllResponseHeaders: () => responseHeadersString,
				getResponseHeader: name => responseHeaders[name.toLowerCase()]
			};

			let invalidDefaultStatus = options.successCodes === null &&
				(response.status < 200 || response.status >= 300);
			let invalidStatus = Array.isArray(options.successCodes) && !options.successCodes.includes(response.status);
			if (invalidDefaultStatus || invalidStatus) {
				throw new Zotero.HTTP.StatusError(response, url, typeof responseData == 'string' ? responseData : '');
			}
			
			return response;
		}
		finally {
			Zotero.Connector_Browser.setKeepServiceWorkerAlive(false);
		}
	};
	
	this.doGet = function(url, onDone, responseCharset, cookieSandbox, headers) {
		Zotero.debug('Zotero.HTTP.doGet is deprecated. Use Zotero.HTTP.request');
		this.request('GET', url, {responseCharset, headers})
		.then(onDone, function(e) {
			onDone({status: e.status, responseText: e.responseText});
			throw (e);
		});
		return true;
	};
	
	this.doPost = function(url, body, onDone, headers, responseCharset) {
		Zotero.debug('Zotero.HTTP.doPost is deprecated. Use Zotero.HTTP.request');
		this.request('POST', url, {body, responseCharset, headers})
		.then(onDone, function(e) {
			onDone({status: e.status, responseText: e.responseText});
			throw (e);
		});
		return true;	
	};
	
	
	this.wrapDocument = function(doc, docURL, props={}) {
		docURL = new URL(docURL);
		var wrappedDoc = new Proxy(doc, {
			get: function (t, prop) {
				if (prop === 'location') {
					return docURL;
				}
				else if (prop == 'evaluate') {
					return function() {
						if (arguments[1] == wrappedDoc) {
							arguments[1] = t;
						}
						return t.evaluate.apply(t, arguments)
					}
				}
				else if (prop == 'documentURI') {
					return docURL.href;
				}
				else if (props[prop]) {
					return props[prop];
				}
				else {
					if (typeof t[prop] == 'function') {
						return t[prop].bind(t);
					}
					return t[prop];
				}
			}
		});
		return wrappedDoc;
	};

	this.determineDOMParserContentType = function(contentType) {
		if (Zotero.HTTP.VALID_DOM_PARSER_CONTENT_TYPES.has(contentType)) {
			return contentType;
		}
		else {
			if (contentType.includes('xml')) {
				return "text/xml";
			}
			else {
				return "text/html";
			}
		}
	}
	
	this._attachHandlers = function(url, xmlhttp, options) {
		var deferred = Zotero.Promise.defer();
		xmlhttp.onload = () => deferred.resolve(xmlhttp);
		xmlhttp.onerror = xmlhttp.onabort = function() {
			var e = new Zotero.HTTP.StatusError(xmlhttp, url, ['', 'text'].includes(xmlhttp.responseType) ? xmlhttp.responseText : undefined);
			if (options.successCodes === false) {
				deferred.resolve(xmlhttp);
			} else {
				deferred.reject(e);
			}
		};
		xmlhttp.ontimeout = function() {
			var e = new Zotero.HTTP.TimeoutError(url, xmlhttp.timeout);
			Zotero.logError(e);
			deferred.reject(e);
		};
		return deferred.promise;
	};

	this._augmentCfCookie = async function(url, options) {
		let cfCookies;
		try {
			cfCookies = await Zotero.Connector_Browser.getAllCookies({
				url,
				name: 'cf_clearance',
				partitionKey: {}
			});
		} catch (e) {
			return;
		}
		if (!cfCookies.length) return;
		const cookieString = cfCookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
		if (options.headers['Cookie']) {
			options.headers['Cookie'] = `${options.headers['Cookie']}; ${cookieString}`;
		}
		else {
			options.headers['Cookie'] = cookieString;
		}
	}
}

Zotero.COHTTP = {
	request: function(method,url,options) { return Zotero.HTTP.request(method,Zotero.AbstractusNetwork.validate(url),options); }
};
