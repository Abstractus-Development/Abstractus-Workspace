const PRIMARY_ATTACHMENT_TYPES = new Set([
	'application/pdf',
	'application/epub+zip',
]);

let ItemSaver = function(options) {
	this.newItems = [];
	this._sessionID = options.sessionID;
	this._proxy = options.proxy;
	this._baseURI = options.baseURI;
	this._itemType = options.itemType;
	this._items = [];
	this._singleFile = false;
	
	if(Zotero.Messaging && !ItemSaver._attachmentCallbackListenerAdded
			&& Zotero.isSafari) {
		Zotero.Messaging.addMessageListener("attachmentCallback", function(data) {
			var id = data[0],
				status = data[1];
			var callback = ItemSaver._attachmentCallbacks[id];
			if(callback) {
				if(status === false || status === 100) {
					delete ItemSaver._attachmentCallbacks[id];
				} else {
					data[1] = 50+data[1]/2;
				}
				callback(data[1], data[2]);
			}
		});
		ItemSaver._attachmentCallbackListenerAdded = true;
	}
}
ItemSaver._attachmentCallbackListenerAdded = false;
ItemSaver._attachmentCallbacks = {};

ItemSaver.prototype = {
	saveAsWebpage: function(doc) {
		var doc = doc || document;
		var item = {
			itemType: 'webpage',
			title: doc.title,
			url: doc.location.href,
			attachments: [],
			accessDate: Zotero.Date.dateToSQL(new Date(), true)
		};
		return this.saveItems([item]);
	},

	saveItems: async function (items, attachmentCallback, itemsDoneCallback=()=>0) {
		Zotero.debug(`ItemSaver.saveItems: Saving ${items.length} items`);
		return this._saveToZotero(items, attachmentCallback, itemsDoneCallback);
	},
	
	_saveToZotero: async function (items, attachmentCallback, itemsDoneCallback=()=>0) {
		this._items = items;
		var payload = {
			sessionID: this._sessionID,
			uri: this._baseURI,
		};
		const automaticSnapshots = await Zotero.Connector.getPref('automaticSnapshots');
		const downloadAssociatedFiles = await Zotero.Connector.getPref('downloadAssociatedFiles');

		payload.proxy = this._proxy && this._proxy.toJSON();

		if (items.length === 1 && document.contentType === 'application/pdf') {
			items[0].attachments = items[0].attachments.filter(attachment => attachment.mimeType !== 'application/pdf');
			items[0].attachments.push({
				title: 'Full Text PDF',
				url: document.location.href,
				mimeType: document.contentType,
				referrer: new URL(document.location.href).origin,
			})
		}

		this._singleFile = false;

		for (let item of items) {
			item.id = item.id || Zotero.Utilities.randomString(8);
			
			item.attachments = item.attachments.filter((attachment) => {
				if (!attachment.title) attachment.title = attachment.mimeType + ' Attachment';
				attachment.id = attachment.id || Zotero.Utilities.randomString(8);
				attachment.parentItem = item.id;
				this._setAttachmentReferer(attachment);

				if (attachment.snapshot === false) {
					return true;
				}
				if (attachment.mimeType === 'text/html' && !automaticSnapshots) {
					Zotero.debug("saveToZotero: Ignoring snapshot because automaticSnapshots is disabled");
					return false;
				}
				else if (attachment.mimeType !== 'text/html' && !downloadAssociatedFiles) {
					Zotero.debug(`saveToZotero: Ignoring attachment with type ${attachment.mimeType} because downloadAssociatedFiles is disabled`);
					return false;
				}
			
				if (attachment.mimeType === 'text/html') {
					if (this._itemType === "multiple") {
						Zotero.debug("saveToZotero: Ignoring snapshot of text/html attachment for multiple-item save");
						return false;
					}

					this._snapshotAttachment = attachment;
					this._singleFile = true;
					return false;
				}
				
				return true;
			});
		}
		
		payload.items = Zotero.Utilities.deepCopy(items);

		for (let item of payload.items) {
			item.attachments = item.attachments.filter((attachment) => {
				return attachment.snapshot === false
			});
			try {
				item.csl = Zotero.Utilities.Item.itemToCSLJSON(item);
			}
			catch (e) {
				Zotero.debug(`ItemSaver: CSL-JSON conversion failed: ${e}`);
			}
		}
		
		await Zotero.Connector.callMethod("saveItems", payload)
		itemsDoneCallback(items);

		Zotero.debug("Translate: Save via Zotero succeeded");
		Zotero.Messaging.sendMessage("progressWindow.sessionCreated", { sessionID: this._sessionID });
		
		const response = await Zotero.Connector.callMethod("getSelectedCollection", {})
		if (response.filesEditable) {
			await this.saveAttachmentsToZotero(attachmentCallback);
		}

		return items;
	},
	
	async saveAttachmentsToZotero(attachmentCallback) {
		let promises = []

		Zotero.debug(`ItemSaver.saveAttachmentsToZotero: Saving attachments directly to Zotero`);
		
		promises.push(this._saveAttachmentsToZotero(attachmentCallback))
		
		if (this._singleFile) {
			promises.push(this._executeSingleFile(attachmentCallback));
		}
		await Promise.all(promises);
	},
	
	_executeSingleFile: async function(attachmentCallback) {
		try {
			attachmentCallback(this._snapshotAttachment, 0);
			let data = { items: this._items, sessionID: this._sessionID };
			data.snapshotContent = await Zotero.SingleFile.retrievePageData();
			data.url = this._items[0].url || document.location.href;
			data.title = this._snapshotAttachment.title;
			await Zotero.Connector.saveSingleFile({
					method: "saveSingleFile",
					headers: {"Content-Type": "application/json"}
				},
				data
			);
			attachmentCallback(this._snapshotAttachment, 100);
		}
		catch (e) {
			Zotero.logError(e);
			attachmentCallback(this._snapshotAttachment, false, e.message)
		}
	},
	
	async _saveAttachmentsToZotero(attachmentCallback) {
		const shouldAttemptToDownloadOAAttachments = await Zotero.Connector.getPref('downloadAssociatedFiles')
		for (let item of this._items) {
			item.hasPrimaryAttachment = false;
			for (let attachment of item.attachments) {
				if (attachment.snapshot === false) {
					attachmentCallback(attachment, 100);
					continue;
				}

				attachmentCallback(attachment, 0);
				if (attachment.isOpenAccess) continue;
				try {
					Zotero.debug(`ItemSaver.saveAttachmentsToZotero: Saving attachment ${attachment.url} of mimeType ${attachment.mimeType}`);
					if (PRIMARY_ATTACHMENT_TYPES.has(attachment.mimeType)) {
						attachment.isPrimary = true;
					}
					Zotero.Messaging.addMessageListener("passJSBotDetectionViaHiddenIframe", this._passJSBotDetectionViaHiddenIframe);
					await ItemSaver.fetchAttachmentSafari(attachment);
					await Zotero.ItemSaver.saveAttachmentToZotero(attachment, this._sessionID)
					if (attachment.isPrimary) {
						item.hasPrimaryAttachment = true;
					}
					attachmentCallback(attachment, 100);
				}
				catch (e) {
					Zotero.debug(`ItemSaver.saveAttachmentsToZotero: Failed to save attachment ${attachment.url}: ${e}`);
					if (attachment.isPrimary && shouldAttemptToDownloadOAAttachments) {
						attachmentCallback(attachment, 0);
					}
					else {
						attachmentCallback(attachment, false, e);
						Zotero.logError(e);
					}
				}
			}
			if (!item.hasPrimaryAttachment) {
				if (!shouldAttemptToDownloadOAAttachments) continue;
				await this.saveAttachmentFromResolver(item, attachmentCallback);
			}
		}
	},
	
	async saveAttachmentFromResolver(item, attachmentCallback) {
		let attachment = item.attachments.find(a => a.isPrimary);
		try {
			if (typeof item.hasAttachmentResolvers === "undefined") {
				item.hasAttachmentResolvers = await Zotero.Connector.callMethod('hasAttachmentResolvers', {
					sessionID: this._sessionID,
					itemID: item.id
				});
			}
			if (!item.hasAttachmentResolvers) {
				if (attachment) {
					attachmentCallback(attachment, false, "PDF fetch failed and no resolvers found");
				}
				return;
			}
			
			let title = await Zotero.Connector.callMethod('saveAttachmentFromResolver', {
				sessionID: this._sessionID,
				itemID: item.id,
			});

			if (!attachment) {
				attachment = {
					id: Zotero.Utilities.randomString(),
					parentItem: item.id,
					title: title,
					mimeType: 'application/pdf',
					isPrimary: true,
					isOpenAccess: true,
				};
				item.attachments.push(attachment);
			}
			else {
				attachment = Object.assign(attachment, {
					title,
					isOpenAccess: true,
				});
			}
			attachmentCallback(attachment, 100);
		} catch (e) {
			if (attachment) {
				attachmentCallback(attachment, false, e);
				Zotero.logError(e);
			}
		}
	},
	
	_urlMatchesLocation: function(attachmentURL) {
		if (attachmentURL === this._baseURI) {
			return true;
		}
		const url = new URL(attachmentURL);
		const targetUrl = new URL(this._baseURI);
		if (url.protocol + url.host + url.pathname === targetUrl.protocol + targetUrl.host
				+ targetUrl.pathname) {
			for (const [param, value] of url.searchParams) {
				if (targetUrl.searchParams.get(param) !== value) {
					return false;
				}
			}

			return true;
		}

		return false;
	},

	_setAttachmentReferer(attachment) {
		const url = new URL(document.location.href);

		try {
			const attachmentUrl = new URL(attachment.url);
			const sameOrigin = attachmentUrl.origin === url.origin && attachmentUrl.scheme === url.scheme;
			attachment.referrer = sameOrigin ? url.href : url.origin;
		} catch (e) {
			attachment.referrer = url.origin;
		}
	},
};

ItemSaver.fetchAttachmentSafari = async function(attachment) {
	if (!Zotero.isSafari) return;
	let options = { responseType: "arraybuffer", timeout: 60000, forceInject: true };
	let xhr;
	try {
		xhr = await Zotero.HTTP.request("GET", attachment.url, options);
	}
	catch (e) {
		Zotero.debug(`Failed to fetch attachment in safari content script: ${attachment.url}`);
		return;
	}
	let { contentType } = Zotero.Utilities.Connector.getContentTypeFromXHR(xhr);

	const mimeTypeMatches = attachment.mimeType.toLowerCase() === contentType.toLowerCase()
	const serverIsOctetStream = contentType.toLowerCase() === 'application/octet-stream'
	if (mimeTypeMatches || serverIsOctetStream) {
		Zotero.debug(`Fetched an attachment in safari content script: ${attachment.url}`);
		attachment.data = Zotero.Utilities.Connector.arrayBufferToBase64(xhr.response);
	}
}

Zotero.ItemSaver = ItemSaver;
