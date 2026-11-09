(function() {

var isTopWindow = false;
if(window.top) {
	try {
		isTopWindow = window.top == window;
	} catch(e) {};
}

if (isTopWindow) {
	var frameID = 'zotero-progress-window-frame';
	var closeOnLeave = false;
	var lastSuccessfulTarget;
	var frameReadyDeferred = Zotero.Promise.defer();
	var frameInitialized;
	var closeTimeoutID;
	window.Zotero.progressWindowReady = frameReadyDeferred.promise;
	
	var currentSessionID;
	var createdSessions = new Set();
	var updatingSession;
	var nextSessionUpdateData;
	
	var isReadOnly = false;
	var isFilesEditable = false;
	var syncDelayIntervalID;
	var insideIframe = false;
	var closeTimerDisabled = false;
	var blurred = false;
	var frameSrc;
	var frameIsHidden = false;
	frameSrc = Zotero.getExtensionURL('progressWindow/progressWindow.html');
	var scrollX;
	var scrollY;
	var zoteroFrame;
	
	async function sendMessageToFrame(name, data = {}) {
		return Zotero.Messaging.sendToZoteroFrames(name, data);
	}

	function addMessageListener(name, handler) {
		return Zotero.Messaging.addMessageListener(name, handler);
	}
	
	function addEvent(name, data) {
		frameReadyDeferred.promise.then(function() {
			sendMessageToFrame(`progressWindowIframe.${name}`, data);
		});
	}
	
	function changeHeadline() {
		isReadOnly = arguments.length <= 2;
		addEvent("changeHeadline", Array.from(arguments));
	}
	
	function makeReadOnly() {
		isReadOnly = true;
		addEvent("makeReadOnly", [lastSuccessfulTarget]);
	}
	
	async function updateFromClient(prefix, retryOnReadOnly = true) {
		try {
			var response = await Zotero.Connector.callMethod("getSelectedCollection", { switchToReadableLibrary: true })
		}
		catch (e) {
			changeHeadline(Zotero.getString('general_saveTo', ZOTERO_CONFIG.CLIENT_NAME));
			return;
		}
		
		if (lastSuccessfulTarget) {
			response.id = lastSuccessfulTarget.id;
			response.name = lastSuccessfulTarget.name;
			response.libraryEditable = true;
		}
		
		if (response.libraryEditable === false) {
			if (retryOnReadOnly) {
				setTimeout(() => updateFromClient(prefix, false), 250);
			}
			return;
		}
		
		var id;
		if (!response.id) {
			id = "L" + response.libraryID;
		}
		else if (typeof response.id != 'string') {
			id = "C" + response.id;
		}
		else {
			id = response.id;
		}
		
		if (!prefix) {
			prefix = Zotero.getString('progressWindow_savingTo');
		}
		var target = {
			id,
			name: response.name,
			filesEditable: response.filesEditable
		};
		
		if (response.libraryEditable) {
			lastSuccessfulTarget = target;
		}
		
		let targets = response.targets.filter(t => !isFilesEditable || t.filesEditable);

		if (response.targets) {
			for (let row of response.targets) {
				if (!row.level) {
					row.level = 0;
				}
			}
		}
		
		let tags = {};
		Object.entries(response.tags || []).forEach(([libraryID, tagArr]) => {
			tags[libraryID] = [...new Set(tagArr.map(item => item.tag))];
		});

		changeHeadline(prefix, target, targets, tags);
	}
	
	async function addError() {
		await showFrame();
		addEvent("addError", Array.from(arguments));
	}
	
	function hideFrame() {
		insideIframe = false;
		
		var frame = zoteroFrame?.frame;
		if (frame) {
			frame.style.display = 'none';
			addEvent("hidden");
		}
		
		if (syncDelayIntervalID) {
			clearInterval(syncDelayIntervalID);
		}
	}
	
	function resetFrame() {
		stopCloseTimer();
		addEvent('reset');
	}
	
	async function destroyFrame() {
		stopCloseTimer();
		await frameReadyDeferred.promise;
		zoteroFrame.remove();
		zoteroFrame = null;
		frameReadyDeferred = Zotero.Promise.defer();
	}
	
	function handleMouseEnter() {
		insideIframe = true;
		blurred = false;
		stopCloseTimer();
		
		scrollX = window.scrollX;
		scrollY = window.scrollY;
	}
	
	function handleMouseLeave() {
		insideIframe = false;
		if (closeOnLeave) {
			startCloseTimer(closeOnLeave);
		}
	}
	
	function startCloseTimer(delay) {
		if (insideIframe) return;
		if (closeTimerDisabled) return;
		
		if (!delay) delay = 5000;
		stopCloseTimer();
		closeTimeoutID = setTimeout(hideFrame, delay);
	}
	
	function stopCloseTimer() {
		if (closeTimeoutID) {
			clearTimeout(closeTimeoutID);
		}
	}
	
	async function initFrame() {
		zoteroFrame = new Zotero.Frame({
			id: frameID,
			src: Zotero.Utilities.Connector.themedFrameURL(frameSrc, document),
			title: Zotero.getString('general_saveTo', ZOTERO_CONFIG.CLIENT_NAME),
			'data-single-file-hidden-frame': ''
		}, {
			position: 'fixed',
			top: '15px',
			left: 'unset',
			right: '8px',
			width: '400px',
			maxWidth: '95%',
			height: '120px',
			border: "none",
			padding: "none",
			margin: "initial",
			zIndex: 2147483647,
			display: 'none',
			maxHeight: '90vh' 
		});
		var iframe = zoteroFrame.frame;
	
		var lastClick;
		window.addEventListener('click', function () {
			lastClick = new Date();
		}, true);
		
		
		document.addEventListener('scroll', function (event) {
			if (insideIframe) {
				window.scrollTo(scrollX, scrollY);
			}
		});
		
		addMessageListener('progressWindowIframe.registered', function() {
			frameReadyDeferred.resolve(iframe);
		});
		
		addMessageListener('progressWindowIframe.resized', function(data) {
			iframe.style.height = (data.height + 33) + "px";
		});
		
		var handleUpdated = async function (data) {
			stopCloseTimer();
			blurred = false;
			
			if (!createdSessions.has(currentSessionID) || updatingSession) {
				nextSessionUpdateData = data;
				return;
			}
			updatingSession = true;
			
			try {
				await Zotero.Messaging.sendMessage(
					"updateSession",
					{
						target: data.target.id,
						tags: data.tags,
						note: data.note.replace(/\n/g, "<br>"),
						resaveAttachments: !lastSuccessfulTarget.filesEditable && data.target.filesEditable,
						removeAttachments: lastSuccessfulTarget.filesEditable && !data.target.filesEditable
					},
					null,
					null
				);
			}
			catch (e) {
				makeReadOnly();
				throw e;
			}
			finally {
				updatingSession = false;
			}
			
			if (nextSessionUpdateData) {
				data = nextSessionUpdateData;
				nextSessionUpdateData = null;
				return handleUpdated(data);
			}
			
			lastSuccessfulTarget = data.target;
		};
		
		Zotero.Messaging.addMessageListener('progressWindow.sessionCreated', async function (args) {
			var sessionID = args.sessionID;
			createdSessions.add(sessionID);
			if (nextSessionUpdateData) {
				let data = nextSessionUpdateData;
				nextSessionUpdateData = null;
				handleUpdated(data)
			}
		});
		
		addMessageListener('progressWindowIframe.updated', handleUpdated);
		
		addMessageListener('progressWindowIframe.mouseenter', handleMouseEnter);
		addMessageListener('progressWindowIframe.mouseleave', handleMouseLeave);
		
		addMessageListener('progressWindowIframe.disableCloseTimer', () => closeTimerDisabled = true);
		addMessageListener('progressWindowIframe.enableCloseTimer', () => closeTimerDisabled = false);
		
		addMessageListener('progressWindowIframe.blurred', async function() {
			blurred = true;
			
			await Zotero.Promise.delay(150);
			if (lastClick > new Date() - 500) {
				hideFrame();
			}
		});
		
		addMessageListener('progressWindowIframe.close', function() {
			hideFrame();
			window.focus();
		});

		await frameReadyDeferred.promise;
		return iframe;
	}

	async function showFrame() {
		let iframe
		if (!frameInitialized) {
			frameInitialized = true;
			iframe = await initFrame();
		} else {
			iframe = await frameReadyDeferred.promise;
		}
		if (!frameIsHidden) {
			addEvent('shown');
			iframe.style.display = 'block';
		}
		
		if (syncDelayIntervalID) {
			clearInterval(syncDelayIntervalID);
		}
		syncDelayIntervalID = setInterval(() => {
			if (isReadOnly || document.hidden || blurred) return;
			
			Zotero.Connector.callMethod("delaySync", {});
		}, 7500);
		
		return iframe;
	}
	
	Zotero.Messaging.addMessageListener("progressWindow.show", async function (args) {
		frameIsHidden = false;
		
		var [sessionID, headline, readOnly, filesEditable] = args;
		if (typeof filesEditable != "undefined") {
			isFilesEditable = filesEditable;
		}
		
		if (currentSessionID) {
			if (currentSessionID != sessionID) {
				resetFrame();
				closeOnLeave = false;
				lastSuccessfulTarget = null;
			}
		}
		currentSessionID = sessionID;
		
		await showFrame();
		
		if (readOnly) {
			changeHeadline(headline);
		}
		else {
			await updateFromClient(headline);
		}
		
		return true;
	});
	
	Zotero.Messaging.addMessageListener("progressWindow.itemProgress", (data) => {
		if (data.sessionID && data.sessionID != currentSessionID) return;
		addEvent("updateProgress", [data.id, data]);
	});
	
	Zotero.Messaging.addMessageListener("progressWindow.close", function () {
		frameIsHidden = true;
		
		hideFrame();
	});
	
	Zotero.Messaging.addMessageListener("progressWindow.setSession", function (sessionID) {
		currentSessionID = sessionID;
	});

	Zotero.Messaging.addMessageListener("progressWindow.reopen", function () {
		showFrame();
	});
	
	Zotero.Messaging.addMessageListener("progressWindow.done", async (returnValue) => {
		const isTabFocused = await Zotero.Connector_Browser.isTabFocused();
		if (!isTabFocused) {
			closeOnLeave = 8000;
			return;
		}
		closeOnLeave = 2500;
		if (document.location.href.startsWith(Zotero.getExtensionURL('confirm/confirm.html'))) {
			return;
		}
		if (returnValue[0]) {
			startCloseTimer(3000);
			addEvent("willHide");
		}
		else {
			if (returnValue.length < 2) {
				returnValue.push('translationError');
			}
			addError(returnValue[1], ...returnValue.slice(2));
			startCloseTimer(8000);
		}
	});
	
	Zotero.Messaging.addMessageListener("progressWindow.error", (args) => {
		addError(args.shift(), ...args);
	})
}

})();
