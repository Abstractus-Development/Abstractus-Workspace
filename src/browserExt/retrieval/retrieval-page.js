// Control window for paced PDF retrieval. Reads state from the background and sends Pause,
// Continue or Stop. It never talks to the desktop itself.
(function () {
	const api = typeof browser !== 'undefined' ? browser : chrome;
	const $ = id => document.getElementById(id);
	const ask = action => api.runtime.sendMessage({type: 'abstractus-retrieval', action});

	function render(view) {
		view = view || {};
		const total = view.total || 0;
		const paused = view.queue === 'paused';
		const ended = !view.active && !['running', 'paused'].includes(view.queue);
		$('heading').textContent = ended ? 'Done' : 'Getting papers';
		$('progress').textContent = total ? `${Math.min(view.done + (ended ? 0 : 1), total)} of ${total}` : '';
		$('title').textContent = ended ? '' : (view.title || '');
		const needs = view.phase === 'needs_you';
		$('note').textContent = needs ? 'Needs you: finish this page, then press Continue'
			: (view.message || (view.phase === 'waiting' ? 'Waiting before the next paper.' : ''));
		$('note').className = 'note' + (needs ? ' needs' : '');
		$('pause').hidden = paused || needs || ended;
		$('continue').hidden = !(paused || needs);
		$('stop').hidden = ended;
	}

	async function refresh() {
		try { render(await ask('view')); } catch { render({queue: 'idle'}); }
	}
	for (const name of ['pause', 'continue', 'stop']) {
		$(name).addEventListener('click', async () => {
			try { render(await ask(name)); } catch { /* the desktop said no; the next refresh shows why */ }
			refresh();
		});
	}
	refresh();
	setInterval(refresh, 1500);
})();
