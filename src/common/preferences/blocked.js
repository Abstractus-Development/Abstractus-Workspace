// Abstractus: the notice shown when the toolbar button is clicked on a site Abstractus never touches.
// It only displays text. It never saves, reads the page or talks to the desktop.
(function () {
	const category = new URLSearchParams(location.search).get('c') || '';
	document.getElementById('blocked-category').textContent = category ? category + '.' : '';
	document.getElementById('blocked-list-link').addEventListener('click', function (event) {
		// The notice is a small popup window: open the list in a normal tab and close the popup.
		event.preventDefault();
		try { chrome.tabs.create({url: this.href}); window.close(); }
		catch (e) { location.href = this.href; }
	});
})();
