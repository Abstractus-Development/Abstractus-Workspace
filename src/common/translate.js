
Zotero.Translate.Web.prototype._prepareTranslation = Zotero.Promise.method(function () {
	this._itemSaver = new Zotero.Translate.ItemSaver({
		libraryID: this._libraryID,
		collections: this._collections,
		itemType: this._currentTranslator.itemType,
		attachmentMode: Zotero.Translate.ItemSaver[(this._saveAttachments ? "ATTACHMENT_MODE_DOWNLOAD" : "ATTACHMENT_MODE_IGNORE")],
		forceTagType: 1,
		sessionID: this._sessionID,
		cookieSandbox: this._cookieSandbox,
		proxy: this._proxy,
		baseURI: this.location
	});
	this.newItems = [];
});