(function () {
	const category = new URLSearchParams(location.search).get('c') || '';
	document.getElementById('blocked-category').textContent = category ? category + '.' : '';
	document.getElementById('blocked-list-link').addEventListener('click', function (event) {
		event.preventDefault();
		try { chrome.tabs.create({url: this.href}); window.close(); }
		catch (e) { location.href = this.href; }
	});
})();
