try {
	var scriptsToImport = [
		__BACKGROUND_SCRIPTS__,
		"keep-mv3-alive.js",
		"background.js"
	];

	for (let script of scriptsToImport) {
		self.importScripts('./'+script);
	}
} catch (e) {
	console.error(e);
}
