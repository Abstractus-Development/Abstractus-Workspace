/*
	***** BEGIN LICENSE BLOCK *****
	
    Copyright © 2024 Corporation for Digital Scholarship
                     Vienna, Virginia, USA
					http://zotero.org
	
	This file is part of Zotero.
	
	Zotero is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published by
	the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.
	
	Zotero is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU Affero General Public License for more details.

	You should have received a copy of the GNU Affero General Public License
	along with Zotero.  If not, see <http://www.gnu.org/licenses/>.
	
	***** END LICENSE BLOCK *****
*/

Zotero.ItemSaver = Zotero.ItemSaver || {};

/**
 * Checks if a string contains characters not allowed in HTTP headers (non-ASCII characters)
 * @param {string} str - The string to check
 * @returns {boolean} - True if the string contains non-ASCII characters
 */
Zotero.ItemSaver._containsNonAsciiChars = function(str) {
	if (!str) return false;
	// Check for any character with code > 127 (non-ASCII)
	for (let i = 0; i < str.length; i++) {
		if (str.charCodeAt(i) > 127) {
			return true;
		}
	}
	return false;
};

/**
 * RFC2047 encodes a string using quoted-printable encoding for use in HTTP headers
 * @param {string} str - The string to encode
 * @returns {string} - The RFC2047 encoded string
 */
Zotero.ItemSaver._rfc2047Encode = function(str) {
	if (!str || !this._containsNonAsciiChars(str)) {
		return str;
	}
	
	const utf8Bytes = new TextEncoder().encode(str);
	let encoded = '';
	for (let byte of utf8Bytes) {
		// Encode spaces as underscores, other special chars as =XX
		if (byte === 32) { // space
			encoded += '_';
		}
		else if (byte >= 33 && byte <= 126 && byte !== 61 && byte !== 63 && byte !== 95) {
			// Printable ASCII except =, ?, _
			encoded += String.fromCharCode(byte);
		}
		else {
			encoded += '=' + byte.toString(16).toUpperCase().padStart(2, '0');
		}
	}
	
	// Return RFC2047 encoded format: =?UTF-8?Q?quoted-printable?=
	return `=?UTF-8?Q?${encoded}?=`;
};

/**
 * Saves binary attachments to Zotero by fetching them as ArrayBuffer and passing to Zotero.
 * We do this in the background page, otherwise we would have to pass the ArrayBuffer
 * between content scripts and background, and it's bad for performance (and also requires
 * severe workarounds due to brokenness in MV3 https://issues.chromium.org/issues/338162118 )
 * @param attachment
 * @param sessionID 
 */
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
	// Attachment URLs come from translator output: same rules as translator requests.
	attachment.url = Zotero.AbstractusNetwork.validate(attachment.url);
	let options = { responseType: "arraybuffer", timeout: 60000, successCodes: false, publisherOnly: true };
	let cookies;
	try {
		cookies = await Zotero.Connector_Browser.getAllCookies({
			url: attachment.url,
			partitionKey: {},
		}, tab);
	} catch (e) {
		// Unavailable with Chrome 118 and below. Last supported version on Win 7/8 is Chrome 109.
		Zotero.debug(`Error getting cookies for ${attachment.url} with partitionKey.`);
		cookies = await Zotero.Connector_Browser.getAllCookies({
			url: attachment.url,
		}, tab);
	}
	// Browsers send cookies already, but Chrome currently ignores those with partitionKey.
	// Cloudflare clearance cookies and potentially others in the future are set with a partitionKey.
	// There's a bug filed for this at https://issues.chromium.org/issues/458071621
	// Also Firefox with FPI enabled will not send any cookies, but getAllCookies above will
	// retrieve them with firstPartyDomain property.
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

	// Bot bypass is not supported in Safari (cannot intercept file download popup)
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
	// Only attempt fallback for attachments on whitelisted domains
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
	// If the attachment doesn't specify the mimeType, we accept whatever mimeType we got here.
	// If translators want to enforce that a PDF is saved, then they should specify that!
	if (!attachment.mimeType) {
		// Set the missing mimeType based on the content type header or the URL
		attachment.mimeType = contentType;
		if (!xhr.getResponseHeader("Content-Type")) {
			attachment.mimeType = Zotero.Utilities.Connector.guessAttachmentMimeType(attachment.url);
		}
		return null;
	}
	if (attachment.mimeType.toLowerCase() === contentType.toLowerCase()) {
		return null;
	}
	// Trust the translator's mimeType when the server returns octet-stream,
	// since some servers serve all binary files as octet-stream (e.g., OSF, Libraries Tasmania)
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
