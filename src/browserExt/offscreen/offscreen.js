let managerMessaging;
const frameManager = Zotero.TranslateHostFrameManager;

async function init() {
	console.log('Offscreen: initializing translate host frame manager messaging');
	let messageChannel = new MessageChannel();
	let options = {
		functionOverrides: FRAME_MANAGER_FUNCTIONS,
		handlerFunctionOverrides: FRAME_MANAGER_MESSAGE_FUNCTIONS,
		overrideTarget: Zotero,
		sendMessage: (...args) => messageChannel.port1.postMessage(args),
		addMessageListener: fn => {
			messageChannel.port1.onmessage = (event) => fn(event.data);
		}
	};
	if (managerMessaging) {
		managerMessaging.reinit(options);
	}
	else {
		managerMessaging = new Zotero.MessagingGeneric(options);
	}

	const backgroundServiceWorker = await navigator.serviceWorker.ready;
	backgroundServiceWorker.active.postMessage('offscreen-port', [messageChannel.port2]);
	console.log('Offscreen: messaging port posted');
	await managerMessaging.sendMessage('TranslateHostFrameManager.initialized');
}

document.addEventListener('DOMContentLoaded', () => init());

navigator.serviceWorker.onmessage = async (e) => {
	if (e.data !== 'service-worker-restarted') return;
	console.log('Offscreen: owner service worker restarted. reinitializing messaging');
	await init();
};
