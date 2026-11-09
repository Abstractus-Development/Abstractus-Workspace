const LET_DIE_AFTER = 10*60e3;

const startedOn = Date.now();
let interval;

function keepAlive() {
	if (startedOn + LET_DIE_AFTER < Date.now() && !Zotero.Connector_Browser.shouldKeepServiceWorkerAlive()) {
		clearInterval(interval);
	}
	chrome.runtime.getPlatformInfo();
}
interval = setInterval(keepAlive, 20e3);