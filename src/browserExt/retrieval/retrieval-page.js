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
		const intro = total ? `Getting ${total} ${total === 1 ? 'paper' : 'papers'} for Abstractus Desktop` : '';
		$('note').textContent = needs ? 'Needs you: finish the check in the open window'
			: (view.message || (view.phase === 'waiting' ? 'Waiting before the next paper.' : (ended ? '' : intro)));
		$('note').className = 'note' + (needs ? ' needs' : '');
		$('pause').hidden = paused || ended;
		$('continue').hidden = !paused;
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
	// Optional library proxy host (EZproxy, OpenAthens). Checked and stored by the background.
	const ERRORS = {empty: '', scheme: 'Use a web address.', unparseable: 'That is not a host name.', userinfo: 'Remove the user name.',
		port: 'Remove the port.', ip_address: 'Use a host name, not an address.', not_a_hostname: 'That is not a host name.',
		blocked_site: 'That site is not allowed.', too_broad: 'That host is too broad.'};
	async function loadProxy() {
		try { $('proxy-host').value = (await ask('get-proxy')).host || ''; } catch { /* leave empty */ }
	}
	$('proxy-save').addEventListener('click', async () => {
		try {
			const r = await api.runtime.sendMessage({type: 'abstractus-retrieval', action: 'set-proxy', value: $('proxy-host').value});
			if (r && r.ok) { $('proxy-host').value = r.host; $('proxy-note').textContent = r.host ? 'Saved.' : 'Cleared.'; }
			else $('proxy-note').textContent = ERRORS[r && r.error] || 'Not saved.';
		}
		catch { $('proxy-note').textContent = 'Not saved.'; }
	});
	loadProxy();
	refresh();
	setInterval(refresh, 1500);
})();
