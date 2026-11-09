window.onload = async function () {
	Zotero.Messaging.addMessageListener('modalPrompt.show', async function(props) {
		window.focus();
		var deferred = Zotero.Promise.defer();
		let div = document.querySelector('#zotero-modal-prompt');
		let prompt = (
			<Zotero.UI.ModalPrompt onClose={onClose} {...props}/>
		);
		function onClose(state, event) {
			deferred.resolve({
				button: event ? parseInt(event.target.name || 0) : 0,
				checkboxChecked: state.checkboxChecked,
				inputText: state.inputText
			});
			ReactDOM.unmountComponentAtNode(div);
			Zotero.Messaging.sendMessage('modalPrompt.close', null);
		}
		ReactDOM.render(prompt, div);
		document.body.appendChild(div);
		return await deferred.promise;
	});

	Zotero.isInject = true;
	Zotero.initDeferred.resolve();
	
	await Zotero.Messaging.init();
	Zotero.Messaging.sendMessage('modalPrompt.init', null);
};
