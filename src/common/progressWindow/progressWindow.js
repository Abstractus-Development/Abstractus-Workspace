window.onload = async function () {
	var div = document.getElementById('progress-window');
	Zotero.Messaging.init();
	await Zotero.i18n.init();
	ReactDOM.render(
		React.createElement(Zotero.UI.ProgressWindow),
		div
	);

	Zotero.isInject = true;
	Zotero.initDeferred.resolve();
};
