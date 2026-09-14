/*
	***** BEGIN LICENSE BLOCK *****
	
	Copyright © 2018 Center for History and New Media
					George Mason University, Fairfax, Virginia, USA
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

// We cannot display a progress window in Firefox PDFs and if CSP sets a sandbox
// We detect it and initiate a save directly from the background page
// and changes the action button into a "tick.png" icon after the save is complete
Zotero.WebRequestIntercept.addListener('headersReceived', function(details) {
	// Proxy login is a POST method that gets redirected to the final destination via a 302
	if (!Number.isInteger(details.tabId) || details.tabId < 0 || details.type !== 'main_frame') return;
	if (details.method !== 'GET' || details.statusCode < 200 || details.statusCode >= 300) return;
	
	let isPDF = false;
	let isCSPProtected = false;
	const contentType = details.responseHeadersObject['content-type']?.split(';')[0]?.trim();

	// Firefox currently does not allow to inject scripts into pdf pages
	// See https://bugzilla.mozilla.org/show_bug.cgi?id=1454760#c3
	if (Zotero.isFirefox) {
		if (contentType) {
			if (contentType.includes("application/pdf")) {
				isPDF = true;
			}
			// While Firefox will show the PDF viewer for application/octet-stream, it must pass some
			// additional checks: the URL must end in .pdf and the PDF must be a top-level document.
			// https://searchfox.org/mozilla-central/rev/50c3cf7a3c931409b54efa009795b69c19383541/toolkit/components/pdfjs/content/PdfStreamConverter.jsm#1100-1121
			else if (contentType.includes("application/octet-stream")
					&& details.url.includes(".pdf") && details.type === "main_frame") {
				isPDF = true;
			}
		}
	}
	
	if (!isPDF) {
		// Address pages like github gists where we are prevented from injecting the progress window due to
		// the restrictive CSP.
		const csp = details.responseHeadersObject['content-security-policy'];
		isCSPProtected = csp && csp.includes("sandbox") && !csp.includes("allow-scripts");
	}
	
	if (!isPDF && !isCSPProtected) return;
	
	// Somehow browser.webNavigation.onCommitted runs later than headersReceived
	setTimeout(async function() {
		let tab;
		try { tab = await browser.tabs.get(details.tabId); }
		catch { return; } // A closed tab is a normal browser event.
		// The browser can navigate during the deferred update. Do not mark its new page.
		if (!tab?.url || tab.url.split('#')[0] !== details.url.split('#')[0]) return;
		let tabInfo = Zotero.Connector_Browser.getTabInfo(tab.id);
		tabInfo.uninjectable = true;
		tabInfo.isPDF = isPDF;
		tabInfo.contentType = contentType;
		try { await Zotero.Connector_Browser._updateExtensionUI(tab); }
		catch (error) { Zotero.logError(error); }
	}, 100);
});

Zotero.Utilities.saveWithoutProgressWindow = async function (tab, frameId) {
	const action = browser.action || browser.browserAction;
	let url = tab.url;
	let tabInfo = Zotero.Connector_Browser.getTabInfo(tab.id);
	const pdf = tabInfo.isPDF;
	// Get URL from iframe
	if (frameId) {
		({ url } = await browser.webNavigation.getFrame({ tabId: tab.id, frameId }));
	}
	
	var data = {
		url,
		pdf,
		mimeType: tabInfo.contentType,
		sessionID: Zotero.Utilities.randomString()
	};
	if (pdf) {
		data.title = tab.title || new URL(url).pathname.split('/').pop();
	}
	else {
		data.title = url;
	}
	try {
		action.setIcon({
			tabId:tab.id,
			path: {
				'16': 'images/spinner-16px.png',
				'32': 'images/spinner-16px@2x.png'
			}
		});
		action.setTitle({
			tabId:tab.id,
			title: Zotero.getString('browserAction_saving')
		});
		
		// Check availability before fetching the attachment
		await Zotero.Connector.ping();
		await Zotero.ItemSaver.saveStandaloneAttachmentToZotero(data, data.sessionID, tab);

		action.setIcon({
			tabId:tab.id,
			path: {
				'16': 'images/tick.png',
				'32': 'images/tick@2x.png'
			}
		});
		action.setTitle({
			tabId:tab.id,
			title: Zotero.getString('browserAction_saved')
		});
		tabInfo.isPDF = false;
	
	} catch (e) {
		if (e.status !== 0) {
			Zotero.logError(e);
		}
		
		action.setIcon({
			tabId:tab.id,
			path: "images/cross.png"
		});
		
		action.setTitle({
			tabId:tab.id,
			title: e.name === 'AbstractusConnectionError' ? e.message : Zotero.getString('browserAction_saveFailed', ZOTERO_CONFIG.CLIENT_NAME)
		});
	}
}
