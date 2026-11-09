function sendMessage() {
	if(responseSent) return;
	responseSent = true;
	browser.runtime.sendMessage(["selectDone", [tabID, items]]);
	browser.windows.getCurrent().then(function (win) {
		browser.windows.remove(win.id);
	});
}