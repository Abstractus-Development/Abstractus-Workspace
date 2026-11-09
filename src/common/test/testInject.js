if (!Zotero.isDebug) {
	throw new Error('This file should only be loaded in debug mode');
}

window.addEventListener('message', async (event) => {
	if (event.data.type === 'zotero-test-exec') {
		let { fnName, args, id } = event.data;
		Zotero.debug(`Executing ${fnName}(${args.join(', ')}), ${id}`);
		let fnPath = fnName.split('.');
		let fn = globalThis;
		for (let name of fnPath) {
			fn = fn[name];
		}
		args.forEach((arg, index) => {
			if (arg === '__function') {
				args[index] = (v) => {
					Zotero.debug(`${fnName} Invoking callback ${index} with ${v}`);
					window.postMessage({ type: 'zotero-test-callback', result: v, id, index }, '*');
				}
			}
		});
		let result = await Promise.resolve(fn(...args));
		Zotero.debug(`${fnName} Invoking callback ${-1} with ${result}`);
		window.postMessage({ type: 'zotero-test-callback', result, id, index: -1 }, '*');
	}
});