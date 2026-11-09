if(!Zotero.HTTP) Zotero.HTTP = {};

Zotero.HTTP.isSameOrigin = function(url) {
	if (url.includes('www.nature.com/') || url.includes('www-nature-com.')) {
		return false;
	}
	
	const hostPortRe = /^([^:\/]+:)\/\/([^\/]+)/i;
	var m = hostPortRe.exec(url);
	if(!m) {
		return true;
	} else {
		var location = window.location;
		return m[1].toLowerCase() === location.protocol.toLowerCase() &&
			m[2].toLowerCase() === location.host.toLowerCase();
	}
}

Zotero.HTTP.isLessSecure = function(url) {
	if (url.substr(0,8).toLowerCase() == 'https://') return false;
	
	var location = window.location;
	return location.protocol.toLowerCase() == 'https:';
}

Zotero.HTTP.addDefaultReferrer = function(url, options) {
	if (!options.headers) options.headers = {};
	if (options.referrer || options.headers['Referer']) {
		return;
	}
	let referrer = Zotero.HTTP.getDefaultReferrer(url);
	if (referrer) {
		options.referrer = referrer;
	}
}

Zotero.HTTP.getDefaultReferrer = function(url) {
	let sourceURL;
	let targetURL;
	try {
		sourceURL = new URL(document.location.href);
		targetURL = new URL(url, sourceURL.href);
	}
	catch (e) {
		return '';
	}

	let policy = document.referrerPolicy || 'strict-origin-when-cross-origin';
	let sameOrigin = sourceURL.origin == targetURL.origin;
	let isDowngrade = sourceURL.protocol == 'https:' && targetURL.protocol != 'https:';
	let sourceOrigin = sourceURL.origin + '/';
	let sourceHref = sourceURL.href;

	switch (policy) {
		case 'no-referrer':
			return '';
		case 'origin':
			return sourceOrigin;
		case 'same-origin':
			return sameOrigin ? sourceHref : '';
		case 'strict-origin':
			return isDowngrade ? '' : sourceOrigin;
		case 'origin-when-cross-origin':
			return sameOrigin ? sourceHref : sourceOrigin;
		case 'unsafe-url':
			return sourceHref;
		case 'no-referrer-when-downgrade':
			return isDowngrade ? '' : sourceHref;
		case 'strict-origin-when-cross-origin':
		default:
			if (sameOrigin) return sourceHref;
			return isDowngrade ? '' : sourceOrigin;
	}
}
 
Zotero.HTTP.processDocuments = async function (urls, processor, options = {}) {
	if (typeof arguments[2] == 'function' || typeof arguments[3] == 'function') {
		Zotero.debug("Zotero.HTTP.processDocuments() no longer takes onDone or onError -- update your code");
		var onDone = arguments[2];
		var onError = arguments[3];
	}
	
	if (typeof urls == "string") urls = [urls];
	urls = urls.map(url => new URL(url, document.location.href).href);
	var funcs = urls.map(url => () => {
		let requestOptions = {
			responseType: 'text'
		};
		Zotero.HTTP.addDefaultReferrer(url, requestOptions);
		return Zotero.COHTTP.request(
			"GET",
			url,
			requestOptions
		)
		.then((xhr) => {
			Zotero.debug("Parsing cross-origin response for " + url);
			let parser = new DOMParser();
			let contentType = xhr.getResponseHeader("Content-Type");
			if (contentType != 'application/xml' && contentType != 'text/xml') {
				contentType = 'text/html';
			}
			let doc = parser.parseFromString(xhr.responseText, contentType);
			doc = Zotero.HTTP.wrapDocument(doc, url);
			return processor(doc, url);
		});
	});
	
	var f;
	var results = [];
	while (f = funcs.shift()) {
		try {
			results.push(await f());
		}
		catch (e) {
			if (onError) {
				onError(e);
			}
			throw e;
		}
	}
	
	if (onDone) {
		onDone();
	}
	
	return results;
}