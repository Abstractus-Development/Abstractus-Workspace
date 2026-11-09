Zotero.WebRequestIntercept.addListener('headersReceived', function(details) {
	if (!Number.isInteger(details.tabId) || details.tabId < 0 || details.type !== 'main_frame') return;
	if (details.method !== 'GET' || details.statusCode < 200 || details.statusCode >= 300) return;
	
	let isPDF = false;
	let isCSPProtected = false;
	const contentType = details.responseHeadersObject['content-type']?.split(';')[0]?.trim();

	if (Zotero.isFirefox) {
		if (contentType) {
			if (contentType.includes("application/pdf")) {
				isPDF = true;
			}
			else if (contentType.includes("application/octet-stream")
					&& details.url.includes(".pdf") && details.type === "main_frame") {
				isPDF = true;
			}
		}
	}
	
	if (!isPDF) {
		const csp = details.responseHeadersObject['content-security-policy'];
		isCSPProtected = csp && csp.includes("sandbox") && !csp.includes("allow-scripts");
	}
	
	if (!isPDF && !isCSPProtected) return;
	
	setTimeout(async function() {
		let tab;
		try { tab = await browser.tabs.get(details.tabId); }
		catch { return; }
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
