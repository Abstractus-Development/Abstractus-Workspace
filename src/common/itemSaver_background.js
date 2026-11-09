Zotero.ItemSaver = Zotero.ItemSaver || {};

Zotero.ItemSaver._containsNonAsciiChars = function(str) {
	if (!str) return false;
	for (let i = 0; i < str.length; i++) {
		if (str.charCodeAt(i) > 127) {
			return true;
		}
	}
	return false;
};

Zotero.ItemSaver._rfc2047Encode = function(str) {
	if (!str || !this._containsNonAsciiChars(str)) {
		return str;
	}
	
	const utf8Bytes = new TextEncoder().encode(str);
	let encoded = '';
	for (let byte of utf8Bytes) {
		if (byte === 32) {
			encoded += '_';
		}
		else if (byte >= 33 && byte <= 126 && byte !== 61 && byte !== 63 && byte !== 95) {
			encoded += String.fromCharCode(byte);
		}
		else {
			encoded += '=' + byte.toString(16).toUpperCase().padStart(2, '0');
		}
	}
	
	return `=?UTF-8?Q?${encoded}?=`;
};

Zotero.ItemSaver.saveAttachmentToZotero = async function(attachment, sessionID, tab) {
	let arrayBuffer;
	if (attachment.data) {
		arrayBuffer = this._unpackSafariAttachmentData(attachment.data);
		delete attachment.data;
	}
	if (!arrayBuffer) {
		arrayBuffer = await this._fetchAttachment(attachment, tab);
	}
	
	let metadata = JSON.stringify({
		id: attachment.id,
		url: attachment.url,
		contentType: attachment.mimeType,
		parentItemID: attachment.parentItem,
		title: this._rfc2047Encode(attachment.title),
	});

	return Zotero.Connector.callMethod({
		method: "saveAttachment",
		headers: {
			"Content-Type": `${attachment.mimeType}`,
			"X-Metadata": metadata
		},
		queryString: `sessionID=${sessionID}`
	}, arrayBuffer);
}

Zotero.ItemSaver.saveStandaloneAttachmentToZotero = async function(attachment, sessionID, tab) {
	let arrayBuffer;
	if (attachment.data) {
		arrayBuffer = this._unpackSafariAttachmentData(attachment.data);
		delete attachment.data;
	}
	if (!arrayBuffer) {
		arrayBuffer = await this._fetchAttachment(attachment, tab);
	}

	let metadata = JSON.stringify({
		url: attachment.url,
		contentType: attachment.mimeType,
		title: this._rfc2047Encode(attachment.title),
	});

	return Zotero.Connector.callMethod({
		method: "saveStandaloneAttachment",
		headers: {
			"Content-Type": `${attachment.mimeType}`,
			"X-Metadata": metadata
		},
		queryString: `sessionID=${sessionID}`,
		timeout: 60e3
	}, arrayBuffer);
}

Zotero.ItemSaver._fetchAttachment = async function(attachment, tab, attemptBotProtectionBypass=true) {
	if (Zotero.SiteBlocklist.isBlockedUrl(attachment.url) || (tab && tab.url && Zotero.SiteBlocklist.isBlockedUrl(tab.url))) {
		throw new Error('Abstractus does not fetch from this site');
	}
	attachment.url = Zotero.AbstractusNetwork.validate(attachment.url);
	let options = { responseType: "arraybuffer", timeout: 60000, successCodes: false, publisherOnly: true };
	let cookies;
	try {
		cookies = await Zotero.Connector_Browser.getAllCookies({
			url: attachment.url,
			partitionKey: {},
		}, tab);
	} catch (e) {
		Zotero.debug(`Error getting cookies for ${attachment.url} with partitionKey.`);
		cookies = await Zotero.Connector_Browser.getAllCookies({
			url: attachment.url,
		}, tab);
	}
	cookies = cookies.filter(cookie => {
		if (cookie.partitionKey) return true;
		if (Zotero.isFirefox && cookie.firstPartyDomain) return true;
	});
	options.headers = {
		"Cookie": cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
	}
	if (Zotero.AbstractusNetwork.referrerAllowed(attachment.url, attachment.referrer)) {
		options.referrer = attachment.referrer;
	}

	attemptBotProtectionBypass = attemptBotProtectionBypass && !Zotero.isSafari;
	
	let xhr = await Zotero.HTTP.request("GET", attachment.url, options);
	let validationError = this._validateResponse(attachment, xhr);
	if (xhr.status >= 200 && xhr.status < 400 && !validationError) {
		return xhr.response;
	}
	
	const BYPASS_TYPE = Zotero.BotBypass.BYPASS_TYPE;
	let botBypassType = BYPASS_TYPE.NONE;
	if (attemptBotProtectionBypass) {
		botBypassType = Zotero.BotBypass.canBotBypass(attachment.url, xhr);
	}

	let errorMessage = `Attachment download failed with HTTP status ${xhr.status}`
		+ (validationError ? ` (${validationError})` : '');
	if (!tab || botBypassType === BYPASS_TYPE.NONE) {
		throw new Error(errorMessage);
	}
	Zotero.debug(`Error downloading attachment ${attachment.url}: ${errorMessage}. Attempting bot protection bypass`);
	
	if (botBypassType === BYPASS_TYPE.AMAZON_CAPTCHA) {
		return Zotero.BotBypass.bypassAmazonCaptcha(attachment, options)
	}
	
	let originalUrl = attachment.url;
	try {
		let pdfURL = await Zotero.BotBypass.passJSDetectionViaHiddenIframe(attachment.url, tab);
		attachment.url = pdfURL;
		return await this._fetchAttachment(attachment, tab);
	}
	catch (e) {
		Zotero.debug(`Failed to pass JS bot detection via hidden iframe for URL: ${attachment.url}`);
		Zotero.debug(e);
		let pdfURL = await Zotero.BotBypass.passJSDetectionViaWindowPrompt(originalUrl, tab);
		attachment.url = pdfURL;
		return this._fetchAttachment(attachment, tab);
	}
};

Zotero.ItemSaver._validateResponse = function(attachment, xhr, contentType) {
	let contentLength = xhr.getResponseHeader("Content-Length");
	if (contentLength !== null && parseInt(contentLength) === 0) {
		return "empty response";
	}
	contentType = contentType || Zotero.Utilities.Connector.getContentTypeFromXHR(xhr).contentType;
	if (!attachment.mimeType) {
		attachment.mimeType = contentType;
		if (!xhr.getResponseHeader("Content-Type")) {
			attachment.mimeType = Zotero.Utilities.Connector.guessAttachmentMimeType(attachment.url);
		}
		return null;
	}
	if (attachment.mimeType.toLowerCase() === contentType.toLowerCase()) {
		return null;
	}
	if (contentType.toLowerCase() === 'application/octet-stream') {
		return null;
	}
	return "Attachment MIME type " + contentType
		+ " does not match specified type " + attachment.mimeType;
};

Zotero.ItemSaver._unpackSafariAttachmentData = function(data) {
	if (typeof data === 'string') {
		return Zotero.Utilities.Connector.base64ToArrayBuffer(data);
	}
	return data;
}
