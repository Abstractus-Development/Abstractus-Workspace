const SITE_ACCESS_LIMIT_TRANSLATORS = new Set([
	"57a00950-f0d1-4b41-b6ba-44ff0fc30289"
]);

function determineAttachmentIcon(attachment) {
	if(attachment.linkMode === "linked_url") {
		return Zotero.ItemTypes.getImageSrc("attachment-web-link");
	}
	var contentType = attachment.contentType || attachment.mimeType;
	return Zotero.ItemTypes.getImageSrc(
		contentType === "application/pdf" ? "attachment-pdf" : "attachment-snapshot"
	);
}

function determineAttachmentType(attachment) {
	if (attachment.linkMode === "linked_url") return Zotero.getString("itemType_link");
	var contentType = attachment.contentType || attachment.mimeType;
	if (contentType == "application/pdf") return Zotero.getString("itemType_pdf");
	if (contentType == "application/epub+zip") return Zotero.getString("itemType_epub");
	if (contentType == "text/html") return Zotero.getString("itemType_snapshot");
	return Zotero.getString("itemType_attachment");
}

let PageSaving = {
	sessionDetails: {},
	translators: [],
	
	async _initTranslate(itemType=null) {
		let translate;
		if (Zotero.isManifestV3) {
			try {
				translate = await Zotero.VirtualOffscreenTranslate.create();
			} catch (e) {
				Zotero.logError(new Error(`Inject: Initializing translate failed at ${document.location.href}`));
				Zotero.logError(e);
				throw e;
			}
		}
		else {
			translate = new Zotero.Translate.Web();
		}
		translate.setHandler('pageModified', () => {
			Zotero.Messaging.sendMessage("pageModified", true);
		});
		if (Zotero.isManifestV3) {
			await translate.setDocument(document, itemType === 'multiple');
		}
		else {
			translate.setDocument(document);
		}
		return translate;
	},

	async onPageLoad(force) {
		if (document.location == "about:blank") return;

		this.sessionDetails = {};

		try {
			if (this.translators.length) {
				if (force) {
					this.translators = [];
				}
				else {
					return;
				}
			}

			let translate = await this._initTranslate();
			let translators = await Zotero.TranslateWeb.detect({ translate });
			this.translators = translators;
			Zotero.Connector_Browser.onTranslators(translators, instanceID, document.contentType);
		} catch (e) {
			Zotero.logError(e);
		}
	},

	_initSession(translatorID, saveOptions) {
		if (!saveOptions.resave && this.sessionDetails.id) {
			return this.sessionDetails.id;
		}
		const sessionID = Zotero.Utilities.randomString();
		this.sessionDetails = {
			id: sessionID,
			url: document.location.href,
			translatorID,
			saveOptions
		};
		return sessionID;
	},

	_clearSession() {
		this.sessionDetails = {};
	},

	_shouldReopenProgressWindow(translatorID, options, itemType=null) {
		return this.sessionDetails.id
			&& document.location.href == this.sessionDetails.url
			&& translatorID == this.sessionDetails.translatorID
			&& itemType != 'multiple'
			&& !options.note
			&& !options.resave
	},

	_processNote(items) {
		const saveOptions = this.sessionDetails.saveOptions;
		if (saveOptions && saveOptions.note && items.length == 1) {
			if (items[0].notes) {
				items[0].notes.push({note: saveOptions.note})
			} else {
				items[0].notes = {note: saveOptions.note};
			}
		}
		return items;
	},
	
	_onAttachmentProgress(attachment, progress) {
		const sessionID = PageSaving.sessionDetails.id;
		Zotero.Messaging.sendMessage(
			"progressWindow.itemProgress",
			{
				sessionID,
				id: attachment.id,
				iconSrc: determineAttachmentIcon(attachment),
				title: attachment.title,
				parentItem: attachment.parentItem,
				progress,
				itemType: determineAttachmentType(attachment)
			}
		);
	},

	async translateAndSave(translators, fallbackOnFailure = false) {
		const sessionID = this.sessionDetails.id;
		let itemsTotal = 0;
		let itemsSaved = 0;
		
		const onSelect = (obj, items, callback) => {
			Zotero.Messaging.sendMessage("progressWindow.close", null);

			(async () => {
				var returnItems = await Zotero.Connector_Browser.onSelect(items);

				if (returnItems && !Zotero.Utilities.isEmpty(returnItems)) {
					let sessionID = this.sessionDetails.id;
					itemsTotal = Object.keys(returnItems).length;
					itemsSaved = 0;
					Zotero.Messaging.sendMessage("progressWindow.show", [sessionID]);
				}
				callback(returnItems);
			})();
		};
		const onItemSaving = (obj, item) => {
			itemsSaved += 1;
			Zotero.Messaging.sendMessage(
				"progressWindow.itemProgress",
				{
					sessionID,
					id: item.id,
					iconSrc: Zotero.ItemTypes.getImageSrc(item.itemType),
					title: item.title,
					itemsLoaded: itemsSaved >= itemsTotal ? itemsSaved : false,
					itemType: item.itemType
				}
			);
		};
		const onTranslatorFallback = (oldTranslator, newTranslator) => {
			Zotero.debug(`Saving with ${oldTranslator.label} failed. Trying ${newTranslator.label}`);
			Zotero.Messaging.sendMessage("progressWindow.error",
				['fallback', oldTranslator.label, newTranslator.label]);
		}
		
		const onItemsSaved = () => {
			for (let item of items) {
				Zotero.Messaging.sendMessage(
					"progressWindow.itemProgress",
					{
						sessionID,
						id: item.id,
						iconSrc: Zotero.ItemTypes.getImageSrc(item.itemType),
						title: item.title,
						progress: 100,
						itemsLoaded: items.length,
						itemType: item.itemType
					}
				);
				
				if (item.notes) {
					for (let note of item.notes) {
						Zotero.Messaging.sendMessage(
							'progressWindow.itemProgress',
							{
								sessionID,
								id: null,
								iconSrc: Zotero.getExtensionURL("images/treeitem-note.png"),
								title: Zotero.Utilities.cleanTags(note.note),
								parentItem: item.id,
								progress: 100,
								itemType: Zotero.getString("itemType_note")
							}
						)
					}
				}
			}
		}

		let translate = await this._initTranslate(translators[0].itemType);
		let options = { translate, translators: translators.slice(), onSelect, onItemSaving, onTranslatorFallback };
		try {
			var { items, proxy } = await Zotero.TranslateWeb.translate(options);
		} catch (e) {
			if (translators[0].itemType != 'multiple' && fallbackOnFailure) {
				Zotero.Messaging.sendMessage("progressWindow.error", ['fallback', this.translators.at(-1).label, Zotero.getString('progressWindow_saveAsWebpage')]);
				Zotero.debug(`Saving with ${translators[0].label} failed. Falling back to saving as webpage`);
				return this.saveAsWebpage({ snapshot: true });
			}
			throw e;
		}
		if (Zotero.isManifestV3) {
			proxy = await translate.getProxy();
			if (proxy) proxy = new Zotero.Proxy(proxy);
		}
		items = this._processNote(items);
		this.sessionDetails.items = items;
		let itemType = translators[0].itemType;
		let itemSaver = new Zotero.ItemSaver({ sessionID, itemType, baseURI: document.location.href, proxy });
		this.sessionDetails.itemSaver = itemSaver;
		return itemSaver.saveItems(items, PageSaving._onAttachmentProgress, onItemsSaved)
	},

	async saveAsWebpage({ title=document.title, snapshot: saveSnapshot=true } = {}) {
		var result = await Zotero.Inject.checkClientAvailable();
		if (!result) return;

		var isTextLike = document.contentType.startsWith('text')
			|| document.contentType.includes('html');
		if (!isTextLike) {
			return await this._saveAsStandaloneAttachment({title, saveSnapshot});
		}
		return await this._saveAsWebpage({title, saveSnapshot});
	},
	
	async _saveAsWebpage({ title, saveSnapshot } = {}) {
		const sessionID = this.sessionDetails.id;
		var translatorID = 'webpage' + (saveSnapshot ? 'WithSnapshot' : '');
		var data = {
			sessionID,
			url: document.location.toString(),
			referrer: document.referrer,
			title: title,
		};

		var image;
		if (document.contentType == 'application/pdf') {
			data.pdf = true;
			image = "attachment-pdf";
		} else {
			image = "webpage";
		}

		Zotero.Messaging.sendMessage("progressWindow.show", [sessionID]);
		let items = [{
			sessionID,
			id: 1,
			iconSrc: Zotero.ItemTypes.getImageSrc(image),
			title: title
		}];
		this.sessionDetails.items = items;
		Zotero.Messaging.sendMessage("progressWindow.itemProgress", items[0]);

		try {
			var result = await Zotero.Connector.callMethod("saveSnapshot", data);
			Zotero.Messaging.sendMessage("progressWindow.sessionCreated", { sessionID });
			items[0] = { ...items[0], progress: 100, itemsLoaded: 1 };
			Zotero.Messaging.sendMessage("progressWindow.itemProgress", items[0]);

			if (saveSnapshot && await Zotero.Connector.getPref('automaticSnapshots')) {
				await this._saveSingleFile(items[0], data);
			}

			Zotero.Messaging.sendMessage("progressWindow.done", [true]);
			Object.assign(this.sessionDetails, {
				id: sessionID,
				url: document.location.href,
				translatorID
			});
			return result;
		} catch (e) {
			if (e.status === 0) {
				Zotero.Messaging.sendMessage("progressWindow.done", [false, 'clientRequired']);
			}
			else if (!e.value || e.value.libraryEditable != false) {
				Zotero.Messaging.sendMessage("progressWindow.done", [false, 'unexpectedError']);
			}
			throw e;
		}
	},

	async _saveSingleFile(item, data) {
		let isSingleFileAvailable = document.contentType.startsWith("text")
			|| document.contentType.includes("html");
		if (isSingleFileAvailable) {
			item.attachments = [{
				sessionID: data.sessionID,
				id: 2,
				iconSrc: Zotero.ItemTypes.getImageSrc("attachment-snapshot"),
				title: Zotero.getString('itemType_snapshot'),
				parentItem: 1,
				parentKey: item.key,
				progress: 0,
				itemType: Zotero.getString("itemType_snapshot"),
				mimeType: "text/html",
				linkMode: "imported_url",
				itemsLoaded: 1
			}]
			let snapshotItem = item.attachments[0];

			Zotero.Messaging.sendMessage("progressWindow.itemProgress", snapshotItem);

			try {
				data.snapshotContent = await Zotero.SingleFile.retrievePageData();
				await Zotero.Connector.saveSingleFile({
						method: "saveSingleFile",
						headers: {"Content-Type": "application/json"}
					},
					data
				);

				Zotero.Messaging.sendMessage("progressWindow.itemProgress", { ...snapshotItem, progress: 100 });
			}
			catch (e) {
				Zotero.logError(e);
				Zotero.Messaging.sendMessage("progressWindow.itemProgress", { ...snapshotItem, progress: false });
			}
		}
	},

	async _saveAsStandaloneAttachment({ title=document.title } = {}) {
		const sessionID = this.sessionDetails.id;
		if (!title) {
			title = new URL(document.location.href).pathname.split('/').pop();
		}
		let itemType = "webpage";
		if (document.contentType === 'application/pdf') {
			itemType = "pdf"
		}
		else if (document.contentType === 'application/epub+zip') {
			itemType = "epub";
		}

		let progressItem = {
			sessionID,
			id: 1,
			iconSrc: Zotero.ItemTypes.getImageSrc(`attachment-${itemType}`),
			title,
			progress: 0,
			itemType: Zotero.getString(`itemType_${itemType}`),
		};

		Zotero.Messaging.sendMessage("progressWindow.show", [sessionID, null, false, true]);
		Zotero.Messaging.sendMessage(
			"progressWindow.itemProgress",
			progressItem
		);

		let standaloneAttachment = {
			url: document.location.toString(),
			mimeType: document.contentType,
			title,
			linkMode: "imported_url",
			referrer: document.referrer
		}

		try {
			await Zotero.ItemSaver.fetchAttachmentSafari(standaloneAttachment);
			let { canRecognize } = await Zotero.ItemSaver.saveStandaloneAttachmentToZotero(standaloneAttachment, sessionID)
			Zotero.Messaging.sendMessage("progressWindow.sessionCreated", { sessionID });
			progressItem.progress = 100;
			Zotero.Messaging.sendMessage("progressWindow.itemProgress", { ...progressItem, ...{ progress: 100 } });

			if (canRecognize) {
				let item = await Zotero.Connector.callMethod("getRecognizedItem", { sessionID: sessionID });
				if (item) {
					item.id = 2;
					item.iconSrc = Zotero.ItemTypes.getImageSrc(item.itemType);
					progressItem.parentItem = 2;
					Zotero.Messaging.sendMessage("progressWindow.itemProgress", { ...item, ...{ progress: 100 } });
					setTimeout(() => {
						Zotero.Messaging.sendMessage("progressWindow.itemProgress", { ...progressItem, ...{ progress: 100 } });
					}, 50);
				}
			}

			Zotero.Messaging.sendMessage("progressWindow.done", [true]);
			Object.assign(this.sessionDetails, {
				id: sessionID,
				url: document.location.href,
			});
		} catch (e) {
			Zotero.Messaging.sendMessage("progressWindow.itemProgress", { ...progressItem, ...{ progress: false } });
			if (e.status === 0) {
				Zotero.Messaging.sendMessage("progressWindow.done", [false, 'clientRequired']);
			}
			else if (!e.value || e.value.libraryEditable != false) {
				Zotero.Messaging.sendMessage("progressWindow.done", [false, 'unexpectedError']);
			}
			throw e;
		}
	},

	async onTranslate(translatorID, options={}) {
		let result = await Zotero.Inject.checkClientAvailable();
		if (!result) return;
		let translatorIndex = this.translators.findIndex(t => t.translatorID === translatorID);
		let translator = this.translators[translatorIndex];
		Zotero.debug(`PageSaving.onTranslate: Translating with ${translator.label}, ${JSON.stringify(options)}`);
		
		if (this.sessionDetails.translatorID && translatorID != this.sessionDetails.translatorID) {
			options.resave = true;
		}
		
		if (this._shouldReopenProgressWindow(translatorID, options, translator.itemType)) {
			Zotero.debug(`PageSaving.onTranslate: Reopening popup`);
			return Zotero.Messaging.sendMessage("progressWindow.show", [this.sessionDetails.id]);
		}

		if (translator.itemType === 'multiple' && this.sessionDetails.id && !options.resave) {
			options.resave = true;
		}

		const sessionID = this._initSession(translatorID, options);

		let delay = translator.itemType == 'multiple' ? 100 : 0;
		let sendShowMessage = () => {
			Zotero.Messaging.sendMessage(
				"progressWindow.show",
				[
					sessionID,
					null,
					false,
				]
			);
		}
		if (delay) {
			setTimeout(sendShowMessage, delay)
		}
		else {
			sendShowMessage();
		}
		
		try {
			let translators = this.translators.slice(translatorIndex);
			if (!options.fallbackOnFailure) {
				translators = translators.slice(0, 1)
			}
			let items = await this.translateAndSave(translators, options.fallbackOnFailure);
			Zotero.Messaging.sendMessage("progressWindow.done", [true]);
			return items;
		} catch (e) {
			Zotero.logError(e);
			this._clearSession();
			await Zotero.Promise.delay(500);
			const isAccessLimitingTranslator = SITE_ACCESS_LIMIT_TRANSLATORS.has(translator.translatorID);
			const errorMessage = e.toString();
			let statusCode = '';
			try {
				statusCode = errorMessage.match(/status code ([0-9]{3})/)[1];
			} catch (e) {}
			const isHTTPErrorForbidden = statusCode == '403';
			const isHTTPErrorTooManyRequests = statusCode == '429';
			if ((isAccessLimitingTranslator && isHTTPErrorForbidden) || isHTTPErrorTooManyRequests) {
				Zotero.Messaging.sendMessage("progressWindow.done", [false, 'siteAccessLimits', translator.label]);
			}
			else {
				Zotero.Messaging.sendMessage("progressWindow.done", [false]);
			}
		}
	},

	async onSaveAsWebpage([ title=document.title, options={} ]) {
		var result = await Zotero.Inject.checkClientAvailable();
		if (!result) return;

		Zotero.debug(`PageSaving.onSaveAsWebpage: Saving webpage, ${JSON.stringify(options)}`);

		var translatorID = 'webpage' + (options.snapshot ? 'WithSnapshot' : '');
		options.snapshot = !!options.snapshot;
		if (this.sessionDetails.translatorID && translatorID != this.sessionDetails.translatorID) {
			options.resave = true;
		}
		
		if (this._shouldReopenProgressWindow(translatorID, options)) {
			Zotero.debug(`PageSaving.onSaveAsWebpage: Reopening popup`);
			return Zotero.Messaging.sendMessage("progressWindow.show", [this.sessionDetails.id]);
		}
		
		var sessionID = this._initSession(translatorID, options);
		return await this.saveAsWebpage({sessionID, title, snapshot: options.snapshot, resave: options.resave});
	},

	async onUpdateSession(data) {
		if (!this.sessionDetails.id) return;
		await Zotero.Connector.callMethod(
			"updateSession",
			{
				sessionID: this.sessionDetails.id,
				target: data.target,
				tags: data.tags,
				note: data.note
			}
		);

		if (data.resaveAttachments && this.sessionDetails.itemSaver) {
			Zotero.Messaging.sendMessage("progressWindow.show", [this.sessionDetails.id]);
			await this.sessionDetails.itemSaver.saveAttachmentsToZotero(
				PageSaving._onAttachmentProgress
			);
			Zotero.Messaging.sendMessage("progressWindow.done", [true]);
		}
		else if (data.removeAttachments) {
			for (let item of this.sessionDetails.items) {
				for (let attachment of item.attachments) {
					Zotero.Messaging.sendMessage(
						"progressWindow.itemProgress",
						{
							sessionID: this.sessionDetails.id,
							id: attachment.id,
							progress: -1,
						}
					);
				}
			}
		}
	}
}

Zotero.PageSaving = PageSaving;
