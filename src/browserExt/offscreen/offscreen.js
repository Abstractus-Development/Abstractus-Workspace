let offscreenSandboxReadyPromise = new Promise((resolve) => {
	self.onmessage = async (e) => {
		if (e.data === 'offscreen-sandbox-ready') {
			self.onmessage = null;
			resolve();
		}
	}
});

async function init() {
	console.log('Offscreen: awaiting offscreen sandbox to be ready')
	await offscreenSandboxReadyPromise;
	
	let messageChannel = new MessageChannel();
	const iframe = document.querySelector('iframe');
	iframe.contentWindow.postMessage('offscreen-port', "*", [messageChannel.port1]);

	console.log('Offscreen: awaiting offscreen sandbox to prepare for service worker connection')
	await new Promise((resolve) => {
		messageChannel.port2.onmessage = resolve;
	});
	messageChannel.port2.onmessage = null;
	
	const backgroundServiceWorker = await navigator.serviceWorker.ready;
	backgroundServiceWorker.active.postMessage('offscreen-port', [messageChannel.port2]);
	console.log('Offscreen: messaging ports posted');
}

document.addEventListener('DOMContentLoaded', () => init());

navigator.serviceWorker.onmessage = async (e) => {
	if (e.data !== 'service-worker-restarted') return;
	console.log('Offscreen: owner service worker restarted. reinitializing messaging');
	await init();
};